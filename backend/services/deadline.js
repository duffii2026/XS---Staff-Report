import { query, getOne } from '../config/db.js';
import { notifyUser, logActivity } from './audit.js';
import { dispatchFlow } from './notificationFlow.js';
import { toMySqlDatetime } from './auth.js';

const alertWindows = [
  { label: 'tomorrow', fromDays: 1, toDays: 1 },
  { label: '3days', fromDays: 1, toDays: 3 },
  { label: 'overdue', fromDays: -366, toDays: 0 , overdue: true}
];

function dateToYmd(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Deadline reminders are capped at two sends per task per recipient per day,
 * split across two fixed half-day windows: one before 12:00 and one from 12:00
 * onwards. The scan runs hourly, so the window gate is what actually throttles it.
 */
const DAILY_SEND_LIMIT = 2;
const SECOND_WINDOW_HOUR = 12;

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** How many sends are permitted for this task+recipient at the current time. */
function allowedSendsNow(now = new Date()) {
  return now.getHours() >= SECOND_WINDOW_HOUR ? DAILY_SEND_LIMIT : 1;
}

/** How many reminders this task+recipient has already received today. */
async function sentToday(taskCode, recipientCode) {
  const row = await getOne(
    `SELECT COUNT(*) AS sent FROM notifications
     WHERE type = 'TRS_DEADLINE'
       AND recipient_user_code = ?
       AND message LIKE ?
       AND created_at >= CURRENT_DATE`,
    // Message is built as `${task.code} (${urgency})...`, so anchor on that prefix.
    [recipientCode, `%${escapeLike(taskCode)} (%`]
  );
  return Number(row?.sent || 0);
}

async function scanOnce() {
  const today = new Date();
  const overdue = new Date(today);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 3);
  overdue.setDate(overdue.getDate() - 1); // strictly past-due

  const tasks = await query(
    `SELECT code, title, status, deadline, assigned_to, assigned_to_name, assigned_by, assigned_by_name
     FROM trs_tasks
     WHERE status IN ('Pending','In Progress') AND deadline IS NOT NULL
       AND deadline <= ?`,
    [dateToYmd(horizon)]
  );

  if (!tasks.length) return { scanned: 0, sent: 0 };

  let sent = 0;

  for (const task of tasks) {
    const days = Math.ceil((new Date(task.deadline) - today) / 86400000);
    if (days < -366 || days > 3) continue;

    let label = null;
    if (days < 0) label = 'overdue';
    else if (days === 0) label = 'tomorrow';
    else if (days <= 3) label = '3days';

    if (!label) continue;

    const urgency = days < 0
      ? `OVERDUE by ${Math.abs(days)} day(s)`
      : `due ${label === 'tomorrow' ? 'tomorrow' : `in ${days} days`}`;
    const title = days < 0 ? `TRS Task Overdue: ${task.title}` : `TRS Deadline: ${task.title}`;
    const message = `${task.code} (${urgency}). ${task.title}.\nAssigned: ${task.assigned_to_name} | By: ${task.assigned_by_name} | Deadline: ${task.deadline}`;

    const recipients = [task.assigned_to, task.assigned_by].filter(Boolean);
    for (const code of recipients) {
      if (await sentToday(task.code, code) >= allowedSendsNow()) continue;

      await notifyUser({
        recipientCode: code, senderCode: 'system', senderName: 'TRS Reminder',
        type: 'TRS_DEADLINE', title, message, linkTab: 'trs'
      });
      const result = await dispatchFlow({
        eventType: 'DEADLINE_ALERT',
        title: task.title,
        staffName: task.assigned_to_name,
        superiorName: task.assigned_by_name,
        deadline: task.deadline,
        status: days < 0 ? 'OVERDUE' : 'Due Soon',
        notes: `${urgency} — ${task.title}. Assigned: ${task.assigned_to_name} | By: ${task.assigned_by_name}`,
        details: `Task code: ${task.code}\nDeadline: ${task.deadline}`,
        targetUserCode: code,
        toGroup: false
      });
      if (result.sent) sent += 1;
    }
  }

  return { scanned: tasks.length, sent };
}

