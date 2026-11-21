import { db } from './db.server'
import { startAdVerificationChallenge } from './moderation-ad-challenge.server'
import { effectiveGroupAdKeywords } from './moderation-keywords'
import { createModerationScan } from '@tgbotpress/plugin-groups/moderation-scan'
export const { analyzeMessage, scanRecentGroupMessages } = createModerationScan({ db, startAdVerificationChallenge, effectiveGroupAdKeywords })
