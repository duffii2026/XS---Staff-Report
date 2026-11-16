import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne } from '../config/db.js';
import { requireUser, requirePermission } from '../middleware/auth.js';
import { logActivity, makeCode } from '../services/audit.js';

const router = Router();

function normalizeItems(items) {
  if (!items || !Array.isArray(items)) return [];
  return items.map((it) => {
    if (typeof it !== 'object' || it === null) return null;
    return { ...it }; // pass SPA checklist shapes through untouched
  }).filter(Boolean);
}

router.get('/', requireUser, asyncHandler(async (req, res) => {
  const rows = await query('SELECT * FROM role_templates ORDER BY department, position_title');
  ok(res, rows.map((r) => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items })) );
}));

router.get('/:code', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT * FROM role_templates WHERE code = ?', [req.params.code]);
  if (!row) throw new ApiError(404, 'Template not found.');
  ok(res, { ...row, items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items });
}));

router.post('/', requireUser, requirePermission('manageTemplates'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const positionTitle = b.position_title ?? b.positionTitle;
  const department = b.department ?? 'All Departments';
  const items = b.items ?? [];
  if (!positionTitle) throw new ApiError(400, 'positionTitle is required.');
  const code = `tmpl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await query(
    `INSERT INTO role_templates (code, position_title, department, items, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [code, positionTitle, department, JSON.stringify(normalizeItems(items)), req.user.code]
  );
  await logActivity(req.user, { action: 'TEMPLATE_CREATE', details: `Created template ${positionTitle}`, req });
  ok(res, { code }, 201);
}));

router.put('/:code', requireUser, requirePermission('manageTemplates'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT id FROM role_templates WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Template not found.');
const b = req.body || {};
  const positionTitle = b.position_title ?? b.positionTitle;
  const department = b.department;
  const items = b.items;
  const sets = [];
  const args = [];
  if (positionTitle !== undefined) { sets.push('position_title = ?'); args.push(positionTitle); }
  if (department !== undefined) { sets.push('department = ?'); args.push(department); }
  if (items !== undefined) { sets.push('items = ?'); args.push(JSON.stringify(normalizeItems(items))); }
  sets.push("last_updated = CURDATE()");
  if (!sets.length) throw new ApiError(400, 'Nothing to update.');
  await query(`UPDATE role_templates SET ${sets.join(', ')} WHERE code = ?`, [...args, req.params.code]);
  await logActivity(req.user, { action: 'TEMPLATE_UPDATE', details: `Updated template ${req.params.code}`, req });
  ok(res, { code: req.params.code });
}));

router.delete('/:code', requireUser, requirePermission('manageTemplates'), asyncHandler(async (req, res) => {
  await query('DELETE FROM role_templates WHERE code = ?', [req.params.code]);
  await logActivity(req.user, { action: 'TEMPLATE_DELETE', details: `Deleted template ${req.params.code}`, req });
  ok(res, { deleted: true });
}));

export default router;
