import assert from 'node:assert/strict'
import { test } from 'node:test'
import { priceText, priceUnits } from '@tgbotpress/plugin-premium'

test('premium plugin price units preserve two-decimal validation', () => {
  assert.equal(priceUnits('12.34'), 1234n)
  assert.equal(priceUnits('0.1'), 10n)
  assert.equal(priceUnits('0'), null)
  assert.equal(priceUnits('1.234'), null)
  assert.equal(priceUnits('abc'), null)
  assert.equal(priceText(1234n), '12.34')
  assert.equal(priceText(100n), '1.00')
})
