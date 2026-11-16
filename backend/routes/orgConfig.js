import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne } from '../config/db.js';
import { requireUser, requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';

const router = Router();

const KINDS = ['department', 'position'];
// Must match users.department / users.position so any list value stays assignable.
const MAX_NAME = 64;

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new ApiError(400, `kind must be one of: ${KINDS.join(', ')}.`);
  }
  return kind;
}

function cleanName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'Name is required.');
  if (name.length > MAX_NAME) {
    throw new ApiError(400, `Name must be ${MAX_NAME} characters or fewer.`);
  }
  return name;
}

// Single source of truth for the row -> API shape, so every endpoint
// (GET / POST / PUT / DELETE) returns the same camelCase field names.
function toApiEntry(r) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deactivatedAt: r.deactivated_at,
    // Pick the counter that matches this row's kind. BOTH subqueries are always
    // selected, so a presence check would always find department_usage and
    // report 0 staff for every position (no user's department is named
    // "Supervisor", "Administrator", etc.). Selecting by kind is required.
    usageCount: r.kind === 'position'
      ? Number(r.position_usage)
      : Number(r.department_usage)
  };
}

const LIST_COLUMNS = `c.id, c.kind, c.name, c.is_active, c.created_at, c.updated_at, c.deactivated_at,
            (SELECT COUNT(*) FROM users u WHERE u.is_active = 1 AND u.department = c.name) AS department_usage,
            (SELECT COUNT(*) FROM users u WHERE u.is_active = 1 AND u.position = c.name) AS position_usage`;

/**
 * GET /api/org-config
 *   ?kind=department|position   filter (default: both)
 *   ?includeInactive=1          also return soft-deleted rows (admin console)
 * Usage counts are joined in so the console can warn before deactivating.
 * Readable by any signed-in user — every department/position dropdown needs it.
 */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const kindParam = String(req.query.kind || 'all');
  if (kindParam !== 'all') assertKind(kindParam);
  const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';

  const where = [];
  const args = [];
  if (kindParam !== 'all') {
    where.push('c.kind = ?');
    args.push(kindParam);
  }
  if (!includeInactive) where.push('c.is_active = 1');

  const rows = await query(
    `SELECT ${LIST_COLUMNS}
     FROM org_config c
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.kind DESC, c.is_active DESC, c.name ASC`,
    args
  );

  ok(res, rows.map(toApiEntry));
}));

/** POST /api/org-config — create a department or position. */
router.post('/', requireUser, requireRole(['admin']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const kind = assertKind(b.kind);
  const name = cleanName(b.name);

  const existing = await getOne('SELECT * FROM org_config WHERE kind = ? AND name = ?', [kind, name]);
  if (existing) {
    // Re-adding a previously deactivated name is a reactivation, not a conflict.
    if (Number(existing.is_active) === 1) {
      throw new ApiError(409, `"${name}" already exists in the ${kind} list.`);
    }
    await query(
      `UPDATE org_config SET is_active = 1, deactivated_by = NULL, deactivated_at = NULL WHERE id = ?`,
      [existing.id]
    );
    await logActivity(req.user, {
      action: 'ORG_CONFIG_REACTIVATE',
      details: `Reactivated ${kind} "${name}"`,
      req
    });
    // query() resolves to a rows array, so the aggregate row must be unwrapped
    // with [{ c }] - destructuring { c } off the array yields undefined.
    const [{ c: usage }] = await query(
      `SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND ${kind === 'department' ? 'department' : 'position'} = ?`,
      [name]
    );
    return ok(res, { id: existing.id, kind, name, isActive: true, usageCount: Number(usage), reactivated: true }, 201);
  }

  const result = await query(
    `INSERT INTO org_config (kind, name, created_by) VALUES (?, ?, ?)`,
    [kind, name, req.user.code]
  );

  await logActivity(req.user, {
    action: 'ORG_CONFIG_CREATE',
    details: `Created ${kind} "${name}"`,
    req
  });
  ok(res, { id: result.insertId, kind, name, isActive: true, usageCount: 0 }, 201);
}));

