import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne } from '../config/db.js';
import { requireUser, requirePermission } from '../middleware/auth.js';
import { getSubordinateCodes } from '../services/scoping.js';
import { logActivity, notifyUser, makeCode } from '../services/audit.js';
import { toMySqlDatetime } from '../services/auth.js';
import { prepareSignature, uploadSignatureDataUrl } from '../services/s3.js';
import { dispatchFlow } from '../services/notificationFlow.js';
import { autoLockScan } from '../services/deadline.js';

const router = Router();
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

function parseJson(v) {
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

async function withDisplay(row, comments) {
  const base = {
    ...row,
    signature: parseJson(row.signature),
    multiProof: parseJson(row.multi_proof),
    dispute: parseJson(row.dispute),
    revisionHistory: parseJson(row.revision_history),
    unlockHistory: parseJson(row.unlock_history),
    unlockBy: row.unlock_by || undefined,
    isDefaulted: !!row.is_defaulted,
    defaultedAt: row.defaulted_at || undefined,
    escalationLevel: row.escalation_level || null,
    isEscalated: !!row.is_escalated
  };
  if (comments) base.comments = comments;
  if (base.signature) base.signature_display = await prepareSignature(base.signature);
  return base;
}

async function attachComments(rows) {
  if (!rows.length) return rows;
  const codes = rows.map((r) => r.code);
  const commentRows = await query(
    `SELECT * FROM trs_task_comments WHERE task_code IN (${codes.map(() => '?').join(',')}) ORDER BY created_at ASC`,
    codes
  );
  const byTask = {};
  for (const c of commentRows) {
    (byTask[c.task_code] = byTask[c.task_code] || []).push({
      id: c.code,
      taskId: c.task_code,
      userId: c.author_id,
      userName: c.author_name,
      userRole: c.author_role || 'staff',
      userAvatar: c.author_avatar_url || undefined,
      authorId: c.author_id,
      authorName: c.author_name,
      authorRole: c.author_role || 'staff',
      message: c.message,
      createdAt: c.created_at || c.createdAt || '',
      replyToCommentId: c.reply_to_code || undefined,
      replyToId: c.reply_to_code || undefined
    });
  }
  return rows.map((r) => ({ ...r, comments: byTask[r.code] || [] }));
}

/**
 * TRS Task Timeliness — scored out of 40 points (Factor 1 of the 2-factor model:
 * 40 pts timeliness + 60 pts superior quality).
 *
 * Bands are taken verbatim from the "3. TRS Delegated Tasks" tab of
 * frontend/src/components/PolicyModal.tsx ("TRS Task Timeliness Deduction
 * Schedule", 40 Points Max). The same table is implemented in the frontend by
 * calculateTimelinessScore() in deadlineAlertService.ts, which is what every
 * TRS surface renders against ("x / 40", waiver checkbox at < 40, and
 * total = timeliness + quality capped at 100) — the two must stay identical.
 *
 * It previously returned a 0-100 value (100 on time, -10/day late), which was
 * stored into trs_tasks.timeliness_score on submit. That surfaced as "100 / 40"
 * and, worse, made the review total `min(100, 100 + quality)` — i.e. every graded
 * task scored 100% regardless of quality, and the late-penalty waiver (which only
 * shows below 40) could never appear.
 *
 * > 7 days overdue is NOT handled here: unsubmitted/abandoned tasks are defaulted
 * to a flat 0% by services/deadline.js, which owns that path.
 */
function timelinessScore(completionDate, deadline) {
  if (!completionDate || !deadline) return null;
  const comp = new Date(completionDate);
  const dead = new Date(deadline);
  comp.setHours(0, 0, 0, 0); dead.setHours(0, 0, 0, 0);
  const days = Math.round((comp - dead) / 86400000);
  if (days <= 0) return 40;
  if (days === 1) return 30;
  if (days <= 3) return 20;
  if (days <= 5) return 10;
  return 0;
}

/** GET /api/trs?assignedTo=&status=&selfOnly= */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  const { status, assignedTo } = req.query;
  const conds = [];
  const args = [];

  if (!['admin', 'executive', 'hr'].includes(actor.role)) {
    const subs = await getSubordinateCodes(actor.code);
    const ids = [actor.code, ...subs];
    conds.push(`(assigned_to IN (${ids.map(() => '?').join(',')}) OR assigned_by = ?)`);
    args.push(...ids, actor.code);
  }
  if (status) { conds.push('status = ?'); args.push(status); }
  if (assignedTo) { conds.push('assigned_to = ?'); args.push(assignedTo); }

  const rows = await query(
    `SELECT * FROM trs_tasks WHERE ${conds.length ? conds.join(' AND ') : '1=1'}
     ORDER BY FIELD(status, 'Defaulted','Overdue','Pending','In Progress','Completed','Approved'), deadline ASC`,
    args
  );
  const withComments = await attachComments(rows);
  const out = [];
  for (const r of withComments) out.push(await withDisplay(r, r.comments));
  ok(res, out);
}));

