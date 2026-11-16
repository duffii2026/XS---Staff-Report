import { Router } from 'express';
import crypto from 'node:crypto';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { getOne, query } from '../config/db.js';
import { requireUser, requireRole } from '../middleware/auth.js';
import { getTelegramConfig, saveTelegramConfig, sendTelegram, parseTriggers, telegramFetch, pollTelegramUpdates, checkTelegramChat } from '../services/telegram.js';
import { buttonTextForEvent } from '../services/notificationFlow.js';
import { logActivity, notifyUser, makeCode } from '../services/audit.js';
import { dispatchFlow } from '../services/notificationFlow.js';
import { parseChatMessageWithAI } from '../services/aiParser.js';

const router = Router();

/**
 * Turn a raw Telegram failure into something an admin can act on.
 * "chat not found" almost always means the bot was never added to the group.
 */
function friendlyChatError(detail, chatId, botUsername) {
  const d = String(detail || '').trim();
  const bot = String(botUsername || '').replace(/^@/, '');
  const botRef = bot ? `@${bot}` : 'the bot';
  if (/chat not found/i.test(d)) {
    return `Telegram cannot find chat "${chatId}". ${botRef} is not a member of that chat — add ${botRef} as an Administrator (or send any message in the group) and confirm the Chat ID is correct.`;
  }
  if (/bot was kicked|not a member|Forbidden/i.test(d)) {
    return `${botRef} is not (or is no longer) a member of chat "${chatId}". Add it to the group as an Administrator and confirm the Chat ID is correct.`;
  }
  if (/bot is blocked|bot can't initiate/i.test(d)) {
    return `${botRef} cannot start a conversation with chat "${chatId}". Open the chat in Telegram and press Start first, then link your Chat ID from the Staff Directory tab.`;
  }
  if (/group chat was upgraded/i.test(d)) {
    return `Chat "${chatId}" is not a supergroup yet. Upgrade the group to a supergroup (or use a channel) and retry.`;
  }
  return `Telegram send failed: ${d || 'unknown error'}`;
}

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
    webhook_secret: cfg?.webhook_secret || null,
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

/**
 * POST /api/telegram/get-chat — Get specific chat info by chat_id
 */
router.post('/get-chat', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const cfg = await getTelegramConfig(true);
  let token = String(b.bot_token || '').trim();
  if (!token || token.startsWith('xxx')) token = cfg?.bot_token || '';
  if (!token) throw new ApiError(400, 'Bot token is required.');
  
  const chatId = b.chat_id;
  if (!chatId) throw new ApiError(400, 'chat_id is required.');
  
  const j = await telegramFetch(token, `/getChat?chat_id=${encodeURIComponent(String(chatId))}`, { timeoutMs: 10000 });
  if (!j.ok) throw new ApiError(502, `Telegram getChat failed: ${j.description}`);
  
  ok(res, { ok: true, result: j.result });
}));

