import { db } from '../../server/db.server'
import { lockGroupsPlugin, groupsPluginStatus } from './lifecycle.server'
import { createGroupTasks } from '@tgbotpress/plugin-groups/tasks'

const tasks = createGroupTasks({ lockGroupsPlugin, groupsPluginStatus })
export const { isGroupManagementUpdate, enqueueGroupManagementUpdate } = tasks
export type { GroupPluginTask } from '@tgbotpress/plugin-groups/tasks'
export function syncGroupManagementTasks(options: Omit<Parameters<typeof tasks.syncGroupManagementTasks>[0], 'pool'> & { pool?: Parameters<typeof tasks.syncGroupManagementTasks>[0]['pool'] }) {
  return tasks.syncGroupManagementTasks({ ...options, pool: options.pool ?? db })
}
