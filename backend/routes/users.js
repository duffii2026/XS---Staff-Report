import { Router } from 'express';
import { nanoid } from 'nanoid';
import rateLimit from 'express-rate-limit';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne, insert, bulkInsert } from '../config/db.js';
import { requireUser, requirePermission, requireRole } from '../middleware/auth.js';
import { loadUserWithPerms, publicUser, sha256 } from '../services/auth.js';
import { encryptPassword, decryptPassword, verifyPassword } from '../services/passwordCrypto.js';
import { logActivity, notifyUser, makeCode } from '../services/audit.js';
import { ROLE_DEFAULT_PERMISSIONS, PERMISSION_KEYS, mergePermissions, rowsToPermissionMap } from '../services/permissions.js';

const router = Router();

/** Credential re-auth is a password oracle if unthrottled — cap the attempts. */
const revealPwLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, status: 429, message: 'Too many attempts. Wait a minute before trying again.' }
});

/** Constant-time comparison lives in services/passwordCrypto.js (verifyPassword). */

function slugifyUsername(u) {
  return String(u || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

/** Validate password policy: 8+ chars, uppercase + lowercase + number + special symbol. Returns an error message or null. */
function validatePasswordStrength(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain at least one special symbol.';
  return null;
}

/** GET /api/users — list users. admin/executive: all; manager+: own team only. */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  let rows = [];
  if (['admin', 'executive', 'hr'].includes(actor.role)) {
rows = await query(`
      SELECT u.*,
        (SELECT name FROM users s WHERE s.code = u.superior_id) AS superior_name,
        (SELECT COUNT(*) FROM users x WHERE x.superior_id = u.code) AS direct_reports
      FROM users u
      WHERE u.is_active = 1
      ORDER BY u.role, u.name`);
  } else {
    // manager: self + direct team (recursive not needed for org chart below manager level, but include deep for safety)
    const subs = await (await import('../services/scoping.js')).getSubordinateCodes(actor.code);
    const ids = [actor.code, ...subs];
rows = await query(
      `SELECT u.*,
        (SELECT name FROM users s WHERE s.code = u.superior_id) AS superior_name,
        (SELECT COUNT(*) FROM users x WHERE x.superior_id = u.code) AS direct_reports
       FROM users u WHERE u.code IN (${ids.map(() => '?').join(',')}) AND u.is_active = 1
       ORDER BY u.role, u.name`, ids);
  }

  // Attach each user's effective permissions (role-default matrix merged with stored overrides)
  const permsByUser = {};
  if (rows.length) {
    const permRows = await query(
      `SELECT user_code, permission_key, allowed FROM user_permissions WHERE user_code IN (${rows.map(() => '?').join(',')})`,
      rows.map((r) => r.code)
    );
    for (const p of permRows) {
      if (!permsByUser[p.user_code]) permsByUser[p.user_code] = {};
      permsByUser[p.user_code][p.permission_key] = !!p.allowed;
    }
  }
  ok(res, rows.map((r) => ({
    ...publicUser(r),
    permissions: mergePermissions(r.role, permsByUser[r.code] || {})
  })));
}));

/** GET /api/users/me */
router.get('/me', requireUser, asyncHandler(async (req, res) => {
  const user = await loadUserWithPerms(req.user.code);
  ok(res, { user: publicUser(user), permissions: user.permissions });
}));

/** GET /api/users/:code/onboarding — onboarding status for a user */
router.get('/:code/onboarding', requireUser, asyncHandler(async (req, res) => {
  const target = req.params.code;
  const actor = req.user;
  if (!['admin', 'executive', 'hr'].includes(actor.role) && target !== actor.code && !(await (await import('../services/scoping.js')).canAccessUser(actor, target))) {
    throw new ApiError(403, 'No access to this user.');
  }
  const row = await getOne('SELECT code, onboarding FROM users WHERE code = ?', [target]);
  if (!row) throw new ApiError(404, 'User not found.');
  let onboarding = row.onboarding;
  try { onboarding = onboarding && typeof onboarding === 'string' ? JSON.parse(onboarding) : onboarding; } catch { onboarding = null; }
  ok(res, { code: target, onboarding: onboarding || {} });
}));

