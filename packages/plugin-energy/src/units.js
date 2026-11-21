export function decimalUnits(value, decimals = 6) {
  const scale = 10n ** BigInt(decimals), whole = (BigInt(value) / scale).toString()
  const fraction = (BigInt(value) % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? whole + '.' + fraction : whole
}
