/** Safely evaluate the legacy Telegram calculator syntax without dynamic code execution. */
export function telegramCalculatorReply(value: string): string | null {
  const source = value.trim().replace(/ /gu, '')
  if (!source || source.length > 4096 || !/[+*/-]/u.test(source) || !/^[0-9.()+*/-]+$/u.test(source)) return null

  let offset = 0
  let depth = 0
  const number = () => {
    const match = /^\d+(?:\.\d+)?/u.exec(source.slice(offset))
    if (!match) throw new Error('invalid_expression')
    offset += match[0].length
    const result = Number(match[0])
    if (!Number.isFinite(result)) throw new Error('invalid_expression')
    return result
  }
  const primary = (): number => {
    if (source[offset] !== '(') return number()
    if (++depth > 64) throw new Error('expression_too_deep')
    offset++
    const result = additive()
    if (source[offset] !== ')') throw new Error('invalid_expression')
    offset++
    depth--
    return result
  }
  const multiplicative = (): number => {
    let result = primary()
    while (source[offset] === '*' || source[offset] === '/') {
      const operator = source[offset++]
      const right = primary()
      if (operator === '/' && right === 0) throw new Error('division_by_zero')
      result = operator === '*' ? result * right : result / right
    }
    return result
  }
  const additive = (): number => {
    let result = multiplicative()
    while (source[offset] === '+' || source[offset] === '-') {
      const operator = source[offset++]
      const right = multiplicative()
      result = operator === '+' ? result + right : result - right
    }
    if (!Number.isFinite(result)) throw new Error('invalid_expression')
    return result
  }

  try {
    const result = additive()
    if (offset !== source.length) return null
    return `${value.trim()} = ${Object.is(result, -0) ? '0' : String(result)}`
  } catch (error) {
    if (error instanceof Error && error.message === 'division_by_zero') return '计算表达式错误：Division by zero'
    return null
  }
}
