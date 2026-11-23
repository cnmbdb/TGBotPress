import { createPublicKey, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PremiumAdminHost } from '@tgbotpress/plugin-premium/admin-api'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { encryptRsaV2 } from './rsa-storage.server'
import { BotServiceError } from './bot-service.server'
import { boundedFormData, saveMessageImage } from './media-storage.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
let publicKey: KeyObject | null = null

function encryptPlatformSecret(value: string) {
  if (!publicKey) {
    const path = process.env.TRON_RSA_PUBLIC_KEY_PATH
    const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PUBLIC_KEY)?.replace(/\\n/g, '\n').trim()
    if (!raw) throw new Error('RSA_PUBLIC_KEY_UNAVAILABLE')
    publicKey = createPublicKey(raw)
  }
  return encryptRsaV2(value, publicKey, 3000)
}

async function parsePackageBody(request: Request) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.startsWith('application/json')) {
    const raw = await request.text()
    if (raw.length > 32_768) throw new BotServiceError(413, '表单内容过长')
    try { return { body: JSON.parse(raw) as unknown, upload: undefined as File | undefined } }
    catch { throw new BotServiceError(400, '表单内容无效') }
  }
  if (contentType.startsWith('multipart/form-data')) {
    const form = await boundedFormData(request), payload = form.get('payload'), file = form.get('thumb')
    if (typeof payload !== 'string' || payload.length > 32_768) throw new BotServiceError(400, '表单内容无效')
    let body: unknown
    try { body = JSON.parse(payload) } catch { throw new BotServiceError(400, '表单内容无效') }
    if (file !== null && !(file instanceof File)) throw new BotServiceError(400, '图片文件无效')
    return { body, upload: file instanceof File ? file : undefined }
  }
  throw new BotServiceError(415, '请求格式无效')
}

export const premiumPluginHost: PremiumAdminHost = {
  db,
  identity,
  can,
  run,
  telegramActionsEnabled: () => process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
  platformOrigin: () => process.env.PLATFORM_ORIGIN,
  encryptPlatformSecret,
  parsePackageBody,
  savePackageImage: saveMessageImage,
  serviceErrorResponse: error => error instanceof BotServiceError ? Response.json({ message: error.message }, { status: error.status, headers }) : null,
}
