import { trustedPackageForPlugin, type TrustedPluginPackage } from './install-policy.server'
import { stagePluginArtifact, type InstalledArtifact } from './package-installer.server'
import { validateThirdPartyManifest, type ThirdPartyPluginManifest } from '@tgbotpress/plugin-sdk'
import { gunzipSync } from 'node:zlib'

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>
const registryOrigin = 'https://npm.pkg.github.com'
const npmRegistryOrigin = 'https://registry.npmjs.org'
const maxArtifactBytes = 50 * 1024 * 1024
const maxUnpackedArtifactBytes = 100 * 1024 * 1024
const maxMetadataBytes = 1_000_000

function packageUrl(packageName: string, version: string) {
  const encoded = packageName.replace(/^@/, '').replace('/', '%2f')
  return `${registryOrigin}/@${encoded}/-/${packageName.split('/')[1]}-${version}.tgz`
}

export async function downloadAndStagePluginArtifact(input: Omit<TrustedPluginPackage, 'integritySha512'> & { integritySha512: string; fetcher?: Fetcher; root: string; token: string }): Promise<InstalledArtifact> {
  const trusted = trustedPackageForPlugin(input.pluginId, { packageName: input.packageName, version: input.version, source: 'github-packages', integritySha512: input.integritySha512 })
  if (!input.token.trim()) throw new Error('plugin_registry_token_required')
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(packageUrl(trusted.packageName, trusted.version), { redirect: 'error', headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${input.token}` } })
  if (!response.ok) throw new Error('plugin_registry_http_' + response.status)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maxArtifactBytes) throw new Error('plugin_artifact_too_large')
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > maxArtifactBytes) throw new Error('plugin_artifact_too_large')
  return stagePluginArtifact({ ...trusted, bytes: buffer }, input.root)
}

type NpmVersionMetadata = { name?: unknown; version?: unknown; tgbotpressPlugin?: unknown; dependencies?: unknown; dist?: { tarball?: unknown; integrity?: unknown } }
export type NpmPluginInspection = { packageName: string; version: string; manifest: ThirdPartyPluginManifest; dependencies: Record<string,string>; integritySha512: string }
function npmMetadataUrl(packageName: string, version: string) {
  const encodedName = packageName.startsWith('@') ? packageName.replace('/', '%2f') : packageName
  return new URL(`${encodedName}/${encodeURIComponent(version)}`, `${npmRegistryOrigin}/`)
}
function registryTarballUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('plugin_registry_tarball_invalid')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password || url.hash) throw new Error('plugin_registry_tarball_invalid')
  return url
}

function stableJson(value: unknown): string {
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)??'null'
}

function tarString(block: Uint8Array, start: number, length: number) {
  const bytes=block.subarray(start,start+length)
  const end=bytes.indexOf(0)
  return new TextDecoder().decode(end<0?bytes:bytes.subarray(0,end)).trim()
}

function tarOctal(block: Uint8Array, start: number, length: number) {
  const value=tarString(block,start,length).replace(/\0/g,'').trim()
  if(!value)return 0
  const parsed=Number.parseInt(value,8)
  if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error('plugin_npm_tarball_invalid')
  return parsed
}

function safePackageTarPath(value: string) {
  const path=value.replaceAll('\\','/')
  if(!path||path.startsWith('/')||/^[A-Za-z]:/u.test(path))throw new Error('plugin_npm_tarball_path_invalid')
  const parts=path.split('/').filter(part=>part!==''&&part!=='.')
  if(parts.some(part=>part==='..'))throw new Error('plugin_npm_tarball_path_invalid')
  if(parts.length===1&&parts[0]!.startsWith('._'))return parts[0]!
  if(parts[0]!=='package')throw new Error('plugin_npm_tarball_path_invalid')
  return parts.join('/')
}

function paxPath(body: Uint8Array) {
  let offset=0, path: string|undefined
  while(offset<body.length){
    const space=body.indexOf(32,offset)
    if(space<0)throw new Error('plugin_npm_tarball_invalid')
    const length=Number(new TextDecoder().decode(body.subarray(offset,space)))
    if(!Number.isSafeInteger(length)||length<=space-offset+1||offset+length>body.length)throw new Error('plugin_npm_tarball_invalid')
    const record=new TextDecoder().decode(body.subarray(space+1,offset+length-1))
    const equal=record.indexOf('=')
    if(equal<1)throw new Error('plugin_npm_tarball_invalid')
    if(record.slice(0,equal)==='path')path=record.slice(equal+1)
    if(record.slice(0,equal)==='linkpath')throw new Error('plugin_npm_tarball_link_invalid')
    offset+=length
  }
  return path
}

function readTarFiles(bytes: Uint8Array, requiredFiles: string[]) {
  let data: Buffer
  try{data=gunzipSync(bytes,{maxOutputLength:maxUnpackedArtifactBytes})}catch{throw new Error('plugin_npm_tarball_invalid')}
  if(data.byteLength>maxUnpackedArtifactBytes)throw new Error('plugin_npm_unpacked_too_large')
  const needed=new Set(requiredFiles),found=new Map<string,Uint8Array>()
  let extendedPath:string|undefined,longPath:string|undefined
  let offset=0
  while(offset+512<=data.byteLength){
    const header=data.subarray(offset,offset+512)
    if(header.every(byte=>byte===0))break
    const prefix=tarString(header,345,155),name=tarString(header,0,100),headerPath=prefix?`${prefix}/${name}`:name
    const size=tarOctal(header,124,12),type=String.fromCharCode(header[156]||0)
    const bodyStart=offset+512,bodyEnd=bodyStart+size
    if(bodyEnd>data.byteLength)throw new Error('plugin_npm_tarball_invalid')
    if(type==='x'||type==='g'){
      const extended=paxPath(data.subarray(bodyStart,bodyEnd))
      if(extended)safePackageTarPath(extended)
      if(type==='x')extendedPath=extended
      offset=bodyStart+Math.ceil(size/512)*512
      continue
    }
    if(type==='L'){
      longPath=new TextDecoder().decode(data.subarray(bodyStart,bodyEnd)).replace(/\0.*$/su,'').trim()
      safePackageTarPath(longPath)
      offset=bodyStart+Math.ceil(size/512)*512
      continue
    }
    if(type==='1'||type==='2'||type==='K')throw new Error('plugin_npm_tarball_link_invalid')
    if(type!=='\0'&&type!=='0'&&type!=='5')throw new Error('plugin_npm_tarball_file_type_invalid')
    const path=safePackageTarPath(longPath??extendedPath??headerPath)
    longPath=undefined;extendedPath=undefined
    if(needed.has(path)){
      if(type==='5')throw new Error('plugin_npm_tarball_file_type_invalid')
      found.set(path,new Uint8Array(data.subarray(bodyStart,bodyEnd)))
      needed.delete(path)
    }
    offset=bodyStart+Math.ceil(size/512)*512
  }
  if(needed.size)throw new Error('plugin_npm_tarball_file_missing:'+ [...needed].join(','))
  return found
}

export function validateNpmPluginTarball(bytes: Uint8Array, packageName: string, version: string, registryManifest: ThirdPartyPluginManifest, registryDependencies: Record<string,string>) {
  const entryPath='package/'+registryManifest.entry.slice(2)
  const files=readTarFiles(bytes,['package/package.json','package/tgbotpress.plugin.json',entryPath])
  let packageJson: {name?:unknown;version?:unknown;tgbotpressPlugin?:unknown;dependencies?:unknown},sidecar: ThirdPartyPluginManifest
  try{
    packageJson=JSON.parse(new TextDecoder().decode(files.get('package/package.json')))
    sidecar=validateThirdPartyManifest(JSON.parse(new TextDecoder().decode(files.get('package/tgbotpress.plugin.json'))))
  }catch(error){if(error instanceof Error&&error.message.startsWith('plugin_'))throw error;throw new Error('plugin_npm_tarball_manifest_invalid')}
  if(packageJson.name!==packageName||packageJson.version!==version)throw new Error('plugin_npm_tarball_identity_mismatch')
  let mirrored: ThirdPartyPluginManifest
  try{mirrored=validateThirdPartyManifest(packageJson.tgbotpressPlugin)}catch{throw new Error('plugin_npm_tarball_package_manifest_missing')}
  if(stableJson(sidecar)!==stableJson(registryManifest)||stableJson(mirrored)!==stableJson(sidecar))throw new Error('plugin_npm_tarball_manifest_mismatch')
  const packageDependencies=packageJson.dependencies&&typeof packageJson.dependencies==='object'&&!Array.isArray(packageJson.dependencies)?packageJson.dependencies:{}
  if(stableJson(packageDependencies)!==stableJson(registryDependencies))throw new Error('plugin_npm_tarball_dependencies_mismatch')
  return true
}

export async function inspectNpmPluginPackage(input: { packageName: string; version: string; fetcher?: Fetcher }): Promise<NpmPluginInspection> {
  const fetcher = input.fetcher ?? fetch
  const metadataResponse = await fetcher(npmMetadataUrl(input.packageName, input.version), { headers: { Accept: 'application/vnd.npm.install-v1+json, application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!metadataResponse.ok) throw new Error('plugin_npm_metadata_http_' + metadataResponse.status)
  if (Number(metadataResponse.headers.get('content-length') ?? 0) > maxMetadataBytes) throw new Error('plugin_npm_metadata_too_large')
  const metadataText = await metadataResponse.text()
  if (metadataText.length > maxMetadataBytes) throw new Error('plugin_npm_metadata_too_large')
  let metadata: NpmVersionMetadata
  try { metadata = JSON.parse(metadataText) as NpmVersionMetadata } catch { throw new Error('plugin_npm_metadata_invalid') }
  if (metadata.name !== input.packageName || metadata.version !== input.version) throw new Error('plugin_npm_identity_mismatch')
  let manifest: ThirdPartyPluginManifest
  try { manifest = validateThirdPartyManifest(metadata.tgbotpressPlugin) } catch { throw new Error('plugin_npm_manifest_missing_or_invalid') }
  if (manifest.version !== input.version) throw new Error('plugin_manifest_version_mismatch')
  const integritySha512 = String(metadata.dist?.integrity ?? '')
  trustedPackageForPlugin(manifest.id, { packageName: input.packageName, version: input.version, source: 'npmjs', integritySha512 })
  registryTarballUrl(metadata.dist?.tarball)
  const rawDependencies=metadata.dependencies&&typeof metadata.dependencies==='object'&&!Array.isArray(metadata.dependencies)?metadata.dependencies as Record<string,unknown>:{ }
  if(Object.values(rawDependencies).some(value=>typeof value!=='string')||Object.keys(rawDependencies).length>200)throw new Error('plugin_npm_dependencies_invalid')
  return {packageName:input.packageName,version:input.version,manifest,dependencies:rawDependencies as Record<string,string>,integritySha512}
}

export async function downloadAndStageNpmPluginArtifact(input: { packageName: string; version: string; expectedIntegritySha512?: string; fetcher?: Fetcher; root: string; authorizePlugin?: (manifest: ThirdPartyPluginManifest) => Promise<void> }): Promise<{ artifact: InstalledArtifact; manifest: ThirdPartyPluginManifest }> {
  const fetcher = input.fetcher ?? fetch
  const inspection=await inspectNpmPluginPackage({packageName:input.packageName,version:input.version,fetcher})
  if(input.expectedIntegritySha512&&inspection.integritySha512!==input.expectedIntegritySha512)throw new Error('plugin_npm_integrity_changed')
  await input.authorizePlugin?.(inspection.manifest)
  const trusted=trustedPackageForPlugin(inspection.manifest.id,{packageName:input.packageName,version:input.version,source:'npmjs',integritySha512:inspection.integritySha512})
  const metadataResponse = await fetcher(npmMetadataUrl(input.packageName, input.version), { headers: { Accept: 'application/vnd.npm.install-v1+json, application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!metadataResponse.ok) throw new Error('plugin_npm_metadata_http_' + metadataResponse.status)
  if (Number(metadataResponse.headers.get('content-length') ?? 0) > maxMetadataBytes) throw new Error('plugin_npm_metadata_too_large')
  const metadataText = await metadataResponse.text()
  if (metadataText.length > maxMetadataBytes) throw new Error('plugin_npm_metadata_too_large')
  let metadata: NpmVersionMetadata
  try { metadata = JSON.parse(metadataText) as NpmVersionMetadata } catch { throw new Error('plugin_npm_metadata_invalid') }
  if(metadata.name!==input.packageName||metadata.version!==input.version||String(metadata.dist?.integrity??'')!==inspection.integritySha512)throw new Error('plugin_npm_metadata_changed')
  let refreshedManifest: ThirdPartyPluginManifest
  try{refreshedManifest=validateThirdPartyManifest(metadata.tgbotpressPlugin)}catch{throw new Error('plugin_npm_manifest_missing_or_invalid')}
  if(stableJson(refreshedManifest)!==stableJson(inspection.manifest))throw new Error('plugin_npm_metadata_changed')
  const tarballResponse = await fetcher(registryTarballUrl(metadata.dist?.tarball), { headers: { Accept: 'application/octet-stream' }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!tarballResponse.ok) throw new Error('plugin_npm_tarball_http_' + tarballResponse.status)
  if (Number(tarballResponse.headers.get('content-length') ?? 0) > maxArtifactBytes) throw new Error('plugin_artifact_too_large')
  const bytes = new Uint8Array(await tarballResponse.arrayBuffer())
  if (bytes.byteLength > maxArtifactBytes) throw new Error('plugin_artifact_too_large')
  validateNpmPluginTarball(bytes,input.packageName,input.version,inspection.manifest,inspection.dependencies)
  const artifact = await stagePluginArtifact({ ...trusted, bytes }, input.root)
  return { artifact, manifest: inspection.manifest }
}
