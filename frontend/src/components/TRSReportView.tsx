import React, { useState, useEffect, useMemo } from 'react';
import { User, TRSTask, MultiProofData } from '../types';
import { SignatureImage } from './SignatureImage';
import { showDialog, confirmDialog } from './GlobalDialog';
import {
  getVisibleTRSTasksForUser,
  saveTRSTask,
  updateTRSTaskProgress,
  escalateTRSTask,
  getDepartments,
  subscribeOrgConfig,
  deleteTRSTask,
  getUsers,
  getSubordinateUserIds,
  getStaffActiveTaskCount,
  getSeniorSuperior,
  submitScoreDispute,
  resolveScoreDispute,
  calculateWorkingDaysElapsed,
  addTRSTaskComment,
  unlockTRSTask,
  lockTRSTask
} from '../services/storage';
import { getDaysDifferenceFromToday, calculateTimelinessScore } from '../services/deadlineAlertService';
import { MultiProofUploader } from './MultiProofUploader';
import {
  ListTodo,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Send,
  UserCheck,
  Building2,
  Calendar,
  Sparkles,
  Link,
  Award,
  Zap,
  Edit2,
  FileText,
  ExternalLink,
  ShieldCheck,
  CheckSquare,
  Upload,
  Check,
  Trash2,
  ShieldAlert,
  Filter,
  Search,
  X,
  User as UserIcon,
  Users,
  MessageSquare,
  Lock,
  RefreshCw,
  AlertTriangle,
  Table,
  CalendarDays,
  LayoutGrid,
  SlidersHorizontal,
  HelpCircle,
  ArrowLeft,
  CornerDownRight,
  RefreshCcw,
  History,
  Loader2,
  ChevronDown,
  Unlock
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';
import { TRSTrackingTable } from './TRSTrackingTable';
import { TRSTimelineView } from './TRSTimelineView';

interface TRSReportViewProps {
  currentUser: User;
}

export const TRSReportView: React.FC<TRSReportViewProps> = ({ currentUser }) => {
  const [tasks, setTasks] = useState<TRSTask[]>([]);
  const [activeTask, setActiveTask] = useState<TRSTask | null>(null);
  const [detailModalSource, setDetailModalSource] = useState<'table' | 'timeline' | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'timeline'>('table');
  const [trsSubTab, setTrsSubTab] = useState<'my_tasks' | 'subordinate_tasks'>('my_tasks');
  const [isAssigning, setIsAssigning] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'submitted' | 'mine'>('all');
  const [subordinateStaffFilter, setSubordinateStaffFilter] = useState<string>('all');
  const [subordinateStatusFilter, setSubordinateStatusFilter] = useState<string>('all');
  const [subordinateSearchQuery, setSubordinateSearchQuery] = useState<string>('');

  // Staff Remark State
  const [staffRemarkText, setStaffRemarkText] = useState('');

  // Deliverable Submission Modal State
  const [isSubmittingDeliverable, setIsSubmittingDeliverable] = useState(false);
  const [deliverableSaving, setDeliverableSaving] = useState(false);
  const [deliverableNotes, setDeliverableNotes] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [taskMultiProof, setTaskMultiProof] = useState<MultiProofData>({ files: [], cloudLinks: [], telegramLinks: [] });
  const [signatureName, setSignatureName] = useState('');
  const [delayReason, setDelayReason] = useState('');

  // TRS Task Comment Thread State
  const [newCommentText, setNewCommentText] = useState('');
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Mobile View Toggle State
  const [showMobileDetail, setShowMobileDetail] = useState(false);

  // Manager/Admin Administrative Unlock (Auto-Locked / Defaulted TRS Task) State
  const [unlockTargetTask, setUnlockTargetTask] = useState<TRSTask | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockWaivePenalty, setUnlockWaivePenalty] = useState(false);
  const [unlockSaving, setUnlockSaving] = useState(false);

  // Opens the Cards & Detail panel as a full-screen overlay without permanently redirecting away.
  // detailModalSource remembers which sub-view we came from so we can restore it on close.
  const openTaskDetailModal = (task: TRSTask, source: 'table' | 'timeline') => {
    setActiveTask(task);
    setShowMobileDetail(true);
    setDetailModalSource(source);
    setViewMode('cards');
  };

  const closeTaskDetailModal = () => {
    if (detailModalSource) {
      setViewMode(detailModalSource);
      setDetailModalSource(null);
    }
  };

  // Superior Review & Grade Modal State (2-Factor Scoring Model: Timeliness 40% + Quality 60%)
  const [isReviewingModal, setIsReviewingModal] = useState(false);
  const [reviewTimelinessScore, setReviewTimelinessScore] = useState<number>(40);
  const [reviewInstructionScore, setReviewInstructionScore] = useState<number>(20);
  const [reviewScopeScore, setReviewScopeScore] = useState<number>(20);
  const [reviewAccuracyScore, setReviewAccuracyScore] = useState<number>(20);
  const [reviewWaiveLatePenalty, setReviewWaiveLatePenalty] = useState<boolean>(false);
  const [reviewModalStatus, setReviewModalStatus] = useState<'Approved' | 'Reviewed' | 'Revision'>('Approved');
  const [reviewModalFeedback, setReviewModalFeedback] = useState<string>('');

  // New task form state (with 3 superior criteria)
  const [taskTitle, setTaskTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskInstructions, setTaskInstructions] = useState('');
  const [taskScope, setTaskScope] = useState('');
  const [taskQualityCriteria, setTaskQualityCriteria] = useState('');
  const [taskProject, setTaskProject] = useState('');
  const [isCustomProject, setIsCustomProject] = useState(false);
  const [taskPriority, setTaskPriority] = useState<'Urgent' | 'High' | 'Medium' | 'Low'>('Medium');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [taskToDeleteId, setTaskToDeleteId] = useState<string | null>(null);
  const [showCriteria, setShowCriteria] = useState<boolean>(true);

  // Score Dispute State
  const [isDisputing, setIsDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [isResolvingDispute, setIsResolvingDispute] = useState(false);
  const [disputeDecision, setDisputeDecision] = useState<'accept' | 'reject'>('accept');
  const [disputeResolutionNote, setDisputeResolutionNote] = useState('');
  const [disputeRevisedScore, setDisputeRevisedScore] = useState<number>(85);

  const allUsers = getUsers();
  const subIds = getSubordinateUserIds(currentUser.id);
  const hasSubordinates = subIds.size > 0;
  // Creating and delegating a TRS task is open to every authenticated staff
  // member — there is no assignTRSTasks feature flag. The backend still limits
  // who you may delegate TO to your own reporting chain (or self).
  const canAssignTRS = true;
  // Direct reports only (e.g., Mr. EK is the direct superior of Mr. PSP): the
  // administrative unlock / manual lock authority is the assignee's DIRECT superior.
  const directSubIds = new Set(allUsers.filter(u => u.superiorId === currentUser.id).map(u => u.id));
  // May the current user manage (edit/delete) a TRS task? Two cases:
  //  - Self-assigned ("New TRS Task (Self-Assign)"): assigned_by === assigned_to ===
  //    the owner. The record is theirs, so Edit/Delete are shown in
  //    "TRS Assigned to me".
  //  - Assigned from a superior: only the delegating superior, any
  //    manager/executive/HR, and the assignee's (direct or indirect) superior may
  //    edit/delete. The assignee keeps only their own actions: Task Progression,
  //    remarks, and the deliverable submission.
  const canManageTask = (t: TRSTask): boolean => {
    // Approved & Completed is the final grade: the record is locked, so Edit
    // and Delete are hidden once evaluationStatus is 'Approved'.
    if (t.evaluationStatus === 'Approved') return false;
    // Owner of a self-assigned task manages it.
    if (t.assignedTo === currentUser.id) return t.assignedBy === t.assignedTo;
    return ['admin', 'executive', 'hr'].includes(currentUser.role) ||
      t.assignedBy === currentUser.id ||
      subIds.has(t.assignedTo);
  };
  // Only the assignee's DIRECT superior (reporting line) may administratively
  // unlock an auto-locked (defaulted) TRS task — no blanket manager/admin access,
  // and not the assigner themselves if they are not the assignee's superior.
  const canUnlockTask = (t: TRSTask): boolean =>
    directSubIds.has(t.assignedTo);
  // A task is eligible for manual "Lock Staff" when the assignee's direct superior
  // is viewing it, it is not already defaulted, not submitted/completed, and it is
  // either past its deadline (the auto-lock engine may not have caught it yet / was
  // unlocked) or was previously administratively unlocked.
  const canLockStaff = (t: TRSTask): boolean => {
    if (!canUnlockTask(t) || t.isDefaulted || t.submittedAt) return false;
    if (['Completed', 'Approved'].includes(t.status)) return false;
    const pastDeadline = !!t.deadline && getDaysDifferenceFromToday(t.deadline) < 0;
    const wasPreviouslyUnlocked = !!(t.unlockHistory && t.unlockHistory.length > 0);
    return pastDeadline || wasPreviouslyUnlocked;
  };
  // Show the "Subordinate TRS Reports" sub-tab whenever the user can delegate tasks,
  // even if the org-chart has no direct reports recorded for them. Only the generic
  // "admin" account (username === 'admin') is excluded — role-based admins like the
  // GM keep the team delegation view.
  const showSubTabs = (hasSubordinates || canAssignTRS) && currentUser.username !== 'admin';

  // Direct reports only (e.g., Mr. SN has exactly 6): used to populate the
  // "Assign to Staff Member" list and the "Subordinate TRS Reports" sub-tab so
  // superiors only see their own team.
  const subordinateVisibleTasks = tasks.filter(t => directSubIds.has(t.assignedTo));

  // Staff can assign tasks to themselves or superiors can assign to their direct
  // subordinates. Only the generic super-admin account (username === 'admin')
  // keeps the full staff list; everyone else (including role-based admins and
  // executives like the GM) only sees their direct team.
  const assignableStaff = allUsers.filter(u => {
    // Current user can always select themselves
    if (u.id === currentUser.id) return true;
    // Generic super-admin account only
    if (currentUser.username === 'admin' && currentUser.role === 'admin') return true;
    // Direct subordinates only
    return directSubIds.has(u.id);
  });

  // Pre-computed option lists (avoids .filter/.map inside JSX {} parsing issues)
  const staffOptions = assignableStaff.filter(u => u.id !== currentUser.id).map(u => ({
    value: u.id,
    label: u.name
  }));

  const loadTasks = (preserveActiveTaskId?: string) => {
    let list = getVisibleTRSTasksForUser(currentUser);

    // Auto-heal tasks where progress and status are out of sync from previous manual selection
    list = list.map(t => {
      if (t.isDefaulted || t.status === 'Defaulted') return t;
      const p = t.progress !== undefined ? t.progress : (t.status === 'Completed' ? 100 : (t.status === 'In Progress' ? 50 : 0));
      let targetStatus: TRSTask['status'] = t.status;
      if (p >= 100 && t.status !== 'Completed' && t.evaluationStatus !== 'Revision') {
        targetStatus = 'Completed';
      } else if (p === 0 && t.status === 'Completed' && !t.submittedAt) {
        targetStatus = 'Pending';
      } else if (p > 0 && p < 100 && t.status === 'Pending') {
        targetStatus = 'In Progress';
      }

      if (targetStatus !== t.status || t.progress === undefined) {
        const repaired: TRSTask = {
          ...t,
          progress: p,
          status: targetStatus,
          completionDate: targetStatus === 'Completed' ? (t.completionDate || new Date().toISOString().split('T')[0]) : t.completionDate
        };
        saveTRSTask(repaired, currentUser, 'update');
        return repaired;
      }
      return t;
    });

    setTasks(list);

    const subTasks = list.filter(t => directSubIds.has(t.assignedTo));
    const myTasks = list.filter(t => t.assignedTo === currentUser.id);

    setActiveTask(prev => {
      const targetId = preserveActiveTaskId || prev?.id;
      if (targetId) {
        const found = list.find(t => t.id === targetId);
        if (found) {
          const inScope = trsSubTab === 'subordinate_tasks'
            ? directSubIds.has(found.assignedTo)
            : found.assignedTo === currentUser.id;
          if (inScope) return found;
        }
      }
      return trsSubTab === 'subordinate_tasks'
        ? (subTasks[0] || null)
        : (myTasks[0] || null);
    });
  };

  useEffect(() => {
    loadTasks();
  }, [currentUser]);

  useEffect(() => {
    setStaffRemarkText(activeTask?.staffRemarks || '');
  }, [activeTask?.id]);

  // Filter tasks based on selected tab
  const filteredTasks = tasks.filter(t => {
    if (filterTab === 'submitted') {
      return !!(t.submittedAt || t.submissionNotes || t.proofUrl || t.status === 'Completed');
    }
    if (filterTab === 'mine') {
      return t.assignedTo === currentUser.id;
    }
    return true;
  });

  // Everyone gets the full delegate/create form; the assignee list is scoped to
  // self + reporting chain (see the backend hierarchy check on POST /trs).

  /**
   * Department / Project Stream options are database-backed: they come from the
   * admin-managed org_config master list (kind='department', active rows) via
   * getDepartments(), replacing the previously hardcoded set. subscribeOrgConfig
   * re-renders the dropdown when an admin adds/renames/deactivates a department.
   * A value already on the task is merged in at render time so legacy free-text
   * entries are never silently dropped.
   */
  const [deptVersion, setDeptVersion] = useState(0);
  useEffect(() => subscribeOrgConfig(() => setDeptVersion(v => v + 1)), []);

  const departmentOptions = useMemo(() => getDepartments(), [deptVersion]);

  const handleStartCreateTask = () => {
    setEditingTaskId(null);
    setTaskTitle('');
    // Default to the first index in the assignee list (yourself, rendered first)
    // on first init. The list is [self, ...direct reports].
    setAssigneeId(currentUser.id);
    setTaskDesc('');
    setTaskInstructions('');
    setTaskScope('');
    setTaskQualityCriteria('');
    setTaskProject(currentUser.department || 'Operations');
    setIsCustomProject(false);
    setTaskPriority('Medium');
    setDeadlineDate(new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0]);
    setIsAssigning(true);
  };

  const handleStartEditTask = (t: TRSTask) => {
    // Supervisors only — the assignee may not edit task details, not even on a
    // self-assigned task where they are also the creator.
    if (!canManageTask(t)) {
      showDialog('Only a superior (the task creator, an Admin, or the assignee\'s superior) can edit task details.');
      return;
    }
    setEditingTaskId(t.id);
    setTaskTitle(t.title);
    setAssigneeId(t.assignedTo);
    setTaskDesc(t.description || '');
    setTaskInstructions(t.instructions || '');
    setTaskScope(t.scope || '');
    setTaskQualityCriteria(t.qualityCriteria || '');
    setTaskProject(t.project || t.department || 'Operations');
    setIsCustomProject(false);
    setTaskPriority(t.priority || 'Medium');
    setDeadlineDate(t.deadline);
    setIsAssigning(true);
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !assigneeId || !deadlineDate) {
      showDialog('Please fill out all required fields (Task title, Assignee, Deadline).');
      return;
    }

    const isSelfAssignment = assigneeId === currentUser.id;
    const assignedUser = isSelfAssignment ? currentUser : (allUsers.find(u => u.id === assigneeId) || currentUser);
    const existingTask = tasks.find(t => t.id === editingTaskId);

    // Generate Option B code if not present (TRS-[StaffInitials]-[001])
    let taskCode = existingTask?.code;
    if (!taskCode || taskCode.match(/^TRS-0\d\d$/)) {
      const staffName = assignedUser ? assignedUser.name : 'Staff';
      const parts = staffName.trim().split(/\s+/).filter(Boolean);
      const initials = parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : staffName.slice(0, 2).toUpperCase();
      const staffTasks = tasks.filter(t => t.assignedTo === assigneeId);
      const count = staffTasks.length + 1;
      taskCode = `TRS-${initials}-${count.toString().padStart(3, '0')}`;
    }

    const savedTask: TRSTask = {
      id: editingTaskId || `trs_${Date.now()}`,
      title: taskTitle.trim(),
      code: taskCode,
      project: (taskProject.trim() || assignedUser?.department || 'Operations'),
      priority: taskPriority || 'Medium',
      progress: existingTask?.progress ?? 0,
      assignedBy: existingTask ? existingTask.assignedBy : currentUser.id,
      assignedByName: existingTask ? existingTask.assignedByName : currentUser.name,
      assignedTo: assigneeId,
      assignedToName: assignedUser ? assignedUser.name : currentUser.name,
      department: assignedUser ? assignedUser.department : currentUser.department,
      description: taskDesc.trim() || taskScope.trim() || taskInstructions.trim() || 'Direct task requested in TRS',
      instructions: taskInstructions.trim(),
      scope: taskScope.trim(),
      qualityCriteria: taskQualityCriteria.trim(),
      assignedDate: existingTask ? existingTask.assignedDate : new Date().toISOString().split('T')[0],
      deadline: deadlineDate,
      status: existingTask ? existingTask.status : 'Pending',
      score: existingTask ? existingTask.score : undefined,
      timelinessScore: existingTask?.timelinessScore,
      qualityScore: existingTask?.qualityScore,
      instructionScore: existingTask?.instructionScore,
      scopeScore: existingTask?.scopeScore,
      accuracyScore: existingTask?.accuracyScore,
      feedback: existingTask ? existingTask.feedback : undefined,
      submissionNotes: existingTask?.submissionNotes,
      proofUrl: existingTask?.proofUrl,
      submittedAt: existingTask?.submittedAt,
      signature: existingTask?.signature
    };

    // Create/edit of task metadata only — never a submission or a grade. A brand
    // new task still hits POST /trs (idx === -1) inside saveTRSTask.
    saveTRSTask(savedTask, currentUser, 'update');
    setFeedbackMsg(
      editingTaskId
        ? `TRS Report "${savedTask.title}" updated successfully!`
        : isSelfAssignment
        ? `TRS Report created and assigned to yourself (${taskCode})!`
        : `TRS Report delegated to ${savedTask.assignedToName} (${taskCode}) successfully!`
    );
    setIsAssigning(false);
    setEditingTaskId(null);
    setTaskTitle('');
    setTaskDesc('');
    setTaskInstructions('');
    setTaskScope('');
    setTaskQualityCriteria('');
    setDeadlineDate('');
    loadTasks();
    setActiveTask(savedTask);
    if (!isSelfAssignment && currentUser.username !== 'admin') {
      setTrsSubTab('subordinate_tasks');
      setSubordinateStaffFilter('all');
      setSubordinateStatusFilter('all');
      setSubordinateSearchQuery('');
    }

    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleBulkDelete = (taskIds: string[]) => {
    let deletedCount = 0;
    let deniedCount = 0;
    taskIds.forEach(id => {
      const res = deleteTRSTask(id, currentUser);
      if (res.success) {
        deletedCount++;
      } else {
        deniedCount++;
      }
    });
    const list = getVisibleTRSTasksForUser(currentUser);
    setTasks(list);
    if (activeTask && taskIds.includes(activeTask.id)) {
      const scopeList = trsSubTab === 'subordinate_tasks'
        ? list.filter(t => directSubIds.has(t.assignedTo))
        : list.filter(t => t.assignedTo === currentUser.id);
      setActiveTask(scopeList[0] || null);
    }
    if (deletedCount > 0 && deniedCount === 0) {
      setFeedbackMsg(`Successfully deleted ${deletedCount} TRS report(s).`);
    } else if (deletedCount > 0 && deniedCount > 0) {
      setFeedbackMsg(`Deleted ${deletedCount} report(s). ${deniedCount} superior task(s) were protected from deletion.`);
    } else if (deniedCount > 0) {
      setFeedbackMsg(`Permission Denied: Staff cannot delete tasks delegated by superiors.`);
    }
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleBulkMarkCompleted = (taskIds: string[]) => {
    taskIds.forEach(id => {
      const task = tasks.find(t => t.id === id);
      if (task) {
        saveTRSTask({
          ...task,
          status: 'Completed',
          progress: 100,
          completionDate: new Date().toISOString().split('T')[0]
        }, currentUser, 'update');
      }
    });
    const list = getVisibleTRSTasksForUser(currentUser);
    setTasks(list);
    setFeedbackMsg(`Marked ${taskIds.length} TRS report(s) as Completed.`);
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleDeleteTask = (taskId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setTaskToDeleteId(taskId);
  };

  const confirmDeleteTask = () => {
    if (!taskToDeleteId) return;
    const res = deleteTRSTask(taskToDeleteId, currentUser);
    if (!res.success) {
      setFeedbackMsg(res.error || 'Permission Denied: Staff cannot delete tasks delegated by superiors.');
      setTaskToDeleteId(null);
      setTimeout(() => setFeedbackMsg(''), 4000);
      return;
    }

    const list = getVisibleTRSTasksForUser(currentUser);
    setTasks(list);

    const subTasks = list.filter(t => directSubIds.has(t.assignedTo));
    const myTasks = list.filter(t => t.assignedTo === currentUser.id);

    if (trsSubTab === 'subordinate_tasks') {
      setActiveTask(subTasks[0] || null);
    } else {
      setActiveTask(myTasks[0] || null);
    }

    setTaskToDeleteId(null);
    setFeedbackMsg('TRS Report deleted successfully.');
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleUpdateStatus = (status: 'Pending' | 'In Progress' | 'Completed') => {
    if (!activeTask) return;
    const targetProg = status === 'Completed' ? 100 : status === 'Pending' ? 0 : (activeTask.progress && activeTask.progress > 0 && activeTask.progress < 100 ? activeTask.progress : 50);
    handleUpdateProgress(activeTask, targetProg);
  };

  const handleDirectUpdateStatus = (task: TRSTask, newStatus: TRSTask['status']) => {
    const targetProg = newStatus === 'Completed' ? 100 : newStatus === 'Pending' ? 0 : (task.progress && task.progress > 0 && task.progress < 100 ? task.progress : 50);
    handleUpdateProgress(task, targetProg);
  };

  const handleUpdateProgress = async (task: TRSTask, newProgress: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(newProgress)));

    // 100% means "work done, awaiting submission" — NOT Completed. Status flips to
    // Completed only via POST /trs/:code/submit, which refuses to run on a task that
    // is already Completed. Marking it Completed here would both hide the Submit
    // button and make the real submission fail with "Task already completed".
    let newStatus: TRSTask['status'] = 'In Progress';
    let compDate = task.completionDate;

    if (clamped === 0) {
      newStatus = 'Pending';
      compDate = undefined;
    } else if (clamped < 100) {
      newStatus = 'In Progress';
      if (task.status === 'Completed') {
        compDate = undefined;
      }
    }

    const updated: TRSTask = {
      ...task,
      progress: clamped,
      status: newStatus,
      completionDate: compDate
    };

    try {
      await updateTRSTaskProgress(task.id, clamped);
      await loadTasks(task.id);
      setActiveTask(updated);
      setFeedbackMsg(
        clamped === 100
          ? 'Progression reached 100% — submit your deliverable report to finalise.'
          : `Progression updated to ${clamped}% → Status set to "${newStatus}".`
      );
    } catch (e: any) {
      setFeedbackMsg(`Could not update progression: ${e?.message || 'request failed'}`);
    }
    setTimeout(() => setFeedbackMsg(''), 3500);
  };

  const handleSaveStaffRemark = () => {
    if (!activeTask) return;
    const updated: TRSTask = {
      ...activeTask,
      staffRemarks: staffRemarkText.trim()
    };
    saveTRSTask(updated, currentUser, 'update');
    setActiveTask(updated);
    loadTasks();
    setFeedbackMsg('Staff remarks & progress notes saved successfully.');
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  const handleUpdateScore = (score: number, feedback: string) => {
    if (!activeTask) return;
    const updated: TRSTask = {
      ...activeTask,
      score,
      feedback
    };
    saveTRSTask(updated, currentUser, 'evaluate');
    setActiveTask(updated);
    loadTasks();
  };

  // Superior Review & Grade Modal Handlers (2-Factor Scoring Model)
  const handleOpenReviewModal = (t: TRSTask) => {
    setActiveTask(t);
    const timelinessData = calculateTimelinessScore(t.deadline, t.submittedAt || new Date().toISOString());
    setReviewTimelinessScore(t.timelinessScore !== undefined ? t.timelinessScore : timelinessData.score);
    setReviewWaiveLatePenalty(t.latePenaltyWaived || false);
    setReviewInstructionScore(t.instructionScore !== undefined ? t.instructionScore : 20);
    setReviewScopeScore(t.scopeScore !== undefined ? t.scopeScore : 20);
    setReviewAccuracyScore(t.accuracyScore !== undefined ? t.accuracyScore : 20);
    setReviewModalFeedback(t.feedback || '');
    setReviewModalStatus(t.evaluationStatus || (t.status === 'Completed' ? 'Approved' : 'Reviewed'));
    setIsReviewingModal(true);
  };

  const handleSaveReviewModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;

    const effectiveTimeliness = reviewWaiveLatePenalty ? 40 : reviewTimelinessScore;
    const qualityTotal = reviewInstructionScore + reviewScopeScore + reviewAccuracyScore;
    const totalScore = Math.min(100, Math.max(0, effectiveTimeliness + qualityTotal));

    // Mandatory Feedback on Low Quality Score (< 70% of 60 pts, i.e. < 42 pts)
    if (qualityTotal < 42 && (!reviewModalFeedback || reviewModalFeedback.trim().length < 10)) {
      showDialog('Mandatory Justification Required: When Deliverable Quality is graded below 70% (<42/60 points), you must provide detailed constructive feedback and guidance for improvement.');
      return;
    }

    // TRS Revision Cap (PolicyModal tab 3, "Maximum 2 Revision Cycles"). Both
    // cycles are spent, so no third cycle is opened: the task is locked for final
    // grading as-is and escalated to a senior superior via POST /trs/:code/escalate.
    // Previously this fabricated the escalation into local task state and pushed it
    // through the grade payload, which never persisted those columns and would now
    // be rejected by the server-side cap.
    if (reviewModalStatus === 'Revision') {
      const currentRevisions = activeTask.revisionCount || 0;
      if (currentRevisions >= 2) {
        const seniorSuperior = getSeniorSuperior(currentUser.id);
        const escalationReason = `Maximum 2 revision cycles exceeded. Superior review remarks: ${reviewModalFeedback.trim() || 'No remarks provided.'}`;
        setIsReviewingModal(false);
        setFeedbackMsg('Revision limit (2) reached. Task escalated for final decision.');
        escalateTRSTask(
          activeTask.id,
          seniorSuperior ? seniorSuperior.id : activeTask.escalatedTo || '',
          seniorSuperior ? seniorSuperior.name : activeTask.escalatedToName || 'Senior Management',
          escalationReason
        )
          .then(() => loadTasks())
          .catch((err: any) => {
            showDialog(err?.message || 'Failed to escalate this task.');
            loadTasks();
          });
        return;
      }
    }

    let newStatus: TRSTask['status'] = activeTask.status;
    let newProgress = activeTask.progress || 100;
    if (reviewModalStatus === 'Approved' || reviewModalStatus === 'Reviewed') {
      newStatus = 'Completed';
      newProgress = 100;
    } else if (reviewModalStatus === 'Revision') {
      newStatus = 'In Progress';
      newProgress = 75; // Set back to 75% so staff must rework and reach 100% to resubmit
    }

    const updated: TRSTask = {
      ...activeTask,
      status: newStatus,
      progress: newProgress,
      evaluationStatus: reviewModalStatus,
      evaluationDate: new Date().toISOString(),
      evaluatedBy: currentUser.id,
      timelinessScore: reviewTimelinessScore,
      qualityScore: qualityTotal,
      instructionScore: reviewInstructionScore,
      scopeScore: reviewScopeScore,
      accuracyScore: reviewAccuracyScore,
      latePenaltyWaived: reviewWaiveLatePenalty,
      score: totalScore,
      feedback: reviewModalFeedback.trim(),
      revisionCount: reviewModalStatus === 'Revision' ? (activeTask.revisionCount || 0) + 1 : activeTask.revisionCount
    };

    saveTRSTask(updated, currentUser, 'evaluate');
    setActiveTask(updated);
    setIsReviewingModal(false);
    loadTasks();
    setFeedbackMsg(`TRS Report evaluated successfully (Score: ${totalScore}% - ${reviewModalStatus}).`);
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  // Dispute Handlers for TRS Tasks
  const handleOpenDispute = (task: TRSTask) => {
    setActiveTask(task);
    setDisputeReason('');
    setIsDisputing(true);
  };

  const handleSubmitDispute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;
    if (!disputeReason.trim()) {
      showDialog('Please provide a valid rationale for your score dispute.');
      return;
    }

    const res = submitScoreDispute('trs', activeTask.id, disputeReason.trim(), currentUser);
    if (res.success) {
      setFeedbackMsg(res.message);
      setIsDisputing(false);
      loadTasks();
      const updatedList = getVisibleTRSTasksForUser(currentUser);
      const updated = updatedList.find(t => t.id === activeTask.id);
      if (updated) setActiveTask(updated);
    } else {
      showDialog(res.message);
    }
  };

  const handleOpenResolveDispute = (task: TRSTask) => {
    setActiveTask(task);
    setDisputeDecision('accept');
    setDisputeResolutionNote('');
    setDisputeRevisedScore(task.score ?? 85);
    setIsResolvingDispute(true);
  };

  const handleSaveResolveDispute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;
    if (!disputeResolutionNote.trim()) {
      showDialog('Please provide superior notes explaining the dispute decision.');
      return;
    }

    const res = resolveScoreDispute(
      'trs',
      activeTask.id,
      disputeDecision,
      disputeResolutionNote.trim(),
      disputeDecision === 'accept' ? disputeRevisedScore : undefined,
      currentUser
    );

    if (res.success) {
      setFeedbackMsg(res.message);
      setIsResolvingDispute(false);
      loadTasks();
      const updatedList = getVisibleTRSTasksForUser(currentUser);
      const updated = updatedList.find(t => t.id === activeTask.id);
      if (updated) setActiveTask(updated);
    } else {
      showDialog(res.message);
    }
  };

  const handlePostComment = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTask || !newCommentText.trim()) return;
    setIsPostingComment(true);
    const res = addTRSTaskComment(activeTask.id, newCommentText.trim(), currentUser, replyToCommentId || undefined);
    if (res.success && res.task) {
      setActiveTask(res.task);
      loadTasks();
      setNewCommentText('');
      setReplyToCommentId(null);
      setFeedbackMsg('Comment posted successfully!');
      setTimeout(() => setFeedbackMsg(''), 3000);
    }
    setIsPostingComment(false);
  };

  // Deliverable Report Submission
  const handleOpenSubmitModal = (t: TRSTask) => {
    if (t.isDefaulted) {
      showDialog('This task is auto-locked at 0% (7+ days past deadline). A superior administrative unlock is required before you can submit the deliverable.');
      return;
    }
    setActiveTask(t);
    setDeliverableNotes(t.submissionNotes || t.staffRemarks || '');
    setProofUrl(t.proofUrl || '');
    setTaskMultiProof(t.multiProof || {
      files: [],
      cloudLinks: t.proofUrl ? [{ id: 'orig_1', type: 'cloud_link', name: 'Deliverable Link', url: t.proofUrl, uploadedAt: t.submittedAt || new Date().toISOString() }] : [],
      telegramLinks: []
    });
    setSignatureName(t.signature?.dataUrl || currentUser.name);
    setDelayReason(t.delayReason || '');
    setIsSubmittingDeliverable(true);
  };

  const handleSaveDeliverable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deliverableSaving) return;
    if (!activeTask) return;

    if ((activeTask.progress || 0) < 100) {
      showDialog('Task progression must reach 100% before submitting your deliverable report. Please update your progression to 100% first.');
      return;
    }

    if (!deliverableNotes.trim()) {
      showDialog('Please enter deliverable notes / accomplishment summary.');
      return;
    }

    const nowIso = new Date().toISOString();
    const compDate = nowIso.split('T')[0];
    const timeliness = calculateTimelinessScore(activeTask.deadline, nowIso);

    if (timeliness.isLate && !delayReason.trim()) {
      showDialog('This submission is past the deadline. Please provide a reason/explanation for the delay for your superior to review.');
      return;
    }

    // Determine primary proofUrl for backwards-compatibility
    const fallbackProofUrl = taskMultiProof.cloudLinks?.[0]?.url ||
      taskMultiProof.files?.[0]?.url ||
      taskMultiProof.telegramLinks?.[0]?.url ||
      proofUrl.trim();

    const updated: TRSTask = {
      ...activeTask,
      progress: 100,
      status: 'Completed',
      completionDate: compDate,
      timelinessScore: timeliness.score,
      delayReason: timeliness.isLate ? delayReason.trim() : undefined,
      submissionNotes: deliverableNotes.trim(),
      proofUrl: fallbackProofUrl,
      multiProof: taskMultiProof,
      submittedAt: nowIso,
      evaluationStatus: undefined, // Pending superior quality evaluation
      score: undefined, // Cleared until superior evaluates!
      qualityScore: undefined,
      instructionScore: undefined,
      scopeScore: undefined,
      accuracyScore: undefined,
      feedback: timeliness.isLate
        ? `Submitted late (${timeliness.daysLate}d overdue). Timeliness: ${timeliness.score}/40 pts. Delay explanation submitted for superior evaluation.`
        : `Submitted on time. Timeliness: 40/40 pts. Pending superior quality review.`,
      signature: {
        type: 'digital_type',
        dataUrl: signatureName.trim() || currentUser.name,
        signedAt: nowIso,
        signeeName: signatureName.trim() || currentUser.name
      }
    };

    setDeliverableSaving(true);
    try {
    setActiveTask(updated);
    await saveTRSTask(updated, currentUser, 'submit');
    setIsSubmittingDeliverable(false);
    loadTasks();
    setFeedbackMsg(
      !timeliness.isLate
        ? `TRS Report Deliverable submitted on time! Timeliness score (40/40 pts) awarded. Pending superior quality evaluation.`
        : `TRS Report Deliverable submitted (Late). Reason recorded for superior review.`
    );

    setTimeout(() => setFeedbackMsg(''), 4000);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to submit the deliverable. Please try again.');
    } finally {
      setDeliverableSaving(false);
    }
  };

  // Manager/Admin Administrative Unlock for Auto-Locked (Defaulted) TRS Task
  const handleSaveUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockTargetTask) return;
    if (!unlockReason.trim()) {
      showDialog('Mandatory audit justification is required to unlock the task.');
      return;
    }

    setUnlockSaving(true);
    try {
      await unlockTRSTask(unlockTargetTask.id, unlockReason.trim(), unlockWaivePenalty);
      setUnlockTargetTask(null);
      setUnlockReason('');
      setUnlockWaivePenalty(false);
      loadTasks();
      setFeedbackMsg(`Successfully unlocked "${unlockTargetTask.title}" for ${unlockTargetTask.assignedToName}. Staff can now submit the deliverable.`);
      setTimeout(() => setFeedbackMsg(''), 4500);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to unlock the task. Please try again.');
    } finally {
      setUnlockSaving(false);
    }
  };

  // Assigning superior manually re-locks a previously-unlocked task at 0%.
  const handleLockAgain = async (t: TRSTask) => {
    if (!(await confirmDialog(`Re-lock task "${t.title}" for ${t.assignedToName} at 0%? Staff will need a new superior administrative unlock before they can submit the deliverable again.`, { title: 'Lock Staff Again', confirmText: 'Re-lock at 0%' }))) return;
    try {
      await lockTRSTask(t.id);
      loadTasks();
      setFeedbackMsg(`Task "${t.title}" locked at 0% for ${t.assignedToName}. Staff must obtain a new superior unlock to submit.`);
      setTimeout(() => setFeedbackMsg(''), 4500);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to re-lock the task. Please try again.');
    }
  };

  useEffect(() => {
    if (!unlockTargetTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUnlockTargetTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unlockTargetTask]);

  return (
    <div className="p-2 space-y-4">
      {/* TRS Scoring Model Policy Banner - Standardized Display Matching T&R Rubric */}
      {feedbackMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {feedbackMsg}
        </div>
      )}

      {/* Primary View Switcher (Table / Cards / Timeline) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="md:hidden grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border shadow-xs ${
              viewMode === 'table'
                ? 'bg-white text-blue-700 border-blue-200 shadow-sm'
                : 'bg-white/70 text-slate-600 hover:text-slate-900 border-slate-200'
            }`}
          >
            <Table className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">Tracking Table</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-black shrink-0">
              {trsSubTab === 'subordinate_tasks'
                ? subordinateVisibleTasks.length
                : tasks.filter(t => t.assignedTo === currentUser.id).length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border shadow-xs ${
              viewMode === 'cards'
                ? 'bg-white text-blue-700 border-blue-200 shadow-sm'
                : 'bg-white/70 text-slate-600 hover:text-slate-900 border-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">Cards &amp; Detail</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`col-span-2 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border shadow-xs ${
              viewMode === 'timeline'
                ? 'bg-white text-blue-700 border-blue-200 shadow-sm'
                : 'bg-white/70 text-slate-600 hover:text-slate-900 border-slate-200'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">Timeline View</span>
          </button>
        </div>

        <div className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'table'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Table className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">Tracking Table</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 font-black shrink-0">
              {trsSubTab === 'subordinate_tasks'
                ? subordinateVisibleTasks.length
                : tasks.filter(t => t.assignedTo === currentUser.id).length}
            </span>
          </button>

          <button
            onClick={() => setViewMode('cards')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'cards'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">Cards &amp; Detail</span>
          </button>

          <button
            onClick={() => setViewMode('timeline')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'timeline'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">Timeline View</span>
          </button>
        </div>

        <button
          onClick={handleStartCreateTask}
          className="w-full sm:w-auto justify-center px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer self-end sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Delegate / Create TRS Task
        </button>
      </div>

      {/* Sub-tabs: My Assigned Reports vs Subordinate Reports & Delegation */}
      {showSubTabs ? (
        <>
          {/* Desktop Tabs */}
          <div className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              onClick={() => {
                setTrsSubTab('my_tasks');
                setIsAssigning(false);
                const myTs = tasks.filter(t => t.assignedTo === currentUser.id);
                setActiveTask(myTs[0] || null);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                trsSubTab === 'my_tasks'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserIcon className="w-4 h-4 text-blue-600 shrink-0" />
              <span>My TRS tasks (From Superior)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 font-black">
                {tasks.filter(t => t.assignedTo === currentUser.id).length}
              </span>
            </button>
            <button
              onClick={() => {
                setTrsSubTab('subordinate_tasks');
                setIsAssigning(false);
                const subTs = subordinateVisibleTasks;
                setActiveTask(subTs[0] || null);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                trsSubTab === 'subordinate_tasks'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Subordinate TRS Reports</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 font-black">
                {subordinateVisibleTasks.length}
              </span>
              {subordinateVisibleTasks.filter(t => t.submittedAt && t.status !== 'Completed').length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 font-black">
                  {subordinateVisibleTasks.filter(t => t.submittedAt && t.status !== 'Completed').length} Review
                </span>
              )}
            </button>
          </div>

          {/* Mobile Select */}
          <div className="md:hidden bg-slate-100 p-1.5 rounded-2xl mb-[5px]">
            <div className="relative">
              {trsSubTab === 'my_tasks' ? (
                <UserIcon className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              ) : (
                <Users className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              )}
              <ModernSelect
                value={trsSubTab}
                onChange={e => {
                  const v = e.target.value;
                  if (v === 'my_tasks') {
                    setTrsSubTab('my_tasks');
                    setIsAssigning(false);
                    const myTs = tasks.filter(t => t.assignedTo === currentUser.id);
                    setActiveTask(myTs[0] || null);
                  } else {
                    setTrsSubTab('subordinate_tasks');
                    setIsAssigning(false);
                    const subTs = subordinateVisibleTasks;
                    setActiveTask(subTs[0] || null);
                  }
                }}
                className="w-full appearance-none pl-9 pr-8 py-1.5 rounded-xl text-xs font-bold text-slate-800 bg-white border border-slate-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="my_tasks">
                  1. My TRS tasks (From Superior) ({tasks.filter(t => t.assignedTo === currentUser.id).length})
                </option>
                <option value="subordinate_tasks">
                  2. Subordinate TRS Reports ({subordinateVisibleTasks.length})
                  {subordinateVisibleTasks.filter(t => t.submittedAt && t.status !== 'Completed').length > 0
                    ? ` (${subordinateVisibleTasks.filter(t => t.submittedAt && t.status !== 'Completed').length} Review)`
                    : ''}
                </option>
              </ModernSelect>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs flex items-center justify-between gap-2 text-xs font-bold text-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <UserIcon className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate">My TRS tasks (From Superior)</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
              {tasks.filter(t => t.assignedTo === currentUser.id).length} Task(s)
            </span>
            <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-1 rounded-lg font-medium whitespace-nowrap">
              Officer / Direct Subordinate View
            </span>
          </div>
        </div>
      )}

      {/* View Mode 1: Tracking Table */}
      {viewMode === 'table' && (
        <TRSTrackingTable
          tasks={
            trsSubTab === 'subordinate_tasks'
              ? subordinateVisibleTasks
              : tasks.filter(t => t.assignedTo === currentUser.id)
          }
          currentUser={currentUser}
          allUsers={allUsers}
          onSelectTask={task => {
            openTaskDetailModal(task, 'table');
          }}
          onOpenReviewModal={task => handleOpenReviewModal(task)}
          onOpenSubmitModal={task => handleOpenSubmitModal(task)}
          onUpdateStatus={(task, newStatus) => handleDirectUpdateStatus(task, newStatus)}
          onUpdateProgress={(task, newProg) => handleUpdateProgress(task, newProg)}
          onBulkDelete={handleBulkDelete}
          canGrade={trsSubTab === 'subordinate_tasks'}
        />
      )}

      {/* View Mode 2: Timeline View */}
      {viewMode === 'timeline' && (
        <TRSTimelineView
          tasks={
            trsSubTab === 'subordinate_tasks'
              ? subordinateVisibleTasks
              : tasks.filter(t => t.assignedTo === currentUser.id)
          }
          currentUser={currentUser}
          onSelectTask={task => {
            openTaskDetailModal(task, 'timeline');
          }}
        />
      )}

      {/* View Mode 3: Cards & Detail Grid Content (becomes a full-screen overlay when opened from table/timeline) */}
      {viewMode === 'cards' && (
      <div
        onClick={() => { if (detailModalSource) closeTaskDetailModal(); }}
        className={`${detailModalSource
          ? 'fixed inset-0 z-40 min-h-screen overflow-y-auto overscroll-contain bg-slate-900/85 backdrop-blur-xs p-3 sm:p-6'
          : ''} grid grid-cols-1 lg:grid-cols-12 gap-6`}
      >
        
        {/* Left Sidebar Report List */}
        <div className={`${detailModalSource ? 'hidden' : showMobileDetail ? 'hidden lg:block' : 'block'} lg:col-span-4 space-y-3`}
          onClick={(e) => e.stopPropagation()}>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                {trsSubTab === 'my_tasks' ? (
                  <>
                    <UserIcon className="w-4 h-4 text-blue-600" />
                    TRS Assigned to me
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4 text-amber-600" />
                    Subordinate TRS Reports
                  </>
                )}
              </h3>
              {trsSubTab === 'subordinate_tasks' && (
                <button
                  onClick={handleStartCreateTask}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Delegate
                </button>
              )}
            </div>

            {/* Subordinate Staff Filter for Superiors */}
            {trsSubTab === 'subordinate_tasks' && (() => {
              const subTasksList = subordinateVisibleTasks;
              const staffMap = new Map<string, { id: string; name: string; count: number }>();
              subTasksList.forEach(t => {
                const existing = staffMap.get(t.assignedTo);
                if (existing) {
                  existing.count += 1;
                } else {
                  staffMap.set(t.assignedTo, {
                    id: t.assignedTo,
                    name: t.assignedToName,
                    count: 1
                  });
                }
              });
              const staffOptions = Array.from(staffMap.values());

              return (
                <div className="space-y-2 mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Filter className="w-3 h-3 text-blue-600" /> Filter by Staff
                      </span>
                      {subordinateStaffFilter !== 'all' && (
                        <button
                          type="button"
                          onClick={() => setSubordinateStaffFilter('all')}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                        >
                          Show All
                        </button>
                      )}
                    </label>
                    <ModernSelect
                      value={subordinateStaffFilter}
                      onChange={e => {
                        const sId = e.target.value;
                        setSubordinateStaffFilter(sId);
                        if (sId !== 'all') {
                          const matched = subTasksList.find(t => t.assignedTo === sId);
                          if (matched) {
                            setActiveTask(matched);
                            setIsAssigning(false);
                          }
                        }
                      }}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 shadow-2xs"
                    >
                      <option value="all">👥 All Staff Reports ({subTasksList.length} total)</option>
                      {staffOptions.map(st => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.count} {st.count === 1 ? 'report' : 'reports'})
                        </option>
                      ))}
                    </ModernSelect>
                  </div>

                  {/* Search and Status Filter (Matches T&R design) */}
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={subordinateSearchQuery}
                        onChange={e => setSubordinateSearchQuery(e.target.value)}
                        placeholder="Search report title, staff..."
                        className="w-full pl-7 pr-6 py-1 text-[11px] bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                      />
                      {subordinateSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setSubordinateSearchQuery('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <ModernSelect
                      value={subordinateStatusFilter}
                      onChange={e => setSubordinateStatusFilter(e.target.value)}
                      className="px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white font-medium text-slate-700 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Status</option>
                      <option value="Approved">Approved</option>
                      <option value="Reviewed">Reviewed</option>
                      <option value="Submitted">Submitted</option>
                      <option value="Revision">Needs Revision</option>
                      <option value="Pending">Pending</option>
                    </ModernSelect>
                  </div>
                </div>
              );
            })()}

            {/* Filter Tabs */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl mb-3 text-xs">
              <button
                onClick={() => setFilterTab('all')}
                className={`flex-1 py-1 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                  filterTab === 'all' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterTab('submitted')}
                className={`flex-1 py-1 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                  filterTab === 'submitted' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Submitted
              </button>
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {(() => {
                const subTasksList = tasks.filter(t =>
                  trsSubTab === 'my_tasks'
                    ? t.assignedTo === currentUser.id
                    : directSubIds.has(t.assignedTo)
                );

                let finalTasksList = subTasksList.filter(t => {
                  if (filterTab === 'submitted') {
                    return !!(t.submittedAt || t.submissionNotes || t.proofUrl || t.status === 'Completed' || t.evaluationStatus);
                  }
                  return true;
                });

                if (trsSubTab === 'subordinate_tasks') {
                  if (subordinateStaffFilter !== 'all') {
                    finalTasksList = finalTasksList.filter(t => t.assignedTo === subordinateStaffFilter);
                  }
                  if (subordinateStatusFilter !== 'all') {
                    finalTasksList = finalTasksList.filter(t => {
                      if (subordinateStatusFilter === 'Approved') {
                        return t.evaluationStatus === 'Approved';
                      }
                      if (subordinateStatusFilter === 'Reviewed') {
                        return t.evaluationStatus === 'Reviewed';
                      }
                      if (subordinateStatusFilter === 'Revision') {
                        return t.evaluationStatus === 'Revision';
                      }
                      if (subordinateStatusFilter === 'Submitted') {
                        return !!(t.submittedAt || t.submissionNotes || t.proofUrl) && !t.evaluationStatus;
                      }
                      if (subordinateStatusFilter === 'Pending') {
                        return t.status === 'Pending' && !t.submittedAt && !t.submissionNotes;
                      }
                      return true;
                    });
                  }
                  if (subordinateSearchQuery.trim()) {
                    const q = subordinateSearchQuery.toLowerCase();
                    finalTasksList = finalTasksList.filter(t =>
                      t.title.toLowerCase().includes(q) ||
                      t.assignedToName.toLowerCase().includes(q) ||
                      (t.description && t.description.toLowerCase().includes(q))
                    );
                  }
                }

                if (finalTasksList.length === 0) {
                  return (
                    <div className="text-center py-10 px-4 text-slate-400 text-xs space-y-2">
                      <ListTodo className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="font-medium">
                        {trsSubTab === 'my_tasks'
                          ? 'No TRS reports assigned to you by your superior yet.'
                          : (subordinateStaffFilter !== 'all' || subordinateStatusFilter !== 'all' || subordinateSearchQuery)
                          ? 'No TRS reports match the selected filters.'
                          : 'No TRS reports delegated yet.'}
                      </p>
                      {trsSubTab === 'subordinate_tasks' && (subordinateStaffFilter !== 'all' || subordinateStatusFilter !== 'all' || subordinateSearchQuery) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubordinateStaffFilter('all');
                            setSubordinateStatusFilter('all');
                            setSubordinateSearchQuery('');
                          }}
                          className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" /> Reset Filters
                        </button>
                      )}
                      {trsSubTab === 'subordinate_tasks' && !(subordinateStaffFilter !== 'all' || subordinateStatusFilter !== 'all' || subordinateSearchQuery) && (
                        <button
                          onClick={handleStartCreateTask}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 mt-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Delegate New TRS Report
                        </button>
                      )}
                    </div>
                  );
                }

                return finalTasksList.map(t => {
                  const hasSubmitted = !!(t.submittedAt || t.submissionNotes || t.proofUrl);
                  const isEvaluated = !!(t.evaluationStatus && t.score !== undefined);
                  const displayStatus = t.evaluationStatus
                    ? t.evaluationStatus
                    : hasSubmitted
                    ? 'Pending Review'
                    : t.status;
                  const canDeleteThis =
                    canManageTask(t);

                  // Find staff user for position display if available
                  const staffUser = allUsers.find(u => u.id === t.assignedTo);
                  const staffPosition = staffUser?.position || t.department;

                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        setActiveTask(t);
                        setIsAssigning(false);
                        setShowMobileDetail(true);
                      }}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer relative group ${
                        activeTask?.id === t.id && !isAssigning
                          ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-xs font-bold text-slate-900 truncate pr-2">
                          {trsSubTab === 'subordinate_tasks' ? t.assignedToName : t.title}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Score / Status Badge (Aligned with Tracking Table) */}
                          {t.isDefaulted ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-2xs animate-pulse">
                              Auto-Locked 0%
                            </span>
                          ) : isEvaluated ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                t.score === 100
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (t.score ?? 0) >= 70
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              Score: {t.score}%
                            </span>
                          ) : hasSubmitted ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                              Score: Pending
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                              {t.progress || 0}%
                            </span>
                          )}
                          {canDeleteThis && (
                            <button
                              onClick={(e) => handleDeleteTask(t.id, e)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                              title="Delete TRS Report"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Second Row: Context / Position and Status Badge */}
                      <div className="text-[11px] text-slate-500 flex items-center justify-between mt-0.5">
                        <span className="truncate pr-2">
                          {trsSubTab === 'subordinate_tasks' ? (
                            <>
                              <span className="font-semibold text-slate-700">{t.title}</span> • {staffPosition}
                            </>
                          ) : (
                            `From: ${t.assignedByName} • ${t.department}`
                          )}
                        </span>
                        <span
                          className={`capitalize font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                            displayStatus === 'Approved'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : displayStatus === 'Reviewed'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : displayStatus === 'Revision'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : hasSubmitted
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : displayStatus === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {hasSubmitted && !isEvaluated ? 'Awaiting Grade' : displayStatus}
                        </span>
                      </div>

                      {/* Deadline & Submitted Footer */}
                      <div className="text-[10px] text-slate-400 flex items-center justify-between mt-1 pt-1 border-t border-slate-100">
                        <span className="flex items-center gap-1 font-medium text-slate-600">
                          <Clock className="w-3 h-3 text-slate-400" /> Deadline: {t.deadline}
                        </span>
                        {hasSubmitted && (
                          <span className="text-emerald-700 font-bold flex items-center gap-0.5 text-[10px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Submitted
                          </span>
                        )}
                      </div>

                      {/* Deadline Countdown/Alert Badge */}
                      {t.deadline && !hasSubmitted && t.status !== 'Completed' && (() => {
                        const days = getDaysDifferenceFromToday(t.deadline);
                        if (days < 0) {
                          return (
                            <div className="mt-1.5 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-extrabold flex items-center gap-1 border border-rose-200">
                              <AlertTriangle className="w-3 h-3 text-rose-600 animate-pulse" />
                              <span>Overdue by {Math.abs(days)} {Math.abs(days) === 1 ? 'day' : 'days'}!</span>
                            </div>
                          );
                        }
                        if (days === 0) {
                          return (
                            <div className="mt-1.5 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-extrabold flex items-center gap-1 border border-amber-300">
                              <Clock className="w-3 h-3 text-amber-700 animate-bounce" />
                              <span>DUE TODAY!</span>
                            </div>
                          );
                        }
                        if (days === 1) {
                          return (
                            <div className="mt-1.5 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[10px] font-bold flex items-center gap-1 border border-amber-200">
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span>Due tomorrow (1 day left)</span>
                            </div>
                          );
                        }
                        if (days <= 5) {
                          return (
                            <div className="mt-1.5 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 text-[10px] font-bold flex items-center gap-1 border border-blue-200">
                              <Clock className="w-3 h-3 text-blue-600" />
                              <span>Due in {days} days</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {/* TRS Report Details / Creation / Submission */}
        <div className={`${detailModalSource ? 'block lg:col-span-12 w-full max-w-[800px] mx-auto' : `${!showMobileDetail ? 'hidden lg:block' : 'block'} lg:col-span-8`}`}
          onClick={(e) => e.stopPropagation()}>
          {activeTask ? (() => {
            const isTaskSubmitted = !!activeTask.submittedAt;
            const isAssignedStaff = activeTask.assignedTo === currentUser.id;
            const isSuperior = activeTask.assignedBy === currentUser.id || currentUser.role === 'admin' || currentUser.role === 'executive' || currentUser.role === 'hr';
            const isStaffViewOnly = isTaskSubmitted && isAssignedStaff && !isSuperior;
            // Once a submitted deliverable has been approved, the grade is final:
            // the superior is not offered Review / Grade again. Note that approval
            // lives in evaluationStatus — trs_tasks.status is an ENUM that has no
            // 'Approved' member (it stays 'Completed').
            const isGradedApproved = activeTask.evaluationStatus === 'Approved';

            return (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {!detailModalSource && (
                    <button
                      type="button"
                      onClick={() => setShowMobileDetail(false)}
                      className="lg:hidden inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-blue-700 mb-2 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back to TRS List
                    </button>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-base text-slate-900">{activeTask.title}</h3>
                    {isStaffViewOnly && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md font-bold">
                        <Lock className="w-3 h-3" /> Submitted • View Only
                      </span>
                    )}
                    {activeTask.isDefaulted && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-rose-600 text-white border border-rose-700 px-2 py-0.5 rounded-md font-black animate-pulse">
                        <Lock className="w-3 h-3" /> Auto-Locked 0%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Assigned By: <strong className="text-slate-800">{activeTask.assignedByName}</strong> → Assigned To:{' '}
                    <strong className="text-slate-800">{activeTask.assignedToName}</strong>
                  </p>
                </div>

                {detailModalSource && (
                  <button
                    type="button"
                    onClick={closeTaskDetailModal}
                    className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-700 text-lg font-bold transition-all cursor-pointer self-start"
                    title={`Close detail view and return to ${detailModalSource === 'table' ? 'Tracking Table' : 'Timeline View'}`}
                  >
                    ×
                  </button>
                )}
                </div>

                <div className="flex flex-col items-stretch gap-2 pt-3">
                  {/* If viewing Subordinate Reports as a Superior. No permission
                      check — the Subordinate TRS Reports tab is already scoped to
                      your own team, and the endpoint enforces the same hierarchy. */}
                  {trsSubTab === 'subordinate_tasks' ? (
                    isGradedApproved ? (
                      <span className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="sm:hidden">Approved</span>
                        <span className="hidden sm:inline">Approved &amp; Completed (Final Grade)</span>
                      </span>
                    ) : isTaskSubmitted ? (
                      <button
                        onClick={() => handleOpenReviewModal(activeTask)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer justify-center sm:flex-none"
                        title="Review subordinate's submitted deliverable and assign grade/score"
                      >
                        <UserCheck className="w-3.5 h-3.5 shrink-0" /> Review / Grade Report
                      </button>
                    ) : activeTask.isDefaulted ? (
                      <span className="px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-2xs animate-pulse">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        <span className="sm:hidden">Auto-Locked 0%</span>
                        <span className="hidden sm:inline">Auto-Locked 0% (7+ Days Overdue)</span>
                      </span>
                    ) : (
                      <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse shrink-0" />
                        <span className="sm:hidden">Waiting for Submission</span>
                        <span className="hidden sm:inline">Waiting for Subordinate Submission</span>
                      </span>
                    )
                  ) : (
                    /* If viewing My Tasks as Assigned Staff: Single unified status pill */
                    isStaffViewOnly ? (
                      <div className="flex items-center gap-1.5 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 shadow-2xs">
                        <Lock className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-slate-500 font-normal">Status:</span>
                        {activeTask.evaluationStatus ? (
                          <span className={`font-extrabold ${
                            activeTask.evaluationStatus === 'Approved'
                              ? 'text-emerald-700'
                              : activeTask.evaluationStatus === 'Reviewed'
                              ? 'text-blue-700'
                              : 'text-rose-700'
                          }`}>
                            Evaluated • {activeTask.evaluationStatus}
                          </span>
                        ) : (
                          <span className="text-amber-800 font-bold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-600" /> Awaiting Superior Grade
                          </span>
                        )}
                      </div>
                    ) : null
                  )}

                  {/* Superior Manual Lock Staff Button: shown on unlocked tasks past their
                      deadline (auto-lock engine may not have caught them yet) or on tasks a
                      superior previously unlocked — not limited to already-unlocked staff. */}
                  {canLockStaff(activeTask) && (
                    <button
                      type="button"
                      onClick={() => handleLockAgain(activeTask)}
                      className="px-3.5 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer justify-center sm:flex-none"
                      title="Lock this task at 0%. Staff must obtain a new superior administrative unlock before they can submit deliverables."
                    >
                      <Lock className="w-3.5 h-3.5 shrink-0" /> Lock Staff
                    </button>
                  )}

                  {/* Bottom action row: Status + Edit + Delete (below the warning badge) */}
                  {(!isStaffViewOnly || currentUser.id === activeTask.assignedBy) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Status: Automatically connected with Task Progression below */}
                      {!isStaffViewOnly && (
                        <div
                          className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-start"
                          title="Task status is automatically connected to execution progression (0% = Pending, 1–99% = In Progress, 100% = Completed)"
                        >
                          <span className="text-xs text-slate-500 font-medium">Status:</span>
                          {activeTask.isDefaulted ? (
                            <span className="px-3 py-1.5 bg-rose-600 text-white border border-rose-700 rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-2xs animate-pulse">
                              <Lock className="w-3.5 h-3.5" />
                              Defaulted • 0%
                            </span>
                          ) : activeTask.status === 'Completed' || (activeTask.progress || 0) === 100 ? (
                            <span className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 shadow-2xs">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Completed
                            </span>
                          ) : (activeTask.progress || 0) > 0 ? (
                            <span className="px-3 py-1.5 bg-blue-50 text-blue-800 border border-blue-300 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 shadow-2xs">
                              <Clock className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                              In Progress
                            </span>
                          ) : (
                            <span className="px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs">
                              <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
                              Pending
                            </span>
                          )}
                        </div>
                      )}

                      {canManageTask(activeTask) && (
                        <button
                          onClick={() => handleStartEditTask(activeTask)}
                          className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold flex items-center gap-1 border border-blue-200 transition-all shadow-xs cursor-pointer justify-center flex-1 sm:flex-none"
                          title="Edit TRS report details or reassignment"
                        >
                          <Edit2 className="w-3.5 h-3.5 shrink-0" /> Edit Report
                        </button>
                      )}

                      {canManageTask(activeTask) && (
                        <button
                          onClick={(e) => handleDeleteTask(activeTask.id, e)}
                          className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-1 border border-rose-200 transition-all shadow-xs cursor-pointer justify-center flex-1 sm:flex-none"
                          title="Delete this assigned TRS report"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Notice Banner */}
              {isStaffViewOnly ? (
                <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-emerald-950 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-700 shrink-0" />
                    <div>
                      <span className="font-bold text-emerald-950">TRS Deliverable Submitted &amp; Locked:</span>
                      <span className="text-emerald-900/90 ml-1.5">Preserved in view-only mode for superior evaluation ({activeTask.assignedByName}).</span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full font-bold shrink-0">
                    Official Record
                  </span>
                </div>
              ) : (
                activeTask.assignedBy !== currentUser.id && currentUser.role !== 'admin' && (
                  <div className="bg-amber-50/90 border border-amber-200 rounded-xl px-3.5 py-2 text-xs text-amber-900 flex items-center gap-2.5 shadow-2xs">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <strong className="font-bold text-amber-950">Superior Assignment:</strong>
                      <span className="ml-1 text-amber-900/90">
                        Directives set by <strong>{activeTask.assignedByName}</strong>. Update progress remarks and submit deliverable report when complete.
                      </span>
                    </div>
                  </div>
                )
              )}

              {/* Auto-Lock & Default Status Warning Banner for TRS Tasks (7-day overdue rule) */}
              {activeTask.isDefaulted && (
                <div className="bg-rose-50 border-2 border-rose-400 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-rose-200 text-rose-800 rounded-xl shrink-0 mt-0.5">
                      <Lock className="w-5 h-5 text-rose-800" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="font-black text-sm text-rose-950">
                          Accountability Auto-Lock: Score Defaulted to 0%
                        </strong>
                        <span className="px-2 py-0.5 bg-rose-200 text-rose-900 rounded-md font-extrabold text-[10px]">
                          7+ Days Past Task Deadline ({activeTask.deadline})
                        </span>
                      </div>
                      <p className="text-xs text-rose-900 mt-1 leading-relaxed">
                        This task deliverable was not submitted within 7 calendar days of the assigned deadline and has automatically defaulted to a 0% score.
                        <strong> Staff is still required to complete and deliver their work!</strong>
                        Only your direct assigning superior can administratively unlock this task with a recorded audit justification.
                      </p>
                      {activeTask.defaultedAt && (
                        <span className="text-[10px] text-rose-700 font-mono mt-1 block">
                          Defaulted at: {new Date(activeTask.defaultedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {canUnlockTask(activeTask) && (
                    <button
                      type="button"
                      onClick={() => {
                        setUnlockTargetTask(activeTask);
                        setUnlockReason('');
                        setUnlockWaivePenalty(false);
                      }}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0 transition-transform active:scale-95"
                    >
                      <Unlock className="w-4 h-4" /> Manager Unlock &amp; Waive
                    </button>
                  )}
                </div>
              )}

              {/* Administrative Unlock Audit History (Transparency) */}
              {activeTask.unlockHistory && activeTask.unlockHistory.length > 0 && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 text-amber-900 font-bold text-[11px] uppercase tracking-wider">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                    Administrative Unlock Audit Trail ({activeTask.unlockHistory.length} Event{activeTask.unlockHistory.length > 1 ? 's' : ''})
                  </div>
                  <div className="space-y-1 divide-y divide-amber-100">
                    {activeTask.unlockHistory.map((audit) => (
                      <div key={audit.unlockedAt + (audit.unlockedBy || '')} className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-700 gap-1">
                        <span>
                          Unlocked by <strong>{audit.unlockedByName}</strong> on {new Date(audit.unlockedAt).toLocaleDateString()}: <em>"{audit.reason}"</em>
                        </span>
                        {audit.waiveLatePenalty && (
                          <span className="text-emerald-700 font-bold bg-emerald-100 px-1.5 py-0.5 rounded text-[10px] shrink-0 self-start sm:self-auto">
                            Late Penalty Waived
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="block text-slate-400 font-bold uppercase text-[10px]">Assigned Date</span>
                  <span className="font-semibold text-slate-800">{activeTask.assignedDate}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-bold uppercase text-[10px]">Deadline</span>
                  <span className="font-bold text-rose-600 flex items-center gap-1">
                    {activeTask.deadline}
                  </span>
                  {activeTask.deadline && !isTaskSubmitted && activeTask.status !== 'Completed' && (() => {
                    const days = getDaysDifferenceFromToday(activeTask.deadline);
                    if (days < 0) {
                      return (
                        <span className="text-[10px] text-rose-600 font-extrabold block">
                          Overdue by {Math.abs(days)}d
                        </span>
                      );
                    }
                    if (days === 0) {
                      return (
                        <span className="text-[10px] text-amber-600 font-extrabold block">
                          Due today!
                        </span>
                      );
                    }
                    if (days === 1) {
                      return (
                        <span className="text-[10px] text-amber-700 font-bold block">
                          Due tomorrow (1d)
                        </span>
                      );
                    }
                    return (
                      <span className="text-[10px] text-blue-600 font-bold block">
                        {days} days remaining
                      </span>
                    );
                  })()}
                </div>
                <div>
                  <span className="block text-slate-400 font-bold uppercase text-[10px]">Department</span>
                  <span className="font-semibold text-slate-800">{activeTask.department}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-bold uppercase text-[10px]">Evaluation Score & Status</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {activeTask.isDefaulted ? (
                      <>
                        <span className="font-black text-sm text-rose-600">0%</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-rose-600 text-white shadow-2xs">
                          Auto-Locked
                        </span>
                      </>
                    ) : activeTask.evaluationStatus && activeTask.score !== undefined ? (
                      <>
                        <span className={`font-black text-sm ${
                          activeTask.score >= 90
                            ? 'text-emerald-600'
                            : activeTask.score >= 70
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}>
                          {activeTask.score}%
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          activeTask.evaluationStatus === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : activeTask.evaluationStatus === 'Reviewed'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {activeTask.evaluationStatus}
                        </span>
                      </>
                    ) : isTaskSubmitted ? (
                      <>
                        <span className="text-[11px] font-bold text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" /> Awaiting Superior Grade
                        </span>
                        <span className="text-[10px] text-slate-500 font-semibold">
                          (Timeliness: {activeTask.timelinessScore ?? 40}/40 • Quality: Pending)
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-slate-500 text-xs italic">
                          In Execution
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          {activeTask.progress || 0}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Superior 3 Criteria: Instructions, Scope, Quality Standards (Simplified Modern Card) */}
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-blue-600" /> Superior Task Directives &amp; Criteria (3 Pillars)
                  </h4>
                  {activeTask.code && (
                    <span className="font-mono text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md">
                      {activeTask.code}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-0.5">
                  <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/80 space-y-1">
                    <span className="text-[11px] font-bold text-blue-900 flex items-center gap-1">📋 1. Instruction</span>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {activeTask.instructions || activeTask.description || 'Follow standard operating guidance and directives.'}
                    </p>
                  </div>
                  <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/80 space-y-1">
                    <span className="text-[11px] font-bold text-indigo-900 flex items-center gap-1">🎯 2. Scope</span>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {activeTask.scope || 'Deliverables and operational boundaries as discussed.'}
                    </p>
                  </div>
                  <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-200/80 space-y-1">
                    <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">⭐ 3. Quality Standards</span>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {activeTask.qualityCriteria || 'High accuracy, complete documentation, and superior alignment.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* TRS Escalation Level Badge & Revision Monitor */}
              {(() => {
                const escalationLevel = activeTask.escalationLevel as string | undefined;
                const isEscalatedToSeniorMgmt =
                  escalationLevel === 'senior_management' ||
                  ((activeTask.revisionCount || 0) >= 3 && escalationLevel === 'escalated');

                return (
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600" /> Escalation Monitor
                      </h4>
                      <div className="flex items-center gap-1.5">
                        {escalationLevel === 'escalated' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">🚨 Escalated Level</span>
                        ) : escalationLevel === 'reminded' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">⏱️ Reminded Level</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">✅ None</span>
                        )}
                        {(activeTask.revisionCount || 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                            Revision Cycle: {activeTask.revisionCount} of 2
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Banner A: Manager Reminded */}
                    {escalationLevel === 'manager_reminded' && (
                      <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-300 rounded-xl">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-900 font-medium">
                          {activeTask.escalatedToName || 'Your superior'} was reminded about their pending review of this deliverable. If no action is taken promptly, it will automatically escalate to senior management.
                        </p>
                      </div>
                    )}

                    {/* Banner B: Escalated to Senior Superior */}
                    {escalationLevel === 'senior_escalated' && (
                      <div className="flex items-start gap-2 p-2.5 bg-orange-50 border border-orange-300 rounded-xl">
                        <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-orange-900 font-medium">
                          This deliverable has been escalated to <strong>{activeTask.escalatedToName || 'Senior Superior'}</strong> for review. Awaiting their decision.
                        </p>
                      </div>
                    )}

                    {/* Banner C: Escalated to Senior Management */}
                    {isEscalatedToSeniorMgmt && (
                      <div className="flex items-start gap-2 p-2.5 bg-rose-50 border border-rose-300 rounded-xl">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-rose-900 font-medium">
                          <strong>Escalated to Senior Management:</strong> {activeTask.escalatedReason || 'This report requires executive determination.'}
                        </p>
                      </div>
                    )}

                    {/* Banner D: Review Revision Cycle warning */}
                    {!isEscalatedToSeniorMgmt && (activeTask.revisionCount || 0) > 0 && (
                      <div className="flex items-start gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                        <RefreshCcw className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-slate-700 font-medium">
                          This report is on <strong>Revision Cycle {activeTask.revisionCount} of 2</strong>. Per TRS guidelines, only <strong>2 revision cycles</strong> are allowed per task. A 3rd attempt automatically escalates to senior management.
                        </p>
                      </div>
                    )}

                    {/* Escalation detail (escalatedToName / reason / timestamp) */}
                    {activeTask.escalatedToName && (
                      <div className="p-2.5 bg-rose-50/60 border border-rose-200 rounded-xl text-xs space-y-1">
                        <span className="font-bold text-rose-900 block">Escalated To: {activeTask.escalatedToName}</span>
                        {activeTask.escalatedReason && (
                          <p className="text-rose-800"><strong>Reason:</strong> {activeTask.escalatedReason}</p>
                        )}
                        {activeTask.escalatedAt && (
                          <span className="text-[10px] text-slate-500 font-semibold block">
                            At: {new Date(activeTask.escalatedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Revision History */}
                    {activeTask.revisionHistory && activeTask.revisionHistory.length > 0 && (
                      <div className="space-y-1.5 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          <History className="w-3 h-3 text-slate-500" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Revision History</span>
                        </div>
                        {activeTask.revisionHistory.map((rev, i) => (
                          <div key={i} className="p-2 rounded-lg border border-amber-100 bg-amber-50/50 space-y-0.5">
                            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500">
                              <span>Cycle {rev.count} • Requested by {rev.requestedByName || rev.requestedBy || 'Superior'}</span>
                              <span>{rev.date ? new Date(rev.date).toLocaleString() : ''}</span>
                            </div>
                            <p className="text-[11px] text-slate-700 italic">"{rev.feedback}"</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Task Progression & Submission Gate */}
              {isTaskSubmitted ? (
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs shadow-2xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="font-bold text-emerald-950">Execution Progression: 100% Complete</span>
                    <span className="text-[10px] bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full font-bold">Submitted</span>
                  </div>
                  <span className="text-[11px] text-slate-500 italic">
                    Deliverable report submitted on {new Date(activeTask.submittedAt || activeTask.completionDate || Date.now()).toLocaleDateString()}
                  </span>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                        <SlidersHorizontal className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">
                          Task Progression &amp; Submission Gate
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Track execution progression. Deliverable report can only be officially submitted when done 100%.
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-black ${
                      (activeTask.progress || 0) === 100 ? 'text-emerald-600' : 'text-blue-600'
                    }`}>
                      {activeTask.progress || 0}%
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden border border-slate-300">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        (activeTask.progress || 0) === 100
                          ? 'bg-emerald-500'
                          : (activeTask.progress || 0) >= 50
                          ? 'bg-blue-600'
                          : 'bg-amber-500'
                      }`}
                      style={{ width: `${activeTask.progress || 0}%` }}
                    />
                  </div>

                  {!isTaskSubmitted && (activeTask.assignedTo === currentUser.id || activeTask.assignedBy === currentUser.id || currentUser.role === 'admin') ? (
                    <div className="space-y-3 pt-1">
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-700">Quick Select Progression:</span>
                          <span className="text-[10px] text-slate-400 font-medium">(Syncs status automatically)</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[0, 25, 50, 75, 90, 100].map(pct => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => handleUpdateProgress(activeTask, pct)}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                (activeTask.progress || 0) === pct
                                  ? pct === 100
                                    ? 'bg-emerald-600 text-white shadow-xs scale-105 ring-2 ring-emerald-300'
                                    : pct === 0
                                    ? 'bg-slate-700 text-white shadow-xs scale-105 ring-2 ring-slate-300'
                                    : 'bg-blue-600 text-white shadow-xs scale-105 ring-2 ring-blue-300'
                                  : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                              }`}
                            >
                              {pct}%{pct === 100 ? ' • Completed' : pct === 0 ? ' • Pending' : ''}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-500 shrink-0 font-medium">Fine adjustment:</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={activeTask.progress || 0}
                          onChange={e => handleUpdateProgress(activeTask, Number(e.target.value))}
                          className="w-full accent-blue-600 cursor-pointer h-2 bg-slate-200 rounded-lg"
                        />
                      </div>

                      {(activeTask.progress || 0) < 100 ? (
                        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center gap-2">
                          <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                          <span>
                            <strong>Currently In Progress ({activeTask.progress || 0}%):</strong> Status is automatically set to <strong>In Progress</strong>. Staff can update progression anytime so superiors see live progress. Selecting <strong>100%</strong> will automatically change status to <strong>Completed</strong> and unlock deliverable submission.
                          </span>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>
                            <strong>100% Reached!</strong> Progression benchmark met. Your status becomes <strong>Completed</strong> only once you submit your deliverable report below.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Superior Score & Feedback Panel */}
              {(() => {
                const isSuperiorEvaluator =
                  currentUser.role === 'admin' ||
                  activeTask.assignedBy === currentUser.id ||
                  (trsSubTab === 'subordinate_tasks' && activeTask.assignedTo !== currentUser.id);
                const canEvaluateTask =
                  (activeTask.assignedBy === currentUser.id && currentUser.role !== 'staff') ||
                  (trsSubTab === 'subordinate_tasks' && activeTask.assignedTo !== currentUser.id);

                const isCompleted = activeTask.status === 'Completed';
                const compDate = activeTask.completionDate || (activeTask.submittedAt ? activeTask.submittedAt.split('T')[0] : '');
                const isLate = isCompleted && compDate > activeTask.deadline;
                // PolicyModal tab 3 "TRS Task Timeliness Deduction Schedule" is a
                // 5-step 0-40 band schedule (40/30/20/10/0), not a single
                // "late = 20" guess. Fall back to the live band for ungraded tasks.
                const timelinessBand = calculateTimelinessScore(
                  activeTask.deadline, activeTask.submittedAt || new Date().toISOString()
                ).score;

                if (isSuperiorEvaluator) {
                  return (
                    <div id="superior-evaluation-section" className={`border rounded-xl p-4 space-y-3 scroll-mt-6 ${isLate ? 'bg-amber-50/80 border-amber-300' : 'bg-blue-50/60 border-blue-200'}`}>
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Award className={`w-4 h-4 ${isLate ? 'text-amber-600' : 'text-emerald-600'}`} /> Superior TRS Report Evaluation & Grade
                          </h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            activeTask.evaluationStatus === 'Approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : activeTask.evaluationStatus === 'Reviewed'
                              ? 'bg-blue-100 text-blue-800'
                              : activeTask.evaluationStatus === 'Revision'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-900 border border-amber-300'
                          }`}>
                            {activeTask.evaluationStatus || 'Pending Review'}
                          </span>
                        </div>
                        <div className="w-full md:w-auto">
                          {canEvaluateTask && (
                            <button
                              type="button"
                              onClick={() => handleOpenReviewModal(activeTask)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer justify-center w-full md:w-auto"
                            >
                              <UserCheck className="w-3.5 h-3.5" /> Open Evaluation Modal
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 2-Factor Evaluation Summary Card */}
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-xs font-bold text-slate-700">Calculated Final Score:</span>
                            {activeTask.evaluationStatus && activeTask.score !== undefined ? (
                              <span className="text-base font-black text-blue-700 bg-white px-2.5 py-0.5 rounded-lg border border-blue-200 shadow-2xs">
                                {activeTask.score}%
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-lg border border-amber-300">
                                Pending Evaluation (Open modal to grade)
                              </span>
                            )}
                            {activeTask.evaluationStatus && (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                activeTask.evaluationStatus === 'Approved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : activeTask.evaluationStatus === 'Reviewed'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {activeTask.evaluationStatus}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500">
                            2-Factor Weight: <strong>40% Timeliness + 60% Quality</strong>
                          </span>
                        </div>

                        {/* Breakdown pills */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                            <span className="text-[10px] text-slate-400 block font-semibold">Timeliness (40%)</span>
                            <span className="font-bold text-blue-700">
                              {activeTask.latePenaltyWaived ? '40 / 40 pts (Waived)' : `${activeTask.timelinessScore ?? timelinessBand} / 40`}
                            </span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                            <span className="text-[10px] text-slate-400 block font-semibold">1. Instruction (20%)</span>
                            <span className="font-bold text-indigo-700">
                              {activeTask.evaluationStatus && activeTask.instructionScore !== undefined
                                ? `${activeTask.instructionScore} / 20`
                                : 'Pending / 20'}
                            </span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                            <span className="text-[10px] text-slate-400 block font-semibold">2. Scope (20%)</span>
                            <span className="font-bold text-indigo-700">
                              {activeTask.evaluationStatus && activeTask.scopeScore !== undefined
                                ? `${activeTask.scopeScore} / 20`
                                : 'Pending / 20'}
                            </span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-slate-200 text-center">
                            <span className="text-[10px] text-slate-400 block font-semibold">3. Quality (20%)</span>
                            <span className="font-bold text-amber-700">
                              {activeTask.evaluationStatus && activeTask.accuracyScore !== undefined
                                ? `${activeTask.accuracyScore} / 20`
                                : 'Pending / 20'}
                            </span>
                          </div>
                        </div>

                        {activeTask.feedback && (
                          <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs">
                            <span className="text-[10px] font-bold text-slate-500 block uppercase">Superior Feedback Notes:</span>
                            <p className="text-slate-800 text-[11px] mt-0.5">{activeTask.feedback}</p>
                          </div>
                        )}

                        {activeTask.dispute && (
                          <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500 block uppercase">Score Dispute Management</span>
                              {activeTask.dispute.status === 'Pending' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">Dispute Filed (Pending)</span>
                              ) : activeTask.dispute.status === 'Resolved' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Dispute Resolved</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">Dispute Rejected</span>
                              )}
                            </div>
                            <div className="p-2 bg-amber-50/60 border border-amber-200 rounded-lg">
                              <span className="block text-[10px] font-bold text-amber-900">Staff Rationale:</span>
                              <p className="text-[11px] text-slate-700 mt-0.5">"{activeTask.dispute.reason}"</p>
                            </div>
                            {activeTask.dispute.requestedAt && (
                              <span className="text-[10px] text-slate-500 font-semibold block">
                                Filed at: {new Date(activeTask.dispute.requestedAt).toLocaleString()}
                              </span>
                            )}
                            {activeTask.dispute.status === 'Pending' ? (
                              <button
                                type="button"
                                onClick={() => handleOpenResolveDispute(activeTask)}
                                className="w-full mt-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                              >
                                Review &amp; Resolve Dispute (Assigner / Admin / Executive Only)
                              </button>
                            ) : (
                              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                                {activeTask.dispute.resolvedByName && (
                                  <span className="block text-[10px] font-bold text-slate-600">Resolved by: {activeTask.dispute.resolvedByName}</span>
                                )}
                                {activeTask.dispute.resolutionNote && (
                                  <p className="text-[11px] text-slate-700">"{activeTask.dispute.resolutionNote}"</p>
                                )}
                                {activeTask.dispute.resolvedAt && (
                                  <span className="block text-[10px] text-slate-500 font-semibold">
                                    At: {new Date(activeTask.dispute.resolvedAt).toLocaleString()}
                                  </span>
                                )}
                                {activeTask.dispute.status === 'Resolved' && activeTask.dispute.revisedScore !== undefined && (
                                  <span className="block text-[10px] font-bold text-emerald-700">Revised Score: {activeTask.dispute.revisedScore}%</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // Assigned Staff View (Read-Only)
                return (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-amber-500" /> Superior Evaluation &amp; Grade
                      </h4>
                      <div className="flex items-center gap-2">
                        {activeTask.evaluationStatus ? (
                          <>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              activeTask.evaluationStatus === 'Approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : activeTask.evaluationStatus === 'Reviewed'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {activeTask.evaluationStatus}
                            </span>
                            <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold">
                              Graded by {activeTask.assignedByName}
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-600" /> Awaiting Superior Evaluation
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 block font-semibold">Total Score</span>
                        {activeTask.evaluationStatus && activeTask.score !== undefined ? (
                          <span className="font-black text-blue-600 text-sm">{activeTask.score}%</span>
                        ) : (
                          <span className="font-bold text-amber-800 text-xs">Pending Review</span>
                        )}
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 block font-semibold">Timeliness (40%)</span>
                        <span className="font-bold text-slate-700">{activeTask.latePenaltyWaived ? '40 / 40' : `${activeTask.timelinessScore ?? timelinessBand} / 40`}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 block font-semibold">Quality (60%)</span>
                        {activeTask.evaluationStatus && activeTask.qualityScore !== undefined ? (
                          <span className="font-bold text-slate-700">{activeTask.qualityScore} / 60</span>
                        ) : (
                          <span className="font-semibold text-amber-800 text-xs">Pending Review</span>
                        )}
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
                        <span className="text-[10px] text-slate-400 block font-semibold">Late Penalty</span>
                        <span className="font-bold text-slate-700">{activeTask.latePenaltyWaived ? 'Waived ✅' : (isLate ? 'Applied ⚠️' : 'None ✅')}</span>
                      </div>
                    </div>

                    {activeTask.feedback && (
                      <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs">
                        <span className="text-[10px] font-bold text-slate-500 block uppercase">Superior Feedback &amp; Remarks:</span>
                        <p className="text-slate-800 text-[11px] mt-0.5">{activeTask.feedback}</p>
                      </div>
                    )}

                    {/* Staff Score Dispute Panel */}
                    {(() => {
                      const evaluated = !!(activeTask.evaluationStatus && activeTask.score !== undefined);
                      const workingDaysElapsed = calculateWorkingDaysElapsed(
                        activeTask.evaluationDate || activeTask.completionDate || new Date().toISOString()
                      );
                      const withinWindow = workingDaysElapsed <= 3;

                      if (!evaluated) return null;

                      if (activeTask.dispute) {
                        return (
                          <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500 block uppercase">Score Dispute</span>
                              {activeTask.dispute.status === 'Pending' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">Dispute Filed (Pending)</span>
                              ) : activeTask.dispute.status === 'Resolved' ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Dispute Resolved</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">Dispute Rejected</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-700">"{activeTask.dispute.reason}"</p>
                            {activeTask.dispute.status === 'Resolved' && activeTask.dispute.revisedScore !== undefined && (
                              <span className="block text-[10px] font-bold text-emerald-700">Final Revised Score: {activeTask.dispute.revisedScore}%</span>
                            )}
                            {activeTask.dispute.status !== 'Pending' && (
                              <span className="block text-[10px] text-slate-500 font-semibold">
                                Superior Note: {activeTask.dispute.resolutionNote || 'None provided'}
                              </span>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs space-y-2">
                          <span className="text-[10px] font-bold text-slate-500 block uppercase">Score Dispute</span>
                          {activeTask.evaluationStatus === 'Reviewed' && !withinWindow && (
                            <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900">
                              The 3-working-day score dispute window for this evaluation has expired. Dispute filing is no longer available.
                            </div>
                          )}
                          {activeTask.evaluationStatus === 'Reviewed' && withinWindow ? (
                            <button
                              type="button"
                              onClick={() => handleOpenDispute(activeTask)}
                              className="w-full px-3 py-2 border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-lg text-xs font-bold cursor-pointer"
                            >
                              ⚖️ Dispute Published Score
                            </button>
                          ) : activeTask.evaluationStatus === 'Reviewed' ? (
                            <span className="block text-[10px] text-slate-500 font-semibold">Dispute window closed • {workingDaysElapsed} working day(s) elapsed</span>
                          ) : (
                            <span className="block text-[10px] text-slate-500 font-semibold">
                              Disputes are available for tasks with a <strong>Reviewed</strong> status within 3 working days of evaluation.
                            </span>
                          )}
                          {withinWindow && (
                            <p className="text-[10px] text-slate-400">
                              Applies to your evaluated score only. A valid rationale is required for the assigner, admin, or executive to review.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* TRS Task Comment Thread (Assigner, Admin, Executive & Assigned Staff) */}
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-blue-600" /> TRS Task Comments
                  </h4>
                  <span className="text-[10px] font-bold text-slate-500">{(activeTask.comments || []).length} comment{(activeTask.comments || []).length !== 1 ? 's' : ''}</span>
                </div>

                {(activeTask.comments || []).length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {(activeTask.comments || []).map(c => {
                      const isReply = !!c.replyToId;
                      const isCurrentUser = c.authorId === currentUser.id;
                      return (
                        <div key={c.id} className={isReply ? 'ml-5' : ''}>
                          <div className={`p-2 rounded-lg border text-xs space-y-1 ${isReply ? 'bg-slate-50/60 border-slate-100' : isCurrentUser ? 'bg-blue-50/60 border-blue-100' : 'bg-slate-50 border-slate-200'}`}>
                            <div className="flex items-center gap-2">
                              {isReply && <CornerDownRight className="w-3 h-3 text-slate-400 shrink-0" />}
                              <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                {(c.authorName || c.authorId || '?').charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1">
                                <span className="font-bold text-slate-800 block leading-tight">
                                  {c.authorName || c.authorId}
                                  {c.authorRole && <span className="ml-1.5 text-[10px] font-semibold text-slate-400">◈ {c.authorRole}</span>}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                                </span>
                              </div>
                              {isCurrentUser && (
                                <span className="text-[10px] font-bold text-blue-600">You</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-700 leading-relaxed pt-0.5">{c.message}</p>
                            {!isReply && (
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setReplyToCommentId(replyToCommentId === c.id ? null : c.id)}
                                  className="text-[10px] font-bold text-slate-500 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                                >
                                  <CornerDownRight className="w-3 h-3" /> {replyToCommentId === c.id ? 'Cancel Reply' : 'Reply'}
                                </button>
                              </div>
                            )}
                          </div>

                          {replyToCommentId === c.id && (
                            <form
                              onSubmit={handlePostComment}
                              className="mt-1.5 ml-5 bg-white border border-blue-200 rounded-lg p-2 flex items-start gap-1.5"
                            >
                              <input
                                type="text"
                                value={newCommentText}
                                onChange={e => setNewCommentText(e.target.value)}
                                placeholder={`Reply to ${c.authorName || 'this comment'}...`}
                                autoFocus
                                className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-[11px] text-slate-900 focus:ring-2 focus:ring-blue-400 focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={isPostingComment || !newCommentText.trim()}
                                className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50 cursor-pointer"
                              >
                                Post
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 italic">No comments yet. Start the discussion about this TRS report below.</p>
                )}

                <form onSubmit={handlePostComment} className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {(currentUser.name || currentUser.id || '?').charAt(0).toUpperCase()}
                    </div>
                    <textarea
                      rows={2}
                      value={newCommentText}
                      onChange={e => setNewCommentText(e.target.value)}
                      placeholder="Write a comment on this TRS report..."
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={isPostingComment || !newCommentText.trim()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer"
                    >
                      {isPostingComment ? 'Posting...' : 'Post Comment'}
                    </button>
                  </div>
                </form>
              </div>

              {/* CONSOLIDATED STAFF DELIVERABLE & SUBMISSION RECORD */}
              {isTaskSubmitted ? (
                <div className="bg-white border border-emerald-200 rounded-2xl p-4 space-y-3.5 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-emerald-950">Staff Deliverable Submission Record</h4>
                        <p className="text-[10px] text-emerald-800">
                          Submitted by <strong>{activeTask.assignedToName}</strong>
                          {activeTask.submittedAt && ` on ${new Date(activeTask.submittedAt).toLocaleString()}`}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200">
                      <Lock className="w-3 h-3 text-emerald-600" /> Locked Record
                    </span>
                  </div>

                  {/* Accomplishment Notes / Summary */}
                  <div>
                    <span className="block text-[11px] font-bold text-slate-800 mb-1">Accomplishment Summary / Deliverable Notes:</span>
                    <p className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed font-medium">
                      {activeTask.submissionNotes || 'No accomplishment summary provided.'}
                    </p>
                  </div>

                  {/* Execution remarks (if different from submission notes and present) */}
                  {activeTask.staffRemarks && activeTask.staffRemarks !== activeTask.submissionNotes && (
                    <div>
                      <span className="block text-[11px] font-bold text-slate-600 mb-1">Execution &amp; Progress Notes:</span>
                      <p className="p-2.5 bg-slate-50/70 border border-slate-200 rounded-lg text-xs text-slate-700 italic">
                        "{activeTask.staffRemarks}"
                      </p>
                    </div>
                  )}

                  {/* Proof Link if available */}
                  {activeTask.proofUrl && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] font-bold text-slate-700">Deliverable Proof:</span>
                      <a
                        href={activeTask.proofUrl.startsWith('http') ? activeTask.proofUrl : `https://${activeTask.proofUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-blue-500" /> View Deliverable File / Proof
                      </a>
                    </div>
                  )}

                  {/* Multi Proof Deliverables Record (locked / read-only) */}
                  {(activeTask.multiProof?.files?.length || activeTask.multiProof?.cloudLinks?.length || activeTask.multiProof?.telegramLinks?.length) ? (
                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-bold text-slate-800 text-xs">Deliverable Proof Files / Links:</span>
                      <MultiProofUploader data={activeTask.multiProof} readOnly={true} />
                    </div>
                  ) : null}

                  {/* E-Signature Verification */}
                  {activeTask.signature && (
                    <div className="border-t border-slate-100 pt-2 flex items-center justify-between gap-3 text-[11px]">
                      <span className="text-emerald-800 font-bold flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" /> Digital E-Signature Verified
                      </span>
                      <span className="font-semibold text-slate-700 flex items-center gap-2">
                        Signed by: <strong>{activeTask.signature.signeeName || 'Signed'}</strong> ({new Date(activeTask.signature.signedAt).toLocaleDateString()})
                        {(activeTask.signature.type === 'handwritten' || activeTask.signature.type === 'uploaded') && activeTask.signature.dataUrl && (
                          <SignatureImage
                            src={activeTask.signature.dataUrl}
                            alt="Signature"
                            className="h-8 max-w-[80px] object-contain bg-white border border-slate-200 rounded p-0.5"
                            fallbackText=""
                            fallbackClassName="h-8"
                          />
                        )}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                /* Active Task Execution: Show Staff Remarks Box + Submission Callout */
                <div className="space-y-3">
                  {/* Staff Remarks & Progress Notes */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">
                            Staff Remarks &amp; Progress Notes
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            Notes from assigned staff regarding status, progress, blockers, or execution details.
                          </p>
                        </div>
                      </div>
                      {activeTask.assignedTo === currentUser.id ? (
                        <span className="text-[10px] bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-bold">
                          Assigned Staff Editor
                        </span>
                      ) : (
                        <span className="text-[10px] bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full font-bold">
                          Staff: {activeTask.assignedToName}
                        </span>
                      )}
                    </div>

                    {activeTask.assignedTo === currentUser.id || currentUser.role === 'admin' ? (
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          value={staffRemarkText}
                          onChange={e => setStaffRemarkText(e.target.value)}
                          placeholder="Add remarks or notes about this task before submitting (e.g. current progress, blockers, coordination status, or updates when changing status)..."
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder:text-slate-400 leading-relaxed"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] text-slate-500 italic">
                            Tip: Remarks are auto-saved when you update status or submit report deliverable.
                          </span>
                          <button
                            type="button"
                            onClick={handleSaveStaffRemark}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95"
                          >
                            <Check className="w-3.5 h-3.5" /> Save Staff Remark
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800">
                        {activeTask.staffRemarks ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-semibold">
                              <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                              <span>Staff Remark by {activeTask.assignedToName}:</span>
                            </div>
                            <p className="text-slate-800 font-medium whitespace-pre-wrap leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                              {activeTask.staffRemarks}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">
                            No progress remarks added by assigned staff ({activeTask.assignedToName}) yet.
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Submission Action Banner */}
                  <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-start gap-2.5">
                      <FileText className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <h5 className="text-xs font-bold text-emerald-950">Staff Deliverable Submission</h5>
                        <p className="text-[11px] text-emerald-800 mt-0.5">
                          {activeTask.assignedTo === currentUser.id
                            ? 'Once progression reaches 100%, verify all requirements and submit your deliverable report and proof below.'
                            : `Waiting for ${activeTask.assignedToName} to complete work and submit deliverable report.`}
                        </p>
                      </div>
                    </div>
                    {activeTask.assignedTo === currentUser.id && (
                      activeTask.isDefaulted ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-rose-700 bg-rose-100 border border-rose-300 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-rose-700" /> Submission Locked (7+ Days Overdue)
                          </span>
                          <p className="text-[11px] text-rose-800">
                            Await superior administrative unlock to submit.
                          </p>
                        </div>
                      ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenSubmitModal(activeTask)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all shrink-0 cursor-pointer"
                      >
                        <FileText className="w-4 h-4" /> Submit Deliverable Report
                      </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })() : (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400">
              Select a report from the list or assign a new superior TRS report.
            </div>
          )}
        </div>
      </div>
      )}

      {/* Deliverable Submission Modal */}
      {isSubmittingDeliverable && activeTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full p-5 sm:p-6 border border-slate-200 space-y-4 max-h-[92vh] overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-600" />
                  Submit TRS Report Deliverable
                </h3>
                <p className="text-xs text-slate-500">
                  Report: <strong>{activeTask.title}</strong> ({activeTask.code || 'TRS'})
                </p>
              </div>
              <button
                onClick={() => setIsSubmittingDeliverable(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* Progression Verification */}
            {(activeTask.progress || 0) < 100 && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold text-amber-950">Progression is currently at {activeTask.progress || 0}%:</strong>
                  <p className="mt-0.5 text-amber-900 text-[11px]">
                    TRS submission rules require tasks to reach 100% completion before submitting the official deliverable report.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleUpdateProgress(activeTask, 100)}
                    className="mt-2 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    Mark 100% Completed &amp; Continue
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveDeliverable} className="space-y-4">
              {/* Submission Deadline Notice & 2-Factor Timeliness Preview */}
              {(() => {
                const timeliness = calculateTimelinessScore(activeTask.deadline, new Date().toISOString());
                if (!timeliness.isLate) {
                  return (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <strong className="font-bold text-emerald-950 flex items-center justify-between">
                          <span>On-Time Submission (Full 40/40 Timeliness Points):</span>
                          <span className="bg-emerald-200 text-emerald-900 text-[10px] px-2 py-0.5 rounded-full font-black">40 / 40 pts</span>
                        </strong>
                        <p className="text-emerald-800 text-[11px] leading-relaxed">
                          Submitting on or before deadline (<strong>{activeTask.deadline}</strong>). You automatically earn the maximum <strong>40 timeliness points</strong>. Your superior will grade the remaining <strong>60 quality points</strong> upon review.
                        </p>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 space-y-2">
                      <div className="flex items-start gap-2.5">
                        <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <strong className="font-bold text-amber-950">Overdue Submission ({timeliness.daysLate} day{timeliness.daysLate > 1 ? 's' : ''} past deadline)</strong>
                            <span className="bg-amber-200 text-amber-950 text-[10px] px-2 py-0.5 rounded-full font-black">
                              {timeliness.score} / 40 pts
                            </span>
                          </div>
                          <p className="text-amber-900 text-[11px] mt-1 leading-relaxed">
                            Staff are always permitted to submit late work so achievements are officially documented. Under the 2-factor model, timeliness is <strong>{timeliness.score}/40 pts</strong>. Your superior can waive this penalty if you provide a valid operational reason below.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }
              })()}

              {/* Delay Reason field if overdue */}
              {calculateTimelinessScore(activeTask.deadline, new Date().toISOString()).isLate && (
                <div>
                  <label className="block text-xs font-bold text-amber-950 mb-1">
                    Reason / Explanation for Delay * <span className="text-[11px] font-normal text-amber-800">(Required for superior evaluation)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {['Pending superior approval on prior dependency', 'Awaiting external vendor/data', 'Unexpected system outage', 'Scope expanded mid-execution', 'Scheduling/availability constraints'].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDelayReason(preset)}
                        className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
                          delayReason === preset
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    required
                    value={delayReason}
                    onChange={e => setDelayReason(e.target.value)}
                    placeholder="Explain the blocker, external dependencies, scope change, or technical issues that caused the delay..."
                    className="w-full px-3 py-2 border border-amber-300 bg-amber-50/40 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Deliverable Summary / Accomplishment Notes *
                </label>
                <textarea
                  rows={4}
                  required
                  value={deliverableNotes}
                  onChange={e => setDeliverableNotes(e.target.value)}
                  placeholder="Describe your completion findings, output deliverables, or implementation details..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Proof / Deliverables Submission (Optional)
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Attach files, share cloud document links, or provide Telegram file links as evidence of completion.
                </p>
                <MultiProofUploader
                  data={taskMultiProof}
                  onChange={setTaskMultiProof}
                  readOnly={activeTask.evaluationStatus === 'Approved'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Digital E-Signature Verification Name *
                </label>
                <input
                  type="text"
                  required
                  value={signatureName}
                  onChange={e => setSignatureName(e.target.value)}
                  placeholder="Your full legal name for verification"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-bold"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSubmittingDeliverable(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deliverableSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {deliverableSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {deliverableSaving ? 'Submitting…' : 'Submit Report Deliverable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Superior TRS Report Evaluation & Review Modal (2-Factor Scoring Model: Timeliness 40% + Quality 60%) */}
      {isReviewingModal && activeTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 space-y-4 max-h-[94vh] overflow-y-auto my-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-emerald-600 font-bold text-base">
                <UserCheck className="w-5 h-5" />
                <h2>Superior TRS Evaluation &amp; Grade</h2>
              </div>
              <button
                onClick={() => setIsReviewingModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-500 -mt-2">
              Evaluating deliverable submitted by <strong className="text-slate-800">{activeTask.assignedToName}</strong> for <strong className="text-slate-800">{activeTask.title}</strong>
            </p>

            <form onSubmit={handleSaveReviewModal} className="space-y-4">
              {/* Staff Deliverable Summary Recap */}
              {(activeTask.submissionNotes || activeTask.staffRemarks || activeTask.delayReason) && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">Staff Deliverable Accomplishment:</span>
                    {activeTask.submittedAt && (
                      <span className="text-[10px] text-slate-500">
                        Submitted: {activeTask.submittedAt.split('T')[0]} (Deadline: {activeTask.deadline})
                      </span>
                    )}
                  </div>
                  <p className="text-slate-700 text-[11px] leading-relaxed max-h-20 overflow-y-auto whitespace-pre-wrap bg-white p-2.5 rounded-lg border border-slate-200">
                    {activeTask.submissionNotes || activeTask.staffRemarks || 'No accomplishment summary provided.'}
                  </p>
                  {activeTask.delayReason && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px]">
                      <strong className="font-bold block text-amber-950">Staff Delay Explanation:</strong>
                      {activeTask.delayReason}
                    </div>
                  )}
                  {activeTask.proofUrl && (
                    <a
                      href={activeTask.proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline font-semibold"
                    >
                      <ExternalLink className="w-3 h-3" /> View Submitted Proof Link
                    </a>
                  )}
                </div>
              )}

              {/* 2-FACTOR SCORING MODEL BREAKDOWN */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="bg-slate-800 text-white p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold uppercase tracking-wider">2-Factor Objective Scoring Model</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-300">Total Score:</span>
                    <span className="text-base font-black text-amber-400">
                      {Math.min(100, (reviewWaiveLatePenalty ? 40 : reviewTimelinessScore) + reviewInstructionScore + reviewScopeScore + reviewAccuracyScore)}%
                    </span>
                  </div>
                </div>

                <div className="p-4 space-y-4 bg-white">
                  {/* Factor 1: Timeliness (Automated 40 pts) */}
                  <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-bold text-blue-950">Factor 1: Timeliness Score (40% Weight)</span>
                      </div>
                      <span className="text-xs font-black text-blue-800">
                        {reviewWaiveLatePenalty ? 40 : reviewTimelinessScore} / 40 pts
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 flex items-center justify-between flex-wrap gap-2">
                      <span>
                        Deadline: <strong>{activeTask.deadline}</strong> | Submission: <strong>{activeTask.submittedAt ? activeTask.submittedAt.split('T')[0] : 'Today'}</strong>
                      </span>
                      {calculateTimelinessScore(activeTask.deadline, activeTask.submittedAt || new Date().toISOString()).isLate ? (
                        <span className="text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-full text-[10px]">
                          Late by {calculateTimelinessScore(activeTask.deadline, activeTask.submittedAt || new Date().toISOString()).daysLate} day(s)
                        </span>
                      ) : (
                        <span className="text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded-full text-[10px]">
                          On Time (Automated 40 pts)
                        </span>
                      )}
                    </div>

                    {/* Superior Waiver Control */}
                    {reviewTimelinessScore < 40 && (
                      <label className="flex items-center gap-2 pt-1.5 border-t border-blue-200/80 cursor-pointer text-xs text-blue-900 font-medium">
                        <input
                          type="checkbox"
                          checked={reviewWaiveLatePenalty}
                          onChange={e => setReviewWaiveLatePenalty(e.target.checked)}
                          className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                        />
                        <span>Waive late penalty &amp; award full 40 pts (e.g. justified delay or approved extension)</span>
                      </label>
                    )}

                    {/* Staff's Explanation for Delay (read-only, from submission record) */}
                    {activeTask.delayReason && (
                      <div className="pt-1.5 border-t border-blue-200/80">
                        <span className="block text-[11px] font-bold text-amber-950 mb-1">Staff's Explanation for Delay:</span>
                        <p className="bg-white border border-amber-200 rounded-lg p-2 text-[11px] text-slate-700 italic">
                          "{activeTask.delayReason}"
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Factor 2: Superior Quality Evaluation (60 pts across 3 Pillars) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>Factor 2: Superior Quality Evaluation (60% Weight across 3 Pillars)</span>
                      </div>
                      <span className="text-xs font-black text-emerald-700">
                        {reviewInstructionScore + reviewScopeScore + reviewAccuracyScore} / 60 pts
                      </span>
                    </div>

                    {/* Pillar 1: Instruction Adherence */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-800">1. Instruction Adherence</span>
                          <span className="block text-[10px] text-slate-500">Were procedures, tools, and supervisor guidelines followed?</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={reviewInstructionScore}
                            onChange={e => setReviewInstructionScore(Math.min(20, Math.max(0, Number(e.target.value) || 0)))}
                            className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs font-black text-right text-slate-900 bg-white"
                          />
                          <span className="text-xs text-slate-500 font-bold">/ 20</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={reviewInstructionScore}
                        onChange={e => setReviewInstructionScore(Number(e.target.value))}
                        className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                      />
                    </div>

                    {/* Pillar 2: Scope Completeness */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-800">2. Scope Completeness</span>
                          <span className="block text-[10px] text-slate-500">Were all assigned boundaries, components, and deliverables delivered?</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={reviewScopeScore}
                            onChange={e => setReviewScopeScore(Math.min(20, Math.max(0, Number(e.target.value) || 0)))}
                            className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs font-black text-right text-slate-900 bg-white"
                          />
                          <span className="text-xs text-slate-500 font-bold">/ 20</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={reviewScopeScore}
                        onChange={e => setReviewScopeScore(Number(e.target.value))}
                        className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                      />
                    </div>

                    {/* Pillar 3: Accuracy & Quality Benchmark */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-800">3. Accuracy &amp; Quality Benchmark</span>
                          <span className="block text-[10px] text-slate-500">Quality of output, zero-defect standard, depth, and presentation</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={reviewAccuracyScore}
                            onChange={e => setReviewAccuracyScore(Math.min(20, Math.max(0, Number(e.target.value) || 0)))}
                            className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs font-black text-right text-slate-900 bg-white"
                          />
                          <span className="text-xs text-slate-500 font-bold">/ 20</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={reviewAccuracyScore}
                        onChange={e => setReviewAccuracyScore(Number(e.target.value))}
                        className="w-full accent-amber-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* TRS Revision Cycle Monitor */}
              {(activeTask.revisionCount || 0) > 0 && (
                <div className="flex items-center gap-2.5 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs">
                  <RefreshCcw className="w-4 h-4 text-amber-600 shrink-0" />
                  <div>
                    <span className="font-bold text-amber-900 block">Revision Cycle: {(activeTask.revisionCount || 0)} of 2</span>
                    <span className="text-[11px] text-amber-800">
                      {(activeTask.revisionCount || 0) >= 2
                        ? 'Maximum revision cycles reached. An additional revision attempt auto-escalates this report to senior management.'
                        : 'Per TRS guidelines, only 2 revision cycles are allowed per task before escalation.'}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Approval / Evaluation Decision</label>
                <ModernSelect
                  value={reviewModalStatus}
                  onChange={e => setReviewModalStatus(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 font-bold bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="Approved">✅ Approved (Work accepted &amp; completed)</option>
                  <option value="Reviewed">👍 Reviewed (Work reviewed with constructive notes)</option>
                  <option value="Revision">🔄 Needs Revision (Re-opens task to 75% for rework; max 2 cycles before auto-escalation)</option>
                </ModernSelect>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Superior Feedback &amp; Review Remarks
                  {reviewInstructionScore + reviewScopeScore + reviewAccuracyScore < 42 && (
                    <span className="ml-2 text-[10px] font-bold text-rose-600">⚠ Mandatory below 42/60 quality points</span>
                  )}
                </label>
                <textarea
                  rows={3}
                  required
                  value={reviewModalFeedback}
                  onChange={e => setReviewModalFeedback(e.target.value)}
                  placeholder={
                    reviewInstructionScore + reviewScopeScore + reviewAccuracyScore < 42
                      ? 'Mandatory justification: Itemize strengths and concrete, actionable guidance for improving quality (min 10 characters) before grading below 70% quality...'
                      : 'Detail strengths, feedback on instructions/scope/quality, or specific rework instructions if requesting revision...'
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReviewingModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" /> Save Grade &amp; Evaluation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Superior Delegate / Edit TRS Report Modal (Accessible from Table, Timeline, & Cards views) */}
      {isAssigning && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-200 my-8 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-blue-700 font-bold text-base">
                <Send className="w-5 h-5" />
                <h3>{editingTaskId ? 'Edit Superior TRS Report Directives' : 'Delegate New TRS Task to Staff'}</h3>
              </div>
              <button
                onClick={() => setIsAssigning(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-500 -mt-2">
              Provide direct operational instructions, define the boundaries, and establish grading quality criteria for the assigned staff.
            </p>

            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">TRS Report Title *</label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="e.g. Q3 Financial Statement Audit or Branch Operations Workflow"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none font-medium"
                />
              </div>

<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Assign to Staff Member *
                  </label>
                  <ModernSelect
                    required
                    value={assigneeId}
                    onChange={e => setAssigneeId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value={currentUser.id}>
                      {currentUser.name}
                    </option>
                    {staffOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </ModernSelect>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Completion Deadline *</label>
                  <input
                    type="date"
                    required
                    value={deadlineDate}
                    onChange={e => setDeadlineDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Active Workload Indicator Card (full width of dialog) */}
              {assigneeId && (() => {
                const wl = getStaffActiveTaskCount(assigneeId);
                const lvl = wl.workloadLevel === 'light' ? 'Light' : wl.workloadLevel === 'moderate' ? 'Moderate' : 'Heavy';
                const lvlColor =
                  wl.workloadLevel === 'light'
                    ? 'border-emerald-200 bg-emerald-50'
                    : wl.workloadLevel === 'moderate'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-rose-200 bg-rose-50';
                const lvlTextColor =
                  wl.workloadLevel === 'light'
                    ? 'text-emerald-800'
                    : wl.workloadLevel === 'moderate'
                    ? 'text-amber-800'
                    : 'text-rose-800';
                const selectedStaff = allUsers.find(u => u.id === assigneeId);
                return (
                  <div className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition-all ${lvlColor}`}>
                    <div>
                      <span className={`font-bold ${lvlTextColor}`}>{selectedStaff?.name || 'Selected Staff'} — Active Workload</span>
                      <span className="block text-[10px] text-slate-500 font-medium">{(wl.tasks || []).length} task(s) currently assigned</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${lvlTextColor} bg-white border`}>
                      {wl.total} active • {lvl}
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Department / Project Stream *</label>
                  {!isCustomProject ? (
                    <div className="flex gap-1.5">
                      <ModernSelect
                        value={taskProject}
                        onChange={e => {
                          if (e.target.value === '__custom__') {
                            setIsCustomProject(true);
                            setTaskProject('');
                          } else {
                            setTaskProject(e.target.value);
                          }
                        }}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        {/* Options come from the admin-managed org_config master list
                            (database-backed, active departments only). A value already
                            on this task is merged in so legacy free-text entries stay
                            visible instead of resetting the select to blank. */}
                        {(() => {
                          const merged = [...departmentOptions];
                          if (taskProject && !merged.some(d => d.toLowerCase() === taskProject.toLowerCase())) {
                            merged.push(taskProject);
                          }
                          if (!merged.length) merged.push('Operations');
                          return merged.map(d => (
                            <option key={d} value={d}>{d}</option>
                          ));
                        })()}
                        <option value="__custom__">➕ + Add Custom Department / Project...</option>
                      </ModernSelect>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        required
                        autoFocus
                        value={taskProject}
                        onChange={e => setTaskProject(e.target.value)}
                        placeholder="Type custom department or project..."
                        className="w-full px-3 py-2 border border-blue-500 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomProject(false);
                          setTaskProject(currentUser.department || 'Operations');
                        }}
                        className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 rounded-xl shrink-0 cursor-pointer"
                        title="Back to list"
                      >
                        List
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Priority Level</label>
                  <ModernSelect
                    value={taskPriority}
                    onChange={e => setTaskPriority(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="Urgent">🚨 Urgent (Immediate attention)</option>
                    <option value="High">🔴 High Priority</option>
                    <option value="Medium">🟡 Medium Priority</option>
                    <option value="Low">🟢 Low Priority</option>
                  </ModernSelect>
                </div>
              </div>

              {/* The 3 Superior Directives & Evaluation Criteria */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-blue-600" /> Superior Task Criteria & Directives
                  </div>
                  <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded">
                    3 Core Criteria
                  </span>
                </div>

                {/* 1. Instruction */}
                <div>
                  <label className="block text-xs font-bold text-blue-950 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">📋 1. Instruction</span>
                    <span className="text-[11px] font-normal text-slate-500">Operating guidelines, steps, method</span>
                  </label>
                  <textarea
                    rows={2}
                    value={taskInstructions}
                    onChange={e => setTaskInstructions(e.target.value)}
                    placeholder="Describe specific step-by-step procedures, who to consult, tools to use, or methodology..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* 2. Scope */}
                <div>
                  <label className="block text-xs font-bold text-indigo-950 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">🎯 2. Scope</span>
                    <span className="text-[11px] font-normal text-slate-500">Deliverables, boundaries, inclusions</span>
                  </label>
                  <textarea
                    rows={2}
                    value={taskScope}
                    onChange={e => setTaskScope(e.target.value)}
                    placeholder="Specify boundaries: what is included vs excluded, departments involved, exact documents required..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                {/* 3. Quality */}
                <div>
                  <label className="block text-xs font-bold text-amber-950 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">⭐ 3. Quality</span>
                    <span className="text-[11px] font-normal text-slate-500">Acceptance benchmarks & grading criteria</span>
                  </label>
                  <textarea
                    rows={2}
                    value={taskQualityCriteria}
                    onChange={e => setTaskQualityCriteria(e.target.value)}
                    placeholder="Define quality expectations: accuracy benchmarks, report format, citation standards, zero-defect criteria..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAssigning(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Send className="w-4 h-4" /> {editingTaskId ? 'Save Report Changes' : (assigneeId === currentUser.id ? 'Create Self-Assigned Task' : 'Delegate TRS Task')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {taskToDeleteId && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-50 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete TRS Report</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete this TRS report?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTaskToDeleteId(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteTask}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" /> Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Score Dispute Submission Modal */}
      {isDisputing && activeTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-amber-700 font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                <h3>Dispute TRS Published Score</h3>
              </div>
              <button
                onClick={() => setIsDisputing(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            {activeTask.score !== undefined && (
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="block text-[10px] font-bold text-slate-500 uppercase">Evaluated Score</span>
                  <span className="text-2xl font-black text-amber-600">{activeTask.score}%</span>
                </div>
                <div className="flex-1 text-[11px] text-slate-500">
                  Disputes are limited to one (1) per evaluated report and must be filed within <strong>3 working days</strong> of evaluation. The assigner, admin, or executive will review your rationale and issue a final determination.
                </div>
              </div>
            )}

            <form onSubmit={handleSubmitDispute} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">Your Rationale for the Dispute *</label>
                <textarea
                  rows={4}
                  required
                  value={disputeReason}
                  onChange={e => setDisputeReason(e.target.value)}
                  placeholder="State objective reasons and evidence why the published score does not accurately reflect the deliverables (e.g., a scope item was evaluated against unassigned criteria, or deliverables were completed within the original deadline)..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDisputing(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4" /> Submit Dispute
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Score Dispute Resolution Modal (Assigner / Admin / Executive) */}
      {isResolvingDispute && activeTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4 max-h-[92vh] overflow-y-auto my-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-blue-700 font-bold text-base">
                <ShieldCheck className="w-5 h-5" />
                <h3>Resolve Score Dispute</h3>
              </div>
              <button
                onClick={() => setIsResolvingDispute(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            {activeTask.dispute && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                <span className="block text-[10px] font-bold text-amber-900 uppercase">Staff Dispute Rationale ({activeTask.dispute.staffName || 'Assigned Staff'})</span>
                <p className="text-xs text-slate-700">"{activeTask.dispute.reason}"</p>
                <span className="block text-[10px] text-slate-500 font-semibold">
                  Original Score: {activeTask.dispute.originalScore ?? activeTask.score ?? 'N/A'}% • Filed: {new Date(activeTask.dispute.requestedAt).toLocaleString()}
                </span>
              </div>
            )}

            <form onSubmit={handleSaveResolveDispute} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">Decision *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDisputeDecision('accept')}
                    className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                      disputeDecision === 'accept'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-400'
                    }`}
                  >
                    ✅ Accept Dispute{disputeDecision === 'accept' ? ' (adjust score)' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisputeDecision('reject')}
                    className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                      disputeDecision === 'reject'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-rose-400'
                    }`}
                  >
                    🚫 Reject Dispute
                  </button>
                </div>
              </div>

              {disputeDecision === 'accept' && (
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Revised Score (%) *</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={disputeRevisedScore}
                    onChange={e => setDisputeRevisedScore(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    The revised score replaces the evaluated score for this report. Provide a superior note justifying the adjustment.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">Superior Resolution Notes *</label>
                <textarea
                  rows={3}
                  required
                  value={disputeResolutionNote}
                  onChange={e => setDisputeResolutionNote(e.target.value)}
                  placeholder="Explain the basis for this final decision so the staff understands the outcome..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsResolvingDispute(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" /> {disputeDecision === 'accept' ? 'Accept & Update Score' : 'Reject Dispute'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manager Administrative Unlock Modal for Defaulted TRS Task */}
      {unlockTargetTask && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setUnlockTargetTask(null);
          }}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5 shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300">
                  <Unlock className="w-5 h-5 text-amber-800" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Manager Administrative Unlock
                  </h3>
                  <p className="text-xs text-slate-500">
                    Task: <strong>{unlockTargetTask.title}</strong> • Assigned To: <strong>{unlockTargetTask.assignedToName}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnlockTargetTask(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
                title="Close (Esc)"
                aria-label="Close unlock modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUnlock} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
                <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-950 space-y-1">
                  <strong className="block font-bold">Policy Compliance Notice:</strong>
                  <p>
                    Unlocking this task removes the 0% auto-lock default and unlocks submission so the staff member can deliver their required work. All administrative unlocks are permanently logged in the audit trail with your identity, timestamp, and justification.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Mandatory Audit Justification *
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={unlockReason}
                    onChange={(e) => setUnlockReason(e.target.value)}
                    placeholder="e.g. Documented operational dependency delay, approved retroactive deadline waiver, or external blocker resolved..."
                    className="w-full text-xs p-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white text-slate-900 font-medium"
                  />
                </div>

                <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={unlockWaivePenalty}
                    onChange={(e) => setUnlockWaivePenalty(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-900 block">Waive Timeliness Score Penalty</span>
                    <span className="text-[11px] text-slate-500">
                      If checked, staff receives full 40/40 punctuality score. If unchecked, timeliness score remains at standard late decay (0/40).
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50/90 shrink-0">
                <button
                  type="button"
                  onClick={() => setUnlockTargetTask(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!unlockReason.trim() || unlockSaving}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {unlockSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />} {unlockSaving ? 'Unlocking...' : 'Confirm & Unlock Deliverable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
