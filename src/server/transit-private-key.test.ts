import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { test } from 'node:test'
import { encryptPrivateKey } from '@tgbotpress/plugin-transit/private-key.js'

test('transit private-key encryption uses OAEP and supports long values', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const value = 'private-key-' + 'x'.repeat(900)
  const encrypted = encryptPrivateKey(value, publicKey)
  assert.match(encrypted, /^v2:/)
  const payload = Buffer.from(encrypted.slice(3), 'base64')
  const chunkSize = 256
  const decoded = Buffer.concat(Array.from({ length: Math.ceil(payload.length / chunkSize) }, (_, index) => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, payload.subarray(index * chunkSize, (index + 1) * chunkSize))))
  assert.equal(decoded.toString(), value)
})

test('transit private-key encryption rejects weak keys', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 1024 })
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  assert.throws(() => encryptPrivateKey('secret', publicKey), /RSA_PUBLIC_KEY_INVALID/)
})
