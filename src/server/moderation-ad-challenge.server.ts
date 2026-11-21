import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { startAdVerificationChallenge as startChallenge } from '@tgbotpress/plugin-groups/ad-challenge'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
export const startAdVerificationChallenge = startChallenge
