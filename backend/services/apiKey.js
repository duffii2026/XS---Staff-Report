import crypto from 'crypto';
import { query, getOne } from '../config/db.js';
import { sha256 } from './auth.js';

export function generateApiKey(name = 'api') {
  return `apa_k_${crypto.randomBytes(28).toString('base64url')}`;
}

export async function createApiKey(userCode, name, scopes = ['*'], expiresAt = null) {
  const raw = generateApiKey(name);
  await query(
    `INSERT INTO api_keys (key_hash, user_code, name, scopes, expires_at, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [sha256(raw), userCode, name, JSON.stringify(scopes), expiresAt]
  );
  return { key: raw, name, scopes };
}

export async function validateApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const row = await getOne('SELECT * FROM api_keys WHERE key_hash = ?', [sha256(rawKey.trim())]);
  if (!row || !row.is_active) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  await query('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]).catch(() => {});
  return row;
}

export async function listApiKeys(userCode) {
  return query(
    `SELECT code = '' AS expr, id, name, scopes, last_used_at, expires_at, is_active, created_at
     FROM api_keys WHERE user_code = ? ORDER BY created_at DESC`,
    [userCode]
  );
}

export async function deleteApiKey(id, userCode) {
  await query('DELETE FROM api_keys WHERE id = ? AND user_code = ?', [id, userCode]);
}