import { db } from './db.server'
import { can, identity, run } from './api.server'
import { createApi } from '@tgbotpress/plugin-groups/recharge-trade-api'
export const rechargeTradeApi = createApi({ db, can, identity, run })
