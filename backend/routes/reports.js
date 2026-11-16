import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne, withTransaction } from '../config/db.js';
import { requireUser, requirePermission } from '../middleware/auth.js';
import { buildScopeIn, getSubordinateCodes } from '../services/scoping.js';
import { logActivity, notifyUser, makeCode } from '../services/audit.js';
import { toMySqlDatetime } from '../services/auth.js';
import { prepareSignature, uploadSignatureDataUrl } from '../services/s3.js';
import { dispatchFlow, notifyUserTelegram } from '../services/notificationFlow.js';
import { deleteProofFilesFromS3 } from '../services/proofFiles.js';

const router = Router();
const STATUSES = ['Draft', 'Submitted', 'Reviewed', 'Approved'];

function parseJson(v) {
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

function computeScores(body, checklistItems) {
  const items = Array.isArray(checklistItems) ? checklistItems : [];
  const total = items.length || 1;
  const done = items.filter((i) => i.done || i.completed || i.status === 'completed').length;
  const completion = body.completion_score != null ? Number(body.completion_score)
    : Math.round((done / total) * 100);
  const timeliness = body.timeliness_score != null ? Number(body.timeliness_score) : null;
  const quality = body.quality_score != null ? Number(body.quality_score) : null;
  const parts = [completion, timeliness, quality].filter((v) => v != null && !isNaN(v));
  const trScore = parts.length
    ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100
    : 0;
  return { completion_score: completion, timeliness_score: timeliness, quality_score: quality, tr_score: trScore };
}

async function withDisplay(row) {
  const base = {
    ...row,
    checklistItems: parseJson(row.checklist_items),
    signature: parseJson(row.signature),
    multiProof: parseJson(row.multi_proof),
    dispute: parseJson(row.dispute),
    escalationLevel: row.escalation_level || null,
    approvedDeadline: row.approved_deadline || null,
    extensionRequest: parseJson(row.extension_request),
    extensionHistory: parseJson(row.extension_history)
  };
  if (base.signature) base.signature_display = await prepareSignature(base.signature);
  return base;
}

/** GET /api/reports?staffCode=&year=&quarter=&month= */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const { staffCode, year, quarter, month } = req.query;
  const conds = [];
  const args = [];

  const { where = '', args: scopeArgs = [] } = await buildScopeIn(actor, 'staff_code');
  if (where) conds.push(where);
  args.push(...scopeArgs);

  if (staffCode) { conds.push('staff_code = ?'); args.push(staffCode); }
  if (year) { conds.push('year = ?'); args.push(Number(year)); }
  if (quarter) { conds.push('quarter = ?'); args.push(Number(quarter)); }
  if (month) { conds.push('month = ?'); args.push(Number(month)); }

  const whereClause = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const rows = await query(
    `SELECT * FROM reports${whereClause} ORDER BY start_date DESC`,
    args
  );
  const out = [];
  for (const r of rows) out.push(await withDisplay(r));
  ok(res, out);
}));

/** GET /api/reports/drafts?staffCode= — list TR drafts within the requester's scope */
router.get('/drafts', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const { where = '', args: scopeArgs = [] } = await buildScopeIn(actor, 'user_code');
  const conds = [];
  const args = [];
  if (where) conds.push(where);
  args.push(...scopeArgs);
  if (req.query.staffCode) { conds.push('user_code = ?'); args.push(req.query.staffCode); }
  const rows = await query(
    `SELECT user_code, year, week_number, draft_data, updated_at FROM tr_drafts
     ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY updated_at DESC`,
    args
  );
  ok(res, rows.map((r) => ({
    staff_code: r.user_code,
    year: Number(r.year),
    week_number: Number(r.week_number),
    draft: parseJson(r.draft_data),
    last_saved_at: r.updated_at
  })));
}));

