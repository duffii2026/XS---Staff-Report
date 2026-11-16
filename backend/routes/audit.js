import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query } from '../config/db.js';
import { requireUser, requirePermission } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';

const router = Router();

/** GET /api/audit?user=&action=&limit=&offset= — admin/executive only */
router.get('/', requireUser, requirePermission('viewAuditLogs'), asyncHandler(async (req, res) => {
  const { user, action, limit = 200, offset = 0 } = req.query;
  const conds = [];
  const args = [];
  if (user) { conds.push('user_code = ?'); args.push(user); }
  if (action) { conds.push('action = ?'); args.push(action); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await query(
    `SELECT code, user_code, username, user_role, action, details, ip_address, created_at
     FROM activity_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...args, Math.min(Number(limit) || 200, 1000), Number(offset) || 0]
  );
  const countRow = await query(`SELECT COUNT(*) AS total FROM activity_logs ${where}`, args);
  ok(res, { rows, total: Number(countRow[0]?.total || 0), limit: Number(limit) || 200, offset: Number(offset) || 0 });
}));

/** DELETE /api/audit — wipe activity log history (admin only), then records the wipe itself */
router.delete('/', requireUser, requirePermission('viewAuditLogs'), asyncHandler(async (req, res) => {
  const result = await query('DELETE FROM activity_logs', []);
  const count = Number(result?.affectedRows || 0);
  await logActivity(req.user, { action: 'AUDIT_LOGS_CLEARED', details: `Cleared audit log history (${count} entries removed)`, req });
  ok(res, { cleared: true, count });
}));

export default router;
