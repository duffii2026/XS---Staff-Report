import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TRSTask, User } from '../types';
import { getDaysDifferenceFromToday } from '../services/deadlineAlertService';
import { getSubordinateUserIds } from '../services/storage';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  UserCheck,
  FileCheck,
  Download,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  CheckSquare,
  Square,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  Trash2,
  Lock,
  ShieldAlert
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';

interface TRSTrackingTableProps {
  tasks: TRSTask[];
  currentUser: User;
  allUsers: User[];
  onSelectTask: (task: TRSTask) => void;
  onOpenReviewModal: (task: TRSTask) => void;
  onOpenSubmitModal: (task: TRSTask) => void;
  onUpdateStatus: (task: TRSTask, newStatus: TRSTask['status']) => void;
  onUpdateProgress?: (task: TRSTask, newProgress: number) => void;
  onBulkDelete?: (taskIds: string[]) => void;
  onBulkMarkCompleted?: (taskIds: string[]) => void;
  /**
   * Whether the Grade action should be offered. Grading belongs to the
   * "Subordinate TRS Reports" view only, so the parent passes false while the
   * "My TRS tasks (From Superior)" list is displayed — otherwise a self-assigned
   * task (assignedTo === assignedBy === currentUser) matched `isSuperior` and
   * exposed a Grade button on the superior's own request.
   */
  canGrade?: boolean;
}

