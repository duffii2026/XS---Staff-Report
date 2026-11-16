import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne, insert } from '../config/db.js';
import { requireUser } from '../middleware/auth.js';
import { logActivity, makeCode } from '../services/audit.js';

const router = Router();

function parseJson(v) {
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

async function withDisplay(row, receipts) {
  const base = { ...row, read_receipts: receipts || [] };
  return base;
}

function canManage(actor) {
  return ['admin', 'executive', 'hr', 'manager'].includes(actor.role);
}

/** GET /api/notices — list notices (management sees read receipts; staff sees only their own read state) */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const rows = await query(`SELECT * FROM notices ORDER BY is_pinned DESC, created_at DESC`);
  if (!rows.length) { ok(res, []); return; }

  const codes = rows.map((r) => r.code);
  const receipts = await query(
    `SELECT * FROM notice_read_receipts WHERE notice_code IN (${codes.map(() => '?').join(',')})`,
    codes
  );

  const out = [];
  for (const r of rows) {
    const rcpts = receipts.filter((x) => x.notice_code === r.code);
    if (canManage(actor)) {
      out.push(await withDisplay(r, rcpts));
    } else {
      // staff: only embed own receipt (used for NEW badge); count is derived client-side
      const mine = rcpts.filter((x) => x.user_id === actor.code);
      out.push(await withDisplay(r, mine));
    }
  }
  ok(res, out);
}));

/** POST /api/notices — create or update an announcement (management only) */
router.post('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  if (!canManage(actor)) throw new ApiError(403, 'Only management may publish announcements.');

  const b = req.body || {};
  if (!b.title || !b.content) throw new ApiError(400, 'title and content are required.');
  const priority = ['urgent', 'important', 'standard'].includes(b.priority) ? b.priority : 'standard';
  const category = ['General', 'Policy', 'Deadline', 'System'].includes(b.category) ? b.category : 'General';
  const departmentScope = b.department_scope || 'all';
  const isPinned = b.is_pinned ? 1 : 0;

  // Upsert by code (frontend passes id/code; new notices get a generated code)
  const code = b.id && String(b.id).startsWith('notice_') ? b.id : makeCode('notice');
  const existing = await getOne('SELECT code FROM notices WHERE code = ?', [code]);

  if (existing) {
    await query(
      `UPDATE notices SET title = ?, content = ?, priority = ?, category = ?, department_scope = ?, is_pinned = ?, author_id = ?, author_name = ?, author_role = ?
       WHERE code = ?`,
      [b.title, b.content, priority, category, departmentScope, isPinned, actor.code, actor.name, actor.role, code]
    );
    await logActivity(actor, { action: 'NOTICE_UPDATED', details: `Updated announcement "${b.title}" [${priority}]`, req });
  } else {
    await insert(
      `INSERT INTO notices (code, title, content, priority, category, author_id, author_name, author_role, department_scope, is_pinned)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [code, b.title, b.content, priority, category, actor.code, actor.name, actor.role, departmentScope, isPinned]
    );
    await logActivity(actor, { action: 'NOTICE_PUBLISHED', details: `Published announcement "${b.title}" [${priority}]`, req });
  }
  ok(res, { code });
}));

/** DELETE /api/notices/:code — management only */
router.delete('/:code', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  if (!canManage(actor)) throw new ApiError(403, 'Only management may delete announcements.');
  const existing = await getOne('SELECT title FROM notices WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Notice not found.');
  await query('DELETE FROM notice_read_receipts WHERE notice_code = ?', [req.params.code]);
  await query('DELETE FROM notices WHERE code = ?', [req.params.code]);
  await logActivity(actor, { action: 'NOTICE_DELETED', details: `Deleted announcement "${existing.title}"`, req });
  ok(res, { deleted: true });
}));

/** POST /api/notices/:code/read — mark notice as read by current user */
router.post('/:code/read', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const notice = await getOne('SELECT code FROM notices WHERE code = ?', [req.params.code]);
  if (!notice) throw new ApiError(404, 'Notice not found.');

  await insert(
    `INSERT INTO notice_read_receipts (notice_code, user_id, user_name, user_role, department)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE user_name = VALUES(user_name), user_role = VALUES(user_role), department = VALUES(department), read_at = CURRENT_TIMESTAMP`,
    [req.params.code, actor.code, actor.name, actor.role, actor.department || '']
  );
  ok(res, { read: true });
}));

export default router;
