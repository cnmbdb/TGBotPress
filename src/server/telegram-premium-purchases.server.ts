import type { DatabaseConnection } from './database.types'
import { handlePremiumTelegramCallback as runPremiumTelegramCallback } from '@tgbotpress/plugin-premium/purchases'
import type { PremiumTelegramUpdate } from '@tgbotpress/plugin-premium/purchases'

export {
  handleTelegramPremiumPackageCallback,
  handleTelegramPremiumUsernameReply,
  premiumPackageCallbackClaimPredicate,
  premiumWalletPayClaimPredicate,
  premiumCancelUnpaidClaimPredicate,
  premiumChooseAgainClaimPredicate,
  premiumUsernameReplyClaimPredicate,
  isPremiumUsernameReplyCandidate,
  isPremiumUsernameReplyForPrompt,
  isPremiumCallbackUpdate,
} from '@tgbotpress/plugin-premium/purchases'

type TelegramDatabase = Pick<DatabaseConnection, 'query'>
const connectedPool = (pool: TelegramDatabase) => pool as TelegramDatabase & Pick<DatabaseConnection, 'connect'>
export const handlePremiumTelegramCallback = (pool: TelegramDatabase, fetcher: typeof fetch, botRid: number, update: PremiumTelegramUpdate) => runPremiumTelegramCallback(connectedPool(pool), fetcher, botRid, update)
