import React, { useState, useEffect } from 'react';
import { User, NotificationItem, hasUserPermission } from '../types';
import {
  getNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  clearNotificationsForUser,
  getUnreadNoticeCount
} from '../services/storage';
import { checkAndDispatchDeadlineNotifications } from '../services/deadlineAlertService';
import { formatCambodiaClock } from '../utils/dateUtils';
import {
  CheckSquare,
  ListTodo,
  TrendingUp,
  ShieldAlert,
  UserCheck,
  Building,
  Bell,
  CheckCircle2,
  Clock,
  X,
  FileText,
  UserPlus,
  LogOut,
  LogIn,
  AlertTriangle,
  Bot,
  Megaphone,
  FolderOpen
} from 'lucide-react';
import { TelegramConnectModal } from './TelegramConnectModal';
import { PolicyModal } from './PolicyModal';

interface NavbarProps {
  activeTab: 'tr' | 'trs' | 'evaluation' | 'admin' | 'telegram' | 'notices' | 'files';
  setActiveTab: (tab: 'tr' | 'trs' | 'evaluation' | 'admin' | 'telegram' | 'notices' | 'files') => void;
  currentUser: User | null;
  onOpenAuthModal: () => void;
  onLogout: () => void;
  onUserUpdated?: (user: User) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onOpenAuthModal,
  onLogout,
  onUserUpdated
}) => {
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotices, setUnreadNotices] = useState(0);

  const loadNotifications = () => {
    if (!currentUser) {
      setNotifications([]);
      return;
    }
    const list = getNotificationsForUser(currentUser);
    setNotifications(list);
  };

  const loadNoticesBadge = () => {
    if (!currentUser) {
      setUnreadNotices(0);
      return;
    }
    setUnreadNotices(getUnreadNoticeCount(currentUser));
  };

  useEffect(() => {
    if (currentUser) {
      // Check and dispatch deadline alerts once per session/user login
      checkAndDispatchDeadlineNotifications(currentUser);
      loadNotifications();
      loadNoticesBadge();
    } else {
      setNotifications([]);
      setUnreadNotices(0);
    }
    // Poll solely for reading state updates (e.g. unread badge count)
    const interval = setInterval(() => {
      loadNotifications();
      loadNoticesBadge();
    }, 10000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!isNotifOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsNotifOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNotifOpen]);

  const handleNotificationClick = (notif: NotificationItem) => {
    markNotificationAsRead(notif.id);
    loadNotifications();
    if (notif.linkTab) {
      setActiveTab(notif.linkTab);
    }
    setIsNotifOpen(false);
  };

  const handleMarkAllRead = () => {
    if (!currentUser) return;
    markAllNotificationsAsRead(currentUser.id);
    loadNotifications();
  };

  const handleClearNotifications = () => {
    if (!currentUser) return;
    clearNotificationsForUser(currentUser.id);
    loadNotifications();
  };

  if (!currentUser) return null;
  return (
    <header className="bg-white border-b border-slate-200 text-slate-800 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 z-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* System Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs font-bold text-[18px] tracking-wider">
              XS
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg tracking-tight text-slate-900">
                
                Staff Report
              </h1>
            </div>
          </div>

          {/* Controls: Notification Bell, Profile & Actions - All in one responsive row */}
          {currentUser && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
              {/* Primary Actions Row - All buttons in one row, wraps on mobile */}
              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                {/* Scoring & Submission Policy Handbook Button */}
                <button
                  onClick={() => setIsPolicyOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-800 text-xs font-bold transition-all cursor-pointer shadow-2xs min-h-[40px] touch-manipulation"
                  title="View Official APA Scoring, Timeliness Deduction, and Auto-Lock Policy"
                >
                  <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="hidden sm:inline">Scoring Policy</span>
                  <span className="sm:hidden">Policy</span>
                </button>

                {/* Personal Telegram Direct Alert Button */}
                <button
                  onClick={() => setIsTelegramModalOpen(true)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-2xs min-h-[40px] touch-manipulation ${
                    currentUser.telegramChatId
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                      : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                  }`}
                  title={
                    currentUser.telegramChatId
                      ? `Personal Telegram Connected (Chat ID: ${currentUser.telegramChatId}). Click to test or manage.`
                      : 'Connect your personal Telegram for private task and report alerts'
                  }
                >
                  {currentUser.telegramChatId ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      <Bot className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="hidden sm:inline">TG Alert On</span>
                    </>
                  ) : (
                    <>
                      <Bot className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="hidden sm:inline">Connect Telegram</span>
                      <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    </>
                  )}
                </button>

                {/* Notification Bell - now in same row */}
                <div className="relative">
                  <button
                    onClick={() => {
                      loadNotifications();
                      setIsNotifOpen(!isNotifOpen);
                    }}
                    className="relative p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition-all min-h-[40px] min-w-[40px] touch-manipulation flex items-center justify-center"
                    title="Team Activity & Submissions Notifications"
                    aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
                  >
                    <Bell className="w-5 h-5 text-slate-600" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-pulse shadow-xs">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Notifications Flyout Panel */}
                  {isNotifOpen && (
                    <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsNotifOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="fixed sm:absolute top-14 left-2 right-2 sm:top-auto sm:left-auto sm:right-0 sm:mt-2 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                      <div className="p-3.5 bg-slate-900 text-white flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Bell className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="font-bold text-xs sm:text-sm truncate">Team Notifications</span>
                          {unreadCount > 0 && (
                            <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] rounded-full font-bold shrink-0">
                              {unreadCount} Unread
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {notifications.length > 0 && (
                            <button
                              onClick={handleClearNotifications}
                              className="text-[10px] font-semibold text-rose-300 hover:text-white underline"
                            >
                              Clear
                            </button>
                          )}
                          {unreadCount > 0 && (
                            <button
                              onClick={handleMarkAllRead}
                              className="text-[10px] font-semibold text-blue-300 hover:text-white underline"
                            >
                              Mark all as read
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setIsNotifOpen(false)}
                            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Close (Esc)"
                            aria-label="Close notifications"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                        {notifications.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-400 italic">
                            No team notifications yet.
                          </div>
                        ) : (
                          notifications.map(n => (
                            <div
                              key={n.id}
                              onClick={() => handleNotificationClick(n)}
                              className={`p-3 transition-all cursor-pointer hover:bg-blue-50/50 flex items-start gap-3 ${
                                !n.read ? 'bg-blue-50/30' : 'bg-white'
                              }`}
                            >
                              <div className={`mt-0.5 p-1.5 rounded-lg text-white ${
                                n.type === 'DEADLINE_ALERT' ? 'bg-rose-600' :
                                n.type === 'REPORT_SUBMITTED' ? 'bg-blue-600' :
                                n.type === 'REPORT_REVIEWED' ? 'bg-emerald-600' :
                                n.type === 'TASK_ASSIGNED' ? 'bg-purple-600' : 'bg-amber-600'
                              }`}>
                                {n.type === 'DEADLINE_ALERT' ? <AlertTriangle className="w-3.5 h-3.5" /> :
                                 n.type === 'REPORT_SUBMITTED' ? <FileText className="w-3.5 h-3.5" /> :
                                 n.type === 'REPORT_REVIEWED' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                                 <UserPlus className="w-3.5 h-3.5" />}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className={`text-xs font-bold ${!n.read ? 'text-slate-900' : 'text-slate-700'}`}>
                                    {n.title}
                                  </span>
                                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                    <Clock className="w-3 h-3" />
                                    {formatCambodiaClock(n.timestamp)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                                  {n.message}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="p-2 bg-slate-50 border-t border-slate-100 text-center">
                        <span className="text-[10px] text-slate-400">
                          Notifications keep team members & superiors updated automatically
                        </span>
                      </div>
                    </div>
                    </>
                  )}
                </div>

                {/* Spacer - pushes profile to right on desktop */}
                <div className="hidden sm:flex-1" />
              </div>

              {/* User Profile & Logout - right side on desktop, stacked below on mobile */}
              <div className="flex items-center gap-2 w-full sm:w-auto flex-col sm:flex-row sm:items-center gap-2 sm:ml-4">
                <div className="h-6 w-px bg-slate-200 shrink-0 hidden sm:block sm:h-8" />

                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1.5 pl-3 shadow-2xs gap-2 w-full sm:w-auto">
                  <button
                    onClick={onOpenAuthModal}
                    className="text-left group flex items-center gap-2 flex-1 min-w-0 min-h-[40px] touch-manipulation"
                    title="View Account Profile"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors truncate">
                        {currentUser.name}
                      </div>
                      <div className="text-[10px] text-blue-600 font-semibold capitalize truncate">
                        {currentUser.role} • {currentUser.department}
                      </div>
                    </div>
                  </button>

                  <div className="h-6 w-px bg-slate-200 shrink-0 hidden sm:block" />

                  <button
                    onClick={onLogout}
                    title="Log Out of System"
                    className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 min-h-[40px] touch-manipulation"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline text-[11px]">Log Out</span>
                    <span className="sm:hidden" aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        {currentUser && (
          <nav className="hidden md:flex items-center gap-1 sm:gap-2 mt-3 overflow-x-auto thin-scrollbar pt-1 border-t border-slate-100">
            {hasUserPermission(currentUser, 'submitTRReport') && (
              <button
                onClick={() => setActiveTab('tr')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === 'tr'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <CheckSquare className="w-4 h-4" /> T&R Reports (JD Checklist)
              </button>
            )}

            {
              <button
                onClick={() => setActiveTab('trs')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === 'trs'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ListTodo className="w-4 h-4" /> TRS Reports (Superior Requested)
              </button>
            }

            <button
              onClick={() => setActiveTab('evaluation')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === 'evaluation'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-4 h-4" /> Performance Evaluation
            </button>

            <button
              onClick={() => setActiveTab('notices')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === 'notices'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Megaphone className="w-4 h-4" /> Notices
              {unreadNotices > 0 && (
                <span className={`ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center shadow-xs ${
                  activeTab === 'notices' ? 'bg-white text-blue-700' : 'bg-rose-600 text-white'
                }`}>
                  {unreadNotices > 9 ? '9+' : unreadNotices}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('files')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === 'files'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <FolderOpen className="w-4 h-4" /> File Manager
            </button>

            {currentUser.role === 'admin' && (
              <button
                onClick={() => setActiveTab('telegram')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === 'telegram'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Bot className="w-4 h-4" /> Telegram Bot & Alerts
              </button>
            )}

            {currentUser.role === 'admin' && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === 'admin'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <ShieldAlert className="w-4 h-4" /> Admin Console & Activity Log
              </button>
            )}
          </nav>
        )}
      </div>

      {/* Mobile Bottom Tab Bar */}
      {currentUser && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-stretch max-w-lg mx-auto">
            {hasUserPermission(currentUser, 'submitTRReport') && (
              <button
                onClick={() => setActiveTab('tr')}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                  activeTab === 'tr' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <CheckSquare className="w-5 h-5 shrink-0" />
                <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">T&R</span>
              </button>
            )}

            {
              <button
                onClick={() => setActiveTab('trs')}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                  activeTab === 'trs' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <ListTodo className="w-5 h-5 shrink-0" />
                <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">TRS</span>
              </button>
            }

            <button
              onClick={() => setActiveTab('evaluation')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                activeTab === 'evaluation' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <TrendingUp className="w-5 h-5 shrink-0" />
              <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">Evaluation</span>
            </button>

            <button
              onClick={() => setActiveTab('notices')}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                activeTab === 'notices' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Megaphone className="w-5 h-5 shrink-0" />
              <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">Notices</span>
              {unreadNotices > 0 && (
                <span className="absolute top-1 right-[18%] min-w-[16px] h-4 px-1 bg-rose-600 text-white rounded-full text-[9px] font-bold flex items-center justify-center shadow-xs">
                  {unreadNotices > 9 ? '9+' : unreadNotices}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('files')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                activeTab === 'files' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FolderOpen className="w-5 h-5 shrink-0" />
              <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">Files</span>
            </button>

            {currentUser.role === 'admin' && (
              <button
                onClick={() => setActiveTab('telegram')}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                  activeTab === 'telegram' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Bot className="w-5 h-5 shrink-0" />
                <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">Bot</span>
              </button>
            )}

            {currentUser.role === 'admin' && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-w-0 transition-colors ${
                  activeTab === 'admin' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span className="text-[9px] font-bold leading-none tracking-tight truncate max-w-full">Admin</span>
              </button>
            )}
          </div>
        </nav>
      )}

      {currentUser && (
        <>
          <TelegramConnectModal
            currentUser={currentUser}
            isOpen={isTelegramModalOpen}
            onClose={() => setIsTelegramModalOpen(false)}
            onConnectionUpdated={(updated) => {
              onUserUpdated?.(updated);
            }}
          />
          <PolicyModal
            isOpen={isPolicyOpen}
            onClose={() => setIsPolicyOpen(false)}
            defaultTab={activeTab === 'trs' ? 'trs' : 'tr'}
          />
        </>
      )}
    </header>
  );
};

