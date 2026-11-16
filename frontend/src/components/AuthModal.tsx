import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { getUsers, setCurrentUser, reloadStorage, userFromSession, changeMyPassword } from '../services/storage';
import { api } from '../services/api';
import { LoadingScreen } from './LoadingScreen';
import { Shield, User as UserIcon, LogOut, KeyRound, UserCheck, Lock, Mail, Briefcase, Building, Eye, EyeOff, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: User | null;
  onUserSwitch: (user: User) => void;
  onLogout: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserSwitch,
  onLogout
}) => {
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPwSaving, setIsPwSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowChangePw(false);
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
      setShowPw(false);
      setShowLoginPw(false);
      setPwMsg(null);
      setShowSignInForm(false);
      setErrorMsg('');
      setUsername('');
      setPassword('');
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  const users = getUsers();

  const handleCustomLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const payload = await api.login(username.trim(), password);
      const user = userFromSession(payload.user, payload.permissions);
      setCurrentUser(user);
      try {
        await reloadStorage();
      } catch {
        // Non-critical: data will refresh lazily as views are opened
      }
      onUserSwitch(user);
      setErrorMsg('');
      setUsername('');
      setPassword('');
      setShowSignInForm(false);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid login credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = () => {
    onLogout();
    onClose();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!curPw) { setPwMsg({ ok: false, text: 'Enter your current password.' }); return; }
    if (newPw.length < 6) { setPwMsg({ ok: false, text: 'New password must be at least 6 characters.' }); return; }
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    setIsPwSaving(true);
    setPwMsg(null);
    const result = await changeMyPassword(currentUser.id, curPw, newPw);
    if (result.success) {
      setPwMsg({ ok: true, text: result.message });
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
    } else {
      setPwMsg({ ok: false, text: result.message });
    }
    setIsPwSaving(false);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      {(isSubmitting || isPwSaving) && (
        <LoadingScreen
          label={isSubmitting ? 'Signing in…' : 'Updating password…'}
          sublabel="Please wait while we securely process your request"
        />
      )}
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 my-auto flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">My Account Profile</h3>
              <p className="text-xs text-indigo-200">Authenticated Staff Session</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Close (Esc)"
            aria-label="Close account profile"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {currentUser && !showSignInForm ? (
            <div className="space-y-5">
              {/* Profile Card */}
              <div className="bg-gradient-to-br from-blue-50/80 via-slate-50 to-indigo-50/50 border border-blue-200/80 rounded-2xl p-5 shadow-2xs">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl border-2 border-blue-600/30 shadow-xs shrink-0 bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xl overflow-hidden">
                    {currentUser.avatarUrl ? (
                      <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-full h-full object-cover" />
                    ) : (
                      currentUser.name?.charAt(0)
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-slate-900 text-base">{currentUser.name}</h4>
                    </div>
                    <p className="text-xs font-semibold text-blue-700 capitalize mt-0.5">
                      {currentUser.role} Account
                    </p>
                    <span className="inline-block px-2 py-0.5 mt-1.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md">
                      Active Session
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-200/70 grid grid-cols-1 gap-2 text-xs text-slate-700">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span><strong className="text-slate-900 font-semibold">Position:</strong> {currentUser.position}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span><strong className="text-slate-900 font-semibold">Department:</strong> {currentUser.department}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span><strong className="text-slate-900 font-semibold">Email:</strong> {currentUser.email}</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => { setShowChangePw(!showChangePw); setPwMsg(null); }}
                  className={`w-full py-2.5 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-xs ${
                    showChangePw
                      ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800'
                  }`}
                >
                  <KeyRound className="w-4 h-4" /> {showChangePw ? 'Cancel' : 'Change Password'}
                </button>

                {showChangePw && (
                  <form onSubmit={handleChangePassword} className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                    {pwMsg && (
                      <div className={`p-2.5 rounded-lg text-[11px] font-semibold ${
                        pwMsg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-700'
                      }`}>
                        {pwMsg.text}
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Current Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPw ? 'text' : 'password'}
                          value={curPw}
                          onChange={e => setCurPw(e.target.value)}
                          placeholder="Enter current password"
                          required
                          autoFocus
                          className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw(!showPw)}
                          aria-label={showPw ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPw ? 'text' : 'password'}
                          value={newPw}
                          onChange={e => setNewPw(e.target.value)}
                          placeholder="At least 6 characters"
                          required
                          className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw(!showPw)}
                          aria-label={showPw ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Confirm New Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPw ? 'text' : 'password'}
                          value={confirmPw}
                          onChange={e => setConfirmPw(e.target.value)}
                          placeholder="Re-enter new password"
                          required
                          className="w-full pl-3 pr-9 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw(!showPw)}
                          aria-label={showPw ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="text-[10px] text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1"
                      >
                        {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {showPw ? 'Hide' : 'Show'} Passwords
                      </button>
                      <button
                        type="submit"
                        disabled={isPwSaving}
                        className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        <KeyRound className="w-3.5 h-3.5" /> {isPwSaving ? 'Saving…' : 'Update Password'}
                      </button>
                    </div>
                  </form>
                )}

                {!showChangePw && (
                  <>
                    <button
                      onClick={handleSignOut}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-xs"
                    >
                      <LogOut className="w-4 h-4" /> Log Out
                    </button>

                    <div className="text-center pt-2">
                      <button
                        onClick={() => setShowSignInForm(true)}
                        className="text-xs text-slate-500 hover:text-slate-800 font-medium underline"
                      >
                        Sign in to a different account
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCustomLogin} className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Account Credentials Sign In
                </span>
                {currentUser && (
                  <button
                    type="button"
                    onClick={() => setShowSignInForm(false)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-bold"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Enter username"
                    required
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                  />
                  <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showLoginPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    className="w-full pl-9 pr-10 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <button
                    type="button"
                    onClick={() => setShowLoginPw(!showLoginPw)}
                    aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                {currentUser && (
                  <button
                    type="button"
                    onClick={() => setShowSignInForm(false)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                  >
                    Back to Profile
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <KeyRound className="w-4 h-4" /> {isSubmitting ? 'Signing in…' : 'Sign In'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