/** GET /api/reports/draft/:staffCode/:year/:week — TR draft autosave lookup */
router.get('/draft/:staffCode/:year/:week', requireUser, asyncHandler(async (req, res) => {
  const { staffCode, year, week } = req.params;
  const { canAccessUser } = await import('../services/scoping.js');
  if (!(await canAccessUser(req.user, staffCode))) throw new ApiError(403, 'No access to this draft.');
  const row = await getOne(
    `SELECT draft_data, updated_at FROM tr_drafts WHERE user_code = ? AND year = ? AND week_number = ?`,
    [staffCode, Number(year), Number(week)]
  );
  if (!row) { ok(res, { exists: false, draft: null }); return; }
  ok(res, { exists: true, draft: parseJson(row.draft_data), lastSavedAt: row.updated_at });
}));

/** PUT /api/reports/draft/:staffCode/:year/:week — upsert TR draft autosave */
router.put('/draft/:staffCode/:year/:week', requireUser, asyncHandler(async (req, res) => {
  const { staffCode, year, week } = req.params;
  const b = req.body || {};
  const { canAccessUser } = await import('../services/scoping.js');
  if (!(await canAccessUser(req.user, staffCode))) throw new ApiError(403, 'No access to this draft.');

  const draftData = b.draft_data || {};
  if (!draftData.signature) {
    await query(
      `INSERT INTO tr_drafts (user_code, year, week_number, draft_data)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE draft_data = VALUES(draft_data), updated_at = CURRENT_TIMESTAMP`,
      [staffCode, Number(year), Number(week), JSON.stringify(draftData)]
    );
    ok(res, { saved: true });
    return;
  }
  const signature = await uploadSignatureDataUrl(req.user.code, draftData.signature);
  await query(
    `INSERT INTO tr_drafts (user_code, year, week_number, draft_data)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE draft_data = VALUES(draft_data), updated_at = CURRENT_TIMESTAMP`,
    [staffCode, Number(year), Number(week), JSON.stringify({ ...draftData, signature })]
  );
  ok(res, { saved: true });
}));

/** DELETE /api/reports/draft/:staffCode/:year/:week — clear TR draft autosave */
router.delete('/draft/:staffCode/:year/:week', requireUser, asyncHandler(async (req, res) => {
  const { staffCode, year, week } = req.params;
  const { canAccessUser } = await import('../services/scoping.js');
  if (!(await canAccessUser(req.user, staffCode))) throw new ApiError(403, 'No access to this draft.');
  await query('DELETE FROM tr_drafts WHERE user_code = ? AND year = ? AND week_number = ?',
    [staffCode, Number(year), Number(week)]);
  ok(res, { cleared: true });
}));

// ---------------------------------------------------------------
// Weekly Summary Form (IRG-HR-FRM-WSUM-001 v1.1) — Sections A-J.
// Lives in its own table `tr_weekly_summaries`, keyed by report code,
// so `reports` never gains extra columns.
// ---------------------------------------------------------------

/** GET /api/reports/:code/summary */
router.get('/:code/summary', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT staff_code FROM reports WHERE code = ?', [req.params.code]);
  if (!row) throw new ApiError(404, 'Report not found.');
  const { canAccessUser } = await import('../services/scoping.js');
  if (!(await canAccessUser(req.user, row.staff_code))) {
    throw new ApiError(403, 'No access to this report.');
  }
  const sum = await getOne(
    'SELECT summary_data FROM tr_weekly_summaries WHERE report_code = ?',
    [req.params.code]
  );
  ok(res, { summary: sum ? parseJson(sum.summary_data) : null });
}));

