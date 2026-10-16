import { hkdfSync } from 'node:crypto';

// Purpose-specific signing keys derived from SVU_DATA_KEY, so features never share one key and no new secret is needed.
export function deriveKey(dataEncryptionKey, purpose) {
  if (!Buffer.isBuffer(dataEncryptionKey) || dataEncryptionKey.length !== 32) throw new Error(`The ${purpose} feature needs the data encryption key.`);
  return Buffer.from(hkdfSync('sha256', dataEncryptionKey, Buffer.alloc(0), Buffer.from(`svu-${purpose}-v1`), 32));
}
