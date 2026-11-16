import { query } from '../config/db.js';

/**
 * Resolve ALL direct + indirect subordinate user codes for a given user.
 * Uses a recursive CTE (MySQL 8).
 */
export async function getSubordinateCodes(userCode) {
  const rows = await query(
    `WITH RECURSIVE subs AS (
        SELECT code FROM users WHERE superior_id = ? AND is_active = 1
        UNION ALL
        SELECT u.code
        FROM users u
        INNER JOIN subs s ON u.superior_id = s.code
        WHERE u.is_active = 1
      )
      SELECT code FROM subs`,
    [userCode]
  );
  return rows.map((r) => r.code);
}

/**
 * True when the acting user may see a given target user's data
 * (self, subordinate, or global admin/executive).
 */
export async function canAccessUser(actor, targetCode) {
  if (['admin', 'executive', 'hr'].includes(actor.role)) return true;
  if (actor.code === targetCode) return true;
  const subs = await getSubordinateCodes(actor.code);
  return subs.includes(targetCode);
}

/**
 * Build an IN clause + args for "own OR subordinate" visibility.
 * Returns { clause, args } to embed in SQL like `col IN (${clause})`.
 */
export async function buildScopeIn(actor, column) {
  if (['admin', 'executive', 'hr'].includes(actor.role)) {
    return { clause: '' /* caller must handle wider scope */ };
  }
  const subs = await getSubordinateCodes(actor.code);
  const ids = [actor.code, ...subs];
  const placeholders = ids.map(() => '?').join(',');
  return { clause: `${column} IN (${placeholders})`, args: ids, ids };
}

/**
 * Row-level visibility predicate mirroring the SPA rules:
 *  - admin/executive -> all rows
 *  - otherwise rows where target column is self or a subordinate
 */
export async function scopedRows(actor, column, baseWhere = '', baseArgs = [], extraArgs = []) {
  if (['admin', 'executive', 'hr'].includes(actor.role)) {
    const where = baseWhere ? `WHERE ${baseWhere}` : '';
    return { where, args: [...baseArgs, ...extraArgs] };
  }
  const subs = await getSubordinateCodes(actor.code);
  const ids = [actor.code, ...subs];
  const placeholders = ids.map(() => '?').join(',');
  const whereParts = [`${column} IN (${placeholders})`];
  if (baseWhere) whereParts.push(baseWhere);
  return { where: `WHERE ${whereParts.join(' AND ')}`, args: [...ids, ...baseArgs, ...extraArgs] };
}