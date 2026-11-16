import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Reversible password encryption (AES-256-GCM).
 *
 * The client requires admins to be able to recover a user's password
 * (POST /api/users/:code/reveal-password), so one-way hashing is not an
 * option here. Authenticated encryption gives us:
 *   - confidentiality  (DB dump alone no longer exposes passwords)
 *   - integrity        (tampered ciphertext fails the GCM tag check)
 *
 * Stored format:  enc:v1:<iv-b64>:<auth-tag-b64>:<ciphertext-b64>
 * The `enc:v1:` prefix marks encrypted rows so legacy plaintext rows remain
 * detectable (and usable) until the one-time migration has run.
 */

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;          // GCM standard nonce size
const KEY_BYTES = 32;         // AES-256
const MAX_PLAINTEXT = 128;    // keeps base64 output well inside VARCHAR(255)

let _key = null;

/** Decode + validate PASSWORD_ENCRYPTION_KEY once. Fails fast on boot if unset/invalid. */
function getKey() {
  if (_key) return _key;
  const raw = env.PASSWORD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'PASSWORD_ENCRYPTION_KEY is not set. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))" ' +
      'and add it to your .env file.'
    );
  }
  const key = Buffer.from(String(raw).trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PASSWORD_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (base64), got ${key.length}.`
    );
  }
  _key = key;
  return _key;
}

/** True when a stored value is in `enc:v1:` format (vs. legacy plaintext). */
export function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

/** Encrypt a plaintext password. Throws on empty / oversized input. */
export function encryptPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('encryptPassword: password must be a non-empty string.');
  }
  if (plain.length > MAX_PLAINTEXT) {
    throw new Error(`encryptPassword: password must be at most ${MAX_PLAINTEXT} characters.`);
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}

/**
 * Decrypt a stored value back to plaintext.
 * Legacy (pre-migration) plaintext rows are returned unchanged so the
 * reveal endpoint and login keep working until the migration has run.
 */
export function decryptPassword(stored) {
  if (!stored) return '';
  if (!isEncrypted(stored)) return stored; // legacy plaintext row

  const body = stored.slice(PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptPassword: stored value is malformed.');
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error('decryptPassword: stored value is malformed.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('decryptPassword: authentication failed (wrong key or corrupted value).');
  }
}

/** Constant-time string compare that does not leak length via early return. */
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba); // burn equal time, then fail
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a plaintext password against a stored value.
 * Handles both encrypted (`enc:v1:...`) and legacy plaintext rows.
 * Returns false (never throws) for missing credentials; a corrupted
 * encrypted row also yields false so a bad key cannot be probed via login.
 */
export function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || plain.length === 0) return false;
  if (!stored) return false;
  if (!isEncrypted(stored)) return timingSafeEqualStr(plain, stored); // legacy plaintext row

  try {
    return timingSafeEqualStr(plain, decryptPassword(stored));
  } catch {
    return false;
  }
}
