import { getOne, query } from '../config/db.js';
import { request as httpsRequest } from 'node:https';
import { env } from '../config/env.js';

let _cachedConfig = null;
let _configAt = 0;

export async function getTelegramConfig(force = false) {
  if (!force && _cachedConfig && Date.now() - _configAt < 5000) return _cachedConfig;
  const row = await getOne('SELECT * FROM telegram_config WHERE id = 1');
  _cachedConfig = row;
  _configAt = Date.now();
  return row;
}

export function bustTelegramConfig() {
  _cachedConfig = null;
}

export function parseTriggers(config) {
  const triggers = config?.triggers || [];
  if (Array.isArray(triggers) || (triggers && typeof triggers === 'object')) return triggers;
  try { return JSON.parse(triggers); } catch { return []; }
}

export function resolveChatId(config, user) {
  if (!config?.is_enabled) return null;
  if (user?.telegram_chat_id) return user.telegram_chat_id;
  const map = config?.user_map || {};
  const users = Array.isArray(map) ? map : Object.entries(map).map(([k, v]) => ({ code: k, chatId: v }));
  const hit = users.find((u) => u.code === user?.code || u.username === user?.username);
  return hit?.chatId || null;
}

/**
 * Retry a request against a HTTPS URL forcing IPv4 resolution via node:https.
 * Many AWS EC2 instances have no IPv6 route, and Node's global fetch can fail
 * with "fetch failed" when the DNS answer prefers AAAA (IPv6). Node 18/19 in
 * particular return AAAA records first (verbatim) and never fall back.
 */
function httpsFetchJson(url, { method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: method || 'GET',
        headers,
        family: 4,
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON response from Telegram')); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Connection timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * Call the Telegram Bot API with a primary fetch (with timeout) and an
 * IPv4-forced fallback so deployments on IPv4-only hosts (e.g. AWS EC2)
 * keep working.
 */
export async function telegramFetch(token, path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = opts.body !== undefined
    ? { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    : (opts.headers || {});
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const url = `https://api.telegram.org/bot${token}${path}`;
  const timeoutMs = opts.timeoutMs || 15000;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method, headers, body, signal: ctrl.signal });
      clearTimeout(timer);
      const j = await r.json();
      if (j && typeof j === 'object') return j;
      throw new Error('Invalid JSON response from Telegram');
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  } catch (err) {
    return await httpsFetchJson(url, { method, headers, body, timeoutMs });
  }
}

/**
 * Build the inline keyboard button that links a message back to the staff portal.
 * `buttonText` is the per-event label supplied by the caller; when omitted it falls
 * back to a generic label. Returns null when SITE_URL is missing or points at
 * localhost (dev), so the button is skipped locally and only attached in
 * production-like deployments.
 */
export function resolveSiteButton(buttonText) {
  const raw = (env.SITE_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(u.hostname)) return null;
    return { text: buttonText || `🚀 Open ${u.host}`, url: u.href };
  } catch {
    return null;
  }
}

/** Send a message via the Telegram Bot API. */
export async function sendTelegram(config, chatId, text, opts = {}) {
  if (!config?.is_enabled || !config.bot_token || !chatId) {
    return { sent: false, reason: 'Telegram disabled or no chat id.' };
  }
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  const siteBtn = resolveSiteButton(opts.buttonText);
  if (siteBtn) {
    body.reply_markup = JSON.stringify({ inline_keyboard: [[siteBtn]] });
  }
  try {
    const json = await telegramFetch(config.bot_token, '/sendMessage', {
      method: 'POST',
      timeoutMs: 10000,
      body
    });
    return { sent: json.ok === true, detail: json.description || null, chatId };
  } catch (err) {
    console.error('[Telegram send]', err.message);
    return { sent: false, reason: err.message };
  }
}

export async function sendToUser(config, user, text, opts = {}) {
  const chatId = resolveChatId(config, user);
  if (!chatId) return { sent: false, reason: 'No chat id for user.' };
  return sendTelegram(config, chatId, text, opts);
}

/**
 * Process one Telegram update from the 1-click connect handshake.
 * When the user presses Start on t.me/<bot>?start=apa_<code>, the bot
 * receives "/start apa_<code>" with the sender's chat id + username.
 * We bind those to the requesting user and send a welcome confirmation.
 */
