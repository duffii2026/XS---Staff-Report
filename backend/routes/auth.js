import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { env } from '../config/env.js';
import { authenticate, issueAccessToken, loadUserWithPerms, publicUser, revokeSession, setAuthCookies, clearAuthCookies, verifyAccessToken, touchSession } from '../services/auth.js';
import { requireUser } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';

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
          if (refresh) await touchSession(refresh).catch(() => {});
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

export default router;
