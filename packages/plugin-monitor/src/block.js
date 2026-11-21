import { createHash } from 'node:crypto'
const BASE58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function decodeTronAddress(hex){if(typeof hex!=='string'||!/^[a-fA-F0-9]{42}$/.test(hex)||!hex.toLowerCase().startsWith('41'))return null;const payload=Buffer.from(hex,'hex'),checksum=createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0,4),bytes=Buffer.concat([payload,checksum]);let number=BigInt('0x'+bytes.toString('hex')),encoded='';while(number>0n){encoded=BASE58[Number(number%58n)]+encoded;number/=58n}for(const byte of bytes){if(byte!==0)break;encoded='1'+encoded}return encoded}
export function parseMonitorBlock(payload, expected) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid TronGrid block response')
  const header = payload.block_header && typeof payload.block_header === 'object' ? payload.block_header : null
  const raw = header && typeof header.raw_data === 'object' ? header.raw_data : null
  const number = raw?.number, timestamp = raw?.timestamp, id = payload.blockID
  if (!Number.isSafeInteger(number) || number < 0 || !Number.isSafeInteger(timestamp) || timestamp < 0 || typeof id !== 'string' || !/^[a-fA-F0-9]{64}$/.test(id) || (expected !== undefined && number !== expected) || (payload.transactions !== undefined && !Array.isArray(payload.transactions))) throw new Error('invalid TronGrid block payload')
  return { number, id: id.toLowerCase(), timestamp, transactions: (Array.isArray(payload.transactions) ? payload.transactions : []).filter(v=>v && typeof v === 'object' && !Array.isArray(v)) }
}
