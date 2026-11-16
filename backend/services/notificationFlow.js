import { getOne } from '../config/db.js';
import { getTelegramConfig, sendTelegram, sendToUser, parseTriggers } from './telegram.js';

// Maps workflow event types to the trigger keys stored in telegram_config.triggers
export const TRIGGER_BY_EVENT = {
  TR_SUBMIT: 'notifyTRSubmitted',
  TR_REVIEW: 'notifyTRReviewed',
  TRS_ASSIGN: 'notifyTRSAssigned',
  TRS_STATUS: 'notifyTRSStatusChanged',
  TRS_SUBMIT: 'notifyTRSSubmitted',
  TRS_SCORE: 'notifyTRSScored',
  DEADLINE_ALERT: 'notifyDeadlines',
  APPRAISAL_PENDING: 'notifyAppraisalPending',
  APPRAISAL_APPROVED: 'notifyAppraisalApproved'
};

const HEADERS = {
  TR_SUBMIT: ['📋', 'T&R WEEKLY REPORT SUBMITTED'],
  TR_REVIEW: ['✅', 'T&R REPORT REVIEWED & APPROVED'],
  TRS_ASSIGN: ['📌', 'NEW TRS TASK ASSIGNED'],
  TRS_STATUS: ['🔄', 'TRS TASK STATUS UPDATED'],
  TRS_SUBMIT: ['🚀', 'TRS DELIVERABLE REPORT SUBMITTED'],
  TRS_SCORE: ['⭐', 'TRS TASK EVALUATION & SCORE'],
  DEADLINE_ALERT: ['⚠️', 'DEADLINE ALERT & COUNTDOWN'],
  APPRAISAL_PENDING: ['✍️', 'STAFF APPRAISAL ROUTED FOR APPROVAL'],
  APPRAISAL_APPROVED: ['🏆', 'STAFF APPRAISAL OFFICIALLY APPROVED'],
  TEST_MESSAGE: ['🧪', 'TELEGRAM BOT CONNECTION TEST']
};

/** Mirror of the SPA preview template (frontend formatTelegramHTML). */
export function formatFlowText({
  eventType, title, staffName, superiorName, department, deadline, status, score, notes, details, headerTitle
}) {
  const iconBox = HEADERS[eventType] || ['🔔', 'APA SYSTEM NOTIFICATION'];
  const header = headerTitle || iconBox[1];
  const lines = [
    `${iconBox[0]} <b>[${header}]</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<b>Title / Report:</b> ${title || '—'}`
  ];
  if (staffName) lines.push(`👤 <b>Staff Member:</b> ${staffName}`);
  if (superiorName) lines.push(`👔 <b>Superior / Evaluator:</b> ${superiorName}`);
  if (department) lines.push(`🏢 <b>Department:</b> ${department}`);
  if (status) lines.push(`📊 <b>Status:</b> ${status}`);
  if (deadline) lines.push(`⏳ <b>Deadline:</b> <code>${deadline}</code>`);
  if (score !== undefined && score !== null) lines.push(`🎯 <b>Score / Rating:</b> <b>${score}%</b>`);
  if (notes) lines.push(`💬 <b>Remarks / Notes:</b> <i>"${notes}"</i>`);
  if (details) lines.push(`\n📝 <b>Details:</b>\n${details}`);
  return lines.join('\n');
}

// Per-event label for the inline "back to the portal" button under every message.
// Mirrors getTelegramButtonText() in frontend/src/services/telegramService.ts so
// the SPA preview and the real Telegram message stay in sync.
const BUTTON_BY_EVENT = {
  TR_SUBMIT: '📋 View Weekly Report',
  TR_REVIEW: '✅ View Approved Report',
  TRS_ASSIGN: '🚀 View Task Details',
  TRS_STATUS: '🔄 View Task Progress',
  TRS_SUBMIT: '🚀 View Submitted Deliverable',
  TRS_SCORE: '⭐ View Task Evaluation & Score',
  DEADLINE_ALERT: '⏰ Check Task & Deadline',
  APPRAISAL_PENDING: '✍️ Review Staff Appraisal',
  APPRAISAL_APPROVED: '🏆 View Approved Appraisal',
  TEST_MESSAGE: '🚀 Open APA Staff Portal'
};

export function buttonTextForEvent(eventType) {
  return BUTTON_BY_EVENT[eventType] || '🚀 Open APA Staff Portal';
}

export function isTriggerEnabled(config, eventType) {
  const key = TRIGGER_BY_EVENT[eventType];
  if (!key) return false;
  const triggers = parseTriggers(config);
  if (Array.isArray(triggers)) {
    return triggers.some((t) => (t && (t.key || t.event)) === key || t === key);
  }
  return !!triggers?.[key];
}

/**
 * Dispatch a Telegram notification following the stored Automated Notification
 * Triggers (telegram_config.triggers) in the database. Sends to the linked main
 * group and/or a targeted user DM whenever the matching trigger is enabled.
 */
export async function dispatchFlow({
  eventType,
  title,
  staffName,
  department,
  deadline,
  status,
  score,
  notes,
  details,
  superiorName,
  targetUserCode,
  toGroup = true
}) {
  try {
    const config = await getTelegramConfig(true);
    if (!config?.is_enabled) return { sent: false, total: 0, reason: 'Telegram disabled' };
    if (!isTriggerEnabled(config, eventType)) return { sent: false, total: 0, reason: `trigger off: ${eventType}` };

    const text = formatFlowText({ eventType, title, staffName, superiorName, department, deadline, status, score, notes, details });
    const buttonText = buttonTextForEvent(eventType);

    const results = [];
    if (toGroup && config.main_group_chat_id) {
      results.push(await sendTelegram(config, config.main_group_chat_id, text, { buttonText }));
    }
    if (targetUserCode) {
      const user = await getOne('SELECT * FROM users WHERE code = ?', [targetUserCode]);
      if (user) results.push(await sendToUser(config, user, text, { buttonText }));
    }

    const sent = results.filter((r) => r.sent).length;
    return { sent, total: results.length, reason: results.find((r) => !r.sent)?.reason || null };
  } catch (err) {
    console.error('[notification-flow]', err.message);
    return { sent: false, total: 0, reason: err.message };
  }
}

/**
 * Always deliver a private Telegram DM to a specific user (e.g. the report
 * owner / staff), independent of the group-post trigger toggles. Telegram must
 * be enabled and the recipient must have a linked chat id (or be present in
 * telegram_config.user_map).
 */
export async function notifyUserTelegram({
  targetUserCode,
  eventType,
  headerTitle,
  title,
  staffName,
  superiorName,
  department,
  deadline,
  status,
  score,
  notes,
  details
}) {
  try {
    const config = await getTelegramConfig(true);
    if (!config?.is_enabled) return { sent: false, reason: 'Telegram disabled' };
    if (!targetUserCode) return { sent: false, reason: 'No target user' };
    const user = await getOne('SELECT * FROM users WHERE code = ?', [targetUserCode]);
    if (!user) return { sent: false, reason: 'Target user not found' };
    const text = formatFlowText({ eventType, headerTitle, title, staffName, superiorName, department, deadline, status, score, notes, details });
    return sendToUser(config, user, text, { buttonText: buttonTextForEvent(eventType) });
  } catch (err) {
    console.error('[notify-user-telegram]', err.message);
    return { sent: false, reason: err.message };
  }
}