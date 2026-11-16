import { getOne, query } from '../config/db.js';
import { request as httpsRequest } from 'node:https';
import { env } from '../config/env.js';

let _cachedConfig = null;
let _configAt = 0;
const _alertedUnlinked = new Set();

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
 * Check whether the bot can actually reach a chat (group / channel / DM) via
 * /getChat. Telegram reports "Bad Request: chat not found" when the id is
 * wrong or the bot was never added to the group, so validating up-front lets
 * the admin get an actionable message instead of a raw API error.
 */
export async function checkTelegramChat(token, chatId) {
  if (!token) return { ok: false, detail: 'No bot token stored yet.' };
  if (!chatId) return { ok: false, detail: 'No chat id supplied.' };
  try {
    const json = await telegramFetch(token, `/getChat?chat_id=${encodeURIComponent(String(chatId))}`, { timeoutMs: 10000 });
    if (!json.ok || !json.result) {
      return { ok: false, detail: json.description || 'Telegram rejected the chat id.' };
    }
    const c = json.result;
    return {
      ok: true,
      chat: {
        id: c.id,
        type: c.type || 'unknown',
        title: c.title || c.username || c.first_name || `Chat ${c.id}`,
        username: c.username || null
      }
    };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
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
  await sendTelegram(config, String(chatId), welcome, { buttonText: '🚀 Open APA 1 Staff Portal' }).catch(() => {});
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

let _pollingInterval = null;

export async function processTelegramMessages(token) {
  const cfg = await getTelegramConfig(true);
  if (!cfg?.is_enabled || !cfg?.bot_token || !cfg?.main_group_chat_id) {
    return { processed: 0, reason: 'Not configured' };
  }

  const offset = Number(cfg?.update_offset || 0);
  const path = `/getUpdates?limit=100&timeout=0&offset=${offset}&allowed_updates=${encodeURIComponent('["message","channel_post"]')}`;
  const j = await telegramFetch(token, path, { timeoutMs: 10000 });
  if (!j.ok) return { processed: 0, reason: 'Telegram error' };

  const updates = Array.isArray(j.result) ? j.result : [];

  let maxId = offset;
  let processed = 0;

  const { parseChatMessageWithAI } = await import('./aiParser.js');
  const { makeCode } = await import('./audit.js');
  const { query, getOne } = await import('../config/db.js');
  const { notifyUser } = await import('./audit.js');
  const { dispatchFlow } = await import('./notificationFlow.js');
  const { logActivity } = await import('./audit.js');
  const { sendTelegram } = await import('./telegram.js');

  for (const u of updates) {
    const id = Number(u?.update_id);
    if (id > maxId) maxId = id;

    try {
      const message = u?.message || u?.channel_post;
      if (!message?.text) continue;

      const chatId = String(message.chat?.id);
      const text = message.text.trim();

      if (cfg?.main_group_chat_id && chatId !== String(cfg.main_group_chat_id)) {
        continue;
      }

      const mentionMatch = text.match(/^@(\w+)\s+(.+)$/);
      if (!mentionMatch) continue;

      const mentionedUsername = mentionMatch[1].toLowerCase();

      // Check if message is older than 20 seconds first
      const messageDate = message.date ? new Date(message.date * 1000) : new Date();
      const now = new Date();
      const secondsDiff = (now - messageDate) / 1000;
      if (secondsDiff > 30) {
        continue;
      }

      const msgId = String(message.message_id);

      // Get sender (who sent the message)
      const senderTelegramUsername = (message.from?.username || '').toLowerCase();
      let assignedByCode = 'system';
      let assignedByName = 'Telegram Bot';
      
      if (senderTelegramUsername) {
        const sender = await getOne(
          `SELECT * FROM users WHERE is_active = 1 AND (LOWER(telegram_username) = ? OR LOWER(telegram_username) = ?)` ,
          [`@${senderTelegramUsername}`, senderTelegramUsername]
        );
        if (sender) {
          assignedByCode = sender.code;
          assignedByName = sender.name;
        }
      }

      const assignee = await getOne(
        `SELECT * FROM users WHERE is_active = 1 AND (LOWER(telegram_username) = ? OR LOWER(telegram_username) = ?)` ,
        [`@${mentionedUsername}`, mentionedUsername]
      );

if (!assignee) {
        console.log('[Telegram Polling] No user linked for @' + mentionedUsername);
        try {
          const key = `${chatId}:${msgId}`;
          if (!_alertedUnlinked.has(key)) {
            _alertedUnlinked.add(key);
            const alert = `⚠️ <b>Unlinked Telegram User</b>\n\nMessage: "${text}"\nMentioned: @${mentionedUsername}\n\nThis Telegram username is not linked to any active user account. Please link it in User Management.`;
            await sendTelegram(cfg, chatId, alert);
          }
        } catch (e) {
          // ignore
        }
        continue;
      }

      // Check if already processed by source_message_id
      try {
        const existing = await getOne(
          'SELECT code FROM trs_tasks WHERE source_message_id = ? AND source_chat_id = ?',
          [msgId, chatId]
        );
        if (existing) {
          console.log('[Telegram Polling] Already processed message_id:', msgId, '-> task:', existing.code);
          continue;
        }
      } catch (e) {
        // ignore if columns missing
      }
      try {
        const existing2 = await getOne(
          'SELECT code FROM trs_tasks WHERE source_message_id = ?',
          [msgId]
        );
        if (existing2) {
          console.log('[Telegram Polling] Already processed message_id (any source):', msgId, '-> task:', existing2.code);
          continue;
        }
      } catch (e) {
        // ignore
      }
      // Extra guard: prevent same title+assignee created in last 30 seconds
      try {
        const recent = await getOne(
          `SELECT code FROM trs_tasks WHERE assigned_to = ? AND title = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 SECOND) ORDER BY created_at DESC LIMIT 1`,
          [assignee.code, taskData.title]
        );
        if (recent) {
          console.log('[Telegram Polling] Skipping duplicate recent task for same assignee/title');
          continue;
        }
      } catch (e) {
        // ignore
      }

      const aiResult = await parseChatMessageWithAI(text, mentionedUsername);

      const deadline = aiResult.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const assignedDate = new Date().toISOString().slice(0, 10);

      const taskData = {
        code: makeCode('trs'),
        title: aiResult.title,
        description: aiResult.description,
        assigned_by: assignedByCode,
        assigned_by_name: assignedByName,
        assigned_to: assignee.code,
        assigned_to_name: assignee.name,
        department: assignee.department,
        assigned_date: assignedDate,
        deadline,
        priority: aiResult.priority,
        instructions: aiResult.scope,
        scope: aiResult.scope,
        quality_criteria: aiResult.quality_criteria,
        progress: 0,
        status: 'Pending',
        source: 'telegram_chat',
        source_message_id: String(message.message_id),
        source_chat_id: chatId
      };

      console.log('=== TELEGRAM CHAT -> TRS TASK (Auto-Poll) ===');
      console.log('Raw message:', text);
      console.log('Sender (from):', `@${senderTelegramUsername}`);
      console.log('Assigned by:', assignedByCode, assignedByName);
      console.log('Mentioned user:', `@${mentionedUsername}`);
      console.log('Assignee:', assignee.code, assignee.name);
      console.log('AI Extracted:', JSON.stringify(aiResult, null, 2));
      console.log('Task Data:', JSON.stringify(taskData, null, 2));
      console.log('================================');

      // Insert into database (handle schema variations)
      try {
        await query(
          `INSERT INTO trs_tasks
            (code, title, assigned_by, assigned_by_name, assigned_to, assigned_to_name, department,
             description, assigned_date, deadline, priority, progress, instructions, scope, quality_criteria, status, source, source_message_id, source_chat_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [taskData.code, taskData.title, taskData.assigned_by, taskData.assigned_by_name,
           taskData.assigned_to, taskData.assigned_to_name, taskData.department,
           taskData.description, taskData.assigned_date, taskData.deadline,
           taskData.priority, taskData.progress, taskData.instructions, taskData.scope,
           taskData.quality_criteria, taskData.status, taskData.source, taskData.source_message_id, taskData.source_chat_id]
        );
      } catch (e) {
        if (e?.message?.includes("Column count doesn't match") || e?.message?.includes('Unknown column') || e?.code === 'ER_BAD_FIELD_ERROR') {
          await query(
            `INSERT INTO trs_tasks
              (code, title, assigned_by, assigned_by_name, assigned_to, assigned_to_name, department,
               description, assigned_date, deadline, priority, progress, instructions, scope, quality_criteria, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [taskData.code, taskData.title, taskData.assigned_by, taskData.assigned_by_name,
             taskData.assigned_to, taskData.assigned_to_name, taskData.department,
             taskData.description, taskData.assigned_date, taskData.deadline,
             taskData.priority, taskData.progress, taskData.instructions, taskData.scope,
             taskData.quality_criteria, taskData.status]
          );
        } else if (e?.code === 'ER_DUP_ENTRY') {
          console.log('[Telegram Polling] Duplicate prevented:', msgId);
          continue;
        } else {
          throw e;
        }
      }
      console.log('[Telegram Polling] Task saved to DB:', taskData.code);

      // Reply to Telegram group
      try {
        const replyText = `✅ <b>Task Created</b>\n\n<b>Title:</b> ${taskData.title}\n<b>Assigned to:</b> ${assignee.name} (@${mentionedUsername})\n<b>Assigned by:</b> ${assignedByName}\n<b>Priority:</b> ${taskData.priority}\n<b>Deadline:</b> ${deadline}`;
        
        await sendTelegram(cfg, chatId, replyText, { buttonText: '🚀 View Task' });
        console.log('[Telegram Polling] Reply sent to group');
      } catch (err) {
        console.error('[Telegram Polling] Failed to send reply:', err.message);
      }

      processed++;
    } catch (err) {
      console.error('[Telegram Polling] Error processing message:', err.message);
    }
  }

  if (maxId > offset) {
    try {
      const newOffset = maxId + 1;
      await query('UPDATE telegram_config SET update_offset = ? WHERE id = 1', [newOffset]);
      bustTelegramConfig();
      console.log('[Telegram Polling] Updated offset:', offset, '->', newOffset);
    } catch (err) {
      console.error('[Telegram Polling] Failed to update offset:', err.message);
    }
  }

  return { processed };
}

export function startTelegramPolling(intervalMs = 20000) {
  if (_pollingInterval) {
    clearInterval(_pollingInterval);
  }
  console.log('[Telegram Polling] Starting auto-poll every', intervalMs, 'ms');
  _pollingInterval = setInterval(async () => {
    try {
      const cfg = await getTelegramConfig(true);
      if (cfg?.is_enabled && cfg?.bot_token && cfg?.main_group_chat_id) {
        const result = await processTelegramMessages(cfg.bot_token);
        if (result.processed > 0) {
          console.log('[Telegram Polling] Processed', result.processed, 'messages');
        }
      }
    } catch (err) {
      console.error('[Telegram Polling] Error:', err.message);
    }
  }, intervalMs);
  return _pollingInterval;
}

export function stopTelegramPolling() {
  if (_pollingInterval) {
    clearInterval(_pollingInterval);
    _pollingInterval = null;
    console.log('[Telegram Polling] Stopped');
  }
}