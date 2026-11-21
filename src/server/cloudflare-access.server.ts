import { createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto'

export type CloudflareAccessClaims = {
  iss: string
  aud: string | string[]
  exp: number
  iat?: number
  nbf?: number
  email?: string
  sub?: string
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string }
type KeySet = { keys: Jwk[] }
type CacheEntry = { keys: Jwk[]; expiresAt: number }
const jwksCache = new Map<string, CacheEntry>()
const json = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>

function normalizedIssuer(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Cloudflare Access issuer must be an HTTPS team origin')
  return url.origin
}

async function signingKeys(issuer: string, fetcher: typeof fetch, force = false) {
  const cached = jwksCache.get(issuer)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.keys
  const response = await fetcher(new URL('/cdn-cgi/access/certs', issuer), { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Cloudflare Access signing keys are unavailable')
  const body = await response.json() as KeySet
  if (!Array.isArray(body.keys)) throw new Error('Cloudflare Access signing keys are invalid')
  const keys = body.keys.filter(key => key.kty === 'RSA' && key.kid && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'))
  if (!keys.length) throw new Error('Cloudflare Access signing keys are empty')
  const cacheControl = response.headers.get('cache-control') || ''
  const maxAge = Number(cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] || 300)
  jwksCache.set(issuer, { keys, expiresAt: Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000 })
  return keys
}

export async function verifyCloudflareAccessJwt(
  token: string,
  options: { issuer: string; audience: string; fetcher?: typeof fetch; now?: number },
): Promise<CloudflareAccessClaims> {
  if (token.length > 16_384) throw new Error('Cloudflare Access token is too large')
  const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split('.')
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra !== undefined) throw new Error('Cloudflare Access token is malformed')
  const header = json(encodedHeader)
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('Cloudflare Access token algorithm is invalid')
  const issuer = normalizedIssuer(options.issuer)
  const fetcher = options.fetcher ?? fetch
  let keys = await signingKeys(issuer, fetcher)
  let key = keys.find(candidate => candidate.kid === header.kid)
  if (!key) {
    keys = await signingKeys(issuer, fetcher, true)
    key = keys.find(candidate => candidate.kid === header.kid)
  }
  if (!key) throw new Error('Cloudflare Access signing key was not found')
  const signature = Buffer.from(encodedSignature, 'base64url')
  if (!verifySignature('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedClaims}`), createPublicKey({ key, format: 'jwk' }), signature)) throw new Error('Cloudflare Access token signature is invalid')
  const claims = json(encodedClaims) as unknown as CloudflareAccessClaims
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer || !audiences.includes(options.audience)) throw new Error('Cloudflare Access token issuer or audience is invalid')
  if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60)) || (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > now + 60))) throw new Error('Cloudflare Access token is expired or not yet valid')
  if (typeof claims.email !== 'string' || !claims.email.trim() || typeof claims.sub !== 'string' || !claims.sub.trim()) throw new Error('Cloudflare Access user identity is missing')
  return { ...claims, email: claims.email.trim().toLowerCase() }
}

export function clearCloudflareAccessKeyCacheForTests() { jwksCache.clear() }
export function cloudflareAccessRequired() { return process.env.PLATFORM_AUTH_MODE === 'cloudflare-access' }
export function trustedRequestHostname(request: Request) {
  const edgeSecret = process.env.PLATFORM_EDGE_SECRET || ''
  const suppliedSecret = request.headers.get('x-platform-edge-auth') || ''
  let source = request.headers.get('host') || new URL(request.url).host
  if (edgeSecret && suppliedSecret) {
    const expected = Buffer.from(edgeSecret), supplied = Buffer.from(suppliedSecret)
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) source = request.headers.get('x-platform-original-host') || ''
  }
  try { return new URL(`https://${source}`).hostname.toLowerCase() } catch { return '' }
}
