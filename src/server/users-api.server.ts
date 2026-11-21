import { db } from './db.server'
import { can, identity, run } from './api.server'
import { createUsersApi } from '@tgbotpress/plugin-groups/users-api'
export const usersApi = createUsersApi({ db, can, identity, run })
