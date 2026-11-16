/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useTransition } from 'react';
import { User, hasUserPermission } from './types';
import { getCurrentUser, initStorage, logoutUser, subscribeHydration } from './services/storage';
import type { HydrateStatus } from './services/storage';
import { getStaffDeadlineAlerts, TaskDeadlineAlert } from './services/deadlineAlertService';
import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { TRReportView } from './components/TRReportView';
import { TRSReportView } from './components/TRSReportView';
import { PerformanceEvaluation } from './components/PerformanceEvaluation';
import { AdminConsole } from './components/AdminConsole';
import { TelegramIntegrationView } from './components/TelegramIntegrationView';
import { TelegramConnectModal } from './components/TelegramConnectModal';
import { TelegramWarningBanner } from './components/TelegramWarningBanner';
import { OnboardingWidget } from './components/OnboardingWidget';
import { NoticeBoardView } from './components/NoticeBoardView';
import { DeadlineBanner } from './components/DeadlineBanner';
import { FileManagerView } from './components/FileManagerView';
import { LogOut, LogIn, ShieldAlert } from 'lucide-react';

import { LoginForm } from './components/LoginForm';
import { LoadingScreen } from './components/LoadingScreen';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { GlobalDialog, confirmDialog, showDialog } from './components/GlobalDialog';
import { SSOCallback } from './components/SSOCallback';
import { getSession } from './services/api';

// Keep heavy tab views mounted after first visit so returning to a tab is instant.
// React.memo ensures hidden views skip re-rendering when App re-renders (e.g. the 10s deadline poll).
const TRView = React.memo(TRReportView);
const TRSView = React.memo(TRSReportView);
const EvalView = React.memo(PerformanceEvaluation);
const NoticeView = React.memo(NoticeBoardView);
const TelegramView = React.memo(TelegramIntegrationView);
const AdminView = React.memo(AdminConsole);
const FileManagerViewMemo = React.memo(FileManagerView);

type TrFormRoute = { mode: 'new' | 'edit'; id?: string } | null;

