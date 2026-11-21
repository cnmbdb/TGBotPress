import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatUnits, units } from '@tgbotpress/plugin-transit/units.js'

test('transit wallet units preserve four-decimal money semantics', () => {
  assert.equal(units('12.3456'), 123456n)
  assert.equal(units('12.34567'), null)
  assert.equal(units('123456789012.0001'), 1234567890120001n)
  assert.equal(units('1234567890123'), null)
  assert.equal(formatUnits(123456n), '12.3456')
  assert.equal(formatUnits(120000n), '12')
})
