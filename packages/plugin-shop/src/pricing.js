function exactDecimal(value) {
  const match = String(value ?? '').trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/u)
  if (!match) return null
  const fraction = match[3] ?? ''
  const magnitude = BigInt(match[2]) * 10n ** BigInt(fraction.length) + BigInt(fraction || '0')
  return { units: match[1] === '-' ? -magnitude : magnitude, scale: fraction.length }
}
function exactDecimalText(units, scale) {
  const negative = units < 0n, absolute = negative ? -units : units, divisor = 10n ** BigInt(scale)
  const whole = absolute / divisor
  if (scale === 0) return `${negative ? '-' : ''}${whole}`
  const fraction = String(absolute % divisor).padStart(scale, '0').replace(/0+$/u, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}
export function effectiveShopPrice(cardPrice, goodsPrice, discount) {
  const card = exactDecimal(cardPrice), fallback = exactDecimal(goodsPrice), factor = exactDecimal(discount)
  const base = card && card.units > 0n ? card : fallback
  if (!base || !factor || base.units <= 0n || factor.units <= 0n) return null
  const units = base.units * factor.units
  return units > 0n ? exactDecimalText(units, base.scale + factor.scale) : null
}
export function shopMoney(value) {
  const amount = exactDecimal(value)
  if (!amount || amount.units <= 0n) return null
  const places = 6
  let units = amount.units
  if (amount.scale > places) {
    const divisor = 10n ** BigInt(amount.scale - places), quotient = units / divisor, remainder = units % divisor
    units = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  } else if (amount.scale < places) units *= 10n ** BigInt(places - amount.scale)
  return units > 0n ? exactDecimalText(units, places) : null
}
