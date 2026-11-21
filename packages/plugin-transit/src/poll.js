export function transitUsdtStartTimestamp(latest, saved) {
  let result = latest && /^\d{1,16}$/.test(latest) ? BigInt(latest) : 0n
  if (saved) {
    const raw = saved instanceof Date ? saved.toISOString() : String(saved)
    const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+08:00`)
    if (Number.isFinite(date.getTime())) {
      const threshold = BigInt(Math.max(0, date.getTime() - 10))
      if (threshold > result) result = threshold
    }
  }
  return result.toString()
}
