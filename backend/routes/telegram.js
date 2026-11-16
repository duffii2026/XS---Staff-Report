import { Router } from 'express';
import crypto from 'node:crypto';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { getOne, query } from '../config/db.js';
import { requireUser, requireRole } from '../middleware/auth.js';
import { getTelegramConfig, saveTelegramConfig, sendTelegram, parseTriggers, telegramFetch, pollTelegramUpdates } from '../services/telegram.js';
import { buttonTextForEvent } from '../services/notificationFlow.js';
import { logActivity } from '../services/audit.js';

const router = Router();

/** GET /api/telegram/config — admin/executive (bot_token only when ?includeToken=1) */
router.get('/config', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  const includeToken = req.query.includeToken === '1';
  ok(res, {
    is_enabled: !!cfg?.is_enabled,
    has_token: !!(cfg?.bot_token),
    bot_token: includeToken ? (cfg?.bot_token || '') : undefined,
    bot_username: cfg?.bot_username || '',
    main_group_chat_id: cfg?.main_group_chat_id || null,
    channel_name: cfg?.channel_name || null,
    triggers: cfg?.triggers ? parseTriggers(cfg) : [],
    updated_at: cfg?.updated_at
  });
}));

/** PUT /api/telegram/config — admin */
router.put('/config', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  // token only written when explicitly provided (never echoed back)
  const patch = {};
  for (const k of ['is_enabled', 'bot_username', 'main_group_chat_id', 'channel_name', 'triggers', 'user_map']) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  if (b.bot_token !== undefined) {
    const t = String(b.bot_token);
    if (t.startsWith(':')) patch.bot_token = t.slice(1);            // ':<token>' = store
    else if (t === '' || t.startsWith('xxx')) patch.bot_token = '';   // empty / masked = clear
    else patch.bot_token = t;                                         // plain token = store
  }
  await saveTelegramConfig(patch);
  await logActivity(req.user, { action: 'TELEGRAM_UPDATE', details: 'Updated Telegram config', req });
  ok(res, { updated: true });
}));

/** POST /api/telegram/groups — validate token + list chats the bot belongs to */
router.post('/groups', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const cfg = await getTelegramConfig(true);
  let token = String(b.bot_token || '').trim();
  if (!token || token.startsWith('xxx')) token = cfg?.bot_token || '';
  if (!token) throw new ApiError(400, 'Bot token is required. Paste the token next to the Get Groups button first.');

let meRes;
  try {
    meRes = await telegramFetch(token, '/getMe', { timeoutMs: 10000 });
  } catch (err) {
    throw new ApiError(502, `Telegram unreachable: ${err.message}`);
  }
  if (!meRes.ok || !meRes.result) {
    throw new ApiError(502, `Invalid bot token: ${meRes.description || 'Telegram rejected the request.'}`);
  }

  // Persist a freshly provided token so the bot becomes live immediately.
  const tokenProvided = String(b.bot_token || '').trim() && !String(b.bot_token).trim().startsWith('xxx');
  if (tokenProvided && token !== cfg?.bot_token) {
    await saveTelegramConfig({ bot_token: token });
  }

let updates = [];
  try {
    const j = await telegramFetch(token, `/getUpdates?limit=100&timeout=0&allowed_updates=${encodeURIComponent('["message","channel_post","my_chat_member","chat_member"]')}`, { timeoutMs: 15000 });
    if (!j.ok) throw new Error(j.description || 'getUpdates failed');
    updates = j.result || [];
  } catch (err) {
    throw new ApiError(502, `Could not list groups (getUpdates): ${err.message}`);
  }

  const seen = new Map();
  const collect = (chat) => {
    if (!chat || !chat.id || chat.type === 'private') return;
    const key = String(chat.id);
    if (!seen.has(key)) {
      seen.set(key, {
        chat_id: chat.id,
        type: chat.type,
        title: chat.title || chat.username || `Chat ${chat.id}`,
        username: chat.username || null
      });
    }
  };
  for (const u of updates) {
    if (u.message?.chat) collect(u.message.chat);
    if (u.channel_post?.chat) collect(u.channel_post.chat);
    if (u.my_chat_member?.chat) collect(u.my_chat_member.chat);
    if (u.chat_member?.chat) collect(u.chat_member.chat);
    if (u.edited_message?.chat) collect(u.edited_message.chat);
    if (u.edited_channel_post?.chat) collect(u.edited_channel_post.chat);
  }

  // Enrich titles/usernames via getChat where possible (bounded calls).
  const groups = [...seen.values()];
for (const g of groups.slice(0, 40)) {
    try {
      const j = await telegramFetch(token, `/getChat?chat_id=${encodeURIComponent(String(g.chat_id))}`, { timeoutMs: 10000 });
      if (j.ok && j.result) {
        g.title = j.result.title || j.result.username || g.title;
        g.username = j.result.username || g.username;
      }
    } catch { /* best effort */ }
  }

  ok(res, {
    bot: { id: meRes.result.id, username: meRes.result.username, first_name: meRes.result.first_name },
    token_saved: tokenProvided,
    groups
  });
}));

