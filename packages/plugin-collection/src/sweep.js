const SCALE = 1_000_000n

export function decimalUnits(value, decimals = 6) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match || decimals < 0 || decimals > 18) throw new Error('invalid_balance')
  const fraction = match[2] ?? ''
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new Error('balance_precision_exceeded')
  const normalized = fraction.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(normalized || '0')
}

export function amountPlan(coin, balance, threshold, reserve) {
  const fee = coin === 'trx' ? 1_500_000n : 0n
  if (!['trx', 'usdt'].includes(coin) || threshold <= 0n || reserve < 0n || threshold - reserve - fee <= 0n || balance < threshold) return null
  const amount = balance - reserve - fee
  return amount > 0n ? { coin, amount } : null
}
export function formatUnits(value) { return String(value / 1_000_000n) + '.' + String(value % 1_000_000n).padStart(6, '0') }
export function collectionWalletSweepPlan(input) {
  const coin = input.coin
  const balance = decimalUnits(input.balance)
  const threshold = decimalUnits(input.threshold)
  const reserve = decimalUnits(input.reserve)
  return amountPlan(coin, balance, threshold, reserve)
}
