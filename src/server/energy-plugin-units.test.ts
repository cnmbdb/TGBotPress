import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decimalUnits } from '@tgbotpress/plugin-energy/units.js'
import { energyWalletStartTimestamp } from '@tgbotpress/plugin-energy/poll.js'

test('energy plugin pure units and polling helpers preserve host semantics', () => {
  assert.equal(decimalUnits('2500000'), '2.5')
  assert.equal(decimalUnits('1000000'), '1')
  assert.equal(energyWalletStartTimestamp('1770000000000', '2026-02-02 00:00:00'), '1770000000000')
  assert.equal(energyWalletStartTimestamp(null, '2026-02-02 00:00:00'), String(new Date('2026-02-02T00:00:00+08:00').getTime() - 10))
})
