import { execFile } from 'node:child_process'
import { constants, createPrivateKey, privateDecrypt, type KeyObject } from 'node:crypto'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { syncPremiumFulfillment as runPremiumFulfillment, type PremiumRunPayment } from '@tgbotpress/plugin-premium/fulfillment'

const execFileAsync = promisify(execFile)
type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'info' | 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number; runPayment?: PremiumRunPayment; preflight?: (mnemonic: string) => Promise<boolean> }

function rsaPrivateKey(): KeyObject {
  const path = process.env.TRON_RSA_PRIVATE_KEY_PATH
  const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PRIVATE_KEY)?.replace(/\\n/g, '\n').trim()
  if (!raw) throw new Error('RSA_PRIVATE_KEY_UNAVAILABLE')
  return createPrivateKey(raw)
}

function decryptSecret(value: string | null): string {
  if (!value) return ''
  const versioned = value.startsWith('v2:'), encoded = (versioned ? value.slice(3) : value).replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('RSA_CIPHERTEXT_INVALID')
  const encrypted = Buffer.from(encoded, 'base64'), key = rsaPrivateKey(), bytes = (key.asymmetricKeyDetails?.modulusLength ?? 0) / 8
  if (!bytes || bytes < 256 || bytes % 1 || !encrypted.length || encrypted.length % bytes) throw new Error('RSA_CIPHERTEXT_INVALID')
  const parts: Buffer[] = []
  for (let offset = 0; offset < encrypted.length; offset += bytes) parts.push(privateDecrypt(versioned
    ? { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }
    : { key, padding: constants.RSA_PKCS1_PADDING }, encrypted.subarray(offset, offset + bytes)))
  return Buffer.concat(parts).toString('utf8')
}

async function runTonPayment(amount: string, ref: string, months: number, mnemonic: string) {
  const binary = process.env.PLATFORM_TON_PAYMENT_BINARY || '/usr/local/bin/ton-payment'
  const env = { ...process.env, WalletMnemonic: mnemonic, TON_API_GATEWAY: process.env.TON_API_GATEWAY || 'https://tonapi.txsw.top', TON_API_GATEWAY_TOKEN: process.env.TON_API_GATEWAY_TOKEN || '' }
  const result = await execFileAsync(binary, [amount, ref, String(months), 'premium'], { env, timeout: 180_000, maxBuffer: 64 * 1024 })
  const output = `${result.stdout}\n${result.stderr}`
  const hash = /交易hash:\s*([^\s]+)/u.exec(output)?.[1]
  if (!output.includes('交易成功') || !hash) throw new Error('TON_RESULT_UNCONFIRMED')
  return hash
}

async function runTonPreflight(mnemonic: string) {
  const binary = process.env.PLATFORM_TON_PAYMENT_BINARY || '/usr/local/bin/ton-payment'
  try {
    await execFileAsync(binary, ['--check-gateway'], { env: { ...process.env, WalletMnemonic: mnemonic, TON_API_GATEWAY: process.env.TON_API_GATEWAY || 'https://tonapi.txsw.top', TON_API_GATEWAY_TOKEN: process.env.TON_API_GATEWAY_TOKEN || '' }, timeout: 30_000, maxBuffer: 64 * 1024 })
    return true
  } catch { return false }
}

export const premiumTonRuntime = { decryptSecret, runPayment: runTonPayment, preflight: runTonPreflight }

export function syncPremiumFulfillment(options: Options = {}) {
  return runPremiumFulfillment({
    pool: options.pool ?? db,
    decryptSecret,
    runPayment: options.runPayment ?? runTonPayment,
    preflight: options.preflight ?? runTonPreflight,
    fetcher: options.fetcher,
    logger: options.logger,
    shouldContinue: options.shouldContinue,
    enabled: options.enabled ?? process.env.PLATFORM_PREMIUM_FULFILLMENT_ACTIONS === 'true',
    allowTelegramStars: process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
    batchSize: options.batchSize,
  })
}
