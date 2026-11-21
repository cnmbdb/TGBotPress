import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectionWalletAddressIsValid,
  collectionWalletSweepPlan,
  syncCollectionWallets,
} from './collection-wallet-worker.server'

test('TRX sweep keeps the configured reserve and legacy 1.5 TRX fee buffer in exact units', () => {
  assert.deepEqual(collectionWalletSweepPlan({ coin: 'trx', balance: '20.000001', threshold: '10', reserve: '2' }), {
    coin: 'trx', amount: 16_500_001n,
  })
  assert.equal(collectionWalletSweepPlan({ coin: 'trx', balance: '10', threshold: '1.5', reserve: '0' }), null)
})

test('USDT sweep subtracts its reserve without floating point rounding', () => {
  assert.deepEqual(collectionWalletSweepPlan({ coin: 'usdt', balance: '100.000009', threshold: '80', reserve: '2.000001' }), {
    coin: 'usdt', amount: 98_000_008n,
  })
  assert.equal(collectionWalletSweepPlan({ coin: 'usdt', balance: '100', threshold: '10', reserve: '10' }), null)
})

test('Tron address validation verifies the Base58Check checksum', () => {
  assert.equal(collectionWalletAddressIsValid('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), true)
  assert.equal(collectionWalletAddressIsValid('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), false)
  assert.equal(collectionWalletAddressIsValid('not-an-address'), false)
})

test('collection wallet actions are disabled without making database or network calls', async () => {
  const oldAction = process.env.PLATFORM_COLLECTION_WALLET_ACTIONS
  const oldTelegram = process.env.PLATFORM_TELEGRAM_ACTIONS
  delete process.env.PLATFORM_COLLECTION_WALLET_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  let touched = false
  try {
    const result = await syncCollectionWallets({
      pool: { query: async () => { touched = true; throw new Error('unexpected database access') }, connect: async () => { touched = true; throw new Error('unexpected database access') } },
      fetcher: async () => { touched = true; throw new Error('unexpected network access') },
      logger: { error() {}, info() {} },
    })
    assert.equal(result.skipped, true)
    assert.equal(touched, false)
  } finally {
    if (oldAction === undefined) delete process.env.PLATFORM_COLLECTION_WALLET_ACTIONS
    else process.env.PLATFORM_COLLECTION_WALLET_ACTIONS = oldAction
    if (oldTelegram === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = oldTelegram
  }
})