/** PUT /api/reports/:code/summary — upsert the Weekly Summary Form */
router.put('/:code/summary', requireUser, asyncHandler(async (req, res) => {
  const report = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!report) throw new ApiError(404, 'Report not found.');
  const superiorCodes = await getSubordinateCodes(req.user.code);
  if (req.user.code !== report.staff_code
    && !['admin', 'executive', 'hr'].includes(req.user.role)
    && !superiorCodes.includes(report.staff_code)) {
    throw new ApiError(403, 'Only the author, the reporter\'s superior, or an Admin may edit this summary.');
  }
  // Spec §6: the staff member can edit only while the status is Draft or returned.
  if (report.status !== 'Draft' && report.status !== 'Submitted') {
    throw new ApiError(400, `Cannot edit the summary of a report in status "${report.status}".`);
  }
  const summary = req.body?.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new ApiError(400, 'summary is required.');
  }
  await query(
    `INSERT INTO tr_weekly_summaries (report_code, staff_code, year, week_number, summary_data)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE summary_data = VALUES(summary_data), updated_at = CURRENT_TIMESTAMP`,
    [
      req.params.code,
      report.staff_code,
      Number(report.year),
      Number(report.week_number),
      JSON.stringify(summary)
    ]
  );
  await logActivity(req.user, {
    action: 'WEEKLY_SUMMARY_SAVE',
    details: `Saved Weekly Summary Form for ${req.params.code}`,
    req
  });
  ok(res, { saved: true });
}));

router.get('/:code', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!row) throw new ApiError(404, 'Report not found.');
  const { canAccessUser } = await import('../services/scoping.js');
  if (!(await canAccessUser(req.user, row.staff_code))) throw new ApiError(403, 'No access to this report.');
  ok(res, await withDisplay(row));
}));