/** POST /api/telegram/test — send test message to a chat id (all roles; non-admin to own chat only) */
router.post('/test', requireUser, asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  const me = await getOne('SELECT telegram_chat_id FROM users WHERE code = ?', [req.user.code]);
  const myChatId = me?.telegram_chat_id || null;
  const requested = req.body?.chat_id;
  let chatId = requested || myChatId || cfg?.main_group_chat_id;

  // Non-admin/executive roles may only test-ping their own linked Telegram chat.
  if (!['admin', 'executive', 'hr'].includes(req.user.role)) {
    if (!myChatId) throw new ApiError(400, 'No Telegram chat ID linked to your account yet. Connect your Chat ID first.');
    if (requested && String(requested) !== String(myChatId)) throw new ApiError(403, 'You can only send test pings to your own linked Telegram chat ID.');
    chatId = myChatId;
  }

  if (!chatId) throw new ApiError(400, 'No chat_id (or main_group_chat_id) to send to.');
  const text = req.body?.text || `🎉 <b>WELCOME TO APA STAFF REPORT!</b>\n\nHello <b>${req.user.name}</b>,\nYour Telegram connection is now active. You will receive task alerts, report updates, and deadline reminders here.`;
  const result = await sendTelegram(cfg, chatId, text, { buttonText: buttonTextForEvent('TEST_MESSAGE') });
  if (!result.sent) throw new ApiError(502, `Telegram send failed: ${result.detail || result.reason || 'unknown'}`);
  await logActivity(req.user, { action: 'TELEGRAM_TEST', details: `Test message sent to ${chatId}`, req });
  ok(res, { sent: true, chatId });
}));

/** POST /api/telegram/verify-token — validate the Bot Token via /getMe */
router.post('/verify-token', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  let token = String(req.body?.bot_token || '').trim();
  if (!token || token.startsWith('xxx')) token = cfg?.bot_token || '';
  if (!token) throw new ApiError(400, 'Bot token is required. Paste the token next to Verify Token first.');

  let meRes;
  try {
    meRes = await telegramFetch(token, '/getMe', { timeoutMs: 10000 });
  } catch (err) {
    throw new ApiError(502, `Telegram unreachable: ${err.message}`);
  }
  if (!meRes.ok || !meRes.result) {
    throw new ApiError(502, `Invalid bot token: ${meRes.description || 'Telegram rejected the request.'}`);
  }

  // Persist a freshly provided token so the bot becomes live immediately.
  const rawProvided = String(req.body?.bot_token || '').trim();
  const tokenProvided = !!rawProvided && !rawProvided.startsWith('xxx');
  if (tokenProvided && token !== cfg?.bot_token) {
    await saveTelegramConfig({ bot_token: token });
  }

  ok(res, {
    valid: true,
    bot: { id: meRes.result.id, username: meRes.result.username, first_name: meRes.result.first_name },
    token_saved: tokenProvided
  });
}));

