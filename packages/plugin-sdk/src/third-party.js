const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const allowedPermissions = new Set(['http', 'telegram', 'tasks', 'storage', 'admin.api', 'admin.menu', 'plugin.storage.read', 'plugin.storage.write', 'plugin.jobs.register', 'telegram.updates.read', 'telegram.commands.register', 'telegram.api.call', 'telegram.messages.send', 'telegram.messages.edit', 'telegram.messages.delete', 'telegram.members.read', 'telegram.members.manage', 'external.http'])
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const telegramUpdateTypes = new Set(['message','edited_message','channel_post','edited_channel_post','business_connection','business_message','edited_business_message','deleted_business_messages','guest_message','message_reaction','message_reaction_count','inline_query','chosen_inline_result','callback_query','shipping_query','pre_checkout_query','purchased_paid_media','poll','poll_answer','my_chat_member','chat_member','chat_join_request','chat_boost','removed_chat_boost','managed_bot','subscription','stopped_message_generation'])
const telegramMethodPermissions = new Map([
  ...['sendMessage','sendPhoto','sendDocument','sendVideo','sendAudio','sendVoice','sendAnimation','sendMediaGroup','sendLocation','sendVenue','sendContact','sendPoll','sendDice','copyMessage','forwardMessage','sendChatAction'].map(method => [method,'telegram.messages.send']),
  ...['editMessageText','editMessageCaption','editMessageMedia','editMessageReplyMarkup','stopPoll'].map(method => [method,'telegram.messages.edit']),
  ...['deleteMessage','deleteMessages'].map(method => [method,'telegram.messages.delete']),
  ...['getChat','getChatMember','getChatAdministrators','getChatMemberCount','getUserProfilePhotos'].map(method => [method,'telegram.members.read']),
  ...['banChatMember','unbanChatMember','restrictChatMember','promoteChatMember','setChatPermissions','setChatTitle','setChatDescription','setChatPhoto','deleteChatPhoto','pinChatMessage','unpinChatMessage','unpinAllChatMessages','approveChatJoinRequest','declineChatJoinRequest','createChatInviteLink','editChatInviteLink','revokeChatInviteLink'].map(method => [method,'telegram.members.manage']),
  ...['getMe','getMyCommands','getWebhookInfo','getFile','answerCallbackQuery'].map(method => [method,'telegram.api.call']),
])

export function validateThirdPartyManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('plugin_manifest_invalid')
  if (!manifest || manifest.schemaVersion !== 1 || !idPattern.test(manifest.id) || manifest.id.length > 64 || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 100 || !versionPattern.test(manifest.version) || manifest.apiVersion !== 1 || typeof manifest.hostRange !== 'string' || !manifest.hostRange.trim() || typeof manifest.sdkRange !== 'string' || !manifest.sdkRange.trim() || !manifest.runtime || typeof manifest.runtime.node !== 'string' || !manifest.runtime.node.trim() || typeof manifest.entry !== 'string' || !/^\.\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:js|mjs)$/u.test(manifest.entry) || manifest.entry.slice(2).split('/').some(part => part === '.' || part === '..')) throw new Error('plugin_manifest_invalid')
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some(value => !allowedPermissions.has(value)) || new Set(manifest.permissions).size !== manifest.permissions.length) throw new Error('plugin_permissions_invalid')
  const commands=manifest.contributes?.commands
  if(commands!==undefined&&(!Array.isArray(commands)||commands.length>100||commands.some(command=>!command||typeof command.name!=='string'||!/^([a-z0-9_]{1,32})$/.test(command.name)||typeof command.description!=='string'||!command.description.trim()||Array.from(command.description).length>256)||new Set(commands.map(command=>command.name)).size!==commands.length))throw new Error('plugin_commands_invalid')
  const commandPermission=manifest.permissions.includes('telegram.commands.register')
  if((commands?.length??0)>0&&!commandPermission)throw new Error('plugin_command_permission_required')
  if(commandPermission&&(!commands?.length||!manifest.telegramUpdateTypes?.includes('message')))throw new Error('plugin_command_declaration_required')
  if (manifest.permissions.includes('telegram') || manifest.permissions.includes('telegram.updates.read') || commandPermission) {
    if (!Array.isArray(manifest.telegramUpdateTypes) || manifest.telegramUpdateTypes.length === 0 || manifest.telegramUpdateTypes.length > telegramUpdateTypes.size || manifest.telegramUpdateTypes.some(value => typeof value !== 'string' || !telegramUpdateTypes.has(value)) || new Set(manifest.telegramUpdateTypes).size !== manifest.telegramUpdateTypes.length) throw new Error('plugin_telegram_update_types_invalid')
  } else if (manifest.telegramUpdateTypes !== undefined) throw new Error('plugin_telegram_permission_required')
  return manifest
}

export function validateThirdPartyPlugin(plugin) {
  if (!plugin || typeof plugin !== 'object' || !plugin.manifest || typeof plugin.activate !== 'function') throw new Error('plugin_contract_invalid')
  validateThirdPartyManifest(plugin.manifest)
  if (plugin.deactivate !== undefined && typeof plugin.deactivate !== 'function') throw new Error('plugin_deactivate_invalid')
  return plugin
}

