import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, verifySecret } from '../server/security.js';

test('imported MD5 passwords require the explicit legacy scheme and exact password', async () => {
  const digest = '5f4dcc3b5aa765d61d8327deb882cf99';
  assert.equal(await verifySecret('password', digest, 'legacy-md5'), true);
  assert.equal(await verifySecret('Password', digest, 'legacy-md5'), false);
  assert.equal(await verifySecret('password', 'invalid', 'legacy-md5'), false);
  assert.equal(await verifySecret('password', digest, 'ordinary-scrypt-salt'), false);
});

test('Drupal 7 source format agrees with an independently generated SHA512 fixture', async () => {
  // Fixture generated independently with Python hashlib and little-endian integer base64 encoding.
  const digest = '$S$512345678I7oigd1j75cyE.V.Z/uu5C5XCTJ2GE9ZR5iyc9fGQD3';
  assert.equal(await verifySecret('Continuity-Fixture-2026', digest, 'legacy-drupal7'), true);
  assert.equal(await verifySecret('wrong-password', digest, 'legacy-drupal7'), false);
  assert.equal(await verifySecret('Continuity-Fixture-2026', digest.slice(1), 'legacy-drupal7'), false);
  assert.equal(await verifySecret('x'.repeat(513), digest, 'legacy-drupal7'), false);
});

test('native scrypt and new password storage remain compatible', async () => {
  const password = await hashSecret('Native-Password-2026!');
  assert.equal(await verifySecret('Native-Password-2026!', password.hash, password.salt), true);
  assert.equal(await verifySecret('incorrect', password.hash, password.salt), false);
});
