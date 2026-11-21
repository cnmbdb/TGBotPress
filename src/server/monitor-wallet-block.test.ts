import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeTronAddress, parseMonitorBlock, transactionNotices, type Monitor } from './monitor-wallet-block.server'

const wallet: Monitor = {
  rid: 10, bot_rid: 2, bot_token: 'unused-in-test', monitor_wallet: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  tg_notice_obj: '10001', comments: 'test', monitor_trx_transaction: 'YY', monitor_approve_transaction: 'YY',
  monitor_multi_transaction: 'YY', monitor_pledge_transaction: 'YY', monitor_usdt_transaction: 'YY',
}
const hex = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'
const tx = 'ab'.repeat(32)

test('decodes Tron base58check addresses', () => {
  assert.equal(decodeTronAddress(hex), wallet.monitor_wallet)
  assert.equal(decodeTronAddress('bad'), null)
})

test('validates block number, timestamp, and id', () => {
  const block = parseMonitorBlock({
    blockID: tx,
    block_header: { raw_data: { number: 123, timestamp: 1_800_000_000_000 } },
    transactions: [],
  }, 123)
  assert.equal(block.number, 123)
  assert.equal(block.transactions.length, 0)
  assert.throws(() => parseMonitorBlock({
    blockID: tx, block_header: { raw_data: { number: 122, timestamp: 1 } }, transactions: [],
  }, 123), /invalid TronGrid block payload/)
})

test('queues both directions when a monitored address is both sender and receiver', async () => {
  const transfer = {
    txID: tx,
    raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { owner_address: hex, to_address: hex, amount: '2500000' } } }] },
    ret: [{ contractRet: 'SUCCESS' }],
  }
  const block = parseMonitorBlock({
    blockID: tx, block_header: { raw_data: { number: 1, timestamp: 1_800_000_000_000 } }, transactions: [transfer],
  })
  let balanceReads = 0
  const request = async () => {
    balanceReads++
    return Response.json({ withPriceTokens: [{ tokenId: '_', amount: 5 }, { tokenId: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: 2 }] })
  }
  const notices = await transactionNotices(request, block, [wallet], 'scan', 'grid')
  assert.deepEqual(notices.map(item => item.type), [1, 2])
  assert.equal(balanceReads, 1)
  assert.match(notices[0].html, /\+2\.5 TRX/)
  assert.match(notices[1].html, /-2\.5 TRX/)
})


function monitored(id: number, address = wallet.monitor_wallet, overrides: Partial<Monitor> = {}): Monitor {
  return { ...wallet, rid: id, monitor_wallet: address, ...overrides }
}
function transaction(contractType: string, value: Record<string, unknown>, id: string, contractRet = 'SUCCESS') {
  return { txID: id, raw_data: { contract: [{ type: contractType, parameter: { value } }] }, ret: [{ contractRet }] }
}
function blockWith(transactions: ReturnType<typeof transaction>[]) {
  return parseMonitorBlock({ blockID: tx, block_header: { raw_data: { number: 2, timestamp: 1_800_000_000_000 } }, transactions })
}
function uintWord(value: bigint) { return value.toString(16).padStart(64, '0') }
function addressWord(value: string) { return value.slice(2).padStart(64, '0') }

test('recognizes USDT transferFrom, grant and revoke events with their separate switches', async () => {
  const transferFrom = transaction('TriggerSmartContract', {
    contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    owner_address: hex,
    data: '23b872dd' + addressWord(hex) + addressWord(hex) + uintWord(2_000_000n),
  }, 'cd'.repeat(32))
  const revoke = transaction('TriggerSmartContract', {
    contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    owner_address: hex,
    data: '095ea7b3' + addressWord(hex) + uintWord(0n),
  }, 'ef'.repeat(32), 'REVERT')
  const request = async () => Response.json({ withPriceTokens: [] })
  const transferNotices = await transactionNotices(request, blockWith([transferFrom]), [monitored(1)], '', '')
  assert.deepEqual(transferNotices.map(item => item.type), [3, 4])
  assert.match(transferNotices[0].html, /授权转账 ↓/)
  const revokeNotices = await transactionNotices(request, blockWith([revoke]), [monitored(1, wallet.monitor_wallet, { monitor_approve_transaction: 'NY' })], '', '')
  assert.deepEqual(revokeNotices.map(item => item.type), [11, 21])
  assert.match(revokeNotices[0].html, /失败REVERT/)
})

test('recognizes delegated and undelegated resource events', async () => {
  const delegate = transaction('DelegateResourceContract', {
    owner_address: hex, receiver_address: hex, balance: '3000000', resource: 'ENERGY',
  }, '01'.repeat(32))
  const undelegate = transaction('UnDelegateResourceContract', {
    owner_address: hex, receiver_address: hex, balance: '4000000', resource: 'BANDWIDTH',
  }, '02'.repeat(32))
  const request = async () => Response.json({})
  const delegateNotices = await transactionNotices(request, blockWith([delegate]), [monitored(1)], '', '')
  const undelegateNotices = await transactionNotices(request, blockWith([undelegate]), [monitored(1)], '', '')
  assert.deepEqual(delegateNotices.map(item => item.type), [6, 7])
  assert.deepEqual(undelegateNotices.map(item => item.type), [61, 71])
})

function makeTronHex(seed: number) {
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.alloc(20, seed)])
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4)
  return payload.toString('hex')
}

test('recognizes direct and linked account permission updates', async () => {
  const otherHex = makeTronHex(17)
  const otherWallet = monitored(2, decodeTronAddress(otherHex)!)
  const transactionValue = transaction('AccountPermissionUpdateContract', {
    owner_address: otherHex,
    owner: { threshold: 1, keys: [{ address: hex, weight: 1 }] },
    actives: [{ permission_name: 'active', threshold: 1, keys: [{ address: otherHex, weight: 1 }] }],
  }, '03'.repeat(32))
  const request = async () => Response.json({})
  const notices = await transactionNotices(request, blockWith([transactionValue]), [monitored(1), otherWallet], '', '')
  assert.deepEqual(notices.map(item => item.type), [5, 51])
  assert.ok(notices.every(item => item.html.includes('阈值')))
})

test('normalizes legacy one-character flags and does not enable the second direction', async () => {
  const item = transaction('TransferContract', {
    owner_address: hex, to_address: hex, amount: '1000000',
  }, '04'.repeat(32))
  const request = async () => Response.json({ withPriceTokens: [] })
  const notices = await transactionNotices(request, blockWith([item]), [monitored(1, wallet.monitor_wallet, { monitor_trx_transaction: 'Y ' })], '', '')
  assert.deepEqual(notices.map(notice => notice.type), [1])
})

