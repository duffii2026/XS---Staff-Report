import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne } from '../config/db.js';
import { requireUser } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';

const router = Router();

/**
 * The MySQL server runs on UTC, so created_at is a naive locale-time string
 * (e.g. "2026-09-24 02:39:29"). Rewrite it to an explicit UTC ISO instant so the
 * client can convert to Cambodia time (UTC+7) — otherwise `new Date(...)` would
 * mis-parse it as browser-local and show times ~7h off.
 */
function toUtcIso(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return String(v);
  return `${m[1]}T${m[2]}Z`;
}

/** GET /api/notifications?unreadOnly= */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const { unreadOnly } = req.query;
  const rows = await query(
    `SELECT * FROM notifications
     WHERE recipient_user_code = ?
     ${unreadOnly ? 'AND is_read = 0' : ''}
     ORDER BY created_at DESC LIMIT 200`,
    [req.user.code]
  );
  ok(res, rows.map((r) => ({ ...r, created_at: toUtcIso(r.created_at) })));
}));

router.get('/unread-count', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_code = ? AND is_read = 0', [req.user.code]);
  ok(res, { count: Number(row?.count || 0) });
}));

router.post('/:code/read', requireUser, asyncHandler(async (req, res) => {
  const result = await query(
    'UPDATE notifications SET is_read = 1 WHERE code = ? AND recipient_user_code = ?',
    [req.params.code, req.user.code]
  );
  if (!result || result.affectedRows === 0) throw new ApiError(404, 'Notification not found.');
  ok(res, { read: true });
}));

router.post('/read-all', requireUser, asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE recipient_user_code = ? AND is_read = 0', [req.user.code]);
  ok(res, { read: true });
}));

router.delete('/', requireUser, asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM notifications WHERE recipient_user_code = ?', [req.user.code]);
  await logActivity(req.user, { action: 'NOTIFICATIONS_CLEARED', details: `Cleared ${result?.affectedRows || 0} notification(s) from Team Notifications`, req });
  ok(res, { cleared: true });
}));

export default router;
