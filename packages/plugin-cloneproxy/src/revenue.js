const ZERO = 0n

function decimalToScaled(value, scale) {
  const text = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match || !Number.isInteger(scale) || scale < 0 || scale > 18) return null
  const sign = match[1] === '-' ? -1n : 1n
  const fraction = match[3] ?? ''
  const kept = fraction.slice(0, scale).padEnd(scale, '0')
  let absolute = BigInt(match[2]) * (10n ** BigInt(scale)) + BigInt(kept || '0')
  if (fraction.length > scale && fraction[scale] >= '5') absolute++
  return absolute * sign
}

export function scaledText(value, scale) {
  const sign = value < ZERO ? '-' : ''
  const absolute = value < ZERO ? -value : value
  const factor = 10n ** BigInt(scale)
  const fraction = (absolute % factor).toString().padStart(scale, '0')
  return sign + (absolute / factor).toString() + (scale ? '.' + fraction : '')
}

export function cloneProxyRevenueCommission(amount, revenueRatio) {
  const grossMicros = decimalToScaled(amount, 6)
  const ratioHundredths = decimalToScaled(revenueRatio, 2)
  if (grossMicros === null || ratioHundredths === null || grossMicros <= ZERO) return null
  const boundedRatio = ratioHundredths < ZERO ? ZERO : ratioHundredths > 15_000n ? 15_000n : ratioHundredths
  if (boundedRatio === ZERO) return null
  const commissionMicros = (grossMicros * boundedRatio + 5_000n) / 10_000n
  if (commissionMicros <= ZERO) return null
  return {
    gross: scaledText(grossMicros, 6),
    commission: scaledText(commissionMicros, 6),
    ratioHundredths,
  }
}