/** POST /api/telegram/test — send test message to a chat id (all roles; non-admin to own chat only) */
router.post('/test', requireUser, asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  const me = await getOne('SELECT telegram_chat_id FROM users WHERE code = ?', [req.user.code]);
  const myChatId = me?.telegram_chat_id || null;
  const requested = req.body?.chat_id;
  const isPrivileged = ['admin', 'executive', 'hr'].includes(req.user.role);
  let chatId = requested || myChatId || cfg?.main_group_chat_id;

  // Non-admin/executive roles may only test-ping their own linked Telegram chat.
  if (!isPrivileged) {
    if (!myChatId) throw new ApiError(400, 'No Telegram chat ID linked to your account yet. Connect your Chat ID first.');
    if (requested && String(requested) !== String(myChatId)) throw new ApiError(403, 'You can only send test pings to your own linked Telegram chat ID.');
    chatId = myChatId;
  }

  if (!chatId) throw new ApiError(400, 'No Telegram chat to send to. Link your Telegram account (Connect Telegram in the top bar) or configure a channel Chat ID.');
  if (!cfg?.bot_token) throw new ApiError(400, 'No bot token stored yet — paste a token and click "Verify Token" first.');
  if (!cfg?.is_enabled) throw new ApiError(400, 'Telegram integration is disabled. Enable the "Telegram Integration" switch first.');

  // Validate the destination up-front so a wrong Chat ID produces an actionable
  // message instead of a raw "Bad Request: chat not found" from Telegram.
  let check = await checkTelegramChat(cfg.bot_token, chatId);
  let fellBack = false;
  if (!check.ok && isPrivileged && myChatId && String(myChatId) !== String(chatId)) {
    // The configured group is unreachable — fall back to the admin's own linked
    // chat so a connectivity check can still be completed.
    const personal = await checkTelegramChat(cfg.bot_token, myChatId);
    if (personal.ok) {
      check = personal;
      chatId = myChatId;
      fellBack = true;
    }
  }
  if (!check.ok) throw new ApiError(502, friendlyChatError(check.detail, chatId, cfg?.bot_username));

  const text = req.body?.text || `🎉 <b>WELCOME TO APA STAFF REPORT 1!</b>\n\nHello <b>${req.user.name}</b>,\nYour Telegram connection is now active. You will receive task alerts, report updates, and deadline reminders here.`;
  const result = await sendTelegram(cfg, chatId, text, { buttonText: buttonTextForEvent('TEST_MESSAGE') });
  if (!result.sent) throw new ApiError(502, friendlyChatError(result.detail || result.reason, chatId, cfg?.bot_username));
  await logActivity(req.user, { action: 'TELEGRAM_TEST', details: `Test message sent to ${chatId}`, req });
  ok(res, { sent: true, chatId, chat: check.chat, fell_back_to_personal_chat: fellBack });
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

  // Persist a freshly provided token so the bot becomes live immediately, and
  // auto-assign the bot username reported by Telegram so the 1-click connect
  // deep link (t.me/<bot>?start=...) always points at the live bot.
  const rawProvided = String(req.body?.bot_token || '').trim();
  const tokenProvided = !!rawProvided && !rawProvided.startsWith('xxx');
  const botUsername = meRes.result.username ? `@${meRes.result.username}` : '';
  const patch = {};
  if (tokenProvided && token !== cfg?.bot_token) patch.bot_token = token;
  if (botUsername && botUsername !== cfg?.bot_username) patch.bot_username = botUsername;
  if (Object.keys(patch).length) await saveTelegramConfig(patch);

  ok(res, {
    valid: true,
    bot: { id: meRes.result.id, username: meRes.result.username, first_name: meRes.result.first_name },
    bot_username: botUsername,
    token_saved: tokenProvided,
    username_assigned: !!patch.bot_username
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

/**
 * POST /api/telegram/poll — Manual polling for local testing (no webhook needed)
 * Call this endpoint to check for new messages via getUpdates
 */
router.post('/poll', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  if (!cfg?.bot_token) throw new ApiError(400, 'Bot token not configured.');
  if (!cfg?.is_enabled) throw new ApiError(400, 'Telegram integration is disabled.');
  
  console.log('[Polling] Starting manual poll...');
  const updates = await pollTelegramUpdates(cfg.bot_token, { timeoutMs: 10000 });
  
  let processed = 0;
  for (const update of updates) {
    const message = update?.message || update?.channel_post;
    if (!message?.text) continue;
    
    const chatId = String(message.chat?.id);
    const text = message.text.trim();
    
    // Only process messages from configured main group
    if (cfg?.main_group_chat_id && chatId !== String(cfg.main_group_chat_id)) {
      console.log('[Polling] Ignoring message from non-main group:', chatId);
      continue;
    }
    
    // Extract @username mention
    const mentionMatch = text.match(/^@(\w+)\s+(.+)$/);
    if (!mentionMatch) continue;
    
    const mentionedUsername = mentionMatch[1].toLowerCase();
    
    // Find assignee
    const assignee = await getOne(
      `SELECT * FROM users WHERE is_active = 1 AND (LOWER(telegram_username) = ? OR LOWER(telegram_username) = ?)`,
      [`@${mentionedUsername}`, mentionedUsername]
    );
    
    if (!assignee) {
      console.log('[Polling] No user linked for @' + mentionedUsername);
      continue;
    }
    
    // Parse with AI
    const aiResult = await parseChatMessageWithAI(text, mentionedUsername);
    
    const deadline = aiResult.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const assignedDate = new Date().toISOString().slice(0, 10);
    
    const taskData = {
      code: makeCode('trs'),
      title: aiResult.title,
      description: aiResult.description,
      assigned_by: assignee.superior_id || 'system',
      assigned_by_name: assignee.superior_id ? 'Superior' : 'Telegram Bot',
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
    
    console.log('=== TELEGRAM CHAT -> TRS TASK (Polling) ===');
    console.log('Raw message:', text);
    console.log('Mentioned user:', `@${mentionedUsername}`);
    console.log('Assignee:', assignee.code, assignee.name);
    console.log('AI Extracted:', JSON.stringify(aiResult, null, 2));
    console.log('Task Data:', JSON.stringify(taskData, null, 2));
    console.log('================================');
    
    processed++;
  }
  
  ok(res, { polled: true, updates_received: updates.length, messages_processed: processed });
}));

/**
 * POST /api/telegram/webhook — Telegram webhook handler for chat messages
 * Receives messages from Telegram, parses @mentions, creates TRS tasks via AI
 */
router.post('/webhook', asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  
  // 1. Verify webhook secret
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (cfg?.webhook_secret && secret !== cfg.webhook_secret) {
    console.warn('[Webhook] Invalid secret');
    return res.sendStatus(200);
  }
  
  // 2. Process message (supports both message and channel_post)
  const message = req.body?.message || req.body?.channel_post;
  if (!message?.text) return res.sendStatus(200);
  
  const chatId = String(message.chat?.id);
  const fromUsername = (message.from?.username || '').toLowerCase();
  const text = message.text.trim();
  
  // 3. Only process messages from configured main group (if configured)
  if (cfg?.main_group_chat_id && chatId !== String(cfg.main_group_chat_id)) {
    console.log('[Webhook] Ignoring message from non-main group:', chatId);
    return res.sendStatus(200);
  }
  
  // 4. Extract @username mention from start of message
  const mentionMatch = text.match(/^@(\w+)\s+(.+)$/);
  if (!mentionMatch) return res.sendStatus(200);
  
  const mentionedUsername = mentionMatch[1].toLowerCase();
  const messageContent = mentionMatch[2].trim();
  
  // 5. Find assignee by telegram_username (match with or without @ prefix)
  const assignee = await getOne(
    `SELECT * FROM users 
     WHERE is_active = 1 
     AND (LOWER(telegram_username) = ? OR LOWER(telegram_username) = ?)`,
    [`@${mentionedUsername}`, mentionedUsername]
  );
  
  if (!assignee) {
    console.log('[Webhook] No user linked for @' + mentionedUsername);
    return res.sendStatus(200);
  }
  
  // 6. Parse with AI
  const aiResult = await parseChatMessageWithAI(text, mentionedUsername);
  
  // 7. Set defaults
  const deadline = aiResult.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const assignedDate = new Date().toISOString().slice(0, 10);
  
  // 8. Build task data
  const taskData = {
    code: makeCode('trs'),
    title: aiResult.title,
    description: aiResult.description,
    assigned_by: assignee.superior_id || 'system',
    assigned_by_name: assignee.superior_id ? 'Superior' : 'Telegram Bot',
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
  
  // PHASE 1: Console log only
  console.log('=== TELEGRAM CHAT -> TRS TASK ===');
  console.log('Raw message:', text);
  console.log('Mentioned user:', `@${mentionedUsername}`);
  console.log('Assignee:', assignee.code, assignee.name);
  console.log('AI Extracted:', JSON.stringify(aiResult, null, 2));
  console.log('Task Data:', JSON.stringify(taskData, null, 2));
  console.log('================================');
  
  // PHASE 2 (uncomment to enable DB write):
  /*
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
  
  await notifyUser({ recipientCode: assignee.code, senderCode: 'system', senderName: 'APA Bot', type: 'TRS_ASSIGNED', title: `New task from chat: ${taskData.title}`, message: `Task ${taskData.code} assigned via Telegram. Deadline: ${deadline}.`, linkTab: 'trs' });
  await dispatchFlow({ eventType: 'TRS_ASSIGN', title: taskData.title, staffName: assignee.name, superiorName: 'Telegram Bot', department: assignee.department, deadline, status: 'Pending', priority: taskData.priority, notes: 'Task created from Telegram chat message.', details: `Source: Telegram chat`, targetUserCode: assignee.code });
  await logActivity({ code: 'system', name: 'Telegram Bot', role: 'system' }, { action: 'TRS_CREATE_CHAT', details: `Created ${taskData.code} for ${assignee.code} from Telegram message`, req: null });
  */
  
  res.sendStatus(200);
}));

/**
 * POST /api/telegram/set-webhook — Admin configures webhook URL
 */
router.post('/set-webhook', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  if (!cfg?.bot_token) throw new ApiError(400, 'Bot token not configured.');
  
  const { url, secret_token } = req.body || {};
  if (!url) throw new ApiError(400, 'Webhook URL required.');
  
  const webhookSecret = secret_token || crypto.randomBytes(32).toString('hex');
  
  const j = await telegramFetch(cfg.bot_token, '/setWebhook', {
    method: 'POST',
    body: { url, secret_token: webhookSecret, allowed_updates: ['message', 'channel_post'] }
  });
  
  if (!j.ok) throw new ApiError(502, `Telegram setWebhook failed: ${j.description}`);
  
  await saveTelegramConfig({ webhook_secret: webhookSecret, update_offset: 0 });
  
  await logActivity(req.user, { action: 'TELEGRAM_SET_WEBHOOK', details: `Webhook set to ${url}`, req });
  ok(res, { success: true, webhook_secret: webhookSecret });
}));

/**
 * POST /api/telegram/delete-webhook — Admin removes webhook
 */
router.post('/delete-webhook', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  if (!cfg?.bot_token) throw new ApiError(400, 'Bot token not configured.');
  
  const j = await telegramFetch(cfg.bot_token, '/deleteWebhook', { method: 'POST' });
  if (!j.ok) throw new ApiError(502, `Telegram deleteWebhook failed: ${j.description}`);
  
  await saveTelegramConfig({ webhook_secret: null });
  await logActivity(req.user, { action: 'TELEGRAM_DELETE_WEBHOOK', details: 'Webhook deleted', req });
  ok(res, { success: true });
}));

/**
 * POST /api/telegram/webhook-info — Get current webhook info
 */
router.get('/webhook-info', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const cfg = await getTelegramConfig(true);
  if (!cfg?.bot_token) throw new ApiError(400, 'Bot token not configured.');
  
  const j = await telegramFetch(cfg.bot_token, '/getWebhookInfo');
  if (!j.ok) throw new ApiError(502, `Telegram getWebhookInfo failed: ${j.description}`);
  
  ok(res, { webhook: j.result, has_secret: !!cfg.webhook_secret });
}));

export default router;