/** POST /api/reports — create draft (staff for self; managers may pre-fill for subordinate) */
router.post('/', requireUser, requirePermission('submitTRReport'), asyncHandler(async (req, res) => {
  const actor = req.user;
  const b = req.body || {};
  const staffCode = b.staff_code || actor.code;
  const { canAccessUser } = await import('../services/scoping.js');
  if (!['admin', 'executive', 'hr'].includes(actor.role) && staffCode !== actor.code && !(await canAccessUser(actor, staffCode))) {
    throw new ApiError(403, 'Cannot create a report for that staff.');
  }

  const staff = await getOne('SELECT * FROM users WHERE code = ?', [staffCode]);
  if (!staff) throw new ApiError(404, 'Staff member not found.');

  if (b.start_date && b.end_date) {
    const dup = await getOne(
      `SELECT id FROM reports WHERE staff_code = ? AND start_date = ? AND end_date = ?`,
      [staffCode, b.start_date, b.end_date]
    );
    if (dup) throw new ApiError(409, 'A report for this week already exists.');
  }

  const checklistItems = Array.isArray(b.checklist_items) ? b.checklist_items : [];
  const scores = computeScores(b, checklistItems);
  const signature = b.signature ? await uploadSignatureDataUrl(actor.code, b.signature) : null;
  const code = makeCode('report');

  await query(
    `INSERT INTO reports
      (code, staff_code, staff_name, department, position, superior_code,
       year, quarter, month, week_number, start_date, end_date,
       checklist_items, tr_score, completion_score, timeliness_score, quality_score,
       signature, notes, ai_summary, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      code,
      staffCode, staff.name, staff.department, staff.position, staff.superior_id,
      b.year ?? new Date().getFullYear(), b.quarter ?? 1, b.month ?? new Date().getMonth() + 1, b.week_number ?? null,
      b.start_date, b.end_date,
      JSON.stringify(checklistItems),
      scores.tr_score, scores.completion_score, scores.timeliness_score, scores.quality_score,
      signature ? JSON.stringify(signature) : null, b.notes || null,
      b.ai_summary ?? null, 'Draft'
    ]
  );
  await logActivity(actor, { action: 'REPORT_CREATE', details: `Created draft report ${code} for ${staffCode}`, req });
  ok(res, { code }, 201);
}));

/** PUT /api/reports/:code — update draft (author) */
router.put('/:code', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  const superiorCodes = await getSubordinateCodes(req.user.code);
  if (req.user.code !== existing.staff_code
    && !['admin', 'executive', 'hr'].includes(req.user.role)
    && !superiorCodes.includes(existing.staff_code)) {
    throw new ApiError(403, 'Only the author, the reporter\'s superior, or an Admin may edit this report.');
  }
  if (existing.status !== 'Draft' && existing.status !== 'Submitted') {
    throw new ApiError(400, `Cannot edit a report in status "${existing.status}".`);
  }
  const b = req.body || {};
  const checklistItems = b.checklist_items ? b.checklist_items : parseJson(existing.checklist_items);
  const scores = computeScores(b, checklistItems);
  const signature = b.signature ? await uploadSignatureDataUrl(req.user.code, b.signature) : undefined;

  const sets = [];
  const args = [];
  for (const [col, val] of Object.entries({
    checklist_items: checklistItems ? JSON.stringify(checklistItems) : undefined,
    notes: b.notes,
    ai_summary: b.ai_summary,
    signature: signature !== undefined ? JSON.stringify(signature) : undefined,
    multi_proof: b.multi_proof ? JSON.stringify(b.multi_proof) : undefined,
    dispute: b.dispute ? JSON.stringify(b.dispute) : undefined,
    delay_reason: b.delay_reason,
    late_penalty_waived: b.late_penalty_waived != null ? (b.late_penalty_waived ? 1 : 0) : undefined,
    waived_by: b.waived_by,
    waived_by_name: b.waived_by_name,
escalated_to: b.escalated_to,
    escalated_to_name: b.escalated_to_name,
    escalation_level: b.escalation_level || null,
    escalated_at: b.escalated_at ? toMySqlDatetime(b.escalated_at) : undefined,
    approved_deadline: b.approved_deadline ? toMySqlDatetime(b.approved_deadline) : undefined,
    extension_request: b.extension_request ? JSON.stringify(b.extension_request) : undefined,
    extension_history: b.extension_history ? JSON.stringify(b.extension_history) : undefined,
    tr_score: scores.tr_score,
    completion_score: scores.completion_score,
    timeliness_score: scores.timeliness_score,
    quality_score: scores.quality_score
  })) {
    if (val !== undefined) { sets.push(`${col} = ?`); args.push(val); }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  await query(`UPDATE reports SET ${sets.join(', ')} WHERE code = ?`, [...args, req.params.code]);
  await logActivity(req.user, {
    action: 'REPORT_UPDATE',
    details: `Edited ${req.params.code} (${b.notes ? 'notes updated' : 'checklist/fields updated'})`,
    req
  });
  ok(res, { code: req.params.code });
}));

/** POST /api/reports/:code/submit */
router.post('/:code/submit', requireUser, requirePermission('submitTRReport'), asyncHandler(async (req, res) => {
const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  const superiorCodes = await getSubordinateCodes(req.user.code);
  if (req.user.code !== existing.staff_code
    && !['admin', 'executive', 'hr'].includes(req.user.role)
    && !superiorCodes.includes(existing.staff_code)) {
    throw new ApiError(403, 'Only the author, the reporter\'s superior, or an Admin may submit this report.');
  }
  if (existing.status === 'Approved') throw new ApiError(400, 'Approved reports cannot be resubmitted.');

  const b = req.body || {};
  const checklistItems = b.checklist_items || parseJson(existing.checklist_items);
  const scores = computeScores(b, checklistItems);
  const signature = b.signature
    ? JSON.stringify(await uploadSignatureDataUrl(req.user.code, b.signature))
    : existing.signature;
  const trScore = b.submission_rating ? Math.round(b.submission_rating * 100) / 100 : scores.tr_score;

  await query(
    `UPDATE reports
     SET checklist_items = ?, tr_score = ?, completion_score = ?, timeliness_score = ?, quality_score = ?,
         signature = ?, notes = ?, ai_summary = COALESCE(?, ai_summary), status = 'Submitted', submission_date = ?,
         multi_proof = COALESCE(?, multi_proof), delay_reason = COALESCE(?, delay_reason)
     WHERE code = ?`,
    [JSON.stringify(checklistItems), trScore, scores.completion_score, scores.timeliness_score, scores.quality_score,
     signature, b.notes ?? existing.notes, b.ai_summary ?? null, toMySqlDatetime(new Date()),
     b.multi_proof ? JSON.stringify(b.multi_proof) : null,
     b.delay_reason ?? null, req.params.code]
  );

  if (existing.superior_code) {
    await notifyUser({
      recipientCode: existing.superior_code, senderCode: req.user.code, senderName: req.user.name,
      type: 'REPORT_SUBMITTED', title: `Weekly report submitted: ${existing.staff_name}`,
      message: `${existing.staff_name} submitted ${existing.code} (${existing.start_date} → ${existing.end_date}), TR score ${trScore}.`,
      linkTab: 'reports'
    });
    await dispatchFlow({
      eventType: 'TR_SUBMIT',
      title: `Weekly T&R Report ${existing.code}`,
      staffName: existing.staff_name,
      department: existing.department,
      status: 'Submitted',
      score: Number(trScore),
      notes: 'Weekly checklist completed and digitally signed.',
      details: `Period: ${existing.start_date} → ${existing.end_date}\nSubmitted by ${req.user.name}`,
      targetUserCode: existing.superior_code,
      superiorName: null
    });
  }
  await logActivity(req.user, { action: 'REPORT_SUBMIT', details: `Submitted ${req.params.code}`, req });
  ok(res, { code: req.params.code, tr_score: trScore });
}));

/** POST /api/reports/:code/review — manager reviews + feedback */
router.post('/:code/review', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  // Anyone may review, but only a report that actually appears under their own
  // "Subordinate Submissions" tab — i.e. the owner must be in their reporting
  // chain. Recursive, so direct AND indirect superiors qualify. No permission
  // flag: reachability of the tab is decided by the hierarchy, not the matrix.
  // (The previous guard skipped this check entirely when superior_code was NULL,
  // which left the permission middleware as the only thing holding the line.)
  if (!['admin', 'executive', 'hr'].includes(req.user.role)) {
    if (existing.staff_code === req.user.code) throw new ApiError(403, 'You cannot review your own report.');
    const subs = await getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.staff_code)) throw new ApiError(403, 'This report is not from your team.');
  }
  if (existing.status !== 'Submitted' && existing.status !== 'Reviewed' && existing.status !== 'Approved') {
    throw new ApiError(400, 'Only submitted, reviewed, or approved reports can be evaluated.');
  }

const b = req.body || {};
  const status = b.status === 'Submitted' ? 'Submitted' : (b.approved ? 'Approved' : 'Reviewed');
  const isRevision = status === 'Submitted';

  const sets = ['status = ?', 'review_date = ?'];
  const args = [status, toMySqlDatetime(new Date())];

  if (isRevision) {
    // Sent back for revision: revert to a pending (awaiting review) look —
    // keep a preliminary completion-based tr_score (column is NOT NULL) but
    // drop the superior's sub-scores, remarks, and waiver for fresh re-evaluation.
    const checklistItems = parseJson(existing.checklist_items) || [];
    const preview = computeScores({}, checklistItems);
    sets.push(
      'tr_score = ?',
      'completion_score = ?',
      'timeliness_score = NULL',
      'quality_score = NULL',
      'manager_feedback = NULL',
      'late_penalty_waived = 0',
      'waived_by = NULL',
      'waived_by_name = NULL'
    );
    args.push(
      preview.tr_score,
      preview.completion_score
    );
  } else {
    sets.push('manager_feedback = ?');
    args.push(b.feedback ?? null);
    const numericCols = { tr_score: 'tr_score', completion_score: 'completion_score', timeliness_score: 'timeliness_score', quality_score: 'quality_score' };
    for (const [key, col] of Object.entries(numericCols)) {
      if (b[key] != null && !isNaN(Number(b[key]))) {
        sets.push(`\`${col}\` = ?`);
        args.push(Math.min(100, Math.max(0, Math.round(Number(b[key]) * 100) / 100)));
      }
    }
    if (b.late_penalty_waived != null) { sets.push('late_penalty_waived = ?'); args.push(b.late_penalty_waived ? 1 : 0); }
    if (b.waived_by != null) { sets.push('waived_by = ?'); args.push(b.waived_by); }
    if (b.waived_by_name != null) { sets.push('waived_by_name = ?'); args.push(b.waived_by_name); }
  }

  await query(
    `UPDATE reports SET ${sets.join(', ')} WHERE code = ?`,
    [...args, req.params.code]
  );

  await notifyUser({
    recipientCode: existing.staff_code, senderCode: req.user.code, senderName: req.user.name,
    type: status === 'Approved' ? 'REPORT_APPROVED' : 'REPORT_REVIEWED',
    title: isRevision ? `Weekly report needs revision` : `Weekly report ${status}`,
    message: isRevision
      ? `${req.user.name} sent ${existing.code} back for revision.`
      : `${req.user.name} ${status.toLowerCase()} ${existing.code}.`,
    linkTab: 'reports'
  });
  await dispatchFlow({
    eventType: 'TR_REVIEW',
    title: `Weekly T&R Report ${existing.code}`,
    staffName: existing.staff_name,
    superiorName: req.user.name,
    department: existing.department,
    status,
    score: !isRevision && b.tr_score != null && !isNaN(Number(b.tr_score)) ? Number(b.tr_score) : Number(existing.tr_score ?? 0),
    notes: isRevision ? 'Report sent back for revision. Scores cleared; please revise and resubmit.' : (b.feedback || 'Report reviewed by superior.')
  });
  // Always DM the report owner privately (their linked Telegram chat) on
  // approve / review / revise, independent of the group trigger toggles.
  await notifyUserTelegram({
    targetUserCode: existing.staff_code,
    eventType: 'TR_REVIEW',
    headerTitle: isRevision ? 'T&R REPORT SENT FOR REVISION' : (status === 'Approved' ? 'T&R REPORT OFFICIALLY APPROVED' : 'T&R REPORT REVIEWED'),
    title: `Weekly T&R Report ${existing.code}`,
    staffName: existing.staff_name,
    superiorName: req.user.name,
    department: existing.department,
    status: isRevision ? 'Needs Revision (Resubmission Requested)' : status,
    score: !isRevision && b.tr_score != null && !isNaN(Number(b.tr_score)) ? Number(b.tr_score) : undefined,
    notes: isRevision ? 'Score & remarks cleared. Please revise and resubmit.' : (b.feedback || 'Report reviewed by superior.')
  });
