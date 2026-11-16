import { TelegramConfig, TelegramOutboxMessage, User } from '../types';
import { api } from './api';

// Module-level cache; hydrated lazily from the backend config endpoint.
let _cachedConfig: TelegramConfig | null = null;
let _outbox: TelegramOutboxMessage[] = [];
let _configHydrate: Promise<TelegramConfig> | null = null;

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  isEnabled: true,
  botToken: '', // Never exposed to the browser — the backend holds the token
  botUsername: '',
  mainGroupChatId: '',
  channelName: 'APA Staff Reporting & Superior Task Alerts',
  triggers: {
    notifyTRSubmitted: true,
    notifyTRReviewed: true,
    notifyTRSAssigned: true,
    notifyTRSStatusChanged: true,
    notifyTRSSubmitted: true,
    notifyTRSScored: true,
    notifyDeadlines: true,
    notifyDailyDigest: false,
    notifyAppraisalPending: true,
    notifyAppraisalApproved: true
  },
  userTelegramHandles: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/** Fetch the admin-visible config from the backend (never includes the token). */
export async function fetchTelegramConfig(): Promise<TelegramConfig> {
  try {
    const cfg = await api.get<any>('/telegram/config?includeToken=1');
    const storedHandles: Record<string, any> = {};
    const base: TelegramConfig = {
      ...DEFAULT_TELEGRAM_CONFIG,
      isEnabled: !!cfg.is_enabled,
      hasToken: !!cfg.has_token,
      botToken: cfg.bot_token || '',
      botUsername: cfg.bot_username || '',
      mainGroupChatId: cfg.main_group_chat_id || '',
      channelName: cfg.channel_name || DEFAULT_TELEGRAM_CONFIG.channelName,
      userTelegramHandles: storedHandles
    };
    if (cfg.triggers !== undefined && cfg.triggers !== null) {
      // DB stores either an object map { notifyX: true } or an array [{ key, event }]
      let enabledSet: string[] = [];
      if (Array.isArray(cfg.triggers)) {
        enabledSet = cfg.triggers.map((x: any) => x?.key || x?.event || x).filter(Boolean);
      } else if (typeof cfg.triggers === 'object') {
        enabledSet = Object.entries(cfg.triggers).filter(([, v]) => v).map(([k]) => k);
      }
      const isOn = (key: string, events: string[]) => enabledSet.includes(key) || events.some((ev) => enabledSet.includes(ev));
      base.triggers = {
        notifyTRSubmitted: isOn('notifyTRSubmitted', ['TR_SUBMIT']),
        notifyTRReviewed: isOn('notifyTRReviewed', ['TR_REVIEW']),
        notifyTRSAssigned: isOn('notifyTRSAssigned', ['TRS_ASSIGN']),
        notifyTRSStatusChanged: isOn('notifyTRSStatusChanged', ['TRS_STATUS']),
        notifyTRSSubmitted: isOn('notifyTRSSubmitted', ['TRS_SUBMIT']),
        notifyTRSScored: isOn('notifyTRSScored', ['TRS_SCORE']),
        notifyDeadlines: isOn('notifyDeadlines', ['DEADLINE_ALERT']),
        notifyDailyDigest: isOn('notifyDailyDigest', []),
        notifyAppraisalPending: isOn('notifyAppraisalPending', ['APPRAISAL_PENDING']),
        notifyAppraisalApproved: isOn('notifyAppraisalApproved', ['APPRAISAL_APPROVED'])
      };
    }
    _cachedConfig = base;
    return base;
  } catch {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }
}

/** Fetch the current user's Telegram connection fresh from the database. */
export async function getMyTelegramStatus(): Promise<{ chat_id: string | null; username: string | null; connected_at: string | null; bot_username: string | null; has_token: boolean }> {
  try {
    const res = await api.get<any>('/telegram/status');
    const c = res?.my_connection || {};
    return {
      chat_id: c.chat_id || null,
      username: c.username || null,
      connected_at: c.connected_at || null,
      bot_username: res?.bot_username || null,
      has_token: !!res?.has_token
    };
  } catch {
    return { chat_id: null, username: null, connected_at: null, bot_username: null, has_token: false };
  }
}

export interface TelegramLinkRequest {
  code: string;
  start_url: string;
  bot_username: string;
  expires_in_seconds: number;
}

export interface TelegramLinkStatus {
  connected: boolean;
  chat_id?: string;
  username?: string | null;
}

/**
 * 1-click Telegram connect — step 1: ask the backend to mint a one-time
 * deep-link code (t.me/<bot>?start=<code>). Opening the returned URL in
 * Telegram and pressing Start reports the user's real chat_id back to us.
 */