/** POST /api/trs/scan-lock — run an auto-lock scan on login. Admin/exec/HR scan
 *  all tasks; regular staff only their own assigned tasks. Never re-locks a task
 *  a superior already unlocked (unlock_by IS NOT NULL). */
router.post('/scan-lock', requireUser, asyncHandler(async (req, res) => {
  const isSuper = ['admin', 'executive', 'hr'].includes(req.user.role);
  const result = await autoLockScan({ assignedTo: isSuper ? undefined : req.user.code });
  ok(res, { scanned: result.scanned, locked: result.locked, scope: isSuper ? 'all' : 'own' });
}));

router.get('/:code', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!row) throw new ApiError(404, 'Task not found.');
  const actor = req.user;
  if (!['admin', 'executive', 'hr'].includes(actor.role)) {
    const subs = await getSubordinateCodes(actor.code);
    const okOwn = row.assigned_to === actor.code || row.assigned_by === actor.code || subs.includes(row.assigned_to) || subs.includes(row.assigned_by);
    if (!okOwn) throw new ApiError(403, 'No access to this task.');
  }
  const [withComments] = await attachComments([row]);
  ok(res, await withDisplay(withComments, withComments.comments));
}));

/** POST /api/trs — create/delegate a task. Open to every authenticated staff
 *  member: there is no assignTRSTasks feature flag (it was removed from the
 *  Dynamic Feature Access matrix). Who you may delegate TO is still constrained
 *  by the reporting hierarchy below, so this cannot be used to assign work to
 *  arbitrary staff outside your own chain. */
