import React, { useState } from 'react';
import { User } from '../types';
import { changeForcedPassword, logoutUser } from '../services/storage';
import { confirmDialog } from './GlobalDialog';
import { LockKeyhole, ShieldCheck, Loader2, LogOut, AlertTriangle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

interface ForcePasswordChangeProps {
  currentUser: User;
  onComplete: (user: User) => void;
}

export const ForcePasswordChange: React.FC<ForcePasswordChangeProps> = ({ currentUser, onComplete }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const missing: string[] = [];
    if (newPassword.length < 8) missing.push('8 characters');
    if (!/[A-Z]/.test(newPassword)) missing.push('an uppercase letter');
    if (!/[a-z]/.test(newPassword)) missing.push('a lowercase letter');
    if (!/[0-9]/.test(newPassword)) missing.push('a number');
    if (!/[^A-Za-z0-9]/.test(newPassword)) missing.push('a special symbol');
    if (missing.length) {
      setErrorMsg(`New password must include ${missing.join(', ')}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg('');
    const res = await changeForcedPassword(currentUser.id, newPassword);
    if (res.success && res.user) {
      onComplete(res.user);
    } else {
      setErrorMsg(res.message);
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    const confirmed = await confirmDialog(
      'Are you sure you want to sign out?',
      { title: 'Sign Out', confirmText: 'Yes, Sign Out' }
    );
    if (!confirmed) return;
    await logoutUser();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#070913] flex items-center justify-center p-4 selection:bg-red-500 selection:text-white relative overflow-hidden">
      {isSubmitting && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 flex items-center gap-3 shadow-2xl">
            <Loader2 className="w-5 h-5 text-red-600 animate-spin" />
            <span className="text-sm font-semibold text-slate-700">Updating password…</span>
          </div>
        </div>
      )}

      {/* Ambient glows */}
      <div className="absolute w-[480px] h-[480px] bg-indigo-600/15 rounded-full blur-3xl pointer-events-none -top-24 -left-24" />
      <div className="absolute w-[480px] h-[480px] bg-rose-600/10 rounded-full blur-3xl pointer-events-none -bottom-24 -right-24" />

      <div className="relative z-10 w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-800/60 overflow-hidden">
          <div className="bg-gradient-to-br from-red-800 via-rose-900 to-red-950 px-8 pt-8 pb-7 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
              <LockKeyhole className="w-7 h-7 text-white" />
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-tight text-white">Password Update Required</h2>
            <p className="mt-1 text-xs text-indigo-200">
              For your account security, you must set a new password before continuing.
            </p>
          </div>

          <div className="p-7 space-y-4">
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Hi <span className="font-bold">{currentUser.name}</span> — the temporary password for{' '}
                <span className="font-bold">@{currentUser.username}</span> must be replaced with one only you know.
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    autoFocus
                    className="w-full pl-3.5 pr-10 py-2.5 border border-slate-200 focus:border-red-500 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-red-500/20 focus:outline-none transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Must be 8+ characters with uppercase, lowercase, a number &amp; a special symbol.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                    required
                    className="w-full pl-3.5 pr-10 py-2.5 border border-slate-200 focus:border-red-500 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-red-500/20 focus:outline-none transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-red-700 hover:bg-red-800 active:bg-red-900 text-white rounded-xl text-sm font-bold shadow-lg shadow-red-700/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isSubmitting ? 'Updating…' : 'Update Password & Continue'}</span>
              </button>
            </form>

            <div className="pt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Audit-logged password update.
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};