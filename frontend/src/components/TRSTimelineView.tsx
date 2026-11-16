import React, { useState, useMemo, useRef, useEffect } from 'react';
import { TRSTask, User } from '../types';
import { getDaysDifferenceFromToday } from '../services/deadlineAlertService';
import { parseISODate, formatISODate } from '../utils/dateUtils';
import {
  Calendar,
  Clock,
  Search,
  User as UserIcon,
  ChevronLeft,
  ChevronRight,
  Filter,
  MoreHorizontal
} from 'lucide-react';

interface TRSTimelineViewProps {
  tasks: TRSTask[];
  currentUser: User;
  onSelectTask: (task: TRSTask) => void;
}

export const TRSTimelineView: React.FC<TRSTimelineViewProps> = ({
  tasks,
  currentUser,
  onSelectTask
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Local calendar "today" — NOT toISOString(), which is UTC and pushed the
  // today marker a day ahead for every viewer west of UTC.
  const todayStr = useMemo(() => formatISODate(new Date()), []);

  const todayOffsetPct = useMemo(() => {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    return (hours / 24) * 100;
  }, []);

  const { minDate, maxDate, dayList } = useMemo(() => {
    const now = Date.now();
    // Build the grid in local calendar days and snap to local midnight, so each
    // cell is one distinct day for the viewer. Date-only values from MySQL are
    // parsed with parseISODate() for the same reason: new Date('YYYY-MM-DD')
    // is UTC midnight and lands on the previous day west of UTC.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let minTimestamp = startOfToday.getTime() - 86400000 * 7;
    let maxTimestamp = startOfToday.getTime() + 86400000 * 21;

    const activeTasks = tasks.filter(t => {
      const isCompleted = t.status === 'Completed' || t.evaluationStatus === 'Approved';
      if (!isCompleted) return true;
      const completedDate = t.completionDate || t.deadline;
      if (!completedDate) return false;
      return (now - parseISODate(completedDate).getTime()) < 86400000 * 30;
    });

    activeTasks.forEach(t => {
      if (t.assignedDate) {
        const start = parseISODate(t.assignedDate).getTime();
        if (!isNaN(start) && start < minTimestamp) minTimestamp = start;
      }
      if (t.deadline) {
        const due = parseISODate(t.deadline).getTime();
        if (!isNaN(due) && due > maxTimestamp) maxTimestamp = due;
      }
    });

    minTimestamp -= 86400000 * 2;
    maxTimestamp += 86400000 * 3;

    // Re-snap after the arithmetic so DST transitions cannot leave a partial day.
    const firstDay = new Date(minTimestamp);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(maxTimestamp);
    lastDay.setHours(0, 0, 0, 0);

    const days: string[] = [];
    const curr = new Date(firstDay);
    while (curr <= lastDay) {
      days.push(formatISODate(curr));
      curr.setDate(curr.getDate() + 1);
      if (days.length > 60) break;
    }

    return {
      minDate: days[0] || todayStr,
      maxDate: days[days.length - 1] || todayStr,
      dayList: days
    };
  }, [tasks, todayStr]);

  // Auto-scroll to today
  useEffect(() => {
    if (scrollRef.current) {
      const todayIndex = dayList.indexOf(todayStr);
      if (todayIndex >= 0) {
        const container = scrollRef.current;
        const dayWidth = (container.scrollWidth - TASK_COL_WIDTH) / dayList.length;
        const scrollTarget = TASK_COL_WIDTH + dayWidth * todayIndex - container.clientWidth / 4;
        setTimeout(() => { container.scrollLeft = Math.max(0, scrollTarget); }, 100);
      }
    }
  }, [dayList, todayStr]);

  const filteredTasks = useMemo(() => {
    const now = Date.now();
    return tasks.filter(t => {
      const isCompleted = t.status === 'Completed' || t.evaluationStatus === 'Approved';
      if (isCompleted) {
        const completedDate = t.completionDate || t.deadline;
        if (completedDate && (now - parseISODate(completedDate).getTime()) >= 86400000 * 30) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!(t.title || '').toLowerCase().includes(q) &&
            !(t.assignedToName || '').toLowerCase().includes(q) &&
            !(t.department || '').toLowerCase().includes(q)) return false;
      }
      if (filterStatus !== 'all') {
        if (filterStatus === 'completed' && !isCompleted) return false;
        if (filterStatus === 'in-progress' && t.status !== 'In Progress') return false;
        if (filterStatus === 'overdue') {
          if (t.status !== 'Overdue' && getDaysDifferenceFromToday(t.deadline) >= 0) return false;
        }
        if (filterStatus === 'pending' && t.status !== 'Pending') return false;
      }
      return true;
    });
  }, [tasks, searchQuery, filterStatus]);

  const getBarMetrics = (t: TRSTask) => {
    const minTime = parseISODate(minDate).getTime();
    const maxTime = parseISODate(maxDate).getTime();
    const range = maxTime - minTime;
    if (range <= 0) return { left: 0, width: 100 };

    const startTime = t.assignedDate ? parseISODate(t.assignedDate).getTime() : minTime;
    const dueTime = t.deadline ? parseISODate(t.deadline).getTime() : maxTime;

    const clampedStart = Math.max(minTime, Math.min(maxTime, startTime));
    const clampedDue = Math.max(clampedStart, Math.min(maxTime, dueTime));

    const left = ((clampedStart - minTime) / range) * 100;
    const width = Math.max(1.5, ((clampedDue - clampedStart) / range) * 100);

    return {
      left: Math.max(0, Math.min(99, left)),
      width: Math.max(2, Math.min(100 - left, width))
    };
  };

  const getProgress = (t: TRSTask) => {
    if (t.progress !== undefined) return t.progress;
    if (t.status === 'Completed' || t.submittedAt) return 100;
    if (t.status === 'In Progress') return 50;
    return 0;
  };

  const getStatus = (t: TRSTask): 'completed' | 'overdue' | 'in-progress' | 'pending' => {
    if (t.status === 'Completed' || t.evaluationStatus === 'Approved') return 'completed';
    if (t.status === 'Overdue' || getDaysDifferenceFromToday(t.deadline) < 0) return 'overdue';
    if (t.status === 'Pending') return 'pending';
    return 'in-progress';
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    const p = name.trim().split(/\s+/).filter(Boolean);
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  };

  const statusConfig = {
    'completed': { color: '#10b981', bg: 'bg-emerald-500', light: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', label: 'Completed' },
    'overdue': { color: '#ef4444', bg: 'bg-red-500', light: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'Overdue' },
    'in-progress': { color: '#3b82f6', bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', label: 'In Progress' },
    'pending': { color: '#f59e0b', bg: 'bg-amber-500', light: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'Pending' }
  };

  const todayMidnight = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const isToday = (dateStr: string) => dateStr === todayStr;

  const isWeekend = (dateStr: string) => {
    const d = parseISODate(dateStr);
    return d.getDay() === 0 || d.getDay() === 6;
  };

  // Group days into weeks for month header
  const monthHeaders = useMemo(() => {
    const headers: { month: string; startIdx: number; count: number }[] = [];
    let currentMonth = '';
    dayList.forEach((d, i) => {
      const m = parseISODate(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      if (m !== currentMonth) {
        currentMonth = m;
        headers.push({ month: m, startIdx: i, count: 1 });
      } else {
        headers[headers.length - 1].count++;
      }
    });
    return headers;
  }, [dayList]);

  const DAY_WIDTH = 42; // px per day column
  const TASK_COL_WIDTH = 176; // sticky task-name column width (w-44)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Toolbar - Redesigned for Mobile */}
      <div className="px-3 py-3 border-b border-slate-200 bg-white">
        {/* Title + Task Count */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-slate-900">Timeline</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-600">{filteredTasks.length}</span>
            <span className="text-xs text-slate-400 uppercase tracking-wide">tasks</span>
          </div>
        </div>

        {/* Search - Full width on mobile */}
        <div className="relative mb-3">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-400"
          />
        </div>

        {/* Filter Pills - Horizontal scroll on mobile */}
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-3 px-3">
          {[
            { value: 'all', label: 'All', color: 'slate' },
            { value: 'in-progress', label: 'Active', color: 'blue' },
            { value: 'completed', label: 'Done', color: 'emerald' },
            { value: 'overdue', label: 'Overdue', color: 'red' },
            { value: 'pending', label: 'Pending', color: 'amber' }
          ].map(f => {
            const isActive = filterStatus === f.value;
            const colorMap = {
              slate: { bg: 'bg-slate-100', text: 'text-slate-600', active: 'bg-slate-900 text-white' },
              blue: { bg: 'bg-blue-50', text: 'text-blue-700', active: 'bg-blue-600 text-white' },
              emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', active: 'bg-emerald-600 text-white' },
              red: { bg: 'bg-red-50', text: 'text-red-700', active: 'bg-red-600 text-white' },
              amber: { bg: 'bg-amber-50', text: 'text-amber-700', active: 'bg-amber-600 text-white' }
            };
            const c = colorMap[f.color as keyof typeof colorMap];
            return (
              <button
                key={f.value}
                onClick={() => setFilterStatus(f.value)}
                className={`whitespace-nowrap px-4 py-2 text-sm font-semibold rounded-full transition-all ${
                  isActive ? `${c.active} shadow-sm` : `${c.bg} ${c.text} hover:bg-opacity-80`
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Legend - Compact row */}
        <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-500 pt-2 border-t border-slate-100">
          <span className="font-semibold text-slate-600">Legend:</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Done</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Active</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Overdue</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Pending</span>
        </div>
      </div>

      {/* Google Calendar Style Timeline — horizontally scrollable on all screens */}
      <div className="overflow-hidden">
        <div ref={scrollRef} className="overflow-x-auto no-scrollbar">
          <div className="min-w-max" style={{ width: TASK_COL_WIDTH + dayList.length * DAY_WIDTH }}>
            {/* Month header */}
            <div className="flex border-b border-slate-200 bg-white sticky top-0 z-3">
              <div className="sticky left-0 z-2 bg-white shrink-0 h-6 px-2.5 flex items-center border-r-2 border-slate-200" style={{ width: TASK_COL_WIDTH }}>
                <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Timeline</span>
              </div>
              {monthHeaders.map((mh, i) => (
                <div
                  key={i}
                  className="h-6 flex items-center px-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wide border-r border-slate-100"
                  style={{ width: mh.count * DAY_WIDTH }}
                >
                  {mh.month}
                </div>
              ))}
            </div>

            {/* Day header */}
            <div className="flex border-b border-slate-200 bg-white sticky top-6 z-3">
              <div className="sticky left-0 z-2 bg-white shrink-0 border-r-2 border-slate-200 px-2.5 py-1 flex items-center justify-between" style={{ width: TASK_COL_WIDTH }}>
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Task</span>
                <span className="text-[9px] font-semibold text-slate-400">{filteredTasks.length}</span>
              </div>
              {dayList.map(d => {
                const today = isToday(d);
                const weekend = isWeekend(d);
                const dateObj = parseISODate(d);
                const dayNum = dateObj.getDate();
                const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                return (
                  <div
                    key={d}
                    className={`shrink-0 text-center py-1 border-r border-slate-100 ${
                      today ? 'bg-blue-50/70' : weekend ? 'bg-slate-100/50' : 'bg-white'
                    }`}
                    style={{ width: DAY_WIDTH }}
                  >
                    <div className={`text-[9px] font-bold uppercase ${today ? 'text-blue-600' : 'text-slate-400'}`}>
                      {dayName.slice(0, 2)}
                    </div>
                    <div className={`w-5 h-5 mx-auto mt-0.5 flex items-center justify-center text-[11px] font-bold rounded-full ${
                      today ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700'
                    }`}>
                      {dayNum}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Task rows */}
            <div className="bg-white">
              {filteredTasks.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-sm">No tasks found.</div>
              ) : (
                filteredTasks.map(t => {
                  const { left, width } = getBarMetrics(t);
                  const progress = getProgress(t);
                  const status = getStatus(t);
                  const sc = statusConfig[status];

                  return (
                    <div
                      key={t.id}
                      onClick={() => onSelectTask(t)}
                      className="flex items-center border-b border-slate-100 hover:bg-blue-50/40 transition-colors cursor-pointer group"
                      style={{ minHeight: 52 }}
                    >
                      {/* Sticky task column */}
                      <div className="sticky left-0 z-20 bg-white shrink-0 border-r-2 border-slate-200 px-2.5 py-1.5 flex flex-col justify-center group-hover:bg-blue-50/60 transition-colors" style={{ width: TASK_COL_WIDTH }}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
                          <span className="text-[11px] font-semibold text-slate-800 truncate">{t.title}</span>
                        </div>
                        <div className="flex items-center gap-1 ml-3 text-[9px] text-slate-400 truncate">
                          <span className="truncate">{t.assignedToName}</span>
                          <span>·</span>
                          <span>{progress}%</span>
                        </div>
                      </div>

                      {/* Timeline body */}
                      <div className="relative h-[52px] flex-1 flex items-center" style={{ minWidth: dayList.length * DAY_WIDTH }}>
                        {/* Day grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {dayList.map((d, i) => {
                            const today = isToday(d);
                            const weekend = isWeekend(d);
                            return (
                              <div
                                key={d}
                                className={`shrink-0 border-r ${
                                  today ? 'border-blue-100 bg-blue-50/40' : weekend ? 'border-slate-100 bg-slate-100/40' : 'border-slate-100/70'
                                }`}
                                style={{ width: DAY_WIDTH }}
                              />
                            );
                          })}
                        </div>

                        {/* Current time accent line */}
                        {(() => {
                          const todayIndex = dayList.indexOf(todayStr);
                          if (todayIndex < 0) return null;
                          // Position = (today's column index + fraction of the day
                          // elapsed) / total columns. The old expression divided the
                          // intraday term by the column count twice
                          // (todayOffsetPct / N) * (100 / N), which pinned the line
                          // to the start of today's column instead of the current time.
                          const dayFraction = todayOffsetPct / 100;
                          const leftPct = ((todayIndex + dayFraction) / dayList.length) * 100;
                          return (
                            <div
                              className="absolute top-0 bottom-0 w-[2px] bg-red-400 pointer-events-none z-10 opacity-80"
                              style={{ left: `${leftPct}%` }}
                            />
                          );
                        })()}

                        {/* Google Calendar event chip */}
                        <div
                          className="absolute z-10 cursor-pointer"
                          style={{ left: `${left}%`, width: `${width}%`, top: 3, bottom: 3 }}
                        >
                          <div
                            className="relative w-full h-full flex items-center rounded-[6px] overflow-hidden transition-shadow hover:shadow-md group/bar"
                            style={{
                              backgroundColor: `${sc.color}17`,
                              borderLeft: `4px solid ${sc.color}`,
                            }}
                            title={`${t.title}\n${t.assignedToName} · ${t.department}\nStart: ${t.assignedDate || '—'} → Due: ${t.deadline}\nProgress: ${progress}%`}
                          >
                            {/* subtle progress fill */}
                            <div
                              className="absolute inset-y-0 left-0 transition-all duration-300"
                              style={{ width: `${Math.max(0, progress)}%`, backgroundColor: `${sc.color}26` }}
                            />
                            <span className="relative z-10 flex-1 min-w-0 pl-2 pr-1 text-[10px] font-semibold text-slate-800 truncate">
                              {t.title}
                            </span>
                            {width > 8 && (
                              <span className="relative z-10 ml-auto pr-1.5 text-[9px] font-bold shrink-0" style={{ color: sc.color }}>
                                {progress}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-[11px] text-slate-400">
        <span>Click a task to view details</span>
        <span>{minDate} — {maxDate}</span>
      </div>
    </div>
  );
};
