import { Router } from 'express';
import { asyncHandler, ok } from '../utils/http.js';
import { query } from '../config/db.js';
import { requireUser } from '../middleware/auth.js';
import { getSubordinateCodes } from '../services/scoping.js';

const router = Router();

/** GET /api/dashboard — scoped summary for the logged-in user */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  const isGlobal = ['admin', 'executive', 'hr'].includes(actor.role);
  let scope = { where: '', args: [] };
  let subs = [];
  if (!isGlobal) {
    subs = await getSubordinateCodes(actor.code);
    const ids = [actor.code, ...subs];
    scope = { where: `WHERE staff_code IN (${ids.map(() => '?').join(',')})`, args: ids };
  }

  const reportStats = await query(
    `SELECT
      COUNT(*) AS total,
      COALESCE(SUM(status = 'Draft'), 0) AS drafts,
      COALESCE(SUM(status = 'Submitted'), 0) AS submitted,
      COALESCE(SUM(status = 'Reviewed'), 0) AS reviewed,
      COALESCE(SUM(status = 'Approved'), 0) AS approved,
      COALESCE(SUM(month = MONTH(CURDATE()) AND year = YEAR(CURDATE())), 0) AS this_month
     FROM reports ${scope.where}`, scope.args);

  const trsIds = isGlobal ? [] : [actor.code, ...subs];
  const trsStats = isGlobal
    ? await query(`SELECT COUNT(*) AS total, COALESCE(SUM(status IN ('Pending','In Progress')), 0) AS open,
        COALESCE(SUM(status IN ('Pending','In Progress') AND deadline < CURDATE()), 0) AS overdue FROM trs_tasks`)
    : await query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(status IN ('Pending','In Progress')), 0) AS open,
           COALESCE(SUM(status IN ('Pending','In Progress') AND deadline < CURDATE()), 0) AS overdue
         FROM trs_tasks WHERE assigned_to IN (${trsIds.map(() => '?').join(',')})`, trsIds);

  const notifRow = await query('SELECT COUNT(*) AS unread FROM notifications WHERE recipient_user_code = ? AND is_read = 0', [actor.code]);

  const team = isGlobal
    ? await query('SELECT COUNT(*) AS c FROM users WHERE is_active = 1')
    : await query(`SELECT COUNT(*) AS c FROM users WHERE code IN (${trsIds.map(() => '?').join(',')}) AND is_active = 1`, trsIds);

  ok(res, {
    actor: { code: actor.code, role: actor.role, name: actor.name },
    scope: isGlobal ? 'global' : `team:${subs.length}`,
    reports: reportStats[0] || {},
    trs: trsStats[0] || {},
    notificationsUnread: Number(notifRow[0]?.unread || 0),
    teamSize: Number(team[0]?.c || 0)
  });
}));

export default router;
