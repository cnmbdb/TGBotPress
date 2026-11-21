import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'node:crypto'

/** Encrypt a secret using the PHP/Job RSA v2 storage contract (OAEP-SHA1, blockwise, v2:base64). */
export function encryptRsaV2(value: string, publicKeyInput: KeyObject | string, maxStoredLength = 2000) {
  const key = typeof publicKeyInput === 'string' ? createPublicKey(publicKeyInput) : publicKeyInput
  const bits = key.asymmetricKeyDetails?.modulusLength
  if (!bits || bits < 2048 || bits % 8 !== 0) throw new Error('RSA_PUBLIC_KEY_INVALID')
  const modulusBytes = bits / 8
  const maxPart = modulusBytes - 42
  const data = Buffer.from(value, 'utf8')
  if (!data.length) throw new RangeError('SECRET_EMPTY')
  const chunks = Math.ceil(data.length / maxPart)
  const encodedLength = 3 + 4 * Math.ceil((chunks * modulusBytes) / 3)
  if (encodedLength > maxStoredLength) throw new RangeError('SECRET_TOO_LARGE')
  const encrypted: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += maxPart) {
    encrypted.push(publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, data.subarray(offset, offset + maxPart)))
  }
  return `v2:${Buffer.concat(encrypted).toString('base64')}`
}
