import React, { useState } from 'react';
import { User } from '../types';
import { setCurrentUser, reloadStorage, userFromSession } from '../services/storage';
import { api } from '../services/api';
import { LoadingScreen } from './LoadingScreen';
import {
  ShieldCheck, Lock, Key, LogIn, Eye, EyeOff,
  ClipboardList, MessageSquare, CheckCircle2, CalendarClock, Sparkles
} from 'lucide-react';

interface LoginFormProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const payload = await api.login(username.trim(), password);
      const user = userFromSession(payload.user, payload.permissions);
      setCurrentUser(user);
      // Enter the app immediately — data streams in via the background
      // reload; views render once the first sync completes.
      reloadStorage().catch(() => {});
      onLoginSuccess(user);
      setUsername('');
      setPassword('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid username or password credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const features = [
    { icon: ClipboardList, title: 'Weekly T&R Reports', desc: 'Checklist-based job description tasks with scoring' },
    { icon: MessageSquare, title: 'TRS Superior Tracking', desc: 'Live task delegation, review & feedback loop' },
    { icon: CalendarClock, title: 'Timeliness Scoring', desc: 'Automatic on-time & quality grading' },
    { icon: ShieldCheck, title: 'Digital E-Signature', desc: 'Handwritten, uploaded or verified stamp' }
  ];

  return (
    <div className="min-h-screen bg-[#070913] flex items-center justify-center p-4 selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {isSubmitting && (
        <LoadingScreen label="Signing in…" sublabel="Authenticating and loading your staff workspace" />
      )}
      {/* Ambient glows */}
      <div className="absolute w-[480px] h-[480px] bg-indigo-600/15 rounded-full blur-3xl pointer-events-none -top-24 -left-24" />
      <div className="absolute w-[480px] h-[480px] bg-blue-600/15 rounded-full blur-3xl pointer-events-none -bottom-24 -right-24" />
      <div className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(129,140,248,0.18) 1px, transparent 0)', backgroundSize: '28px 28px' }}
      />

      {/* Main Card */}
      <div className="relative z-10 w-full max-w-[920px] bg-white rounded-3xl shadow-2xl border border-slate-800/60 overflow-hidden animate-in fade-in zoom-in duration-200 grid lg:grid-cols-[1.05fr_1fr]">
        {/* Brand Panel */}
        <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-[#1C2138] via-[#14182B] to-[#0E1120] p-10 text-white relative overflow-hidden">
          <div className="absolute w-72 h-72 bg-indigo-600/20 rounded-full blur-3xl -top-16 -right-16 pointer-events-none" />
          <div className="absolute w-72 h-72 bg-blue-600/20 rounded-full blur-3xl -bottom-16 -left-16 pointer-events-none" />

          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white flex items-center justify-center font-black text-[18px] tracking-wide shadow-lg shadow-indigo-900/50">
                XS
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white leading-tight">Staff Report</h1>
                <p className="text-[11px] text-slate-400 font-medium">Centralized T&R / TRS Portal</p>
              </div>
            </div>

            <div className="mt-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/25 text-indigo-300 text-[11px] font-semibold">
                <Sparkles className="w-3.5 h-3.5" /> Secure Staff Workspace
              </span>
              <h2 className="mt-4 text-[26px] leading-snug font-bold tracking-tight">
                Weekly reporting, review and task tracking — all in one place.
              </h2>
              <p className="mt-2 text-[13px] text-slate-400 leading-relaxed">
                Sign in to fill your weekly T&R report, track delegated TRS tasks, and get evaluated by your superior.
              </p>
            </div>
          </div>

          <div className="relative space-y-4 mt-10">
            {features.map(f => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <f.icon className="w-4 h-4 text-indigo-300" />
                </span>
                <div>
                  <div className="text-[13px] font-bold text-white">{f.title}</div>
                  <div className="text-[11px] text-slate-400">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form Panel */}
        <div className="bg-white">
          {/* Mobile / Tablet header */}
          <div className="lg:hidden bg-gradient-to-b from-[#1C2138] via-[#14182B] to-[#0E1120] px-8 pt-8 pb-7 text-center flex flex-col items-center justify-center border-b border-white/5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white flex items-center justify-center font-black text-[18px] tracking-wide shadow-inner">
              XS
            </div>
            <h2 className="mt-3 text-xl font-bold text-white tracking-tight">Staff Report</h2>
            <p className="text-xs text-slate-400 mt-1 font-medium">Sign in with your username and password</p>
          </div>

          <div className="p-7 sm:p-8 space-y-4">
            <div className="hidden lg:block">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
              <p className="text-[13px] text-slate-500 mt-1 font-medium">
                Sign in with your username and password
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    required
                    className="w-full pl-10 pr-3 py-2.5 border border-slate-200 focus:border-indigo-500 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all font-medium"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="w-full pl-10 pr-11 py-2.5 border border-slate-200 focus:border-indigo-500 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all font-medium"
                  />
                  <Key className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <LogIn className="w-4 h-4" />
                <span>{isSubmitting ? 'Signing in…' : 'Sign In'}</span>
              </button>
            </form>

            <div className="pt-1 flex items-center gap-3 text-[10px] text-slate-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Your session is secured with role-based access & audit logging.
            </div>
          </div>
        </div>
      </div>

      </div>
  );
};