async function handleTelegramUpdate(config, update) {
  const msg = update?.message;
  if (!msg || typeof msg.text !== 'string' || !/^\/start\b/.test(msg.text)) return;
  const payload = String(msg.text).trim().split(/\s+/)[1] || '';
  const chatId = msg.chat?.id;
  if (chatId === undefined || chatId === null) return;
  const username = (msg.from?.username || '').toString();

  let tok = null;
  if (payload) {
    // Exact deep-link handshake (t.me/<bot>?start=apa_<code>)
    tok = await getOne(
      'SELECT * FROM telegram_link_tokens WHERE code = ? AND consumed = 0 AND expires_at > NOW()',
      [payload]
    );
  } else {
    // Bare /start (no deep-link payload). The user may have opened the bot
    // directly or the coded tab was lost. Complete a pending handshake only
    // when we can disambiguate the sender: match their stored Telegram
    // username first, else bind to the sole pending handshake in the system.
    const uname = username.trim();
    if (uname) {
      tok = await getOne(
        `SELECT t.* FROM telegram_link_tokens t
          JOIN users u ON u.code = t.user_code
          WHERE t.consumed = 0 AND t.expires_at > NOW() AND u.telegram_username = ? LIMIT 1`,
        [uname]
      );
    }
    if (!tok) {
      const pending = await query('SELECT * FROM telegram_link_tokens WHERE consumed = 0 AND expires_at > NOW()');
      if (pending.length === 1) tok = pending[0];
    }
  }
  if (!tok) return;

  await query(
    'UPDATE telegram_link_tokens SET consumed = 1, chat_id = ?, username = ?, consumed_at = CURRENT_TIMESTAMP WHERE code = ?',
    [String(chatId), username || null, payload || tok.code]
  );
  await query(
    'UPDATE users SET telegram_chat_id = ?, telegram_username = ?, telegram_connected_at = CURRENT_TIMESTAMP WHERE code = ?',
    [String(chatId), username || null, tok.user_code]
  );

  const welcome = `🎉 <b>APA TELEGRAM CONNECTED!</b>\n\nHello <b>${tok.user_code}</b>,\nYour account is now linked with the APA Staff Portal. You will receive task alerts, report updates, and deadline reminders here.`;
  await sendTelegram(config, String(chatId), welcome, { buttonText: '🚀 Open APA Staff Portal' }).catch(() => {});
}

/**
 * Long-poll getUpdates once and fold the deep-link handshakes into the
 * database. Uses telegram_config.update_offset as the cursor so each
 * update is processed exactly once per instance/deployment.
 */
export async function pollTelegramUpdates(token, { timeoutMs = 4000 } = {}) {
  const cfg = await getTelegramConfig(true);
  const offset = Number(cfg?.update_offset || 0);
  const timeoutSec = Math.max(0, Math.min(60, Math.floor(timeoutMs / 1000)));
  const path = `/getUpdates?limit=100&timeout=${timeoutSec}&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`;
  const j = await telegramFetch(token, path, { timeoutMs: timeoutMs + 5000 });
  if (!j.ok) return [];

  const updates = Array.isArray(j.result) ? j.result : [];
  let maxId = offset;
  for (const u of updates) {
    const id = Number(u?.update_id);
    if (id > maxId) maxId = id;
    await handleTelegramUpdate(cfg, u);
  }
  // Advance past the last processed update — the Telegram API is INCLUSIVE of
  // the specified offset, so storing maxId would re-deliver that update forever.
  if (maxId > offset) {
    await query('UPDATE telegram_config SET update_offset = ? WHERE id = 1', [maxId + 1]);
    bustTelegramConfig();
  }
  return updates;
}

export async function saveTelegramConfig(patch) {
  const fields = ['is_enabled', 'bot_token', 'bot_username', 'main_group_chat_id', 'channel_name', 'triggers', 'user_map'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = ?`);
      args.push(typeof patch[f] === 'object' && patch[f] !== null ? JSON.stringify(patch[f]) : patch[f]);
    }
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  if (!sets.length) return;
  await query(`UPDATE telegram_config SET ${sets.join(', ')} WHERE id = 1`, args);
  bustTelegramConfig();
}