export function priceUnits(value) {
  const text = String(value ?? '').trim(), match = /^\d+(?:\.\d{1,2})?$/.exec(text)
  if (!match) return null
  const [whole, fraction = ''] = text.split('.')
  const units = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
  return units > 0n ? units : null
}
export function priceText(units) { return (units / 100n).toString() + '.' + (units % 100n).toString().padStart(2, '0') }