await logActivity(req.user, { action: 'REPORT_REVIEW', details: `${status} ${req.params.code}`, req });
  ok(res, { code: req.params.code, status });
}));

/**
 * POST /api/reports/:code/extension/review — superior approves/declines a
 * staff deadline-extension request. Uses the reporter's review permission (a
 * plain manager is NOT the report author, so the general PUT route forbids it).
 */
router.post('/:code/extension/review', requireUser, requirePermission('viewTeamTRReports'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  if (!['admin', 'executive', 'hr'].includes(req.user.role)
    && existing.superior_code && existing.superior_code !== req.user.code) {
    const subs = await (await import('../services/scoping.js')).getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.staff_code)) throw new ApiError(403, 'This report is not from your team.');
  }

  const b = req.body || {};
  const decision = b.decision === 'Approved' ? 'Approved' : 'Rejected';

  const sets = ['extension_request = ?', 'extension_history = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const args = [
    JSON.stringify(b.extension_request ?? parseJson(existing.extension_request)),
    JSON.stringify(b.extension_history ?? parseJson(existing.extension_history) ?? [])
  ];

  if (decision === 'Approved') {
    const deadline = String(b.approved_deadline || existing.approved_deadline || '').replace('T', ' ');
    if (deadline) { sets.push('approved_deadline = ?'); args.push(deadline); }
    sets.push('late_penalty_waived = 1');
  } else {
    sets.push('late_penalty_waived = 0');
  }
  if (b.waived_by != null) { sets.push('waived_by = ?'); args.push(b.waived_by); }
  if (b.waived_by_name != null) { sets.push('waived_by_name = ?'); args.push(b.waived_by_name); }

  await query(`UPDATE reports SET ${sets.join(', ')} WHERE code = ?`, [...args, req.params.code]);

  await notifyUser({
    recipientCode: existing.staff_code, senderCode: req.user.code, senderName: req.user.name,
    type: decision === 'Approved' ? 'REPORT_EXTENSION_APPROVED' : 'REPORT_EXTENSION_REJECTED',
    title: `Deadline extension ${decision.toLowerCase()}`,
    message: `${req.user.name} ${decision.toLowerCase()} your deadline-extension request for ${existing.code}.`,
    linkTab: 'reports'
  });
  await notifyUserTelegram({
    targetUserCode: existing.staff_code,
    eventType: 'TR_REVIEW',
    headerTitle: decision === 'Approved' ? 'DEADLINE EXTENSION APPROVED' : 'DEADLINE EXTENSION DECLINED',
    title: `Weekly T&R Report ${existing.code}`,
    staffName: existing.staff_name,
    superiorName: req.user.name,
    department: existing.department,
    status: decision === 'Approved' ? 'Approved — Extended Deadline' : 'Declined — Standard Deadline Applies',
    notes: b.review_note || (decision === 'Approved'
      ? 'Full 20/20 punctuality score granted if submitted by the approved deadline.'
      : 'Standard Monday 11:30 AM deadline applies.')
  });
  await logActivity(req.user, { action: 'REPORT_EXTENSION_REVIEW', details: `${decision} extension for ${req.params.code}`, req });
  ok(res, { code: req.params.code, decision });
}));

