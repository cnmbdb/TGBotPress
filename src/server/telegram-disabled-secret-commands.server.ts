export const DISABLED_SECRET_COMMAND_REPLY = '该功能已停用，请勿通过机器人发送私钥或助记词。'

export const DISABLED_SECRET_COMMAND_PREFIXES = [
  '查私钥', '查助记词', '查地址', '查以太私钥', '查以太助记词', '查以太地址', '授权波场', '多签波场',
] as const

export function isDisabledSensitiveTelegramCommand(value: unknown) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return DISABLED_SECRET_COMMAND_PREFIXES.some(prefix => text.startsWith(prefix))
}
