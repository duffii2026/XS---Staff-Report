import React, { useState, useEffect } from 'react';
import { User, TelegramConfig, TelegramOutboxMessage } from '../types';
import { getUsers, updateUserTelegramConnection } from '../services/storage';
import {
  getTelegramConfig,
  getTelegramConfigAsync,
  saveTelegramConfig,
  getTelegramOutbox,
  clearTelegramOutbox,
  addTelegramOutboxLog,
  formatTelegramHTML,
  getTelegramButtonText
} from '../services/telegramService';
import { api } from '../services/api';
import {
  Send,
  Bot,
  Settings2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Trash2,
  Eye,
  EyeOff,
  User as UserIcon,
  Shield,
  HelpCircle,
  Radio,
  ExternalLink,
  Layers,
  FileText,
  ListTodo,
  Users,
  Link2,
  Loader2,
  ChevronDown,
  X,
  Save
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';

export interface TelegramGroupInfo {
  chat_id: number | string;
  type: string;
  title: string;
  username?: string | null;
}

interface TelegramIntegrationViewProps {
  currentUser: User;
}

export const TelegramIntegrationView: React.FC<TelegramIntegrationViewProps> = ({ currentUser }) => {
  const [config, setConfig] = useState<TelegramConfig>(getTelegramConfig());
  const [outboxLogs, setOutboxLogs] = useState<TelegramOutboxMessage[]>(getTelegramOutbox());
  const [users, setUsers] = useState<User[]>(getUsers());
  const [showToken, setShowToken] = useState(false);
  type TelegramTab = 'config' | 'triggers' | 'preview' | 'staff_mapping' | 'outbox';
  const TAB_KEY = 'apa_telegram_active_tab';
  const [activeTab, setActiveTabRaw] = useState<TelegramTab>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(TAB_KEY) : null;
    return (['config', 'triggers', 'preview', 'staff_mapping', 'outbox'] as TelegramTab[]).includes(saved as TelegramTab)
      ? (saved as TelegramTab) : 'config';
  });
  const setActiveTab = (tab: TelegramTab) => {
    setActiveTabRaw(tab);
    try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  };
  const [selectedPreviewEvent, setSelectedPreviewEvent] = useState<TelegramOutboxMessage['eventType']>('DEADLINE_ALERT');
  
  // Feedback toast
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testCustomNote, setTestCustomNote] = useState('');
  const [outboxFilter, setOutboxFilter] = useState<string>('all');
  const [configLoading, setConfigLoading] = useState(true);

  // Group selection
  const [groups, setGroups] = useState<TelegramGroupInfo[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<TelegramGroupInfo | null>(null);
  const [savedGroup, setSavedGroup] = useState<TelegramGroupInfo | null>(null);
  const [isLoadingSavedGroup, setIsLoadingSavedGroup] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    getTelegramConfigAsync().then((cfg) => {
      if (!cancelled) {
        setConfig(cfg);
        setConfigLoading(false);
        // Fetch saved group info if mainGroupChatId is set
        if (cfg.mainGroupChatId && cfg.botToken) {
          fetchSavedGroupInfo(cfg.mainGroupChatId, cfg.botToken);
        }
      }
    }).catch(() => {
      if (!cancelled) setConfigLoading(false);
    });
    const interval = setInterval(() => {
      setOutboxLogs(getTelegramOutbox());
    }, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const fetchSavedGroupInfo = async (chatId: string, botToken: string) => {
    setIsLoadingSavedGroup(true);
    try {
      const data = await api.post<any>('/telegram/groups', { bot_token: botToken });
      const group = data.groups?.find((g: TelegramGroupInfo) => String(g.chat_id) === String(chatId));
      if (group) {
        setSavedGroup(group);
      } else {
        // Group not in recent updates, try getChat directly
        const chatData = await api.post<any>('/telegram/get-chat', { bot_token: botToken, chat_id: chatId });
        if (chatData.ok && chatData.result) {
          setSavedGroup({
            chat_id: chatData.result.id,
            type: chatData.result.type,
            title: chatData.result.title || chatData.result.username || `Chat ${chatData.result.id}`,
            username: chatData.result.username || null
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch saved group info:', err);
    } finally {
      setIsLoadingSavedGroup(false);
    }
  };

  const handleSaveConfig = (newConfig: TelegramConfig) => {
    setConfig(newConfig);
    saveTelegramConfig(newConfig, newConfig.botToken ? { botToken: newConfig.botToken } : undefined);
    showToast('Telegram bot configuration saved successfully!');
  };

  const handleToggleTrigger = (key: keyof TelegramConfig['triggers']) => {
    const updated: TelegramConfig = {
      ...config,
      triggers: {
        ...config.triggers,
        [key]: !config.triggers[key]
      }
    };
    handleSaveConfig(updated);
  };

  const handleUserMappingChange = (userId: string, field: 'username' | 'chatId' | 'enableDirectDMs', value: any) => {
    const currentMappings = { ...config.userTelegramHandles };
    const current = currentMappings[userId] || { enableDirectDMs: true };

    currentMappings[userId] = {
      ...current,
      [field]: value
    };

    const updated: TelegramConfig = {
      ...config,
      userTelegramHandles: currentMappings
    };
    handleSaveConfig(updated);

    if (field === 'chatId') {
      updateUserTelegramConnection(userId, value, current.username);
      setUsers(getUsers());
    } else if (field === 'username') {
      updateUserTelegramConnection(userId, current.chatId, value);
      setUsers(getUsers());
    }
  };

  const handleSendTestMessage = async () => {
    setIsSendingTest(true);
    try {
      const formattedHtml = formatTelegramHTML({
        eventType: 'TEST_MESSAGE',
        title: 'System Integration Test & Connection Check',
        staffName: currentUser.name,
        department: currentUser.department,
        status: 'Operational',
        notes: testCustomNote.trim() || 'This is a test notification verifying Telegram integration connectivity.',
        details: `Dispatched by ${currentUser.name} (${currentUser.role}) at ${new Date().toLocaleTimeString()}`
      });

      if (!config.isEnabled) {
        addTelegramOutboxLog({
          eventType: 'TEST_MESSAGE',
          targetType: 'direct_dm',
          targetChatId: config.mainGroupChatId || 'Pending Connection',
          targetRecipientName: currentUser.name,
          formattedText: formattedHtml,
          status: 'simulated'
        });
        setOutboxLogs(getTelegramOutbox());
        showToast('Telegram integration is disabled — test formatted & logged in Outbox (Simulation Mode).', 'info');
        return;
      }

      try {
        // No chat_id is sent — the backend resolves the destination: the
        // admin's own linked Telegram chat first, then the configured channel.
        const res: any = await api.post('/telegram/test', { text: formattedHtml });
        const usedChatId = res?.chatId || 'Linked chat';
        const isPrivate = res?.chat?.type === 'private';
        addTelegramOutboxLog({
          eventType: 'TEST_MESSAGE',
          targetType: isPrivate ? 'direct_dm' : 'group',
          targetChatId: usedChatId,
          targetRecipientName: isPrivate ? currentUser.name : (config.channelName || 'Linked group'),
          formattedText: formattedHtml,
          status: 'sent'
        });
        setOutboxLogs(getTelegramOutbox());
        showToast(
          isPrivate
            ? `Test notification delivered to your Telegram chat (${usedChatId})!`
            : `Test notification delivered to Telegram (${config.channelName || usedChatId})!`,
          'success'
        );
      } catch (err: any) {
        const errMsg = err?.message || 'Telegram send failed.';
        addTelegramOutboxLog({
          eventType: 'TEST_MESSAGE',
          targetType: 'direct_dm',
          targetChatId: config.mainGroupChatId || 'Pending Connection',
          targetRecipientName: currentUser.name,
          formattedText: formattedHtml,
          status: 'failed',
          errorMessage: errMsg
        });
        setOutboxLogs(getTelegramOutbox());
        showToast(`Delivery failed: ${errMsg}`, 'error');
      }
    } catch (err: any) {
      showToast(`Error: ${err?.message || 'Unexpected test error'}`, 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleClearLogs = () => {
    if (confirm('Are you sure you want to clear the Telegram outbox message history?')) {
      clearTelegramOutbox();
      setOutboxLogs([]);
      showToast('Telegram outbox logs cleared.', 'info');
    }
  };

  // Group handlers
  const handleLoadGroups = async () => {
    if (!config.botToken.trim()) {
      showToast('Enter bot token first.', 'error');
      return;
    }
    setIsLoadingGroups(true);
    try {
      const data = await api.post<any>('/telegram/groups', {
        bot_token: config.botToken.trim()
      });
      setGroups(data.groups || []);
      if (data.bot?.username) {
        setConfig({ ...config, botUsername: `@${data.bot.username}` });
        showToast(`Token verified — bot ${data.bot.first_name} @${data.bot.username} (ID ${data.bot.id})`, 'success');
      }
      showToast(`Loaded ${data.groups?.length || 0} groups`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to load groups.', 'error');
    } finally {
      setIsLoadingGroups(false);
    }
  };

  const handleSelectGroup = (group: TelegramGroupInfo) => {
    setSelectedGroup(group);
  };

  const handleSaveSelectedGroup = async () => {
    if (!selectedGroup) return;
    try {
      const updatedConfig = { ...config, mainGroupChatId: String(selectedGroup.chat_id) };
      setConfig(updatedConfig);
      saveTelegramConfig(updatedConfig);
      showToast(`Saved "${selectedGroup.title}" as Main Group Chat ID`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to save group.', 'error');
    }
  };

  // Preview data generator
  const getSamplePreviewHtml = (eventType: TelegramOutboxMessage['eventType']) => {
    switch (eventType) {
      case 'DEADLINE_ALERT':
        return formatTelegramHTML({
          eventType: 'DEADLINE_ALERT',
          title: 'Finalize Mid-Year Marketing Campaign Strategy & Budget',
          staffName: 'Ms. SM (Marketing Officer)',
          department: 'Marketing',
          deadline: '2026-08-27',
          status: 'In Progress',
          notes: 'Task deadline is approaching in 3 days. Please finalize deliverable report.',
          details: '⏳ Remaining Time: 3 days left before deadline'
        });
      case 'TR_SUBMIT':
        return formatTelegramHTML({
          eventType: 'TR_SUBMIT',
          title: 'Week 34 T&R Weekly Report (Marketing Officer)',
          staffName: 'Ms. SM',
          department: 'Marketing',
          score: 100,
          status: 'Submitted',
          notes: 'Completed all 10 weekly JD checklist items with digital signature attached.'
        });
      case 'TR_REVIEW':
        return formatTelegramHTML({
          eventType: 'TR_REVIEW',
          title: 'Week 34 T&R Report Evaluated & Approved',
          staffName: 'Ms. SM',
          superiorName: 'Mr. SN (Manager)',
          department: 'Marketing',
          score: 100,
          status: 'Approved',
          notes: 'Excellent performance and thorough weekly checklist execution.'
        });
      case 'TRS_ASSIGN':
        return formatTelegramHTML({
          eventType: 'TRS_ASSIGN',
          title: 'BOP System Core Delivery & Verification',
          staffName: 'Ms. SK',
          superiorName: 'Mr. SN (Manager)',
          department: 'Back Office',
          deadline: '2026-08-29',
          status: 'In Progress',
          notes: 'Verify data synchronization between legacy ledger and new BOP database.'
        });
      case 'TRS_SUBMIT':
        return formatTelegramHTML({
          eventType: 'TRS_SUBMIT',
          title: 'BOP System Core Delivery & Verification',
          staffName: 'Ms. SK',
          superiorName: 'Mr. SN',
          department: 'Back Office',
          deadline: '2026-08-29',
          status: 'Completed',
          score: 100,
          notes: 'Completed verification test cases and attached proof report link.'
        });
      case 'TRS_SCORE':
        return formatTelegramHTML({
          eventType: 'TRS_SCORE',
          title: 'BOP System Core Delivery & Verification',
          staffName: 'Ms. SK',
          superiorName: 'Mr. SN',
          department: 'Back Office',
          score: 100,
          notes: 'Outstanding delivery ahead of deadline. 100% score awarded.'
        });
      case 'TRS_STATUS':
        return formatTelegramHTML({
          eventType: 'TRS_STATUS',
          title: 'BOP System Core Delivery & Verification',
          staffName: 'Ms. SK',
          superiorName: 'Mr. SN',
          department: 'Back Office',
          deadline: '2026-08-29',
          status: 'In Progress',
          score: 60,
          notes: 'Task progress updated to 60% by the assignee.',
          details: 'Task trs_xKmB2rq1t9q progress updated to 60%'
        });
      case 'APPRAISAL_PENDING':
        return formatTelegramHTML({
          eventType: 'APPRAISAL_PENDING',
          title: 'Appraisal appr_7s2hKq3wLc0 (Q2 2026)',
          staffName: 'Ms. SM',
          superiorName: 'Mr. SN (Manager)',
          department: 'Marketing',
          status: 'Pending Executive Approval',
          score: 92,
          notes: 'Appraisal prepared and signed, pending executive approval.',
          details: 'Signed by Mr. SN (manager)'
        });
      case 'APPRAISAL_APPROVED':
        return formatTelegramHTML({
          eventType: 'APPRAISAL_APPROVED',
          title: 'Appraisal appr_7s2hKq3wLc0 (Q2 2026)',
          staffName: 'Ms. SM',
          superiorName: 'Mr. CW (Executive)',
          department: 'Marketing',
          status: 'Fully Approved',
          score: 92,
          notes: 'Appraisal fully approved.',
          details: 'Approved by Mr. CW (executive)'
        });
      default:
        return formatTelegramHTML({
          eventType: 'TEST_MESSAGE',
          title: 'APA System Connection Test',
          staffName: currentUser.name,
          department: currentUser.department,
          status: 'Active'
        });
    }
  };

  const filteredLogs = outboxLogs.filter(l => {
    if (outboxFilter === 'all') return true;
    return l.eventType === outboxFilter;
  });

  const isLiveConnected = config.isEnabled && (config.hasToken || Boolean(config.botToken && config.botToken.trim().length > 15));

  if (currentUser.role !== 'admin') {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-xs space-y-4">
        <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
          <Shield className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">Admin Access Required</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          The Telegram Bot & Alerts configuration console is restricted to system Administrators only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold flex items-center gap-2 transition-all animate-bounce ${
            toastMsg.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : toastMsg.type === 'error'
              ? 'bg-rose-600 text-white border-rose-500'
              : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          {toastMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-xs">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900">Telegram Bot & Notifications Module</h2>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 border ${
                  isLiveConnected
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-blue-100 text-blue-800 border-blue-300'
                }`}>
                  <Radio className={`w-3 h-3 ${isLiveConnected ? 'text-emerald-600 animate-pulse' : 'text-blue-600'}`} />
                  {isLiveConnected ? 'Live Bot Connected' : 'Ready (Simulation & Queue Mode)'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleSendTestMessage}
              disabled={isSendingTest}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-2xs transition-all cursor-pointer w-full sm:w-auto"
            >
              <Send className="w-3.5 h-3.5" />
              {isSendingTest ? 'Dispatching...' : 'Dispatch Test Notification'}
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-2 w-full">
          Auto-broadcast T&R submissions, TRS delegations, deliverable reports &amp; deadline reminders (5–1 days + overdue) straight to your Telegram channel or staff DMs.
        </p>

        {/* Sub Navigation (tablet / desktop) */}
        <div className="hidden md:flex items-center gap-2 mt-6 pt-4 border-t border-slate-100 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('config')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'config' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" /> Bot Settings & Channel Setup
          </button>
          <button
            onClick={() => setActiveTab('triggers')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'triggers' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Notification Triggers ({Object.values(config.triggers).filter(Boolean).length} Active)
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'preview' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> Message Template Preview
          </button>
          <button
            onClick={() => setActiveTab('staff_mapping')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'staff_mapping' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" /> Staff Telegram Directory ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('outbox')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'outbox' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Outbox Activity Log ({outboxLogs.length})
          </button>
        </div>

        {/* Sub Navigation (mobile dropdown) */}
        <div className="md:hidden mt-4 pt-4 border-t border-slate-100">
          <div className="relative">
            <ModernSelect
              value={activeTab}
              onChange={e => setActiveTab(e.target.value as TelegramTab)}
              className="w-full appearance-none pl-3 pr-8 py-2.5 rounded-xl text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="config">Bot Settings & Channel Setup</option>
              <option value="triggers">Notification Triggers ({Object.values(config.triggers).filter(Boolean).length} Active)</option>
              <option value="preview">Message Template Preview</option>
              <option value="staff_mapping">Staff Telegram Directory ({users.length})</option>
              <option value="outbox">Outbox Activity Log ({outboxLogs.length})</option>
            </ModernSelect>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* TAB CONTENT: 1. Bot Settings & Channel Setup */}
      {activeTab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <Bot className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-base text-slate-900">Telegram Bot Credentials</h3>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs font-semibold text-slate-600">Telegram Integration</span>
                  <input
                    type="checkbox"
                    checked={config.isEnabled}
                    onChange={e => handleSaveConfig({ ...config, isEnabled: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Telegram Bot Token
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showToken ? 'text' : 'password'}
                        value={config.botToken}
                        onChange={e => setConfig({ ...config, botToken: e.target.value })}
                        placeholder={config.hasToken ? (showToken ? 'Stored token is hidden. Paste new to replace…' : '••••••••••••••••• (stored). Paste to replace…') : 'e.g. 7123456789:AAFk7e8...'}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none pr-10 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleLoadGroups}
                      disabled={isLoadingGroups || !config.botToken.trim()}
                      className="px-3.5 py-2.5 border border-slate-300 text-slate-700 hover:border-green-400 hover:text-green-700 hover:bg-green-50 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Verify token and fetch groups where bot is admin"
                    >
                      {isLoadingGroups ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                      Get Groups
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Obtain your Bot Token by chatting with <strong>@BotFather</strong> on Telegram and typing <code>/newbot</code>. Paste it above, then click <strong>Get Groups</strong> to verify and fetch groups where bot is admin.
                  </p>
                </div>

                {/* Currently Saved Group Display */}
                {(config.mainGroupChatId || savedGroup) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-blue-600" />
                        <span className="font-bold text-sm text-blue-800">Currently Configured Group</span>
                      </div>
                      <span className="text-[11px] px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-bold">
                        {isLoadingSavedGroup ? 'Loading...' : (savedGroup ? 'Loaded' : 'Chat ID only')}
                      </span>
                    </div>
                    {isLoadingSavedGroup ? (
                      <div className="flex items-center gap-2 text-blue-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Fetching group details...</span>
                      </div>
                    ) : savedGroup ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-white border border-blue-200 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-[11px] font-bold">
                              <MessageSquare className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900">{savedGroup.title}</div>
                              <div className="text-[10px] text-slate-500 font-mono">ID: {savedGroup.chat_id} {savedGroup.username ? `(@${savedGroup.username})` : ''}</div>
                            </div>
                          </div>
                          <span className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-bold">
                            {savedGroup.type}
                          </span>
                        </div>
                        <p className="text-[10px] text-blue-600">This group is used for AI message parsing and notifications.</p>
                      </div>
                    ) : (
                      <div className="p-3 bg-white border border-blue-200 rounded-xl">
                        <div className="text-[10px] text-slate-500 font-mono">Chat ID: {config.mainGroupChatId}</div>
                        <p className="text-[10px] text-blue-600 mt-1">Click "Get Groups" to fetch group details.</p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bot Username
                    <span className="ml-1.5 font-normal text-slate-400">auto-filled by “Get Groups”</span>
                  </label>
                  <input
                    type="text"
                    value={config.botUsername}
                    onChange={e => setConfig({ ...config, botUsername: e.target.value })}
                    placeholder="@Botusername"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Group Selection for AI Message Monitoring */}
                {groups.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="font-bold text-sm text-green-800">Group Selected for AI Monitoring</span>
                      </div>
                      <span className="text-[11px] px-2 py-1 bg-green-100 text-green-700 rounded-full font-bold">
                        {groups.length} group{groups.length !== 1 ? 's' : ''} found
                      </span>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {groups.map((g, idx) => (
                        <button
                          key={g.chat_id}
                          type="button"
                          onClick={() => handleSelectGroup(g)}
                          className={`w-full text-left px-3 py-2 border rounded-xl text-xs transition-all cursor-pointer ${
                            selectedGroup?.chat_id === g.chat_id
                              ? 'border-green-400 bg-green-50 text-green-900 shadow-sm'
                              : 'border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-[10px] font-bold">
                                {idx + 1}
                              </span>
                              <div>
                                <div className="font-semibold text-slate-900">{g.title}</div>
                                <div className="text-[10px] text-slate-500 font-mono">ID: {g.chat_id} {g.username ? `(@${g.username})` : ''}</div>
                              </div>
                            </div>
                            {selectedGroup?.chat_id === g.chat_id && (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1">Type: {g.type}</div>
                        </button>
                      ))}
                    </div>
                    {selectedGroup && (
                      <div className="pt-2 border-t border-green-200">
                        <button
                          type="button"
                          onClick={handleSaveSelectedGroup}
                          className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Save "{selectedGroup.title}" as Main Group Chat ID
                        </button>
                        <p className="text-[10px] text-green-600 mt-1 text-center">
                          This group will be used for AI message parsing and notifications.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSaveConfig(config)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                  >
                    Save Bot Settings
                  </button>
                </div>
              </div>
            </div>

            {/* Test Message Box */}
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 space-y-3">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" /> Test Dispatcher
              </h4>
              <p className="text-xs text-slate-500">
                Send a sample notification to verify message formatting, HTML parsing, and delivery to your configured group or outbox log.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={testCustomNote}
                  onChange={e => setTestCustomNote(e.target.value)}
                  placeholder="Optional custom test note (e.g., Testing Telegram connection for Marketing department)..."
                  className="flex-1 px-3.5 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendTestMessage}
                  disabled={isSendingTest}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shrink-0 shadow-xs cursor-pointer"
                >
                  {isSendingTest ? 'Sending...' : 'Send Test'}
                </button>
              </div>
            </div>
          </div>

          {/* Helper Sidebar */}
          <div className="space-y-6">
            <div className="bg-blue-50/70 border border-blue-200 rounded-3xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-blue-900 font-bold text-sm">
                <HelpCircle className="w-4 h-4 text-blue-600" />
                <span>How to Connect to Telegram</span>
              </div>

              <ol className="text-xs text-blue-950/80 space-y-3 list-decimal list-inside leading-relaxed">
                <li>
                  <strong>Create your Bot:</strong> Open Telegram, search for <code>@BotFather</code>, send <code>/newbot</code>, and follow the prompts to get your API Token.
                </li>
                <li>
                  <strong>Verify Your Token:</strong> Click <strong>Verify Token</strong> to confirm the bot is live before saving. A valid token shows your bot name, username, and ID — the <strong>Bot Username</strong> field is filled in automatically.
                </li>
                <li>
                  <strong>Save:</strong> Paste the Bot Token here, verify it, then click <strong>"Save Bot Settings"</strong>.
                </li>
                <li>
                  <strong>Connect Staff Members:</strong> Each person clicks <strong>"Connect Telegram"</strong> in the top bar and presses Start in your bot. Alerts are then delivered to their own Telegram chat.
                </li>
              </ol>

              <div className="p-3 bg-white/80 border border-blue-200 rounded-xl text-[11px] text-blue-900">
                💡 <strong>Note:</strong> While awaiting Telegram Bot token setup, all notifications automatically queue and format inside the <strong>Outbox Activity Log</strong> so your workflow is ready to go. To broadcast to a shared channel as well, add your bot to that group as an Administrator.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 2. Notification Triggers */}
      {activeTab === 'triggers' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
          <div>
            <h3 className="font-bold text-base text-slate-900">Automated Notification Triggers</h3>
            <p className="text-xs text-slate-500 mt-1">
              Select which events should automatically trigger Telegram broadcast messages to team channels and staff members.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Trigger 1 */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-xs text-slate-900">T&R Weekly Report Submissions</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Notify superiors when a staff member submits and signs their weekly JD checklist.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyTRSubmitted}
                onChange={() => handleToggleTrigger('notifyTRSubmitted')}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 2 */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-xs text-slate-900">T&R Report Reviews & Approvals</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Notify staff when their superior completes weekly report evaluation and approves scores.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyTRReviewed}
                onChange={() => handleToggleTrigger('notifyTRReviewed')}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 3 */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-purple-600" />
                  <span className="font-bold text-xs text-slate-900">New TRS Superior Task Delegation</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Notify assigned staff immediately when a manager or executive delegates a new TRS task.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyTRSAssigned}
                onChange={() => handleToggleTrigger('notifyTRSAssigned')}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 4 */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-amber-600" />
                  <span className="font-bold text-xs text-slate-900">TRS Task Progress & Remarks Updates</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Notify superiors when assigned staff updates task status or logs progress remarks.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyTRSStatusChanged}
                onChange={() => handleToggleTrigger('notifyTRSStatusChanged')}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 5 */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-xs text-slate-900">TRS Deliverable Report Submission</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Notify superiors with submission notes, proof links, and timestamps when staff submits deliverable.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyTRSSubmitted}
                onChange={() => handleToggleTrigger('notifyTRSSubmitted')}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 6 */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span className="font-bold text-xs text-slate-900">TRS Task Evaluation & Score Grading</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Announce evaluation score and feedback once superior reviews and finalizes the task.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyTRSScored}
                onChange={() => handleToggleTrigger('notifyTRSScored')}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 7: DEADLINES (HIGH PRIORITY) */}
            <div className="border-2 border-rose-200 bg-rose-50/40 rounded-2xl p-4 flex items-start justify-between gap-3 md:col-span-2 hover:bg-rose-50/80 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span className="font-bold text-xs text-rose-950">
                    Automated Task Deadline Reminders (5, 4, 3, 2, 1 Days & Overdue)
                  </span>
                  <span className="text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-bold">
                    Crucial
                  </span>
                </div>
                <p className="text-[11px] text-rose-900/80">
                  Automatically alert staff and superior directly whenever any task is within 5 days of its deadline, due today, or past due date.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyDeadlines}
                onChange={() => handleToggleTrigger('notifyDeadlines')}
                className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 8: Appraisal Routed to Executive */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span className="font-bold text-xs text-slate-900">Appraisal Routed for Executive Approval</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Alert executive when a manager prepares and digitally signs an appraisal report.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyAppraisalPending}
                onChange={() => handleToggleTrigger('notifyAppraisalPending')}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mt-1 cursor-pointer"
              />
            </div>

            {/* Trigger 9: Appraisal Officially Approved */}
            <div className="border border-slate-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-xs text-slate-900">Appraisal Officially Approved & E-Signed</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Alert staff member directly when executive finishes reviewing and approves their appraisal.
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.triggers.notifyAppraisalApproved}
                onChange={() => handleToggleTrigger('notifyAppraisalApproved')}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 mt-1 cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 3. Template Preview */}
      {activeTab === 'preview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="font-bold text-base text-slate-900">Select Notification Type</h3>
            <p className="text-xs text-slate-500">
              Inspect how each automated notification will render in Telegram.
            </p>

            <div className="space-y-1.5">
              {[
                { id: 'TR_SUBMIT', label: '📋 T&R Weekly Report Submitted', icon: FileText },
                { id: 'TR_REVIEW', label: '✅ T&R Report Reviewed & Approved', icon: CheckCircle2 },
                { id: 'TRS_ASSIGN', label: '📌 New TRS Task Delegation', icon: ListTodo },
                { id: 'TRS_STATUS', label: '🔄 TRS Task Status Updated', icon: RefreshCw },
                { id: 'TRS_SUBMIT', label: '🚀 TRS Deliverable Report Submitted', icon: Send },
                { id: 'TRS_SCORE', label: '⭐ TRS Task Evaluation & Score', icon: Sparkles },
                { id: 'DEADLINE_ALERT', label: '⚠️ Task Deadline Reminder', icon: Clock },
                { id: 'APPRAISAL_PENDING', label: '✍️ Staff Appraisal Routed', icon: Users },
                { id: 'APPRAISAL_APPROVED', label: '🏆 Staff Appraisal Approved', icon: CheckCircle2 }
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedPreviewEvent(item.id as any)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                    selectedPreviewEvent === item.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {/* Telegram Bubble Simulator */}
            <div className="bg-[#54759e] rounded-3xl p-6 sm:p-8 shadow-md">
              <div className="max-w-md mx-auto">
                <div className="text-center mb-3">
                  <span className="text-[10px] bg-black/20 text-white/90 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                    Telegram Message Bubble Simulator
                  </span>
                </div>

                <div className="bg-white rounded-2xl p-4 shadow-xl text-slate-900 space-y-2 border border-slate-100">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <div className="w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xs">
                      APA
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-900 leading-tight">
                        {config.botUsername}
                      </div>
                      <div className="text-[10px] text-slate-400">bot</div>
                    </div>
                  </div>

                  <div
                    className="text-xs leading-relaxed font-sans whitespace-pre-wrap text-slate-800"
                    dangerouslySetInnerHTML={{ __html: getSamplePreviewHtml(selectedPreviewEvent) }}
                  />

                  {/* Simulated Telegram Inline URL Action Button */}
                  <div className="pt-2">
                    <div className="w-full bg-[#f0f4f8] hover:bg-[#e4ebf3] text-[#2481cc] font-semibold text-center py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 border border-[#d6e2ef] shadow-2xs transition-colors">
                      <span>{getTelegramButtonText(selectedPreviewEvent)}</span>
                      <ExternalLink className="w-3 h-3 text-[#2481cc]/70" />
                    </div>
                  </div>

                  <div className="pt-1 flex justify-end">
                    <span className="text-[10px] text-slate-400">
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 4. Staff Telegram Directory */}
      {activeTab === 'staff_mapping' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-base text-slate-900">Staff Telegram Directory & Chat ID Mapping</h3>
              <p className="text-xs text-slate-500">
                Map each staff member to their Telegram account for personal deadline reminders and direct task notifications.
              </p>
            </div>
            <span className="text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-xl font-bold">
              {users.length} Registered Staff
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                  <th className="py-2.5 px-3">Staff Member</th>
                  <th className="py-2.5 px-3">Role & Dept</th>
                  <th className="py-2.5 px-3">Telegram Username</th>
                  <th className="py-2.5 px-3">Direct Chat ID</th>
                  <th className="py-2.5 px-3 text-center">Direct DM Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(u => {
                  const mapping = config.userTelegramHandles[u.id] || { username: '', chatId: '', enableDirectDMs: true };
                  const effectiveChatId = u.telegramChatId || mapping.chatId || '';
                  const effectiveUsername = u.telegramUsername || mapping.username || '';
                  const isUserConnected = !!u.telegramChatId || !!mapping.chatId;

if (configLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center max-w-lg mx-auto shadow-xs space-y-4">
        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <h3 className="text-lg font-bold text-slate-900">Loading Telegram Configuration</h3>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Fetching bot settings and notification triggers from the database…
        </p>
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-slate-200 rounded-full mx-auto max-w-xs" />
          <div className="h-3 bg-slate-100 rounded-full mx-auto max-w-[14rem]" />
          <div className="h-3 bg-slate-200 rounded-full mx-auto max-w-[10rem]" />
        </div>
      </div>
    );
  }

  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{u.name}</span>
                          {isUserConnected ? (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded-md">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Connected
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Not linked</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">{u.email}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-700">{u.position}</span>
                        <div className="text-[10px] text-blue-600 font-bold capitalize">{u.department}</div>
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="text"
                          value={effectiveUsername}
                          onChange={e => handleUserMappingChange(u.id, 'username', e.target.value)}
                          placeholder="@username"
                          className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-blue-500 w-36"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <input
                          type="text"
                          value={effectiveChatId}
                          onChange={e => handleUserMappingChange(u.id, 'chatId', e.target.value)}
                          placeholder="e.g. 112233445"
                          className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-blue-500 font-mono w-32"
                        />
                      </td>
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={mapping.enableDirectDMs}
                          onChange={e => handleUserMappingChange(u.id, 'enableDirectDMs', e.target.checked)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 5. Outbox Activity Log */}
      {activeTab === 'outbox' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-base text-slate-900">Telegram Outbox & Message History</h3>
              <p className="text-xs text-slate-500">
                Auditable log of all messages dispatched, queued, or simulated by the APA reporting engine.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ModernSelect
                value={outboxFilter}
                onChange={e => setOutboxFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 bg-slate-50"
              >
                <option value="all">All Events ({outboxLogs.length})</option>
                <option value="DEADLINE_ALERT">Deadline Alerts</option>
                <option value="TRS_ASSIGN">TRS Delegations</option>
                <option value="TRS_SUBMIT">TRS Deliverables</option>
                <option value="TRS_STATUS">TRS Status</option>
                <option value="TR_SUBMIT">T&R Submissions</option>
                <option value="TR_REVIEW">T&R Reviews</option>
                <option value="APPRAISAL_PENDING">Appraisal Pending Approval</option>
                <option value="APPRAISAL_APPROVED">Appraisal Approved</option>
                <option value="TEST_MESSAGE">Test Messages</option>
              </ModernSelect>
              {outboxLogs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors"
                  title="Clear history"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              No Telegram outbox messages found for this filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map(log => (
                <div
                  key={log.id}
                  className="border border-slate-200 rounded-2xl p-4 hover:shadow-xs transition-all bg-slate-50/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2 mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-extrabold uppercase ${
                        log.eventType === 'DEADLINE_ALERT' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                        log.eventType === 'TRS_ASSIGN' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                        log.eventType === 'TRS_SUBMIT' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                        log.eventType === 'TR_SUBMIT' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                        'bg-slate-200 text-slate-800'
                      }`}>
                        {log.eventType}
                      </span>
                      <span className="text-xs font-bold text-slate-800">
                        To: {log.targetRecipientName} <code className="text-[10px] text-slate-500 font-mono">({log.targetChatId})</code>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                        log.status === 'sent' ? 'bg-emerald-600 text-white' :
                        log.status === 'simulated' ? 'bg-blue-600 text-white' :
                        'bg-rose-600 text-white'
                      }`}>
                        {log.status === 'sent' ? '✓ Sent Live' : log.status === 'simulated' ? 'Simulated Outbox' : 'Failed'}
                      </span>
                      <span className="text-slate-400">
                        {new Date(log.timestamp).toLocaleTimeString()} • {new Date(log.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div
                    className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-200/60 whitespace-pre-wrap font-sans leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: log.formattedText }}
                  />

                  {log.errorMessage && (
                    <div className="mt-2 text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
                      Error: {log.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