/** DELETE /api/reports/:code — the reporter's superior or admin/executive/hr may delete at any status (incl. Approved); authors may only delete their own reports while still a Draft */
router.delete('/:code', requireUser, requirePermission('submitTRReport'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  const superiorCodes = await getSubordinateCodes(req.user.code);
  if (req.user.code !== existing.staff_code
    && !['admin', 'executive', 'hr'].includes(req.user.role)
    && !superiorCodes.includes(existing.staff_code)) {
    throw new ApiError(403, 'Only the author, the reporter\'s superior, or an Admin may delete this report.');
  }
  const isManagement = ['admin', 'executive', 'hr'].includes(req.user.role) || superiorCodes.includes(existing.staff_code);
  if (!isManagement && existing.status !== 'Draft') throw new ApiError(400, 'You can only delete your own report while it is still a Draft.');
  // Delete the row (and its Weekly Summary Form side-table row) FIRST, then
  // clean up S3. deleteProofFilesFromS3 never throws, so a failed S3 call can
  // only leak an orphan object — never leave a row pointing at deleted files.
  await query('DELETE FROM reports WHERE code = ?', [req.params.code]);
  await query('DELETE FROM tr_weekly_summaries WHERE report_code = ?', [req.params.code]).catch(() => {});
  const removedFiles = await deleteProofFilesFromS3([existing.multi_proof], []);
  if (existing.superior_code) {
    await notifyUser({
      recipientCode: existing.superior_code, senderCode: req.user.code, senderName: req.user.name,
      type: 'REPORT_DELETED', title: `Weekly report deleted: ${existing.staff_name}`,
      message: `${req.user.name} deleted ${existing.code}.`, linkTab: 'reports'
    }).catch(() => {});
  }
  await logActivity(req.user, {
    action: 'REPORT_DELETE',
    details: `Deleted ${req.params.code}` +
      (removedFiles.length ? ` and ${removedFiles.length} proof file(s) from S3` : ''),
    req
  });
  ok(res, { deleted: true, files_deleted: removedFiles.length });
}));

