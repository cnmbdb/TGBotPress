import { constants, createPublicKey, publicEncrypt } from 'node:crypto'

export function encryptPrivateKey(value, publicKeyPem) {
  const key = createPublicKey(publicKeyPem)
  const bits = key.asymmetricKeyDetails?.modulusLength
  if (!bits || bits < 2048 || bits % 8 !== 0) throw new Error('RSA_PUBLIC_KEY_INVALID')
  const maxPart = bits / 8 - 42
  const data = Buffer.from(value, 'utf8')
  const encrypted = []
  for (let offset = 0; offset < data.length; offset += maxPart) encrypted.push(publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, data.subarray(offset, offset + maxPart)))
  const cipher = `v2:${Buffer.concat(encrypted).toString('base64')}`
  if (cipher.length > 2000) throw new RangeError('PRIVATE_KEY_TOO_LONG')
  return cipher
}
