import React, { useState, useEffect, useCallback } from 'react';
import { User, TelegramConfig } from '../types';
import { getTelegramConfig, saveTelegramConfig, sendPersonalTestMessage, getPortalUrl, getTelegramConfigAsync, getMyTelegramStatus, requestTelegramLink, pollTelegramLinkStatus, TelegramLinkRequest } from '../services/telegramService';
import { updateUserTelegramConnection } from '../services/storage';
import { confirmDialog } from './GlobalDialog';
import {
  Send,
  Bot,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  X,
  HelpCircle,
  Sparkles,
  Unlink,
  Key,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Eye,
  EyeOff,
  Check,
  Loader2
} from 'lucide-react';

interface TelegramConnectModalProps {
  currentUser: User;
  isOpen: boolean;
  onClose: () => void;
  onConnectionUpdated: (updatedUser: User) => void;
}

export const TelegramConnectModal: React.FC<TelegramConnectModalProps> = ({
  currentUser,
  isOpen,
  onClose,
  onConnectionUpdated
}) => {

  const [config, setConfig] = useState<TelegramConfig>(getTelegramConfig());

  const [chatIdInput, setChatIdInput] = useState(currentUser.telegramChatId || '');
  const [usernameInput, setUsernameInput] = useState(currentUser.telegramUsername || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isEditing, setIsEditing] = useState(!currentUser.telegramChatId);

  // Live Telegram connection state, fetched dynamically from the database
  const [liveConnection, setLiveConnection] = useState<{ chatId?: string; username?: string; connectedAt?: string; botUsername?: string; hasToken?: boolean } | null>(null);
  const [isFetchingConnection, setIsFetchingConnection] = useState(false);
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);

  // 1-click deep-link connect flow (t.me/<bot>?start=<code>)
  const [isWaitingConnect, setIsWaitingConnect] = useState(false);
  const [connectCode, setConnectCode] = useState<string | null>(null);
  const [connectStartedAt, setConnectStartedAt] = useState<number | null>(null);
  const [connectTimedOut, setConnectTimedOut] = useState(false);
  const MAX_CONNECT_WAIT_MS = 180000;

  const refreshLiveConnection = useCallback(async () => {
    try {
      setIsFetchingConnection(true);
      const conn = await getMyTelegramStatus();
      setLiveConnection({
        chatId: conn.chat_id || undefined,
        username: conn.username || undefined,
        connectedAt: conn.connected_at || undefined,
        botUsername: conn.bot_username || undefined,
        hasToken: conn.has_token
      });
      setIsEditing(!conn.chat_id && !conn.username);
    } catch {
      setLiveConnection(null);
    } finally {
      setIsFetchingConnection(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage(null);
    setConnectCode(null);
    setIsWaitingConnect(false);
    setConnectTimedOut(false);
    setIsLoadingSetup(true);
    Promise.all([
      refreshLiveConnection(),
      getTelegramConfigAsync().then(setConfig)
    ]).finally(() => setIsLoadingSetup(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Poll the backend until the user presses Start in Telegram and the
  // deep-link handshake is detected (auto-links chat_id + username).
  useEffect(() => {
    if (!isOpen || !connectCode) return;
    let cancelled = false;
    const startedAt = connectStartedAt ?? Date.now();

    const tick = async () => {
      if (cancelled) return;
      // Only poll the API while the tab is active; skip entirely in background tabs.
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - startedAt > MAX_CONNECT_WAIT_MS) {
        setConnectTimedOut(true);
        setIsWaitingConnect(false);
        setConnectCode(null);
        return;
      }
      try {
        const st = await pollTelegramLinkStatus(connectCode);
        if (cancelled) return;
        if (st.connected && st.chat_id) {
          setConnectCode(null);
          setIsWaitingConnect(false);
          await finishAutoConnect(st.chat_id, st.username || '');
        }
      } catch {
        // transient network errors — keep polling
      }
    };

    tick();
    const iv = setInterval(tick, 2500);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, connectCode]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Bot Token Configuration State
  const hasStoredToken = Boolean(config.botToken && config.botToken.trim().length > 15) || Boolean(config.hasToken);
  const [showBotTokenSettings, setShowBotTokenSettings] = useState(!hasStoredToken);
  const [botTokenInput, setBotTokenInput] = useState(config.botToken || '');
  const [botUsernameInput, setBotUsernameInput] = useState(config.botUsername || '');
  const [showBotTokenSecret, setShowBotTokenSecret] = useState(false);
  const [isSavingToken, setIsSavingToken] = useState(false);

  if (!isOpen) return null;

  const liveChatId = liveConnection?.chatId ?? currentUser.telegramChatId;
  const liveUsername = liveConnection?.username ?? currentUser.telegramUsername;
  const isConnected = !!(liveChatId || liveUsername);
  const isLoadingConnection = isFetchingConnection && liveConnection === null;
  const liveBotUsername = liveConnection?.botUsername || '';
  const botUsername = config.botUsername || liveBotUsername || '';
  const cleanBotUsername = botUsername.replace(/^@/, '');
  const botLink = `https://t.me/${cleanBotUsername}`;
  const isBotLive = Boolean(config.botToken && config.botToken.trim().length > 15) || Boolean(config.hasToken || liveConnection?.hasToken);

  const handleSaveBotToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingToken(true);
    setStatusMessage(null);
    try {
      const formattedUsername = botUsernameInput.trim().startsWith('@')
        ? botUsernameInput.trim()
        : `@${botUsernameInput.trim()}`;
      const cleanToken = botTokenInput.trim();

      const updated: TelegramConfig = {
        ...config,
        botToken: cleanToken,
        botUsername: formattedUsername || ''
      };

      // Empty input while a token already exists => keep the stored token untouched.
      if (!cleanToken && updated.hasToken) {
        saveTelegramConfig(updated);
        setStatusMessage({
          text: 'Bot account settings saved. The existing token was kept (input left blank).',
          type: 'success'
        });
      } else {
        saveTelegramConfig(updated, { botToken: cleanToken });
        if (cleanToken) {
          setStatusMessage({
            text: 'Live Bot Token saved to the database! You can now send a live test ping directly to your phone.',
            type: 'success'
          });
        } else {
          setStatusMessage({
            text: 'Bot Token cleared (operating in Simulation Mode).',
            type: 'info'
          });
        }
      }
      setConfig(updated);
      // Pull the authoritative state back from the backend (has_token).
      const fresh = await getTelegramConfigAsync();
      setConfig(fresh);
    } catch (err: any) {
      setStatusMessage({ text: err?.message || 'Failed to save Bot Token.', type: 'error' });
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatIdInput.trim()) {
      setStatusMessage({ text: 'Please enter your Telegram Chat ID.', type: 'error' });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const updated = updateUserTelegramConnection(
        currentUser.id,
        chatIdInput.trim(),
        usernameInput.trim()
      );

      if (updated) {
        onConnectionUpdated(updated);
        setLiveConnection({
          chatId: chatIdInput.trim(),
          username: usernameInput.trim() || undefined,
          connectedAt: new Date().toISOString()
        });
        setIsEditing(false);

        // Send an immediate welcome confirmation test message if bot token is active
        await sendWelcomeConfirmation(chatIdInput.trim());
      }
    } catch (err: any) {
      setStatusMessage({ text: err?.message || 'Failed to save Telegram connection.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const sendWelcomeConfirmation = async (chatId: string) => {
    if (!isBotLive) {
      setStatusMessage({
        text: 'Telegram account connected! Live notifications will arrive once the system bot is activated by Admin.',
        type: 'success'
      });
      return;
    }
    const portalUrl = getPortalUrl();
    const welcomeMsg = `🎉 <b>TELEGRAM ACCOUNT CONNECTED!</b>\n\nHello <b>${currentUser.name}</b>,\n\nYour Telegram account has been linked successfully to the <b>APA Staff Portal</b> via ${botUsername}.\n\n<b>What happens next:</b>\n• 📌 <b>Task Assignments:</b> Receive instant alerts when TRS tasks or directives are assigned to you\n• ⏰ <b>Smart Reminders:</b> Get timely notifications before deadlines so tasks and reports are never late\n• ✅ <b>Confirmations:</b> Instant receipt confirmations when weekly reports or task deliverables are submitted and reviewed\n\n👉 <a href="${portalUrl}">Open APA Staff Portal</a>`;

    const testRes = await sendPersonalTestMessage(
      currentUser.id,
      chatId,
      welcomeMsg,
      '🚀 Open APA Staff 1 Portal'
    );
    if (testRes.success && testRes.mode === 'sent') {
      setStatusMessage({
        text: 'Connected successfully! A welcome confirmation alert was sent to your Telegram phone.',
        type: 'success'
      });
    } else {
      setStatusMessage({
        text: `Telegram ID saved! Note: ${testRes.message}`,
        type: 'info'
      });
    }
  };

  const isRetryableError = (err: any) => {
    const s = err?.status;
    return s === 0 || s === 408 || s === undefined || /timed out|network|fetch/i.test(String(err?.message || ''));
  };

  // Retry a request on timeout/network errors (3 total attempts) instead of
  // surfacing the error immediately; a friendly message is shown only when all
  // attempts fail.
  const attemptWithRetry = async <T,>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> => {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (i < attempts - 1 && isRetryableError(err)) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };

  const startAutoConnect = async () => {
    setStatusMessage(null);
    setConnectTimedOut(false);
    if (!isBotLive) {
      setStatusMessage({
        text: 'Telegram bot is not activated yet. An Admin must add the Bot Token in “Telegram Bot API Token & Live Setup” below, then staff can connect.',
        type: 'error'
      });
      return;
    }
    const cleanUser = (botUsername || '').replace(/^@/, '').trim();
    if (!cleanUser) {
      setStatusMessage({ text: 'Bot username is not set. Admin must save it in Telegram settings first.', type: 'error' });
      return;
    }
    try {
      setIsWaitingConnect(true);
      setConnectStartedAt(Date.now());
      // No tab is opened here — the coded deep link must exist FIRST. Once the
      // backend mints the one-time code, the modal reveals the real link
      // (t.me/<bot>?start=<code>) for the user to click. No code-less tab ever opens.
      let link: TelegramLinkRequest;
      try {
        link = await attemptWithRetry(() => requestTelegramLink());
      } catch (err: any) {
        setIsWaitingConnect(false);
        const timedOut = err?.status === 408 || err?.status === 0 || /timed out|network|fetch/i.test(String(err?.message || ''));
        setStatusMessage({
          text: timedOut
            ? 'No internet connection. Please check your network and try again.'
            : (err?.message || 'Could not start the Telegram connection. Please try again.'),
          type: 'error'
        });
        return;
      }
      setConnectCode(link.code);
    } catch (err: any) {
      setIsWaitingConnect(false);
      setConnectCode(null);
      setStatusMessage({ text: err?.message || 'Could not start the Telegram connection. Please try again.', type: 'error' });
    }
  };

  const cancelAutoConnect = () => {
    setConnectCode(null);
    setIsWaitingConnect(false);
    setConnectTimedOut(false);
    setStatusMessage({ text: 'Connection cancelled. Tap "Connect with Telegram" to try again.', type: 'info' });
  };

  const finishAutoConnect = async (chatId: string, telegramUsername: string) => {
    const updated = updateUserTelegramConnection(currentUser.id, chatId, telegramUsername || '');
    if (updated) {
      onConnectionUpdated(updated);
      setLiveConnection({
        chatId,
        username: telegramUsername || undefined,
        connectedAt: new Date().toISOString()
      });
      setIsEditing(false);
      await sendWelcomeConfirmation(chatId);
    }
    refreshLiveConnection();
  };

  const handleDisconnect = async () => {
    if (await confirmDialog('Are you sure you want to disconnect Telegram alerts for your account?', { title: 'Disconnect Telegram', confirmText: 'Disconnect' })) {
      const updated = updateUserTelegramConnection(currentUser.id, undefined, undefined);
      if (updated) {
        onConnectionUpdated(updated);
        setChatIdInput('');
        setUsernameInput('');
        // Re-fetch the live status so the "bot is live" flag (has_token) is kept —
        // wiping to {} would wrongly show the "Admin needs to add the Bot Token" warning.
        await refreshLiveConnection();
        setStatusMessage({ text: 'Telegram account disconnected.', type: 'info' });
      }
    }
  };

  const handleSendTestPing = async () => {
    if (!liveChatId) return;
    setIsSendingTest(true);
    setStatusMessage(null);

    try {
      const res = await sendPersonalTestMessage(
        currentUser.id,
        liveChatId,
        undefined,
        '🚀 Open APA Staff 1 Portal'
      );
      if (res.mode === 'sent') {
        setStatusMessage({
          text: `✅ Success! Test alert delivered to your Telegram chat (@${cleanBotUsername}). Check your phone!`,
          type: 'success'
        });
      } else if (res.mode === 'failed') {
        setStatusMessage({
          text: `❌ ${res.message}`,
          type: 'error'
        });
      } else {
        setStatusMessage({
          text: '⚠️ Simulation Mode: Test alert was recorded in the internal Outbox only. Live alerts require Bot Token in Admin settings.',
          type: 'info'
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: err?.message || 'Failed to send test alert.', type: 'error' });
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] my-auto relative animate-in fade-in zoom-in-95 duration-150">
        {/* Loading modal — shown while fetching the admin bot token setup */}
        {isLoadingSetup && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white/85 backdrop-blur-sm">
            <Loader2 className="w-9 h-9 animate-spin text-blue-600" />
            <span className="text-xs font-bold text-slate-600">Loading Admin Bot Token Setup…</span>
          </div>
        )}
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-xs border border-white/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">Personal Telegram Alerts</h3>
              <p className="text-xs text-blue-100 mt-0.5">Private 1-on-1 notifications for tasks & reports</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
            title="Close (Esc)"
            aria-label="Close Telegram connect modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-slate-800 text-xs">
          {/* Status Message Banner */}
          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 font-medium text-xs leading-relaxed ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : statusMessage.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              ) : statusMessage.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              )}
              <span className="flex-1">{statusMessage.text}</span>
            </div>
          )}

          {/* Syncing live connection state from database */}
          {isLoadingConnection && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
              <span className="text-xs font-semibold">Syncing your Telegram connection from database…</span>
            </div>
          )}

          {/* Connected State */}
          {isConnected && !isEditing ? (
            <div className="space-y-4">
              {/* Connection Status Box */}
              <div
                className={`border rounded-2xl p-4 space-y-3 ${
                  isBotLive
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-amber-50/70 border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isBotLive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                      }`}
                    />
                    <span
                      className={`font-bold text-sm ${
                        isBotLive ? 'text-emerald-900' : 'text-amber-900'
                      }`}
                    >
                      {isBotLive ? 'Live Telegram Bot Active' : 'Chat ID Registered • Simulation Mode'}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                      isBotLive
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {isBotLive ? 'Configured' : 'No Bot Token'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-slate-700">
                  <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Personal Chat ID</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">{liveChatId}</span>
                    {liveUsername && (
                      <span className="block text-[10px] text-blue-600 font-medium mt-1">@{liveUsername}</span>
                    )}
                  </div>
                  <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Bot Channel</span>
                    <a
                      href={botLink}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-blue-600 hover:text-blue-700 text-xs flex items-center gap-1"
                    >
                      <span>{botUsername}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {/* Simulation Mode explanation if no bot token */}
                {!isBotLive && (
                  <div className="bg-white/90 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Why alerts are not appearing on your phone yet:</span>
                    </div>
                    <p className="text-amber-800 leading-relaxed">
                      Your Chat ID (<code>{liveChatId}</code>) is saved, but the system needs a{' '}
                      <strong>Telegram Bot Token</strong> from <strong>@BotFather</strong> to deliver real messages to Telegram.
                      Currently, test pings are only recorded in the internal Outbox log.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowBotTokenSettings(true)}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-800 underline cursor-pointer"
                    >
                      <Key className="w-3 h-3" />
                      Configure Bot Token below to activate phone alerts →
                    </button>
                  </div>
                )}

                {isBotLive && (
                  <p className="text-[11px] text-emerald-800 pt-0.5">
                    Private alerts are active for <strong>{currentUser.name}</strong>. Tasks delegated by your superior, evaluations, and deadline countdowns will be pushed directly to your Telegram.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSendTestPing}
                  disabled={isSendingTest}
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSendingTest ? 'Sending Test...' : 'Send Test Ping to My Telegram'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="px-3.5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold transition-all cursor-pointer"
                >
                  Change Chat ID
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3.5 py-2.5 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-xl font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  title="Disconnect Telegram"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span className="sm:hidden">Disconnect</span>
                </button>
              </div>
            </div>
          ) : (
            /* Setup / Connect — 1-click deep-link or manual fallback */
            <div className="space-y-4">
              {/* One-Tap Connect */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  One-Tap Connect — No IDs to Copy
                </h4>

                {isWaitingConnect ? (
                  connectCode ? (
                    <div className="flex flex-col items-center gap-3 py-3 text-center">
                      <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Your 1-click link is ready — tap it to open the bot, then press <strong>Start</strong>.
                        <br />
                        We will link your account automatically.
                      </p>
                      <a
                        href={`https://t.me/${cleanBotUsername}?start=${connectCode}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-700 transition-colors shadow-2xs"
                      >
                        <Send className="w-3 h-3" />
                        <span>Open {botUsername || 'the bot'} and press Start</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {connectTimedOut && (
                        <p className="text-[11px] text-rose-600 font-semibold">
                          Still waiting… Close this and tap “Connect with Telegram” to retry.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={cancelAutoConnect}
                        className="text-[11px] font-bold text-slate-500 hover:text-rose-600 underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-3 text-center">
                      <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Preparing your 1-click Telegram link…
                        <br />
                        The link only appears once the secure one-time code is ready.
                      </p>
                      <button
                        type="button"
                        onClick={cancelAutoConnect}
                        className="text-[11px] font-bold text-slate-500 hover:text-rose-600 underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )
                ) : (
                  <>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Tap the button below to prepare a secure 1-click link. Then open the bot and press <strong>Start</strong> — your account links instantly.{' '}
                      <strong>No need to copy any Chat ID or username.</strong>
                    </p>
                    <button
                      type="button"
                      onClick={startAutoConnect}
                      disabled={!isBotLive}
                      className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      Connect with Telegram
                    </button>
                    {!isBotLive && (
                      <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
                        <AlertTriangle className="w-3 h-3 inline-block text-amber-600 mr-1" />
                        The Admin needs to add the <strong>Bot Token</strong> in “Telegram Bot API Token & Live Setup” below before staff can connect.
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Manual fallback (advanced) */}
              <details className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden group">
                <summary className="px-4 py-3 font-bold text-slate-800 text-xs flex items-center gap-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden select-none">
                  <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="flex-1">Enter Telegram Chat ID manually (advanced)</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform shrink-0" />
                </summary>
                <form onSubmit={handleConnect} className="px-4 pb-4 pt-3 border-t border-slate-200 space-y-3">
                  <div>
                    <label className="block font-bold text-slate-700 text-xs mb-1">
                      Your Personal Telegram Chat ID <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={chatIdInput}
                      onChange={e => setChatIdInput(e.target.value.replace(/[^0-9-]/g, ''))}
                      placeholder="e.g. 5535405302"
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Your numeric personal ID from @userinfobot (private 1-on-1 chat).
                    </p>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-xs mb-1">
                      Your Telegram Username <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={e => setUsernameInput(e.target.value)}
                      placeholder="e.g. @sokmouy"
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="pt-1 flex items-center justify-end gap-2">
                    {isConnected && (
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSaving || !chatIdInput.trim()}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {isSaving ? 'Saving...' : 'Save & Connect Chat ID'}
                    </button>
                  </div>
                </form>
              </details>
            </div>
          )}

          {/* Bot Token Configuration Accordion (Restricted to Admin Only) */}
          {currentUser.role === 'admin' && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
              <button
                type="button"
                onClick={() => setShowBotTokenSettings(!showBotTokenSettings)}
                className="w-full px-4 py-3 bg-slate-100/70 hover:bg-slate-100 flex items-center justify-between text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-600" />
                  <span className="font-bold text-slate-900 text-xs">
                    Telegram Bot API Token & Live Setup
                  </span>
                  {isBotLive ? (
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                      Token Configured
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                      Action Needed for Live Alerts
                    </span>
                  )}
                </div>
                {showBotTokenSettings ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {showBotTokenSettings && (
                <form onSubmit={handleSaveBotToken} className="p-4 space-y-3 bg-white border-t border-slate-200">
                  <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3 text-[11px] text-blue-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span>How to get your Bot Token in 30 seconds:</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-0.5 text-blue-800 pt-0.5">
                      <li>
                        Open <strong>@BotFather</strong> on Telegram and send <code>/newbot</code>.
                      </li>
                      <li>Choose a name and username for your bot.</li>
                      <li>Copy the HTTP API token (e.g. <code>7123456789:AAFk7e8...</code>) and paste it below.</li>
                      <li>
                        Open your bot on Telegram and tap <strong>Start</strong> so it has permission to message you.
                      </li>
                    </ol>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-xs mb-1">
                      Telegram Bot Token
                    </label>
                    <div className="relative">
                      <input
                        type={showBotTokenSecret ? 'text' : 'password'}
                        value={botTokenInput}
                        onChange={e => setBotTokenInput(e.target.value)}
                        placeholder={config.hasToken ? 'Paste new token to replace…' : 'e.g. 7123456789:AAFk7e8_...'}
                        className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none pr-10 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowBotTokenSecret(!showBotTokenSecret)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showBotTokenSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {config.hasToken && (
                      <p className="text-[11px] text-emerald-700 mt-1 font-medium">
                        Token is configured. Leave the field blank to keep it; paste a new token to replace it.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 text-xs mb-1">
                      Bot Username <span className="text-slate-400 font-normal">(e.g. @username_bot)</span>
                    </label>
                    <input
                      type="text"
                      value={botUsernameInput}
                      onChange={e => setBotUsernameInput(e.target.value)}
                      placeholder="@Botusername"
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div className="pt-1 flex items-center justify-between gap-2">
                    {config.hasToken && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirmDialog('Clear the stored Telegram Bot Token? Live alerts will be disabled until a new token is saved.', { title: 'Clear Bot Token', confirmText: 'Clear Token' })) {
                            setStatusMessage(null);
                            const updated: TelegramConfig = { ...config, botToken: '', hasToken: false };
                            saveTelegramConfig(updated, { botToken: '' });
                            setConfig(updated);
                            setStatusMessage({ text: 'Bot Token cleared (Simulation Mode).', type: 'info' });
                            setBotTokenInput('');
                          }
                        }}
                        className="px-3 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-xs transition-all cursor-pointer"
                      >
                        Clear stored token
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSavingToken}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer ml-auto"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {isSavingToken ? 'Saving Token...' : (config.hasToken ? 'Save & Keep Token' : 'Save & Activate Live Bot')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Policy Note */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 space-y-1">
            <div className="font-bold text-slate-700 flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
              <span>Company Notification Policy</span>
            </div>
            <p>
              Notifications are governed centrally by company policy. When connected with an active Bot Token, official alerts for your assigned tasks, weekly report reviews, evaluations, and deadline countdowns are routed directly to your personal Telegram app.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