export async function requestTelegramLink(): Promise<TelegramLinkRequest> {
  const res = await api.post<any>('/telegram/link-request');
  return {
    code: res?.code || '',
    start_url: res?.start_url || '',
    bot_username: res?.bot_username || '',
    expires_in_seconds: res?.expires_in_seconds || 600
  };
}

/** 1-click Telegram connect — step 2: poll until the handshake is detected. */
export async function pollTelegramLinkStatus(
  code: string
): Promise<TelegramLinkStatus> {
  const res = await api.get<any>(`/telegram/link-status?code=${encodeURIComponent(code)}`);
  return {
    connected: !!res?.connected,
    chat_id: res?.chat_id ?? undefined,
    username: res?.username ?? (res?.username === null ? null : undefined)
  };
}

export async function reloadTelegramConfig(): Promise<TelegramConfig> {
  _configHydrate = null;
  _cachedConfig = null;
  return getTelegramConfigAsync();
}

export function getTelegramConfig(): TelegramConfig {
  return _cachedConfig || { ...DEFAULT_TELEGRAM_CONFIG };
}

export async function getTelegramConfigAsync(): Promise<TelegramConfig> {
  if (_cachedConfig) return _cachedConfig;
  if (!_configHydrate) _configHydrate = fetchTelegramConfig();
  return _configHydrate;
}

export function saveTelegramConfig(config: TelegramConfig, opts?: { botToken?: string }): void {
  const patch: Record<string, unknown> = {
    is_enabled: config.isEnabled,
    bot_username: config.botUsername,
    main_group_chat_id: config.mainGroupChatId || '',
    channel_name: config.channelName || '',
    triggers: [
      { key: 'notifyTRSubmitted', event: 'TR_SUBMIT' }, { key: 'notifyTRReviewed', event: 'TR_REVIEW' },
      { key: 'notifyTRSAssigned', event: 'TRS_ASSIGN' }, { key: 'notifyTRSStatusChanged', event: 'TRS_STATUS' },
      { key: 'notifyTRSSubmitted', event: 'TRS_SUBMIT' }, { key: 'notifyTRSScored', event: 'TRS_SCORE' },
      { key: 'notifyDeadlines', event: 'DEADLINE_ALERT' }, { key: 'notifyDailyDigest' },
      { key: 'notifyAppraisalPending', event: 'APPRAISAL_PENDING' }, { key: 'notifyAppraisalApproved', event: 'APPRAISAL_APPROVED' }
    ].filter((t) => {
      const key = t.key as keyof TelegramConfig['triggers'];
      return !!config.triggers[key];
    })
  };
  // The bot token is only sent when the admin explicitly provides it (store / clear).
  if (opts?.botToken !== undefined) {
    patch.bot_token = opts.botToken;
  }
  _cachedConfig = { ...config, hasToken: opts?.botToken !== undefined ? (opts.botToken !== '' && !opts.botToken.startsWith('xxx')) : config.hasToken, updatedAt: new Date().toISOString() };
  api.put('/telegram/config', patch).then(() => reloadTelegramConfig()).catch((e) => console.error('saveTelegramConfig:', e));
}

export function getTelegramOutbox(): TelegramOutboxMessage[] {
  return _outbox;
}

export function addTelegramOutboxLog(msg: Omit<TelegramOutboxMessage, 'id' | 'timestamp'>): TelegramOutboxMessage {
  const newEntry: TelegramOutboxMessage = {
    ...msg,
    id: `tg_msg_${Date.now()}_${Math.random().toString(36).substring(2, 4)}`,
    timestamp: new Date().toISOString()
  };
  _outbox = [newEntry, ..._outbox.slice(0, 99)];
  return newEntry;
}

export function clearTelegramOutbox(): void {
  _outbox = [];
}

export interface DispatchTelegramParams {
  eventType: TelegramOutboxMessage['eventType'];
  title: string;
  staffName?: string;
  superiorName?: string;
  department?: string;
  deadline?: string;
  status?: string;
  score?: number | string;
  notes?: string;
  details?: string;
  targetUserId?: string;
  appUrl?: string;
  buttonText?: string;
}

/** @returns the correct callback phrase for the event type */
export function getTelegramButtonText(eventType: TelegramOutboxMessage['eventType']): string {
  switch (eventType) {
    case 'TRS_ASSIGN': return '🚀 View Task Details';
    case 'TRS_STATUS': return '🔄 View Task Progress';
    case 'TRS_SUBMIT': return '🚀 View Submitted Deliverable';
    case 'TRS_SCORE': return '⭐ View Task Evaluation & Score';
    case 'TR_SUBMIT': return '📋 View Weekly Report';
    case 'TR_REVIEW': return '✅ View Approved Report';
    case 'DEADLINE_ALERT': return '⏰ Check Task & Deadline';
    case 'APPRAISAL_PENDING': return '✍️ Review Staff Appraisal';
    case 'APPRAISAL_APPROVED': return '🏆 View Approved Appraisal';
    case 'TEST_MESSAGE':
    default: return '🚀 Open APA Staff Portal';
  }
}

