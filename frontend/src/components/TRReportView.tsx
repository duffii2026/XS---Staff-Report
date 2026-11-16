import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, WeeklyReport, RoleTemplate, SubmittedChecklistItem, SignatureData, ChecklistItemStatus, ChecklistFrequency, MultiProofData, hasUserPermission, TeamSummaryRecord } from '../types';
import {
  isAnytime,
  isMonthlyCycle,
  isYearlyCycle,
  allowsNA,
  defaultItemStatus,
  frequencyBadgeClass,
  frequencyBadgeClassFlat,
  frequencyLabel,
  frequencyRuleHint
} from '../utils/checklistFrequency';
import {
  computePillar1,
  clampBase,
  clampPillar1,
  clampPillar2,
  TR_PILLAR1_MAX,
  TR_PILLAR2_MAX,
  TR_PILLAR3_MAX,
  TR_BASE_MAX
} from '../utils/trScoring';
import { SignatureImage } from './SignatureImage';
import { showDialog, confirmDialog } from './GlobalDialog';
import {
  getWeekDateRange,
  YEAR_OPTIONS,
  formatDateRange,
  getWeekNumberFromDate,
  parseISODate,
  formatISODate,
  getMonthInfoForWeek,
  getTRSubmissionDeadline,
  formatDateTimeFriendly,
  getReportingMonthKey,
  getReportingYearlyCycleKey,
  isFinalMonthOfReportingYear
} from '../utils/dateUtils';
import {
  getVisibleReportsForUser,
  saveReport,
  deleteReport,
  getTemplateForPosition,
  getUsers,
  getSubordinateUserIds,
  getTRDraft,
  isDraftStaleForTemplate,
  saveTRDraft,
  clearTRDraft,
  submitScoreDispute,
  resolveScoreDispute,
  requestTRExtension,
  reviewTRExtension,
  calculateWorkingDaysElapsed,
  refreshReports
} from '../services/storage';
import { getDaysDifferenceFromToday } from '../services/deadlineAlertService';
import { SignatureCanvas, SignatureCanvasHandle } from './SignatureCanvas';
import { MultiProofUploader, uploadPendingProofs, stripPendingProofs } from './MultiProofUploader';
import {
  CheckSquare,
  Check,
  Sparkles,
  Calendar,
  CheckCircle2,
  XCircle,
  MinusCircle,
  FileText,
  UserCheck,
  Award,
  Clock,
  Copy,
  Save,
  Send,
  Plus,
  RefreshCw,
  Eye,
  Filter,
  Search,
  X,
  SlidersHorizontal,
  ArrowLeft,
  Edit2,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Paperclip,
  User as UserIcon,
  Users,
  AlertTriangle,
  HelpCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  History
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';
import { WeeklySummaryForm, EMPTY_SUMMARY, validateWeeklySummary, stripEmptyEntries } from './WeeklySummaryForm';
import { WeeklySummary } from '../types';
import { saveWeeklySummary, fetchWeeklySummary } from '../services/storage';
import { api } from '../services/api';

const TR_WEEK_OPTIONS = Array.from({ length: 53 }, (_, i) => i + 1);
const TEAM_SUMMARY_PAGE_SIZE = 20;

interface TRReportViewProps {
  currentUser: User;
  pageMode?: 'new' | 'edit';
  initialEditId?: string;
  onExit?: () => void;
  /** True while the T&R tab is the visible one. Drives the on-activation refresh. */
  isActive?: boolean;
}

interface PillarCell {
  label: string;
  value: string;
  max: number | null;
  tone: 'emerald' | 'blue' | 'amber' | 'slate';
  note?: string;
}

const PILLAR_TONES: Record<PillarCell['tone'], { text: string; chip: string; ring: string }> = {
  emerald: { text: 'text-emerald-700', chip: 'bg-emerald-100 text-emerald-800', ring: 'ring-emerald-200' },
  blue: { text: 'text-blue-700', chip: 'bg-blue-100 text-blue-800', ring: 'ring-blue-200' },
  amber: { text: 'text-amber-800', chip: 'bg-amber-200 text-amber-900', ring: 'ring-amber-300' },
  slate: { text: 'text-slate-600', chip: 'bg-slate-200 text-slate-700', ring: 'ring-slate-200' },
};

/**
 * Big, scannable per-pillar score breakdown.
 *
 * Replaces the old single run-on line of 10px text ("Checklist: 50/50 • Timeliness:
 * 20/20 • Superior: Pending (+30 pts)"), which was too small to read at a glance.
 * Each pillar is its own cell with a large numeral, the earned/max pair, and an
 * optional note (e.g. the waiver marker), so the three components of the 100-point
 * total are individually legible instead of competing on one line.
 */
const PillarBreakdown: React.FC<{ cells: PillarCell[] }> = ({ cells }) => (
  <div className="grid grid-cols-3 gap-1 w-full mt-1.5">
    {cells.map(c => {
      const tone = PILLAR_TONES[c.tone];
      return (
        <div
          key={c.label}
          className={`flex flex-col items-center justify-center gap-px rounded-md bg-white/70 px-1 py-1 ring-1 ${tone.ring}`}
        >
          <span className="text-[8px] font-bold uppercase tracking-wide text-slate-500 text-center leading-tight">
            {c.label}
          </span>
          <span className={`text-xs font-black leading-none ${tone.text}`}>
            {c.value}
            {c.max !== null && (
              <span className="text-[9px] font-bold text-slate-400">/{c.max}</span>
            )}
          </span>
          {c.note ? (
            <span className={`text-[8px] font-bold px-1 py-px rounded-full ${tone.chip}`}>
              {c.note}
            </span>
          ) : null}
        </div>
      );
    })}
  </div>
);

export const TRReportView: React.FC<TRReportViewProps> = ({ currentUser, pageMode, initialEditId, onExit, isActive = true }) => {
  const pageModeRef = useRef(pageMode);
  pageModeRef.current = pageMode;
  const skipNextAutosaveRef = useRef(false);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [activeReport, setActiveReport] = useState<WeeklyReport | null>(null);
  const [trSubTab, setTrSubTab] = useState<'my_reports' | 'subordinate_reports'>('my_reports');
  const [isCreating, setIsCreating] = useState(false);
  const [showMonthEndReminder, setShowMonthEndReminder] = useState(false);
  const [showMonthlyDeliverables, setShowMonthlyDeliverables] = useState(false);
  const [showYearEndReminder, setShowYearEndReminder] = useState(false);
  const [showYearlyDeliverables, setShowYearlyDeliverables] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  // Default the New Weekly T&R Report Submission to the Monday of the CURRENT week
  // so "From Date (Start)" always opens on the week's Monday instead of a stale date.
  const defaultWeekInfo = getWeekNumberFromDate(formatISODate(new Date()));
  const defaultWeekRange = getWeekDateRange(defaultWeekInfo.weekNumber, defaultWeekInfo.year);
  const [selectedWeek, setSelectedWeek] = useState<number>(defaultWeekInfo.weekNumber);
  const [selectedQuarter, setSelectedQuarter] = useState<number>(defaultWeekInfo.quarter);
  const [selectedYear, setSelectedYear] = useState<number>(defaultWeekInfo.year);
  const [startDateInput, setStartDateInput] = useState<string>(defaultWeekRange.startDate);
  const [endDateInput, setEndDateInput] = useState<string>(defaultWeekRange.endDate);

  const handleQuarterChange = (q: number) => {
    setSelectedQuarter(q);
    const startWeekOfQuarter = (q - 1) * 13 + 1;
    const endWeekOfQuarter = q * 13;
    let newWeek = selectedWeek;
    if (selectedWeek < startWeekOfQuarter || selectedWeek > endWeekOfQuarter) {
      newWeek = startWeekOfQuarter;
    }
    handleWeekChange(newWeek, q);
  };

  const handleWeekChange = (w: number, forcedQuarter?: number) => {
    setSelectedWeek(w);
    const q = forcedQuarter ?? Math.ceil(w / 13);
    setSelectedQuarter(q);
    const range = getWeekDateRange(w, selectedYear);
    setStartDateInput(range.startDate);
    setEndDateInput(range.endDate);
  };

  const handleYearChange = (y: number) => {
    setSelectedYear(y);
    const range = getWeekDateRange(selectedWeek, y);
    setStartDateInput(range.startDate);
    setEndDateInput(range.endDate);
  };

  const handleStartDateChange = (dateVal: string) => {
    if (!dateVal || dateVal.length !== 10) {
      setStartDateInput(dateVal);
      return;
    }
    // The "From Date" must always be the Monday that opens the selected week:
    // snap any picked day to the ISO Monday so the report always starts on Monday.
    const info = getWeekNumberFromDate(dateVal);
    const range = getWeekDateRange(info.weekNumber, info.year);
    setStartDateInput(range.startDate);
    setSelectedWeek(info.weekNumber);
    setSelectedYear(info.year);
    setSelectedQuarter(info.quarter);
    setEndDateInput(range.endDate);
  };

  const handleEndDateChange = (dateVal: string) => {
    setEndDateInput(dateVal);
  };

  // Form states for report submission
  const [checklistState, setChecklistState] = useState<SubmittedChecklistItem[]>([]);
  const [reportNotes, setReportNotes] = useState('');
  // Weekly Summary Form (IRG-HR-FRM-WSUM-001 v1.1, Sections A-J)
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary>(EMPTY_SUMMARY);
  // Read-only copy rendered in the report detail view (superior review screen).
  const [viewSummary, setViewSummary] = useState<WeeklySummary | null>(null);
  // Guards the async summary fetch against a stale response overwriting a newer pick.
  const summaryReqRef = useRef('');
  const [signature, setSignature] = useState<SignatureData | undefined>(undefined);
  const signatureCanvasRef = useRef<SignatureCanvasHandle>(null);
  const periodSectionRef = useRef<HTMLDivElement>(null);
  const [aiSummaryText, setAiSummaryText] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  // Chat-style consolidated summaries for selected subordinate reports.
  const [selectedSubReportIds, setSelectedSubReportIds] = useState<Set<string>>(new Set());
  const [isTeamSummaryOpen, setIsTeamSummaryOpen] = useState(false);
  const [teamSummaryHistory, setTeamSummaryHistory] = useState<TeamSummaryRecord[]>([]);
  const [isLoadingTeamSummaryHistory, setIsLoadingTeamSummaryHistory] = useState(false);
  const [isGeneratingTeamSummary, setIsGeneratingTeamSummary] = useState(false);
  const [teamSummaryError, setTeamSummaryError] = useState('');
  const [pendingSummaryReports, setPendingSummaryReports] = useState<WeeklyReport[]>([]);
  const [copiedSummaryCode, setCopiedSummaryCode] = useState<string | null>(null);
  const [summaryHistorySearch, setSummaryHistorySearch] = useState('');
  const [summaryHistoryFrom, setSummaryHistoryFrom] = useState('');
  const [summaryHistoryTo, setSummaryHistoryTo] = useState('');
  const [teamSummaryTotal, setTeamSummaryTotal] = useState(0);
  const [teamSummaryHasMore, setTeamSummaryHasMore] = useState(false);
  const [isLoadingMoreTeamSummaries, setIsLoadingMoreTeamSummaries] = useState(false);
  const [deletingSummaryCode, setDeletingSummaryCode] = useState<string | null>(null);
  const teamSummaryScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isTeamSummaryOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsTeamSummaryOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTeamSummaryOpen]);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [multiProof, setMultiProof] = useState<MultiProofData>({ files: [], cloudLinks: [], telegramLinks: [] });
  const [lastDraftTime, setLastDraftTime] = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [showFormDeadlineDetails, setShowFormDeadlineDetails] = useState(false);

  // Score Dispute State
  const [isDisputing, setIsDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [isResolvingDispute, setIsResolvingDispute] = useState(false);
  const [disputeDecision, setDisputeDecision] = useState<'accept' | 'reject'>('accept');
  const [disputeResolutionNote, setDisputeResolutionNote] = useState('');
  const [disputeRevisedScore, setDisputeRevisedScore] = useState<number>(85);

  // States for customizing checklist items in draft mode
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemCat, setNewItemCat] = useState<ChecklistFrequency>('Weekly');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemTitleText, setEditingItemTitleText] = useState('');

  // Superior Review Modal State
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<'Submitted' | 'Reviewed' | 'Approved'>('Approved');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewQualityScore, setReviewQualityScore] = useState<number>(30);
  const [reviewWaiveLatePenalty, setReviewWaiveLatePenalty] = useState(false);
  const [isSavingReview, setIsSavingReview] = useState(false);

  // Delete Confirmation Modal State
  const [reportToDelete, setReportToDelete] = useState<WeeklyReport | null>(null);

  // T&R Deadline Extension States
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const [extensionTargetReport, setExtensionTargetReport] = useState<WeeklyReport | null>(null);
  const [extensionRequestedDeadline, setExtensionRequestedDeadline] = useState('');
  const [extensionReason, setExtensionReason] = useState('');
  const [isSubmittingExtension, setIsSubmittingExtension] = useState(false);

  // Uncontrolled refs for the extension modal inputs — keep typing local to the DOM
  // so keystrokes don't re-render the entire TRReportView tree (fixes input lag).
  const extensionDeadlineInputRef = useRef<HTMLInputElement | null>(null);
  const extensionReasonInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [isReviewExtensionModalOpen, setIsReviewExtensionModalOpen] = useState(false);
  const [extensionReviewReport, setExtensionReviewReport] = useState<WeeklyReport | null>(null);
  const [extensionReviewDecision, setExtensionReviewDecision] = useState<'Approved' | 'Rejected'>('Approved');
  const [extensionReviewNote, setExtensionReviewNote] = useState('');
  const [isSavingExtensionReview, setIsSavingExtensionReview] = useState(false);

  // Global Escape key listener to close any open extension modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isSavingExtensionReview || isSavingReview) return;
      if (isExtensionModalOpen) setIsExtensionModalOpen(false);
      else if (isReviewExtensionModalOpen) setIsReviewExtensionModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExtensionModalOpen, isReviewExtensionModalOpen, isSavingExtensionReview, isSavingReview]);

  // Submit Conflict Dialog State (server rejected the report as a duplicate — 409)
  const [submitConflict, setSubmitConflict] = useState<{ message: string } | null>(null);
  // Keeps the From/To date fields highlighted red until the user actually edits a date
  const [conflictHighlight, setConflictHighlight] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  // Live proof-file upload status shown in the fixed bottom overlay while a
  // submit/save is pushing files to S3 (null = nothing in flight).
  const [submitStatus, setSubmitStatus] = useState<{
    label: string;
    detail?: string;
    percent: number;
  } | null>(null);

  // Subordinate Staff Filtering States (for Superiors with many staff)
  const [subordinateStaffFilter, setSubordinateStaffFilter] = useState<string>('all');
  const [subordinateStatusFilter, setSubordinateStatusFilter] = useState<string>('all');
  const [subordinateWeekFilter, setSubordinateWeekFilter] = useState<string>('all');
  const [subordinateYearFilter, setSubordinateYearFilter] = useState<string>('all');
  const [subordinateSearchQuery, setSubordinateSearchQuery] = useState<string>('');
  const [showRubric, setShowRubric] = useState<boolean>(true);
  const [showDeadlineDetails, setShowDeadlineDetails] = useState<boolean>(false);

  const loadData = () => {
    const list = getVisibleReportsForUser(currentUser);
    setReports(list);

    // Keep activeReport if it's still in scope for the current tab, else pick within scope
    const inScope = (r: WeeklyReport) =>
      trSubTab === 'my_reports' ? r.staffId === currentUser.id : directSubIds.has(r.staffId);
    const isStillVisible = activeReport && inScope(activeReport) && list.some(r => r.id === activeReport.id);
    if (!isStillVisible) {
      setActiveReport(list.find(inScope) || null);
    }
  };

  const allUsers = getUsers();
  // Memoised: these were rebuilt from scratch on every keystroke/selection,
  // re-walking the whole org chart and re-filtering the full report list.
  const hasSubordinates = useMemo(() => getSubordinateUserIds(currentUser.id).size > 0, [currentUser.id, allUsers]);
  // Show the "Subordinate Reports" sub-tab whenever the user can review team T&R
  // reports — even if the org chart has no direct reports recorded — mirroring
  // the TRS tab. Only the generic super-admin account (username === 'admin') is excluded.
  const canViewTeamTR = hasUserPermission(currentUser, 'viewTeamTRReports');
  const showSubTabs = (hasSubordinates || canViewTeamTR) && currentUser.username !== 'admin';

  // Direct reports only (e.g., Mr. SN has exactly 6): the "Subordinate T&R
  // Reports" tab only ever shows the current user's own team.
  const directSubIds = useMemo(
    () => new Set(allUsers.filter(u => u.superiorId === currentUser.id).map(u => u.id)),
    [allUsers, currentUser.id]
  );
  const subordinateVisibleReports = useMemo(
    () => reports.filter(r => directSubIds.has(r.staffId)),
    [reports, directSubIds]
  );
  const subordinateYearOptions = useMemo(() => {
    const years = new Set<number>();
    subordinateVisibleReports.forEach(r => years.add(r.year));
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [subordinateVisibleReports]);
  const subordinateFilteredReports = useMemo(() => {
    let filtered = subordinateVisibleReports;
    if (subordinateStaffFilter !== 'all') {
      filtered = filtered.filter(r => r.staffId === subordinateStaffFilter);
    }
    if (subordinateStatusFilter !== 'all') {
      filtered = filtered.filter(r => (r.status || 'Submitted') === subordinateStatusFilter);
    }
    if (subordinateYearFilter !== 'all') {
      filtered = filtered.filter(r => r.year === Number(subordinateYearFilter));
    }
    if (subordinateWeekFilter !== 'all') {
      filtered = filtered.filter(r => r.weekNumber === Number(subordinateWeekFilter));
    }
    if (subordinateSearchQuery.trim()) {
      const q = subordinateSearchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.staffName.toLowerCase().includes(q) ||
        r.position.toLowerCase().includes(q) ||
        `w${r.weekNumber}`.includes(q) ||
        `week ${r.weekNumber}`.includes(q) ||
        r.year.toString().includes(q)
      );
    }
    return filtered;
  }, [subordinateVisibleReports, subordinateStaffFilter, subordinateStatusFilter, subordinateWeekFilter, subordinateYearFilter, subordinateSearchQuery]);
  const visibleSubReportIds = useMemo(
    () => subordinateFilteredReports.map(r => r.id),
    [subordinateFilteredReports]
  );
  const allVisibleSubReportsSelected =
    visibleSubReportIds.length > 0 && visibleSubReportIds.every(id => selectedSubReportIds.has(id));
  const selectedSubReportCount = selectedSubReportIds.size;

  useEffect(() => {
    if (trSubTab !== 'subordinate_reports') {
      setSelectedSubReportIds(prev => (prev.size ? new Set() : prev));
      return;
    }
    const valid = new Set(subordinateVisibleReports.map(r => r.id));
    setSelectedSubReportIds(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [trSubTab, subordinateVisibleReports]);

  const toggleSubReportSelection = (reportId: string) => {
    setSelectedSubReportIds(prev => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  };

  const toggleSelectAllVisibleSubReports = () => {
    setSelectedSubReportIds(prev => {
      const next = new Set(prev);
      if (allVisibleSubReportsSelected) {
        visibleSubReportIds.forEach(id => next.delete(id));
      } else {
        visibleSubReportIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const scrollTeamSummaryToBottom = () => {
    setTimeout(() => {
      const el = teamSummaryScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 60);
  };

  const fetchTeamSummaryHistory = async (opts: {
    append?: boolean;
    filters?: { search?: string; from?: string; to?: string };
  } = {}) => {
    const append = !!opts.append;
    const search = opts.filters?.search ?? summaryHistorySearch;
    const from = opts.filters?.from ?? summaryHistoryFrom;
    const to = opts.filters?.to ?? summaryHistoryTo;
    const params = new URLSearchParams();
    params.set('limit', String(TEAM_SUMMARY_PAGE_SIZE));
    if (append) {
      const oldest = teamSummaryHistory[teamSummaryHistory.length - 1];
      if (oldest?.id) params.set('beforeId', String(oldest.id));
    }
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (search.trim()) params.set('q', search.trim());
    const res = await api.get<{
      summaries: TeamSummaryRecord[];
      total: number;
      hasMore: boolean;
    }>(`/ai/team-summaries?${params.toString()}`);
    const list = Array.isArray(res?.summaries) ? res.summaries : [];
    setTeamSummaryHistory(prev => {
      if (!append) return list;
      const seen = new Set(prev.map(s => s.code));
      return [...prev, ...list.filter(s => !seen.has(s.code))];
    });
    setTeamSummaryTotal(Number(res?.total) || 0);
    setTeamSummaryHasMore(!!res?.hasMore);
  };

  const openTeamSummaryHistory = async () => {
    setIsTeamSummaryOpen(true);
    setTeamSummaryError('');
    setIsLoadingTeamSummaryHistory(true);
    try {
      await fetchTeamSummaryHistory();
      scrollTeamSummaryToBottom();
    } catch (e: any) {
      setTeamSummaryError(e?.message || 'Could not load summary history.');
    } finally {
      setIsLoadingTeamSummaryHistory(false);
    }
  };

  const applyTeamSummaryFilters = async (filters?: { search?: string; from?: string; to?: string }) => {
    if (filters?.search !== undefined) setSummaryHistorySearch(filters.search);
    if (filters?.from !== undefined) setSummaryHistoryFrom(filters.from);
    if (filters?.to !== undefined) setSummaryHistoryTo(filters.to);
    setIsLoadingTeamSummaryHistory(true);
    setTeamSummaryError('');
    try {
      await fetchTeamSummaryHistory({ filters });
      scrollTeamSummaryToBottom();
    } catch (e: any) {
      setTeamSummaryError(e?.message || 'Could not load summary history.');
    } finally {
      setIsLoadingTeamSummaryHistory(false);
    }
  };

  const applyTeamSummaryDatePreset = (preset: 'all' | '7d' | '30d' | 'month') => {
    let from = '';
    let to = '';
    if (preset === '7d' || preset === '30d') {
      const days = preset === '7d' ? 7 : 30;
      const start = new Date();
      start.setDate(start.getDate() - (days - 1));
      from = formatISODate(start);
      to = formatISODate(new Date());
    } else if (preset === 'month') {
      const now = new Date();
      from = formatISODate(new Date(now.getFullYear(), now.getMonth(), 1));
      to = formatISODate(now);
    }
    setSummaryHistoryFrom(from);
    setSummaryHistoryTo(to);
    void applyTeamSummaryFilters({ from, to });
  };

  const clearTeamSummaryFilters = () => {
    setSummaryHistorySearch('');
    setSummaryHistoryFrom('');
    setSummaryHistoryTo('');
    void applyTeamSummaryFilters({ search: '', from: '', to: '' });
  };

  const handleLoadMoreTeamSummaries = async () => {
    const el = teamSummaryScrollRef.current;
    const previousHeight = el?.scrollHeight || 0;
    const previousTop = el?.scrollTop || 0;
    setIsLoadingMoreTeamSummaries(true);
    setTeamSummaryError('');
    try {
      await fetchTeamSummaryHistory({ append: true });
      setTimeout(() => {
        if (!el) return;
        el.scrollTop = el.scrollHeight - previousHeight + previousTop;
      }, 60);
    } catch (e: any) {
      setTeamSummaryError(e?.message || 'Could not load older summaries.');
    } finally {
      setIsLoadingMoreTeamSummaries(false);
    }
  };

  const handleGenerateTeamSummary = async () => {
    const selectedReports = reports.filter(r => selectedSubReportIds.has(r.id));
    if (selectedReports.length === 0) return;
    if (selectedReports.length > 20) {
      setTeamSummaryError('Select no more than 20 reports at a time.');
      return;
    }
    setIsTeamSummaryOpen(true);
    setTeamSummaryError('');
    setPendingSummaryReports(selectedReports);
    setIsGeneratingTeamSummary(true);
    setIsLoadingTeamSummaryHistory(true);
    try {
      try {
        await fetchTeamSummaryHistory();
      } catch {
      }
      const res = await api.post<{ summary: TeamSummaryRecord }>('/ai/team-summaries', {
        reportCodes: selectedReports.map(r => r.id)
      });
      if (res?.summary) {
        setTeamSummaryHistory(prev => [res.summary, ...prev.filter(s => s.code !== res.summary.code)]);
        setTeamSummaryTotal(prev => prev + 1);
        setSelectedSubReportIds(new Set());
      }
      scrollTeamSummaryToBottom();
    } catch (e: any) {
      setTeamSummaryError(e?.message || 'Could not generate the summary.');
    } finally {
      setIsGeneratingTeamSummary(false);
      setIsLoadingTeamSummaryHistory(false);
      setPendingSummaryReports([]);
    }
  };

  const handleDeleteTeamSummary = async (record: TeamSummaryRecord) => {
    const confirmed = await confirmDialog(
      'Delete this saved summary? This cannot be undone.',
      { title: 'Delete Summary', confirmText: 'Delete' }
    );
    if (!confirmed) return;
    setDeletingSummaryCode(record.code);
    setTeamSummaryError('');
    try {
      await api.del(`/ai/team-summaries/${encodeURIComponent(record.code)}`);
      setTeamSummaryHistory(prev => prev.filter(s => s.code !== record.code));
      setTeamSummaryTotal(prev => Math.max(0, prev - 1));
      if (teamSummaryHistory.length <= 1 && teamSummaryHasMore) {
        await fetchTeamSummaryHistory();
      }
    } catch (e: any) {
      setTeamSummaryError(e?.message || 'Could not delete the summary.');
    } finally {
      setDeletingSummaryCode(null);
    }
  };

  const handleCopyTeamSummary = async (record: TeamSummaryRecord) => {
    try {
      await navigator.clipboard.writeText(record.summaryText || '');
      setCopiedSummaryCode(record.code);
      setTimeout(() => {
        setCopiedSummaryCode(prev => (prev === record.code ? null : prev));
      }, 2000);
    } catch {
    }
  };

  const subordinatePendingCount = useMemo(
    () => subordinateVisibleReports.filter((r) => r.status === 'Submitted').length,
    [subordinateVisibleReports]
  );

  // The T&R tab stays MOUNTED (just hidden) while other tabs are shown, so
  // switching back never remounts this view and nothing refetches — users were
  // seeing stale/missing rows and had to hard-refresh. Re-pull the report list
  // every time the tab is re-activated.
  const hadActiveRef = useRef(false);
  useEffect(() => {
    if (!isActive) {
      hadActiveRef.current = false;
      return;
    }
    const returningToTab = hadActiveRef.current;
    hadActiveRef.current = true;

    // First activation right after boot is already covered by the initial
    // hydration — only force a refetch then if the list came back empty.
    if (!returningToTab && getVisibleReportsForUser(currentUser).length > 0) return;

    let alive = true;
    (async () => {
      await refreshReports();
      if (alive) loadData();
    })();
    return () => { alive = false; };
  }, [isActive]);

  useEffect(() => {
    if (pageModeRef.current) return;
    const list = getVisibleReportsForUser(currentUser);
    setReports(list);

    const subReps = list.filter(r => directSubIds.has(r.staffId));
    const myReps = list.filter(r => r.staffId === currentUser.id);

    if (showSubTabs && subReps.length > 0 && currentUser.role !== 'staff') {
      setTrSubTab('subordinate_reports');
      setActiveReport(subReps[0]);
    } else {
      setTrSubTab('my_reports');
      setActiveReport(myReps[0] || null);
    }

    setIsCreating(false);
    setEditingReportId(null);
  }, [currentUser]);

  // Handle starting a new weekly report draft
  const handleStartNewReport = () => {
    setEditingReportId(null);
    setNewItemTitle('');
    setEditingItemId(null);
    const range = getWeekDateRange(selectedWeek, selectedYear);
    setStartDateInput(range.startDate);
    setEndDateInput(range.endDate);

    const template = getTemplateForPosition(currentUser.position, currentUser.department);
    const existingDraft = getTRDraft(currentUser.id, selectedYear, selectedWeek);

    // A draft is only trustworthy while it still matches the JD template it was built
    // from. If the staff member's position/department changed, or the template was
    // re-uploaded, restoring it verbatim would load another role's deliverables.
    const draftIsStale = !!existingDraft && !!existingDraft.checklistItems &&
      isDraftStaleForTemplate(existingDraft.checklistItems, template);

    if (existingDraft && existingDraft.checklistItems && existingDraft.checklistItems.length > 0 && !draftIsStale) {
      setChecklistState(existingDraft.checklistItems);
      setReportNotes(existingDraft.notes || '');
      setWeeklySummary({ ...EMPTY_SUMMARY, ...(existingDraft.summary || {}) });
      setMultiProof(existingDraft.multiProof || { files: [], cloudLinks: [], telegramLinks: [] });
      setSignature(existingDraft.signature);
      setLastDraftTime(existingDraft.lastSavedAt ? new Date(existingDraft.lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Restored');
      setFeedbackMsg('Restored previously auto-saved content for this week.');
      setTimeout(() => setFeedbackMsg(''), 3000);
    } else {
      if (draftIsStale) {
        // Drop the mismatched draft so it cannot come back on the next visit.
        clearTRDraft(currentUser.id, selectedYear, selectedWeek).catch(() => {});
      }
      const defaultItems: SubmittedChecklistItem[] = template
        ? template.items.map(it => ({
            itemId: it.id,
            title: it.title,
            category: it.category,
            // Monthly/Anytime start as N/A (not scheduled this week); Weekly start unticked.
            completed: false,
            status: defaultItemStatus(it.category),
            note: ''
          }))
        : [];

      setChecklistState(defaultItems);
      setReportNotes('');
      setWeeklySummary(EMPTY_SUMMARY);
      setDelayReason('');
      setMultiProof({ files: [], cloudLinks: [], telegramLinks: [] });
      setSignature(undefined);
      setLastDraftTime(null);
      if (draftIsStale) {
        setFeedbackMsg(`Your saved draft was built from an older checklist and has been discarded. Loaded the current JD checklist for "${currentUser.position}" (${template?.items.length || 0} deliverables).`);
        setTimeout(() => setFeedbackMsg(''), 8000);
      }
    }

    setAiSummaryText('');
    setShowMobileDetail(true);
    setIsCreating(true);
  };

  // Sync / Reload from latest Official JD Position Template
  const handleSyncWithOfficialTemplate = () => {
    const rep = editingReportId ? reports.find(r => r.id === editingReportId) : null;
    const targetPos = rep ? rep.position : currentUser.position;
    const targetDept = rep ? rep.department : currentUser.department;
    const targetUserId = rep ? rep.staffId : currentUser.id;

    const template = getTemplateForPosition(targetPos, targetDept);
    if (!template || !template.items || template.items.length === 0) {
      showDialog(`No official JD template deliverables registered yet for "${targetPos}" (${targetDept}). Please configure the template in the Admin Console.`);
      return;
    }

    const newItems: SubmittedChecklistItem[] = template.items.map(it => ({
      itemId: it.id,
      title: it.title,
      category: it.category,
      completed: false,
      status: defaultItemStatus(it.category),
      note: ''
    }));

    setChecklistState(newItems);
      clearTRDraft(targetUserId, selectedYear, selectedWeek).catch(() => {});
    setLastDraftTime(null);
    setFeedbackMsg(`✨ Successfully reloaded ${newItems.length} deliverables from Official JD Template for ${targetPos}!`);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  const handleCopyNotesFromPreviousReport = () => {
    const userPriorReports = reports
      .filter(r => r.staffId === currentUser.id && (r.year < selectedYear || (r.year === selectedYear && r.weekNumber < selectedWeek)))
      .sort((a, b) => (b.year * 100 + b.weekNumber) - (a.year * 100 + a.weekNumber));

    if (userPriorReports.length === 0) {
      showDialog("No prior weekly report found for your account to copy notes from.");
      return;
    }

    const prevRep = userPriorReports[0];
    let copiedCount = 0;

    const updatedChecklist = checklistState.map(curItem => {
      const matched = prevRep.checklistItems.find(p =>
        (p.itemId && curItem.itemId && p.itemId === curItem.itemId) ||
        p.title.trim().toLowerCase() === curItem.title.trim().toLowerCase()
      );
      if (matched && matched.note && matched.note.trim()) {
        copiedCount++;
        return {
          ...curItem,
          note: matched.note
        };
      }
      return curItem;
    });

    setChecklistState(updatedChecklist);
    setFeedbackMsg(`📋 Successfully copied routine progress notes from Week ${prevRep.weekNumber} (${prevRep.year}) across ${copiedCount} checklist item(s)! Checkboxes remain fresh for this week.`);
    setTimeout(() => setFeedbackMsg(''), 5000);
  };

  const handleDiscardDraftAndReset = async () => {
    if (!(await confirmDialog('Are you sure you want to discard this auto-save and reset to the latest Official JD checklist?', { title: 'Discard Auto-save', confirmText: 'Discard & Reset' }))) {
      return;
    }
    const rep = editingReportId ? reports.find(r => r.id === editingReportId) : null;
    const targetPos = rep ? rep.position : currentUser.position;
    const targetDept = rep ? rep.department : currentUser.department;
    const targetUserId = rep ? rep.staffId : currentUser.id;

    skipNextAutosaveRef.current = true;

    let serverCleared = true;
    try {
      await clearTRDraft(targetUserId, selectedYear, selectedWeek);
    } catch {
      serverCleared = false;
    }

    // On the full-page route (#/tr/new, #/tr/edit/:id) the form is the entire page:
    // its "select a report" fallback has no left-hand list and no create button, so
    // resetting in place strands the user on a dead end. Discard, then go home.
    if (pageModeRef.current) {
      if (!serverCleared) {
        console.error('clearTRDraft: server delete failed; the draft may reappear after signing in again.');
      }
      window.location.hash = '';
      return;
    }

    setLastDraftTime(null);
    setReportNotes('');
    setWeeklySummary(EMPTY_SUMMARY);
    setDelayReason('');
    setMultiProof({ files: [], cloudLinks: [], telegramLinks: [] });
    setSignature(undefined);
    setShowMobileDetail(true);

    const template = getTemplateForPosition(targetPos, targetDept);
    if (template && template.items && template.items.length > 0) {
      const resetItems: SubmittedChecklistItem[] = template.items.map(it => ({
        itemId: it.id,
        title: it.title,
        category: it.category,
        completed: false,
        status: defaultItemStatus(it.category),
        note: ''
      }));
      setChecklistState(resetItems);
      setFeedbackMsg(`✅ Draft discarded and reset to the Official JD checklist (${resetItems.length} deliverables).`);
    } else {
      setChecklistState([]);
      setFeedbackMsg(`✅ Draft discarded. No official JD template registered yet for "${targetPos}" (${targetDept}) — add deliverables manually or configure the template in the Admin Console.`);
    }
    setIsCreating(false);
    setEditingReportId(null);
    setActiveReport(null);
    loadData();
    setTimeout(() => setFeedbackMsg(''), 5000);
  };

  // Draft Auto-Save Effect
  useEffect(() => {
    if (!isCreating || editingReportId) return;
    if (checklistState.length === 0) {
      // Nothing savable yet. Clear the skip flag here, otherwise a discard that
      // empties the checklist leaves it armed and it would swallow the user's
      // next genuine edit.
      skipNextAutosaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      // Consumed at fire time, not at schedule time: a discard resets several
      // pieces of state, and any render that happens before the timer lands would
      // otherwise clear the flag early and let the discarded draft be re-saved.
      if (skipNextAutosaveRef.current) {
        skipNextAutosaveRef.current = false;
        return;
      }
      saveTRDraft(currentUser.id, selectedYear, selectedWeek, {
        checklistItems: checklistState,
        notes: reportNotes,
        summary: weeklySummary,
        signature,
        // Pending (not yet uploaded) files stay in state only — their base64
        // payload is never persisted in the autosaved draft.
        multiProof: stripPendingProofs(multiProof)
      });
      setLastDraftTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 600);
    return () => clearTimeout(timer);
  }, [checklistState, reportNotes, weeklySummary, signature, multiProof, isCreating, editingReportId, selectedWeek, selectedYear, currentUser.id]);

  // Score Dispute Handlers
  const handleOpenDispute = (rep: WeeklyReport) => {
    setActiveReport(rep);
    setDisputeReason('');
    setIsDisputing(true);
  };

  const handleSubmitDispute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport) return;
    if (!disputeReason.trim()) {
      showDialog('Please provide a valid rationale for your score dispute.');
      return;
    }

    const res = submitScoreDispute('tr', activeReport.id, disputeReason.trim(), currentUser);
    if (res.success) {
      setFeedbackMsg(res.message);
      setIsDisputing(false);
      loadData();
      const updatedReports = getVisibleReportsForUser(currentUser);
      const updated = updatedReports.find(r => r.id === activeReport.id);
      if (updated) setActiveReport(updated);
    } else {
      showDialog(res.message);
    }
  };

  const handleOpenResolveDispute = (rep: WeeklyReport) => {
    setActiveReport(rep);
    setDisputeDecision('accept');
    setDisputeResolutionNote('');
    setDisputeRevisedScore(rep.trScore);
    setIsResolvingDispute(true);
  };

  const handleSaveResolveDispute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport) return;
    if (!disputeResolutionNote.trim()) {
      showDialog('Please provide superior notes explaining the dispute decision.');
      return;
    }

    const res = resolveScoreDispute(
      'tr',
      activeReport.id,
      disputeDecision,
      disputeResolutionNote.trim(),
      disputeDecision === 'accept' ? disputeRevisedScore : undefined,
      currentUser
    );

    if (res.success) {
      setFeedbackMsg(res.message);
      setIsResolvingDispute(false);
      loadData();
      const updatedReports = getVisibleReportsForUser(currentUser);
      const updated = updatedReports.find(r => r.id === activeReport.id);
      if (updated) setActiveReport(updated);
    } else {
      showDialog(res.message);
    }
  };

  // Load the Weekly Summary Form (own table) for an existing report.
  const loadWeeklySummary = async (reportCode: string) => {
    summaryReqRef.current = reportCode;
    const s = await fetchWeeklySummary(reportCode);
    if (s && summaryReqRef.current === reportCode) {
      setWeeklySummary({ ...EMPTY_SUMMARY, ...s });
    }
  };

  // Detail view (superior review screen): show the summary read-only.
  useEffect(() => {
    if (isCreating || !activeReport?.id) {
      setViewSummary(null);
      return;
    }
    let alive = true;
    fetchWeeklySummary(activeReport.id).then((s) => {
      if (alive) setViewSummary(s);
    });
    return () => { alive = false; };
  }, [activeReport?.id, isCreating]);

  // Handle editing an existing report (Staff editing own report OR Superior editing subordinate report)
  const handleEditReport = (rep: WeeklyReport) => {
    setEditingReportId(rep.id);
    setSelectedYear(rep.year);
    setSelectedQuarter(rep.quarter);
    setSelectedWeek(rep.weekNumber);
    setStartDateInput(rep.startDate);
    setEndDateInput(rep.endDate);
    setChecklistState(
      rep.checklistItems
        ? JSON.parse(JSON.stringify(rep.checklistItems)).map((it: SubmittedChecklistItem) => ({
            ...it,
            status: it.status || (it.completed ? 'completed' : 'incomplete')
          }))
        : []
    );
    setReportNotes(rep.notes || '');
    setWeeklySummary(rep.summary ? { ...EMPTY_SUMMARY, ...rep.summary } : EMPTY_SUMMARY);
    // Summary lives in its own table — always fetch it for the report being edited.
    loadWeeklySummary(rep.id);
    setDelayReason(rep.delayReason || '');
    setSignature(rep.signature);
    setAiSummaryText(rep.aiSummary || '');
    setMultiProof(rep.multiProof || { files: [], cloudLinks: [], telegramLinks: [] });
    setShowMobileDetail(true);
    setNewItemTitle('');
    setEditingItemId(null);
    setIsCreating(true);
  };

  // Full-page mode: auto-initialize the form once on mount (create or edit).
  useEffect(() => {
    if (!pageModeRef.current) return;
    window.scrollTo(0, 0);
    loadData();
    const rep = pageModeRef.current === 'edit' && initialEditId
      ? getVisibleReportsForUser(currentUser).find(r => r.id === initialEditId) || null
      : null;
    if (rep) {
      handleEditReport(rep);
    } else {
      handleStartNewReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle confirming report deletion
  const handleConfirmDeleteReport = () => {
    if (!reportToDelete) return;
    const inScope = (r: WeeklyReport) =>
      trSubTab === 'my_reports' ? r.staffId === currentUser.id : directSubIds.has(r.staffId);
    const scopedList = reports.filter(inScope);
    const deletedIdx = scopedList.findIndex(r => r.id === reportToDelete.id);
    let nextActive: WeeklyReport | null = null;
    if (deletedIdx >= 0) {
      nextActive = scopedList[deletedIdx + 1] || scopedList[deletedIdx - 1] || null;
    }
    deleteReport(reportToDelete.id, currentUser);
    setFeedbackMsg(`Deleted weekly T&R report of ${reportToDelete.staffName} (Week ${reportToDelete.weekNumber}).`);
    setReportToDelete(null);
    if (activeReport && activeReport.id === reportToDelete.id) {
      setActiveReport(nextActive);
    }
    loadData();
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  // May the current user manage (edit/delete) a weekly report? Yes for the
  // report author, management/admin, or the reporter's superior.
  const canManageReport = (r: WeeklyReport): boolean => {
    if (r.staffId === currentUser.id) return true;
    if (['admin', 'executive', 'hr'].includes(currentUser.role)) return true;
    return getSubordinateUserIds(currentUser.id).has(r.staffId);
  };

  // Month analysis for currently selected week and dates
  const currentMonthInfo = getMonthInfoForWeek(selectedWeek, selectedYear, startDateInput, endDateInput);
  const targetStaffId = editingReportId
    ? (reports.find(r => r.id === editingReportId)?.staffId || currentUser.id)
    : currentUser.id;

  // The month cycle this form belongs to, resolved from STABLE data.
  //
  // It must never come from `currentMonthInfo.weeksInMonth` / `selectedYear`, both of
  // which are rebuilt from the form's live date inputs: editing the From date reassigns
  // the selected week (see handleStartDateChange), which reassigns the month, which used
  // to drop an already-saved report's week out of the month window and silently UNLOCK a
  // monthly task the owner had already scheduled. When a persisted report is open we key
  // off that report's own period; only a brand-new form falls back to the typed dates.
  const activeReportRow = editingReportId ? reports.find(r => r.id === editingReportId) : undefined;
  const activeMonthKey = activeReportRow
    ? getReportingMonthKey(activeReportRow.startDate, activeReportRow.weekNumber, activeReportRow.year)
    : getReportingMonthKey(startDateInput, selectedWeek, selectedYear);
  const activeWeekNumber = activeReportRow ? activeReportRow.weekNumber : selectedWeek;

  // Reports by the same staff belonging to the same month cycle, at or before this week.
  // Each report is placed in a month by ITS OWN period, so date corrections elsewhere
  // cannot change the outcome.
  const otherMonthlyReports = reports.filter(
    r =>
      r.staffId === targetStaffId &&
      r.id !== editingReportId &&
      r.weekNumber <= activeWeekNumber &&
      getReportingMonthKey(r.startDate, r.weekNumber, r.year) === activeMonthKey
  );

  // The ANNUAL cycle this form belongs to. Same stability rule as activeMonthKey
  // above: persisted reports key off their OWN period. A cycle is the calendar
  // year except for January, which belongs to the previous cycle (the yearly
  // deliverable expires on 31 Jan of the new year).
  const activeYearlyCycleKey = activeReportRow
    ? getReportingYearlyCycleKey(activeReportRow.startDate, activeReportRow.weekNumber, activeReportRow.year)
    : getReportingYearlyCycleKey(startDateInput, selectedWeek, selectedYear);

  // Is this form sitting in the yearly cycle's final month (the first month of
  // the new calendar year)? If so, anything not yet fulfilled is mandatory and
  // can no longer be marked N/A.
  const isYearlyFinalMonth = activeReportRow
    ? isFinalMonthOfReportingYear(activeReportRow.startDate, activeReportRow.weekNumber, activeReportRow.year)
    : isFinalMonthOfReportingYear(startDateInput, selectedWeek, selectedYear);

  // Every other report by the same staff that belongs to the same yearly cycle.
  // No week ordering: the cycle spans a whole year, so week numbers are only
  // meaningful inside their own calendar year.
  const otherYearlyReports = reports.filter(
    r =>
      r.staffId === targetStaffId &&
      r.id !== editingReportId &&
      getReportingYearlyCycleKey(r.startDate, r.weekNumber, r.year) === activeYearlyCycleKey
  );

  // Helper to determine monthly task fulfillment in the active month
  const getMonthlyTaskMonthStatus = (item: SubmittedChecklistItem) => {
    if (!isMonthlyCycle(item.category)) return null;

    const itemTitle = (item.title || '').trim().toLowerCase();

    // Check if fulfilled in another report in strictly earlier weeks of this same month
    // MUST strictly have category === 'Monthly' AND status === 'completed'
    const doneReport = otherMonthlyReports.find(r =>
      r.checklistItems?.some(
        it =>
          it.category === 'Monthly' &&
          ((it.itemId && item.itemId && it.itemId === item.itemId) ||
           (!it.itemId && (it.title || '').trim().toLowerCase() === itemTitle)) &&
          it.status === 'completed'
      )
    );

    const isCompletedEarlier = !!doneReport;
    const completedEarlierWeek = doneReport ? doneReport.weekNumber : null;
    const isCurrentlyDoneInDraft = item.status === 'completed';
    const isFulfilledThisMonth = isCompletedEarlier || isCurrentlyDoneInDraft;

    // Is this the final week of the month?
    const isLastWeek = currentMonthInfo.isLastWeekOfMonth;
    // N/A is strictly blocked on final week IF not completed in earlier weeks of this month
    const isNaBlocked = isLastWeek && !isCompletedEarlier;

    return {
      isCompletedEarlier,
      completedEarlierWeek,
      isCurrentlyDoneInDraft,
      isFulfilledThisMonth,
      isLastWeek,
      isNaBlocked,
      monthName: currentMonthInfo.monthName,
      weekIndexInMonth: currentMonthInfo.weekIndexInMonth,
      totalWeeksInMonth: currentMonthInfo.totalWeeksInMonth
    };
  };

  // A Monthly deliverable is scheduled by its OWNER in exactly one week of the month,
  // and that first record "claims" it for the month. The claim is established by the
  // owner's own report for that month — Save as Draft is enough, because scheduling is
  // what claims the slot, not formal submission:
  //
  //     Owner saves a draft for Sep 28 - Oct 4, 2026 and marks the task Done
  //       -> that week stays fully editable (it is still just a draft)
  //       -> every OTHER week of that month shows the task Locked
  //       -> submitting the draft freezes it everywhere, including its own week
  //       -> a new month starts with no claim, so the task unlocks again
  //
  // Only the owner's own reports are consulted, so no superior or HR action can claim a
  // monthly deliverable on the owner's behalf. The localStorage auto-save draft is
  // merely editing in progress and is never a persisted report row, so it does not
  // claim anything either.
  const isMonthlyTaskClaimedByAnotherWeek = (item: SubmittedChecklistItem): boolean => {
    if (!isMonthlyCycle(item.category)) return false;
    const itemTitle = (item.title || '').trim().toLowerCase();
    return reports.some(r =>
      r.staffId === targetStaffId &&
      getReportingMonthKey(r.startDate, r.weekNumber, r.year) === activeMonthKey &&
      // The report being edited right now cannot lock itself while it is still a
      // draft — the owner must be able to revise their own scheduling. Once it has
      // been submitted the row does count, freezing the owner out of it.
      !(r.id === editingReportId && r.status === 'Draft') &&
      r.checklistItems?.some(it =>
        it.category === 'Monthly' &&
        it.status === 'completed' &&
        ((it.itemId && item.itemId && it.itemId === item.itemId) ||
          (!it.itemId && (it.title || '').trim().toLowerCase() === itemTitle))
      )
    );
  };

  /** The report that claimed a monthly deliverable for this month cycle, if any. */
  const findMonthlyClaimingReport = (item: SubmittedChecklistItem): WeeklyReport | undefined => {
    if (!isMonthlyCycle(item.category)) return undefined;
    const itemTitle = (item.title || '').trim().toLowerCase();
    return reports.find(r =>
      r.staffId === targetStaffId &&
      getReportingMonthKey(r.startDate, r.weekNumber, r.year) === activeMonthKey &&
      !(r.id === editingReportId && r.status === 'Draft') &&
      r.checklistItems?.some(it =>
        it.category === 'Monthly' &&
        it.status === 'completed' &&
        ((it.itemId && item.itemId && it.itemId === item.itemId) ||
          (!it.itemId && (it.title || '').trim().toLowerCase() === itemTitle))
      )
    );
  };

  // ---------------------------------------------------------------------
  // Yearly cycle helpers — the same shape as the monthly block above, with
  // the cycle unit swapped from a month to a YEAR (a 2026 cycle runs into
  // January 2027 and expires there; 1 February starts the next cycle).
  // ---------------------------------------------------------------------

  const yearlyItemMatches = (candidate: SubmittedChecklistItem | undefined, item: SubmittedChecklistItem): boolean => {
    if (!candidate || candidate.category !== 'Yearly' || candidate.status !== 'completed') return false;
    const itemTitle = (item.title || '').trim().toLowerCase();
    return (
      (candidate.itemId && item.itemId && candidate.itemId === item.itemId) ||
      (!candidate.itemId && (candidate.title || '').trim().toLowerCase() === itemTitle)
    );
  };

  /** Yearly deliverable fulfillment state for the active annual cycle. */
  const getYearlyTaskCycleStatus = (item: SubmittedChecklistItem) => {
    if (!isYearlyCycle(item.category)) return null;

    // Fulfilled in another report anywhere in the same annual cycle
    const doneReport = otherYearlyReports.find(r => r.checklistItems?.some(it => yearlyItemMatches(it, item)));

    const isCompletedEarlier = !!doneReport;
    const completedEarlierWeek = doneReport ? doneReport.weekNumber : null;
    const completedEarlierYear = doneReport ? doneReport.year : null;
    const isCurrentlyDoneInDraft = item.status === 'completed';
    const isFulfilledThisCycle = isCompletedEarlier || isCurrentlyDoneInDraft;

    // N/A is blocked for the WHOLE final month of the cycle (the first month of
    // the new calendar year) when nothing has been fulfilled yet.
    const isNaBlocked = isYearlyFinalMonth && !isCompletedEarlier;

    return {
      isCompletedEarlier,
      completedEarlierWeek,
      completedEarlierYear,
      isCurrentlyDoneInDraft,
      isFulfilledThisCycle,
      isFinalMonth: isYearlyFinalMonth,
      isNaBlocked,
      cycleYear: activeYearlyCycleKey
    };
  };

  /**
   * A Yearly deliverable is scheduled by its owner in exactly ONE week of the
   * annual cycle and that record claims it for the whole year (1 submission per
   * year). Same exemption rule as Monthly: the draft being edited right now
   * cannot lock itself, so the owner keeps control of their own week.
   */
  const isYearlyTaskClaimedByAnotherWeek = (item: SubmittedChecklistItem): boolean => {
    if (!isYearlyCycle(item.category)) return false;
    return reports.some(r =>
      r.staffId === targetStaffId &&
      getReportingYearlyCycleKey(r.startDate, r.weekNumber, r.year) === activeYearlyCycleKey &&
      !(r.id === editingReportId && r.status === 'Draft') &&
      r.checklistItems?.some(it => yearlyItemMatches(it, item))
    );
  };

  /** The report that claimed a yearly deliverable for this annual cycle, if any. */
  const findYearlyClaimingReport = (item: SubmittedChecklistItem): WeeklyReport | undefined => {
    if (!isYearlyCycle(item.category)) return undefined;
    return reports.find(r =>
      r.staffId === targetStaffId &&
      getReportingYearlyCycleKey(r.startDate, r.weekNumber, r.year) === activeYearlyCycleKey &&
      !(r.id === editingReportId && r.status === 'Draft') &&
      r.checklistItems?.some(it => yearlyItemMatches(it, item))
    );
  };

  /**
   * Item ids that an earlier report in the same month cycle already completed, for
   * an arbitrary report (not just the one being edited). Used by the list and detail
   * cards so a submitted W41 report is not docked for a Monthly task locked in W40.
   */
  const getLockedItemIdsForReport = (rep: WeeklyReport | null | undefined): Set<string> => {
    const out = new Set<string>();
    if (!rep || !rep.checklistItems || rep.checklistItems.length === 0) return out;

    // --- Monthly: same month cycle, earlier weeks only ---
    const repMonthKey = getReportingMonthKey(rep.startDate, rep.weekNumber, rep.year);
    const monthlySiblings = reports.filter(
      r =>
        r.staffId === rep.staffId &&
        r.id !== rep.id &&
        r.weekNumber <= rep.weekNumber &&
        getReportingMonthKey(r.startDate, r.weekNumber, r.year) === repMonthKey
    );
    rep.checklistItems.forEach(it => {
      if (!isMonthlyCycle(it.category)) return;
      const title = (it.title || '').trim().toLowerCase();
      const settledElsewhere = monthlySiblings.some(r =>
        r.checklistItems?.some(o =>
          o.category === 'Monthly' &&
          o.status === 'completed' &&
          ((o.itemId && it.itemId && o.itemId === it.itemId) ||
            (!o.itemId && (o.title || '').trim().toLowerCase() === title))
        )
      );
      if (settledElsewhere) out.add(it.itemId);
    });

    // --- Yearly: same ANNUAL cycle, every other report in it. No week ordering —
    // week numbers are only comparable inside their own calendar year, and a
    // January report of year N belongs to cycle N-1. ---
    const repYearKey = getReportingYearlyCycleKey(rep.startDate, rep.weekNumber, rep.year);
    const yearlySiblings = reports.filter(
      r =>
        r.staffId === rep.staffId &&
        r.id !== rep.id &&
        getReportingYearlyCycleKey(r.startDate, r.weekNumber, r.year) === repYearKey
    );
    if (yearlySiblings.length > 0) {
      rep.checklistItems.forEach(it => {
        if (!isYearlyCycle(it.category)) return;
        const title = (it.title || '').trim().toLowerCase();
        const settledElsewhere = yearlySiblings.some(r =>
          r.checklistItems?.some(o =>
            o.category === 'Yearly' &&
            o.status === 'completed' &&
            ((o.itemId && it.itemId && o.itemId === it.itemId) ||
              (!o.itemId && (o.title || '').trim().toLowerCase() === title))
          )
        );
        if (settledElsewhere) out.add(it.itemId);
      });
    }

    return out;
  };

  /**
   * Memoised wrapper around getLockedItemIdsForReport.
   *
   * The raw scan is O(sibling reports x checklist items^2) because it re-walks
   * every sibling's items for every item of the report being scored. It was being
   * invoked from 7 separate places in a single render (activePillar1, the list
   * cards, the detail card, the review modal, ...), so the same report was
   * re-scanned 7 times on every keystroke. Keyed on the `reports` array identity,
   * which only changes when the underlying data actually changes.
   */
  const lockedIdsCacheRef = useRef<{ src: WeeklyReport[]; byId: Map<string, Set<string>> } | null>(null);
  const EMPTY_LOCKED_IDS = useMemo(() => new Set<string>(), []);
  const getLockedItemIdsMemo = (rep: WeeklyReport | null | undefined): Set<string> => {
    if (!rep || !rep.checklistItems || rep.checklistItems.length === 0) return EMPTY_LOCKED_IDS;
    let cache = lockedIdsCacheRef.current;
    if (!cache || cache.src !== reports) {
      cache = { src: reports, byId: new Map() };
      lockedIdsCacheRef.current = cache;
    }
    const hit = cache.byId.get(rep.id);
    if (hit) return hit;
    const computed = getLockedItemIdsForReport(rep);
    cache.byId.set(rep.id, computed);
    return computed;
  };

  // Toggle item status:
  // For 'Weekly'  items: can be completed, incomplete, or marked N/A when not applicable
  // For 'Monthly' items: can set 'completed', 'incomplete', or 'na' (unless claimed by another week, or N/A-locked on the Month's final week)
  // For 'Yearly'  items: same as Monthly, but the cycle is a year — 1 claim per annual cycle, N/A locked in the cycle's final month (January)
  // For 'Anytime' items: can ALWAYS set 'na', in any week, with no month-end lock
  const handleSetItemStatus = (itemId: string, newStatus: ChecklistItemStatus) => {
    const item = checklistState.find(it => it.itemId === itemId);
    if (!item) return;

    // Anytime duties are on-demand: they are never part of the monthly cycle,
    // so they are never claimed/locked and N/A is always permitted.
    const isAnytimeItem = isAnytime(item.category);

    // A Monthly deliverable already scheduled by the owner in ANOTHER week of this
    // month is locked there. This own report's draft is exempt, so the owner keeps
    // full control of the week they are currently filling in.
    if (!isAnytimeItem && isMonthlyCycle(item.category)) {
      const claimedByAnotherWeek = isMonthlyTaskClaimedByAnotherWeek(item);
      if (claimedByAnotherWeek) {
        const claiming = findMonthlyClaimingReport(item);
        setFeedbackMsg(
          `🔒 "${item.title}" was already scheduled as Done for ${currentMonthInfo.monthName} in Week ${claiming?.weekNumber}. Only the owner may schedule a monthly task, and only once per month.`
        );
        setTimeout(() => setFeedbackMsg(''), 5000);
        return;
      }
    }

    // A Yearly deliverable already scheduled by the owner ANYWHERE in this annual
    // cycle is locked everywhere else in the cycle (1 submission per year).
    if (!isAnytimeItem && isYearlyCycle(item.category)) {
      const claimedInCycle = isYearlyTaskClaimedByAnotherWeek(item);
      if (claimedInCycle) {
        const claiming = findYearlyClaimingReport(item);
        setFeedbackMsg(
          `🔒 "${item.title}" was already scheduled as Done for the ${activeYearlyCycleKey} cycle in Week ${claiming?.weekNumber}. Only one submission per year is allowed — the record now holds for the whole cycle (until 31 January).`
        );
        setTimeout(() => setFeedbackMsg(''), 5000);
        return;
      }
    }

    if (newStatus === 'na') {
      // Anytime tasks are ALWAYS allowed to be marked N/A.
      //              (no final-week block, no month-end lock)
      if (isAnytimeItem) {
        // fall through and apply
      } else if (isYearlyCycle(item.category)) {
        // Strict guard 3b: Yearly tasks cannot be marked N/A in the cycle's FINAL
        // month (the first month of the new year) when not fulfilled earlier.
        const yStatus = getYearlyTaskCycleStatus(item);
        if (yStatus?.isNaBlocked) {
          setFeedbackMsg(
            `⚠️ N/A Locked: Final month of the ${activeYearlyCycleKey} cycle (expires 31 January)! "${item.title}" has not been fulfilled this year and is mandatory this month.`
          );
          setTimeout(() => setFeedbackMsg(''), 5000);
          return;
        }
      } else {
        // Strict guard 3: Monthly tasks cannot be marked N/A in the Final Week if not done in earlier weeks
        const mStatus = getMonthlyTaskMonthStatus(item);
        if (mStatus?.isNaBlocked) {
          setFeedbackMsg(
            `⚠️ N/A Locked: Final week of ${currentMonthInfo.monthName}! "${item.title}" was not completed in earlier weeks of this month and is mandatory this week.`
          );
          setTimeout(() => setFeedbackMsg(''), 5000);
          return;
        }
      }
    }

    setChecklistState(prev =>
      prev.map(it => {
        if (it.itemId !== itemId) return it;
        return {
          ...it,
          status: newStatus,
          completed: newStatus === 'completed'
        };
      })
    );
  };

  const handleToggleItem = (itemId: string) => {
    setChecklistState(prev =>
      prev.map(it => {
        if (it.itemId !== itemId) return it;
        const currentStatus = it.status || (it.completed ? 'completed' : 'incomplete');
        const nextStatus: ChecklistItemStatus = currentStatus === 'completed' ? 'incomplete' : 'completed';
        return {
          ...it,
          status: nextStatus,
          completed: nextStatus === 'completed'
        };
      })
    );
  };

  const handleUpdateItemNote = (itemId: string, note: string) => {
    setChecklistState(prev =>
      prev.map(it => (it.itemId === itemId ? { ...it, note } : it))
    );
  };

  // Add new item to draft checklist
  const handleAddItemToDraft = () => {
    if (!newItemTitle.trim()) return;
    const newItem: SubmittedChecklistItem = {
      itemId: `item_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      title: newItemTitle.trim(),
      category: newItemCat,
      completed: false,
      status: defaultItemStatus(newItemCat),
      note: ''
    };
    setChecklistState(prev => [...prev, newItem]);
    setNewItemTitle('');
  };

  // Remove item from draft checklist
  const handleRemoveItemFromDraft = (itemId: string) => {
    setChecklistState(prev => prev.filter(it => it.itemId !== itemId));
  };

  // Start editing item title inline
  const handleStartEditingItemTitle = (item: SubmittedChecklistItem) => {
    setEditingItemId(item.itemId);
    setEditingItemTitleText(item.title);
  };

  // Save edited item title
  const handleSaveEditingItemTitle = (itemId: string) => {
    if (!editingItemTitleText.trim()) return;
    setChecklistState(prev =>
      prev.map(it => (it.itemId === itemId ? { ...it, title: editingItemTitleText.trim() } : it))
    );
    setEditingItemId(null);
    setEditingItemTitleText('');
  };

  // Option A (3-Part Rubric) Calculation Helpers:
  // Pillar 1: Checklist Completion (50% / Max 50 pts)
  // Pillar 2: Submission Timeliness (20% / Max 20 pts)
  // Pillar 3: Superior Verification & Quality (30% / Max 30 pts)
  const calculateTRTimelinessScore = (
    submissionDateStr: string | undefined,
    endDateStr: string | undefined,
    approvedDeadline?: string,
    latePenaltyWaived?: boolean
  ): {
    score: number;
    label: string;
    daysDiff: number;
    hoursDiff: number;
    deadlineFormatted: string;
    isExtended: boolean;
    isLate: boolean;
    isPending: boolean;
  } => {
    const deadlineInfo = getTRSubmissionDeadline(endDateStr, approvedDeadline);
    if (latePenaltyWaived) {
      return {
        score: 20,
        label: 'On-Time (Full 20/20 pts, Penalty Waived)',
        daysDiff: 0,
        hoursDiff: 0,
        deadlineFormatted: deadlineInfo.formattedDeadline,
        isExtended: deadlineInfo.isExtended,
        isLate: false,
        isPending: false
      };
    }

    // Pillar 2 grades SUBMISSION timeliness, so it can only be scored once there is a
    // real submission instant to compare against the Monday 11:30 AM cutoff.
    //
    // `submission_date` is NULL for any report that was never submitted (every draft),
    // and storage hydrates that to ''. `new Date('')` is an Invalid Date whose NaN
    // fails EVERY comparison below — including `diffMs <= 0` — so the old code fell
    // through each branch to the maximum penalty and reported "Late by NaNd (0/20)".
    // A draft that simply has not been submitted yet was therefore being shown as if
    // it were over five days late. Missing or unparseable dates are PENDING, not late.
    const subMs = submissionDateStr ? new Date(submissionDateStr).getTime() : NaN;
    const deadlineMs = endDateStr || approvedDeadline ? deadlineInfo.deadlineDate.getTime() : NaN;
    if (Number.isNaN(subMs) || Number.isNaN(deadlineMs)) {
      return {
        score: 0,
        label: 'Not Submitted — Timeliness Pending (ungraded until submitted)',
        daysDiff: 0,
        hoursDiff: 0,
        deadlineFormatted: deadlineInfo.formattedDeadline,
        isExtended: deadlineInfo.isExtended,
        isLate: false,
        isPending: true
      };
    }

    const diffMs = subMs - deadlineMs;
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs <= 0) {
      return {
        score: 20,
        label: deadlineInfo.isExtended ? 'On-Time (20/20 pts, Approved Extension)' : 'On-Time (Full 20/20 pts)',
        daysDiff: 0,
        hoursDiff: 0,
        deadlineFormatted: deadlineInfo.formattedDeadline,
        isExtended: deadlineInfo.isExtended,
        isLate: false,
        isPending: false
      };
    }

    let score = 0;
    if (diffDays <= 1) {
      score = 15;
    } else if (diffDays <= 3) {
      score = 10;
    } else if (diffDays <= 5) {
      score = 5;
    }
    return {
      score,
      label: score === 0 ? `Late by ${diffDays}d (0/20 pts, Max Penalty)` : `Late by ${diffDays}d (${score}/20 pts)`,
      daysDiff: diffDays,
      hoursDiff: Math.round(diffHours),
      deadlineFormatted: deadlineInfo.formattedDeadline,
      isExtended: deadlineInfo.isExtended,
      isLate: true,
      isPending: false
    };
  };

  /**
   * The report that already occupies the week this CREATE form is pointed at.
   *
   * One week holds at most one report per staff member. Previously a duplicate was
   * only discovered when the server answered 409, i.e. after the owner had filled in
   * the entire form — all that work was thrown away. This is derived rather than
   * captured in the click handler so it stays correct when the week/year selectors
   * inside the form change the target week. Editing an existing report is the
   * legitimate path and is deliberately exempt.
   */
  const duplicateReportForNewForm: WeeklyReport | null =
    !isCreating || editingReportId
      ? null
      : reports.find(
          r =>
            r.staffId === currentUser.id &&
            r.weekNumber === selectedWeek &&
            r.year === selectedYear
        ) || null;

  /**
   * Deliverables locked out of this week's score because the month cycle settled
   * them in an earlier week. A Monthly task fulfilled in W40 shows as "Fulfilled in
   * W40" and is read-only in W41, but it is still carried in the checklist as
   * `incomplete`. Left in the denominator it silently docked the later week's
   * Pillar 1 for work the owner is not permitted to do there, so the new week looked
   * worse the more months it spanned. These are excluded exactly like N/A.
   */
  const activeLockedItemIds = useMemo((): Set<string> => {
    const out = new Set<string>();
    if (!isCreating || checklistState.length === 0) return out;

    // Precompute the claim keys ONCE instead of per item. The two
    // is*TaskClaimedByAnotherWeek predicates each rescan every sibling report
    // and all of its items, so calling them inside forEach made this
    // O(items x reports x items) on every keystroke in the checklist editor.
    // Identical results, now O(reports x items + items).
    const monthlyClaimKeys = new Set<string>();
    const yearlyClaimKeys = new Set<string>();

    reports.forEach(r => {
      if (r.staffId !== targetStaffId) return;
      const isSelfDraft = r.id === editingReportId && r.status === 'Draft';
      if (isSelfDraft) return;
      r.checklistItems?.forEach(it => {
        if (it.status !== 'completed') return;
        const title = (it.title || '').trim().toLowerCase();
        const key = it.itemId ? `id:${it.itemId}` : `t:${title}`;
        if (it.category === 'Monthly' &&
            getReportingMonthKey(r.startDate, r.weekNumber, r.year) === activeMonthKey) {
          monthlyClaimKeys.add(key);
        }
        if (it.category === 'Yearly' &&
            getReportingYearlyCycleKey(r.startDate, r.weekNumber, r.year) === activeYearlyCycleKey) {
          yearlyClaimKeys.add(key);
        }
      });
    });

    checklistState.forEach(it => {
      const key = it.itemId ? `id:${it.itemId}` : `t:${(it.title || '').trim().toLowerCase()}`;
      if (isMonthlyCycle(it.category) && monthlyClaimKeys.has(key)) {
        out.add(it.itemId);
      } else if (isYearlyCycle(it.category) && yearlyClaimKeys.has(key)) {
        out.add(it.itemId);
      }
    });
    return out;
  }, [isCreating, checklistState, reports, targetStaffId, editingReportId, activeMonthKey, activeYearlyCycleKey]);

  // Pillar 1 (Checklist Completion, max 50 pts) — see utils/trScoring.ts.
  // Applicable items are those NOT marked 'na' and NOT locked by an earlier week of
  // the month: N/A is excluded from both the numerator and the denominator so it can
  // neither earn nor cost points.
  const pillar1 = computePillar1(checklistState, activeLockedItemIds);
  const totalCount = pillar1.total;
  const completedCount = pillar1.completed;
  const naCount = pillar1.na;
  const applicableCount = pillar1.applicable;
  const completionScore = pillar1.score;

  // Live draft timeliness score (evaluated against selected end date and Monday 11:30 AM deadline)
  const draftEndDate = endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate;
  const existingReportForDraft = reports.find(
    r => r.staffId === currentUser.id && r.weekNumber === selectedWeek && r.year === selectedYear
  );
  // When editing an already-submitted report, grade Pillar 2 against its REAL
  // submission instant. Falling back to `new Date()` re-scored the report as if it
  // were being submitted right now, so reopening a report changed its punctuality.
  // Lookup is keyed on editingReportId so it also resolves when a superior edits a
  // subordinate's report (whose staffId is not the current user).
  const draftReportRow = (editingReportId ? reports.find(r => r.id === editingReportId) : undefined) || existingReportForDraft;
  const draftTimeliness = calculateTRTimelinessScore(
    draftReportRow?.submissionDate || new Date().toISOString(),
    draftEndDate,
    draftReportRow?.approvedDeadline,
    draftReportRow?.latePenaltyWaived
  );
  const draftTimelinessScore = draftTimeliness.score;

  // Preliminary total in draft (before superior awards up to 30 pts)
  const preliminaryDraftScore = clampBase(completionScore + draftTimelinessScore);
  const trScore = preliminaryDraftScore;

  // Pillar readouts for the report detail card. Stored pillars are used when
  // present; when a report has none yet (e.g. returned for revision, where the
  // superior's scores are deliberately cleared) they are derived from the
  // report's own checklist and submission dates per the Scoring Policy, rather
  // than falling back to a fabricated perfect 50/20.
  const activePillar1 = computePillar1(activeReport?.checklistItems, getLockedItemIdsMemo(activeReport));
  // Prefer recomputing Pillar 1 from the report's own checklist. The stored
  // `completion_score` cannot be trusted on its own: the server's computeScores()
  // writes it as a 0-100 PERCENTAGE, and a prior revision path stored a 0-100
  // value there too. Clamping those to the legal 0-50 ceiling flattened every
  // report at >=50% completion to a constant 50/50, so unchecking an item appeared
  // to do nothing. The checklist is the single source of truth for this pillar.
  const activeCompletionScore = activeReport
    ? (activeReport.checklistItems && activeReport.checklistItems.length > 0
        ? activePillar1.score
        : activeReport.completionScore !== undefined
        ? clampPillar1(activeReport.completionScore)
        : activePillar1.score)
    : 0;
  // Pillar 2 is only graded for a report that has actually been submitted. Until then
  // it is pending, so it is excluded from the base total and rendered as "—" rather
  // than as a misleading 0/20 (which asserts a maximum lateness penalty).
  const activeTimeliness = activeReport
    ? calculateTRTimelinessScore(
        activeReport.submissionDate,
        activeReport.endDate,
        activeReport.approvedDeadline,
        activeReport.latePenaltyWaived
      )
    : null;
  const activeTimelinessPending =
    !!activeReport &&
    activeReport.timelinessScore === undefined &&
    !!activeTimeliness?.isPending;
  const activeTimelinessScore = activeReport
    ? (activeTimelinessPending
        ? 0
        : clampPillar2(activeReport.timelinessScore ?? activeTimeliness?.score ?? 0))
    : 0;
  const activeTimelinessText = activeTimelinessPending
    ? '—'
    : String(activeTimelinessScore);
  const activeBaseScore = clampBase(activeCompletionScore + activeTimelinessScore);

  /** Pillar readout for any report, used by the report list cards. */
  const readPillars = (rep: WeeklyReport) => {
    const p1 = rep.checklistItems && rep.checklistItems.length > 0
      ? computePillar1(rep.checklistItems, getLockedItemIdsMemo(rep)).score
      : rep.completionScore !== undefined
      ? clampPillar1(rep.completionScore)
      : computePillar1(rep.checklistItems).score;
    const t = calculateTRTimelinessScore(rep.submissionDate, rep.endDate, rep.approvedDeadline, rep.latePenaltyWaived);
    const pending = rep.timelinessScore === undefined && t.isPending;
    const p2 = pending ? 0 : clampPillar2(rep.timelinessScore ?? t.score);
    return {
      completion: p1,
      timeliness: p2,
      timelinessText: pending ? '—' : String(p2),
      base: clampBase(p1 + p2)
    };
  };

  // Submit report handler
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard the handlers, not just the buttons: the form can still be submitted
    // implicitly with Enter, and a disabled button is not a business rule.
    if (duplicateReportForNewForm) {
      setSubmitConflict({
        message: `A report for W${duplicateReportForNewForm.weekNumber} already exists. Only one weekly report is allowed per week.`
      });
      return;
    }
    let finalSignature = signature;
    if (!finalSignature) {
      finalSignature = signatureCanvasRef.current?.requestSignature();
      if (finalSignature) setSignature(finalSignature);
    }
    if (!finalSignature) {
      showDialog('Please draw your handsign or select a signature before submitting the report.');
      return;
    }

    // Weekly Summary Form (spec §6): drop empty entries, then validate required fields.
    const cleanSummary = stripEmptyEntries(weeklySummary);
    setWeeklySummary(cleanSummary);
    const summaryErrs = validateWeeklySummary(
      cleanSummary,
      startDateInput || getWeekDateRange(selectedWeek, selectedYear).startDate,
      endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate
    );
    if (summaryErrs.length) {
      showDialog(
        'Weekly Summary Form — please fix the following:\n\n• ' + summaryErrs.join('\n• ')
      );
      return;
    }

    if (isSubmittingReport) return;
    setIsSubmittingReport(true);
    try {
    // Proof files are only staged until now — send them to S3 on submit.
    const pendingProofs = (multiProof.files || []).filter((f) => !f.url && f.pendingDataUrl);
    if (pendingProofs.length > 0) {
      setSubmitStatus({
        label: `Uploading file 1 of ${pendingProofs.length}`,
        detail: pendingProofs[0].name,
        percent: 0
      });
    }
    const proofData = await uploadPendingProofs(multiProof, (s) =>
      setSubmitStatus({
        label: `Uploading file ${s.index + 1} of ${s.total}`,
        detail: s.name,
        // The file batch owns 0-90% so the bar keeps moving during the save below.
        percent: Math.round(((s.index + s.percent / 100) / s.total) * 90)
      })
    );
    setSubmitStatus({ label: 'Saving report…', percent: 95 });
    setMultiProof(proofData);
    const computedWeekInfo = startDateInput
      ? getWeekNumberFromDate(startDateInput)
      : { weekNumber: selectedWeek, year: selectedYear, quarter: selectedQuarter };

    const targetReportId = editingReportId || `rep_${computedWeekInfo.year}_w${computedWeekInfo.weekNumber}_${currentUser.id}_${Date.now()}`;
    const existingReport = reports.find(r => r.id === editingReportId);
    const reportStaffId = existingReport ? existingReport.staffId : currentUser.id;
    const reportStaffName = existingReport ? existingReport.staffName : currentUser.name;
    const reportDepartment = existingReport ? existingReport.department : currentUser.department;
    const reportPosition = existingReport ? existingReport.position : currentUser.position;
    const reportSuperiorId = existingReport ? existingReport.superiorId : currentUser.superiorId;
    // A draft carries no submission instant — `submission_date` is NULL and storage
    // hydrates it to '' — so the moment of submission is NOW. Only an already-submitted
    // report keeps its original instant. Without the fallback, the first submit of a
    // saved draft graded Pillar 2 against an empty date and permanently stamped the
    // report 0/20.
    const reportSubDate = existingReport?.submissionDate || new Date().toISOString();

    const weekDates = getWeekDateRange(computedWeekInfo.weekNumber, computedWeekInfo.year);
    const targetEndDate = endDateInput || weekDates.endDate;
    const computedTimeliness = calculateTRTimelinessScore(
      reportSubDate,
      targetEndDate,
      existingReport?.approvedDeadline,
      existingReport?.latePenaltyWaived
    );
    const repTimelinessScore = (existingReport?.latePenaltyWaived || existingReport?.extensionRequest?.status === 'Approved') ? 20 : computedTimeliness.score;

    // Quality score is strictly pending until evaluated by superior
    const isAlreadyReviewed = existingReport?.status === 'Approved' || existingReport?.status === 'Reviewed';
    const repQualityScore = existingReport?.qualityScore;
    const finalCalculatedScore = isAlreadyReviewed && repQualityScore !== undefined
      ? Math.min(100, completionScore + repTimelinessScore + repQualityScore)
      : (completionScore + repTimelinessScore);

    const savedReport: WeeklyReport = {
      id: targetReportId,
      staffId: reportStaffId,
      staffName: reportStaffName,
      department: reportDepartment,
      position: reportPosition,
      superiorId: reportSuperiorId,
      year: computedWeekInfo.year,
      quarter: computedWeekInfo.quarter,
      month: Math.min(12, Math.max(1, Math.ceil(computedWeekInfo.weekNumber / 4.33))),
      weekNumber: computedWeekInfo.weekNumber,
      startDate: startDateInput || weekDates.startDate,
      endDate: targetEndDate,
      submissionDate: reportSubDate,
      checklistItems: checklistState,
      trScore: finalCalculatedScore,
      completionScore,
      timelinessScore: repTimelinessScore,
      qualityScore: repQualityScore,
      signature: finalSignature,
      notes: reportNotes,
      summary: cleanSummary,
      delayReason: delayReason.trim() || ((computedTimeliness.daysDiff > 7 && !existingReport?.approvedDeadline) ? `Retroactive / Backfill: Recording operational accomplishments for Week ${computedWeekInfo.weekNumber}, ${computedWeekInfo.year}.` : undefined),
      approvedDeadline: existingReport?.approvedDeadline,
      extensionRequest: existingReport?.extensionRequest,
      extensionHistory: existingReport?.extensionHistory,
      latePenaltyWaived: existingReport?.latePenaltyWaived || existingReport?.extensionRequest?.status === 'Approved' || false,
      waivedBy: existingReport?.waivedBy,
      waivedByName: existingReport?.waivedByName,
      multiProof: proofData,
      aiSummary: aiSummaryText,
      status: (existingReport?.status === 'Approved' || existingReport?.status === 'Reviewed')
        ? existingReport.status
        : 'Submitted'
    };

    const saveResult = await saveReport(savedReport, currentUser);
    if (saveResult && !saveResult.ok) {
      if (saveResult.conflict) {
        setConflictHighlight(true);
        setSubmitConflict({ message: saveResult.message || 'A report for this week already exists. Please choose a different report period.' });
        requestAnimationFrame(() => periodSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        return;
      }
      showDialog(saveResult.message || 'Failed to save the report. Please try again.');
      return;
    }

    // Persist the Weekly Summary Form in its own table (never columns on `reports`).
    if (saveResult?.code) {
      const sumRes = await saveWeeklySummary(saveResult.code, cleanSummary);
      if (!sumRes.ok) {
        showDialog(
          'The report was saved, but the Weekly Summary Form could not be saved — ' +
            (sumRes.message || 'please try again.')
        );
      }
    }

    clearTRDraft(reportStaffId, computedWeekInfo.year, computedWeekInfo.weekNumber).catch(() => {});
    setFeedbackMsg(editingReportId ? 'Weekly T&R report updated successfully!' : 'Weekly T&R report submitted! Awaiting superior grade & quality evaluation.');
    setIsCreating(false);
    setEditingReportId(null);
    loadData();
    setActiveReport(savedReport);

    if (pageModeRef.current) {
      onExit?.();
      return;
    }

    setTimeout(() => setFeedbackMsg(''), 4000);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to save the report. Please try again.');
    } finally {
      setIsSubmittingReport(false);
      setSubmitStatus(null);
    }
  };

  // Save report as Draft handler (Staff can save work in progress without e-signature and edit again later)
  const handleSaveAsDraft = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (duplicateReportForNewForm) {
      setSubmitConflict({
        message: `A report for W${duplicateReportForNewForm.weekNumber} already exists. Only one weekly report is allowed per week.`
      });
      return;
    }
    if (isSavingDraft || isSubmittingReport) return;
    setIsSavingDraft(true);
    try {
    // Staged proof files are sent to S3 here too, so a draft never carries base64.
    const pendingProofs = (multiProof.files || []).filter((f) => !f.url && f.pendingDataUrl);
    if (pendingProofs.length > 0) {
      setSubmitStatus({
        label: `Uploading file 1 of ${pendingProofs.length}`,
        detail: pendingProofs[0].name,
        percent: 0
      });
    }
    const proofData = await uploadPendingProofs(multiProof, (s) =>
      setSubmitStatus({
        label: `Uploading file ${s.index + 1} of ${s.total}`,
        detail: s.name,
        percent: Math.round(((s.index + s.percent / 100) / s.total) * 90)
      })
    );
    setSubmitStatus({ label: 'Saving draft…', percent: 95 });
    setMultiProof(proofData);
    const computedWeekInfo = startDateInput
      ? getWeekNumberFromDate(startDateInput)
      : { weekNumber: selectedWeek, year: selectedYear, quarter: selectedQuarter };

    const targetReportId = editingReportId || `rep_${computedWeekInfo.year}_w${computedWeekInfo.weekNumber}_${currentUser.id}_${Date.now()}`;
    const existingReport = reports.find(r => r.id === editingReportId) || existingReportForDraft;
    const reportStaffId = existingReport ? existingReport.staffId : currentUser.id;
    const reportStaffName = existingReport ? existingReport.staffName : currentUser.name;
    const reportDepartment = existingReport ? existingReport.department : currentUser.department;
    const reportPosition = existingReport ? existingReport.position : currentUser.position;
    const reportSuperiorId = existingReport ? existingReport.superiorId : currentUser.superiorId;

    const weekDates = getWeekDateRange(computedWeekInfo.weekNumber, computedWeekInfo.year);
    const targetEndDate = endDateInput || weekDates.endDate;

    const draftReport: WeeklyReport = {
      id: targetReportId,
      staffId: reportStaffId,
      staffName: reportStaffName,
      department: reportDepartment,
      position: reportPosition,
      superiorId: reportSuperiorId,
      year: computedWeekInfo.year,
      quarter: computedWeekInfo.quarter,
      month: Math.min(12, Math.max(1, Math.ceil(computedWeekInfo.weekNumber / 4.33))),
      weekNumber: computedWeekInfo.weekNumber,
      startDate: startDateInput || weekDates.startDate,
      endDate: targetEndDate,
      submissionDate: existingReport?.submissionDate || new Date().toISOString(),
      checklistItems: checklistState,
      trScore: preliminaryDraftScore,
      completionScore,
      timelinessScore: draftTimelinessScore,
      qualityScore: existingReport?.qualityScore,
      signature: signature,
      notes: reportNotes,
      summary: weeklySummary,
      delayReason: delayReason.trim() || undefined,
      approvedDeadline: existingReport?.approvedDeadline,
      extensionRequest: existingReport?.extensionRequest,
      extensionHistory: existingReport?.extensionHistory,
      latePenaltyWaived: existingReport?.latePenaltyWaived || existingReport?.extensionRequest?.status === 'Approved' || false,
      waivedBy: existingReport?.waivedBy,
      waivedByName: existingReport?.waivedByName,
      multiProof: proofData,
      aiSummary: aiSummaryText,
      status: 'Draft'
    };

    const saveResult = await saveReport(draftReport, currentUser);
    if (saveResult && !saveResult.ok) {
      if (saveResult.conflict) {
        setConflictHighlight(true);
        setSubmitConflict({ message: saveResult.message || 'A report for this week already exists. Please choose a different report period.' });
        requestAnimationFrame(() => periodSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        return;
      }
      showDialog(saveResult.message || 'Failed to save the draft. Please try again.');
      return;
    }

    // Drafts persist the summary too (unvalidated / unstripped).
    if (saveResult?.code) {
      const sumRes = await saveWeeklySummary(saveResult.code, weeklySummary);
      if (!sumRes.ok) {
        showDialog(
          'The draft was saved, but the Weekly Summary Form could not be saved — ' +
            (sumRes.message || 'please try again.')
        );
      }
    }

    clearTRDraft(reportStaffId, computedWeekInfo.year, computedWeekInfo.weekNumber).catch(() => {});
    setFeedbackMsg('Weekly report saved as Draft! You can continue editing deliverables and submit anytime.');
    setIsCreating(false);
    setEditingReportId(null);
    loadData();
    setActiveReport(draftReport);

    if (pageModeRef.current) {
      onExit?.();
      return;
    }

    setTimeout(() => setFeedbackMsg(''), 4500);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to save the draft. Please try again.');
    } finally {
      setIsSavingDraft(false);
      setSubmitStatus(null);
    }
  };

  // Extension Action Handlers
  const handleOpenExtensionModal = (targetRep?: WeeklyReport | null) => {
    const rep = targetRep || (editingReportId ? reports.find(r => r.id === editingReportId) : null) || existingReportForDraft || null;
    setExtensionTargetReport(rep);

    // Default proposed deadline: Tuesday following week at 11:30 AM (+1 day from standard Monday 11:30 AM)
    const endDate = rep?.endDate || endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate;
    const stdDeadline = getTRSubmissionDeadline(endDate, rep?.approvedDeadline);
    const defaultNextDay = new Date(stdDeadline.deadlineDate);
    defaultNextDay.setDate(defaultNextDay.getDate() + 1);
    defaultNextDay.setHours(11, 30, 0, 0);

    const yr = defaultNextDay.getFullYear();
    const mo = String(defaultNextDay.getMonth() + 1).padStart(2, '0');
    const da = String(defaultNextDay.getDate()).padStart(2, '0');
    setExtensionRequestedDeadline(`${yr}-${mo}-${da}T11:30`);
    setExtensionReason('');
    setIsExtensionModalOpen(true);
  };

  const handleApplyPresetDeadline = (daysToAdd: number) => {
    const endDate = extensionTargetReport?.endDate || endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate;
    const stdDeadline = getTRSubmissionDeadline(endDate);
    const targetDate = new Date(stdDeadline.deadlineDate);
    targetDate.setDate(targetDate.getDate() + daysToAdd);
    targetDate.setHours(11, 30, 0, 0);

    const yr = targetDate.getFullYear();
    const mo = String(targetDate.getMonth() + 1).padStart(2, '0');
    const da = String(targetDate.getDate()).padStart(2, '0');
    const formatted = `${yr}-${mo}-${da}T11:30`;
    setExtensionRequestedDeadline(formatted);
    if (extensionDeadlineInputRef.current) extensionDeadlineInputRef.current.value = formatted;
  };

  const handleSubmitExtensionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const requestedDeadline = extensionDeadlineInputRef.current?.value || extensionRequestedDeadline;
    const reasonText = (extensionReasonInputRef.current?.value || extensionReason).trim();
    if (!requestedDeadline) {
      showDialog('Please specify the requested deadline.');
      return;
    }
    if (!reasonText) {
      showDialog('Please provide a justification / reason for your extension request.');
      return;
    }
    if (isSubmittingExtension) return;
    setIsSubmittingExtension(true);
    try {
      const wk = extensionTargetReport?.weekNumber || selectedWeek;
      const yr = extensionTargetReport?.year || selectedYear;
      const repId = extensionTargetReport?.id || editingReportId || `rep_${currentUser.id}_${yr}_w${wk}`;
      const targetEndDate = extensionTargetReport?.endDate || endDateInput || getWeekDateRange(wk, yr).endDate;

      const res = await requestTRExtension(
        repId,
        wk,
        yr,
        targetEndDate,
        requestedDeadline,
        reasonText,
        currentUser,
        checklistState
      );

      if (res.success) {
        loadData();
        if (activeReport && activeReport.id === repId) {
          setActiveReport(res.report);
        }
        setIsExtensionModalOpen(false);
        setFeedbackMsg(`Extension request submitted to your superior (${formatDateTimeFriendly(requestedDeadline)}).`);
        setTimeout(() => setFeedbackMsg(''), 6000);
      } else {
        showDialog(res.message);
      }
    } catch (err: any) {
      showDialog(err?.message || 'Failed to submit extension request.');
    } finally {
      setIsSubmittingExtension(false);
    }
  };

  const handleOpenReviewExtensionModal = (report: WeeklyReport, decision: 'Approved' | 'Rejected') => {
    setExtensionReviewReport(report);
    setExtensionReviewDecision(decision);
    setExtensionReviewNote(
      decision === 'Approved'
        ? 'Approved. Full 20/20 punctuality score is granted if submitted by the approved date.'
        : 'Declined. Standard Monday 11:30 AM deadline applies.'
    );
    setIsReviewExtensionModalOpen(true);
  };

  const handleSaveReviewExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extensionReviewReport || isSavingExtensionReview) return;

    setIsSavingExtensionReview(true);
    try {
      const res = await reviewTRExtension(
        extensionReviewReport,
        extensionReviewDecision,
        extensionReviewNote.trim(),
        currentUser
      );

      if (res.success && res.report) {
        loadData();
        setActiveReport(res.report);
        setIsReviewExtensionModalOpen(false);
        setFeedbackMsg(`Extension request ${extensionReviewDecision.toLowerCase()} successfully. Staff has been notified.`);
        setTimeout(() => setFeedbackMsg(''), 6000);
      } else {
        showDialog(res.message);
      }
    } catch (err: any) {
      showDialog(err?.message || 'Failed to save the extension review. Please try again.');
    } finally {
      setIsSavingExtensionReview(false);
    }
  };

  const handleOpenReviewModal = (rep: WeeklyReport) => {
    setActiveReport(rep);
    setReviewStatus(rep.status === 'Draft' || rep.status === 'Submitted' ? 'Approved' : (rep.status as any));
    setReviewFeedback(rep.managerFeedback || '');
    setReviewQualityScore(rep.qualityScore !== undefined ? rep.qualityScore : (rep.status === 'Approved' ? 30 : 25));
    const isBackfill = rep.delayReason?.toLowerCase().includes('retroactive') || rep.delayReason?.toLowerCase().includes('backfill');
    setReviewWaiveLatePenalty(rep.latePenaltyWaived || rep.extensionRequest?.status === 'Approved' || Boolean(isBackfill) || false);
    setIsReviewing(true);
  };

  const handleSaveSuperiorReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport) return;

    // Mandatory Feedback on Low Quality Score (< 70%, i.e. < 21/30 pts)
    if (reviewQualityScore < 21 && (!reviewFeedback || reviewFeedback.trim().length < 10)) {
      showDialog('Mandatory Justification Required: When rating Superior Quality below 70% (<21/30 points), you must provide constructive feedback explaining shortcomings and required improvements.');
      return;
    }

    // Calculate Option A weighted 3-Part Rubric:
    // 1. Checklist Completion: 50% (Pillar 1 — N/A and earlier-week-locked excluded)
    // Recomputed from the checklist; the stored completion_score is a server-side
    // 0-100 percentage and clamping it to 0-50 pinned half-complete reports at 50.
    const compScore = activeReport.checklistItems && activeReport.checklistItems.length > 0
      ? computePillar1(activeReport.checklistItems, getLockedItemIdsMemo(activeReport)).score
      : activeReport.completionScore !== undefined
      ? clampPillar1(activeReport.completionScore)
      : computePillar1(activeReport.checklistItems).score;

    // 2. Timeliness: 20%
    const timeScore = reviewWaiveLatePenalty ? TR_PILLAR2_MAX : clampPillar2(
      activeReport.timelinessScore !== undefined
        ? activeReport.timelinessScore
        : calculateTRTimelinessScore(activeReport.submissionDate, activeReport.endDate, activeReport.approvedDeadline, activeReport.latePenaltyWaived).score
    );

    // 3. Superior Verification & Quality: 30%
    const qualScore = reviewQualityScore;
    const finalScore = Math.min(100, Math.max(0, compScore + timeScore + qualScore));

    const isRevision = reviewStatus === 'Submitted';

    const updatedReport: WeeklyReport = {
      ...activeReport,
      status: reviewStatus
    };
    if (isRevision) {
      // Sent back for revision: revert to a pending (awaiting review) look —
      // preliminary Pillar 1 only (0-50 pts, N/A excluded), superior
      // notes/remarks and waiver cleared so the next pass re-grades cleanly.
      const prelimPillar1 = computePillar1(activeReport.checklistItems, getLockedItemIdsMemo(activeReport)).score;
      updatedReport.trScore = prelimPillar1;
      updatedReport.completionScore = prelimPillar1;
      updatedReport.timelinessScore = undefined;
      updatedReport.qualityScore = undefined;
      updatedReport.managerFeedback = undefined;
      updatedReport.latePenaltyWaived = false;
      updatedReport.waivedBy = undefined;
      updatedReport.waivedByName = undefined;
    } else {
      updatedReport.completionScore = compScore;
      updatedReport.timelinessScore = timeScore;
      updatedReport.qualityScore = qualScore;
      updatedReport.trScore = finalScore;
      updatedReport.managerFeedback = reviewFeedback;
      updatedReport.latePenaltyWaived = reviewWaiveLatePenalty;
      updatedReport.waivedBy = reviewWaiveLatePenalty ? currentUser.id : undefined;
      updatedReport.waivedByName = reviewWaiveLatePenalty ? currentUser.name : undefined;
    }
    updatedReport.reviewDate = new Date().toISOString();

    setIsSavingReview(true);
    try {
      const result = await saveReport(updatedReport, currentUser, 'superior');
      if (!result.ok) {
        showDialog(result.message || 'Failed to save the review. Please try again.');
        return;
      }
      setActiveReport(updatedReport);
      setIsReviewing(false);
      loadData();
      setFeedbackMsg(isRevision
        ? `Report for ${updatedReport.staffName} sent back for revision. Score & notes cleared for fresh re-evaluation.`
        : `Report for ${updatedReport.staffName} reviewed & graded: ${finalScore}% (${reviewStatus})!`);

      setTimeout(() => setFeedbackMsg(''), 4000);
    } finally {
      setIsSavingReview(false);
    }
  };

  // Pull a human-readable reason out of any AI-error payload shape.
  function extractAiError(data: any): string | null {
    if (!data || typeof data !== 'object') return null;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.error?.message === 'string' && data.error.message.trim()) return data.error.message;
    if (typeof data.error === 'string' && data.error.trim()) {
      // The frontend server stringified the Gemini error a second time:
      // '{"error":{"code":400,"message":"API key not valid..."}}'
      try {
        const inner = JSON.parse(data.error);
        const msg = inner?.error?.message || inner?.message;
        if (typeof msg === 'string' && msg.trim()) return msg;
      } catch {
        /* not JSON — use the raw string */
      }
      return data.error;
    }
    return null;
  }

  // Assemble the report context the backend AI endpoint summarises.
  function buildAiSummaryText(): string {
    const items = isCreating ? checklistState : activeReport?.checklistItems || [];
    const notes = isCreating ? reportNotes : activeReport?.notes || '';
    const lines = items.map((it) => {
      const status = it.status || (it.completed ? 'Done' : 'Incomplete');
      const note = it.note ? ` — ${it.note}` : '';
      return `- ${it.title}${it.category ? ` (${it.category})` : ''}: ${status}${note}`;
    });
    return [
      `Staff: ${currentUser.name}`,
      `Position: ${currentUser.position}`,
      `Department: ${currentUser.department}`,
      `Period: Week ${selectedWeek}, ${selectedYear}`,
      '',
      'T&R (JD Checklist Items Submitted):',
      lines.length ? lines.join('\n') : '(none)',
      '',
      `Staff notes: "${notes || 'None provided'}"`
    ].join('\n');
  }

  // Call the backend Gemini endpoint for the AI Weekly Executive Summary.
  //
  // Tries POST /api/ai/generate-summary first (the dedicated endpoint) and
  // falls back to the long-standing POST /api/ai/summarize when the backend
  // hasn't been restarted since that route was added — so Generate works either
  // way. `credentials: 'include'` is required: both routes sit behind requireUser
  // and the session lives in an httpOnly cookie.
  const handleGenerateAiSummary = async () => {
    setIsGeneratingAi(true);
    try {
      const payload = {
        kind: 'report',
        tone: 'professional',
        text: buildAiSummaryText(),
        staffName: currentUser.name,
        position: currentUser.position,
        department: currentUser.department,
        period: `Week ${selectedWeek}, ${selectedYear}`,
        checklistItems: isCreating ? checklistState : activeReport?.checklistItems || [],
        notes: isCreating ? reportNotes : activeReport?.notes || ''
      };
      const opts = {
        method: 'POST',
        credentials: 'include' as RequestCredentials,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      };

      let res = await fetch('/api/ai/generate-summary', opts);
      if (res.status === 404) {
        // Older backend without the dedicated route — use the shared one.
        res = await fetch('/api/ai/summarize', opts);
      }

      const data = await res.json().catch(() => null);
      const summary = data?.data?.summary ?? data?.data?.output;
      if (data?.success && summary) {
        setAiSummaryText(summary);
      } else {
        // Surface the real server reason instead of a generic string that hides
        // the actual problem. Handles every error shape this endpoint has used:
        //   { message }              – backend ApiError envelope
        //   { error: "string" }      – frontend-server style
        //   { error: '{"error":{...}}' } – Gemini error stringified twice
        setAiSummaryText(
          extractAiError(data) ||
          `Unable to generate AI summary (HTTP ${res.status}). Please try again.`
        );
      }
    } catch (err) {
      console.error(err);
      setAiSummaryText('AI Service connection timeout. Please check your connection and try again.');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  return (
    <div className="p-2 space-y-6">
      {/* Fixed bottom upload status — shows while proof files are pushed to S3
          during Submit / Save as Draft. Removed automatically in `finally`. */}
      {submitStatus && (
        <div className="fixed inset-x-0 bottom-0 z-[95] flex justify-center px-4 pb-5 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-white">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" />
                <span className="truncate">{submitStatus.label}</span>
              </span>
              <span className="shrink-0 text-xs font-black tabular-nums text-blue-300">
                {submitStatus.percent}%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-[width] duration-200 ease-out"
                style={{ width: `${submitStatus.percent}%` }}
              />
            </div>
            {submitStatus.detail && (
              <p className="mt-1.5 truncate text-[11px] text-slate-400">{submitStatus.detail}</p>
            )}
          </div>
        </div>
      )}

      {/* Full-page mode header (create / edit) — full-width bar flush to the top/left/right */}
      {pageMode && (
        <div className="bg-white border-b border-slate-200 -mx-2 -mt-2 px-2 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-sm tracking-wide shadow-xs shrink-0">
              APA
            </div>
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-0.5">
                <span className="text-xs text-slate-500 font-medium">Position: {currentUser.position}</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">APA 2 - Staff Report</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onExit?.()}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              title="Back to report list"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Reports
            </button>
          </div>
        </div>
      )}

      {feedbackMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {feedbackMsg}
        </div>
      )}

      {/* Official Position JD Governance Policy Banner - Always Visible on Weekly T&R Page */}

      {/* T&R 3-Part Scoring Rubric Banner (Option A Model) - Displayed Above Sub-tabs */}
     

      {/* Sub-tabs: My Reports vs Subordinate Reports */}
      {!pageMode && (showSubTabs ? (
        <>
          {/* Desktop Tabs */}
          <div className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setTrSubTab('my_reports');
                setIsCreating(false);
                const myReps = reports.filter(r => r.staffId === currentUser.id);
                setActiveReport(myReps[0] || null);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                trSubTab === 'my_reports'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserIcon className="w-4 h-4 text-blue-600 shrink-0" />
              <span>My T&R Reports</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 font-black">
                {reports.filter(r => r.staffId === currentUser.id).length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTrSubTab('subordinate_reports');
                setIsCreating(false);
                const subReps = subordinateVisibleReports;
                setActiveReport(subReps[0] || null);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                trSubTab === 'subordinate_reports'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Subordinate T&R Reports</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 font-black">
                {subordinateVisibleReports.length}
              </span>
              {subordinateVisibleReports.filter(r => r.status === 'Submitted').length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 font-black">
                  {subordinateVisibleReports.filter(r => r.status === 'Submitted').length} Pending
                </span>
              )}
            </button>
            {!isCreating && (
              <button
                onClick={() => { window.location.hash = '#/tr/new'; }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Create Weekly Report
              </button>
            )}
          </div>

          {/* Mobile Select */}
          <div className="md:hidden bg-slate-100 p-1.5 rounded-2xl">
            <div className="relative">
              {trSubTab === 'my_reports' ? (
                <UserIcon className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              ) : (
                <Users className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              )}
              <ModernSelect
                value={trSubTab}
                onChange={e => {
                  if (e.target.value === 'my_reports') {
                    setTrSubTab('my_reports');
                    setIsCreating(false);
                    const myReps = reports.filter(r => r.staffId === currentUser.id);
                    setActiveReport(myReps[0] || null);
                  } else {
                    setTrSubTab('subordinate_reports');
                    setIsCreating(false);
                    const subReps = subordinateVisibleReports;
                    setActiveReport(subReps[0] || null);
                  }
                }}
                className="w-full appearance-none pl-9 pr-8 py-2 rounded-xl text-xs font-bold text-slate-800 bg-white border border-slate-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="my_reports">
                  1. My T&R Reports ({reports.filter(r => r.staffId === currentUser.id).length})
                </option>
                <option value="subordinate_reports">
                  2. Subordinate T&R Reports ({subordinateVisibleReports.length})
                  {subordinateVisibleReports.filter(r => r.status === 'Submitted').length > 0
                    ? ` (${subordinateVisibleReports.filter(r => r.status === 'Submitted').length} Pending)`
                    : ''}
                </option>
              </ModernSelect>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {!isCreating && (
              <button
                onClick={() => { window.location.hash = '#/tr/new'; }}
                className="w-full mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Create Weekly Report
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs mb-[5px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <UserIcon className="w-4 h-4 text-blue-600" />
            <span>My Personal T&R Workspace</span>
            <span className="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded-full font-bold w-fit">
              {reports.filter(r => r.staffId === currentUser.id).length} Report(s)
            </span>
          </div>
           <button
                onClick={() => { window.location.hash = '#/tr/new'; }}
                className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Create Weekly Report
              </button>
        </div>
      ))}

      {/* Main Container Grid */}
      <div className={pageMode ? 'w-full max-w-5xl mx-auto grid grid-cols-1' : 'grid grid-cols-1 lg:grid-cols-12 gap-6'}>
        {/* Left Column: Report List / Hierarchy View */}
        {!pageMode && (
        <div className={`lg:col-span-4 space-y-4 ${showMobileDetail ? 'hidden lg:block' : 'block'}`}>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                {trSubTab === 'my_reports' ? (
                  <>
                    <UserIcon className="w-4 h-4 text-blue-600" />
                    My Submitted Reports
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4 text-purple-600" />
                    Subordinate Submissions
                  </>
                )}
              </h3>
              <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold border border-blue-100">
                {trSubTab === 'my_reports' ? 'Personal' : 'Team Review'}
              </span>
            </div>

            {/* Subordinate Staff & Quick Filters (For Superiors with multiple staff) */}
            {trSubTab === 'subordinate_reports' && (() => {
              const subReports = subordinateVisibleReports;
              // Calculate unique subordinates and their report counts
              const subordinateStaffMap = new Map<string, { id: string; name: string; position: string; count: number }>();
              
              // First from reports
              subReports.forEach(r => {
                const existing = subordinateStaffMap.get(r.staffId);
                if (existing) {
                  existing.count += 1;
                } else {
                  subordinateStaffMap.set(r.staffId, {
                    id: r.staffId,
                    name: r.staffName,
                    position: r.position,
                    count: 1
                  });
                }
              });

              // Also include any direct subordinate from allUsers
              allUsers.forEach(u => {
                if (directSubIds.has(u.id) && !subordinateStaffMap.has(u.id)) {
                  subordinateStaffMap.set(u.id, {
                    id: u.id,
                    name: u.name,
                    position: u.position,
                    count: 0
                  });
                }
              });

              const subordinateStaffList = Array.from(subordinateStaffMap.values());

              return (
                <div className="space-y-2 mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  {/* Staff Select Dropdown */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Filter className="w-3 h-3 text-blue-600" /> Filter by Staff Member
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
                        const newStaffId = e.target.value;
                        setSubordinateStaffFilter(newStaffId);
                        // Auto switch active report to selected staff's report if available
                        if (newStaffId !== 'all') {
                          const matched = subReports.find(r => r.staffId === newStaffId);
                          if (matched) {
                            setActiveReport(matched);
                            setIsCreating(false);
                          }
                        }
                      }}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs"
                    >
                      <option value="all">👥 All Staff Members ({subReports.length} total reports)</option>
                      {subordinateStaffList.map(st => (
                        <option key={st.id} value={st.id}>
                          {st.name} — {st.position} ({st.count} {st.count === 1 ? 'report' : 'reports'})
                        </option>
                      ))}
                    </ModernSelect>
                  </div>

                  {/* Search and Status Filter */}
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={subordinateSearchQuery}
                        onChange={e => setSubordinateSearchQuery(e.target.value)}
                        placeholder="Search name, position, W#..."
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
                      className="px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white font-medium text-slate-700"
                    >
                      <option value="all">All Status</option>
                      <option value="Submitted">Submitted</option>
                      <option value="Reviewed">Reviewed</option>
                      <option value="Approved">Approved</option>
                    </ModernSelect>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <ModernSelect
                      value={subordinateYearFilter}
                      onChange={e => setSubordinateYearFilter(e.target.value)}
                      aria-label="Filter subordinate reports by year"
                      className="flex-1 px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white font-medium text-slate-700"
                    >
                      <option value="all">All Years</option>
                      {subordinateYearOptions.map(y => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </ModernSelect>
                    <ModernSelect
                      value={subordinateWeekFilter}
                      onChange={e => setSubordinateWeekFilter(e.target.value)}
                      aria-label="Filter subordinate reports by week"
                      className="flex-1 px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white font-medium text-slate-700"
                    >
                      <option value="all">All Weeks</option>
                      {TR_WEEK_OPTIONS.map(w => (
                        <option key={w} value={String(w)}>Week {w}</option>
                      ))}
                    </ModernSelect>
                  </div>

                  {/* Selection + saved chat-style summary actions */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-200">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allVisibleSubReportsSelected}
                        onChange={toggleSelectAllVisibleSubReports}
                        disabled={visibleSubReportIds.length === 0}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                      />
                      Select all visible
                    </label>
                    <div className="flex items-center gap-1.5 ml-auto">
                      {selectedSubReportCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedSubReportIds(new Set())}
                          className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={openTeamSummaryHistory}
                        disabled={isLoadingTeamSummaryHistory}
                        className="px-2 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <History className="w-3 h-3" /> History
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerateTeamSummary}
                        disabled={selectedSubReportCount === 0 || isGeneratingTeamSummary}
                        className="px-2.5 py-1 text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isGeneratingTeamSummary ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Summary ({selectedSubReportCount})
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {(() => {
                const filtered = trSubTab === 'my_reports'
                  ? reports.filter(r => r.staffId === currentUser.id)
                  : subordinateFilteredReports;
                const hasActiveSubordinateFilters =
                  subordinateStaffFilter !== 'all' ||
                  subordinateStatusFilter !== 'all' ||
                  subordinateYearFilter !== 'all' ||
                  subordinateWeekFilter !== 'all' ||
                  !!subordinateSearchQuery.trim();

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-10 px-4 text-slate-400 text-xs space-y-2">
                      <FileText className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="font-medium">
                        {trSubTab === 'my_reports'
                          ? "You haven't created any weekly reports yet."
                          : hasActiveSubordinateFilters
                          ? "No reports match the selected filters."
                          : "No reports submitted by your subordinates yet."}
                      </p>
                      {trSubTab === 'subordinate_reports' && hasActiveSubordinateFilters && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubordinateStaffFilter('all');
                            setSubordinateStatusFilter('all');
                            setSubordinateYearFilter('all');
                            setSubordinateWeekFilter('all');
                            setSubordinateSearchQuery('');
                          }}
                          className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" /> Reset Filters
                        </button>
                      )}
                      {trSubTab === 'my_reports' && (
                        <button
                          onClick={() => { window.location.hash = '#/tr/new'; }}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 mt-1"
                        >
                          <Plus className="w-3.5 h-3.5" /> Start New Report
                        </button>
                      )}
                    </div>
                  );
                }

                return filtered.map(rep => {
                  const isSubordinateSelection = trSubTab === 'subordinate_reports';
                  return (
                    <div key={rep.id} className="flex items-start gap-2">
                      {isSubordinateSelection && (
                        <input
                          type="checkbox"
                          checked={selectedSubReportIds.has(rep.id)}
                          onChange={() => toggleSubReportSelection(rep.id)}
                          onClick={e => e.stopPropagation()}
                          className="mt-3 w-4 h-4 accent-blue-600 cursor-pointer shrink-0"
                          aria-label={`Select report from ${rep.staffName}, week ${rep.weekNumber}`}
                        />
                      )}
                      <button
                        onClick={() => {
                          setActiveReport(rep);
                          setIsCreating(false);
                          setShowMobileDetail(true);
                        }}
                        className={`flex-1 text-left p-3 rounded-xl border transition-all cursor-pointer ${
                          activeReport?.id === rep.id && !isCreating
                            ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                        }`}
                      >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-900">{rep.staffName}</span>
                      {rep.status === 'Approved' || rep.status === 'Reviewed' ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            rep.trScore === 100
                              ? 'bg-emerald-100 text-emerald-800'
                              : rep.trScore >= 70
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          Score: {rep.trScore}%
                        </span>
                      ) : rep.status === 'Draft' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          Draft (Editable)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                          Awaiting Grade
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 flex items-center justify-between">
                      <span>
                        W{rep.weekNumber} ({formatDateRange(rep.startDate, rep.endDate, rep.weekNumber, rep.year).shortRange}) • {rep.position}
                      </span>
                      <span
                        className={`capitalize font-bold text-[10px] px-1.5 py-0.5 rounded ${
                          rep.status === 'Approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : rep.status === 'Reviewed'
                            ? 'bg-blue-50 text-blue-700'
                            : rep.status === 'Draft'
                            ? 'bg-amber-100/80 text-amber-900 border border-amber-200'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {rep.status === 'Submitted' ? 'Submitted (Pending Review)' : rep.status === 'Draft' ? 'Draft' : (rep.status || 'Submitted')}
                      </span>
                    </div>

                    {rep.status === 'Draft' && (
                      <div className="text-[10px] text-amber-700 mt-1 flex items-center justify-between border-t border-slate-100/80 pt-1 font-medium">
                        <span>Draft in progress • Click to review or edit</span>
                      </div>
                    )}

                    {rep.status === 'Submitted' && (
                      <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between border-t border-slate-100/80 pt-1">
                        <span>
                          Checklist: {readPillars(rep).completion}/{TR_PILLAR1_MAX} • Punctuality: {readPillars(rep).timelinessText}/{TR_PILLAR2_MAX}
                        </span>
                        <span className="text-amber-700 font-semibold">Quality: Pending</span>
                      </div>
                    )}

                    {/* Deadline Countdown/Alert Badge for unsubmitted / draft T&R reports */}
                    {rep.staffId === currentUser.id &&
                     rep.status !== 'Submitted' &&
                     rep.status !== 'Approved' &&
                     rep.status !== 'Reviewed' &&
                     !rep.signature &&
                     (!rep.submissionDate || rep.status === 'Draft') && (() => {
                      const endDateStr = rep.endDate || getWeekDateRange(rep.weekNumber, rep.year).endDate;
                      if (!endDateStr) return null;
                      const days = getDaysDifferenceFromToday(endDateStr);
                      if (days < 0) {
                        return (
                          <div className="mt-1.5 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-extrabold flex items-center gap-1 border border-rose-200">
                            <AlertTriangle className="w-3 h-3 text-rose-600 animate-pulse" />
                            <span>Period ended {Math.abs(days)}d ago (Please submit)</span>
                          </div>
                        );
                      }
                      if (days === 0) {
                        return (
                          <div className="mt-1.5 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-extrabold flex items-center gap-1 border border-amber-300">
                            <Clock className="w-3 h-3 text-amber-700 animate-bounce" />
                            <span>Period ends TODAY!</span>
                          </div>
                        );
                      }
                      if (days <= 5) {
                        return (
                          <div className="mt-1.5 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 text-[10px] font-bold flex items-center gap-1 border border-blue-200">
                            <Clock className="w-3 h-3 text-blue-600" />
                            <span>Submission due in {days} days</span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
        )}

        {/* Right Column: Report Editor or Details Viewer */}
        <div className={pageMode ? 'lg:col-span-12' : `lg:col-span-8 ${showMobileDetail ? 'block' : 'hidden lg:block'}`}>
          {/* Mobile Back Button */}
          {!pageMode && showMobileDetail && (
            <div className="lg:hidden mb-3">
              <button
                type="button"
                onClick={() => {
                  setShowMobileDetail(false);
                  setIsCreating(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to report list
              </button>
            </div>
          )}
          {isCreating ? (
            /* CREATE / EDIT REPORT FORM */
            <form onSubmit={handleSubmitReport} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 gap-3 sm:gap-0">
                <div>
                  <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                    {editingReportId ? (
                      <>
                        <Edit2 className="w-4 h-4 text-blue-600" />
                        {(() => {
                          const existingRep = reports.find(r => r.id === editingReportId);
                          if (existingRep && existingRep.staffId !== currentUser.id) {
                            return `Edit Subordinate Report: ${existingRep.staffName} (${existingRep.position})`;
                          }
                          return 'Edit Submitted Weekly Report';
                        })()}
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 text-blue-600" /> New Weekly T&R Report Submission
                      </>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingReportId
                      ? 'Modify checklist deliverable items, completion status, notes, or e-signature for this report.'
                      : 'Tick off items completed during the week according to your position JD (all start unticked).'}
                  </p>
                  {lastDraftTime && !editingReportId && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Auto-save {lastDraftTime}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDiscardDraftAndReset}
                        className="px-2 py-1 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg font-semibold cursor-pointer transition-colors flex items-center gap-1"
                        title="Discard auto-save and reload official template"
                      >
                        <Trash2 className="w-3 h-3" /> Discard Auto-save
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 w-full sm:w-auto sm:block sm:text-right bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 sm:bg-transparent sm:border-0 sm:px-0 sm:py-0">
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">Checklist Score</span>
                  <div className="text-right min-w-0">
                    <span className={`block text-lg font-black ${totalCount === 0 ? 'text-slate-400' : completionScore === TR_PILLAR1_MAX ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {totalCount === 0 ? 'N/A' : `${completionScore}/${TR_PILLAR1_MAX}`}
                    </span>
                    {totalCount > 0 && (
                      <span className="block text-[10px] text-slate-500 font-medium mt-0.5">
                        Punctuality {draftTimelinessScore}/{TR_PILLAR2_MAX} • Base {trScore}/{TR_BASE_MAX}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Period Selectors */}
              <div
                ref={periodSectionRef}
                className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border ${
                  conflictHighlight ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200'
                }`}
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Year</label>
                  <ModernSelect
                    value={selectedYear}
                    onChange={e => handleYearChange(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 font-semibold"
                  >
                    {YEAR_OPTIONS.map(y => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </ModernSelect>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Quarter</label>
                  <ModernSelect
                    value={selectedQuarter}
                    onChange={e => handleQuarterChange(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 font-semibold"
                  >
                    <option value={1}>Quarter 1 (Q1)</option>
                    <option value={2}>Quarter 2 (Q2)</option>
                    <option value={3}>Quarter 3 (Q3)</option>
                    <option value={4}>Quarter 4 (Q4)</option>
                  </ModernSelect>
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${conflictHighlight ? 'text-rose-700' : 'text-slate-700'}`}>From Date (Start)</label>
                  <input
                    type="date"
                    value={startDateInput}
                    onChange={e => {
                      setConflictHighlight(false);
                      setSubmitConflict(null);
                      handleStartDateChange(e.target.value);
                    }}
                    className={`w-full px-3 py-1.5 rounded-lg text-xs bg-white font-semibold transition-all ${
                      conflictHighlight
                        ? 'border-2 border-rose-500 bg-rose-50 text-rose-900 focus:ring-2 focus:ring-rose-500'
                        : 'border border-slate-300 text-slate-900'
                    }`}
                    style={conflictHighlight ? { animation: 'submitConflictShake 0.5s ease-in-out 2' } : undefined}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${conflictHighlight ? 'text-rose-700' : 'text-slate-700'}`}>To Date (End)</label>
                  <input
                    type="date"
                    value={endDateInput}
                    onChange={e => {
                      setConflictHighlight(false);
                      setSubmitConflict(null);
                      handleEndDateChange(e.target.value);
                    }}
                    className={`w-full px-3 py-1.5 rounded-lg text-xs bg-white font-semibold transition-all ${
                      conflictHighlight
                        ? 'border-2 border-rose-500 bg-rose-50 text-rose-900 focus:ring-2 focus:ring-rose-500'
                        : 'border border-slate-300 text-slate-900'
                    }`}
                    style={conflictHighlight ? { animation: 'submitConflictShake 0.5s ease-in-out 2' } : undefined}
                  />
                </div>
              </div>

              {/* Selected Date Period Banner */}
              <div className="text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 px-3.5 py-2 rounded-xl flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Selected Report Period:
                </span>
                <span className="font-bold text-blue-900 bg-white px-2.5 py-0.5 rounded-lg border border-blue-200 shadow-xs font-mono">
                  {formatDateRange(startDateInput, endDateInput, selectedWeek, selectedYear).formattedRange}
                </span>
              </div>

              {/* Check if latest Official JD Template has been updated compared to current form draft */}
              {(() => {
                const rep = editingReportId ? reports.find(r => r.id === editingReportId) : null;
                const pos = rep ? rep.position : currentUser.position;
                const dept = rep ? rep.department : currentUser.department;
                const activeOfficialTemplate = getTemplateForPosition(pos, dept);
                const isTemplateDifferentFromForm = Boolean(
                  activeOfficialTemplate &&
                  activeOfficialTemplate.items &&
                  activeOfficialTemplate.items.length > 0 &&
                  (activeOfficialTemplate.items.length !== checklistState.length ||
                   checklistState.some(c => c.title.trim().startsWith('222') || !activeOfficialTemplate.items.some(t => t.id === c.itemId || t.title.toLowerCase().trim() === c.title.toLowerCase().trim())))
                );

                if (!isTemplateDifferentFromForm || !activeOfficialTemplate) return null;

                return (
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-400 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-start gap-2.5">
                      <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg shrink-0">
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                          Updated JD Position Template Available ({activeOfficialTemplate.items.length} deliverables)
                        </h4>
                        <p className="text-[11px] text-amber-800 mt-0.5">
                          This form currently displays an older auto-save ({checklistState.length} items). Click below to sync and load all {activeOfficialTemplate.items.length} deliverables from the updated Official Job Description.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSyncWithOfficialTemplate}
                      className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Sync Latest Official JD ({activeOfficialTemplate.items.length} items)
                    </button>
                  </div>
                );
              })()}

              {/* Official Submission Deadline Banner (Monday before 11:30 AM) with Extension Action */}
              {(() => {
                const rep = editingReportId ? reports.find(r => r.id === editingReportId) : existingReportForDraft;
                const targetEnd = endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate;
                const dlInfo = getTRSubmissionDeadline(targetEnd, rep?.approvedDeadline);
                const hasPendingExt = rep?.extensionRequest?.status === 'Pending';
                const hasApprovedExt = rep?.extensionRequest?.status === 'Approved' || dlInfo.isExtended;
                const hasRejectedExt = rep?.extensionRequest?.status === 'Rejected';
                const timeCheck = calculateTRTimelinessScore(
                  new Date().toISOString(),
                  targetEnd,
                  rep?.approvedDeadline,
                  rep?.latePenaltyWaived
                );

                const isHistoricalBackfill = timeCheck.daysDiff > 7 && !hasApprovedExt && !hasPendingExt;

                // When backfilling a past historical week (e.g., from months ago), do not prompt for extension!
                if (isHistoricalBackfill) {
                  return (
                    <div className="p-2.5 sm:px-3.5 rounded-xl border border-indigo-200 bg-indigo-50/80 text-indigo-950 text-xs transition-all shadow-2xs">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                          <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700 shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <span className="font-bold text-xs sm:text-sm text-slate-900">
                            Historical Backfill Mode
                          </span>
                          <span className="text-[10px] bg-indigo-200 text-indigo-900 border border-indigo-300 font-bold px-2 py-0.5 rounded-full">
                            Past Week {selectedWeek} ({timeCheck.daysDiff}d ago)
                          </span>
                          <span className="text-[11px] text-indigo-900 hidden md:inline">
                            • Late penalty waived by superior upon approval
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="hidden sm:flex items-center gap-1 bg-white border border-indigo-200 px-2 py-0.5 rounded-md text-[10px] font-bold text-indigo-900">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Backfill Active
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowFormDeadlineDetails(!showFormDeadlineDetails)}
                            className="px-2 py-1 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white/90 hover:bg-white rounded-lg border border-slate-300 flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            {showFormDeadlineDetails ? (
                              <>Hide Details <ChevronUp className="w-3 h-3" /></>
                            ) : (
                              <>Details <ChevronDown className="w-3 h-3" /></>
                            )}
                          </button>
                        </div>
                      </div>

                      {showFormDeadlineDetails && (
                        <div className="mt-2 pt-2 border-t border-indigo-200/70 text-[11px] text-slate-600 space-y-1 animate-in fade-in duration-150">
                          <p>
                            Recording operational checklist for past Week {selectedWeek}, {selectedYear}. You do <strong>not</strong> need to request an extension for backfills — your superior will review and waive the late penalty upon approval.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="p-2.5 sm:px-3.5 rounded-xl border border-amber-300 bg-amber-50/90 text-amber-950 text-xs transition-all shadow-2xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-2.5">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0 sm:flex-1">
                        <div className="p-1.5 rounded-lg bg-amber-200 text-amber-800 shrink-0">
                          <Clock className="w-4 h-4" />
                        </div>
                        <span className="font-bold text-xs sm:text-sm text-slate-900">
                          Official Submission Deadline:
                        </span>
                        <span className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-slate-300 text-slate-800 font-semibold">
                          Monday before 11:30 AM
                        </span>
                        {hasApprovedExt ? (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Grace Period Granted
                          </span>
                        ) : hasPendingExt ? (
                          <span className="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-700 animate-pulse" /> Extension Pending Review
                          </span>
                        ) : hasRejectedExt ? (
                          <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 font-bold px-2 py-0.5 rounded-full">
                            Extension Declined
                          </span>
                        ) : timeCheck.isLate ? (
                          <span className="text-[10px] bg-rose-200 text-rose-900 border border-rose-300 font-bold px-2 py-0.5 rounded-full">
                            Cutoff Passed ({timeCheck.daysDiff}d late)
                          </span>
                        ) : (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2 py-0.5 rounded-full">
                            On-Time Window Open
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        {hasPendingExt ? (
                          <span className="text-[11px] bg-white text-amber-800 border border-amber-300 px-2.5 py-1.5 sm:py-1 rounded-lg font-semibold shadow-2xs flex-1 sm:flex-none text-center">
                            Request Under Review
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenExtensionModal(rep)}
                            className="px-2.5 py-1.5 sm:py-1 bg-white hover:bg-slate-50 text-blue-700 border border-blue-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1 flex-1 sm:flex-none shadow-2xs cursor-pointer transition-all active:scale-95"
                          >
                            <Calendar className="w-3 h-3 text-blue-600" />
                            {hasApprovedExt ? 'Request Further Extension' : 'Request Extension'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setShowFormDeadlineDetails(!showFormDeadlineDetails)}
                          className="px-2 py-1.5 sm:py-1 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white/90 hover:bg-white rounded-lg border border-slate-300 flex items-center justify-center gap-1 flex-1 sm:flex-none cursor-pointer transition-colors"
                        >
                          {showFormDeadlineDetails ? (
                            <>Hide Details <ChevronUp className="w-3 h-3" /></>
                          ) : (
                            <>Details <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      </div>
                    </div>

                    {showFormDeadlineDetails && (
                      <div className="mt-2 pt-2 border-t border-black/10 text-[11px] text-slate-600 space-y-1 animate-in fade-in duration-150">
                        <span>
                          {hasApprovedExt
                            ? `Approved Extended Cutoff: ${dlInfo.formattedDeadline} (Full 20/20 punctuality score granted without late penalty)`
                            : `Submission Cutoff: ${dlInfo.formattedDeadline}`}
                        </span>
                        {hasPendingExt && (
                          <div className="text-amber-800 font-medium">
                            Awaiting superior review for requested deadline: <strong>{formatDateTimeFriendly(rep?.extensionRequest?.requestedDeadline)}</strong> ("{rep?.extensionRequest?.reason}")
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Official Locked Position Template Checklist */}
              <div>
                <div className="flex flex-col gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className={`w-4 h-4 shrink-0 ${totalCount > 0 ? 'text-blue-600' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold text-slate-800">
                        Official Position Checklist ({(() => {
                          const rep = editingReportId ? reports.find(r => r.id === editingReportId) : null;
                          const pos = rep ? rep.position : currentUser.position;
                          const dept = rep ? rep.department : currentUser.department;
                          return `${pos || 'No Position Set'} • ${dept}`;
                        })()})
                      </span>
                    </div>
                    <span className="block w-full text-[11px] text-slate-500 mt-1">
                      {totalCount > 0
                        ? `${completedCount} of ${applicableCount} applicable deliverables completed${naCount > 0 ? ` (${naCount} marked N/A - excluded from score)` : ''}${pillar1.locked > 0 ? ` (${pillar1.locked} already fulfilled earlier in this cycle - excluded from score)` : ''}. Weekly items may be marked N/A when they do not apply; Monthly and Year Tasks retain their cycle locks; Anytime tasks may be set to N/A at any time.`
                        : 'No checklist deliverables registered yet for this position & department.'}
                    </span>
                  </div>
                  <div className="flex flex-row items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleCopyNotesFromPreviousReport}
                      className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all"
                      title="Copy routine progress notes and links from your most recent prior weekly report"
                    >
                      <Copy className="w-3 h-3 text-emerald-600" /> Copy Last Week's Notes
                    </button>
                    {(() => {
                      const rep = editingReportId ? reports.find(r => r.id === editingReportId) : null;
                      const pos = rep ? rep.position : currentUser.position;
                      const dept = rep ? rep.department : currentUser.department;
                      const activeOfficialTemplate = getTemplateForPosition(pos, dept);
                      if (activeOfficialTemplate && activeOfficialTemplate.items && activeOfficialTemplate.items.length > 0) {
                        return (
                          <button
                            type="button"
                            onClick={handleSyncWithOfficialTemplate}
                            className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all"
                            title="Reload items from Official JD Template"
                          >
                            <RefreshCw className="w-3 h-3 text-blue-600" /> Reload Official JD ({activeOfficialTemplate.items.length})
                          </button>
                        );
                      }
                      return null;
                    })()}
                    {totalCount <= 0 && (
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold border border-slate-200">
                        NOT CONFIGURED YET
                      </span>
                    )}
                  </div>
                </div>

                {/* Alert to staff if Week 4 (or month-end) and monthly tasks are not yet completed */}
                {(() => {
                  const isWeek4OrMonthEnd = currentMonthInfo.weekIndexInMonth >= 4 || currentMonthInfo.isLastWeekOfMonth;
                  if (!isWeek4OrMonthEnd) return null;

                  const uncompletedMonthlyItems = checklistState.filter(it => {
                    if (it.category !== 'Monthly') return false;
                    const isDoneNow = it.status === 'completed' || it.completed;
                    if (isDoneNow) return false;
                    const mStatus = getMonthlyTaskMonthStatus(it);
                    return !mStatus?.isCompletedEarlier;
                  });

                  if (uncompletedMonthlyItems.length === 0) return null;

                  return (
                    <div className="mb-3 bg-amber-50 border-2 border-amber-400 rounded-xl shadow-xs">
                      <button
                        type="button"
                        onClick={() => setShowMonthEndReminder(v => !v)}
                        className="w-full flex items-start gap-3 p-3.5 text-left cursor-pointer"
                        title={showMonthEndReminder ? 'Hide reminder details' : 'Show reminder details'}
                      >
                        <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg shrink-0 mt-0.5">
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        </div>
                        <h4 className="flex-1 text-xs font-bold text-amber-950">
                          ⚠️ Week {currentMonthInfo.weekIndexInMonth} Month-End Reminder: {uncompletedMonthlyItems.length} Incomplete Monthly {uncompletedMonthlyItems.length === 1 ? 'Deliverable' : 'Deliverables'}
                        </h4>
                        <span className="flex items-center gap-1 text-amber-700 shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wide">
                          Details
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMonthEndReminder ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      {showMonthEndReminder && (
                        <div className="px-3.5 pb-3.5">
                          <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                            This is <strong>Week {currentMonthInfo.weekIndexInMonth} of {currentMonthInfo.monthName}</strong>. You have <strong>{uncompletedMonthlyItems.length} monthly {uncompletedMonthlyItems.length === 1 ? 'task' : 'tasks'}</strong> pending that have not been completed yet this month. Please execute and check them off before the monthly reporting cycle closes:
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {uncompletedMonthlyItems.map(item => (
                              <span
                                key={item.itemId || item.title}
                                className="px-2 py-0.5 bg-white border border-amber-300 text-amber-900 rounded-md text-[10px] font-semibold"
                              >
                                • {item.title}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Monthly Deliverables Status & End-of-Month Audit Widget */}
                {checklistState.some(it => it.category === 'Monthly') && (
                  <div className={`mb-3 rounded-xl border transition-all ${
                    currentMonthInfo.isLastWeekOfMonth
                      ? 'bg-amber-50/90 border-amber-300 ring-1 ring-amber-200'
                      : 'bg-purple-50/60 border-purple-200'
                  }`}>
                    <button
                      type="button"
                      onClick={() => setShowMonthlyDeliverables(v => !v)}
                      className="w-full flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2.5 flex-wrap text-left cursor-pointer"
                      title={showMonthlyDeliverables ? 'Hide monthly deliverables details' : 'Show monthly deliverables details'}
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className={`w-4 h-4 ${currentMonthInfo.isLastWeekOfMonth ? 'text-amber-600' : 'text-purple-600'}`} />
<span className="text-[11px] sm:text-xs font-bold text-slate-900 leading-tight">
                          {currentMonthInfo.monthName} {selectedYear} — Monthly Deliverables Cycle (Week {currentMonthInfo.weekIndexInMonth} of {currentMonthInfo.totalWeeksInMonth})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {currentMonthInfo.isLastWeekOfMonth ? (
                          <span className="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-black tracking-wide uppercase">
                            Final Week of Month (Audit Week)
                          </span>
                        ) : (
                          <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-200 px-2 py-0.5 rounded font-bold">
                            Flexible Scheduling Active
                          </span>
                        )}
                        <span className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${currentMonthInfo.isLastWeekOfMonth ? 'text-amber-700' : 'text-purple-700'}`}>
                          Details
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMonthlyDeliverables ? 'rotate-180' : ''} ${currentMonthInfo.isLastWeekOfMonth ? 'text-amber-600' : 'text-purple-600'}`} />
                        </span>
                      </div>
                    </button>

                    {showMonthlyDeliverables && (
                      <div className="px-3.5 pb-3.5 pt-2.5 border-t border-slate-200/70 mt-0.5">
                        {currentMonthInfo.isLastWeekOfMonth ? (
                          <p className="text-[11px] text-amber-950">
                            ⚠️ <strong>Month-End Rule:</strong> This is the final week of {currentMonthInfo.monthName}. Any monthly deliverable that was not fulfilled in earlier weeks must be executed now. <strong>N/A is locked for unfulfilled monthly tasks</strong> so they cannot be bypassed.
                          </p>
                        ) : (
                          <p className="text-[11px] text-purple-900">
                            Monthly tasks can be completed in any week during {currentMonthInfo.monthName}. If you perform a monthly task this week, mark it <strong>Done</strong>; in off-weeks, select <strong>N/A</strong>. Only you may schedule a monthly task, and only once per month: the week you schedule it in stays editable while it is a draft, every other week of {currentMonthInfo.monthName} will show it <strong>Locked</strong>, and the new month clears it.
                          </p>
                        )}

                        {/* Monthly tasks mini-status chips */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2.5 mt-2.5 border-t border-slate-200/70">
                          {checklistState
                            .filter(it => it.category === 'Monthly')
                            .map((mItem, mIdx) => {
                              const mStatus = getMonthlyTaskMonthStatus(mItem);
                              const isDoneThisWeek = mItem.status === 'completed' || mItem.completed;

                              return (
                                <div
                                  key={mItem.itemId || mIdx}
                                  className="flex items-center justify-between gap-2 p-2 bg-white/90 rounded-lg border border-slate-200 text-xs"
                                >
                                  <span className="font-semibold text-slate-800 truncate" title={mItem.title}>
                                    {mItem.title}
                                  </span>
                                  {isDoneThisWeek ? (
                                    <span className="shrink-0 text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-black border border-emerald-300">
                                      Done This Week
                                    </span>
                                  ) : mStatus?.isCompletedEarlier ? (
                                    <span className="shrink-0 text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold border border-emerald-200">
                                      Done in W{mStatus.completedEarlierWeek}
                                    </span>
                                  ) : currentMonthInfo.isLastWeekOfMonth ? (
                                    <span className="shrink-0 text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-black border border-rose-300">
                                      Mandatory Now
                                    </span>
                                  ) : (
                                    <span className="shrink-0 text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                                      Pending in {currentMonthInfo.monthName}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Alert to staff in the yearly cycle's FINAL month (January) when
                    annual deliverables are still unfulfilled — they expire on 31 Jan. */}
                {(() => {
                  if (!isYearlyFinalMonth) return null;

                  const uncompletedYearlyItems = checklistState.filter(it => {
                    if (!isYearlyCycle(it.category)) return false;
                    const isDoneNow = it.status === 'completed' || it.completed;
                    if (isDoneNow) return false;
                    const yStatus = getYearlyTaskCycleStatus(it);
                    return !yStatus?.isCompletedEarlier;
                  });

                  if (uncompletedYearlyItems.length === 0) return null;

                  return (
                    <div className="mb-3 bg-rose-50 border-2 border-rose-400 rounded-xl shadow-xs">
                      <button
                        type="button"
                        onClick={() => setShowYearEndReminder(v => !v)}
                        className="w-full flex items-start gap-3 p-3.5 text-left cursor-pointer"
                        title={showYearEndReminder ? 'Hide reminder details' : 'Show reminder details'}
                      >
                        <div className="p-1.5 bg-rose-100 text-rose-800 rounded-lg shrink-0 mt-0.5">
                          <AlertTriangle className="w-5 h-5 text-rose-600" />
                        </div>
                        <h4 className="flex-1 text-xs font-bold text-rose-950">
                          ⏳ Year-End Reminder ({activeYearlyCycleKey} cycle): {uncompletedYearlyItems.length} Unfulfilled Year {uncompletedYearlyItems.length === 1 ? 'Task' : 'Tasks'} — Expire 31 Jan
                        </h4>
                        <span className="flex items-center gap-1 text-rose-700 shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wide">
                          Details
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showYearEndReminder ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      {showYearEndReminder && (
                        <div className="px-3.5 pb-3.5">
                          <p className="text-[11px] text-rose-800 mt-0.5 leading-relaxed">
                            January is the <strong>final month of the {activeYearlyCycleKey} annual cycle</strong> (expiry 31 January). These year tasks have not been fulfilled this cycle, so <strong>N/A is locked</strong> — please execute and check them off before the cycle closes:
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {uncompletedYearlyItems.map(item => (
                              <span
                                key={item.itemId || item.title}
                                className="px-2 py-0.5 bg-white border border-rose-300 text-rose-900 rounded-md text-[10px] font-semibold"
                              >
                                • {item.title}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Yearly Deliverables Status & Year-End Audit Widget */}
                {checklistState.some(it => isYearlyCycle(it.category)) && (
                  <div className={`mb-3 rounded-xl border transition-all ${
                    isYearlyFinalMonth
                      ? 'bg-rose-50/90 border-rose-300 ring-1 ring-rose-200'
                      : 'bg-orange-50/60 border-orange-200'
                  }`}>
                    <button
                      type="button"
                      onClick={() => setShowYearlyDeliverables(v => !v)}
                      className="w-full flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2.5 flex-wrap text-left cursor-pointer"
                      title={showYearlyDeliverables ? 'Hide year task details' : 'Show year task details'}
                    >
                      <div className="flex items-center gap-2">
                        <Calendar className={`w-4 h-4 ${isYearlyFinalMonth ? 'text-rose-600' : 'text-orange-600'}`} />
                        <span className="text-[11px] sm:text-xs font-bold text-slate-900 leading-tight">
                          {activeYearlyCycleKey} Annual Cycle — Year Tasks (Expires 31 Jan {Number(activeYearlyCycleKey) + 1})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isYearlyFinalMonth ? (
                          <span className="text-[10px] bg-rose-200 text-rose-900 border border-rose-300 px-2 py-0.5 rounded font-black tracking-wide uppercase">
                            Final Month (Expires 31 Jan)
                          </span>
                        ) : (
                          <span className="text-[10px] bg-orange-100 text-orange-800 border border-orange-200 px-2 py-0.5 rounded font-bold">
                            Flexible Scheduling Active
                          </span>
                        )}
                        <span className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${isYearlyFinalMonth ? 'text-rose-700' : 'text-orange-700'}`}>
                          Details
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showYearlyDeliverables ? 'rotate-180' : ''} ${isYearlyFinalMonth ? 'text-rose-600' : 'text-orange-600'}`} />
                        </span>
                      </div>
                    </button>

                    {showYearlyDeliverables && (
                      <div className="px-3.5 pb-3.5 pt-2.5 border-t border-slate-200/70 mt-0.5">
                        {isYearlyFinalMonth ? (
                          <p className="text-[11px] text-rose-950">
                            ⚠️ <strong>Year-End Rule:</strong> This is the final month of the {activeYearlyCycleKey} cycle (expires <strong>31 January</strong>). Any year task not fulfilled during the cycle must be executed now — <strong>N/A is locked</strong> so it cannot be bypassed. From 1 February the cycle resets.
                          </p>
                        ) : (
                          <p className="text-[11px] text-orange-900">
                            Year tasks may be completed in any week of the {activeYearlyCycleKey} cycle. Mark the week you perform one as <strong>Done</strong>; in all other weeks select <strong>N/A</strong>. Only you may schedule a year task, and only once per year: the week you schedule it in stays editable while it is a draft, every other week of the cycle shows it <strong>Locked</strong>, and N/A stays available until the final month — <strong>January</strong>, where the cycle expires on 31 January.
                          </p>
                        )}

                        {/* Yearly tasks mini-status chips */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2.5 mt-2.5 border-t border-slate-200/70">
                          {checklistState
                            .filter(it => isYearlyCycle(it.category))
                            .map((yItem, yIdx) => {
                              const yStatus = getYearlyTaskCycleStatus(yItem);
                              const isDoneThisWeek = yItem.status === 'completed' || yItem.completed;

                              return (
                                <div
                                  key={yItem.itemId || yIdx}
                                  className="flex items-center justify-between gap-2 p-2 bg-white/90 rounded-lg border border-slate-200 text-xs"
                                >
                                  <span className="font-semibold text-slate-800 truncate" title={yItem.title}>
                                    {yItem.title}
                                  </span>
                                  {isDoneThisWeek ? (
                                    <span className="shrink-0 text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-black border border-emerald-300">
                                      Done This Week
                                    </span>
                                  ) : yStatus?.isCompletedEarlier ? (
                                    <span className="shrink-0 text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold border border-emerald-200">
                                      Done in W{yStatus.completedEarlierWeek} {yStatus.completedEarlierYear}
                                    </span>
                                  ) : isYearlyFinalMonth ? (
                                    <span className="shrink-0 text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-black border border-rose-300">
                                      Mandatory Now
                                    </span>
                                  ) : (
                                    <span className="shrink-0 text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                                      Pending in {activeYearlyCycleKey}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Checklist items list */}
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {checklistState.length === 0 ? (
                    <div className="text-center py-10 px-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto mb-1">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">No Position Checklist Assigned Yet</h4>
                      <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                        There is currently no official position checklist configured for{' '}
                        <strong>
                          {editingReportId
                            ? (reports.find(r => r.id === editingReportId)?.position || currentUser.position)
                            : currentUser.position || 'your position'}
                          {' '}({editingReportId
                            ? (reports.find(r => r.id === editingReportId)?.department || currentUser.department)
                            : currentUser.department})
                        </strong>.
                        HR or Admin can create and assign the position template specifically for your department in the Admin Console.
                      </p>
                    </div>
                  ) : (
                    checklistState.map((item, idx) => {
                      const itemStatus: ChecklistItemStatus = item.status || (item.completed ? 'completed' : 'incomplete');
                      const isMonthly = isMonthlyCycle(item.category);
                      const isYearly = isYearlyCycle(item.category);
                      const isAnytimeItem = isAnytime(item.category);
                      const mStatus = isMonthly ? getMonthlyTaskMonthStatus(item) : null;
                      const yStatus = isYearly ? getYearlyTaskCycleStatus(item) : null;
                      const fulfilledEarlier = !!mStatus?.isCompletedEarlier || !!yStatus?.isCompletedEarlier;
                      // A Monthly deliverable is locked once the owner has scheduled it as
                      // Done in ANOTHER week of this month. The report being edited stays
                      // editable while it is a draft, and a new month clears the claim.
                      // A Yearly deliverable works the same way with the cycle swapped to
                      // the ANNUAL cycle (cleared when the January expiry passes).
                      const controlsLocked =
                        (isMonthly && isMonthlyTaskClaimedByAnotherWeek(item)) ||
                        (isYearly && isYearlyTaskClaimedByAnotherWeek(item));
                      const isDone = itemStatus === 'completed';

                      return (
                        <div
                          key={item.itemId || idx}
                          className={`p-3.5 rounded-xl border transition-all ${
                            itemStatus === 'completed'
                              ? 'border-emerald-300 bg-emerald-50/40'
                              : itemStatus === 'na'
                              ? 'border-slate-300 bg-slate-100/70 opacity-80'
                              : mStatus?.isNaBlocked || yStatus?.isNaBlocked
                              ? 'border-rose-300 bg-rose-50/30 ring-1 ring-rose-200'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span
                                  className={`text-xs font-bold ${
                                    itemStatus === 'completed'
                                      ? 'text-slate-900 line-through decoration-emerald-500 decoration-2'
                                      : itemStatus === 'na'
                                      ? 'text-slate-500 italic'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {item.title}
                                </span>

                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded font-black shrink-0 tracking-wide uppercase ${frequencyBadgeClass(item.category)}`}
                                  title={frequencyRuleHint(item.category)}
                                >
                                  {frequencyLabel(item.category, Number(activeYearlyCycleKey))}
                                </span>

                                {mStatus?.isCompletedEarlier && (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded font-black flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    <span>Fulfilled in W{mStatus.completedEarlierWeek}</span>
                                  </span>
                                )}

                                {yStatus?.isCompletedEarlier && (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded font-black flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    <span>Fulfilled in W{yStatus.completedEarlierWeek} {yStatus.completedEarlierYear}</span>
                                  </span>
                                )}

                                {mStatus?.isNaBlocked && itemStatus !== 'completed' && (
                                  <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded font-black flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                                    <span>Final Week of {mStatus.monthName} — Mandatory</span>
                                  </span>
                                )}

                                {yStatus?.isNaBlocked && itemStatus !== 'completed' && (
                                  <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded font-black flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                                    <span>Year-End · January — Mandatory</span>
                                  </span>
                                )}
                              </div>

                              <input
                                type="text"
                                placeholder={
                                  itemStatus === 'na'
                                    ? 'Note: Not scheduled for this week cycle (excluded from score)...'
                                    : mStatus?.isNaBlocked
                                    ? 'Mandatory deliverable for end of month (provide accomplishment proof)...'
                                    : yStatus?.isNaBlocked
                                    ? 'Mandatory Year Task for January (expires 31 Jan — provide accomplishment proof)...'
                                    : 'Add accomplishment notes / proof link / remarks...'
                                }
                                value={item.note || ''}
                                onChange={e => handleUpdateItemNote(item.itemId, e.target.value)}
                                className="w-full text-xs px-2.5 py-1 border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>

                              {/* 3-State Controls: Done / Incomplete / N/A, with monthly/yearly cycle locks */}
                              {controlsLocked ? (
                                <div
                                  className="flex items-center gap-1.5 shrink-0 bg-emerald-50 p-2 rounded-xl border border-emerald-200 shadow-2xs self-end sm:self-center cursor-not-allowed select-none"
                                  title={isYearly
                                    ? (fulfilledEarlier
                                      ? `This yearly deliverable was already scheduled and fulfilled in Week ${yStatus?.completedEarlierWeek} of the ${activeYearlyCycleKey} cycle — only one submission per year (holds until 31 January).`
                                      : `This yearly deliverable was already scheduled as Done in another week of the ${activeYearlyCycleKey} cycle — only one submission per year is allowed.`)
                                    : (fulfilledEarlier
                                      ? `This monthly deliverable was already scheduled and fulfilled in Week ${mStatus?.completedEarlierWeek} of ${mStatus?.monthName} — only the owner may schedule a monthly task, and only once per month.`
                                      : `This monthly deliverable was already scheduled as Done in another week of ${currentMonthInfo.monthName} — only the owner may schedule a monthly task, and only once per month.`)}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-[11px] font-black text-emerald-700 whitespace-nowrap">
                                    {isYearly
                                      ? (fulfilledEarlier
                                        ? `Locked • Fulfilled in W${yStatus?.completedEarlierWeek}`
                                        : `Locked • Done · ${activeYearlyCycleKey}`)
                                      : (fulfilledEarlier
                                        ? `Locked • Fulfilled in W${mStatus?.completedEarlierWeek}`
                                        : `Locked • Done · ${currentMonthInfo.monthName}`)}
                                  </span>
                                </div>
                              ) : (
                              <div className="flex items-center gap-1 shrink-0 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs self-end sm:self-center">
                              {/* Done button */}
                              <button
                                type="button"
                                onClick={() => handleSetItemStatus(item.itemId, 'completed')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                  isDone
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-emerald-700'
                                }`}
                                title="Mark deliverable as Completed / Done"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Done</span>
                              </button>

                              {/* Incomplete button */}
                              <button
                                type="button"
                                onClick={() => handleSetItemStatus(item.itemId, 'incomplete')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                  itemStatus === 'incomplete'
                                    ? 'bg-rose-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-rose-700'
                                }`}
                                title="Mark deliverable as Incomplete / Pending"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Not Done</span>
                              </button>

                              {/* N/A button:
                                  - Weekly  -> available when the task is not applicable
                                  - Anytime -> ALWAYS available, never locked
                                  - Monthly -> available unless locked in the month's final week */}
                              {isAnytimeItem ? (
                                <button
                                  type="button"
                                  onClick={() => handleSetItemStatus(item.itemId, 'na')}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                    itemStatus === 'na'
                                      ? 'bg-slate-700 text-white shadow-xs'
                                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                  }`}
                                  title="Anytime tasks are on demand — you may select N/A at any time, in any week (will not reduce score)"
                                >
                                  <MinusCircle className="w-3.5 h-3.5" />
                                  <span>N/A</span>
                                </button>
                              ) : isMonthly ? (
                                mStatus?.isNaBlocked ? (
                                  <div
                                    className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed select-none"
                                    title={`N/A Locked: This monthly deliverable was not completed in earlier weeks of ${mStatus.monthName} and is mandatory for the month's final week.`}
                                  >
                                    <MinusCircle className="w-3.5 h-3.5 text-slate-400" />
                                    <span className="text-[11px]">N/A Locked</span>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSetItemStatus(item.itemId, 'na')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                      itemStatus === 'na'
                                        ? 'bg-slate-700 text-white shadow-xs'
                                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                    }`}
                                    title="Mark as N/A (Not scheduled for this specific week cycle; will not reduce score)"
                                  >
                                    <MinusCircle className="w-3.5 h-3.5" />
                                    <span>N/A</span>
                                  </button>
                                )
                              ) : isYearly ? (
                                yStatus?.isNaBlocked ? (
                                  <div
                                    className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed select-none"
                                    title="N/A Locked: This Year Task has not been fulfilled in this annual cycle. January is the cycle's final month (expires 31 Jan) — it is mandatory now."
                                  >
                                    <MinusCircle className="w-3.5 h-3.5 text-slate-400" />
                                    <span className="text-[11px]">N/A Locked</span>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSetItemStatus(item.itemId, 'na')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                      itemStatus === 'na'
                                        ? 'bg-slate-700 text-white shadow-xs'
                                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                    }`}
                                    title="Mark as N/A (Not scheduled in this annual cycle; allowed until the cycle's final month — January. Will not reduce score)"
                                  >
                                    <MinusCircle className="w-3.5 h-3.5" />
                                    <span>N/A</span>
                                  </button>
                                )
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSetItemStatus(item.itemId, 'na')}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                                    itemStatus === 'na'
                                      ? 'bg-slate-700 text-white shadow-xs'
                                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                  }`}
                                  title="Mark this weekly deliverable as not applicable for this reporting period"
                                >
                                  <MinusCircle className="w-3.5 h-3.5" />
                                  <span>N/A</span>
                                </button>
                              )}
                            </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Additional Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Weekly Achievements & Remarks</label>
                <textarea
                  rows={2}
                  value={reportNotes}
                  onChange={e => setReportNotes(e.target.value)}
                  placeholder="Provide additional details regarding weekly responsibilities..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Weekly Summary Form (IRG-HR-FRM-WSUM-001 v1.1) — below the
                  checklist, above the Superior Evaluation Feedback box. */}
              <div className="border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      Weekly Summary Form
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      IRG-HR-FRM-WSUM-001 v1.1 · Submitted together with your JD checklist.
                    </p>
                  </div>
                </div>
                <WeeklySummaryForm
                  value={weeklySummary}
                  onChange={setWeeklySummary}
                  taskTitles={checklistState.map(c => c.title)}
                  weekStart={startDateInput || getWeekDateRange(selectedWeek, selectedYear).startDate}
                  weekEnd={endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate}
                  hideConfirm
                />
              </div>

              {/* Late / Retroactive Submission Justification to Superior */}
              {(() => {
                const targetEnd = endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate;
                const timelinessCheck = calculateTRTimelinessScore(new Date().toISOString(), targetEnd);
                const isLate = timelinessCheck.daysDiff > 0;
                if (!isLate) return null;

                const isHistoricalBackfill = timelinessCheck.daysDiff > 7;

                // Dedicated, clean card for Historical Backfill (past weeks)
                if (isHistoricalBackfill) {
                  return (
                    <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-2.5">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span className="text-xs font-bold text-indigo-950">
                            Historical Backfill Submission (Past Period)
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-indigo-900 bg-white px-2.5 py-0.5 rounded-full border border-indigo-200">
                          Automatic Penalty Waiver on Superior Review
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-700 leading-relaxed">
                        Because this report covers a past historical period ({timelinessCheck.daysDiff} days ago), it is recorded as a <strong>Retroactive Backfill</strong>. An advance extension request is not required. Your superior can review the note below and waive the late penalty to grant full <strong>20/20 punctuality points</strong>.
                      </p>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-indigo-950 uppercase tracking-wide block">
                          Backfill Note / Rationale:
                        </label>
                        <input
                          type="text"
                          value={delayReason}
                          onChange={e => setDelayReason(e.target.value)}
                          placeholder={`Retroactive / Backfill: Recording operational accomplishments for Week ${selectedWeek}, ${selectedYear}.`}
                          className="w-full px-3 py-2 border border-indigo-300 bg-white rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  );
                }

                // Recent late submission for the current active week
                return (
                  <div className="p-3.5 bg-amber-50/90 border-2 border-amber-300 rounded-xl space-y-2.5">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span className="text-xs font-bold text-amber-950">
                          Explain Delay to Superior
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-amber-900 bg-amber-200/90 px-2.5 py-0.5 rounded-full border border-amber-300">
                        {timelinessCheck.daysDiff} day(s) past week cutoff ({timelinessCheck.score}/20 pts)
                      </span>
                    </div>

                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      If this report is being submitted past the Monday 11:30 AM deadline, please provide a brief reason below. <strong>Your superior can review this explanation and waive the late penalty upon approval.</strong>
                    </p>

                    {/* Quick Presets for Fast One-Click Selection */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-amber-950 uppercase tracking-wide block">
                        Quick Reason Presets:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDelayReason('Operational delay: Awaiting cross-departmental dependency or external confirmation.')}
                          className="text-[10px] bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors shadow-2xs"
                        >
                          ⚡ Operational / Dependency Delay
                        </button>
                        <button
                          type="button"
                          onClick={() => setDelayReason('Extension pre-approved by direct superior.')}
                          className="text-[10px] bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors shadow-2xs"
                        >
                          ⚡ Pre-approved Extension
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={delayReason}
                      onChange={e => setDelayReason(e.target.value)}
                      placeholder="Write your explanation to your superior (e.g. operational delay, waiting on third-party data)..."
                      className="w-full px-3 py-2 border border-amber-300 bg-white rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none placeholder:text-slate-400"
                    />
                  </div>
                );
              })()}

              {/* Supporting Deliverable Attachments / MultiProof */}
              <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <label className="block text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-blue-600" /> I. Attachments — Deliverable Proof &amp; Supporting Evidence
                  </label>
                  <span className="text-[11px] text-slate-500">Attach files, Drive links, or Telegram message links</span>
                </div>
                <MultiProofUploader
                  data={multiProof}
                  onChange={setMultiProof}
                  readOnly={false}
                />
              </div>

              {/* Weekly Summary Form — Section J (Confirmation) */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white">
                <div className="mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900">J. Confirmation &amp; submit</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                      Required
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Confirm the information before submitting the checklist and summary together.
                  </p>
                </div>
                <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={weeklySummary.confirmed}
                    onChange={e => setWeeklySummary({ ...weeklySummary, confirmed: e.target.checked })}
                    className="mt-0.5 w-4 h-4 accent-blue-600"
                  />
                  <span className="text-xs text-slate-700">
                    I confirm that the information in this weekly checklist and summary is correct.
                  </span>
                </label>
              </div>

              {/* AI Summary Assistant */}
              <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-600" /> AI Executive Weekly Summary
                  </span>
                  <button
                    type="button"
                    onClick={handleGenerateAiSummary}
                    disabled={isGeneratingAi}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium flex items-center gap-1 shadow-xs transition-all"
                  >
                    {isGeneratingAi ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Generate Summary
                  </button>
                </div>
                {aiSummaryText ? (
                  <div className="text-xs text-slate-800 whitespace-pre-wrap bg-white p-2.5 rounded-lg border border-blue-100 font-sans">
                    {aiSummaryText}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">
                    Click "Generate Summary" to run Gemini AI analysis on your weekly checklist deliverables.
                  </p>
                )}
              </div>

              {/* E-Signature Verification */}
              <SignatureCanvas
                ref={signatureCanvasRef}
                signeeName={(() => {
                  const existingRep = reports.find(r => r.id === editingReportId);
                  return (existingRep && existingRep.staffId !== currentUser.id) ? existingRep.staffName : currentUser.name;
                })()}
                onSaveSignature={sig => setSignature(sig)}
                existingSignature={signature}
              />

              <div className="pt-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setEditingReportId(null);
                      if (pageModeRef.current) onExit?.();
                    }}
                    className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  {duplicateReportForNewForm ? (
                    /* A report already occupies this week: offer no way to create a second one. */
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreating(false);
                        setEditingReportId(null);
                        setActiveReport(duplicateReportForNewForm);
                        if (pageModeRef.current) onExit?.();
                      }}
                      className="px-3 py-1.5 border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      View existing report
                    </button>
                  ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveAsDraft}
                      disabled={isSavingDraft || isSubmittingReport}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Save current progress as Draft so you can edit again later without submitting"
                    >
                      {isSavingDraft ? (
                        <>
                          <Loader2 className="w-4 h-4 text-slate-600 animate-spin" /> Saving…
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 text-slate-600" /> Save as Draft
                        </>
                      )}
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingReport}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                    >
                      {isSubmittingReport ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {isSubmittingReport ? 'Submitting…' : editingReportId && reports.find(r => r.id === editingReportId)?.status !== 'Draft' ? 'Save & Update Report' : 'Submit Weekly Report'}
                    </button>
                  </div>
                  )}
                </div>

                {duplicateReportForNewForm && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-3 py-2 w-full">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-[11px] leading-relaxed">
                      {duplicateReportForNewForm.status === 'Draft' ? (
                        <>
                          A <strong>draft</strong> weekly report for <strong>W{duplicateReportForNewForm.weekNumber} ({formatDateRange(duplicateReportForNewForm.startDate, duplicateReportForNewForm.endDate, duplicateReportForNewForm.weekNumber, duplicateReportForNewForm.year).shortRange})</strong> already exists. Only one weekly report is allowed per week, so this new report cannot be saved or submitted.
                        </>
                      ) : (
                        <>
                          Report for <strong>W{duplicateReportForNewForm.weekNumber} ({formatDateRange(duplicateReportForNewForm.startDate, duplicateReportForNewForm.endDate, duplicateReportForNewForm.weekNumber, duplicateReportForNewForm.year).shortRange})</strong> already submitted.
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </form>
          ) : activeReport ? (
            /* DETAILS VIEW */
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="w-full">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-base text-slate-900">{activeReport.staffName}'s Weekly T&R Report</h3>
                      <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-bold flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-blue-600" />
                        W{activeReport.weekNumber} {activeReport.year} ({formatDateRange(activeReport.startDate, activeReport.endDate, activeReport.weekNumber, activeReport.year).formattedRange})
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Department: {activeReport.department} • Position: {activeReport.position}
                    </p>

                    {activeReport.status === 'Approved' || activeReport.status === 'Reviewed' ? (
                      <div className="w-full bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl mt-3">
                        <div className="flex items-center justify-start gap-1.5 mb-0.5">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Final T&R Score</span>
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            {activeReport.status}
                          </span>
                        </div>
                        <span
                          className={`block text-xl font-black leading-none mt-0.5 ${
                            activeReport.trScore === 100
                              ? 'text-emerald-600'
                              : activeReport.trScore >= 70
                              ? 'text-blue-600'
                              : 'text-rose-600'
                          }`}
                        >
                          {activeReport.trScore}%
                        </span>
                        <PillarBreakdown
                          cells={[
                            {
                              label: 'Checklist',
                              value: String(activeCompletionScore),
                              max: TR_PILLAR1_MAX,
                              tone: activeCompletionScore >= TR_PILLAR1_MAX ? 'emerald' : 'blue'
                            },
                            {
                              label: 'Timeliness',
                              value: activeTimelinessText,
                              max: TR_PILLAR2_MAX,
                              tone: activeReport.latePenaltyWaived
                                ? 'emerald'
                                : activeTimelinessPending
                                ? 'slate'
                                : 'blue',
                              note: activeReport.latePenaltyWaived
                                ? 'Waived'
                                : activeTimelinessPending
                                ? 'Pending'
                                : undefined
                            },
                            {
                              label: 'Superior',
                              value: activeReport.qualityScore === null || activeReport.qualityScore === undefined
                                ? 'Pending'
                                : String(activeReport.qualityScore),
                              max: activeReport.qualityScore === null || activeReport.qualityScore === undefined
                                ? null
                                : TR_PILLAR3_MAX,
                              tone:
                                activeReport.qualityScore === null || activeReport.qualityScore === undefined
                                  ? 'amber'
                                  : 'emerald',
                              note:
                                activeReport.qualityScore === null || activeReport.qualityScore === undefined
                                  ? `+${TR_PILLAR3_MAX} pts`
                                  : undefined
                            }
                          ]}
                        />
                      </div>
                    ) : (
                      <div className="w-full bg-slate-100 border border-amber-200 px-3.5 py-2 rounded-xl mt-3">
                        <div className="flex items-center justify-start gap-1.5 mb-0.5">
                          <span className="text-[10px] text-amber-850 font-bold uppercase text-amber-800">Status</span>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 border border-amber-300">
                            Awaiting Superior Grade
                          </span>
                        </div>
                        <div className="text-sm font-bold text-amber-900 leading-none mt-0.5">
                          Base: {activeBaseScore} / {TR_BASE_MAX} pts
                        </div>
                        {activeTimelinessPending && (
                          <span className="block text-[10px] font-bold text-amber-700 mt-1">
                            (Timeliness ungraded — not submitted yet)
                          </span>
                        )}
                        <PillarBreakdown
                          cells={[
                            {
                              label: 'Checklist',
                              value: String(activeCompletionScore),
                              max: TR_PILLAR1_MAX,
                              tone: activeCompletionScore >= TR_PILLAR1_MAX ? 'emerald' : 'blue'
                            },
                            {
                              label: 'Timeliness',
                              value: activeTimelinessText,
                              max: TR_PILLAR2_MAX,
                              tone: activeReport.latePenaltyWaived
                                ? 'emerald'
                                : activeTimelinessPending
                                ? 'slate'
                                : 'blue',
                              note: activeReport.latePenaltyWaived
                                ? 'Waived'
                                : activeTimelinessPending
                                ? 'Pending'
                                : undefined
                            },
                            {
                              label: 'Superior',
                              value: 'Pending',
                              max: null,
                              tone: 'amber',
                              note: `+${TR_PILLAR3_MAX} pts`
                            }
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  <div className="w-full space-y-3">
                    {/* T&R Submission Deadline & Extension Request Status Card (Compact & Collapsible — v3) */}
                    {(() => {
                      const dlInfo = getTRSubmissionDeadline(activeReport.endDate, activeReport.approvedDeadline);
                      const hasPendingExt = activeReport.extensionRequest?.status === 'Pending';
                      const hasApprovedExt = activeReport.extensionRequest?.status === 'Approved' || dlInfo.isExtended;
                      const isStaffOwner = activeReport.staffId === currentUser.id;
                      // Only the reporter's actual superior (or a super-admin /
                      // executive / HR role) may review the extension — never the owner.
                      const canReviewExtension =
                        !isStaffOwner &&
                        (activeReport.superiorId === currentUser.id ||
                         getSubordinateUserIds(currentUser.id).has(activeReport.staffId) ||
                         ['admin', 'executive', 'hr'].includes(currentUser.role));
                      const subDate = activeReport.submissionDate || new Date().toISOString();
                      const timeCheck = calculateTRTimelinessScore(
                        subDate,
                        activeReport.endDate,
                        activeReport.approvedDeadline,
                        activeReport.latePenaltyWaived
                      );
                      const isHistoricalRecord = timeCheck.daysDiff > 7 && !hasApprovedExt && !hasPendingExt;

                      if (isHistoricalRecord) {
                        return (
                          <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/70 text-indigo-950 text-xs space-y-2 transition-all shadow-2xs">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div className="flex items-start gap-2.5">
                                <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-700 shrink-0">
                                  <FileText className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-xs sm:text-sm text-slate-900">
                                      Historical Backfill Record
                                    </span>
                                    <span className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-indigo-200 text-indigo-900 font-bold">
                                      Week {activeReport.weekNumber}, {activeReport.year}
                                    </span>
                                    {activeReport.latePenaltyWaived ? (
                                      <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Late Penalty Waived (20/20 Punctuality)
                                      </span>
                                    ) : (
                                      <span className="text-[10px] bg-indigo-200 text-indigo-900 border border-indigo-300 font-semibold px-2 py-0.5 rounded-full">
                                        Retroactive Record
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-600 mt-0.5">
                                    Recorded retroactively for a past period. Standard cutoff was {dlInfo.formattedDeadline}.
                                    {activeReport.delayReason ? ` Staff note: "${activeReport.delayReason}"` : ''}
                                  </p>
                                </div>
                              </div>

                              {canReviewExtension && activeReport.status !== 'Approved' && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenReviewModal(activeReport)}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                                >
                                  <UserCheck className="w-3.5 h-3.5" /> Review / Waive Penalty
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="p-2.5 sm:px-3.5 rounded-xl border border-amber-300 bg-amber-50/90 text-amber-950 text-xs transition-all shadow-2xs">
                          <div className="flex items-center justify-between gap-2.5 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <div className="p-1.5 rounded-lg bg-amber-200 text-amber-800 shrink-0">
                                  <Clock className="w-4 h-4" />
                                </div>
                                <span className="font-bold text-xs sm:text-sm text-slate-900">
                                  Official Submission Deadline:
                                </span>
                                <span className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-slate-300 text-slate-800 font-semibold">
                                  Monday before 11:30 AM
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-amber-700" /> Extension Pending Review
                                </span>
                              </div>
                            </div>

                            {/* Action buttons & Details Toggle */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isStaffOwner && hasPendingExt && (
                                <span className="text-[11px] text-amber-800 border border-amber-300 bg-white px-2.5 py-1 rounded-lg font-bold shadow-2xs flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 text-amber-700 animate-pulse" /> Awaiting Superior Approval
                                </span>
                              )}
                              {isStaffOwner && !hasPendingExt && activeReport.status !== 'Approved' && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenExtensionModal(activeReport)}
                                  className="px-2.5 py-1 bg-white hover:bg-slate-50 text-blue-700 border border-blue-300 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer transition-all active:scale-95"
                                >
                                  <Calendar className="w-3 h-3 text-blue-600" />
                                  {hasApprovedExt ? 'Request Further Extension' : 'Request Extension'}
                                </button>
                              )}
                              {hasPendingExt && canReviewExtension && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReviewExtensionModal(activeReport, 'Approved')}
                                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3 h-3" /> Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReviewExtensionModal(activeReport, 'Rejected')}
                                    className="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                                  >
                                    <XCircle className="w-3 h-3" /> Decline
                                  </button>
                                </div>
                              )}

                              {/* Collapsible toggle for details if there is extension data */}
                              {(hasPendingExt || (hasApprovedExt && activeReport.extensionRequest?.reviewedByName)) && (
                                <button
                                  type="button"
                                  onClick={() => setShowDeadlineDetails(!showDeadlineDetails)}
                                  className="px-2 py-1 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white/80 hover:bg-white rounded-lg border border-slate-300 flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  {showDeadlineDetails ? (
                                    <>Hide Details <ChevronUp className="w-3 h-3" /></>
                                  ) : (
                                    <>Details <ChevronDown className="w-3 h-3" /></>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Collapsed / Expanded Content */}
                          {showDeadlineDetails && (
                            <div className="mt-2.5 pt-2.5 border-t border-black/10 space-y-2 animate-in fade-in duration-150">
                              <p className="text-xs text-slate-600">
                                {hasApprovedExt
                                  ? `Approved Extended Cutoff: ${dlInfo.formattedDeadline} • Full 20/20 punctuality score granted without late penalty.`
                                  : `Standard Cutoff: ${dlInfo.formattedDeadline}`}
                              </p>

                              {hasPendingExt && (
                                <div className="bg-white/95 border border-amber-200 rounded-lg p-2.5 space-y-1">
                                  <div className="flex items-center justify-between text-[11px] font-semibold">
                                    <span className="text-amber-900">Requested Deadline: <strong>{formatDateTimeFriendly(activeReport.extensionRequest?.requestedDeadline)}</strong></span>
                                    <span className="text-slate-500">Requested: {new Date(activeReport.extensionRequest?.requestedAt || '').toLocaleString()}</span>
                                  </div>
                                  <p className="text-xs text-slate-800 italic bg-amber-50/50 p-2 rounded border border-amber-100">
                                    "{activeReport.extensionRequest?.reason}"
                                  </p>
                                </div>
                              )}

                              {activeReport.extensionRequest?.status === 'Approved' && activeReport.extensionRequest?.reviewedByName && (
                                <div className="bg-emerald-100/60 border border-emerald-200 rounded-lg p-2.5 text-[11px] text-emerald-900 flex items-center justify-between">
                                  <span>Approved by: <strong>{activeReport.extensionRequest.reviewedByName}</strong> on {new Date(activeReport.extensionRequest.reviewedAt || '').toLocaleDateString()}</span>
                                  {activeReport.extensionRequest.reviewNote && (
                                    <span className="italic font-medium">"{activeReport.extensionRequest.reviewNote}"</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* Superior Review / Grade Button — always available on a
                        subordinate's report (i.e. anything reached from the
                        "Subordinate Submissions" tab). No permission check: the
                        Subordinate tab already scopes the list to your own team. */}
                    {activeReport.staffId !== currentUser.id && (
                      <button
                        onClick={() => handleOpenReviewModal(activeReport)}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        title="Review, rate, or approve this subordinate report"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Review / Grade
                      </button>
                    )}

                    {/* Edit / Resume Draft — staff can edit their own draft reports anytime! (Draft reports are never locked) */}
                    {activeReport.staffId === currentUser.id && activeReport.status === 'Draft' && (
                      <button
                        onClick={() => { window.location.hash = '#/tr/edit/' + encodeURIComponent(activeReport.id); }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
                        title="Edit and continue working on this draft report"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit / Resume Draft
                      </button>
                    )}

                    {/* Edit Report Button — for superior/managers on subordinate reports that are not yet
                        Approved/Reviewed. Owners edit their own drafts via "Edit / Resume Draft" above. */}
                    {(activeReport.staffId !== currentUser.id && canManageReport(activeReport) && activeReport.status !== 'Approved' && activeReport.status !== 'Reviewed') && (
                      <button
                        onClick={() => { window.location.hash = '#/tr/edit/' + encodeURIComponent(activeReport.id); }}
                        className="px-3 py-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        title={`Edit ${activeReport.staffName}'s weekly report`}
                      >
                        <Edit2 className="w-3.5 h-3.5 text-blue-600" /> Edit Report
                      </button>
                    )}

                    {/* Delete Report Button — available on Draft reports and for
                        superior/managers on subordinate reports at any status
                        (including Approved/Reviewed). */}
                    {(activeReport.status === 'Draft' || (activeReport.staffId !== currentUser.id && canManageReport(activeReport))) && (
                      <button
                        onClick={() => setReportToDelete(activeReport)}
                        className="px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
                        title={`Delete ${activeReport.staffName}'s weekly report`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Escalation & Review Reminder Banners */}
              {activeReport.status === 'Submitted' && activeReport.escalationLevel === 'escalated' && (
                <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl text-xs flex items-start gap-2.5 text-rose-900">
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold block text-rose-950">
                      🚨 Escalated to Senior Superior (Unreviewed for 5+ Working Days)
                    </strong>
                    <p className="text-[11px] text-rose-800 mt-0.5">
                      This submission has been automatically escalated to senior management due to an unreviewed period exceeding 5 working days. The staff member's score remains Pending and the employee will not be penalized.
                    </p>
                  </div>
                </div>
              )}

              {activeReport.status === 'Submitted' && activeReport.escalationLevel === 'reminded' && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs flex items-start gap-2.5 text-amber-900">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold block text-amber-950">
                      ⏱️ Superior Review Reminder Dispatched (3+ Working Days Pending)
                    </strong>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      This report has awaited review for more than 3 working days. Automated reminders have been dispatched to direct superiors.
                    </p>
                  </div>
                </div>
              )}

              {/* Monthly N/A Early Warning Banner */}
              {(() => {
                const mInfo = getMonthInfoForWeek(activeReport.weekNumber, activeReport.year);
                const monthlyNATasks = activeReport.checklistItems.filter(
                  it => (it.category === 'Monthly' || it.title.toLowerCase().includes('monthly')) && it.status === 'na'
                );
                if (mInfo.weekIndexInMonth >= 3 && monthlyNATasks.length > 0) {
                  return (
                    <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs flex items-start gap-2.5 text-amber-900">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold block text-amber-950">
                          ⚠️ Monthly Recurring Task N/A Early Warning (Week {mInfo.weekIndexInMonth} of {mInfo.monthName})
                        </strong>
                        <p className="text-[11px] text-amber-800 mt-0.5">
                          {monthlyNATasks.length} monthly recurring duty is marked N/A: {monthlyNATasks.map(t => `"${t.title}"`).join(', ')}. All monthly tasks must be completed and evidenced before the month-end lock.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Score Dispute Status Banner & Action Button */}
              {(() => {
                const isGraded = activeReport.status === 'Approved' || activeReport.status === 'Reviewed';
                if (!isGraded) return null;

                const reviewDate = activeReport.reviewDate || activeReport.submissionDate;
                const daysElapsed = calculateWorkingDaysElapsed(reviewDate);
                const isWithinWindow = daysElapsed <= 3;
                const isStaffOwner = activeReport.staffId === currentUser.id;
                const isSuperior = activeReport.superiorId === currentUser.id || currentUser.role === 'manager' || currentUser.role === 'executive' || currentUser.role === 'admin' || currentUser.role === 'hr';

                if (activeReport.dispute) {
                  const disp = activeReport.dispute;
                  return (
                    <div className={`p-4 rounded-xl border text-xs space-y-2.5 ${
                      disp.status === 'Pending'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : disp.status === 'Resolved'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-rose-50 border-rose-300 text-rose-900'
                    }`}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <HelpCircle className="w-4 h-4 text-amber-600" />
                          <span className="font-bold text-xs uppercase tracking-wider">
                            Score Dispute: {disp.status}
                          </span>
                          <span className="text-[10px] bg-white px-2 py-0.5 rounded font-bold border border-slate-200">
                            Filed on {new Date(disp.requestedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {disp.status === 'Pending' && isSuperior && (
                          <button
                            type="button"
                            onClick={() => handleOpenResolveDispute(activeReport)}
                            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            Review & Resolve Dispute
                          </button>
                        )}
                      </div>

                      <div className="bg-white/80 p-2.5 rounded-lg border border-slate-200 space-y-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase block">Staff Dispute Rationale:</span>
                        <p className="text-slate-800 text-xs italic">"{disp.reason}"</p>
                      </div>

                      {disp.resolutionNote && (
                        <div className="bg-white/90 p-2.5 rounded-lg border border-slate-200 space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase block">
                            Superior Resolution ({disp.resolvedByName || 'Superior'} - {new Date(disp.resolvedAt || '').toLocaleDateString()}):
                          </span>
                          <p className="text-slate-900 text-xs font-medium">{disp.resolutionNote}</p>
                          {disp.revisedScore !== undefined && (
                            <span className="inline-block mt-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                              Adjusted Final Score: {disp.revisedScore}% (Score Permanently Locked 🔒)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                // No dispute filed yet
                return (
                  <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex-wrap gap-2">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                      <span className="text-slate-500 font-medium">Score Governance:</span>
                      {isWithinWindow ? (
                        <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[11px]">
                          Dispute Window Open ({Math.max(0, 3 - daysElapsed)} working days left)
                        </span>
                      ) : (
                        <span className="text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                          Score Permanently Locked (3-day dispute window closed) 🔒
                        </span>
                      )}
                    </div>

                    {isStaffOwner && isWithinWindow && (
                      <button
                        type="button"
                        onClick={() => handleOpenDispute(activeReport)}
                        className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-amber-600" /> Dispute Published Score
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Checklist breakdown */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Job Description Checklist Submissions
                  </h4>
                  <span className="text-[11px] text-slate-500 font-medium">
                    {activeReport.checklistItems.filter(i => (i.status ? i.status === 'completed' : i.completed)).length} of{' '}
                    {activeReport.checklistItems.filter(i => i.status !== 'na').length} applicable tasks completed
                    {activeReport.checklistItems.filter(i => i.status === 'na').length > 0 && (
                      <span className="ml-1 text-slate-400">
                        ({activeReport.checklistItems.filter(i => i.status === 'na').length} marked N/A)
                      </span>
                    )}
                  </span>
                </div>

                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {activeReport.checklistItems.map((item, idx) => {
                    const itemStatus: ChecklistItemStatus = item.status || (item.completed ? 'completed' : 'incomplete');

                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border flex items-start gap-3 transition-all ${
                          itemStatus === 'completed'
                            ? 'bg-emerald-50/40 border-emerald-200'
                            : itemStatus === 'na'
                            ? 'bg-slate-100/70 border-slate-200 opacity-75'
                            : 'bg-rose-50/30 border-rose-200'
                        }`}
                      >
                        {itemStatus === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : itemStatus === 'na' ? (
                          <MinusCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                              className={`text-xs font-bold ${
                                itemStatus === 'completed'
                                  ? 'text-slate-900 line-through decoration-emerald-500'
                                  : itemStatus === 'na'
                                  ? 'text-slate-500 italic'
                                  : 'text-slate-700'
                              }`}
                            >
                              {item.title}
                            </span>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${frequencyBadgeClassFlat(item.category)}`}
                                title={frequencyRuleHint(item.category)}
                              >
                                {frequencyLabel(item.category, Number(activeYearlyCycleKey))}
                              </span>

                              <span
                                className={`text-[10px] px-2 py-0.5 rounded font-black uppercase ${
                                  itemStatus === 'completed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : itemStatus === 'na'
                                    ? 'bg-slate-200 text-slate-700'
                                    : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {itemStatus === 'completed'
                                  ? 'Done'
                                  : itemStatus === 'na'
                                  ? 'N/A (Excluded)'
                                  : 'Incomplete'}
                              </span>
                            </div>
                          </div>

                          {item.note && (
                            <div className="text-[11px] text-slate-600 mt-1 italic bg-white/70 px-2 py-0.5 rounded border border-slate-200/60">
                              Note / Proof: "{item.note}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Staff Notes */}
              {activeReport.notes && (
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  <span className="font-bold text-slate-800 block mb-1">Staff Additional Remarks:</span>
                  <p className="text-slate-700">{activeReport.notes}</p>
                </div>
              )}

              {/* Weekly Summary Form (read-only — superior reviews checklist + summary on one screen) */}
              {viewSummary && (
                <div className="border-t border-slate-100 pt-5">
                  <div className="mb-3">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      Weekly Summary Form
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      IRG-HR-FRM-WSUM-001 v1.1 · submitted with this JD checklist.
                    </p>
                  </div>
                  <WeeklySummaryForm
                    value={viewSummary}
                    onChange={() => {}}
                    taskTitles={(activeReport.checklistItems || []).map(c => c.title)}
                    weekStart={activeReport.startDate}
                    weekEnd={activeReport.endDate}
                    readOnly
                  />
                </div>
              )}

              {/* Staff Justification for Late / Retroactive Submission */}
              {activeReport.delayReason && (
                <div className="bg-amber-50/90 border-2 border-amber-300 rounded-xl p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-bold text-amber-950 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Staff Reason for Late / Retroactive Submission:
                    </span>
                    {activeReport.latePenaltyWaived ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded font-black flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Late Penalty Waived by Superior (Full 20/20 Punctuality)
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-bold">
                        Under Review by Superior
                      </span>
                    )}
                  </div>
                  <div className="text-amber-900 leading-relaxed font-medium bg-white/90 p-2.5 rounded-lg border border-amber-200">
                    "{activeReport.delayReason}"
                  </div>
                  {activeReport.waivedByName && (
                    <div className="text-[11px] text-emerald-800 font-semibold">
                      Punctuality penalty waived by superior: <strong>{activeReport.waivedByName}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* Attached Deliverable Proof / Supporting Evidence */}
              {activeReport.multiProof && (
                (activeReport.multiProof.files?.length > 0 ||
                 activeReport.multiProof.cloudLinks?.length > 0 ||
                 activeReport.multiProof.telegramLinks?.length > 0) && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                    <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                      <Paperclip className="w-4 h-4 text-blue-600" /> Supporting Deliverable Proofs ({
                        (activeReport.multiProof.files?.length || 0) +
                        (activeReport.multiProof.cloudLinks?.length || 0) +
                        (activeReport.multiProof.telegramLinks?.length || 0)
                      })
                    </span>
                    <MultiProofUploader
                      data={activeReport.multiProof}
                      readOnly={true}
                    />
                  </div>
                )
              )}

              {/* AI Executive Summary if available */}
              {activeReport.aiSummary && (
                <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3 text-xs">
                  <span className="font-bold text-indigo-900 flex items-center gap-1.5 mb-1">
                    <Sparkles className="w-4 h-4 text-indigo-600" /> AI Executive Summary
                  </span>
                  <div className="text-slate-800 whitespace-pre-wrap">{activeReport.aiSummary}</div>
                </div>
              )}

              {/* Superior Manager Feedback if available */}
              {activeReport.managerFeedback && (
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-emerald-600" /> Superior Evaluation Feedback ({activeReport.status})
                    </span>
                    {activeReport.reviewDate && (
                      <span className="text-[10px] text-emerald-700 font-medium">
                        {new Date(activeReport.reviewDate).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-800 font-medium">{activeReport.managerFeedback}</p>
                </div>
              )}

              {/* E-Signature Box */}
              {activeReport.signature && (
                <div className="border border-emerald-200 bg-emerald-50/30 rounded-xl p-3 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                        <UserCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">Signed by {activeReport.signature.signeeName}</div>
                        <div className="text-[10px] text-slate-500">
                          Timestamp: {new Date(activeReport.signature.signedAt).toLocaleString()} ({activeReport.signature.type})
                        </div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold self-start sm:self-auto">
                      Signature Verified
                    </span>
                  </div>
                  {(activeReport.signature.type === 'handwritten' || activeReport.signature.type === 'uploaded') && activeReport.signature.dataUrl && (
                    <div className="bg-white border border-slate-100 rounded-lg p-2 flex items-center justify-center w-full h-24">
                      <SignatureImage
                        src={activeReport.signature.dataUrl}
                        alt="Signature Image"
                        className="max-h-20 max-w-full object-contain"
                        fallbackText="Signature image unavailable"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400">
              Select a weekly report from the left list or click "Create Weekly Report".
            </div>
          )}
        </div>
      </div>

      {/* Superior Review / Grade Report Modal */}
      {isReviewing && activeReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full p-5 sm:p-6 border border-slate-200 space-y-4 max-h-[92vh] overflow-y-auto overscroll-contain">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3 gap-3">
              <div className="min-w-0">
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  Superior Report Evaluation & Review
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Evaluating report submitted by <strong>{activeReport.staffName}</strong> ({activeReport.position})
                </p>
              </div>
              <button
                onClick={() => setIsReviewing(false)}
                disabled={isSavingReview}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveSuperiorReview} className="space-y-4">
              {(() => {
                const modalPillar1 = computePillar1(activeReport.checklistItems, getLockedItemIdsMemo(activeReport));
                const tot = modalPillar1.total;
                const done = modalPillar1.completed;
                const na = modalPillar1.na;
                const app = modalPillar1.applicable;
                const modalCompScore = activeReport.checklistItems && activeReport.checklistItems.length > 0
                  ? modalPillar1.score
                  : activeReport.completionScore !== undefined
                  ? clampPillar1(activeReport.completionScore)
                  : modalPillar1.score;
                const rawTimeliness = calculateTRTimelinessScore(activeReport.submissionDate, activeReport.endDate, activeReport.approvedDeadline, activeReport.latePenaltyWaived);
                const isLate = rawTimeliness.isLate;
                const modalTimeScore = clampPillar2(reviewWaiveLatePenalty ? TR_PILLAR2_MAX : (activeReport.timelinessScore ?? rawTimeliness.score));
                const modalTotalScore = Math.min(100, Math.max(0, modalCompScore + modalTimeScore + reviewQualityScore));

                return (
                  <>
                    {/* Rubric Score Breakdown Card */}
                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between text-xs border-b border-slate-200 pb-2">
                        <div>
                          <span className="text-slate-500 font-medium">Report Period:</span>
                          <span className="font-bold text-slate-800 ml-1">Week {activeReport.weekNumber}, {activeReport.year}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500 font-medium">Live Total:</span>
                          <span className={`text-base font-black ${modalTotalScore >= 80 ? 'text-emerald-600' : modalTotalScore >= 60 ? 'text-blue-600' : 'text-amber-600'}`}>
                            {modalTotalScore}%
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-white p-2 rounded-lg border border-slate-200">
                          <span className="text-[10px] text-slate-400 font-bold block uppercase">1. Checklist (50%)</span>
                          <span className="font-black text-slate-900">{modalCompScore} / {TR_PILLAR1_MAX}</span>
                        </div>
                        <div className={`p-2 rounded-lg border ${reviewWaiveLatePenalty ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`}>
                          <span className="text-[10px] text-slate-400 font-bold block uppercase">2. Punctuality (20%)</span>
                          <span className={`font-black ${reviewWaiveLatePenalty ? 'text-emerald-700' : 'text-slate-900'}`}>
                            {modalTimeScore} / {TR_PILLAR2_MAX} {reviewWaiveLatePenalty ? '✅' : ''}
                          </span>
                        </div>
                        <div className="bg-white p-2 rounded-lg border border-emerald-300 ring-1 ring-emerald-200">
                          <span className="text-[10px] text-emerald-700 font-bold block uppercase">3. Superior (30%)</span>
                          <span className="font-black text-emerald-600">{reviewQualityScore} / 30</span>
                        </div>
                      </div>
                    </div>

                    {/* Late Submission & Waiver Section in Superior Review Modal */}
                    {(isLate || activeReport.delayReason) && (
                      <div className="p-3 bg-amber-50/85 rounded-xl border border-amber-200 text-xs space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="font-bold text-amber-950 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            Punctuality Status: {isLate ? `Late by ${rawTimeliness.daysDiff} day(s)` : 'Submitted after cutoff'}
                          </span>
                          {reviewWaiveLatePenalty ? (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded font-black flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Penalty Waived (20/20 pts)
                            </span>
                          ) : (
                            <span className="text-[10px] bg-amber-200 text-amber-900 border border-amber-300 px-2 py-0.5 rounded font-bold">
                              Deduction Active ({modalTimeScore}/20 pts)
                            </span>
                          )}
                        </div>

                        {activeReport.delayReason ? (
                          <div className="p-2.5 bg-white rounded-lg border border-amber-300/80">
                            <span className="text-[10px] font-bold text-amber-900 uppercase block mb-0.5">
                              Staff's Reason for Delay / Late Submission:
                            </span>
                            <p className="text-slate-800 text-xs leading-relaxed italic">
                              "{activeReport.delayReason}"
                            </p>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 italic">
                            No delay explanation provided by staff.
                          </div>
                        )}

                        <label className="flex items-start gap-2 pt-1 border-t border-amber-200 cursor-pointer text-xs text-blue-900 font-semibold select-none">
                          <input
                            type="checkbox"
                            checked={reviewWaiveLatePenalty}
                            onChange={e => setReviewWaiveLatePenalty(e.target.checked)}
                            className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 mt-0.5 shrink-0"
                          />
                          <span>
                            Waive late penalty &amp; grant full 20/20 punctuality points (e.g. system adoption backfill prior to Sep 2026, or justified operational delay)
                          </span>
                        </label>
                      </div>
                    )}

                    {/* Quality Score Slider & Presets */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-bold text-slate-800">
                          Pillar 3: Superior Quality & Accuracy Grade (0–30 pts)
                        </label>
                        <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          {reviewQualityScore} / 30 pts ({Math.round((reviewQualityScore / 30) * 100)}%)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mb-2">
                        {[
                          { label: '30 (100% Quality)', val: 30 },
                          { label: '25 (Satisfactory)', val: 25 },
                          { label: '20 (Acceptable)', val: 20 },
                          { label: '15 (Needs Touchup)', val: 15 },
                          { label: '10 (Incomplete)', val: 10 }
                        ].map(preset => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => setReviewQualityScore(preset.val)}
                            className={`py-1.5 px-1.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer sm:text-[11px] sm:py-1 ${
                              reviewQualityScore === preset.val
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={30}
                        step={1}
                        value={reviewQualityScore}
                        onChange={e => setReviewQualityScore(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                      />
                    </div>
                  </>
                );
              })()}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Approval / Evaluation Decision</label>
                <ModernSelect
                  value={reviewStatus}
                  onChange={e => setReviewStatus(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 font-bold bg-white"
                >
                  <option value="Approved">Approved (Meets All Standards)</option>
                  <option value="Reviewed">Reviewed (Satisfactory Execution)</option>
                  <option value="Submitted">Needs Revision (Resubmission Requested)</option>
                </ModernSelect>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Superior Evaluation Notes &amp; Remarks
                    {reviewQualityScore < 21 && (
                      <span className="text-rose-600 font-bold ml-1">* (Mandatory for Quality &lt; 70%)</span>
                    )}
                  </label>
                  {reviewQualityScore < 21 && (
                    <span className="text-[10px] text-amber-800 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Constructive Justification Required (&lt;21/30 pts)
                    </span>
                  )}
                </div>
                <textarea
                  rows={4}
                  required
                  value={reviewFeedback}
                  onChange={e => setReviewFeedback(e.target.value)}
                  placeholder={
                    reviewQualityScore < 21
                      ? 'Quality score is below 70% (<21/30 pts). Constructive feedback explaining shortcomings and required improvements is MANDATORY.'
                      : 'Provide feedback on deliverable quality, areas of excellence, or requested revisions...'
                  }
                  className={`w-full px-3 py-2 border rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-none ${
                    reviewQualityScore < 21 && (!reviewFeedback || reviewFeedback.trim().length < 10)
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-slate-300'
                  }`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReviewing(false)}
                  disabled={isSavingReview}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSavingReview ? 'Saving…' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSavingReview}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:bg-emerald-600/60 disabled:cursor-not-allowed"
                >
                  {isSavingReview ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving Review…</>
                  ) : (
                    <><UserCheck className="w-4 h-4" /> Save Review & Approval</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Score Dispute Submission Modal (Staff) */}
      {isDisputing && activeReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-amber-700 font-bold text-base">
                <HelpCircle className="w-5 h-5 text-amber-600" />
                <h3>File Score Dispute</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDisputing(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
              <span className="font-bold block text-amber-950">Dispute Governance Policy:</span>
              <p className="text-[11px] leading-relaxed">
                Staff may dispute a published score within 3 working days of review publication. <strong>Limit 1 dispute per report.</strong> Your dispute will be routed to your direct superior for binding review. Once resolved, the score locks permanently.
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Weekly Report:</span>
                <span className="font-bold text-slate-800">Week {activeReport.weekNumber}, {activeReport.year}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Published Score:</span>
                <span className="font-black text-blue-700 text-sm">{activeReport.trScore}%</span>
              </div>
            </div>

            <form onSubmit={handleSubmitDispute} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Dispute Rationale &amp; Clarification Details *
                </label>
                <textarea
                  rows={4}
                  required
                  value={disputeReason}
                  onChange={e => setDisputeReason(e.target.value)}
                  placeholder="Explain clearly why you believe the evaluation or quality grade should be reviewed. Reference specific deliverables, evidence, or mitigating circumstances..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDisputing(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4" /> Submit Dispute
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Score Dispute Resolution Modal (Superior) */}
      {isResolvingDispute && activeReport && activeReport.dispute && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-blue-700 font-bold text-base">
                <UserCheck className="w-5 h-5 text-blue-600" />
                <h3>Resolve Score Dispute</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsResolvingDispute(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-700">{activeReport.staffName}'s Weekly Report</span>
                <span className="text-[10px] text-slate-500">Week {activeReport.weekNumber}, {activeReport.year}</span>
              </div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Staff Rationale:</span>
                <p className="text-slate-800 text-xs mt-0.5 italic">"{activeReport.dispute.reason}"</p>
              </div>
              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-200">
                <span className="text-slate-600">Original Published Score:</span>
                <span className="font-bold text-slate-900">{activeReport.trScore}%</span>
              </div>
            </div>

            <form onSubmit={handleSaveResolveDispute} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">Superior Decision *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDisputeDecision('accept')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                      disputeDecision === 'accept'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Accept &amp; Adjust Score
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisputeDecision('reject')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all ${
                      disputeDecision === 'reject'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <X className="w-4 h-4" /> Upheld (Reject Dispute)
                  </button>
                </div>
              </div>

              {disputeDecision === 'accept' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-800">
                      Adjusted Final Score (0–100%) *
                    </label>
                    <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {disputeRevisedScore}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={disputeRevisedScore}
                    onChange={e => setDisputeRevisedScore(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Superior Resolution Notes &amp; Final Explanation *
                </label>
                <textarea
                  rows={3}
                  required
                  value={disputeResolutionNote}
                  onChange={e => setDisputeResolutionNote(e.target.value)}
                  placeholder="State the official superior rationale for this final decision (e.g. accepted after review of evidence or original score upheld due to missing documentation)..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsResolvingDispute(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" /> Save Resolution &amp; Lock Score
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* T&R Submission Deadline Extension Request Modal (Staff) */}
      {isExtensionModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsExtensionModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 flex flex-col max-h-[92vh] my-auto overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5 shrink-0 bg-white">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Request T&R Deadline Extension
                  </h3>
                  <p className="text-xs text-slate-500">
                    Week {extensionTargetReport?.weekNumber || selectedWeek}, {extensionTargetReport?.year || selectedYear} Routine Report
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsExtensionModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors"
                title="Close (Esc)"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitExtensionRequest} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
                <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-medium">Standard Official Deadline:</span>
                    <span className="font-bold text-blue-900 bg-white px-2 py-0.5 rounded border border-blue-200">
                      Monday before 11:30 AM
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-blue-200/60">
                    <span className="text-slate-500">Official Submission Cutoff:</span>
                    <span className="font-semibold text-slate-800">
                      {getTRSubmissionDeadline(
                        extensionTargetReport?.endDate || endDateInput || getWeekDateRange(selectedWeek, selectedYear).endDate
                      ).formattedDeadline}
                    </span>
                  </div>
                  <p className="text-[11px] text-blue-800 pt-1">
                    Submitting after this deadline normally incurs a punctuality score deduction. If approved by your superior, an extended grace period is granted with full <strong>20/20 punctuality points</strong>.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Proposed New Submission Deadline *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    ref={extensionDeadlineInputRef}
                    defaultValue={extensionRequestedDeadline}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Quick Presets:</span>
                    <button
                      type="button"
                      onClick={() => handleApplyPresetDeadline(1)}
                      className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-800 rounded-md font-semibold border border-slate-200 cursor-pointer transition-colors"
                    >
                      +1 Day (Tue 11:30 AM)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPresetDeadline(2)}
                      className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-800 rounded-md font-semibold border border-slate-200 cursor-pointer transition-colors"
                    >
                      +2 Days (Wed 11:30 AM)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPresetDeadline(3)}
                      className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-800 rounded-md font-semibold border border-slate-200 cursor-pointer transition-colors"
                    >
                      +3 Days (Thu 11:30 AM)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Reason &amp; Justification for Superior Approval *
                  </label>
                  <textarea
                    rows={3}
                    required
                    ref={extensionReasonInputRef}
                    defaultValue={extensionReason}
                    placeholder="Explain why an extension is required (e.g. urgent official mission to provinces, medical leave, unexpected priority deliverable)..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50/90 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsExtensionModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExtension}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmittingExtension ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send Request to Superior
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* T&R Submission Deadline Extension Review Modal (Superior) */}
      {isReviewExtensionModalOpen && extensionReviewReport && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsReviewExtensionModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 flex flex-col max-h-[92vh] my-auto overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5 shrink-0 bg-white">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                  <Clock className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Review T&R Deadline Extension
                  </h3>
                  <p className="text-xs text-slate-500">
                    Staff: {extensionReviewReport.staffName} • Week {extensionReviewReport.weekNumber}, {extensionReviewReport.year}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReviewExtensionModalOpen(false)}
                disabled={isSavingExtensionReview}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                title="Close (Esc)"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReviewExtension} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 text-xs space-y-2">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-600">Standard Deadline:</span>
                    <span className="font-semibold text-slate-700 line-through">Monday 11:30 AM</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-amber-950">Requested Extended Deadline:</span>
                    <span className="font-black text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded">
                      {formatDateTimeFriendly(extensionReviewReport.extensionRequest?.requestedDeadline)}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-amber-200/70">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5">Staff Justification:</span>
                    <p className="text-slate-800 italic bg-white p-2.5 rounded-lg border border-amber-200/80">
                      "{extensionReviewReport.extensionRequest?.reason}"
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">Superior Decision *</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExtensionReviewDecision('Approved');
                        if (!extensionReviewNote || extensionReviewNote.includes('Declined')) {
                          setExtensionReviewNote('Approved. Full 20/20 punctuality score is granted if submitted by the approved date.');
                        }
                      }}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        extensionReviewDecision === 'Approved'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" /> Approve (Grant Grace Period)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExtensionReviewDecision('Rejected');
                        if (!extensionReviewNote || extensionReviewNote.includes('Approved')) {
                          setExtensionReviewNote('Declined. Standard Monday 11:30 AM deadline applies.');
                        }
                      }}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        extensionReviewDecision === 'Rejected'
                          ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <XCircle className="w-4 h-4" /> Decline Request
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Superior Note to Staff *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={extensionReviewNote}
                    onChange={e => setExtensionReviewNote(e.target.value)}
                    placeholder="Provide brief note or guidance for staff..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 bg-slate-50/90 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsReviewExtensionModalOpen(false)}
                  disabled={isSavingExtensionReview}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSavingExtensionReview ? 'Saving…' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSavingExtensionReview}
                  className={`px-5 py-2 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    extensionReviewDecision === 'Approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isSavingExtensionReview ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Notifying Staff…</>
                  ) : (
                    <><UserCheck className="w-4 h-4" /> Confirm & Notify Staff</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Report Confirmation Modal */}
      {reportToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2.5 bg-rose-50 rounded-xl">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Delete Weekly Report</h3>
                <p className="text-xs text-slate-500">Permanently delete T&R submission</p>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1">
              <p>Are you sure you want to delete this weekly report?</p>
              <p className="font-bold text-slate-900 text-sm">
                {reportToDelete.staffName} — Week {reportToDelete.weekNumber}, {reportToDelete.year}
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                {formatDateRange(reportToDelete.startDate, reportToDelete.endDate, reportToDelete.weekNumber, reportToDelete.year).formattedRange}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReportToDelete(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteReport}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Conflict Dialog — server rejected the report as a duplicate (409), not saved locally */}
      {submitConflict && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2.5 bg-amber-50 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Weekly Report Conflict</h3>
                <p className="text-xs text-slate-500">Submission was not saved</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-950 space-y-1.5">
              <p className="font-bold flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                {submitConflict.message}
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1.5">
              <p className="font-semibold">
                Period: Week {selectedWeek}, {selectedYear}
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                {formatDateRange(startDateInput, endDateInput, selectedWeek, selectedYear).formattedRange}
              </p>
              <p className="text-[11px] text-slate-600 leading-relaxed pt-1.5 border-t border-slate-200">
                A report already exists for this date period, so this submission was <strong>not</strong> saved to your report list.
                Please choose a different report period or edit the existing report instead.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setSubmitConflict(null);
                  requestAnimationFrame(() => periodSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                Continue Editing
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Chat-style saved AI summaries for selected subordinate reports */}
      {isTeamSummaryOpen && (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
          onClick={() => setIsTeamSummaryOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[85vh] max-h-[720px] flex flex-col border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Report Summaries</h3>
                  <p className="text-[11px] text-slate-500">
                    Selected subordinate reports and their saved AI summaries.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTeamSummaryOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close summaries"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="shrink-0 px-4 py-2.5 border-b border-slate-200 bg-white space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={summaryHistorySearch}
                    onChange={(e) => setSummaryHistorySearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void applyTeamSummaryFilters();
                    }}
                    placeholder="Search summaries, staff, week..."
                    className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                  />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="date"
                    value={summaryHistoryFrom}
                    onChange={(e) => setSummaryHistoryFrom(e.target.value)}
                    aria-label="Summary history from date"
                    className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white text-slate-700"
                  />
                  <span className="text-[10px] font-bold text-slate-400">to</span>
                  <input
                    type="date"
                    value={summaryHistoryTo}
                    onChange={(e) => setSummaryHistoryTo(e.target.value)}
                    aria-label="Summary history to date"
                    className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => void applyTeamSummaryFilters()}
                    disabled={isLoadingTeamSummaryHistory}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={clearTeamSummaryFilters}
                    disabled={isLoadingTeamSummaryHistory}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-[10px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Quick:</span>
                {([
                  ['all', 'All time'],
                  ['7d', 'Last 7 days'],
                  ['30d', 'Last 30 days'],
                  ['month', 'This month']
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => applyTeamSummaryDatePreset(value)}
                    className="px-1.5 py-0.5 rounded-md border border-slate-200 text-[10px] font-bold text-slate-600 hover:text-blue-700 hover:bg-blue-50 cursor-pointer"
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] font-semibold text-slate-400">
                  {teamSummaryTotal > 0
                    ? `Showing ${teamSummaryHistory.length} of ${teamSummaryTotal}`
                    : 'No saved summaries'}
                </span>
              </div>
            </div>

            <div ref={teamSummaryScrollRef} className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4 space-y-5">
              {teamSummaryHasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMoreTeamSummaries}
                    disabled={isLoadingMoreTeamSummaries}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {isLoadingMoreTeamSummaries
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <History className="w-3.5 h-3.5" />}
                    {isLoadingMoreTeamSummaries
                      ? 'Loading older summaries…'
                      : `Load older summaries${teamSummaryTotal > teamSummaryHistory.length ? ` (${teamSummaryTotal - teamSummaryHistory.length} more)` : ''}`}
                  </button>
                </div>
              )}

              {isLoadingTeamSummaryHistory && teamSummaryHistory.length === 0 && pendingSummaryReports.length === 0 && (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading saved summaries…
                </div>
              )}

              {[...teamSummaryHistory].reverse().map((record) => (
                <div key={record.code} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-br-md px-3 py-2 text-xs shadow-xs">
                      <div className="font-bold mb-1.5 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Summarize {record.reportCount} report{record.reportCount === 1 ? '' : 's'}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {record.reportSnapshot.map((r) => (
                          <span key={r.code} className="bg-white/15 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                            {r.staffName} • W{r.weekNumber}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[90%] bg-white border border-slate-200 rounded-2xl rounded-bl-md px-3 py-2.5 text-xs shadow-xs">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wide text-indigo-600 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> AI Summary
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopyTeamSummary(record)}
                            className="px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md inline-flex items-center gap-1 cursor-pointer"
                          >
                            {copiedSummaryCode === record.code
                              ? <Check className="w-3 h-3 text-emerald-600" />
                              : <Copy className="w-3 h-3" />}
                            {copiedSummaryCode === record.code ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTeamSummary(record)}
                            disabled={deletingSummaryCode === record.code}
                            className="px-1.5 py-0.5 text-[10px] font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Delete saved summary"
                          >
                            {deletingSummaryCode === record.code
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Trash2 className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                        {record.summaryText}
                      </div>
                      <div className="mt-2 text-[10px] text-slate-400">
                        {new Date(record.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {pendingSummaryReports.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-blue-600 text-white rounded-2xl rounded-br-md px-3 py-2 text-xs shadow-xs">
                      <div className="font-bold mb-1.5 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Summarize {pendingSummaryReports.length} report{pendingSummaryReports.length === 1 ? '' : 's'}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {pendingSummaryReports.map((r) => (
                          <span key={r.id} className="bg-white/15 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                            {r.staffName} • W{r.weekNumber}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[90%] bg-white border border-slate-200 rounded-2xl rounded-bl-md px-3 py-2.5 text-xs shadow-xs text-slate-500 inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> Generating summary…
                    </div>
                  </div>
                </div>
              )}

              {!isLoadingTeamSummaryHistory && !isGeneratingTeamSummary
                && pendingSummaryReports.length === 0 && teamSummaryHistory.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-2 px-6">
                  <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-xs">
                    <Sparkles className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-xs font-bold text-slate-600">
                    {summaryHistorySearch.trim() || summaryHistoryFrom || summaryHistoryTo
                      ? 'No summaries match these filters'
                      : 'No summaries yet'}
                  </p>
                  <p className="text-[11px] max-w-xs">
                    {summaryHistorySearch.trim() || summaryHistoryFrom || summaryHistoryTo
                      ? 'Try a wider date range or clear the search filters.'
                      : 'Select one or more subordinate reports from the list, then click Summary to create the first entry.'}
                  </p>
                </div>
              )}
            </div>

            {teamSummaryError && (
              <div className="shrink-0 px-4 py-2 bg-rose-50 border-t border-rose-200 text-[11px] text-rose-700 flex items-center justify-between gap-2">
                <span className="truncate">{teamSummaryError}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedSubReportCount > 0) void handleGenerateTeamSummary();
                    else void applyTeamSummaryFilters();
                  }}
                  disabled={isGeneratingTeamSummary}
                  className="px-2 py-1 bg-white border border-rose-200 rounded-lg font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                {selectedSubReportCount > 0
                  ? `${selectedSubReportCount} report${selectedSubReportCount === 1 ? '' : 's'} selected`
                  : 'Select subordinate reports from the list to generate another summary.'}
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setIsTeamSummaryOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleGenerateTeamSummary}
                  disabled={selectedSubReportCount === 0 || isGeneratingTeamSummary}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingTeamSummary
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <Sparkles className="w-3.5 h-3.5" />}
                  {isGeneratingTeamSummary ? 'Generating…' : 'Generate Summary'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
