import { db } from './db.server'
import { can, identity, run } from './api.server'
import { scanRecentGroupMessages } from './moderation-scan.server'
import { telegramVerificationApi } from './moderation-verification-api.server'
import { customGroupAdKeywords } from './moderation-keywords'
import { createModerationApi } from '@tgbotpress/plugin-groups/moderation-api'
export const moderationApi = createModerationApi({ db, can, identity, run, scanRecentGroupMessages, telegramVerificationApi, customGroupAdKeywords })
