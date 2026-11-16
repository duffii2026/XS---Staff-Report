import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import { setCurrentUser, userFromSession, reloadStorage } from '../services/storage';

interface SessionUser {
  code: string;
  username: string;
  name: string;
  email: string;
  role: string;
  department: string;
  position: string;
  superior_id?: string | null;
  avatar_url?: string | null;
  must_change_password?: boolean;
  permissions?: Record<string, boolean>;
}

export const SSOCallback: React.FC = () => {
  const [status, setStatus] = useState<'validating' | 'success' | 'error'>('validating');
  const [message, setMessage] = useState('Validating SSO token...');
  const [redirectUrl, setRedirectUrl] = useState<string>('/');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        let returnTo = urlParams.get('returnTo') || '/';

        if (!token) {
          throw new Error('No SSO token provided');
        }

        // Safety: If returnTo is the app-manager URL, default to this app's base URL
        const appManagerUrl = 'http://localhost:6934/';
        if (returnTo === appManagerUrl || returnTo.startsWith(appManagerUrl)) {
          returnTo = window.location.origin + '/';
        }

        const response = await api.post<any>('/auth/sso/validate-launch', { token, returnTo });

        setStatus('success');
        setMessage('Authentication successful! Redirecting...');
        setRedirectUrl(response.returnTo || '/');

        // Set the current user session from SSO payload
        if (response.user) {
          const sessionUser: SessionUser = {
            code: response.user.code,
            username: response.user.username,
            name: response.user.name || response.user.username,
            email: response.user.email || '',
            role: response.user.role || 'staff',
            department: response.user.department || '',
            position: response.user.position || '',
            superior_id: response.user.superior_id ?? null,
            avatar_url: response.user.avatar_url ?? undefined,
            must_change_password: response.user.must_change_password,
            permissions: response.permissions || {},
          };
          setCurrentUser(userFromSession(sessionUser, response.permissions || {}));
          await reloadStorage();
        }

        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 1500);
      } catch (err: any) {
        setStatus('error');
        setMessage(err.message || 'SSO login failed. Please try again.');
      }
    };

    handleCallback();
  }, []);

  if (status === 'validating') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-blue-500 text-white font-black text-2xl mb-6">
            APA
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">APA Staff Report</h1>
          <p className="text-slate-500 mb-8">Completing SSO Login...</p>

          <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-blue-400 mb-4" />
            <p className="text-slate-600">{message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-100 text-rose-500 mb-6">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">SSO Login Failed</h1>
          <p className="text-slate-500 mb-6">{message}</p>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <p className="text-slate-600 mb-4">Please try signing in directly or contact IT support.</p>
            <button
              onClick={() => window.location.href = '/login'}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all"
            >
              Go to Login Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-500 mb-6">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">Welcome Back!</h1>
          <p className="text-slate-500 mb-8">SSO authentication successful</p>

          <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
            <CheckCircle2 className="w-10 h-10 animate-pulse mx-auto text-emerald-400 mb-4" />
            <p className="text-slate-600 mb-6">{message}</p>

            <button
              onClick={() => window.location.href = redirectUrl}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 mx-auto"
            >
              <span>Continuing to App...</span>
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default SSOCallback;
