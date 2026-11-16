import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { env } from '../config/env.js';
import { authenticate, createSession, issueAccessToken, loadUserWithPerms, publicUser, revokeSession, setAuthCookies, setRefreshCookie, clearAuthCookies, verifyAccessToken, touchSession } from '../services/auth.js';
import { requireUser } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { query, getOne } from '../config/db.js';

const router = Router();

// ---------------------------------------------------------------
// Public
// ---------------------------------------------------------------

/** POST /api/auth/login */
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new ApiError(400, 'Username and password are required.');

  const result = await authenticate(username, password, req.ip, req.headers['user-agent']);
  setAuthCookies(res, result.accessToken, result.sessionToken);

  await logActivity(
    { code: result.user.code, username: result.user.username, role: result.user.role },
    { action: 'LOGIN', details: `User signed in (${username})`, req }
  );
  ok(res, {
    user: result.user,
    permissions: result.permissions,
    sessionExpiresAt: result.sessionExpiresAt
  });
}));

/**
 * GET /api/auth/session — global route (no auth required).
 * Restores the current session from cookies, or returns a guest payload
 * so the frontend boot can always resolve the login state without 401s.
 */
router.get('/session', asyncHandler(async (req, res) => {
  const guest = () => ok(res, { user: null, permissions: {} });

  const access = req.cookies?.['apa_access'];
  const refresh = req.cookies?.['apa_refresh'];

  if (access) {
    try {
      const payload = verifyAccessToken(access);
      if (payload?.sub) {
        const user = await loadUserWithPerms(payload.sub);
        if (user) {
          if (refresh) {
            const touched = await touchSession(refresh).catch(() => false);
            if (touched) setRefreshCookie(res, refresh);
          }
          return ok(res, {
            user: publicUser(user),
            permissions: user.permissions,
            refreshed: false
          });
        }
      }
    } catch { /* fall through to refresh rotation / guest */ }
  }

  if (refresh) {
    const { rotateSession } = await import('../services/auth.js');
    const rotated = await rotateSession(refresh, req.ip);
    if (rotated) {
      setAuthCookies(res, rotated.accessToken, rotated.refreshToken);
      return ok(res, {
        user: publicUser(rotated.user),
        permissions: rotated.user.permissions,
        refreshed: true
      });
    }
  }

  return guest();
}));

/** POST /api/auth/refresh — rotate session when access token expired */
router.post('/refresh', asyncHandler(async (req, res) => {
  const refresh = req.cookies?.['apa_refresh'];
  if (!refresh) throw new ApiError(401, 'No session to refresh.');

  const { rotateSession } = await import('../services/auth.js');
  const rotated = await rotateSession(refresh, req.ip);
  if (!rotated) throw new ApiError(401, 'Session expired. Please sign in again.');

  setAuthCookies(res, rotated.accessToken, rotated.refreshToken);
  ok(res, {
    user: publicUser(rotated.user),
    permissions: rotated.user.permissions,
    sessionExpiresAt: new Date(Date.now() + env.SESSION_TTL_MS)
  });
}));

// ---------------------------------------------------------------
// Private (requireUser)
// ---------------------------------------------------------------

/** POST /api/auth/logout — revoke current refresh session */
router.post('/logout', requireUser, asyncHandler(async (req, res) => {
  await revokeSession(req.cookies?.['apa_refresh']);
  clearAuthCookies(res);
  await logActivity(req.user, { action: 'LOGOUT', details: 'User signed out', req }).catch(() => {});
  ok(res, { revoked: true });
}));

/** POST /api/auth/self-rotate-test helper (kept minimal) */
router.post('/check', requireUser, asyncHandler(async (req, res) => {
  ok(res, { valid: true, user: publicUser(req.user) });
}));

/** POST /api/auth/sso/validate-launch — verify app-manager SSO launch token and create local session */
let jwksCache = null;
function getJWKS() {
  if (!jwksCache) {
    const appManagerUrl = process.env.APP_MANAGER_URL || 'http://localhost:4000';
    jwksCache = createRemoteJWKSet(new URL(`${appManagerUrl}/api/auth/.well-known/jwks.json`));
  }
  return jwksCache;
}

