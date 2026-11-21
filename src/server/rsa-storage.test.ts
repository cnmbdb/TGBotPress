import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { encryptRsaV2 } from './rsa-storage.server'

test('RSA v2 storage output round-trips with the Job OAEP-SHA1 decrypt contract', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const secret = 'TRON private key test fixture — must never be logged'
  const ciphertext = encryptRsaV2(secret, publicKey)
  assert.match(ciphertext, /^v2:/)
  assert.doesNotMatch(ciphertext, /TRON private key test fixture/)
  const decrypted = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(ciphertext.slice(3), 'base64'))
  assert.equal(decrypted.toString('utf8'), secret)
})

test('RSA v2 storage enforces the legacy column limit and RSA key strength', () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  assert.throws(() => encryptRsaV2('secret', publicKey, 100), RangeError)
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
  assert.throws(() => encryptRsaV2('secret', weak), /RSA_PUBLIC_KEY_INVALID/)
})
