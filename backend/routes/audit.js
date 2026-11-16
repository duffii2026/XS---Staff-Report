import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query } from '../config/db.js';
import { requireUser, requirePermission } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';

const router = Router();

/**
 * The audit trail records activity from EVERY role, but only the System
 * Administrator may read or clear it. The permission check alone is not enough:
 * `viewAuditLogs` can be granted per-user from the permission matrix, so the
 * role is enforced here as well. (The Admin Console UI already blocks non-admins.)
 */
function requireAdmin(req) {
  if (req.user?.role !== 'admin') {
    throw new ApiError(403, 'System Administrator access required to view the audit log.');
  }
}

/** GET /api/audit?user=&action=&year=&limit=&offset= — admin only */
router.get('/', requireUser, requirePermission('viewAuditLogs'), asyncHandler(async (req, res) => {
  requireAdmin(req);
  const { user, action, year, limit, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (user) { conds.push('user_code = ?'); args.push(user); }
  if (action) { conds.push('action = ?'); args.push(action); }
  // Filter by calendar year (Cambodia-local date is stored as created_at).
  const yearNum = year && !isNaN(Number(year)) ? Number(year) : null;
  if (yearNum) { conds.push('YEAR(created_at) = ?'); args.push(yearNum); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  // A year-scoped view needs the WHOLE year, so it defaults much higher than
  // the unfiltered recent-activity window. Rows are small (~200 B), so 10 000
  // is still a sub-2 MB payload — and a year must never be silently truncated
  // (the server currently holds ~1 400 rows for 2026 alone).
  const defaultLimit = yearNum ? 5000 : 200;
  const maxLimit = yearNum ? 10000 : 1000;
  const effectiveLimit = Math.min(Number(limit) || defaultLimit, maxLimit);

  const rows = await query(
    `SELECT code, user_code, username, user_role, action, details, ip_address, created_at
     FROM activity_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...args, effectiveLimit, Number(offset) || 0]
  );
  const countRow = await query(`SELECT COUNT(*) AS total FROM activity_logs ${where}`, args);
  ok(res, {
    rows,
    total: Number(countRow[0]?.total || 0),
    limit: effectiveLimit,
    offset: Number(offset) || 0,
    year: yearNum
  });
}));

/** DELETE /api/audit — wipe activity log history (admin only), then records the wipe itself */
router.delete('/', requireUser, requirePermission('viewAuditLogs'), asyncHandler(async (req, res) => {
  requireAdmin(req);
  const result = await query('DELETE FROM activity_logs', []);
  const count = Number(result?.affectedRows || 0);
  await logActivity(req.user, { action: 'AUDIT_LOGS_CLEARED', details: `Cleared audit log history (${count} entries removed)`, req });
  ok(res, { cleared: true, count });
}));

export default router;
