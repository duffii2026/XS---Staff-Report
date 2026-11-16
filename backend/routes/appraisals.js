import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne } from '../config/db.js';
import { requireUser, requirePermission } from '../middleware/auth.js';
import { getSubordinateCodes } from '../services/scoping.js';
import { logActivity, notifyUser, makeCode } from '../services/audit.js';
import { toMySqlDatetime } from '../services/auth.js';
import { uploadSignatureDataUrl, prepareSignature } from '../services/s3.js';
import { dispatchFlow } from '../services/notificationFlow.js';

const router = Router();

function parseJson(v) {
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/** GET /api/appraisals?staffCode=&periodYear= */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const { staffCode, periodYear } = req.query;
  const conds = [];
  const args = [];
  if (staffCode) { conds.push('staff_code = ?'); args.push(staffCode); }
  if (periodYear) { conds.push('period_year = ?'); args.push(Number(periodYear)); }

  if (!['admin', 'executive', 'hr'].includes(actor.role)) {
    const subs = await getSubordinateCodes(actor.code);
    const ids = [actor.code, ...subs];
    conds.push(`staff_code IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }

  const rows = await query(
    `SELECT * FROM appraisals ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY period_year DESC, created_at DESC`,
    args
  );
  const out = [];
  for (const r of rows) {
    out.push({
      ...r,
      prepared_signature: parseJson(r.prepared_signature),
      approved_signature: parseJson(r.approved_signature),
      prepared_signature_display: await prepareSignature(parseJson(r.prepared_signature)),
      approved_signature_display: await prepareSignature(parseJson(r.approved_signature))
    });
  }
  ok(res, out);
}));

router.get('/:code', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT * FROM appraisals WHERE code = ?', [req.params.code]);
  if (!row) throw new ApiError(404, 'Appraisal not found.');
  const actor = req.user;
  if (!['admin', 'executive', 'hr'].includes(actor.role)) {
    const subs = await getSubordinateCodes(actor.code);
    if (row.staff_code !== actor.code && !subs.includes(row.staff_code)) throw new ApiError(403, 'No access.');
  }
  ok(res, {
    ...row,
    prepared_signature: parseJson(row.prepared_signature),
    approved_signature: parseJson(row.approved_signature),
    prepared_signature_display: await prepareSignature(parseJson(row.prepared_signature)),
    approved_signature_display: await prepareSignature(parseJson(row.approved_signature))
  });
}));

/** POST /api/appraisals — prepare a draft (manager for subordinate) */
router.post('/', requireUser, requirePermission('evaluatePerformance'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const actor = req.user;
  const staffCode = b.staff_code;
  if (!staffCode) throw new ApiError(400, 'staff_code is required.');
  const staff = await getOne('SELECT * FROM users WHERE code = ?', [staffCode]);
  if (!staff) throw new ApiError(404, 'Staff not found.');
  if (!['admin', 'executive', 'hr'].includes(actor.role)) {
    const subs = await getSubordinateCodes(actor.code);
    if (staffCode !== actor.code && !subs.includes(staffCode)) throw new ApiError(403, 'Only for own subordinates.');
  }
  if (b.period_year) {
    const dup = await getOne('SELECT id FROM appraisals WHERE staff_code = ? AND period_year = ? AND period_quarter = ?',
      [staffCode, b.period_year, b.period_quarter || null]);
    if (dup) throw new ApiError(409, 'An appraisal for this period already exists.');
  }

  const trScore = round2(b.tr_score);
  const trsScore = round2(b.trs_score);
  const overall = round2((trScore + trsScore) / 2);

  const code = makeCode('appr');
  await query(
    `INSERT INTO appraisals
      (code, staff_code, staff_name, department, position,
       period_year, period_quarter, period_month, period,
       tr_score, trs_score, overall_score, signature_mode, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, staffCode, staff.name, staff.department, staff.position,
     b.period_year ?? null, b.period_quarter ?? null, b.period_month ?? null, b.period ?? null,
     trScore, trsScore, overall, b.signature_mode || 'digital', 'Draft']
  );
  await logActivity(actor, { action: 'APPRAISAL_CREATE', details: `Prepared ${code} for ${staffCode}`, req });
  ok(res, { code, overall_score: overall }, 201);
}));

/** PUT /api/appraisals/:code — edit scores/details while Draft */
router.put('/:code', requireUser, requirePermission('evaluatePerformance'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM appraisals WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Appraisal not found.');
  if (existing.status !== 'Draft') throw new ApiError(400, 'Only drafts can be edited.');

  const b = req.body || {};
  const trScore = b.tr_score != null ? round2(b.tr_score) : existing.tr_score;
  const trsScore = b.trs_score != null ? round2(b.trs_score) : existing.trs_score;
  const overall = round2((trScore + trsScore) / 2);

  const mapCols = { period_year: 'period_year', period_quarter: 'period_quarter', period_month: 'period_month', period: 'period', signature_mode: 'signature_mode' };
  const sets = [];
  const args = [];
  for (const [k, col] of Object.entries(mapCols)) if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(b[k]); }
  sets.push('tr_score = ?', 'trs_score = ?', 'overall_score = ?', 'updated_at = CURRENT_TIMESTAMP');
  args.push(trScore, trsScore, overall);
  await query(`UPDATE appraisals SET ${sets.join(', ')} WHERE code = ?`, [...args, req.params.code]);
  await logActivity(req.user, { action: 'APPRAISAL_UPDATE', details: `Updated ${req.params.code}`, req });
  ok(res, { code: req.params.code, overall_score: overall });
}));