/** POST /api/reports/:code/dispute — staff submits a score dispute */
router.post('/:code/dispute', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  if (req.user.code !== existing.staff_code && !['admin', 'executive', 'hr'].includes(req.user.role)) {
    throw new ApiError(403, 'Only the staff owner may file a dispute.');
  }
  const current = parseJson(existing.dispute);
  if (current && current.status === 'Pending') throw new ApiError(400, 'A dispute is already pending for this report.');

  const reason = (req.body?.reason || '').trim();
  if (!reason) throw new ApiError(400, 'Dispute rationale is required.');

  const dispute = {
    status: 'Pending',
    reason,
    requestedAt: new Date().toISOString(),
    staffId: existing.staff_code,
    staffName: existing.staff_name,
    originalScore: Number(existing.tr_score) || 0
  };
  await query('UPDATE reports SET dispute = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?',
    [JSON.stringify(dispute), req.params.code]);

  if (existing.superior_code) {
    await notifyUser({
      recipientCode: existing.superior_code, senderCode: req.user.code, senderName: req.user.name,
      type: 'DISPUTE_SUBMITTED', title: 'Staff score dispute filed',
      message: `${existing.staff_name} filed a dispute for Week ${existing.week_number} report (Current: ${existing.tr_score}%). Reason: "${reason}"`,
      linkTab: 'reports'
    });
  }
  await logActivity(req.user, { action: 'SCORE_DISPUTE_SUBMITTED', details: `Dispute filed for ${req.params.code}: ${reason}`, req });
  ok(res, { success: true, dispute });
}));

