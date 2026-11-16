import React, { useState } from 'react';
import { User } from '../types';
import { Send, AlertTriangle, X, ArrowRight } from 'lucide-react';

interface TelegramWarningBannerProps {
  currentUser: User;
  onOpenConnectModal: () => void;
}

export const TelegramWarningBanner: React.FC<TelegramWarningBannerProps> = ({
  currentUser,
  onOpenConnectModal
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  if (currentUser.role === 'admin') return null;
  // If already connected or dismissed in this session, hide
  const isConnected = !!(currentUser.telegramChatId || currentUser.telegramUsername);
  if (isConnected || isDismissed) return null;

  return (
    <div className="mb-4 bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 text-white rounded-2xl p-3.5 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-400/50 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-white shrink-0">
          <Send className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider px-2 py-0.5 bg-white/20 rounded-full">
              Action Required
            </span>
            <h4 className="font-bold text-sm text-white">Telegram Account Not Connected</h4>
          </div>
          <p className="text-xs text-amber-50 mt-0.5 leading-relaxed">
            Connect your Telegram account to receive automated 24h deadline warnings, manager review escalation notices, and score dispute resolutions.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        <button
          type="button"
          onClick={onOpenConnectModal}
          className="px-3.5 py-2 bg-white hover:bg-amber-50 text-amber-900 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
        >
          <span>Connect Telegram</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          title="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