/** GET /api/telegram/status — everything except the token */
router.get('/status', requireUser, asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  const me = await getOne('SELECT username, name, telegram_chat_id, telegram_username, telegram_connected_at FROM users WHERE code = ?', [req.user.code]);
ok(res, {
    is_enabled: !!cfg?.is_enabled,
    has_token: !!(cfg?.bot_token),
    bot_username: cfg?.bot_username || null,
    channel_name: cfg?.channel_name || null,
    main_group_chat_id: cfg?.main_group_chat_id || null,
    my_connection: {
      chat_id: me?.telegram_chat_id || null,
      username: me?.telegram_username || null,
      connected_at: me?.telegram_connected_at || null
    },
    triggers: cfg?.triggers ? parseTriggers(cfg) : []
  });
}));

/** PUT /api/telegram/me — staff connects/disconnects their own chat id */
router.put('/me', requireUser, asyncHandler(async (req, res) => {
  const { telegram_chat_id, telegram_username } = req.body || {};
  if (telegram_chat_id === undefined) throw new ApiError(400, 'telegram_chat_id is required.');
  const has = !!String(telegram_chat_id || '').trim();
  await query(
    `UPDATE users SET telegram_chat_id = ?, telegram_username = ?, telegram_connected_at = ${has ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE code = ?`,
    [has ? String(telegram_chat_id).trim() : null, has ? (telegram_username || null) : null, req.user.code]
  );
  ok(res, { connected: has });
}));

/**
 * POST /api/telegram/link-request
 * Issue a one-time deep-link code for the 1-click connect flow:
 *   https://t.me/<bot>?start=<code>
 * The user opens the bot in Telegram and presses Start; the bot's
 * getUpdates then reports their real chat_id + username back to us.
 */
router.post('/link-request', requireUser, asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  if (!cfg?.bot_token) {
    throw new ApiError(400, 'Telegram bot is not activated yet. An Admin must add the Bot Token first.');
  }
  const botUsername = String(cfg.bot_username || '').replace(/^@/, '').trim();
  if (!botUsername) {
    throw new ApiError(400, 'Bot username is not set. Admin must save the bot username in Telegram settings first.');
  }

  // Clean up stale handshakes for this user before minting a fresh one.
  await query('DELETE FROM telegram_link_tokens WHERE user_code = ?', [req.user.code]);

  const code = 'apa_' + crypto.randomBytes(6).toString('hex');
  await query(
    'INSERT INTO telegram_link_tokens (code, user_code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
    [code, req.user.code]
  );

  ok(res, {
    code,
    start_url: `https://t.me/${botUsername}?start=${code}`,
    bot_username: cfg.bot_username || '',
    expires_in_seconds: 600
  });
}));

/**
 * GET /api/telegram/link-status?code=...
 * Poll for the deep-link handshake result. Each call performs a short
 * getUpdates poll so the connection is detected the moment the user
 * presses Start (typical latency < 5s).
 */
router.get('/link-status', requireUser, asyncHandler(async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) throw new ApiError(400, 'Missing link code.');
  const tok = await getOne('SELECT * FROM telegram_link_tokens WHERE code = ? AND user_code = ?', [code, req.user.code]);
  if (!tok) throw new ApiError(400, 'Invalid or expired link code. Please tap Connect and try again.');

  if (tok.consumed && tok.chat_id) {
    ok(res, { connected: true, chat_id: tok.chat_id, username: tok.username || null });
    return;
  }

  const cfg = await getTelegramConfig(true);
  if (cfg?.bot_token) {
    try {
      await pollTelegramUpdates(cfg.bot_token, { timeoutMs: 3000 });
    } catch { /* transient poll errors are retried on the next poll */ }
    await query('DELETE FROM telegram_link_tokens WHERE expires_at < NOW()');
  }

  const fresh = await getOne('SELECT * FROM telegram_link_tokens WHERE code = ?', [code]);
  if (fresh?.consumed && fresh.chat_id) {
    ok(res, { connected: true, chat_id: fresh.chat_id, username: fresh.username || null });
  } else {
    ok(res, { connected: false });
  }
}));

export default router;
