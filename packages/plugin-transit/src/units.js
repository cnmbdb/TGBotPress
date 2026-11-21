export function units(value, maxIntegerDigits = 12) {
  if (!new RegExp(`^\\d{1,${maxIntegerDigits}}(?:\\.\\d{1,4})?$`).test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 10_000n + BigInt((fraction + '0000').slice(0, 4))
}

export function formatUnits(value) {
  const whole = (value / 10_000n).toString()
  const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export function timestamp(value) {
  return value ? `${value.replace('T', ' ')}${value.length === 16 ? ':00' : ''}` : null
}
