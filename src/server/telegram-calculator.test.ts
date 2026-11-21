import { test } from 'node:test'
import assert from 'node:assert/strict'
import { telegramCalculatorReply } from './telegram-calculator'

test('Telegram calculator preserves arithmetic precedence and parentheses', () => {
  assert.equal(telegramCalculatorReply('2 + 3 * 4'), '2 + 3 * 4 = 14')
  assert.equal(telegramCalculatorReply('(2 + 3) * 4'), '(2 + 3) * 4 = 20')
  assert.equal(telegramCalculatorReply('8/4/2'), '8/4/2 = 1')
  assert.equal(telegramCalculatorReply('1.25 + 2.5'), '1.25 + 2.5 = 3.75')
})

test('Telegram calculator rejects non-expressions and reports division by zero', () => {
  for (const value of ['', 'hello', '/start', '1 +', '1++2', '(-1+2)', '2 ** 3']) {
    assert.equal(telegramCalculatorReply(value), null, value)
  }
  assert.equal(telegramCalculatorReply('1/0'), '计算表达式错误：Division by zero')
})