/** POST /api/appraisals/:code/sign-prepare — manager signs prepared section */
router.post('/:code/sign-prepare', requireUser, requirePermission('evaluatePerformance'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM appraisals WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Appraisal not found.');
  if (existing.status === 'Fully Approved') throw new ApiError(400, 'Already fully approved.');

  const preparedSignature = await uploadSignatureDataUrl(req.user.code, req.body?.signature || {});
  await query(
    `UPDATE appraisals
     SET prepared_by_user_code = ?, prepared_by_name = ?, prepared_by_role = ?,
         prepared_signature = ?, prepared_date = ?, prepared_notes = ?, status = 'Pending Executive Approval'
     WHERE code = ?`,
    [req.user.code, req.user.name, req.user.role,
     preparedSignature ? JSON.stringify(preparedSignature) : null,
     toMySqlDatetime(new Date()), req.body?.notes ?? null, req.params.code]
  );
  await logActivity(req.user, { action: 'APPRAISAL_PREPARE_SIGN', details: `Signed prepared section ${req.params.code}`, req });
  const apprStaff = await getOne('SELECT * FROM users WHERE code = ?', [existing.staff_code]);
  await dispatchFlow({
    eventType: 'APPRAISAL_PENDING',
    title: `Appraisal ${existing.code} (${existing.period || existing.period_year || ''})`,
    staffName: existing.staff_name,
    superiorName: req.user.name,
    department: existing.department || undefined,
    status: 'Pending Executive Approval',
    score: Number(existing.overall_score),
    notes: req.body?.notes || 'Appraisal prepared and signed, pending executive approval.',
    details: `Signed by ${req.user.name} (${req.user.role})`,
    targetUserCode: apprStaff?.superior_id || existing.staff_code
  });
  ok(res, { code: req.params.code });
}));

/** POST /api/appraisals/:code/approve — executive approves + signs */
router.post('/:code/approve', requireUser, requirePermission('approveAppraisals'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM appraisals WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Appraisal not found.');
  if (existing.status !== 'Pending Executive Approval' && existing.status !== 'Draft') {
    throw new ApiError(400, 'Only pending appraisals can be approved.');
  }
  const approvedSignature = await uploadSignatureDataUrl(req.user.code, req.body?.signature || {});
  await query(
    `UPDATE appraisals
     SET approved_by_user_code = ?, approved_by_name = ?, approved_by_role = ?,
         approved_signature = ?, approved_date = ?, approved_notes = ?, status = 'Fully Approved'
     WHERE code = ?`,
    [req.user.code, req.user.name, req.user.role,
     approvedSignature ? JSON.stringify(approvedSignature) : null,
     toMySqlDatetime(new Date()), req.body?.notes ?? null, req.params.code]
  );
  await notifyUser({
    recipientCode: existing.staff_code, senderCode: req.user.code, senderName: req.user.name,
    type: 'APPRAISAL_APPROVED', title: `Appraisal approved`,
    message: `${existing.code} (${existing.period || '—'}) fully approved with overall ${existing.overall_score}.`,
    linkTab: 'appraisal'
  }).catch(() => {});
  await dispatchFlow({
    eventType: 'APPRAISAL_APPROVED',
    title: `Appraisal ${existing.code} (${existing.period || existing.period_year || ''})`,
    staffName: existing.staff_name,
    superiorName: req.user.name,
    department: existing.department || undefined,
    status: 'Fully Approved',
    score: Number(existing.overall_score),
    notes: req.body?.notes || 'Appraisal fully approved.',
    details: `Approved by ${req.user.name} (${req.user.role})`,
    targetUserCode: existing.staff_code
  });
  await logActivity(req.user, { action: 'APPRAISAL_APPROVE', details: `Approved ${req.params.code}`, req });
  ok(res, { code: req.params.code, status: 'Fully Approved' });
}));

/** DELETE /api/appraisals/:code — drafts only */
router.delete('/:code', requireUser, requirePermission('evaluatePerformance'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM appraisals WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Appraisal not found.');
  if (existing.status !== 'Draft') throw new ApiError(400, 'Only draft appraisals can be deleted.');
  await query('DELETE FROM appraisals WHERE code = ?', [req.params.code]);
  await logActivity(req.user, { action: 'APPRAISAL_DELETE', details: `Deleted ${req.params.code}`, req });
  ok(res, { deleted: true });
}));

export default router;