export function formatTelegramHTML(params: DispatchTelegramParams): string {
  const { eventType, title, staffName, superiorName, department, deadline, status, score, notes, details } = params;

  let headerIcon = '🔔';
  let eventName = 'APA SYSTEM NOTIFICATION';
  switch (eventType) {
    case 'TR_SUBMIT': headerIcon = '📋'; eventName = 'T&R WEEKLY REPORT SUBMITTED'; break;
    case 'TR_REVIEW': headerIcon = '✅'; eventName = 'T&R REPORT REVIEWED & APPROVED'; break;
    case 'TRS_ASSIGN': headerIcon = '📌'; eventName = 'NEW TRS TASK ASSIGNED'; break;
    case 'TRS_STATUS': headerIcon = '🔄'; eventName = 'TRS TASK STATUS UPDATED'; break;
    case 'TRS_SUBMIT': headerIcon = '🚀'; eventName = 'TRS DELIVERABLE REPORT SUBMITTED'; break;
    case 'TRS_SCORE': headerIcon = '⭐'; eventName = 'TRS TASK EVALUATION & SCORE'; break;
    case 'DEADLINE_ALERT': headerIcon = '⚠️'; eventName = 'DEADLINE ALERT & COUNTDOWN'; break;
    case 'APPRAISAL_PENDING': headerIcon = '✍️'; eventName = 'STAFF APPRAISAL ROUTED FOR APPROVAL'; break;
    case 'APPRAISAL_APPROVED': headerIcon = '🏆'; eventName = 'STAFF APPRAISAL OFFICIALLY APPROVED'; break;
    case 'TEST_MESSAGE': headerIcon = '🧪'; eventName = 'TELEGRAM BOT CONNECTION TEST'; break;
  }

  const lines: string[] = [
    `${headerIcon} <b>[${eventName}]</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<b>Title / Report:</b> ${title}`
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

export function getPortalUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin) return window.location.origin;
  return 'https://ais-dev-ebur2qqkgg3zlrzclxolnm-474816074227.asia-southeast1.run.app';
}

/**
 * Dispatch notification to Telegram.
 * The backend owns the bot token and performs the real send on every
 * workflow event (report submit/review, TRS assign/submit/evaluate,
 * deadline daemon, appraisals). The client only records the outbox entry.
 */
export async function dispatchTelegramEvent(params: DispatchTelegramParams): Promise<{ success: boolean; mode: 'sent' | 'simulated' | 'failed'; message: string }> {
  const config = await getTelegramConfigAsync();

  if (!config.isEnabled) {
    return { success: false, mode: 'failed', message: 'Telegram integration is disabled in settings.' };
  }

  const formattedHtml = formatTelegramHTML(params);
  const targetUserId = params.targetUserId || '';
  const targetChatId = config.mainGroupChatId || (targetUserId ? 'Direct DM' : 'Pending Connection');

  addTelegramOutboxLog({
    eventType: params.eventType,
    targetType: targetChatId && !targetUserId ? 'group' : 'direct_dm',
    targetChatId: targetChatId || 'Pending Connection',
    targetRecipientName: params.staffName || params.superiorName || 'Staff Member',
    formattedText: formattedHtml,
    status: 'sent'
  });

  return {
    success: true,
    mode: 'sent',
    message: 'Event logged — backend Telegram channel handles the live delivery.'
  };
}

/**
 * Send an immediate personal test ping via the backend (keeps the bot token server-side).
 */
export async function sendPersonalTestMessage(
  userId: string,
  targetChatId: string,
  customText?: string,
  buttonText: string = '🚀 Open APA Staff Portal'
): Promise<{ success: boolean; mode: 'sent' | 'simulated' | 'failed'; message: string }> {
  void buttonText;
  const text = customText || '🔔 <b>TEST ALERT: APA NOTIFICATIONS ACTIVE</b>';
  try {
    await api.post('/telegram/test', { chat_id: targetChatId });
    addTelegramOutboxLog({
      eventType: 'TEST_MESSAGE',
      targetType: 'direct_dm',
      targetChatId,
      targetRecipientName: userId,
      formattedText: text,
      status: 'sent'
    });
    return { success: true, mode: 'sent', message: 'Test message delivered to Telegram!' };
  } catch (err: any) {
    const errMsg = err?.message || 'Telegram test failed.';
    addTelegramOutboxLog({
      eventType: 'TEST_MESSAGE',
      targetType: 'direct_dm',
      targetChatId,
      targetRecipientName: userId,
      formattedText: text,
      status: 'failed',
      errorMessage: errMsg
    });
    return { success: false, mode: 'failed', message: errMsg };
  }
}
