import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { query, getOne, insert } from '../config/db.js';
import { ApiError } from '../utils/http.js';
import { mergePermissions, rowsToPermissionMap } from './permissions.js';
import { verifyPassword } from './passwordCrypto.js';

export const ACCESS_COOKIE = 'apa_access';
export const REFRESH_COOKIE = 'apa_refresh';

// ---------------------------------------------------------------
// Hashing / misc
// ---------------------------------------------------------------
export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function generateToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function toMySqlDatetime(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return v;
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE || 'lax',
    path: '/',
    maxAge: maxAgeMs
  };
}

export function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(60 * 60 * 1000)); // 1h
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(env.SESSION_TTL_MS));
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------
export function publicUser(row) {
  if (!row) return null;
  const {
    id, password_hash, is_active, created_at, updated_at,
    ...safe
  } = row;
  return safe;
}

export async function loadUserWithPerms(code) {
  const row = await getOne('SELECT * FROM users WHERE code = ?', [code]);
  if (!row) return null;
  if (!row.is_active) return null;

  const permRows = await query('SELECT permission_key, allowed FROM user_permissions WHERE user_code = ?', [code]);
  const perms = mergePermissions(row.role, rowsToPermissionMap(permRows));

  const pwdReq = await getOne('SELECT must_change_password FROM user_password_requirements WHERE user_code = ?', [code]);
  return { ...row, permissions: perms, must_change_password: pwdReq ? !!pwdReq.must_change_password : false };
}

export async function findUserByUsername(username) {
  return getOne('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
}

// ---------------------------------------------------------------
// Access token (JWT)
// ---------------------------------------------------------------
export function issueAccessToken(user) {
  const payload = {
    sub: user.code,
    role: user.role,
    username: user.username,
    iat: Math.floor(Date.now() / 1000)
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Sessions (refresh tokens)
// ---------------------------------------------------------------
export async function createSession(userCode, ip, userAgent) {
  const refreshToken = generateToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_MS);
  await insert(
    `INSERT INTO sessions (token_hash, user_code, ip_address, user_agent, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sha256(refreshToken), userCode, ip, (userAgent || '').slice(0, 250), toMySqlDatetime(expiresAt), toMySqlDatetime(new Date())]
  );
  return refreshToken;
}

// Return: { user, accessToken, refreshToken } after rotation, or null if invalid
export async function rotateSession(rawRefreshToken, ip) {
  const hash = sha256(rawRefreshToken);
  const session = await getOne('SELECT * FROM sessions WHERE token_hash = ?', [hash]);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const user = await loadUserWithPerms(session.user_code);
  if (!user) return null;

  // Rotate: revoke old, create new (tokens randomize; hash stored)
  await insert('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [toMySqlDatetime(new Date()), hash]);
  const refreshToken = await createSession(user.code, ip, session.user_agent);
  const accessToken = issueAccessToken(user);

  return { user, accessToken, refreshToken };
}

export async function revokeSession(rawRefreshToken) {
  if (!rawRefreshToken) return;
  await insert('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [toMySqlDatetime(new Date()), sha256(rawRefreshToken)]);
}

const SESSION_TOUCH_WINDOW_MS = 60 * 1000;
const SESSION_TOUCH_CAP = 5000;
const _lastSessionTouch = new Map();

export async function touchSession(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const hash = sha256(rawRefreshToken);
  const now = Date.now();
  const last = _lastSessionTouch.get(hash);
  if (last && now - last < SESSION_TOUCH_WINDOW_MS) return;
  if (_lastSessionTouch.size >= SESSION_TOUCH_CAP) {
    _lastSessionTouch.clear();
  }
  _lastSessionTouch.set(hash, now);
  await insert('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [toMySqlDatetime(new Date()), hash]).catch(() => {});
}

// ---------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------
export async function authenticate(username, password, ip, userAgent) {
  const userRow = await findUserByUsername(username);
  if (!userRow) throw new ApiError(401, 'Invalid username or password.');
  if (!userRow.is_active) throw new ApiError(403, 'Account is deactivated.');

  const passwordOk = verifyPassword(password || '', userRow.password_hash || '');
  if (!passwordOk) throw new ApiError(401, 'Invalid username or password.');

  const sessionToken = await createSession(userRow.code, ip, userAgent);
  const accessToken = issueAccessToken(userRow);
  await insert('UPDATE users SET last_login_at = ? WHERE code = ?', [toMySqlDatetime(new Date()), userRow.code]);

  const user = await loadUserWithPerms(userRow.code);
  return { user: publicUser(user), permissions: user.permissions, accessToken, sessionToken, sessionExpiresAt: new Date(Date.now() + env.SESSION_TTL_MS) };
}