router.post('/sso/validate-launch', asyncHandler(async (req, res) => {
  const { token: launchToken, returnTo } = req.body || {};
  if (!launchToken) throw new ApiError(400, 'Token is required.');

  let payload;
  try {
    const { payload: verified } = await jwtVerify(launchToken, getJWKS(), {
      issuer: env.JWT_ISSUER || 'app-manager',
      audience: env.JWT_AUDIENCE || 'apa-apps'
    });
    payload = verified;
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired launch token.');
  }

  if (payload.targetAppId !== 'apa_staff_report') {
    throw new ApiError(403, 'Token not intended for this application.');
  }

  const email = payload.email;
  const username = payload.username;

  // Prefer the verified email as the stable SSO identity. A single OR query
  // could return a different account when this username belongs to another
  // local user, silently signing the person into that account.
  let row = email
    ? await getOne(`SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`, [email])
    : null;
  if (!row && username) {
    const usernameMatch = await getOne(`SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`, [username]);
    // A username may be used as a fallback only for an account without an
    // email identity. If it is attached to another email, fail closed.
    if (usernameMatch && (!email || !usernameMatch.email)) {
      row = usernameMatch;
    } else if (usernameMatch && email) {
      throw new ApiError(409, 'This SSO identity does not match the existing account. Contact an administrator.');
    }
  }

  if (!row) {
    // Provision new user via SSO
    const { nanoid } = await import('nanoid');
    const userCode = nanoid(12);
    // Only the signed global-admin claim may provision an administrator.
    // The module-level role comes from the launch request and is not trusted
    // here; all other SSO users start with the least-privileged role.
    const systemRole = payload.role === 'admin' ? 'admin' : 'staff';
    await query(
      `INSERT INTO users (code, username, email, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [userCode, username, email, '', systemRole]
    );
    // SSO-provisioned users are NOT forced to change password
    await query(
      `INSERT INTO user_password_requirements (user_code, must_change_password, reason, created_at, updated_at)
       VALUES (?, 0, 'sso', NOW(), NOW())`,
      [userCode]
    );
    row = await getOne(`SELECT * FROM users WHERE code = ?`, [userCode]);
  } else {
    // Keep the Staff Report role authoritative locally. The launcher's
    // module-level role can be stale or generic (for example "staff") and
    // must never downgrade or elevate an existing local account at sign-in.
    // A signed global-admin claim is authoritative and repairs an account
    // previously downgraded by the old module-role sync behavior.
    if (payload.role === 'admin' && row.role !== 'admin') {
      await query(`UPDATE users SET role = 'admin', updated_at = NOW() WHERE code = ?`, [row.code]);
      row.role = 'admin';
    }

    // Sync position/department from SSO payload: check position first, fall back to department
    const newPosition = payload.position || null;
    const newDepartment = payload.department || null;
    const posUpdates = [];
    const posValues = [];
    if (newPosition !== null && newPosition !== row.position) {
      posUpdates.push('position = ?');
      posValues.push(newPosition);
    } else if (newPosition === null && newDepartment !== null && newDepartment !== row.department) {
      posUpdates.push('department = ?');
      posValues.push(newDepartment);
    }
    if (posUpdates.length > 0) {
      await query(`UPDATE users SET ${posUpdates.join(', ')}, updated_at = NOW() WHERE code = ?`, [...posValues, row.code]);
    }
  }

  if (!row || !row.is_active) {
    throw new ApiError(403, 'Account is inactive or not found.');
  }

  // SSO logins are authenticated by app-manager, so a local password change is
  // never required. Clear any pending first-login / admin-reset requirement.
  await query(
    `INSERT INTO user_password_requirements (user_code, must_change_password, reason, created_at, updated_at)
     VALUES (?, 0, 'sso', NOW(), NOW())
     ON DUPLICATE KEY UPDATE must_change_password = 0`,
    [row.code]
  );

  const user = await loadUserWithPerms(row.code);
  const sessionToken = await createSession(row.code, req.ip, req.headers['user-agent']);
  const accessToken = issueAccessToken(user);
  setAuthCookies(res, accessToken, sessionToken);

  await logActivity(
    { code: row.code, username: row.username, role: row.role },
    { action: 'SSO_LOGIN', details: `User signed in via app-manager SSO (${email})`, req }
  );

  ok(res, {
    user: publicUser(user),
    permissions: user.permissions,
    returnTo: returnTo || '/'
  });
}));

export default router;
