import { createHash, timingSafeEqual } from 'node:crypto';

// Drupal 7 format: https://api.drupal.org/api/drupal/includes%21password.inc/function/_password_crypt/7.x
// Only the explicitly tagged imported scheme is accepted; native passwords remain scrypt.
export async function verifyDrupal7(secret, stored) {
  const alphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') > 512
    || !/^\$S\$[./0-9A-Za-z]{52}$/.test(stored || '')) return false;
  const countLog = alphabet.indexOf(stored[3]);
  if (countLog < 7 || countLog > 20) return false;
  const password = Buffer.from(secret, 'utf8');
  let digest = createHash('sha512').update(stored.slice(4, 12)).update(password).digest();
  for (let i = 0; i < 2 ** countLog; i++) {
    digest = createHash('sha512').update(digest).update(password).digest();
    if ((i & 2047) === 2047) await new Promise(setImmediate);
  }
  let encoded = '', bits = 0, value = 0;
  for (const byte of digest) {
    value |= byte << bits;
    bits += 8;
    while (bits >= 6) { encoded += alphabet[value & 63]; value >>>= 6; bits -= 6; }
  }
  if (bits) encoded += alphabet[value & 63];
  const actual = (stored.slice(0, 12) + encoded).slice(0, 55);
  return timingSafeEqual(Buffer.from(actual), Buffer.from(stored));
}