export async function collectThirdPartyRegistrations(plugin, options = {}) {
  validateThirdPartyPlugin(plugin)
  const log = options.log ?? console
  const storage = options.storage
  const permissions = new Set(plugin.manifest.permissions)
  const routes = [], tasks = [], commands = [], telegramHandlers = []
  const routeKeys = new Set(), taskIds = new Set(), commandNames = new Set()
  let registering = true
  const hasPermission = permission => permissions.has(permission) || (permission.startsWith('telegram.') && permissions.has('telegram')) || (permission.startsWith('plugin.storage.') && permissions.has('storage')) || (permission === 'plugin.jobs.register' && permissions.has('tasks')) || (permission === 'admin.api' && permissions.has('http'))
  const requirePermission = permission => { if (!hasPermission(permission)) throw new Error('plugin_permission_missing:' + permission) }
  const requireStoragePermission = action => { if (!hasPermission(`plugin.storage.${action}`)) throw new Error(`plugin_permission_missing:plugin.storage.${action}`) }
  const telegramPermission = method => telegramMethodPermissions.get(method) ?? 'telegram.api.call'
  const requireRegistrationWindow = () => { if (!registering) throw new Error('plugin_registration_closed') }
  const telegramContext = update => ({
    storage: hasPermission('plugin.storage.read') || hasPermission('plugin.storage.write') ? (() => { if (!storage?.forBot) throw new Error('plugin_storage_unavailable'); return storage.forBot(update.botId) })() : undefined,
    telegram: { call: (method, payload) => {
      requirePermission(telegramPermission(method))
      if (!options.telegram) throw new Error('plugin_telegram_unavailable')
      return options.telegram.call(update.botId, method, payload)
    } },
  })
  const host = {
    log: { info: (...values) => log.info(...values), error: (...values) => log.error(...values) },
    storage: {
      get(key) { requireStoragePermission('read'); if (!storage) throw new Error('plugin_storage_unavailable'); return storage.get(key) },
      set(key, value) { requireStoragePermission('write'); if (!storage) throw new Error('plugin_storage_unavailable'); return storage.set(key, value) },
      delete(key) { requireStoragePermission('write'); if (!storage) throw new Error('plugin_storage_unavailable'); return storage.delete(key) },
      forBot(botId) { if (!hasPermission('plugin.storage.read') && !hasPermission('plugin.storage.write')) throw new Error('plugin_permission_missing:plugin.storage.read'); if (!storage?.forBot) throw new Error('plugin_storage_unavailable'); return storage.forBot(botId) },
    },
    telegram: {
      call(botId, method, payload) {
        requirePermission(telegramPermission(method))
        if (!options.telegram) throw new Error('plugin_telegram_unavailable')
        return options.telegram.call(botId, method, payload)
      },
    },
    registerRoute(route) {
      requireRegistrationWindow()
      requirePermission('admin.api')
      if (!route || !methods.has(route.method) || typeof route.path !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/.test(route.path) || typeof route.handler !== 'function') throw new Error('plugin_route_invalid')
      const key = `${route.method} ${route.path}`
      if (routeKeys.has(key)) throw new Error('plugin_route_duplicate')
      routeKeys.add(key); routes.push(route)
    },
    registerTask(task) {
      requireRegistrationWindow()
      requirePermission('plugin.jobs.register')
      if (!task || !idPattern.test(task.id) || !Number.isSafeInteger(task.intervalMs) || task.intervalMs < 1000 || task.intervalMs > 86400000 || typeof task.run !== 'function' || (task.drain !== undefined && typeof task.drain !== 'boolean')) throw new Error('plugin_task_invalid')
      if (taskIds.has(task.id)) throw new Error('plugin_task_duplicate')
      taskIds.add(task.id); tasks.push(task)
    },
    registerCommand(command) {
      requireRegistrationWindow()
      requirePermission('telegram.commands.register')
      if (!command || typeof command.name !== 'string' || !/^[a-z0-9_]{1,32}$/u.test(command.name) || typeof command.description !== 'string' || !command.description.trim() || Array.from(command.description).length > 256 || typeof command.handler !== 'function') throw new Error('plugin_command_invalid')
      const declared = (plugin.manifest.contributes?.commands ?? []).find(item => item.name === command.name)
      if (!declared || declared.description !== command.description) throw new Error('plugin_command_undeclared')
      if (commandNames.has(command.name)) throw new Error('plugin_command_duplicate')
      commandNames.add(command.name)
      commands.push({ name: command.name, description: command.description, handler: async event => command.handler({ ...event, ...telegramContext(event) }) })
    },
    onTelegramUpdate(handler) {
      requireRegistrationWindow()
      requirePermission('telegram.updates.read')
      if (typeof handler !== 'function') throw new Error('plugin_telegram_handler_invalid')
      telegramHandlers.push(update => handler({ ...update, ...telegramContext(update) }))
    },
  }
  try { await plugin.activate(host) } finally { registering = false }
  for (const command of plugin.manifest.contributes?.commands ?? []) if (!commandNames.has(command.name)) throw new Error('plugin_command_not_registered:' + command.name)
  return { routes, tasks, commands, telegramHandlers }
}
