import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearCloudflareAccessKeyCacheForTests, trustedRequestHostname, verifyCloudflareAccessJwt } from './cloudflare-access.server'

const issuer = 'https://example.cloudflareaccess.com'
const audience = 'app-audience'
const now = 1_800_000_000
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' }

function jwt(claims: Record<string, unknown>, privateKey = pair.privateKey, kid = 'key-1', alg = 'RS256') {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg, kid, typ: 'JWT' })
  const body = encode(claims)
  const input = `${header}.${body}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
}

function fetchKeys(keys: unknown[]) {
  return async () => Response.json({ keys }, { headers: { 'Cache-Control': 'public, max-age=300' } })
}

function claims(overrides: Record<string, unknown> = {}) {
  return { iss: issuer, aud: [audience], exp: now + 120, iat: now - 5, email: 'Admin@Example.test', sub: 'access-subject', ...overrides }
}

test('validates signed Cloudflare Access identity and normalizes email', async () => {
  clearCloudflareAccessKeyCacheForTests()
  const result = await verifyCloudflareAccessJwt(jwt(claims()), { issuer, audience, fetcher: fetchKeys([publicJwk]), now })
  assert.equal(result.email, 'admin@example.test')
  assert.equal(result.sub, 'access-subject')
})

test('rejects invalid issuer, audience, expiry, signature, algorithm and missing user claims', async () => {
  const invalid = [
    { token: jwt(claims({ iss: 'https://other.cloudflareaccess.com' })), message: /issuer or audience/ },
    { token: jwt(claims({ aud: ['other-app'] })), message: /issuer or audience/ },
    { token: jwt(claims({ exp: now })), message: /expired/ },
    { token: jwt(claims({ nbf: now + 61 })), message: /not yet valid/ },
    { token: jwt(claims({}), pair.privateKey, 'key-1', 'HS256'), message: /algorithm/ },
    { token: jwt(claims({ email: undefined })), message: /identity is missing/ },
  ]
  for (const item of invalid) {
    clearCloudflareAccessKeyCacheForTests()
    await assert.rejects(verifyCloudflareAccessJwt(item.token, { issuer, audience, fetcher: fetchKeys([publicJwk]), now }), item.message)
  }
  clearCloudflareAccessKeyCacheForTests()
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
  await assert.rejects(verifyCloudflareAccessJwt(jwt(claims(), other.privateKey), { issuer, audience, fetcher: fetchKeys([publicJwk]), now }), /signature is invalid/)
})

test('refreshes the JWKS when Cloudflare rotates to a new signing key', async () => {
  clearCloudflareAccessKeyCacheForTests()
  const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rotatedJwk = { ...rotated.publicKey.export({ format: 'jwk' }), kid: 'key-2', alg: 'RS256', use: 'sig' }
  let calls = 0
  const fetcher = async () => Response.json({ keys: ++calls === 1 ? [publicJwk] : [rotatedJwk] })
  const result = await verifyCloudflareAccessJwt(jwt(claims(), rotated.privateKey, 'key-2'), { issuer, audience, fetcher, now })
  assert.equal(result.sub, 'access-subject')
  assert.equal(calls, 2)
})

test('fails closed when JWKS cannot be fetched', async () => {
  clearCloudflareAccessKeyCacheForTests()
  await assert.rejects(verifyCloudflareAccessJwt(jwt(claims()), { issuer, audience, fetcher: async () => new Response(null, { status: 503 }), now }), /signing keys are unavailable/)
})

test('trusts forwarded host only when the private Worker-to-container secret matches', () => {
  const previous = process.env.PLATFORM_EDGE_SECRET
  process.env.PLATFORM_EDGE_SECRET = 'a'.repeat(40)
  try {
    assert.equal(trustedRequestHostname(new Request('http://container/api/me', { headers: { 'x-platform-original-host': 'admin.example.test' } })), 'container')
    assert.equal(trustedRequestHostname(new Request('http://container/api/me', { headers: { 'x-platform-edge-auth': 'wrong', 'x-platform-original-host': 'admin.example.test' } })), 'container')
    assert.equal(trustedRequestHostname(new Request('http://container/api/me', { headers: { 'x-platform-edge-auth': 'a'.repeat(40), 'x-platform-original-host': 'ADMIN.EXAMPLE.TEST' } })), 'admin.example.test')
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_EDGE_SECRET
    else process.env.PLATFORM_EDGE_SECRET = previous
  }
})