/** PUT /api/users/:code/onboarding — update onboarding steps / dismissal */
router.put('/:code/onboarding', requireUser, asyncHandler(async (req, res) => {
  const target = req.params.code;
  const actor = req.user;
  if (target !== actor.code && !['admin', 'executive', 'hr'].includes(actor.role)) {
    throw new ApiError(403, 'Only self or admins may update onboarding.');
  }
  const row = await getOne('SELECT code, onboarding FROM users WHERE code = ?', [target]);
  if (!row) throw new ApiError(404, 'User not found.');

  let current = {};
  try { current = row.onboarding && typeof row.onboarding === 'string' ? JSON.parse(row.onboarding) : row.onboarding || {}; } catch { current = {}; }

  const b = req.body || {};
  if (b.step && typeof b.value === 'boolean') {
    current[b.step] = b.value;
  } else {
    // full/partial object merge (dismissedAt, telegramConnected, etc.)
    for (const k of ['dismissedAt', 'jdReviewed', 'telegramConnected', 'firstReportSubmitted', 'completed']) {
      if (b[k] !== undefined) current[k] = b[k];
    }
  }
  current.completed = !!(current.telegramConnected && current.jdReviewed && current.firstReportSubmitted);

  await query('UPDATE users SET onboarding = ? WHERE code = ?', [JSON.stringify(current), target]);
  await logActivity(actor, { action: 'ONBOARDING_UPDATE', details: `Updated onboarding for ${target}`, req });
  ok(res, { code: target, onboarding: current });
}));

/** GET /api/users/:code — single user (self or within scope) */
router.get('/:code', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const target = req.params.code;
  const { canAccessUser } = await import('../services/scoping.js');
  if (!(await canAccessUser(actor, target))) throw new ApiError(403, 'You can only view your own or subordinate data.');
  const user = await getOne(`
    SELECT u.*,
      (SELECT name FROM users s WHERE s.code = u.superior_id) AS superior_name
    FROM users u WHERE u.code = ?`, [target]);
  if (!user) throw new ApiError(404, 'User not found.');
  ok(res, publicUser(user));
}));