function parseTrFormRoute(): TrFormRoute {
  const h = window.location.hash;
  const mNew = h.match(/^#\/tr\/new$/i);
  const mEdit = h.match(/^#\/tr\/edit\/([^/]+)$/i);
  if (mNew) return { mode: 'new' };
  if (mEdit) return { mode: 'edit', id: decodeURIComponent(mEdit[1]) };
  return null;
}

function useTrFormRoute(): TrFormRoute {
  const [route, setRoute] = useState<TrFormRoute>(() => parseTrFormRoute());
  useEffect(() => {
    const onHash = () => setRoute(parseTrFormRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

type AppTab = 'tr' | 'trs' | 'evaluation' | 'admin' | 'telegram' | 'notices' | 'files';
const APP_TABS: AppTab[] = ['tr', 'trs', 'evaluation', 'notices', 'files', 'admin', 'telegram'];
const ACTIVE_TAB_KEY = 'apa_active_tab';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTabRaw] = useState<AppTab>(() => {
    try {
      const saved = window.localStorage.getItem(ACTIVE_TAB_KEY);
      if (saved && (APP_TABS as string[]).includes(saved)) return saved as AppTab;
    } catch { /* ignore */ }
    return 'tr';
  });
  const setActiveTab = (tab: AppTab) => {
    setActiveTabRaw(tab);
    try { window.localStorage.setItem(ACTIVE_TAB_KEY, tab); } catch { /* ignore */ }
  };
  const [isPending, startTransition] = useTransition();
  const [visitedTabs, setVisitedTabs] = useState<Set<AppTab>>(() => new Set([activeTab]));
  const goToTab = (tab: AppTab) => {
    startTransition(() => {
      setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
      setActiveTab(tab);
    });
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: AppTab } | undefined;
      if (detail?.tab && (APP_TABS as string[]).includes(detail.tab)) {
        goToTab(detail.tab);
      }
    };
    window.addEventListener('apa:navigate-tab', handler as EventListener);
    return () => window.removeEventListener('apa:navigate-tab', handler as EventListener);
  }, []);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [telegramModalOpen, setTelegramModalOpen] = useState<boolean>(false);
  const [deadlineAlerts, setDeadlineAlerts] = useState<TaskDeadlineAlert[]>([]);
  const [isBooted, setIsBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hydrateStatus, setHydrateStatus] = useState<HydrateStatus>('idle');
  // True once the first full data hydration completes. Views stay unmounted
  // until this flips so they never mount against an empty cache (login flow
  // renders the app shell immediately; content appears when the sync lands).
  const [viewsEligible, setViewsEligible] = useState(false);
  const trFormRoute = useTrFormRoute();

  // Handle SSO callback: /sso/callback?token=xxx&returnTo=xxx
  if (window.location.pathname === '/sso/callback') {
    return <SSOCallback />;
  }

  const refreshDeadlineAlerts = () => {
    if (currentUser) {
      const alerts = getStaffDeadlineAlerts(currentUser);
      setDeadlineAlerts(alerts);
    } else {
      setDeadlineAlerts([]);
    }
  };

  useEffect(() => {
    return subscribeHydration((status) => setHydrateStatus(status));
  }, []);

  useEffect(() => {
    if (hydrateStatus === 'ready') setViewsEligible(true);
  }, [hydrateStatus]);

  // Pre-warm the heavy Evaluation view during idle (once data is ready and
  // the user has access) so its first open just unhides the already-mounted
  // hidden instance instead of paying a costly first render.
  useEffect(() => {
    if (!currentUser || !viewsEligible) return;
    if (!canAccessTab(currentUser, 'evaluation')) return;
    const w = window as any;
    let handle: any = null;
    const warm = () => {
      setVisitedTabs((prev) => (prev.has('evaluation') ? prev : new Set(prev).add('evaluation')));
    };
    handle = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 4000 }) : w.setTimeout(warm, 2000);
    return () => {
      if (w.requestIdleCallback && handle) w.cancelIdleCallback(handle);
      else if (handle) w.clearTimeout(handle);
    };
  }, [currentUser, viewsEligible]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initStorage();
        if (!mounted) return;
        setIsBooted(true);
        setBootError(null);
        const user = getCurrentUser();
        setCurrentUser(user);
        if (user) {
          const alerts = getStaffDeadlineAlerts(user);
          setDeadlineAlerts(alerts);
        }
      } catch (err: any) {
        if (mounted) setBootError(err?.message || 'Unable to reach the backend on port 5812.');
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    refreshDeadlineAlerts();
    const interval = setInterval(refreshDeadlineAlerts, 10000);
    return () => clearInterval(interval);
  }, [currentUser, activeTab]);

  // Repair malformed entry URLs such as "/%20updated%20b.#/tr". The hash route
  // still works, but a non-root pathname can confuse relative requests/reloads.
  useEffect(() => {
    const path = window.location.pathname;
    if (path && path !== '/' && path !== '/sso/callback') {
      const hash = window.location.hash.startsWith('#/') ? window.location.hash : '#/';
      window.history.replaceState(null, '', `/${hash}`);
    }
  }, []);

  // The API layer emits this once when a request still returns 401 after its
  // single silent-refresh retry. Show a non-dismissible dialog; OK reloads so
  // the app boots into the login screen with clean cookies.
  useEffect(() => {
    const onUnauthorized = () => {
      setAuthModalOpen(false);
      showDialog(
        'Your session has expired due to inactivity. Please sign in again to continue.',
        {
          title: 'Session Expired',
          kind: 'warning',
          dismissible: false,
          onConfirm: () => window.location.reload()
        }
      );
    };
    window.addEventListener('apa:unauthorized', onUnauthorized);
    return () => window.removeEventListener('apa:unauthorized', onUnauthorized);
  }, []);

  // Sliding 24h idle session: while the user is active, ping /auth/session at
  // most every 5 minutes so the backend extends expires_at and the cookie.
  useEffect(() => {
    if (!currentUser) return;
    const HEARTBEAT_MS = 5 * 60 * 1000;
    let lastActivity = Date.now();
    let lastPing = Date.now();
    const markActivity = () => { lastActivity = Date.now(); };
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    events.forEach((name) => window.addEventListener(name, markActivity, { passive: true }));
    const interval = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') return;
      if (now - lastActivity > HEARTBEAT_MS) return;
      if (now - lastPing < HEARTBEAT_MS) return;
      lastPing = now;
      getSession()
        .then((session) => {
          // /auth/session answers 200 with a null user when the refresh session
          // is gone, so detect that here instead of waiting for the next 401.
          if (!(session as { user?: unknown } | null)?.user) {
            window.dispatchEvent(new CustomEvent('apa:unauthorized'));
          }
        })
        .catch(() => { /* network error: keep the session */ });
    }, 60 * 1000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, markActivity));
      clearInterval(interval);
    };
  }, [currentUser]);

  const handleUserSwitch = (newUser: User) => {
    const wasLoggedOut = !currentUser;
    if (window.location.hash) window.location.hash = '';
    setCurrentUser(newUser);
    // Entering from the login screen: the background reload is still running,
    // so keep tab views unmounted until the first sync reports ready.
    if (wasLoggedOut) setViewsEligible(false);
    const alerts = getStaffDeadlineAlerts(newUser);
    setDeadlineAlerts(alerts);
    // If new user lacks permission for current tab, redirect to first accessible tab
    if (!canAccessTab(newUser, activeTab)) {
      const fallback = APP_TABS.find((t) => canAccessTab(newUser, t)) || 'tr';
      goToTab(fallback);
    }
    setAuthModalOpen(false);
  };

  // Permission-based tab access check
  const canAccessTab = (user: User, tab: AppTab): boolean => {
    switch (tab) {
      case 'tr':
        return hasUserPermission(user, 'submitTRReport');
      case 'trs':
        return true; // open to all staff — creating, delegating, executing and submitting TRS tasks has no feature flag
      case 'evaluation':
        return true; // open to all staff — read access is self-scoped server-side
      case 'telegram':
        return user.role === 'admin'; // or hasUserPermission(user, 'manageTemplates')
      case 'notices':
        return true; // all authenticated users can view notices
      case 'files':
        return true; // all authenticated users can see their own and subordinate files
      case 'admin':
        return hasUserPermission(user, 'manageUsers') || hasUserPermission(user, 'manageTemplates') || hasUserPermission(user, 'viewAuditLogs');
      default:
        return false;
    }
  };

  const handleLogout = async () => {
    const confirmed = await confirmDialog(
      'Are you sure you want to sign out of your APA Staff Report session?',
      { title: 'Sign Out', confirmText: 'Yes, Sign Out' }
    );
    if (!confirmed) return;
    logoutUser();
    setCurrentUser(null);
    setDeadlineAlerts([]);
    try { window.localStorage.removeItem(ACTIVE_TAB_KEY); } catch { /* ignore */ }
    if (window.location.hash) window.location.hash = '';
  };

  const handleNavigateFromDeadline = (alert: TaskDeadlineAlert) => {
    goToTab(alert.linkTab);
  };

  // Gate rendering until session/data hydration from the backend completes
  if (!isBooted) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        {bootError ? (
          <div className="text-center p-8 max-w-md">
            <div className="text-2xl mb-3">⚠️</div>
            <div className="font-semibold text-slate-800 mb-1">Backend connection failed</div>
            <p className="text-sm text-slate-500">{bootError}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <LoadingScreen label="Loading APA Staff Portal…" />
        )}
      </div>
    );
  }

  // If user is not authenticated, render the dedicated full-screen Portal Login
  if (!currentUser) {
    return <LoginForm onLoginSuccess={handleUserSwitch} />;
  }

  // Forced password change (first login / after admin reset) — gate the entire app
  if (currentUser.mustChangePassword) {
    return (
      <>
        <ForcePasswordChange currentUser={currentUser} onComplete={setCurrentUser} />
        {/* Same early-return caveat as the #/tr/new branch: this screen's sign-out
            confirm needs a mounted dialog host to resolve its await. */}
        <GlobalDialog />
      </>
    );
  }

  // Dedicated full-page "New / Edit Weekly T&R Report Submission" route (#/tr/new, #/tr/edit/:id)
  if (trFormRoute) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 font-sans">
        <TRReportView
          currentUser={currentUser}
          pageMode={trFormRoute.mode}
          initialEditId={trFormRoute.id}
          onExit={() => { window.location.hash = '#/tr'; }}
        />
        {/* This branch returns before the main shell, so it needs its own dialog host.
            Without it, every confirmDialog()/showDialog() call raised by this page
            (Discard Auto-save, reload from template, submit validation) would set the
            external store but never render, leaving the caller's await pending forever. */}
        <GlobalDialog />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
      {hydrateStatus === 'loading' && !viewsEligible && (
        <>
          <div className="fixed top-0 inset-x-0 z-[70] h-6 bg-white/95 backdrop-blur border-b border-slate-200 text-[11px] font-medium text-slate-500 px-4 flex items-center justify-center gap-2 shadow-sm">
            <span className="inline-block w-2.5 h-2.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            Syncing data with secure backend…
          </div>
          <div className="h-6 shrink-0" aria-hidden="true" />
        </>
      )}
      <Navbar
        activeTab={activeTab}
        setActiveTab={goToTab}
        currentUser={currentUser}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        onUserUpdated={(updated) => setCurrentUser(updated)}
      />

      {viewsEligible ? (
      <main className="flex-1 w-full mx-auto px-[5px] sm:max-w-7xl sm:px-6 py-4 sm:py-6">
        {/* Staff Quick-Start Onboarding Checklist */}
        {/* {currentUser?.role !== 'admin' && (
          <OnboardingWidget
            currentUser={currentUser}
            onOpenTelegramModal={() => setTelegramModalOpen(true)}
            onNavigateToTab={(tab) => goToTab(tab as AppTab)}
          />
        )} */}

        {/* Telegram connection warning banner */}
        {/* <TelegramWarningBanner
          currentUser={currentUser}
          onOpenConnectModal={() => setTelegramModalOpen(true)}
        /> */}

        {/* Global Deadline Alert Reminder Banner for Staff */}
        <DeadlineBanner
          alerts={deadlineAlerts}
          onNavigateToTask={handleNavigateFromDeadline}
        />

        {visitedTabs.has('tr') && canAccessTab(currentUser!, 'tr') && (
          <div className={activeTab === 'tr' ? '' : 'hidden'}>
            <TRView currentUser={currentUser} isActive={activeTab === 'tr'} />
          </div>
        )}
        {visitedTabs.has('trs') && canAccessTab(currentUser!, 'trs') && (
          <div className={activeTab === 'trs' ? '' : 'hidden'}><TRSView currentUser={currentUser} /></div>
        )}
        {visitedTabs.has('evaluation') && canAccessTab(currentUser!, 'evaluation') && (
          <div className={activeTab === 'evaluation' ? '' : 'hidden'}><EvalView currentUser={currentUser} /></div>
        )}
        {visitedTabs.has('notices') && canAccessTab(currentUser!, 'notices') && (
          <div className={activeTab === 'notices' ? '' : 'hidden'}><NoticeView currentUser={currentUser} /></div>
        )}
        {visitedTabs.has('files') && canAccessTab(currentUser!, 'files') && (
          <div className={activeTab === 'files' ? '' : 'hidden'}><FileManagerViewMemo currentUser={currentUser} /></div>
        )}
        {visitedTabs.has('telegram') && currentUser && canAccessTab(currentUser, 'telegram') && (
          <div className={activeTab === 'telegram' ? '' : 'hidden'}><TelegramView currentUser={currentUser} /></div>
        )}
        {visitedTabs.has('admin') && currentUser && canAccessTab(currentUser, 'admin') && (
          <div className={activeTab === 'admin' ? '' : 'hidden'}><AdminView currentUser={currentUser} onUserUpdate={setCurrentUser} /></div>
        )}
      </main>
      ) : (
      <main className="flex-1 w-full mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-10 max-w-lg mx-auto text-center space-y-3">
          <span className="inline-block w-6 h-6 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-700">Loading your workspace…</p>
          <p className="text-xs text-slate-400">Securely synchronizing your reports &amp; tasks</p>
        </div>
      </main>
      )}

      <footer className="bg-white border-t border-slate-200 text-slate-500 text-xs py-4 px-6 text-center mb-16 md:mb-0">
        <p>
          APA 2 - Staff Report | Centralized T&R / TRS Weekly Reporting & Evaluation Platform
        </p>
      </footer>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentUser={currentUser}
        onUserSwitch={handleUserSwitch}
        onLogout={handleLogout}
      />

      <TelegramConnectModal
        isOpen={telegramModalOpen}
        onClose={() => setTelegramModalOpen(false)}
        currentUser={currentUser}
        onConnectionUpdated={(updated) => setCurrentUser(updated)}
      />

      <GlobalDialog />

    </div>
  );
}
