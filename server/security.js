import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";
import { verifyDrupal7 } from './legacy-password.js';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export function createSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

// Session and activation tokens are 256-bit random values, so a fast digest is safe to store and
// lets the server find the row with one indexed lookup. Passwords must keep using hashSecret (scrypt).
export function digestToken(token) {
  return createHash("sha256").update(String(token)).digest("base64url");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Returns a list of problems; empty means the password is acceptable.
export function passwordProblems(password, email = "") {
  const problems = [];
  const value = String(password || "");
  if (value.length < 12) {
    problems.push("use at least 12 characters");
  }
  if (value.length > 256) {
    problems.push("use at most 256 characters");
  }
  const localPart = normalizeEmail(email).split("@")[0];
  if (localPart.length >= 4 && value.toLowerCase().includes(localPart)) {
    problems.push("do not include your email name");
  }
  if (new Set(value).size < 5) {
    problems.push("use a wider mix of characters");
  }
  return problems;
}

export async function hashSecret(secret, salt = createSecret(16)) {
  const derived = await scrypt(secret, salt, keyLength);
  return {
    hash: derived.toString("base64url"),
    salt
  };
}

export async function verifySecret(secret, expectedHash, salt) {
  if (salt === 'legacy-drupal7') return verifyDrupal7(secret, expectedHash);
  // An explicit import marker separates legacy MD5 passwords from native scrypt credentials.
  if (salt === 'legacy-md5') {
    if (typeof secret !== 'string' || !/^[a-f0-9]{32}$/i.test(expectedHash || '')) return false;
    const actual = createHash('md5').update(secret, 'utf8').digest();
    return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'));
  }
  const derived = await scrypt(secret, salt, keyLength);
  const expected = Buffer.from(expectedHash, "base64url");

  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}

// --- Encryption at rest for small secrets (e.g. TOTP seeds): AES-256-GCM, versioned envelope. ---

export function encryptSecret(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope, key) {
  const [version, iv, tag, ciphertext] = String(envelope).split(".");
  if (version !== "v1") {
    throw new Error(`Unsupported secret envelope ${version}.`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

// --- TOTP (RFC 6238 over RFC 4226 HOTP, SHA-1, 6 digits, 30-second steps) ---

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const totpStepSeconds = 30;

export function createTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid base32 character.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpStep(timeMs = Date.now()) {
  return Math.floor(timeMs / 1000 / totpStepSeconds);
}

export function hotp(secretBase32, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export function totp(secretBase32, timeMs = Date.now()) {
  return hotp(secretBase32, totpStep(timeMs));
}

// Returns the matching time step (allowing one step of clock drift either way), or null.
export function matchTotp(secretBase32, code, timeMs = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) {
    return null;
  }
  const current = totpStep(timeMs);
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(String(code)))) {
      return step;
    }
  }
  return null;
}
