/**
 * Encryption for a business's stored WhatsApp secrets: its access token, and
 * (manual method) its own Meta app secret. T-175.
 *
 * - The key comes from WHATSAPP_ENCRYPTION_KEY and nowhere else. There is no
 *   built-in fallback key: without the setting nothing is encrypted or
 *   decrypted, and connecting is refused (it used to fall back to a key
 *   written in this file, which would have protected nothing).
 * - New values are AES-256-GCM: "v2:<iv>:<tag>:<ciphertext>", so a stored
 *   value that was altered does not decrypt. Values written before T-175 are
 *   AES-256-CBC, "<iv>:<ciphertext>", and are still read.
 * - Nothing here logs. Callers must never log a value they pass in or get back.
 */
import crypto from 'crypto'

export class WhatsAppKeyMissingError extends Error {
  constructor() {
    super('WHATSAPP_ENCRYPTION_KEY is not set')
    this.name = 'WhatsAppKeyMissingError'
  }
}

/** Is the key that protects stored WhatsApp secrets set? */
export function whatsappKeyConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ENCRYPTION_KEY)
}

// The derived key, remembered per configured value (deriving it is deliberately slow)
let derived: { from: string; key: Buffer } | null = null
function key(): Buffer {
  const configured = process.env.WHATSAPP_ENCRYPTION_KEY
  if (!configured) throw new WhatsAppKeyMissingError()
  if (!derived || derived.from !== configured) {
    // the same derivation the pre-T-175 values were written with, so they still decrypt
    derived = { from: configured, key: crypto.scryptSync(configured, 'salt', 32) }
  }
  return derived.key
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v2', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':')
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts[0] === 'v2') {
    const [, ivHex, tagHex, dataHex] = parts
    if (!ivHex || !tagHex || dataHex === undefined) throw new Error('Invalid encrypted value')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
  }
  // before T-175: AES-256-CBC, "<iv>:<ciphertext>"
  const [ivHex, dataHex] = parts
  if (!ivHex || !dataHex || parts.length !== 2) throw new Error('Invalid encrypted value')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key(), Buffer.from(ivHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}