/** POST /api/reports/:code/dispute/resolve — superior resolves a score dispute */
router.post('/:code/dispute/resolve', requireUser, requirePermission('viewTeamTRReports'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM reports WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Report not found.');
  const current = parseJson(existing.dispute);
  if (!current) throw new ApiError(400, 'No dispute found for this report.');
  if (current.status !== 'Pending') throw new ApiError(400, 'This dispute has already been resolved.');

  if (!['admin', 'executive', 'hr'].includes(req.user.role)
    && existing.superior_code && existing.superior_code !== req.user.code) {
    const subs = await (await import('../services/scoping.js')).getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.staff_code)) throw new ApiError(403, 'This report is not from your team.');
  }

  const b = req.body || {};
  const decision = b.decision === 'accept' ? 'Resolved' : (b.decision === 'reject' ? 'Rejected' : null);
  if (!decision) throw new ApiError(400, 'decision must be "accept" or "reject".');
  const resolutionNote = (b.resolution_note || '').trim();
  if (!resolutionNote) throw new ApiError(400, 'Resolution note is required.');
  const revisedScore = b.decision === 'accept' && b.revised_score != null
    ? Math.round(Number(b.revised_score) * 100) / 100 : undefined;

  const finalScore = revisedScore !== undefined ? revisedScore : Number(existing.tr_score) || 0;
  const resolved = {
    ...current,
    status: decision,
    resolvedAt: new Date().toISOString(),
    resolvedBy: req.user.code,
    resolvedByName: req.user.name,
    resolutionNote,
    revisedScore: decision === 'Resolved' ? finalScore : undefined
  };
  await query(
    `UPDATE reports SET dispute = ?, tr_score = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?`,
    [JSON.stringify(resolved), finalScore, req.params.code]
  );

  await notifyUser({
    recipientCode: existing.staff_code, senderCode: req.user.code, senderName: req.user.name,
    type: 'DISPUTE_RESOLVED', title: 'Score dispute resolved',
    message: `Your dispute for Week ${existing.week_number} report was ${decision === 'Resolved' ? 'accepted' : 'upheld'} (Score: ${finalScore}%). Note: "${resolutionNote}"`,
    linkTab: 'reports'
  });
  await logActivity(req.user, { action: 'SCORE_DISPUTE_RESOLVED', details: `${decision} dispute for ${req.params.code} -> ${finalScore}%`, req });
  ok(res, { success: true, dispute: resolved, tr_score: finalScore });
}));

export default router;
