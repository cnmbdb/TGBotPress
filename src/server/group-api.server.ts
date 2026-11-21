import { db } from './db.server'
import { can, identity, run } from './api.server'
import { createGroupApi } from '@tgbotpress/plugin-groups/group-api'
export const groupApi = createGroupApi({ db, can, identity, run })
