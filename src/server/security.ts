import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
export const token = () => randomBytes(32).toString('hex')
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const isToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function equalTokens(a: string, b: string) { return isToken(a) && isToken(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)) }
export function cookies(request: Request) {
  const values: Record<string, string> = {}
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('='); if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (key in values) continue
    try { values[key] = decodeURIComponent(part.slice(index + 1)) } catch { /* malformed cookie is absent */ }
  }
  return values
}
export function cookie(name: string, value: string, seconds: number) {
  const secure = (process.env.PLATFORM_ORIGIN || '').startsWith('https:')
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`
}