/** POST /api/users — create user */
router.post('/', requireUser, requirePermission('manageUsers'), asyncHandler(async (req, res) => {
  const { username, name, email = '', role = 'staff', department = '', position = '', superior_id = null, password, avatar_url = null } = req.body || {};

  if (!username || !name || !role) throw new ApiError(400, 'username, name and role are required.');
  const cleaned = slugifyUsername(username);
  if (!cleaned) throw new ApiError(400, 'Invalid username.');

  const dup = await getOne('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [cleaned]);
  if (dup) throw new ApiError(409, `Username "${cleaned}" already exists.`);

const finalRole = ['admin', 'hr', 'executive', 'manager', 'staff'].includes(role) ? role : 'staff';
  if (password && password.length < 6) throw new ApiError(400, 'Temporary password must be at least 6 characters.');
  if (password && password.length > 128) throw new ApiError(400, 'Temporary password must be at most 128 characters.');
const plainPassword = password || null;
  const code = `user_${cleaned}`;

  await insert(
    `INSERT INTO users (code, username, password_hash, name, email, role, department, position, superior_id, avatar_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, cleaned, plainPassword ? encryptPassword(plainPassword) : null, name, email, finalRole, department, position, superior_id || null, avatar_url]
  );

// seed full permission matrix from role default
  const defaults = ROLE_DEFAULT_PERMISSIONS[finalRole] || {};
  await bulkInsert('user_permissions', ['user_code', 'permission_key', 'allowed'],
    PERMISSION_KEYS.map((k) => ({ user_code: code, permission_key: k, allowed: defaults[k] ? 1 : 0 })));

  // New accounts with a password must change it on first login
  if (plainPassword) {
    await insert(
      `INSERT INTO user_password_requirements (user_code, must_change_password, reason)
       VALUES (?, 1, 'first_login')
       ON DUPLICATE KEY UPDATE must_change_password = 1, reason = 'first_login'`,
      [code]
    );
  }

  await logActivity(req.user, { action: 'USER_CREATE', details: `Created user ${cleaned} (${finalRole})`, req });
  ok(res, { code }, 201);
}));

/** PUT /api/users/:code — update profile (admin or self) */
router.put('/:code', requireUser, asyncHandler(async (req, res) => {
  const target = req.params.code;
  const actor = req.user;
  const isSelf = target === actor.code;
  const isAdmin = ['admin', 'executive', 'hr'].includes(actor.role);
  if (!isSelf && !isAdmin) throw new ApiError(403, 'Only admins may edit other users.');

  const existing = await getOne('SELECT * FROM users WHERE code = ?', [target]);
  if (!existing) throw new ApiError(404, 'User not found.');

  const allowed = ['name', 'email', 'department', 'position', 'avatar_url', 'telegram_chat_id'];
  if (isAdmin) allowed.push('role', 'superior_id', 'is_active');

  const patch = {};
  for (const f of allowed) {
    if (req.body[f] !== undefined) patch[f] = req.body[f];
  }
  if (isAdmin && req.body.password) {
    const pwErr = validatePasswordStrength(req.body.password);
    if (pwErr) throw new ApiError(400, pwErr);
    patch.password_hash = encryptPassword(req.body.password);
    // Admin reset => force the user to pick a new password on next login
    await insert(
      `INSERT INTO user_password_requirements (user_code, must_change_password, reason)
       VALUES (?, 1, 'admin_reset')
       ON DUPLICATE KEY UPDATE must_change_password = 1, reason = 'admin_reset'`,
      [target]
    );
  }
  if (isAdmin && patch.role && patch.role !== existing.role) {
    const defaults = ROLE_DEFAULT_PERMISSIONS[patch.role] || {};
    await query('DELETE FROM user_permissions WHERE user_code = ?', [target]);
    await bulkInsert('user_permissions', ['user_code', 'permission_key', 'allowed'],
      PERMISSION_KEYS.map((k) => ({ user_code: target, permission_key: k, allowed: defaults[k] ? 1 : 0 })));
  }
  // recheck duplicate username if being changed (admins may change it)
  if (req.body.username && req.body.username !== existing.username) {
    const cleaned = slugifyUsername(req.body.username);
    const dup = await getOne('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND code <> ?', [cleaned, target]);
    if (dup) throw new ApiError(409, `Username "${cleaned}" already taken.`);
    patch.username = cleaned;
  }

  const sets = Object.keys(patch).map((f) => `${f} = ?`);
  if (sets.length) {
    await query(`UPDATE users SET ${sets.join(', ')} WHERE code = ?`, [...Object.values(patch), target]);
  }
  await logActivity(req.user, { action: 'USER_UPDATE', details: `Updated ${target}: ${sets.join(', ')}`, req });
  ok(res, { code: target });
}));

/** PUT /api/users/:code/password — self or admin resets */
router.put('/:code/password', requireUser, asyncHandler(async (req, res) => {
  const target = req.params.code;
  const actor = req.user;
  const isSelf = target === actor.code;
  const isAdmin = actor.role === 'admin';
  if (!isSelf && !isAdmin) throw new ApiError(403, 'Only admins may reset others passwords.');

const { currentPassword, newPassword } = req.body || {};
  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) throw new ApiError(400, pwErr);

const user = await getOne('SELECT * FROM users WHERE code = ?', [target]);
  if (!user) throw new ApiError(404, 'User not found.');

  // Skip the "current password" check when the change is mandatory (first login
  // or admin reset) — the user has already authenticated with the temporary one.
  const pwdReq = await getOne('SELECT user_code FROM user_password_requirements WHERE user_code = ?', [target]);
  const mustChange = !!pwdReq;
  if (isSelf && user.password_hash && !mustChange) {
    if (!verifyPassword(currentPassword || '', user.password_hash)) throw new ApiError(400, 'Current password is incorrect.');
  }
  await query('UPDATE users SET password_hash = ? WHERE code = ?', [encryptPassword(newPassword), target]);
  if (isAdmin && !isSelf) {
    // Admin reset => force the user to set a new password on next login
    await insert(
      `INSERT INTO user_password_requirements (user_code, must_change_password, reason)
       VALUES (?, 1, 'admin_reset')
       ON DUPLICATE KEY UPDATE must_change_password = 1, reason = 'admin_reset'`,
      [target]
    );
  } else {
    // Self change (incl. forced change) => requirement satisfied, clear the flag
    await query('DELETE FROM user_password_requirements WHERE user_code = ?', [target]);
  }
  if (isAdmin && !isSelf) {
    await query('UPDATE sessions SET revoked_at = ? WHERE user_code = ? AND revoked_at IS NULL', [new Date().toISOString().slice(0, 19).replace('T', ' '), target]);
  } else {
    // Self change: revoke other sessions but keep the current browser session logged in.
    const currentHash = req.cookies?.['apa_refresh'] ? sha256(req.cookies['apa_refresh']) : null;
    await query(
      `UPDATE sessions SET revoked_at = ? WHERE user_code = ? AND revoked_at IS NULL AND token_hash <> ?`,
      [new Date().toISOString().slice(0, 19).replace('T', ' '), target, currentHash]
    );
  }
  await logActivity(actor, { action: 'PASSWORD_CHANGE', details: `Password changed for ${target}`, req });
  ok(res, { updated: true });
}));

/** DELETE /api/users/:code — deactivate */
router.delete('/:code', requireUser, requirePermission('manageUsers'), asyncHandler(async (req, res) => {
  const target = req.params.code;
  if (target === req.user.code) throw new ApiError(400, 'You cannot deactivate your own account.');
const user = await getOne('SELECT id FROM users WHERE code = ?', [target]);
  if (!user) throw new ApiError(404, 'User not found.');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await query('UPDATE users SET is_active = 0 WHERE code = ?', [target]);
  // Detach anyone who reported to this account and cut its access entirely.
  await query('UPDATE users SET superior_id = NULL WHERE superior_id = ?', [target]);
  await query('UPDATE sessions SET revoked_at = ? WHERE user_code = ? AND revoked_at IS NULL', [now, target]);
  await query('DELETE FROM user_password_requirements WHERE user_code = ?', [target]);
  await logActivity(req.user, { action: 'USER_DEACTIVATE', details: `Deactivated ${target}`, req });
  ok(res, { deactivated: true });
}));

/** POST /api/users/:code/reveal-password — admin-only credential reveal.
 *  Requires the acting admin to re-enter their OWN password, is rate limited to
 *  blunt brute-forcing, and is audit logged. Stored passwords are AES-256-GCM
 *  encrypted (services/passwordCrypto.js) and decrypted here on demand. */
router.post('/:code/reveal-password', requireUser, requireRole(['admin']), revealPwLimiter, asyncHandler(async (req, res) => {
  const target = req.params.code;
  const actor = req.user;
  const adminPassword = (req.body || {}).adminPassword;

  if (!adminPassword) throw new ApiError(400, 'Admin password is required.');

  // Re-authenticate the acting admin against their own stored credential.
  const adminRow = await getOne('SELECT code, username, password_hash FROM users WHERE code = ?', [actor.code]);
  if (!adminRow) throw new ApiError(401, 'Admin account not found.');
  if (!verifyPassword(adminPassword, adminRow.password_hash)) {
    await logActivity(actor, { action: 'PASSWORD_REVEAL_DENIED', details: `Failed re-auth attempting to reveal password for ${target}`, req });
    throw new ApiError(401, 'Incorrect admin password.');
  }

  const user = await getOne('SELECT code, username, name, password_hash FROM users WHERE code = ?', [target]);
  if (!user) throw new ApiError(404, 'User not found.');

  await logActivity(actor, { action: 'PASSWORD_REVEAL', details: `Revealed password for ${target} (@${user.username})`, req });
  ok(res, { code: user.code, username: user.username, name: user.name, password: user.password_hash ? decryptPassword(user.password_hash) : '' });
}));

/** GET /api/users/:code/permissions — matrix for a user (admin/executive/self) */
router.get('/:code/permissions', requireUser, asyncHandler(async (req, res) => {
  const target = req.params.code;
  const actor = req.user;
  if (!['admin', 'executive', 'hr'].includes(actor.role) && target !== actor.code) throw new ApiError(403, 'No access.');
  const rows = await query('SELECT permission_key, allowed FROM user_permissions WHERE user_code = ?', [target]);
  ok(res, { code: target, permissions: Object.fromEntries(rows.map((r) => [r.permission_key, !!r.allowed])) });
}));

/** POST /api/users/permissions/sync — re-apply the role-default permission matrix to ALL users */
router.post('/permissions/sync', requireUser, requireRole(['admin']), asyncHandler(async (req, res) => {
  const targets = await query('SELECT code, role FROM users WHERE is_active = 1');
  for (const u of targets) {
    const defaults = ROLE_DEFAULT_PERMISSIONS[u.role] || {};
    await query('DELETE FROM user_permissions WHERE user_code = ?', [u.code]);
    await bulkInsert('user_permissions', ['user_code', 'permission_key', 'allowed'],
      PERMISSION_KEYS.map((k) => ({ user_code: u.code, permission_key: k, allowed: defaults[k] ? 1 : 0 })));
  }
  await logActivity(req.user, { action: 'PERMISSIONS_SYNC', details: `Re-applied role-default permission matrix to ${targets.length} users`, req });
  ok(res, { synced: targets.length });
}));

/** PUT /api/users/:code/permissions — admin writes specific keys */
router.put('/:code/permissions', requireUser, requireRole(['admin']), asyncHandler(async (req, res) => {
  const target = req.params.code;
  const overrides = req.body?.permissions || {};
  const valid = Object.keys(overrides).filter((k) => PERMISSION_KEYS.includes(k));
  if (!valid.length) throw new ApiError(400, 'No valid permission keys supplied.');
  await query('DELETE FROM user_permissions WHERE user_code = ?', [target]);
  await bulkInsert('user_permissions', ['user_code', 'permission_key', 'allowed'],
    PERMISSION_KEYS.map((k) => ({ user_code: target, permission_key: k, allowed: overrides[k] ? 1 : 0 })));
  await logActivity(req.user, { action: 'PERMISSIONS_UPDATE', details: `Updated permissions for ${target}`, req });
  ok(res, { code: target });
}));

export default router;
