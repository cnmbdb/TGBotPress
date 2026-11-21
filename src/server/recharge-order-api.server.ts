import { db } from './db.server'
import { can, identity, run } from './api.server'
import { createApi } from '@tgbotpress/plugin-groups/recharge-order-api'
export const rechargeOrderApi = createApi({ db, can, identity, run })