router.post('/', requireUser, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const actor = req.user;
  const assignedTo = b.assigned_to;
  const assignedBy = b.assigned_by || actor.code;
  if (!b.title || !assignedTo || !b.assigned_date || !b.deadline) {
    throw new ApiError(400, 'title, assigned_to, assigned_date and deadline are required.');
  }

  const target = await getOne('SELECT * FROM users WHERE code = ?', [assignedTo]);
  if (!target) throw new ApiError(404, 'Assigned staff not found.');
  const creator = await getOne('SELECT * FROM users WHERE code = ?', [assignedBy]);

  // Non-admins may only assign to self or subordinates
  if (!['admin', 'executive', 'hr'].includes(actor.role)) {
    const subs = await getSubordinateCodes(actor.code);
    if (assignedTo !== actor.code && !subs.includes(assignedTo)) {
      throw new ApiError(403, 'You can only assign tasks to yourself or your subordinates.');
    }
  }

  if (b.priority && !PRIORITIES.includes(b.priority)) throw new ApiError(400, 'Invalid priority.');

  const code = makeCode('trs');
  await query(
    `INSERT INTO trs_tasks
      (code, title, assigned_by, assigned_by_name, assigned_to, assigned_to_name, department,
       description, assigned_date, deadline, task_code, project, priority, progress,
       instructions, scope, quality_criteria, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      code, b.title, assignedBy, creator?.name || actor.name, assignedTo, target.name, b.department || target.department || '',
      b.description || null, b.assigned_date, b.deadline, b.task_code || null, b.project || null,
      b.priority || 'Medium', Math.min(Math.max(b.progress ?? 0, 0), 100),
      b.instructions ?? null, b.scope ?? null, b.quality_criteria ?? null, 'Pending'
    ]
  );

  await notifyUser({
    recipientCode: assignedTo, senderCode: assignedBy, senderName: creator?.name || 'Manager',
    type: 'TRS_ASSIGNED', title: `New task: ${b.title}`, message: `${code} assigned to you, deadline ${b.deadline}.`,
    linkTab: 'trs'
  });
  await dispatchFlow({
    eventType: 'TRS_ASSIGN',
    title: b.title,
    staffName: target.name,
    superiorName: creator?.name || actor.name,
    department: b.department || target.department,
    deadline: b.deadline,
    status: 'Pending',
    priority: b.priority,
    notes: b.description || 'Direct task requested in TRS.',
    details: `Task code: ${code}\nAssigned by ${creator?.name || actor.name}`,
    targetUserCode: assignedTo
  });
  await logActivity(actor, { action: 'TRS_CREATE', details: `Created ${code} for ${assignedTo}`, req });
  ok(res, { code }, 201);
}));

/** PUT /api/trs/:code — edit metadata (creator, assignee's superior, or management; before completed/evaluated) */
router.put('/:code', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  const superiorCodes = await getSubordinateCodes(req.user.code);
  if (!['admin', 'executive', 'hr'].includes(req.user.role) && existing.assigned_by !== req.user.code && !superiorCodes.includes(existing.assigned_to)) {
    throw new ApiError(403, 'Only the creator, an Admin, or the assignee\'s superior may edit this task.');
  }
  // Approved & Completed is the final grade and stays immutable.
  if (existing.evaluation_status === 'Approved' || (existing.status === 'Completed' && existing.evaluation_status)) {
    throw new ApiError(400, 'Task is locked after evaluation.');
  }
  const b = req.body || {};
  const mapCols = {
    title: 'title', description: 'description', deadline: 'deadline', assigned_date: 'assigned_date',
    priority: 'priority', progress: 'progress', instructions: 'instructions', scope: 'scope',
    quality_criteria: 'quality_criteria', task_code: 'task_code', project: 'project', department: 'department',
    delay_reason: 'delay_reason', late_penalty_waived: 'late_penalty_waived'
  };
  const sets = [];
  const args = [];
  for (const [k, col] of Object.entries(mapCols)) {
    if (b[k] !== undefined) {
      let v = b[k];
      if (k === 'progress') v = Math.min(Math.max(Number(v), 0), 100);
      if (k === 'late_penalty_waived') v = v ? 1 : 0;
      if (k === 'priority' && !PRIORITIES.includes(v)) throw new ApiError(400, 'Invalid priority.');
      sets.push(`${col} = ?`); args.push(v);
    }
  }
  for (const [col, key] of [['multi_proof', 'multi_proof'], ['dispute', 'dispute'], ['revision_history', 'revision_history']]) {
    if (b[key] !== undefined) { sets.push(`${col} = ?`); args.push(JSON.stringify(b[key])); }
  }
  const escFields = {
    is_escalated: (v) => (v ? 1 : 0),
    escalation_level: (v) => (['none', 'reminded', 'escalated'].includes(v) ? v : null),
    escalated_to: (v) => v,
    escalated_to_name: (v) => v,
    escalated_reason: (v) => v
  };
  for (const [col, normalize] of Object.entries(escFields)) {
    if (b[col] !== undefined) { sets.push(`${col} = ?`); args.push(b[col] === null ? null : normalize(b[col])); }
  }
  if (b.escalated_at !== undefined) { sets.push('escalated_at = ?'); args.push(toMySqlDatetime(b.escalated_at)); }
  if (!sets.length) throw new ApiError(400, 'Nothing to update.');
  await query(`UPDATE trs_tasks SET ${sets.join(', ')} WHERE code = ?`, [...args, req.params.code]);
  await logActivity(req.user, { action: 'TRS_UPDATE', details: `Updated ${req.params.code}`, req });
  ok(res, { code: req.params.code });
}));

/** DELETE /api/trs/:code — creator, assignee's superior, or management */
router.delete('/:code', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  const superiorCodes = await getSubordinateCodes(req.user.code);
  if (!['admin', 'executive', 'hr'].includes(req.user.role) && existing.assigned_by !== req.user.code && !superiorCodes.includes(existing.assigned_to)) {
    throw new ApiError(403, 'Only the creator, an Admin, or the assignee\'s superior may delete this task.');
  }
  if (existing.evaluation_status === 'Approved') throw new ApiError(400, 'Approved tasks cannot be deleted.');
  await query('DELETE FROM trs_tasks WHERE code = ?', [req.params.code]);
  await logActivity(req.user, { action: 'TRS_DELETE', details: `Deleted ${req.params.code} (${existing.title})`, req });
  ok(res, { deleted: true });
}));

/** POST /api/trs/:code/submit — staff submits completed work */
router.post('/:code/submit', requireUser, requirePermission('submitTRSTasks'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  if (req.user.code !== existing.assigned_to && !['admin', 'executive', 'hr'].includes(req.user.role)) {
    throw new ApiError(403, 'Only the assignee can submit this task.');
  }
if (existing.status === 'Completed' || existing.status === 'Approved') {
    throw new ApiError(400, 'Task already completed.');
  }
  if (existing.is_defaulted) {
    throw new ApiError(400, 'Task is auto-locked at 0% (7+ days past deadline). Superior administrative unlock required before submission.');
  }
  const b = req.body || {};
  const module = { ...existing };
  const completionDate = b.completion_date || new Date().toISOString().slice(0, 10);
  const tScore = timelinessScore(completionDate, existing.deadline);
  const signature = b.signature ? JSON.stringify(await uploadSignatureDataUrl(req.user.code, b.signature)) : null;

  await query(
    `UPDATE trs_tasks
     SET progress = 100, status = 'Completed', completion_date = ?, submitted_at = ?,
         submission_notes = ?, proof_url = ?, staff_remarks = ?, timeliness_score = ?,
         signature = ?, multi_proof = COALESCE(?, multi_proof), delay_reason = COALESCE(?, delay_reason)
     WHERE code = ?`,
    [completionDate, toMySqlDatetime(new Date()), b.submission_notes ?? null, b.proof_url ?? null,
     b.staff_remarks ?? null, tScore, b.signature ? JSON.stringify(b.signature) : null,
     b.multi_proof ? JSON.stringify(b.multi_proof) : null,
     b.delay_reason ?? null, req.params.code]
  );

  await notifyUser({
    recipientCode: existing.assigned_by, senderCode: req.user.code, senderName: req.user.name,
    type: 'TRS_SUBMITTED', title: `Task submitted: ${existing.title}`,
    message: `${req.user.name} completed ${req.params.code} (${completionDate}). Pending evaluation.`,
    linkTab: 'trs'
  });
  await dispatchFlow({
    eventType: 'TRS_SUBMIT',
    title: existing.title,
    staffName: existing.assigned_to_name,
    superiorName: existing.assigned_by_name,
    department: existing.department || undefined,
    deadline: existing.deadline,
    status: 'Completed',
    notes: b.staff_remarks || b.submission_notes || 'Deliverable submitted.',
    details: `Task ${req.params.code} completed on ${completionDate}\nProof: ${b.proof_url || 'N/A'}`,
    targetUserCode: existing.assigned_by
  });
  await logActivity(req.user, { action: 'TRS_SUBMIT', details: `Submitted ${req.params.code}`, req });
  ok(res, { code: req.params.code, timeliness_score: tScore });
}));

/** POST /api/trs/:code/start — mark in progress */
router.post('/:code/start', requireUser, requirePermission('submitTRSTasks'), asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT code, status FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  if (existing.status === 'Completed' || existing.status === 'Approved') throw new ApiError(400, 'Task is closed.');
  await query(`UPDATE trs_tasks SET status = 'In Progress' WHERE code = ?`, [req.params.code]);
  ok(res, { code: req.params.code, status: 'In Progress' });
}));

/** POST /api/trs/:code/progress — quick progress update */
router.post('/:code/progress', requireUser, requirePermission('submitTRSTasks'), asyncHandler(async (req, res) => {
  const p = Number(req.body?.progress);
  if (isNaN(p) || p < 0 || p > 100) throw new ApiError(400, 'progress must be 0-100.');
  const existing = await getOne('SELECT code, title, assigned_to, assigned_to_name, assigned_by, assigned_by_name, department, deadline FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  // 100% deliberately stays 'In Progress': only POST /:code/submit may set Completed,
  // and that route rejects a task that is already Completed. So reaching full
  // progression means "ready to submit", never "submitted".
  const nextStatus = p === 0 ? 'Pending' : 'In Progress';
  await query(`UPDATE trs_tasks SET progress = ?, status = ? WHERE code = ?`, [p, nextStatus, req.params.code]);
  await dispatchFlow({
    eventType: 'TRS_STATUS',
    title: existing.title,
    staffName: existing.assigned_to_name,
    superiorName: existing.assigned_by_name,
    department: existing.department || undefined,
    deadline: existing.deadline,
    status: nextStatus,
    score: p,
    notes: req.body?.remark || null,
    details: `Task ${existing.code} progress updated to ${p}%`,
    targetUserCode: existing.assigned_by
  });
  ok(res, { code: req.params.code, progress: p });
}));

/** POST /api/trs/:code/evaluate — assigner/admin evaluates */
router.post('/:code/evaluate', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  // Anyone may grade, but only a task belonging to someone in their own reporting
  // chain — the same set shown under "Subordinate TRS Reports". Recursive, so
  // direct AND indirect superiors qualify. Previously requirePermission was the
  // ONLY guard on this route, so holding gradeTRSTasks let a user grade any task
  // in the system, including their own.
  if (!['admin', 'executive', 'hr'].includes(req.user.role)) {
    if (existing.assigned_to === req.user.code) throw new ApiError(403, 'You cannot grade your own task.');
    const subs = await getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.assigned_to) && existing.assigned_by !== req.user.code) {
      throw new ApiError(403, 'This task does not belong to your team.');
    }
  }
  if (existing.status !== 'Completed' && existing.status !== 'Approved') {
    throw new ApiError(400, 'Only completed tasks can be evaluated.');
  }
  const b = req.body || {};
  const isRevision = !!(b.revision === true || b.revision === 1 || b.revision === '1');

  // PolicyModal tab 3, "Maximum 2 Revision Cycles": a superior may send the task
  // back for rework at most 2 times; after that it is locked for final grading
  // as-is. This is the path the UI actually uses (POST /evaluate with
  // revision: true) — /reopen is the equivalent API-only variant below.
  const revisionCount = Number(existing.revision_count) || 0;
  if (isRevision && revisionCount >= 2) {
    throw new ApiError(400, `Revision limit reached (${revisionCount} of 2 cycles used). This task is now locked for final grading as-is.`);
  }

  // ---------------------------------------------------------------------------
  // TRS rubric — "3. TRS Delegated Tasks" tab of PolicyModal.tsx:
  //   100 Pts Standard = 40 Pts Timeliness (automated) + 60 Pts Quality
  //   Quality = Instruction Compliance (20) + Scope Coverage (20) + Accuracy (20)
  // The total is DERIVED here from the two factors rather than trusted from the
  // client, so a stale/incorrect payload can never write a total the rubric
  // cannot represent (this exact class of bug previously pinned every graded
  // task to 100%).
  // ---------------------------------------------------------------------------

  // Factor 1 — Timeliness (0-40). The automated band schedule is authoritative.
  const automated = timelinessScore(existing.completion_date, existing.deadline);
  // Policy row 1: "On-Time (or Approved Extension / Waived)" = full 40.
  const waived = b.late_penalty_waived === undefined
    ? !!existing.late_penalty_waived
    : !!(b.late_penalty_waived === true || b.late_penalty_waived === 1 || b.late_penalty_waived === '1');
  const timeliness = waived ? 40 : (automated ?? 40);

  // Factor 2 — Quality (0-60), graded by the superior across three 20-pt standards.
  const clamp20 = (v) => Math.min(20, Math.max(0, Number(v) || 0));
  const hasParts = b.instruction_score != null || b.scope_score != null || b.accuracy_score != null;
  let instruction = null, scope = null, accuracy = null, quality = null;
  if (hasParts) {
    // Each standard is independently capped at 20, so quality <= 60 by construction.
    instruction = clamp20(b.instruction_score);
    scope = clamp20(b.scope_score);
    accuracy = clamp20(b.accuracy_score);
    quality = instruction + scope + accuracy;
  } else if (b.quality_score != null) {
    // Legacy payload without the three components — keep the aggregate only.
    quality = Math.min(60, Math.max(0, Number(b.quality_score) || 0));
  }

  // Total = Factor 1 + Factor 2, capped at 100 (policy "Max Task Score" column:
  // 100 / 90 / 80 / 70 / 60 as the timeliness band drops).
  let score;
  if (quality !== null) {
    score = Math.min(100, Math.max(0, timeliness + quality));
  } else if (b.score !== undefined && b.score !== null && b.score !== '') {
    score = Number(b.score);
    if (isNaN(score) || score < 0 || score > 100) throw new ApiError(400, 'Invalid score (0-100).');
  } else {
    score = Math.min(100, Math.max(0, timeliness));
  }

  // A revision request returns the task to the assignee: status back to
  // 'In Progress', the score cleared (it is provisional until the final grade),
  // and the revision counter advanced.
  //
  // NOTE: trs_tasks.status is ENUM('Pending','In Progress','Completed','Overdue',
  // 'Defaulted') — it has NO 'Approved' member. Approval is recorded in
  // evaluation_status (ENUM('Approved','Reviewed','Revision')). Writing 'Approved'
  // here raised MySQL 1265 WARN_DATA_TRUNCATED and aborted the whole grade.
  const status = isRevision ? 'In Progress' : 'Completed';
  const evaluationStatus = b.approved ? 'Approved' : (isRevision ? 'Revision' : 'Reviewed');
  await query(
    `UPDATE trs_tasks
     SET score = ?, feedback = ?, evaluation_status = ?, evaluation_date = ?, evaluated_by = ?,
         timeliness_score = ?, quality_score = ?, instruction_score = ?, scope_score = ?,
         accuracy_score = ?, late_penalty_waived = ?, status = ?,
         revision_count = COALESCE(revision_count,0) + ? WHERE code = ?`,
    [isRevision ? null : score, b.feedback ?? null, evaluationStatus,
      new Date().toISOString().slice(0, 10), req.user.code,
      timeliness, quality, instruction, scope, accuracy, waived ? 1 : 0, status,
      isRevision ? 1 : 0, req.params.code]
  );


  await notifyUser({
    recipientCode: existing.assigned_to, senderCode: req.user.code, senderName: req.user.name,
    type: isRevision ? 'TRS_REVISION' : 'TRS_EVALUATED',
    title: isRevision ? `Task sent back for revision: ${existing.title}` : `Task evaluated: ${existing.title}`,
    message: isRevision
      ? `Please revise ${existing.code}.${b.feedback ? ` Reason: ${b.feedback}` : ''} (revision ${revisionCount + 1} of 2)`
      : `${existing.code} scored ${score}${b.feedback ? ` — ${b.feedback}` : ''}.`,
    linkTab: 'trs'
  });
  await dispatchFlow({
    eventType: 'TRS_SCORE',
    title: existing.title,
    staffName: existing.assigned_to_name,
    superiorName: req.user.name,
    department: existing.department || undefined,
    deadline: existing.deadline,
    status: evaluationStatus,
    score: isRevision ? null : score,
    notes: b.feedback || (isRevision ? 'Task returned for revision.' : 'Task evaluated.'),
    details: isRevision
      ? `Task ${req.params.code} sent back for revision (cycle ${revisionCount + 1} of 2)`
      : `Task ${req.params.code} evaluation completed\nTimeliness: ${timeliness}/40${waived ? ' (waived)' : ''} | Quality: ${quality === null ? '—' : `${quality}/60`}`,
    targetUserCode: existing.assigned_to
  });
  await logActivity(req.user, {
    action: 'TRS_EVALUATE',
    details: isRevision
      ? `${req.params.code} sent back for revision (cycle ${revisionCount + 1} of 2)`
      : `${req.params.code} score=${score} (timeliness ${timeliness}/40${waived ? ' waived' : ''}, quality ${quality === null ? '—' : quality + '/60'})`,
    req
  });
  ok(res, {
    code: req.params.code,
    status,
    evaluation_status: evaluationStatus,
    score: isRevision ? null : score,
    timeliness_score: timeliness,
    quality_score: quality,
    late_penalty_waived: !!waived,
    revision_count: revisionCount + (isRevision ? 1 : 0)
  });
}));

/** POST /api/trs/:code/reopen — send back for revision */
router.post('/:code/reopen', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT code, status, assigned_to, assigned_by, revision_count FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  // Same hierarchy rule as /evaluate — a task in your own reporting chain only.
  if (!['admin', 'executive', 'hr'].includes(req.user.role)) {
    if (existing.assigned_to === req.user.code) throw new ApiError(403, 'You cannot reopen your own task.');
    const subs = await getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.assigned_to) && existing.assigned_by !== req.user.code) {
      throw new ApiError(403, 'This task does not belong to your team.');
    }
  }
  // PolicyModal tab 3, "Maximum 2 Revision Cycles": superiors may request a
  // revision up to 2 times; if the deliverable is still unsatisfactory the task
  // is locked for final grading as-is, to avoid an infinite revision loop.
  const revisionCount = Number(existing.revision_count) || 0;
  if (revisionCount >= 2) {
    throw new ApiError(400, `Revision limit reached (${revisionCount} of 2 cycles used). This task is now locked for final grading as-is.`);
  }
  await query(
    `UPDATE trs_tasks SET status = 'In Progress', evaluation_status = 'Revision', score = NULL, feedback = ?, revision_count = COALESCE(revision_count,0) + 1 WHERE code = ?`,
    [req.body?.feedback ?? null, req.params.code]
  );
  await notifyUser({
    recipientCode: req.body?.assigned_to || existing.assigned_to, senderCode: req.user.code, senderName: req.user.name,
    type: 'TRS_REVISION', title: `Task sent back for revision: ${existing.code}`,
    message: `Please revise ${existing.code}.${req.body?.feedback ? ` Reason: ${req.body.feedback}` : ''}`,
    linkTab: 'trs'
  }).catch(() => {});
  await logActivity(req.user, { action: 'TRS_REOPEN', details: `Reopened ${req.params.code}`, req });
  ok(res, { code: req.params.code, status: 'In Progress' });
}));

/** POST /api/trs/:code/comments — add a threaded comment (assignee or assigner) */
router.post('/:code/comments', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  const actor = req.user;
  const subs = !['admin', 'executive', 'hr'].includes(actor.role) ? await getSubordinateCodes(actor.code) : [];
  if (!['admin', 'executive', 'hr'].includes(actor.role)
    && existing.assigned_to !== actor.code && existing.assigned_by !== actor.code && !subs.includes(existing.assigned_to)) {
    throw new ApiError(403, 'No access to comment on this task.');
  }

  const message = (req.body?.message || '').trim();
  if (!message) throw new ApiError(400, 'Comment message is required.');
  const replyTo = req.body?.reply_to_code || req.body?.reply_to || null;

  const code = makeCode('cmt');
  await query(
    `INSERT INTO trs_task_comments (code, task_code, author_id, author_name, author_role, author_avatar_url, message, reply_to_code)
     VALUES (?,?,?,?,?,?,?,?)`,
    [code, req.params.code, actor.code, actor.name, actor.role, actor.avatar_url || null, message, replyTo]
  );

  const comment = {
    id: code,
    taskId: req.params.code,
    userId: actor.code,
    userName: actor.name,
    userRole: actor.role,
    authorId: actor.code,
    authorName: actor.name,
    authorRole: actor.role,
    message,
    createdAt: new Date().toISOString(),
    replyToCommentId: replyTo || undefined,
    replyToId: replyTo || undefined
  };

  const recipient = actor.code === existing.assigned_to ? existing.assigned_by : existing.assigned_to;
  await notifyUser({
    recipientCode: recipient, senderCode: actor.code, senderName: actor.name,
    type: 'TASK_UPDATED', title: `New message on task: ${existing.title}`,
    message: `${actor.name} posted a comment: "${message.length > 80 ? message.slice(0, 80) + '...' : message}"`,
    linkTab: 'trs'
  });
  await logActivity(actor, { action: 'TASK_COMMENT_ADDED', details: `Comment on ${req.params.code}`, req });
  ok(res, { success: true, comment, messageText: 'Comment posted successfully.' }, 201);
}));

/** POST /api/trs/:code/dispute — staff submits a score dispute for a completed task */
router.post('/:code/dispute', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  if (req.user.code !== existing.assigned_to && !['admin', 'executive', 'hr'].includes(req.user.role)) {
    throw new ApiError(403, 'Only the assignee may file a dispute.');
  }
  if (existing.status !== 'Completed' && existing.status !== 'Approved') {
    throw new ApiError(400, 'Only completed tasks can be disputed.');
  }
  const current = parseJson(existing.dispute);
  if (current && current.status === 'Pending') throw new ApiError(400, 'A dispute is already pending for this task.');

  const reason = (req.body?.reason || '').trim();
  if (!reason) throw new ApiError(400, 'Dispute rationale is required.');

  const dispute = {
    status: 'Pending',
    reason,
    requestedAt: new Date().toISOString(),
    staffId: existing.assigned_to,
    staffName: existing.assigned_to_name,
    originalScore: existing.score != null ? Number(existing.score) : 0
  };
  await query('UPDATE trs_tasks SET dispute = ?, is_escalated = 0 WHERE code = ?', [JSON.stringify(dispute), req.params.code]);

  await notifyUser({
    recipientCode: existing.assigned_by, senderCode: req.user.code, senderName: req.user.name,
    type: 'DISPUTE_SUBMITTED', title: 'Staff score dispute filed',
    message: `${existing.assigned_to_name} filed a dispute for task "${existing.title}" (Current: ${existing.score ?? 0}%). Reason: "${reason}"`,
    linkTab: 'trs'
  });
  await logActivity(req.user, { action: 'SCORE_DISPUTE_SUBMITTED', details: `Dispute filed for ${req.params.code}: ${reason}`, req });
  ok(res, { success: true, dispute });
}));

/** POST /api/trs/:code/dispute/resolve — assigner/admin resolves a dispute */
router.post('/:code/dispute/resolve', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  const current = parseJson(existing.dispute);
  if (!current) throw new ApiError(400, 'No dispute found for this task.');
  if (current.status !== 'Pending') throw new ApiError(400, 'This dispute has already been resolved.');

  if (!['admin', 'executive', 'hr'].includes(req.user.role)
    && existing.assigned_by !== req.user.code) {
    const subs = await getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.assigned_to)) throw new ApiError(403, 'You cannot resolve this dispute.');
  }

  const b = req.body || {};
  const decision = b.decision === 'accept' ? 'Resolved' : (b.decision === 'reject' ? 'Rejected' : null);
  if (!decision) throw new ApiError(400, 'decision must be "accept" or "reject".');
  const resolutionNote = (b.resolution_note || '').trim();
  if (!resolutionNote) throw new ApiError(400, 'Resolution note is required.');
  const revisedScore = b.decision === 'accept' && b.revised_score != null
    ? Math.round(Number(b.revised_score) * 100) / 100 : undefined;

  const finalScore = revisedScore !== undefined ? revisedScore : (existing.score != null ? Number(existing.score) : 0);
  const resolved = {
    ...current,
    status: decision,
    resolvedAt: new Date().toISOString(),
    resolvedBy: req.user.code,
    resolvedByName: req.user.name,
    resolutionNote,
    revisedScore: decision === 'Resolved' ? finalScore : undefined
  };
  await query('UPDATE trs_tasks SET dispute = ?, score = ? WHERE code = ?', [JSON.stringify(resolved), finalScore, req.params.code]);

  await notifyUser({
    recipientCode: existing.assigned_to, senderCode: req.user.code, senderName: req.user.name,
    type: 'DISPUTE_RESOLVED', title: 'Score dispute resolved',
    message: `Your dispute for task "${existing.title}" was ${decision === 'Resolved' ? 'accepted' : 'upheld'} (Score: ${finalScore}%). Note: "${resolutionNote}"`,
    linkTab: 'trs'
  });
  await logActivity(req.user, { action: 'SCORE_DISPUTE_RESOLVED', details: `${decision} dispute for ${req.params.code} -> ${finalScore}`, req });
  ok(res, { success: true, dispute: resolved, score: finalScore });
}));

/** POST /api/trs/:code/escalate — superior escalates a task to a senior superior */
router.post('/:code/escalate', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');
  if (!['admin', 'executive', 'hr'].includes(req.user.role)
    && existing.assigned_by !== req.user.code) {
    const subs = await getSubordinateCodes(req.user.code);
    if (!subs.includes(existing.assigned_to)) throw new ApiError(403, 'Not authorized to escalate this task.');
  }

  const b = req.body || {};
  const escalatedTo = b.escalated_to || null;
  const escalatedToName = b.escalated_to_name || null;
  const escalatedReason = (b.escalated_reason || b.reason || '').trim();

  await query(
    `UPDATE trs_tasks SET is_escalated = 1, escalation_level = 'escalated',
       escalated_to = ?, escalated_to_name = ?, escalated_reason = ?, escalated_at = ?
     WHERE code = ?`,
    [escalatedTo, escalatedToName, escalatedReason || null, toMySqlDatetime(new Date()), req.params.code]
  );
  if (escalatedTo && escalatedTo !== existing.assigned_by) {
    await notifyUser({
      recipientCode: escalatedTo, senderCode: req.user.code, senderName: req.user.name,
      type: 'SYSTEM', title: `Task escalated to you: ${existing.title}`,
      message: `${req.user.name} escalated task "${existing.title}" (${req.params.code}).${escalatedReason ? ` Reason: ${escalatedReason}` : ''}`,
      linkTab: 'trs'
    });
  }
  await logActivity(req.user, { action: 'TRS_ESCALATE', details: `Escalated ${req.params.code} to ${escalatedTo || 'senior'}`, req });
  ok(res, { success: true, is_escalated: true });
}));

/** POST /api/trs/:code/unlock — manager/admin executive unlock a defaulted (auto-locked) task */
router.post('/:code/unlock', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');

  const actor = req.user;
  // Only the assignee's DIRECT superior (reporting line) may unlock a defaulted
  // (auto-locked) task — not the assigner unless they are the assignee's superior.
  const assignee = await getOne('SELECT superior_id FROM users WHERE code = ?', [existing.assigned_to]);
  if (!assignee || assignee.superior_id !== actor.code) {
    throw new ApiError(403, 'Only the assignee\u2019s direct superior may unlock this task.');
  }
  if (!existing.is_defaulted) {
    throw new ApiError(400, 'This task is not auto-locked.');
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) throw new ApiError(400, 'Mandatory unlock justification is required for the audit trail.');

  const waivePenalty = req.body?.waive_penalty ? true : false;
  const previousStatus = existing.status;
  const existingHistory = parseJson(existing.unlock_history) || [];

  const auditEntry = {
    unlockedAt: new Date().toISOString(),
    unlockedBy: actor.code,
    unlockedByName: actor.name,
    unlockedByRole: actor.role,
    reason,
    waiveLatePenalty: waivePenalty,
    previousStatus
  };

  const unlockHistory = [auditEntry, ...existingHistory].slice(0, 25);

  await query(
    `UPDATE trs_tasks
     SET status = 'In Progress', is_defaulted = 0, defaulted_at = NULL,
         late_penalty_waived = ?, unlock_history = ?, unlock_by = ?
     WHERE code = ?`,
    [waivePenalty ? 1 : 0, JSON.stringify(unlockHistory), actor.code, req.params.code]
  );

  await notifyUser({
    recipientCode: existing.assigned_to, senderCode: actor.code, senderName: actor.name,
    type: 'SYSTEM',
    title: `🔓 TRS Task Unlocked: "${existing.title}"`,
    message: `${actor.name} unlocked your task "${existing.title}" (${req.params.code}). Penalty waived: ${waivePenalty ? 'Yes (Full Punctuality)' : 'No'}. Reason: "${reason}". You may now submit your deliverable report.`,
    linkTab: 'trs'
  });
  await logActivity(actor, {
    action: 'TASK_ADMIN_UNLOCKED',
    details: `Unlocked TRS Task "${existing.title}" (${req.params.code}) for ${existing.assigned_to_name}. Penalty waived: ${waivePenalty ? 'Yes' : 'No'}. Reason: "${reason}"`,
    req
  });

  ok(res, { code: req.params.code, status: 'In Progress', unlock_history: unlockHistory });
}));

/** POST /api/trs/:code/lock — assigning superior manually re-locks (defaults) a task that
 *  was administratively unlocked, restoring the locked 0% state. */
router.post('/:code/lock', requireUser, asyncHandler(async (req, res) => {
  const existing = await getOne('SELECT * FROM trs_tasks WHERE code = ?', [req.params.code]);
  if (!existing) throw new ApiError(404, 'Task not found.');

  const actor = req.user;
  // Only the assignee's DIRECT superior may (re-)lock — mirrors the unlock restriction.
  const assignee = await getOne('SELECT superior_id FROM users WHERE code = ?', [existing.assigned_to]);
  if (!assignee || assignee.superior_id !== actor.code) {
    throw new ApiError(403, 'Only the assignee\u2019s direct superior may lock this task.');
  }
  if (['Defaulted', 'Completed', 'Approved'].includes(existing.status) || existing.submitted_at) {
    throw new ApiError(400, 'This task cannot be re-locked in its current state.');
  }

  await query(
    `UPDATE trs_tasks
     SET status = 'Defaulted', is_defaulted = 1, defaulted_at = NOW(),
         timeliness_score = 0, quality_score = 0, instruction_score = 0,
         scope_score = 0, accuracy_score = 0, score = 0,
         unlock_by = NULL,
         feedback = ?
     WHERE code = ?`,
    [`[MANUAL RE-LOCK]: "${actor.name}" re-locked the task for non-submission past its deadline (${existing.deadline}). Locked at 0%.`, req.params.code]
  );

  await notifyUser({
    recipientCode: existing.assigned_to, senderCode: actor.code, senderName: actor.name,
    type: 'SYSTEM',
    title: `🔒 TRS Task Locked Again: "${existing.title}"`,
    message: `${actor.name} re-locked your task "${existing.title}" (${req.params.code}) at 0%. A superior administrative unlock is required before you can submit deliverables again.`,
    linkTab: 'trs'
  });
  await logActivity(actor, {
    action: 'TASK_ADMIN_RELOCKED',
    details: `Re-locked TRS Task "${existing.title}" (${req.params.code}) for ${existing.assigned_to_name} at 0%.`,
    req
  });

  ok(res, { code: req.params.code, status: 'Defaulted', is_defaulted: 1 });
}));

export default router;
