import { db } from './db.server'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { cookie, cookies, digest, equalTokens, isToken } from './security'
import { sendVerifiedJoinNotification } from './telegram-join-updates.server'
import { createVerificationApi } from '@tgbotpress/plugin-groups/verification-api'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
export const telegramVerificationApi = createVerificationApi({ db, cookie, cookies, digest, equalTokens, isToken, sendVerifiedJoinNotification })
