import React, { useState, useEffect } from 'react';
import { User, OnboardingStatus } from '../types';
import {
  getUserOnboardingStatus,
  updateUserOnboardingStep,
  dismissOnboarding,
  getTemplateForPosition
} from '../services/storage';
import {
  CheckCircle2,
  Circle,
  Send,
  FileCheck,
  SendHorizontal,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface OnboardingWidgetProps {
  currentUser: User;
  onOpenTelegramModal: () => void;
  onNavigateToTab: (tab: 'tr' | 'trs' | 'evaluation' | 'notices' | 'admin') => void;
}

export const OnboardingWidget: React.FC<OnboardingWidgetProps> = ({
  currentUser,
  onOpenTelegramModal,
  onNavigateToTab
}) => {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const loadStatus = () => {
    const s = getUserOnboardingStatus(currentUser);
    setStatus(s);
    if (s.dismissedAt) {
      setIsDismissed(true);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [currentUser]);

  if (!status || isDismissed) return null;

  const steps = [
    {
      id: 'telegram',
      title: 'Connect Telegram Account',
      desc: 'Receive automated deadline alerts, review notifications, and escalation warnings.',
      isDone: status.telegramConnected,
      actionLabel: 'Connect Bot',
      icon: Send,
      action: () => onOpenTelegramModal()
    },
    {
      id: 'jd',
      title: 'Review Position JD Checklist',
      desc: `Familiarize yourself with designated operational routines for ${currentUser.position}.`,
      isDone: status.jdReviewed,
      actionLabel: 'Review JD',
      icon: FileCheck,
      action: () => {
        updateUserOnboardingStep(currentUser.id, 'jdReviewed', true);
        loadStatus();
        onNavigateToTab('tr');
      }
    },
    {
      id: 'report',
      title: 'Submit First Weekly T&R Report',
      desc: 'Fill out weekly checklist, attach deliverables, provide e-signature, and submit.',
      isDone: status.firstReportSubmitted,
      actionLabel: 'Create Report',
      icon: SendHorizontal,
      action: () => onNavigateToTab('tr')
    }
  ];

  const completedCount = steps.filter(s => s.isDone).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  const handleDismiss = () => {
    dismissOnboarding(currentUser.id);
    setIsDismissed(true);
  };

  // If all completed and user dismissed or wants to minimize
  if (status.completed && isCollapsed) return null;

  return (
    <div className="mb-4 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md border border-blue-800/50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center border border-blue-400/30">
            <Sparkles className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">Staff Quick-Start Onboarding</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-500/30 text-blue-200 rounded-full border border-blue-400/30">
                {completedCount} of {steps.length} Complete ({progressPercent}%)
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Complete these 3 essential steps to get fully set up in the APA reporting system
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
            title={isCollapsed ? 'Expand checklist' : 'Collapse'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
            title="Dismiss checklist"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-800 rounded-full h-1.5 mt-3 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-400 to-emerald-400 h-1.5 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {!isCollapsed && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div
                key={step.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  step.isDone
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-100'
                    : 'bg-white/5 border-white/10 text-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <Icon className="w-4 h-4 text-blue-300" />
                  </div>
                  {step.isDone ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Done
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <Circle className="w-3.5 h-3.5" /> Pending
                    </span>
                  )}
                </div>

                <h4 className="font-bold text-xs text-white mb-1">{step.title}</h4>
                <p className="text-[11px] text-slate-300 mb-3 leading-relaxed min-h-[2.3rem]">{step.desc}</p>

                {!step.isDone && (
                  <button
                    type="button"
                    onClick={step.action}
                    className="w-full py-1.5 px-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-xs transition-colors cursor-pointer"
                  >
                    <span>{step.actionLabel}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
