import React, { useState } from 'react';
import { TaskDeadlineAlert } from '../services/deadlineAlertService';
import {
  AlertTriangle,
  Clock,
  Calendar,
  ChevronRight,
  X,
  Zap,
  CheckCircle2,
  FileText,
  ListTodo
} from 'lucide-react';

interface DeadlineBannerProps {
  alerts: TaskDeadlineAlert[];
  onNavigateToTask?: (alert: TaskDeadlineAlert) => void;
}

export const DeadlineBanner: React.FC<DeadlineBannerProps> = ({
  alerts,
  onNavigateToTask
}) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  if (alerts.length === 0 || isDismissed) return null;

  const overdueCount = alerts.filter(a => a.urgency === 'overdue').length;
  const dueTodayCount = alerts.filter(a => a.urgency === 'due_today').length;
  const dueSoonCount = alerts.filter(a => a.urgency === 'due_soon').length;
  const approachingCount = alerts.filter(a => a.urgency === 'approaching').length;

  const topAlert = alerts[0];

  const bannerBg = overdueCount > 0 
    ? 'bg-rose-50 border-rose-300 text-rose-950' 
    : dueTodayCount > 0 
    ? 'bg-amber-50 border-amber-300 text-amber-950' 
    : 'bg-blue-50 border-blue-300 text-blue-950';

  const badgeBg = overdueCount > 0
    ? 'bg-rose-600 text-white'
    : dueTodayCount > 0
    ? 'bg-amber-600 text-white'
    : 'bg-blue-600 text-white';

  return (
    <div className={`border rounded-2xl p-3.5 sm:p-4 mb-0 shadow-sm transition-all duration-200 ${bannerBg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-xl shrink-0 mt-0.5 shadow-2xs ${badgeBg}`}>
            {overdueCount > 0 ? (
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            ) : dueTodayCount > 0 ? (
              <Zap className="w-5 h-5" />
            ) : (
              <Clock className="w-5 h-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-extrabold text-sm tracking-tight">
                Task Deadline Alert & Reminder
              </span>

              {overdueCount > 0 && (
                <span className="text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  {overdueCount} Overdue
                </span>
              )}
              {dueTodayCount > 0 && (
                <span className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  {dueTodayCount} Due Today
                </span>
              )}
              {dueSoonCount > 0 && (
                <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full font-bold">
                  {dueSoonCount} Due in ≤ 2 Days
                </span>
              )}
              {approachingCount > 0 && (
                <span className="text-[10px] bg-slate-700 text-white px-2 py-0.5 rounded-full font-bold">
                  {approachingCount} Due in 3–5 Days
                </span>
              )}
            </div>

            </div>
          </div>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-black/5 transition-colors cursor-pointer"
          title="Dismiss reminder for now"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick summary of the most urgent alert - full width below the header row */}
      <p className="text-xs font-medium text-slate-800 leading-relaxed w-full mt-2 sm:pl-11">
        <strong className="font-bold text-slate-900">{topAlert.title}</strong>{' '}
        ({topAlert.sourceType === 'TRS' ? 'TRS Superior Task' : 'T&R Weekly Report'}):{' '}
        {topAlert.message}
      </p>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {onNavigateToTask && (
          <button
            type="button"
            onClick={() => onNavigateToTask(topAlert)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
          >
            {topAlert.sourceType === 'TRS' ? (
              <>
                <ListTodo className="w-3.5 h-3.5 text-blue-400" /> View & Complete TRS Task
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5 text-emerald-400" /> Fill & Submit T&R Checklist
              </>
            )}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}

        {alerts.length > 1 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs font-bold text-slate-700 hover:text-slate-900 underline px-1 py-1 cursor-pointer"
          >
            {isExpanded ? 'Hide other task alerts' : `View all ${alerts.length} upcoming deadlines`}
          </button>
        )}
      </div>

      {/* Expanded List of all deadline alerts */}
      {isExpanded && alerts.length > 1 && (
        <div className="mt-3.5 pt-3 border-t border-black/10 space-y-2">
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            All Tasks Requiring Your Attention ({alerts.length} tasks):
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {alerts.map(a => {
              const cardBorder =
                a.urgency === 'overdue'
                  ? 'border-rose-300 bg-rose-100/60'
                  : a.urgency === 'due_today'
                  ? 'border-amber-300 bg-amber-100/60'
                  : 'border-slate-200 bg-white';

              return (
                <div
                  key={a.id}
                  onClick={() => onNavigateToTask && onNavigateToTask(a)}
                  className={`p-2.5 rounded-xl border text-xs flex flex-col justify-between transition-all cursor-pointer hover:shadow-xs ${cardBorder}`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-bold text-slate-900 truncate">{a.title}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-extrabold shrink-0 ${
                        a.urgency === 'overdue' ? 'bg-rose-600 text-white' :
                        a.urgency === 'due_today' ? 'bg-amber-600 text-white' :
                        a.urgency === 'due_soon' ? 'bg-blue-600 text-white' :
                        'bg-slate-600 text-white'
                      }`}>
                        {a.urgency === 'overdue' ? `${Math.abs(a.daysRemaining)}d Overdue` :
                         a.urgency === 'due_today' ? 'Due Today' :
                         `Due in ${a.daysRemaining}d`}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2">{a.message}</p>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-black/5 text-[10px] text-slate-500">
                    <span className="font-semibold">{a.sourceType} Task</span>
                    <span className="flex items-center gap-1 font-bold text-blue-700">
                      Open <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