export const TRSTrackingTable: React.FC<TRSTrackingTableProps> = ({
  tasks,
  currentUser,
  allUsers,
  onSelectTask,
  onOpenReviewModal,
  onOpenSubmitModal,
  onUpdateStatus,
  onUpdateProgress,
  onBulkDelete,
  canGrade = true
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [popoverTaskId, setPopoverTaskId] = useState<string | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number } | null>(null);
  const popoverAnchorRef = useRef<HTMLButtonElement | null>(null);

  const openProgressPopover = (taskId: string, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (popoverTaskId === taskId) {
      setPopoverTaskId(null);
      setPopoverAnchor(null);
      popoverAnchorRef.current = null;
    } else {
      popoverAnchorRef.current = e.currentTarget as HTMLButtonElement;
      setPopoverTaskId(taskId);
      setPopoverAnchor({ x: rect.left, y: rect.bottom });
    }
  };

  const closeProgressPopover = () => {
    setPopoverTaskId(null);
    setPopoverAnchor(null);
    popoverAnchorRef.current = null;
  };

  // Keep the mini dialog pinned under its parent cell while the page/table scrolls
  useEffect(() => {
    if (!popoverTaskId) return;
    const reanchor = () => {
      const el = popoverAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPopoverAnchor({ x: rect.left, y: rect.bottom });
    };
    window.addEventListener('scroll', reanchor, true);
    window.addEventListener('resize', reanchor);
    reanchor();
    return () => {
      window.removeEventListener('scroll', reanchor, true);
      window.removeEventListener('resize', reanchor);
    };
  }, [popoverTaskId]);

  // Automatically reset selection & popover whenever the active task list changes (e.g. switching between My Tasks and Subordinate Reports)
  useEffect(() => {
    setSelectedIds(new Set());
    closeProgressPopover();
  }, [tasks]);

  // Derive unique projects/departments
  const projectList = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => {
      set.add(t.project || t.department || 'Operations');
    });
    return Array.from(set);
  }, [tasks]);

  const getStaffInitials = (name: string) => {
    if (!name) return 'ST';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Helpers to get task attributes consistently (Option B: TRS-Initials-001)
  const getTaskCode = (t: TRSTask, index: number) => {
    if (t.code && !t.code.match(/^TRS-0\d\d$/)) return t.code;
    const initials = getStaffInitials(t.assignedToName);
    const staffTasks = tasks.filter(x => x.assignedTo === t.assignedTo);
    const staffIndex = staffTasks.findIndex(x => x.id === t.id);
    const num = staffIndex >= 0 ? staffIndex + 1 : index + 1;
    return `TRS-${initials}-${num.toString().padStart(3, '0')}`;
  };

  const getTaskProject = (t: TRSTask) => {
    return t.project || t.department || 'Operations';
  };

  const getTaskPriority = (t: TRSTask): 'Urgent' | 'High' | 'Medium' | 'Low' => {
    if (t.priority) return t.priority;
    if (t.status === 'Overdue') return 'Urgent';
    const diff = getDaysDifferenceFromToday(t.deadline);
    if (diff <= 1 && t.status !== 'Completed') return 'High';
    return 'Medium';
  };

  const getTaskProgress = (t: TRSTask): number => {
    if (t.progress !== undefined) return t.progress;
    if (t.status === 'Completed' || t.submittedAt) return 100;
    if (t.status === 'In Progress') return 50;
    return 0;
  };

  const getTaskAlert = (t: TRSTask) => {
    if (t.evaluationStatus === 'Approved') {
      return { label: 'Approved', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (t.evaluationStatus === 'Reviewed') {
      return { label: 'Graded', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (t.evaluationStatus === 'Revision') {
      return { label: 'Revision Needed', color: 'bg-rose-50 text-rose-700 border-rose-200' };
    }
    if (t.submittedAt) {
      return { label: 'Awaiting Grade', color: 'bg-amber-50 text-amber-800 border-amber-300' };
    }
    if (t.status === 'Completed') {
      return { label: 'Completed', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (t.isDefaulted || t.status === 'Defaulted') {
      return { label: 'Auto-Locked 0%', color: 'bg-rose-600 text-white border-rose-700' };
    }
    const diff = getDaysDifferenceFromToday(t.deadline);
    if (diff < 0) {
      return { label: `${Math.abs(diff)}d Overdue`, color: 'bg-rose-100 text-rose-800 border-rose-300' };
    }
    if (diff === 0) {
      return { label: 'Due Today', color: 'bg-amber-100 text-amber-900 border-amber-300' };
    }
    if (diff === 1) {
      return { label: 'Due Tomorrow', color: 'bg-amber-50 text-amber-800 border-amber-200' };
    }
    return { label: `${diff}d Left`, color: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  const getTaskNote = (t: TRSTask): string => {
    return t.staffRemarks || t.submissionNotes || t.feedback || t.description || '—';
  };

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t, idx) => {
      const code = getTaskCode(t, idx).toLowerCase();
      const title = (t.title || '').toLowerCase();
      const assigned = (t.assignedToName || '').toLowerCase();
      const proj = getTaskProject(t).toLowerCase();
      const note = getTaskNote(t).toLowerCase();

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          code.includes(q) ||
          title.includes(q) ||
          assigned.includes(q) ||
          proj.includes(q) ||
          note.includes(q);
        if (!matches) return false;
      }

      if (statusFilter !== 'all') {
        if (statusFilter === 'Approved') {
          if (t.evaluationStatus !== 'Approved' && (t.status !== 'Completed' || t.evaluationStatus)) return false;
        } else if (statusFilter === 'Reviewed') {
          if (t.evaluationStatus !== 'Reviewed') return false;
        } else if (statusFilter === 'Revision') {
          if (t.evaluationStatus !== 'Revision') return false;
        } else if (statusFilter === 'Submitted') {
          if (!t.submittedAt && !t.submissionNotes) return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }

      if (priorityFilter !== 'all') {
        const p = getTaskPriority(t);
        if (p !== priorityFilter) return false;
      }

      if (projectFilter !== 'all') {
        const prj = getTaskProject(t);
        if (prj !== projectFilter) return false;
      }

      return true;
    });
  }, [tasks, searchQuery, statusFilter, priorityFilter, projectFilter]);

  // Only consider selected IDs that actually exist in the current tasks array
  const validSelectedIds = useMemo(() => {
    const taskIds = new Set(tasks.map(t => t.id));
    const valid = new Set<string>();
    selectedIds.forEach(id => {
      if (taskIds.has(id)) valid.add(id);
    });
    return valid;
  }, [tasks, selectedIds]);

  // May the current user delete this task? A self-assigned task
  // (assigned_by === assigned_to) stays under its owner's control, so the owner
  // may delete it. Once a superior delegates the task, only the delegating
  // superior, the assignee's superior, or exec/admin/hr may delete it — the
  // assignee never can. Approved & Completed is final, so it is not deletable.
  const canDeleteTask = (t: TRSTask): boolean => {
    if (t.evaluationStatus === 'Approved') return false;
    const isSelfAssigned = t.assignedBy === t.assignedTo && t.assignedTo === currentUser.id;
    const isAssigneeButNotSelfAssigned = t.assignedTo === currentUser.id && !isSelfAssigned;
    if (isAssigneeButNotSelfAssigned) return false;
    if (isSelfAssigned) return true;
    return (['admin', 'executive', 'hr'].includes(currentUser.role) ||
      t.assignedBy === currentUser.id ||
      getSubordinateUserIds(currentUser.id).has(t.assignedTo));
  };

  // Tasks among selected that the current user has authority to delete
  const deletableSelectedTasks = useMemo(() => {
    return tasks.filter(t => validSelectedIds.has(t.id) && canDeleteTask(t));
  }, [tasks, validSelectedIds, currentUser]);

  // Count of selected tasks that the current user cannot delete
  const protectedFromSuperiorCount = useMemo(() => {
    return tasks.filter(t => validSelectedIds.has(t.id) && !canDeleteTask(t)).length;
  }, [tasks, validSelectedIds, currentUser]);

  // Checkbox handlers
  const handleToggleSelectAll = () => {
    if (validSelectedIds.size === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map(t => t.id)));
    }
  };

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(validSelectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Export selected to CSV
  const handleExportCSV = () => {
    const listToExport = filteredTasks.filter(t => validSelectedIds.size === 0 || validSelectedIds.has(t.id));
    if (listToExport.length === 0) return;

    const headers = ['CODE', 'TASK', 'PROJECT', 'ASSIGNED', 'PRIORITY', 'START', 'DUE', 'PROGRESS', 'STATUS', 'ALERT', 'NOTE'];
    const rows = listToExport.map((t, idx) => [
      getTaskCode(t, idx),
      `"${t.title.replace(/"/g, '""')}"`,
      `"${getTaskProject(t)}"`,
      `"${t.assignedToName}"`,
      getTaskPriority(t),
      t.assignedDate || '—',
      t.deadline,
      `${getTaskProgress(t)}%`,
      t.evaluationStatus || t.status,
      getTaskAlert(t).label,
      `"${getTaskNote(t).replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `TRS_Tasks_Tracking_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isAllSelected = filteredTasks.length > 0 && validSelectedIds.size === filteredTasks.length;

  const popoverTask = tasks.find((x) => x.id === popoverTaskId) || null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      {/* Controls & Filter Bar */}
      <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-b from-slate-50/80 to-slate-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3 flex-1 min-w-0">
          {/* Search */}
          <div className="relative w-full xl:w-80 xl:shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search code, task, project, staff, note..."
              className="w-full pl-9 pr-3 py-2 text-xs sm:text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder:text-slate-400 font-medium shadow-2xs"
            />
          </div>

          {/* Filter row: stacked on mobile, inline on desktop */}
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Project Filter */}
            <div className="flex-1 min-w-[150px] max-w-[220px]">
              <ModernSelect
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 shadow-2xs cursor-pointer"
              >
                <option value="all">All Projects</option>
                {projectList.map(p => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </ModernSelect>
            </div>

            {/* Priority Filter */}
            <div className="flex-1 min-w-[130px] max-w-[180px]">
              <ModernSelect
                value={priorityFilter}
                onChange={e => setPriorityFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 shadow-2xs cursor-pointer"
              >
                <option value="all">All Priorities</option>
                <option value="Urgent">Urgent</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </ModernSelect>
            </div>

            {/* Status Filter */}
            <div className="flex-1 min-w-[140px] max-w-[190px]">
              <ModernSelect
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 shadow-2xs cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="Approved">Approved</option>
                <option value="Reviewed">Reviewed</option>
                <option value="Submitted">Submitted</option>
                <option value="In Progress">In Progress</option>
                <option value="Pending">Pending</option>
                <option value="Overdue">Overdue</option>
                <option value="Defaulted">Auto-Locked</option>
                <option value="Revision">Revision Needed</option>
              </ModernSelect>
            </div>

            {(searchQuery || statusFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setPriorityFilter('all');
                  setProjectFilter('all');
                }}
                className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Right side stats & Export button */}
        <div className="flex items-center gap-2 w-full lg:w-auto lg:justify-end shrink-0">
          {validSelectedIds.size > 0 ? (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 flex-wrap w-full lg:w-auto">
              <span className="text-xs text-blue-900 font-extrabold">
                {validSelectedIds.size} Selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-[11px] text-blue-600 hover:text-blue-800 underline font-semibold cursor-pointer"
              >
                Clear
              </button>
              <div className="h-3 w-[1px] bg-blue-200 mx-0.5" />
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shadow-2xs"
                title="Export selected tasks to CSV"
              >
                <Download className="w-3 h-3 text-slate-500" /> Export
              </button>

              {/* Delete Button: ONLY shown if user has delegating authority (Superiors, Executives, Admins) */}
              {onBulkDelete && deletableSelectedTasks.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowBulkDeleteModal(true)}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Delete delegated tasks (Superior only)"
                >
                  <Trash2 className="w-3 h-3" /> Delete ({deletableSelectedTasks.length})
                </button>
              ) : protectedFromSuperiorCount > 0 ? (
                <span
                  className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-help"
                  title="Policy: Tasks delegated by a superior cannot be deleted by staff."
                >
                  <Lock className="w-3 h-3 text-amber-800" /> Superior Tasks Protected
                </span>
              ) : null}
            </div>
          ) : (
            <button
              onClick={handleExportCSV}
              className="w-full lg:w-auto justify-center px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Table Container with Horizontal Scroll */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 tracking-wider select-none">
              <th className="py-3 px-3 w-10 text-center">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {isAllSelected ? (
                    <CheckSquare className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700">CODE</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 min-w-[200px]">TASK</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700">PROJECT</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700">ASSIGNED</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 text-center">PRIORITY</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700">START</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700">DUE</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 min-w-[130px]">PROGRESS</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 text-center">STATUS</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 text-center">ALERT</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 min-w-[180px]">NOTE</th>
              <th className="py-3 px-3 uppercase font-bold text-slate-700 text-right pr-4">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-12 text-center text-slate-400 font-medium">
                  No TRS tasks found matching your filters.
                </td>
              </tr>
            ) : (
              filteredTasks.map((t, idx) => {
                const code = getTaskCode(t, idx);
                const project = getTaskProject(t);
                const priority = getTaskPriority(t);
                const progress = getTaskProgress(t);
                const alert = getTaskAlert(t);
                const note = getTaskNote(t);
                const isSelected = validSelectedIds.has(t.id);

                const isSuperior =
                  currentUser.role === 'admin' ||
                  t.assignedBy === currentUser.id;

                // Grading is offered from "Subordinate TRS Reports" only, and never
                // for a deliverable the superior has already approved — that grade
                // is final, so there is nothing left to re-grade.
                const showGrade = canGrade && isSuperior && t.evaluationStatus !== 'Approved';

                const isAssignee = t.assignedTo === currentUser.id;
                const isSubmitted = !!(t.submittedAt || t.status === 'Completed' || t.evaluationStatus);

                return (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTask(t)}
                    className={`hover:bg-blue-50/40 transition-colors cursor-pointer group ${
                      isSelected ? 'bg-blue-50/70' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="py-3 px-3 text-center" onClick={e => handleToggleSelectRow(t.id, e)}>
                      <button type="button" className="text-slate-400 hover:text-slate-700 cursor-pointer">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>

                    {/* CODE */}
                    <td className="py-3 px-3 font-mono font-bold text-blue-600 whitespace-nowrap">
                      {code}
                    </td>

                    {/* TASK */}
                    <td className="py-3 px-3 font-semibold text-slate-900 min-w-[200px]">
                      <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                        {t.title}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-xs font-normal mt-0.5">
                        {t.description}
                      </div>
                    </td>

                    {/* PROJECT */}
                    <td className="py-3 px-3 text-slate-600 font-medium whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {project}
                      </span>
                    </td>

                    {/* ASSIGNED */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold flex items-center justify-center">
                          {t.assignedToName.charAt(0)}
                        </div>
                        <span className="font-semibold text-slate-800">{t.assignedToName}</span>
                      </div>
                    </td>

                    {/* PRIORITY */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          priority === 'Urgent'
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : priority === 'High'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : priority === 'Medium'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {priority}
                      </span>
                    </td>

                    {/* START */}
                    <td className="py-3 px-3 text-slate-500 whitespace-nowrap font-medium">
                      {t.assignedDate || '—'}
                    </td>

                    {/* DUE */}
                    <td className="py-3 px-3 whitespace-nowrap font-bold text-slate-700">
                      {t.deadline}
                    </td>

                    {/* PROGRESS */}
                    <td
                      className="py-3 px-3 whitespace-nowrap relative"
                      onClick={e => e.stopPropagation()}
                    >
                      {isSubmitted ? (
                        <div className="flex items-center gap-2" title="Deliverable submitted (100% Complete)">
                          <div className="flex-1 bg-slate-100 rounded-full h-2 w-20 overflow-hidden border border-slate-200">
                            <div className="h-full rounded-full bg-emerald-500 w-full" />
                          </div>
                          <span className="font-bold text-[11px] text-emerald-700 w-8 text-right flex items-center justify-end gap-0.5">
                            <Lock className="w-2.5 h-2.5 text-emerald-600 inline" /> 100%
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={e => openProgressPopover(t.id, e)}
                          className="flex items-center gap-2 group cursor-pointer hover:bg-slate-100/80 px-1.5 py-1 rounded-lg transition-colors"
                          title="Click to select or update task progression"
                        >
                          <div className="bg-slate-100 rounded-full h-2 w-16 overflow-hidden border border-slate-200 group-hover:border-blue-400">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                progress === 100
                                  ? 'bg-emerald-500'
                                  : progress >= 50
                                  ? 'bg-blue-500'
                                  : 'bg-amber-500'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="font-bold text-[11px] text-slate-800 w-8 text-right underline decoration-dotted decoration-blue-400 group-hover:text-blue-600">
                            {progress}%
                          </span>
                        </button>
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.evaluationStatus === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : t.evaluationStatus === 'Reviewed'
                            ? 'bg-blue-100 text-blue-800'
                            : t.evaluationStatus === 'Revision'
                            ? 'bg-rose-100 text-rose-800'
                            : t.submittedAt || (t.status === 'Completed' && !t.evaluationStatus)
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : t.status === 'In Progress'
                            ? 'bg-blue-100 text-blue-800'
                            : t.status === 'Overdue'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {t.evaluationStatus
                          ? `${t.evaluationStatus}${t.score !== undefined ? ` (${t.score}%)` : ''}`
                          : t.submittedAt
                          ? 'Submitted'
                          : t.status}
                      </span>
                    </td>

                    {/* ALERT */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${alert.color}`}>
                        {alert.label}
                      </span>
                    </td>

                    {/* NOTE */}
                    <td className="py-3 px-3 text-slate-600 max-w-[220px]">
                      <div className="truncate text-slate-700 font-medium" title={note}>
                        {note}
                      </div>
                    </td>

                    {/* ACTIONS */}
                    <td className="py-3 px-3 text-right pr-4 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {showGrade && (t.submittedAt || t.status === 'Completed') && (
                          <button
                            type="button"
                            onClick={() => onOpenReviewModal(t)}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                            title="Review and grade this deliverable report"
                          >
                            <UserCheck className="w-3 h-3" /> Grade
                          </button>
                        )}
                        {isAssignee && !t.submittedAt && t.status !== 'Completed' && (
                          progress < 100 ? (
                            <button
                              type="button"
                              onClick={e => openProgressPopover(t.id, e)}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                              title="Update task progression (Must reach 100% to submit deliverable)"
                            >
                              <SlidersHorizontal className="w-3 h-3 text-amber-600" /> {progress}% (In Progress)
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenSubmitModal(t)}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer animate-pulse"
                              title="Task is 100% complete — click to submit deliverable report"
                            >
                              <FileCheck className="w-3 h-3" /> Submit
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => onSelectTask(t)}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                          title="View Full Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Task Card List */}
      <div className="md:hidden divide-y divide-slate-100">
        {filteredTasks.length === 0 ? (
          <div className="py-12 text-center text-slate-400 font-medium text-sm">
            No TRS tasks found matching your filters.
          </div>
        ) : (
          filteredTasks.map((t, idx) => {
            const code = getTaskCode(t, idx);
            const project = getTaskProject(t);
            const priority = getTaskPriority(t);
            const progress = getTaskProgress(t);
            const alert = getTaskAlert(t);
            const note = getTaskNote(t);
            const isSelected = validSelectedIds.has(t.id);

            const isSuperior = currentUser.role === 'admin' || t.assignedBy === currentUser.id;
            // Grading is offered from "Subordinate TRS Reports" only, and never for
            // a deliverable the superior has already approved.
            const showGrade = canGrade && isSuperior && t.evaluationStatus !== 'Approved';
            const isAssignee = t.assignedTo === currentUser.id;
            const isSubmitted = !!(t.submittedAt || t.status === 'Completed' || t.evaluationStatus);

            const priorityBadge =
              priority === 'Urgent'
                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                : priority === 'High'
                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                : priority === 'Medium'
                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                : 'bg-slate-100 text-slate-700 border border-slate-200';

            const statusLabel = t.evaluationStatus
              ? `${t.evaluationStatus}${t.score !== undefined ? ` (${t.score}%)` : ''}`
              : t.submittedAt
              ? 'Submitted'
              : t.status;

            const statusBadge =
              t.evaluationStatus === 'Approved'
                ? 'bg-emerald-100 text-emerald-800'
                : t.evaluationStatus === 'Reviewed'
                ? 'bg-blue-100 text-blue-800'
                : t.evaluationStatus === 'Revision'
                ? 'bg-rose-100 text-rose-800'
                : (t.submittedAt || (t.status === 'Completed' && !t.evaluationStatus))
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : t.status === 'In Progress'
                ? 'bg-blue-100 text-blue-800'
                : t.status === 'Overdue'
                ? 'bg-rose-100 text-rose-800'
                : 'bg-slate-100 text-slate-700';

            return (
              <div key={t.id} className={`p-4 transition-colors mb-[5px] ${isSelected ? 'bg-blue-50/70' : ''}`}>
                {/* Header row */}
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={e => handleToggleSelectRow(t.id, e)}
                    className="mt-0.5 text-slate-400 hover:text-blue-600 cursor-pointer shrink-0"
                    title={isSelected ? 'Deselect task' : 'Select task'}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectTask(t)}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-bold text-blue-600 text-[11px]">{code}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${priorityBadge}`}>
                        {priority}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${statusBadge}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <h4 className="mt-1 font-bold text-sm text-slate-900 leading-snug line-clamp-2">{t.title}</h4>
                    {t.description && (
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{t.description}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectTask(t)}
                    className="mt-0.5 p-1 text-slate-400 hover:text-blue-600 rounded-lg cursor-pointer transition-colors shrink-0"
                    title="View Full Details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>

                {/* Meta: project + assignee */}
                <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                    {project}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold flex items-center justify-center">
                      {t.assignedToName.charAt(0)}
                    </span>
                    {t.assignedToName}
                  </span>
                </div>

                {/* Start / Due */}
                <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Start</div>
                    <div className="font-medium text-slate-700 mt-0.5">{t.assignedDate || '—'}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Due</div>
                    <div className="font-bold text-slate-700 mt-0.5">{t.deadline}</div>
                  </div>
                </div>

                {/* Progress + alert */}
                <div className="mt-2.5" onClick={e => e.stopPropagation()}>
                  {isSubmitted ? (
                    <div className="flex items-center gap-2" title="Deliverable submitted (100% Complete)">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                        <div className="h-full rounded-full bg-emerald-500 w-full" />
                      </div>
                      <span className="font-bold text-[11px] text-emerald-700 shrink-0 flex items-center gap-0.5">
                        <Lock className="w-2.5 h-2.5 text-emerald-600" /> 100%
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border shrink-0 ${alert.color}`}>
                        {alert.label}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={e => openProgressPopover(t.id, e)}
                      className="w-full flex items-center gap-2 group cursor-pointer hover:bg-slate-100/70 px-1.5 py-1 rounded-lg transition-colors"
                      title="Click to select or update task progression"
                    >
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200 group-hover:border-blue-400">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            progress === 100
                              ? 'bg-emerald-500'
                              : progress >= 50
                              ? 'bg-blue-500'
                              : 'bg-amber-500'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="font-bold text-[11px] text-slate-800 underline decoration-dotted decoration-blue-400 group-hover:text-blue-600 shrink-0">
                        {progress}%
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border shrink-0 ${alert.color}`}>
                        {alert.label}
                      </span>
                    </button>
                  )}
                </div>

                {/* Note */}
                {note && note !== '—' && (
                  <p className="mt-2 text-[11px] text-slate-600 line-clamp-2">{note}</p>
                )}

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                  {showGrade && (t.submittedAt || t.status === 'Completed') && (
                    <button
                      type="button"
                      onClick={() => onOpenReviewModal(t)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                      title="Review and grade this deliverable report"
                    >
                      <UserCheck className="w-3 h-3" /> Grade
                    </button>
                  )}
                  {isAssignee && !t.submittedAt && t.status !== 'Completed' && (
                    progress < 100 ? (
                      <button
                        type="button"
                        onClick={e => openProgressPopover(t.id, e)}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                        title="Update task progression (Must reach 100% to submit deliverable)"
                      >
                        <SlidersHorizontal className="w-3 h-3 text-amber-600" /> {progress}% (In Progress)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenSubmitModal(t)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer animate-pulse"
                        title="Task is 100% complete — click to submit deliverable report"
                      >
                        <FileCheck className="w-3 h-3" /> Submit
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectTask(t)}
                    className="ml-auto px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                    title="View Full Details"
                  >
                    <Eye className="w-3 h-3" /> Details
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer info */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/80 flex flex-col md:flex-row md:items-center gap-2.5 md:gap-4 justify-between text-[11px] text-slate-500 font-medium">
        <div>
          Showing <strong>{filteredTasks.length}</strong> of <strong>{tasks.length}</strong> total TRS tasks
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> Completed / Approved
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" /> In Progress / Under Review
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" /> Overdue / Revision
          </span>
        </div>
      </div>

      {/* Task Progression Mini Dialog — anchored under the parent cell, fixed + top z-index so it's never clipped */}
      {popoverTask && popoverAnchor && (() => {
        const popoverTaskProgress = getTaskProgress(popoverTask);
        const width = 220;
        const top = popoverAnchor.y + 6;
        let left = popoverAnchor.x;
        if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
        if (left < 8) left = 8;
        return (
          <>
            {/* Invisible full-screen layer: catch outside clicks & close */}
            <div className="fixed inset-0 z-[9998]" onClick={closeProgressPopover} />
            <div
              className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-150"
              style={{ top, left, width, maxHeight: '80vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 border-b border-slate-100 pb-1">
                <span className="truncate pr-2">Task Progression</span>
                <span className="text-blue-600 font-extrabold shrink-0">{popoverTaskProgress}%</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[0, 25, 50, 75, 90, 100].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      if (onUpdateProgress) {
                        onUpdateProgress(popoverTask, pct);
                      }
                      closeProgressPopover();
                    }}
                    className={`py-1 px-1.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      popoverTaskProgress === pct
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="pt-1 border-t border-slate-100">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={popoverTaskProgress}
                  onChange={e => {
                    if (onUpdateProgress) {
                      onUpdateProgress(popoverTask, Number(e.target.value));
                    }
                  }}
                  className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                <span>100% required to submit</span>
                <button
                  type="button"
                  onClick={closeProgressPopover}
                  className="text-slate-600 hover:text-slate-900 font-bold"
                >
                  Done
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* In-App Bulk Delete Confirmation Modal (Reliable across all browsers and iframes) */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-50 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  Delete {deletableSelectedTasks.length} Delegated Task(s)?
                </h3>
                <p className="text-xs text-slate-500">
                  Permanently remove the selected subordinate TRS reports.
                </p>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl p-2 bg-slate-50/60">
              {deletableSelectedTasks.map(t => (
                <div key={t.id} className="py-1.5 px-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 truncate mr-2">{t.title}</span>
                  <span className="text-[10px] font-medium bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded shrink-0">
                    {t.assignedToName}
                  </span>
                </div>
              ))}
            </div>

            {protectedFromSuperiorCount > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>{protectedFromSuperiorCount} task(s)</strong> are outside your authority and cannot be deleted. Only tasks you delegated or tasks assigned to your subordinates will be deleted.
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onBulkDelete && deletableSelectedTasks.length > 0) {
                    onBulkDelete(deletableSelectedTasks.map(t => t.id));
                    setSelectedIds(new Set());
                  }
                  setShowBulkDeleteModal(false);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Confirm Delete ({deletableSelectedTasks.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
