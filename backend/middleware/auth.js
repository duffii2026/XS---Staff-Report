import { ApiError, asyncHandler } from '../utils/http.js';
import {
  ACCESS_COOKIE, REFRESH_COOKIE,
  verifyAccessToken, loadUserWithPerms, publicUser,
  rotateSession, revokeSession, touchSession,
  setAuthCookies, setRefreshCookie, clearAuthCookies
} from '../services/auth.js';
import { validateApiKey } from '../services/apiKey.js';

/**
 * Attach the authenticated actor to req.user (or req.apikey).
 * Order:
 *   1. X-API-Key header  -> api-key auth (server-to-server)
 *   2. apa_access cookie  -> JWT auth
 *   3. apa_refresh cookie -> rotate -> reissue access (session auth)
 * Whitelisted public paths skip this middleware entirely.
 */
export const requireUser = asyncHandler(async (req, res, next) => {
  // 1) API key
  const rawKey = req.headers['x-api-key'];
  if (rawKey) {
    const keyRow = await validateApiKey(rawKey);
    if (!keyRow) throw new ApiError(401, 'Invalid or inactive API key.');
    const user = await loadUserWithPerms(keyRow.user_code);
    if (!user) throw new ApiError(403, 'API key owner account is not active.');
    req.user = { ...user, authType: 'apikey', apiKeyScopes: keyRow.scopes };
    req.apikey = keyRow;
    return next();
  }

  // 2) Access token cookie
  const access = req.cookies?.[ACCESS_COOKIE];
  const refresh = req.cookies?.[REFRESH_COOKIE];

  if (access) {
    const payload = verifyAccessToken(access);
    if (payload?.sub) {
      const user = await loadUserWithPerms(payload.sub);
      if (user) {
        req.user = { ...user, authType: 'cookie', jwtExp: payload.exp };
        if (refresh) {
          // Sliding idle session: activity extends both the DB expiry and the
          // refresh cookie's browser expiry.
          const touched = await touchSession(refresh);
          if (touched) setRefreshCookie(res, refresh);
        }
        return next();
      }
    }
  }

  // 3) Refresh cookie -> rotate session (silent reissue)
  if (refresh) {
    const rotated = await rotateSession(refresh, req.ip);
    if (rotated) {
      setAuthCookies(res, rotated.accessToken, rotated.refreshToken);
      req.user = { ...rotated.user, authType: 'cookie', refreshed: true };
      return next();
    }
    // A refresh cookie exists but could not be rotated. This is normally the
    // loser of a concurrent-rotation race (another request already rotated the
    // same token). Clearing cookies here would delete the winner's fresh
    // cookies and force a logout, so leave them intact: the client refreshes
    // and retries the request once.
    throw new ApiError(401, 'Not authenticated. Please sign in.');
  }

  clearAuthCookies(res);
  throw new ApiError(401, 'Not authenticated. Please sign in.');
});

/** Roles allowed to prepare/sign a staff appraisal. `evaluatePerformance` is no
 *  longer an admin-toggleable feature flag, so it is authorised by role here. */
const APPRAISAL_SIGNER_ROLES = ['manager', 'executive', 'hr'];

/** Require a specific permission key from the 8-key matrix. Admin always passes. */
export const requirePermission = (key) =>
  asyncHandler(async (req, res, next) => {
    const user = req.user;
    if (!user) throw new ApiError(401, 'Not authenticated.');
    if (user.role === 'admin') return next();
    if (key === 'evaluatePerformance') {
      if (APPRAISAL_SIGNER_ROLES.includes(user.role)) return next();
      throw new ApiError(403, 'Access denied. Only superiors can sign appraisals.');
    }
    if (user.permissions?.[key]) return next();
    throw new ApiError(403, `Access denied. Missing permission: ${key}.`);
  });

/** Require one of the given roles. */
export const requireRole = (roles) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new ApiError(401, 'Not authenticated.');
    if (roles.includes(req.user.role)) return next();
    throw new ApiError(403, 'Access denied for your role.');
  });

/** Gate endpoints to the caller's own resource (self-service) or admin/executive. */
export const requireSelfOrSuperior = (paramName = 'code') =>
  asyncHandler(async (req, res, next) => {
    const target = req.params?.[paramName] || req.body?.[paramName];
    const user = req.user;
    if (['admin', 'executive', 'hr'].includes(user.role)) return next();
    if (target && (target === user.code)) return next();
    const { canAccessUser } = await import('../services/scoping.js');
    if (target && await canAccessUser(user, target)) return next();
    throw new ApiError(403, 'You can only access your own data.');
  });

export { REFRESH_COOKIE, ACCESS_COOKIE, publicUser, revokeSession };