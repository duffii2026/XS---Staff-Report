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

/**
 * Slide the refresh cookie's browser expiry forward without changing its value.
 * Called whenever touchSession() extends the DB session so an active user is not
 * logged out simply because the cookie was last written hours ago.
 */
export function setRefreshCookie(res, refreshToken) {
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
//
// Refresh rotation is not idempotent by nature: the first request revokes the
// old token and mints a replacement. If several requests arrive together (a
// slider save, a hydration reload, a keep-alive), the losers used to get null
// and force a logout. Remember the replacement for a short grace window so a
// concurrent caller holding the same old token receives the SAME new tokens.
const ROTATION_GRACE_MS = 15 * 1000;
const _recentRotations = new Map();

function pruneRecentRotations() {
  const cutoff = Date.now() - ROTATION_GRACE_MS;
  for (const [key, value] of _recentRotations) {
    if (value.at < cutoff) _recentRotations.delete(key);
  }
}

export async function rotateSession(rawRefreshToken, ip) {
  const hash = sha256(rawRefreshToken);

  const recent = _recentRotations.get(hash);
  if (recent) {
    if (Date.now() - recent.at <= ROTATION_GRACE_MS) {
      const recentUser = await loadUserWithPerms(recent.userCode);
      if (recentUser) {
        return {
          user: recentUser,
          accessToken: recent.accessToken,
          refreshToken: recent.refreshToken
        };
      }
    } else {
      _recentRotations.delete(hash);
    }
  }

  const session = await getOne('SELECT * FROM sessions WHERE token_hash = ?', [hash]);
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const user = await loadUserWithPerms(session.user_code);
  if (!user) return null;

  // Rotate atomically. Two concurrent requests can both read the same valid
  // refresh token; without the conditional UPDATE they would BOTH rotate it and
  // the loser would revoke the winner's session. Only the request that actually
  // flips revoked_at from NULL may mint a replacement session.
  const revoked = await insert(
    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [toMySqlDatetime(new Date()), hash]
  );
  if (!revoked?.affectedRows) return null;

  const refreshToken = await createSession(user.code, ip, session.user_agent);
  const accessToken = issueAccessToken(user);

  _recentRotations.set(hash, {
    userCode: user.code,
    accessToken,
    refreshToken,
    at: Date.now()
  });
  if (_recentRotations.size > 1000) pruneRecentRotations();

  return { user, accessToken, refreshToken };
}

export async function revokeSession(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const hash = sha256(rawRefreshToken);
  // Drop any grace-window replay entries that would otherwise hand back a
  // session after an explicit logout.
  for (const [key, value] of _recentRotations) {
    if (key === hash || value.refreshToken === rawRefreshToken) _recentRotations.delete(key);
  }
  await insert('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [toMySqlDatetime(new Date()), hash]);
}

const SESSION_TOUCH_WINDOW_MS = 60 * 1000;
const SESSION_TOUCH_CAP = 5000;
const _lastSessionTouch = new Map();

/**
 * Slide the session's idle expiry forward.
 *
 * Returns true when the DB row was actually extended, so callers can also
 * refresh the browser cookie's maxAge. Throttled to one write per minute per
 * token: an active user can issue many requests, but the session only needs to
 * move forward periodically. A session that is revoked or already expired is
 * never revived.
 */
export async function touchSession(rawRefreshToken) {
  if (!rawRefreshToken) return false;
  const hash = sha256(rawRefreshToken);
  const now = Date.now();
  const last = _lastSessionTouch.get(hash);
  if (last && now - last < SESSION_TOUCH_WINDOW_MS) return false;
  if (_lastSessionTouch.size >= SESSION_TOUCH_CAP) {
    _lastSessionTouch.clear();
  }
  _lastSessionTouch.set(hash, now);
  try {
    const result = await insert(
      `UPDATE sessions SET last_seen_at = ?, expires_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`,
      [
        toMySqlDatetime(new Date(now)),
        toMySqlDatetime(new Date(now + env.SESSION_TTL_MS)),
        hash
      ]
    );
    return (result?.affectedRows || 0) > 0;
  } catch {
    return false;
  }
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