/**
 * 7-Day Non-Submission Auto-Lock (TRS Tasks).
 * Any task still Pending / In Progress / Overdue and unsubmitted past 7 calendar
 * days after its deadline is defaulted to a locked 0% score. A superior or admin
 * must administratively unlock it (with a recorded audit justification) before the
 * assignee can submit the deliverable.
 *
 * Tasks already unlocked by a superior (unlock_by IS NOT NULL) are permanently
 * exempt — a human override wins over the automated lock engine.
 *
 * @param {object} [opts] optionally scope the scan: { assignedTo } limits locking
 *        to tasks assigned to that staff member (used on staff login).
 */
export async function autoLockScan(opts = {}) {
  const { assignedTo } = opts;
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const cutoff = dateToYmd(cutoffDate);

  let sql = `SELECT code, title, deadline, assigned_to, assigned_to_name, assigned_by, assigned_by_name, department
             FROM trs_tasks
             WHERE status IN ('Pending','In Progress','Overdue') AND is_defaulted = 0 AND submitted_at IS NULL
               AND unlock_by IS NULL
               AND deadline IS NOT NULL AND deadline <= ?`;
  const params = [cutoff];
  if (assignedTo) {
    sql += ' AND assigned_to = ?';
    params.push(assignedTo);
  }

  const tasks = await query(sql, params);

  let locked = 0;
  for (const task of tasks) {
    const defaultedAt = toMySqlDatetime(now);
    await query(
      `UPDATE trs_tasks
       SET status = 'Defaulted', is_defaulted = 1, defaulted_at = ?,
           timeliness_score = 0, quality_score = 0, instruction_score = 0,
           scope_score = 0, accuracy_score = 0, score = 0,
           feedback = ? WHERE code = ?`,
      [defaultedAt, `[SYSTEM AUTO-LOCK]: Task unsubmitted 7+ days past deadline (${task.deadline}). Locked at 0%.`, task.code]
    );
    locked += 1;

    await notifyUser({
      recipientCode: task.assigned_to,
      senderCode: 'system',
      senderName: 'APA Compliance Engine',
      type: 'DEADLINE_ALERT',
      title: `🔒 TRS Task Auto-Locked (0%): "${task.title}"`,
      message: `TRS Task "${task.title}" exceeded the 7-day submission cutoff. It has been locked at 0%. Superior unlock required to submit deliverables.`,
      linkTab: 'trs'
    });

    await dispatchFlow({
      eventType: 'DEADLINE_ALERT',
      title: task.title,
      staffName: task.assigned_to_name,
      superiorName: task.assigned_by_name,
      department: task.department,
      deadline: task.deadline,
      status: 'Auto-Locked (0%) — 7+ Days Unsubmitted',
      score: 0,
      notes: `Task ${task.code} exceeded the 7-day submission cutoff with no deliverable. Superior administrative unlock (with justification) is required to submit.`,
      details: `Task code: ${task.code}\nAssigned: ${task.assigned_to_name} | By: ${task.assigned_by_name}\nDeadline: ${task.deadline}\nLocked at 0% automatically.`,
      targetUserCode: task.assigned_to
    });

    await logActivity(
      { code: 'system', username: 'system', role: 'system' },
      {
        action: 'TASK_AUTO_LOCKED_ZERO',
        details: `Auto-locked TRS Task "${task.title}" (${task.code}) at 0% due to non-submission past 7 days.`
      }
    );
  }

  return { scanned: tasks.length, locked };
}

export function startDeadlineDaemon(intervalMs = 60 * 60 * 1000) {
  let timer = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const res = await scanOnce();
      if (res.scanned > 0) {
        console.log(`[deadline-daemon] scanned=${res.scanned} telegramSent=${res.sent}`);
      }
      const auto = await autoLockScan();
      if (auto.scanned > 0) {
        console.log(`[deadline-daemon] autoLock scanned=${auto.scanned} locked=${auto.locked}`);
      }
    } catch (err) {
      console.error('[deadline-daemon]', err.message);
    } finally {
      running = false;
    }
  };

  // Run shortly after boot, then on interval
  setTimeout(tick, 20 * 1000);
  timer = setInterval(tick, Math.max(intervalMs, 60 * 1000));
  if (timer.unref) timer.unref();

  return {
    stop: () => clearInterval(timer),
    scanOnce
  };
}