/**
 * PUT /api/org-config/:id — rename, and/or toggle active state.
 * Renaming rewrites users.department / users.position so existing staff
 * assignments survive the rename.
 */
router.put('/:id', requireUser, requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getOne('SELECT * FROM org_config WHERE id = ?', [id]);
  if (!existing) throw new ApiError(404, 'Entry not found.');

  const b = req.body || {};
  const sets = [];
  const args = [];

  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (name !== existing.name) {
      const dupe = await getOne('SELECT id FROM org_config WHERE kind = ? AND name = ?', [existing.kind, name]);
      if (dupe) throw new ApiError(409, `"${name}" already exists in the ${existing.kind} list.`);
      sets.push('name = ?');
      args.push(name);
      // Keep live assignments pointing at the renamed value.
      const col = existing.kind === 'department' ? 'department' : 'position';
      await query(`UPDATE users SET ${col} = ? WHERE ${col} = ?`, [name, existing.name]);
      await logActivity(req.user, {
        action: 'ORG_CONFIG_RENAME',
        details: `Renamed ${existing.kind} "${existing.name}" to "${name}"`,
        req
      });
    }
  }

  if (b.isActive !== undefined) {
    const isActive = b.isActive ? 1 : 0;
    if (Number(existing.is_active) !== isActive) {
      sets.push('is_active = ?', 'deactivated_by = ?', 'deactivated_at = ?');
      args.push(isActive, isActive ? null : req.user.code, isActive ? null : new Date());
      await logActivity(req.user, {
        action: isActive ? 'ORG_CONFIG_REACTIVATE' : 'ORG_CONFIG_DEACTIVATE',
        details: `${isActive ? 'Reactivated' : 'Deactivated'} ${existing.kind} "${b.name ?? existing.name}"`,
        req
      });
    }
  }

  if (!sets.length) throw new ApiError(400, 'Nothing to update.');
  await query(`UPDATE org_config SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
  const updated = await getOne(
    `SELECT ${LIST_COLUMNS} FROM org_config c WHERE c.id = ?`,
    [id]
  );
  ok(res, toApiEntry(updated));
}));

/**
 * DELETE /api/org-config/:id — SOFT delete, allowed only when 0 staff hold it.
 * Sets is_active = 0 so the value disappears from every dropdown, while
 * historic reports / appraisals / TRS tasks keep their text snapshots and
 * the entry can be reactivated later. Rejected with 409 while any active
 * staff member still has this department/position, so a master value can
 * never be removed from under live assignments.
 */
router.delete('/:id', requireUser, requireRole(['admin']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getOne('SELECT * FROM org_config WHERE id = ?', [id]);
  if (!existing) throw new ApiError(404, 'Entry not found.');

  const col = existing.kind === 'department' ? 'department' : 'position';
  const [{ c: usage }] = await query(
    `SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND ${col} = ?`,
    [existing.name]
  );
  const staffCount = Number(usage);

  // Deleting is only allowed once nobody holds this value. Otherwise the row
  // would still be referenced by live staff, so force them to reassign first.
  if (staffCount > 0) {
    throw new ApiError(
      409,
      `"${existing.name}" is still assigned to ${staffCount} staff member${staffCount === 1 ? '' : 's'}. ` +
        `Reassign them to another ${existing.kind} before deleting it.`
    );
  }

  if (Number(existing.is_active) === 1) {
    await query(
      `UPDATE org_config SET is_active = 0, deactivated_by = ?, deactivated_at = ? WHERE id = ?`,
      [req.user.code, new Date(), id]
    );
  }

  await logActivity(req.user, {
    action: 'ORG_CONFIG_DEACTIVATE',
    details: `Deactivated ${existing.kind} "${existing.name}"`,
    req
  });

  ok(res, {
    id,
    kind: existing.kind,
    name: existing.name,
    isActive: false,
    usageCount: staffCount,
    message: `Deactivated "${existing.name}".`
  });
}));

export default router;
