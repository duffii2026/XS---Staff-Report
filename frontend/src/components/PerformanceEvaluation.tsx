import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { User, WeeklyReport, TRSTask, AppraisalRecord, SignatureData, hasUserPermission } from '../types';
import { SignatureImage } from './SignatureImage';
import { showDialog } from './GlobalDialog';
import {
  getVisibleReportsForUser,
  getVisibleTRSTasksForUser,
  getUsers,
  saveReport,
  getVisibleAppraisalRecords,
  saveAppraisalRecord,
  deleteAppraisalRecord,
  getSavedSignatures,
  resolveAppraisalSignees,
  getSubordinateUserIds,
  getTemplateForPosition,
  subscribeHydration
} from '../services/storage';
import { useOrgConfig } from '../hooks/useOrgConfig';
import {
  getWeekDateRange,
  YEAR_OPTIONS,
  formatDateRange,
  MONTH_NAMES,
  getWeeksForMonth,
  getMonthInfoForWeek,
  getReportingYearlyCycleKey
} from '../utils/dateUtils';
import { frequencyBadgeClassFlat, frequencyRuleHint, isYearlyCycle } from '../utils/checklistFrequency';
import { SignatureCanvas, SignatureCanvasHandle } from './SignatureCanvas';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine
} from 'recharts';
import {
  TrendingUp,
  Award,
  Filter,
  Download,
  Calendar,
  Building,
  UserCheck,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertTriangle,
  BarChart3,
  FileSpreadsheet,
  Printer,
  Eye,
  X,
  MessageSquare,
  Send,
  Sparkles,
  Check,
  PenTool,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  Plus,
  Clock,
  ArrowRight,
  Trash2,
  CheckSquare,
  FileBadge,
  Lock,
  Loader2
} from 'lucide-react';
import { ModernSelect } from './ModernSelect';

interface PerformanceEvaluationProps {
  currentUser: User;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const PerformanceEvaluation: React.FC<PerformanceEvaluationProps> = ({ currentUser }) => {
  const { departments: DEPARTMENTS } = useOrgConfig();
  // Only render the responsive variant that matches the current viewport to halve the matrix DOM cost
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Navigation Sub-tab: 'matrix' | 'trends' | 'approvals'
  const [activeSubTab, setActiveSubTab] = useState<'matrix' | 'trends' | 'approvals'>('matrix');

  // Filters for Matrix
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedQuarter, setSelectedQuarter] = useState<string>('Q3'); // 'all' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  const [selectedMonth, setSelectedMonth] = useState<string>('all'); // 'all' | '1'..'12'
  const [selectedWeek, setSelectedWeek] = useState<string>('all'); // 'all' | '1'..'52'
  const [reportScope, setReportScope] = useState<'year' | 'quarter' | 'month' | 'week'>('quarter'); // Report scope: locks the other granularity filters
  const [isScopeDropdownOpen, setIsScopeDropdownOpen] = useState(false);
  const [isSubTabDropdownOpen, setIsSubTabDropdownOpen] = useState(false);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
  const [trendStaffId, setTrendStaffId] = useState<string>(currentUser.id);

  // Evaluation & Review Modal
  const [evaluatingStaffUser, setEvaluatingStaffUser] = useState<User | null>(null);
  const [editingReportForReview, setEditingReportForReview] = useState<WeeklyReport | null>(null);
  const [reviewStatus, setReviewStatus] = useState<'Submitted' | 'Reviewed' | 'Approved'>('Submitted');
  const [reviewFeedback, setReviewFeedback] = useState<string>('');
  const [reviewMessage, setReviewMessage] = useState<string>('');

  // Print & Digital Appraisal Document Modal
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [activeAppraisal, setActiveAppraisal] = useState<AppraisalRecord | null>(null);
  const [appraisalSignMode, setAppraisalSignMode] = useState<'hard_copy' | 'digital'>('digital');

  // Appraisal Form State inside Modal
  const [preparedSig, setPreparedSig] = useState<SignatureData | undefined>(undefined);  const [preparedDate, setPreparedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [preparedNotes, setPreparedNotes] = useState<string>('');

  const [approvedSig, setApprovedSig] = useState<SignatureData | undefined>(undefined);
  const [approvedDate, setApprovedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [approvedNotes, setApprovedNotes] = useState<string>('');

  const preparedSigCanvasRef = useRef<SignatureCanvasHandle>(null);
  const approvedSigCanvasRef = useRef<SignatureCanvasHandle>(null);

  // Appraisals Data State
  const [appraisalsList, setAppraisalsList] = useState<AppraisalRecord[]>([]);
  const [appraisalFilterStatus, setAppraisalFilterStatus] = useState<string>('all');
  const [showCriteriaRubric, setShowCriteriaRubric] = useState<boolean>(false);
  const [managerSigning, setManagerSigning] = useState(false);
  const [execSigning, setExecSigning] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);

  // Bumped every time the backend re-hydrates so memoized data reads refresh after saves/reloads
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => subscribeHydration((status) => { if (status === 'ready') setDataVersion(v => v + 1); }), []);

  const loadAppraisals = () => {
    const records = getVisibleAppraisalRecords(currentUser);
    setAppraisalsList(records);
  };

  useEffect(() => {
    loadAppraisals();
  }, [currentUser, dataVersion]);

  const handleWeekFilterChange = (wVal: string) => {
    setSelectedWeek(wVal);
    if (wVal !== 'all') {
      const range = getWeekDateRange(parseInt(wVal, 10), selectedYear);
      setFromDate(range.startDate);
      setToDate(range.endDate);
    } else {
      setFromDate('');
      setToDate('');
    }
  };

  const handleScopeChange = (scope: 'year' | 'quarter' | 'month' | 'week') => {
    setReportScope(scope);
    if (scope === 'year') {
      setSelectedQuarter('all');
      setSelectedMonth('all');
      setSelectedWeek('all');
      setFromDate('');
      setToDate('');
    } else if (scope === 'quarter') {
      setSelectedQuarter(prev => (prev === 'all' ? 'Q3' : prev));
      setSelectedMonth('all');
      setSelectedWeek('all');
      setFromDate('');
      setToDate('');
    } else if (scope === 'month') {
      setSelectedMonth(prev => (prev === 'all' ? '9' : prev));
      setSelectedQuarter('all');
      setSelectedWeek('all');
      setFromDate('');
      setToDate('');
    } else if (scope === 'week') {
      const targetWeek = selectedWeek === 'all' ? '38' : selectedWeek;
      setSelectedWeek(targetWeek);
      const range = getWeekDateRange(parseInt(targetWeek, 10), selectedYear);
      setFromDate(range.startDate);
      setToDate(range.endDate);
      setSelectedQuarter('all');
      setSelectedMonth('all');
    }
  };

  const reports = useMemo(() => getVisibleReportsForUser(currentUser), [currentUser, dataVersion]);
  const trsTasks = useMemo(() => getVisibleTRSTasksForUser(currentUser), [currentUser, dataVersion]);
  const allUsers = useMemo(() => getUsers(), [dataVersion]);

  // Check if current user is a superior / manager
  const isSuperior = useMemo(
    () => ['admin', 'executive', 'hr'].includes(currentUser.role) || getSubordinateUserIds(currentUser.id).size > 0,
    [currentUser, dataVersion]
  );

  // Compute effective filters based on user role permissions
  const effectiveDept = selectedDept;

  const effectiveStaffId = !isSuperior ? currentUser.id : selectedStaffId;

  // Precompute the subordinate set ONCE so permission checks are O(1) instead of rebuilding it per item
  const subIdSet = useMemo(() => getSubordinateUserIds(currentUser.id), [currentUser, dataVersion]);

  // Helper to check whether currentUser has permission to view target staff data
  const isAllowedUserAccess = useCallback(
    (userId: string, _userDept: string) => {
      if (['admin', 'executive', 'hr'].includes(currentUser.role)) return true;
      if (userId === currentUser.id) return true;
      return subIdSet.has(userId);
    },
    [currentUser, subIdSet]
  );

  // Filter reports based on selectors & permissions
  const filteredReports = useMemo(() => reports.filter(r => {
    if (!isAllowedUserAccess(r.staffId, r.department)) return false;
    if (effectiveDept !== 'all' && r.department !== effectiveDept) return false;
    if (r.year !== selectedYear) return false;
    if (selectedQuarter !== 'all') {
      const qNum = parseInt(selectedQuarter.replace('Q', ''), 10);
      if (r.quarter !== qNum) return false;
    }
    if (selectedMonth !== 'all' && r.month !== parseInt(selectedMonth, 10)) return false;
    if (selectedWeek !== 'all' && r.weekNumber !== parseInt(selectedWeek, 10)) return false;
    if (fromDate && r.endDate && r.endDate < fromDate) return false;
    if (toDate && r.startDate && r.startDate > toDate) return false;
    if (effectiveStaffId !== 'all' && r.staffId !== effectiveStaffId) return false;
    return true;
  }), [reports, isAllowedUserAccess, effectiveDept, selectedYear, selectedQuarter, selectedMonth, selectedWeek, fromDate, toDate, effectiveStaffId]);

  // Filter TRS Reports
  const filteredTRS = useMemo(() => trsTasks.filter(t => {
    if (!isAllowedUserAccess(t.assignedTo, t.department)) return false;
    if (effectiveDept !== 'all' && t.department !== effectiveDept) return false;
    if (effectiveStaffId !== 'all' && t.assignedTo !== effectiveStaffId) return false;
    return true;
  }), [trsTasks, isAllowedUserAccess, effectiveDept, effectiveStaffId]);

  // Calculate aggregated staff scores + precomputed per-staff matrix rows (single pass)
  const { staffList, rowAgg } = useMemo(() => {
    const staffScoreMap = new Map<
      string,
      {
        user: User;
        trScores: number[];
        trsScores: number[];
        reportCount: number;
      }
    >();

    allUsers.forEach(u => {
      if (!isAllowedUserAccess(u.id, u.department)) return;
      if (effectiveDept !== 'all' && u.department !== effectiveDept) return;
      if (effectiveStaffId !== 'all' && u.id !== effectiveStaffId) return;

      staffScoreMap.set(u.id, {
        user: u,
        trScores: [],
        trsScores: [],
        reportCount: 0
      });
    });

    filteredReports.forEach(r => {
      const entry = staffScoreMap.get(r.staffId);
      if (entry) {
        entry.trScores.push(r.trScore);
        entry.reportCount += 1;
      }
    });

    filteredTRS.forEach(t => {
      const entry = staffScoreMap.get(t.assignedTo);
      if (entry && t.status === 'Completed') {
        entry.trsScores.push(t.score);
      }
    });

    const staffList = Array.from(staffScoreMap.values());

    // Group TRS tasks by assignee in a single pass
    const trsByStaff = new Map<string, TRSTask[]>();
    for (const t of filteredTRS) {
      const arr = trsByStaff.get(t.assignedTo);
      if (arr) arr.push(t);
      else trsByStaff.set(t.assignedTo, [t]);
    }

    type StaffRowAgg = {
      trAvg: number;
      trsAvg: number;
      combined: number;
      hasTrsTasksAssigned: boolean;
      assignedCount: number;
      completedCount: number;
    };
    const rowAgg = new Map<string, StaffRowAgg>();
    for (const item of staffList) {
      const userTrs = trsByStaff.get(item.user.id) || [];
      const completedTrs = userTrs.filter(t => t.status === 'Completed');
      const trAvg = item.trScores.length > 0
        ? Math.round(item.trScores.reduce((a, b) => a + b, 0) / item.trScores.length)
        : 0;
      const trsAvg = completedTrs.length > 0
        ? Math.round(completedTrs.reduce((a, b) => a + (b.score ?? 0), 0) / completedTrs.length)
        : 0;
      const hasTrsTasksAssigned = userTrs.length > 0;
      const combined = hasTrsTasksAssigned ? Math.round((trAvg + trsAvg) / 2) : trAvg;

      rowAgg.set(item.user.id, {
        trAvg,
        trsAvg,
        combined,
        hasTrsTasksAssigned,
        assignedCount: userTrs.length,
        completedCount: completedTrs.length
      });
    }

    return { staffList, rowAgg };
  }, [allUsers, filteredReports, filteredTRS, isAllowedUserAccess, effectiveDept, effectiveStaffId]);

  const avgTRScore =
    filteredReports.length > 0
      ? Math.round(filteredReports.reduce((acc, r) => acc + r.trScore, 0) / filteredReports.length)
      : 0;

  const completedTRS = filteredTRS.filter(t => t.status === 'Completed');

  const avgTRSScore =
    completedTRS.length > 0
      ? Math.round(completedTRS.reduce((acc, t) => acc + (t.score ?? 0), 0) / completedTRS.length)
      : 0;

  // Department / Overall Score:
  // If no TRS reports were assigned in this filtered scope, evaluation is 100% based on T&R performance!
  const overallEvaluationScore = (() => {
    if (filteredReports.length === 0 && completedTRS.length === 0) return 0;
    if (filteredTRS.length === 0) {
      return avgTRScore;
    }
    return Math.round((avgTRScore + avgTRSScore) / 2);
  })();

  // Export Evaluation Summary CSV
  const handleExportEvaluationCSV = () => {
    const headers = ['Staff Name', 'Username', 'Department', 'Position', 'T&R Score %', 'TRS Score %', 'Overall Evaluation %', 'Grade'];
    const rows = staffList.map(item => {
      const userTrs = filteredTRS.filter(t => t.assignedTo === item.user.id);
      const completedTrs = userTrs.filter(t => t.status === 'Completed');
      const hasTrsTasksAssigned = userTrs.length > 0;

      const trAvg =
        item.trScores.length > 0
          ? Math.round(item.trScores.reduce((a, b) => a + b, 0) / item.trScores.length)
          : 0;
      const trsAvg =
        completedTrs.length > 0
          ? Math.round(completedTrs.reduce((a, b) => a + (b.score ?? 0), 0) / completedTrs.length)
          : 0;

      // Conditional score logic:
      // If staff does NOT have TRS reports assigned, they still get 100% of their T&R score (not penalized)
      // If staff DOES have TRS reports assigned, they must complete them and system averages T&R and TRS (100% scale)
      const combined = hasTrsTasksAssigned
        ? Math.round((trAvg + trsAvg) / 2)
        : trAvg;

      const grade = combined >= 90 ? 'Outstanding' : combined >= 75 ? 'Satisfactory' : 'Needs Support';

      const trsDisplay = completedTrs.length > 0
        ? `${trsAvg}% (${completedTrs.length}/${userTrs.length} Done)`
        : hasTrsTasksAssigned
        ? `0% (0/${userTrs.length} Done - Pending)`
        : `N/A (No TRS Reports - Exempt)`;

      return [
        `"${item.user.name}"`,
        `"${item.user.username}"`,
        `"${item.user.department}"`,
        `"${item.user.position}"`,
        `${trAvg}%`,
        `"${trsDisplay}"`,
        `${combined}%`,
        `"${grade}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Performance_Evaluation_${selectedYear}_${selectedQuarter}_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Staff Own Score History CSV (Feature 7)
  const handleExportMyScoresCSV = () => {
    const userReports = reports.filter(r => r.staffId === currentUser.id && r.year === selectedYear);
    const userTRS = trsTasks.filter(t => t.assignedTo === currentUser.id);

    const headers = [
      'Month',
      'Year',
      'T&R Reports Count',
      'Avg T&R Score (%)',
      'TRS Deliverables Count',
      'Avg TRS Score (%)',
      'Combined Monthly Score (%)',
      'Performance Tier',
      'Staff Name',
      'Department',
      'Exported Date'
    ];

    const rows = MONTH_NAMES.map((mName, mIdx) => {
      const monthNum = mIdx + 1;
      const mReports = userReports.filter(r => r.month === monthNum);
      const mTrs = userTRS.filter(t => {
        const d = new Date(t.completionDate || t.deadline || '');
        return t.status === 'Completed' && !isNaN(d.getTime()) && (d.getMonth() + 1) === monthNum;
      });

      const trCount = mReports.length;
      const trAvg = trCount > 0 ? Math.round(mReports.reduce((sum, r) => sum + r.trScore, 0) / trCount) : null;
      const trsCount = mTrs.length;
      const trsAvg = trsCount > 0 ? Math.round(mTrs.reduce((sum, t) => sum + (t.score ?? 0), 0) / trsCount) : null;

      let combined: number | null = null;
      if (trAvg !== null && trsAvg !== null) {
        combined = Math.round((trAvg * 0.5) + (trsAvg * 0.5));
      } else if (trAvg !== null) {
        combined = trAvg;
      } else if (trsAvg !== null) {
        combined = trsAvg;
      }

      let tier = 'No Submissions';
      if (combined !== null) {
        if (combined >= 90) tier = 'Exemplary (≥90%)';
        else if (combined >= 80) tier = 'Commendable (80–89%)';
        else if (combined >= 70) tier = 'Satisfactory (70–79%)';
        else tier = 'Needs Improvement (<70%)';
      }

      return [
        `"${mName}"`,
        `${selectedYear}`,
        `${trCount}`,
        trAvg !== null ? `${trAvg}%` : 'N/A',
        `${trsCount}`,
        trsAvg !== null ? `${trsAvg}%` : 'N/A',
        combined !== null ? `${combined}%` : 'N/A',
        `"${tier}"`,
        `"${currentUser.name}"`,
        `"${currentUser.department}"`,
        `"${new Date().toISOString().split('T')[0]}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${currentUser.name.replace(/\s+/g, '_')}_Score_History_${selectedYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Trend & Monthly Breakdown Computations (Feature 5 & 6)
  const targetTrendUserId = (!isSuperior || currentUser.role === 'staff') ? currentUser.id : trendStaffId;
  const targetTrendUser = useMemo(
    () => allUsers.find(u => u.id === targetTrendUserId) || currentUser,
    [allUsers, targetTrendUserId, currentUser]
  );

  const targetUserYearReports = useMemo(
    () => reports.filter(r => r.staffId === targetTrendUser.id && r.year === selectedYear),
    [reports, targetTrendUser, selectedYear]
  );
  const targetUserYearTRS = useMemo(
    () => trsTasks.filter(t => t.assignedTo === targetTrendUser.id),
    [trsTasks, targetTrendUser]
  );

  const monthlyBreakdown = useMemo(() => MONTH_NAMES.map((mName, idx) => {
    const monthNum = idx + 1;
    const mReports = targetUserYearReports.filter(r => r.month === monthNum);
    const mTrs = targetUserYearTRS.filter(t => {
      const d = new Date(t.completionDate || t.deadline || '');
      return t.status === 'Completed' && !isNaN(d.getTime()) && (d.getMonth() + 1) === monthNum;
    });

    const trCount = mReports.length;
    const trAvg = trCount > 0 ? Math.round(mReports.reduce((acc, r) => acc + r.trScore, 0) / trCount) : null;
    const trsCount = mTrs.length;
    const trsAvg = trsCount > 0 ? Math.round(mTrs.reduce((acc, t) => acc + (t.score ?? 0), 0) / trsCount) : null;

    let combined: number | null = null;
    if (trAvg !== null && trsAvg !== null) {
      combined = Math.round((trAvg * 0.5) + (trsAvg * 0.5));
    } else if (trAvg !== null) {
      combined = trAvg;
    } else if (trsAvg !== null) {
      combined = trsAvg;
    }

    let tierLabel = '—';
    let tierColor = 'text-slate-400 bg-slate-50 border-slate-200';
    if (combined !== null) {
      if (combined >= 90) {
        tierLabel = 'Exemplary';
        tierColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
      } else if (combined >= 80) {
        tierLabel = 'Commendable';
        tierColor = 'text-blue-700 bg-blue-50 border-blue-200';
      } else if (combined >= 70) {
        tierLabel = 'Satisfactory';
        tierColor = 'text-slate-700 bg-slate-100 border-slate-300';
      } else {
        tierLabel = 'Needs Improvement';
        tierColor = 'text-amber-700 bg-amber-50 border-amber-200';
      }
    }

    return {
      monthNum,
      monthName: mName,
      trCount,
      trAvg,
      trsCount,
      trsAvg,
      combined,
      tierLabel,
      tierColor
    };
  }), [targetUserYearReports, targetUserYearTRS]);

  // Calculate Trend Chart Dual-Series Data
  const currentWeekEst = Math.min(52, Math.max(1, Math.ceil((new Date().getTime() - new Date(selectedYear, 0, 1).getTime()) / (7 * 24 * 3600 * 1000))));
  const maxWeekToShow = selectedYear < new Date().getFullYear() ? 52 : Math.max(currentWeekEst, 12);

  const weeklyTrendData = useMemo(() => Array.from({ length: maxWeekToShow }, (_, i) => {
    const w = i + 1;
    const rep = targetUserYearReports.find(r => r.weekNumber === w);
    const mInfo = getMonthInfoForWeek(w, selectedYear);
    const monthStat = monthlyBreakdown[mInfo.month - 1];

    return {
      week: `W${w}`,
      weekNumber: w,
      monthName: mInfo.monthName,
      trScore: rep ? rep.trScore : null,
      combinedMonthlyAvg: monthStat ? monthStat.combined : null
    };
  }), [maxWeekToShow, targetUserYearReports, selectedYear, monthlyBreakdown]);

  const openAppraisalModal = (record?: AppraisalRecord, initialMode: 'hard_copy' | 'digital' = 'digital') => {
    if (record) {
      setActiveAppraisal(record);
      setAppraisalSignMode(initialMode);
      setPreparedSig(record.preparedSignature);
      setPreparedDate(record.preparedDate || new Date().toISOString().split('T')[0]);
      setPreparedNotes(record.preparedNotes || '');
      setApprovedSig(record.approvedSignature);
      setApprovedDate(record.approvedDate || new Date().toISOString().split('T')[0]);
      setApprovedNotes(record.approvedNotes || '');
    } else {
      // General print view of evaluation matrix
      setActiveAppraisal(null);
      setAppraisalSignMode(initialMode);
    }
    setShowPrintModal(true);
  };

  const handleTriggerPrint = () => {
    try {
      const docElement = document.querySelector('.printable-document');
      if (docElement) {
        const clone = docElement.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.no-print, .print\\:hidden, button').forEach(el => el.remove());

        const printWindow = window.open('', '_blank', 'width=900,height=850');
        if (printWindow) {
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Staff Performance Appraisal Document</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 24px; background: white; color: #0f172a; }
                  @media print {
                    body { padding: 0; margin: 0; }
                  }
                </style>
              </head>
              <body>
                <div style="max-width: 850px; margin: 0 auto;">
                  ${clone.innerHTML}
                </div>
                <script>
                  setTimeout(() => {
                    window.focus();
                    window.print();
                  }, 500);
                </script>
              </body>
            </html>
          `);
          printWindow.document.close();
        }
      }
    } catch (e) {
      console.warn('Print popup fallback notice:', e);
    }
  };

  const handleOpenStaffAppraisal = (targetUser: User, initialMode: 'hard_copy' | 'digital' = 'digital') => {
    // Check if an appraisal record already exists for this staff member in this year
    const existing = appraisalsList.find(a => a.staffId === targetUser.id && (a.year === selectedYear || a.periodYear === selectedYear));
    if (existing) {
      openAppraisalModal(existing, initialMode);
      return;
    }

    // Otherwise create draft appraisal from current calculated metrics
    const userReports = reports.filter(r => r.staffId === targetUser.id && r.year === selectedYear);
    const userTrs = trsTasks.filter(t => t.assignedTo === targetUser.id);
    const completedTrs = userTrs.filter(t => t.status === 'Completed');
    const hasTrsTasksAssigned = userTrs.length > 0;

    const trAvg = userReports.length > 0
      ? Math.round(userReports.reduce((acc, r) => acc + r.trScore, 0) / userReports.length)
      : 0;
    const trsAvg = completedTrs.length > 0
      ? Math.round(completedTrs.reduce((acc, t) => acc + (t.score ?? 0), 0) / completedTrs.length)
      : 0;
    const combined = hasTrsTasksAssigned ? Math.round((trAvg + trsAvg) / 2) : trAvg;

    const periodLabel = selectedQuarter !== 'all' 
      ? `${selectedYear} (${selectedQuarter})` 
      : selectedMonth !== 'all' 
      ? `${selectedYear} (Month ${selectedMonth})` 
      : `${selectedYear} (Full Year)`;

    const newRecord: AppraisalRecord = {
      id: `appraisal_${targetUser.id}_${selectedYear}_${Date.now()}`,
      staffId: targetUser.id,
      staffName: targetUser.name,
      department: targetUser.department,
      position: targetUser.position,
      year: selectedYear,
      periodYear: selectedYear,
      periodQuarter: selectedQuarter !== 'all' ? selectedQuarter : 'Full Year',
      period: periodLabel,
      trScore: trAvg,
      trsScore: trsAvg,
      overallScore: combined,
      status: 'Draft',
      signatureMode: initialMode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveAppraisalRecord(newRecord, currentUser);
    loadAppraisals();
    openAppraisalModal(newRecord, initialMode);
  };

  const handlePrintReport = () => {
    // Opens the Department Score Matrix Summary in the modal for preview and printing
    openAppraisalModal(undefined, 'hard_copy');
  };

  // Superior/Manager signs prepared appraisal
  const handleManagerSubmitSign = async (appraisal: AppraisalRecord) => {
    if (managerSigning) return;
    let finalSig = preparedSig;
    if (!finalSig) {
      finalSig = preparedSigCanvasRef.current?.requestSignature();
      if (finalSig) setPreparedSig(finalSig);
    }
    if (!finalSig) {
      showDialog('Please draw your handwritten signature or type your digital stamp ID before submitting!');
      return;
    }
    const updated: AppraisalRecord = {
      ...appraisal,
      status: 'Pending Executive Approval',
      signatureMode: appraisalSignMode,
      preparedByUserId: currentUser.id,
      preparedByName: currentUser.name,
      preparedByRole: currentUser.role,
      preparedDate: preparedDate,
      preparedSignature: finalSig,
      preparedNotes: preparedNotes,
      updatedAt: new Date().toISOString()
    };

    setManagerSigning(true);
    try {
      await saveAppraisalRecord(updated, currentUser);
      setActiveAppraisal(updated);
      loadAppraisals();
      showDialog(`Appraisal signed successfully! Document automatically routed to Approved By (Executive Management / HR).`);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to sign and submit the appraisal. Please try again.');
    } finally {
      setManagerSigning(false);
    }
  };

  // Executive/HR completes final approval
  const handleExecutiveApproveSign = async (appraisal: AppraisalRecord) => {
    if (execSigning) return;
    let finalSig = approvedSig;
    if (!finalSig) {
      finalSig = approvedSigCanvasRef.current?.requestSignature();
      if (finalSig) setApprovedSig(finalSig);
    }
    if (!finalSig) {
      showDialog('Please draw your handwritten signature or type your digital stamp ID before executing final approval!');
      return;
    }
    const updated: AppraisalRecord = {
      ...appraisal,
      status: 'Fully Approved',
      approvedByUserId: currentUser.id,
      approvedByName: currentUser.name,
      approvedByRole: currentUser.role,
      approvedDate: approvedDate,
      approvedSignature: finalSig,
      approvedNotes: approvedNotes,
      updatedAt: new Date().toISOString()
    };

    setExecSigning(true);
    try {
      await saveAppraisalRecord(updated, currentUser);
      setActiveAppraisal(updated);
      loadAppraisals();
      showDialog(`Final Executive Approval Completed! Appraisal status updated to Fully Approved.`);
    } catch (err: any) {
      showDialog(err?.message || 'Failed to complete executive approval. Please try again.');
    } finally {
      setExecSigning(false);
    }
  };

  const pendingApprovalsCount = appraisalsList.filter(a => a.status === 'Pending Executive Approval').length;

  return (
    <div className="p-2 space-y-6 print:p-0">
      {/* Primary Navigation Sub-Tabs Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-xs flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('matrix')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'matrix'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-blue-600" />
            Performance Score Matrix
          </button>

          <button
            onClick={() => setActiveSubTab('trends')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'trends'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            Performance Trends & Monthly Breakdown
          </button>

          <button
            onClick={() => setActiveSubTab('approvals')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              activeSubTab === 'approvals'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PenTool className="w-4 h-4 text-indigo-600" />
            Appraisal E-Signatures & Workflow Queue
            {pendingApprovalsCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-extrabold animate-pulse">
                {pendingApprovalsCount} Pending
              </span>
            )}
          </button>
        </div>

        {/* Mobile View Selection Dropdown */}
        <div className="md:hidden w-full bg-slate-100 p-1.5 rounded-xl">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSubTabDropdownOpen(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={isSubTabDropdownOpen}
              className={`w-full px-3 py-2 rounded-lg text-xs font-bold bg-white border shadow-xs flex items-center justify-between gap-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isSubTabDropdownOpen ? 'border-blue-300 ring-1 ring-blue-200' : 'border-slate-200'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {activeSubTab === 'matrix' ? (
                  <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
                ) : activeSubTab === 'trends' ? (
                  <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <PenTool className="w-4 h-4 text-indigo-600 shrink-0" />
                )}
                <span className="truncate">
                  {activeSubTab === 'matrix'
                    ? 'Performance Score Matrix'
                    : activeSubTab === 'trends'
                      ? 'Performance Trends & Monthly Breakdown'
                      : `Appraisal E-Signatures & Workflow Queue${pendingApprovalsCount > 0 ? ` (${pendingApprovalsCount} Pending)` : ''}`}
                </span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isSubTabDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isSubTabDropdownOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIsSubTabDropdownOpen(false)} />
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                >
                  {([
                    { key: 'matrix' as const, label: 'Performance Score Matrix', icon: <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />, activeColor: 'text-blue-700', bgActive: 'bg-blue-50', desc: 'Scores across staff & months' },
                    { key: 'trends' as const, label: 'Performance Trends & Monthly Breakdown', icon: <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />, activeColor: 'text-emerald-700', bgActive: 'bg-emerald-50', desc: 'Charts & monthly progression' },
                    { key: 'approvals' as const, label: 'Appraisal E-Signatures & Workflow Queue', icon: <PenTool className="w-4 h-4 text-indigo-600 shrink-0" />, activeColor: 'text-indigo-700', bgActive: 'bg-indigo-50', desc: pendingApprovalsCount > 0 ? `${pendingApprovalsCount} Pending Approval` : 'Signature workflow queue' }
                  ]).map(opt => {
                    const isActive = activeSubTab === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          setActiveSubTab(opt.key);
                          setIsSubTabDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                          isActive ? `${opt.bgActive} ${opt.activeColor}` : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {opt.icon}
                          <span className="min-w-0">
                            <span className="block text-xs font-bold truncate">{opt.label}</span>
                            <span className={`block text-[10px] font-medium truncate ${isActive ? 'opacity-70' : 'text-slate-400'}`}>{opt.desc}</span>
                          </span>
                        </span>
                        {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-2">
          <button
            onClick={handleExportMyScoresCSV}
            className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5 border border-emerald-200 shadow-xs transition-all"
            title="Download personal score history across all months and weeks as CSV"
          >
            <Download className="w-4 h-4 text-emerald-600" /> Export My Scores (CSV)
          </button>
          <button
            onClick={handleExportEvaluationCSV}
            className="px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-200 shadow-xs transition-all"
          >
            <Download className="w-4 h-4 text-emerald-600" /> Export CSV
          </button>
          <button
            onClick={handlePrintReport}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
          >
            <Printer className="w-4 h-4" /> Print Matrix
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: SCORE ANALYTICS MATRIX */}
      {activeSubTab === 'matrix' && (
        <div className="space-y-6">
          {/* Evaluation Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3.5 print:hidden">
            {/* Scope Switcher Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-indigo-600" />
                  Report Scope:
                </span>
                <div className="relative sm:hidden">
                  <button
                    type="button"
                    onClick={() => setIsScopeDropdownOpen(v => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={isScopeDropdownOpen}
                    className={`w-full px-3 py-2 bg-slate-100 border rounded-xl text-xs font-bold text-slate-800 flex items-center justify-between gap-2 cursor-pointer transition-all focus:ring-2 focus:ring-indigo-500 focus:outline-none ${
                      isScopeDropdownOpen ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Filter className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="truncate">
                        {reportScope === 'year' ? 'Full Year' : reportScope === 'quarter' ? 'By Quarter' : reportScope === 'month' ? 'By Month' : 'By Week'}
                      </span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${isScopeDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isScopeDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setIsScopeDropdownOpen(false)} />
                      <div
                        role="listbox"
                        className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                      >
                        {([
                          { key: 'year', label: 'Full Year', desc: 'All 12 months aggregated' },
                          { key: 'quarter', label: 'By Quarter', desc: 'Monthly & weekly filters locked' },
                          { key: 'month', label: 'By Month', desc: 'Weekly filter locked' },
                          { key: 'week', label: 'By Week', desc: 'Granular week selection' }
                        ] as const).map(opt => {
                          const isActive = reportScope === opt.key;
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              onClick={() => {
                                handleScopeChange(opt.key);
                                setIsScopeDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block text-xs font-bold truncate">{opt.label}</span>
                                <span className={`block text-[10px] font-medium truncate ${isActive ? 'text-indigo-500' : 'text-slate-400'}`}>{opt.desc}</span>
                              </span>
                              {isActive && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                <div className="hidden sm:inline-flex p-1 bg-slate-100 rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => handleScopeChange('year')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      reportScope === 'year'
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Full Year
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('quarter')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      reportScope === 'quarter'
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    By Quarter
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('month')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      reportScope === 'month'
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    By Month
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('week')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      reportScope === 'week'
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    By Week
                  </button>
                </div>
              </div>

              <div className="text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1 rounded-lg flex items-center gap-1.5">
                {reportScope === 'quarter' && (
                  <span className="text-indigo-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    Quarter Mode: Monthly & Weekly are locked
                  </span>
                )}
                {reportScope === 'month' && (
                  <span className="text-indigo-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    Monthly Mode: Quarter & Weekly are locked
                  </span>
                )}
                {reportScope === 'week' && (
                  <span className="text-indigo-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    Weekly Mode: Quarter & Monthly are locked
                  </span>
                )}
                {reportScope === 'year' && (
                  <span className="text-indigo-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    Full Year Mode: All 12 months aggregated
                  </span>
                )}
              </div>
            </div>

            {/* Filter Dropdowns Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Department</label>
              {['admin', 'executive', 'hr'].includes(currentUser.role) ? (
                <ModernSelect
                  value={selectedDept}
                  onChange={e => setSelectedDept(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white"
                >
                  <option value="all">All Departments</option>
                  {DEPARTMENTS.map(d => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </ModernSelect>
              ) : (
                <div className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 bg-slate-50">
                  {currentUser.department} Dept
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Year</label>
              <ModernSelect
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white font-semibold"
              >
                {YEAR_OPTIONS.map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </ModernSelect>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                <span>Quarter Filter</span>
                {reportScope !== 'quarter' && (
                  <span className="text-[10px] text-slate-400 font-medium flex items-center gap-0.5 lowercase">
                    <Lock className="w-2.5 h-2.5" /> locked
                  </span>
                )}
              </label>
              {reportScope === 'quarter' ? (
                <ModernSelect
                  value={selectedQuarter}
                  onChange={e => setSelectedQuarter(e.target.value)}
                  className="w-full px-3 py-1.5 border border-indigo-400 ring-2 ring-indigo-50 rounded-xl text-xs text-slate-900 bg-white font-semibold"
                >
                  <option value="Q1">Q1 (Jan - Mar)</option>
                  <option value="Q2">Q2 (Apr - Jun)</option>
                  <option value="Q3">Q3 (Jul - Sep)</option>
                  <option value="Q4">Q4 (Oct - Dec)</option>
                </ModernSelect>
              ) : (
                <div className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-400 bg-slate-100 flex items-center justify-between cursor-not-allowed">
                  <span className="truncate">Locked ({reportScope === 'year' ? 'Full Year' : reportScope === 'month' ? 'Monthly' : 'Weekly'})</span>
                  <Lock className="w-3 h-3 text-slate-400 shrink-0 ml-1" />
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                <span>Monthly Filter</span>
                {reportScope !== 'month' && (
                  <span className="text-[10px] text-slate-400 font-medium flex items-center gap-0.5 lowercase">
                    <Lock className="w-2.5 h-2.5" /> locked
                  </span>
                )}
              </label>
              {reportScope === 'month' ? (
                <ModernSelect
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="w-full px-3 py-1.5 border border-indigo-400 ring-2 ring-indigo-50 rounded-xl text-xs text-slate-900 bg-white font-semibold"
                >
                  <option value="1">January</option>
                  <option value="2">February</option>
                  <option value="3">March</option>
                  <option value="4">April</option>
                  <option value="5">May</option>
                  <option value="6">June</option>
                  <option value="7">July</option>
                  <option value="8">August</option>
                  <option value="9">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </ModernSelect>
              ) : (
                <div className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-400 bg-slate-100 flex items-center justify-between cursor-not-allowed">
                  <span className="truncate">Locked ({reportScope === 'year' ? 'Full Year' : reportScope === 'quarter' ? 'Quarterly' : 'Weekly'})</span>
                  <Lock className="w-3 h-3 text-slate-400 shrink-0 ml-1" />
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1 flex items-center justify-between">
                <span>Weekly Filter</span>
                {reportScope !== 'week' && (
                  <span className="text-[10px] text-slate-400 font-medium flex items-center gap-0.5 lowercase">
                    <Lock className="w-2.5 h-2.5" /> locked
                  </span>
                )}
              </label>
              {reportScope === 'week' ? (
                <ModernSelect
                  value={selectedWeek}
                  onChange={e => handleWeekFilterChange(e.target.value)}
                  className="w-full px-3 py-1.5 border border-indigo-400 ring-2 ring-indigo-50 rounded-xl text-xs text-slate-900 bg-white font-semibold"
                >
                  <option value="1">Week 1</option>
                  {Array.from({ length: 51 }, (_, i) => i + 2).map(w => (
                    <option key={w} value={w.toString()}>
                      Week {w}
                    </option>
                  ))}
                </ModernSelect>
              ) : (
                <div className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-400 bg-slate-100 flex items-center justify-between cursor-not-allowed">
                  <span className="truncate">Locked ({reportScope === 'year' ? 'Full Year' : reportScope === 'quarter' ? 'Quarterly' : 'Monthly'})</span>
                  <Lock className="w-3 h-3 text-slate-400 shrink-0 ml-1" />
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Staff Member</label>
              {!isSuperior ? (
                <div className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 bg-slate-50">
                  {currentUser.name} (My Evaluation)
                </div>
              ) : (
                <ModernSelect
                  value={selectedStaffId}
                  onChange={e => setSelectedStaffId(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs text-slate-900 bg-white"
                >
                  <option value="all">
                    {['admin', 'executive', 'hr'].includes(currentUser.role)
                      ? 'All Staff Members'
                      : 'All Team / Department Staff'}
                  </option>
                  {allUsers
                    .filter(u => isAllowedUserAccess(u.id, u.department))
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.position})
                      </option>
                    ))}
                </ModernSelect>
              )}
            </div>

            {(fromDate || toDate || selectedWeek !== 'all') && (
              <div className="text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 px-3.5 py-2 rounded-xl flex items-center justify-between col-span-full">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Active Evaluation Date Period:
                </span>
                <span className="font-bold text-blue-900 bg-white px-2.5 py-0.5 rounded-lg border border-blue-200 shadow-xs">
                  {fromDate && toDate
                    ? `${fromDate} to ${toDate}`
                    : fromDate
                    ? `From ${fromDate}`
                    : toDate
                    ? `Up to ${toDate}`
                    : `${getWeekDateRange(parseInt(selectedWeek, 10), selectedYear).formattedRange}`}
                </span>
              </div>
            )}
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center justify-between">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">T&R Average Score</span>
                <span className="text-2xl font-black text-blue-600">{avgTRScore}%</span>
                <span className="block text-[10px] text-slate-500 mt-0.5">JD Checklist Completion Rate</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center justify-between">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">TRS Superior Score</span>
                <span className="text-2xl font-black text-emerald-600">{avgTRSScore}%</span>
                <span className="block text-[10px] text-slate-500 mt-0.5">Assigned Non-JD Task Completion</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Award className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center justify-between">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Overall Appraisal Grade</span>
                <span
                  className={`text-2xl font-black ${
                    overallEvaluationScore >= 90
                      ? 'text-emerald-600'
                      : overallEvaluationScore >= 75
                      ? 'text-blue-600'
                      : 'text-amber-600'
                  }`}
                >
                  {overallEvaluationScore}%
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  {overallEvaluationScore >= 90
                    ? 'Grade A: Exceeds Target'
                    : overallEvaluationScore >= 75
                    ? 'Grade B: Meets Expectation'
                    : 'Grade C: Requires Action'}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold">
                <BarChart3 className="w-6 h-6" />
              </div>
            </div>
          </div>

        

          {/* Staff Appraisal Matrix Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex flex-col gap-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-600" />
                  {!isSuperior ? 'My Performance Evaluation Summary' : 'Staff Performance Score Matrix'}
                </h3>
                {isSuperior && (
                  <span className="text-xs text-slate-500 font-medium self-start sm:self-auto">
                    {staffList.length} Members
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 font-medium">
                Period: {selectedYear} • {selectedWeek !== 'all' ? `Week ${selectedWeek} (${getWeekDateRange(parseInt(selectedWeek, 10), selectedYear).shortRange})` : selectedQuarter === 'all' ? (selectedMonth === 'all' ? 'Full Year' : `Month ${selectedMonth}`) : selectedQuarter}
              </span>
            </div>

            {/* Desktop Table */}
            {isDesktop && (<div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3">Staff Member</th>
                    <th className="p-3">Department & Position</th>
                    <th className="p-3">Reports</th>
                    <th className="p-3">T&R Score %</th>
                    <th className="p-3">TRS Score %</th>
                    <th className="p-3">Overall Score</th>
                    <th className="p-3">Appraisal Status</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {staffList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400">
                        No staff records found for the selected filter combination.
                      </td>
                    </tr>
                  ) : (
                    staffList.map(item => {
                      const agg = rowAgg.get(item.user.id)!;
                      const hasTrsTasksAssigned = agg.hasTrsTasksAssigned;
                      const completedTrs = agg.completedCount;
                      const userTrs = agg.assignedCount;
                      const trAvg = agg.trAvg;
                      const trsAvg = agg.trsAvg;
                      const combined = agg.combined;

                      return (
                        <tr key={item.user.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3 font-bold text-slate-900">
                            <div>{item.user.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal">@{item.user.username}</div>
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-slate-800">{item.user.position}</div>
                            <div className="text-[10px] text-slate-400">{item.user.department}</div>
                          </td>
                          <td className="p-3 font-semibold text-slate-700">{item.reportCount} Submitted</td>
                          <td className="p-3 font-extrabold text-blue-600">{trAvg}%</td>
                          <td className="p-3 font-extrabold">
                            {completedTrs > 0 ? (
                              <div>
                                <span className="text-emerald-600">{trsAvg}%</span>
                                {userTrs > completedTrs && (
                                  <span className="block text-[10px] text-slate-400 font-normal">
                                    {completedTrs}/{userTrs} Done
                                  </span>
                                )}
                              </div>
                            ) : hasTrsTasksAssigned ? (
                              <div>
                                <span className="text-amber-600">0%</span>
                                <span className="block text-[10px] text-amber-700 font-medium">Pending Completion</span>
                              </div>
                            ) : (
                              <div>
                                <span className="text-slate-400 font-semibold">—</span>
                                <span className="block text-[10px] text-slate-400 font-normal">No TRS Reports (Exempt)</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-black text-slate-900 text-sm">{combined}%</td>
                          <td className="p-3">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                combined >= 90
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : combined >= 75
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {combined >= 90 ? 'Outstanding' : combined >= 75 ? 'Satisfactory' : 'Needs Review'}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => setEvaluatingStaffUser(item.user)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 border border-slate-200 shadow-2xs transition-all"
                                title="View weekly checklists & deliverables audit"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-500" />
                                View Reports
                              </button>
                              <button
                                onClick={() => handleOpenStaffAppraisal(item.user, 'digital')}
                                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 shadow-xs transition-all hover:scale-105"
                                title="Open Official Appraisal Document (Option 1: Physical Print / Option 2: Digital E-Sign)"
                              >
                                <PenTool className="w-3.5 h-3.5" />
                                Appraisal (Option 1 / 2)
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>)}

            {/* Mobile Cards */}
            {!isDesktop && (<div className="md:hidden space-y-3">
              {staffList.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No staff records found for the selected filter combination.
                </div>
              ) : (
                staffList.map(item => {
                  const agg = rowAgg.get(item.user.id)!;
                  const hasTrsTasksAssigned = agg.hasTrsTasksAssigned;
                  const completedTrs = agg.completedCount;
                  const userTrs = agg.assignedCount;
                  const trAvg = agg.trAvg;
                  const trsAvg = agg.trsAvg;
                  const combined = agg.combined;

                  return (
                    <div key={item.user.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 truncate">{item.user.name}</div>
                          <div className="text-[10px] text-slate-400">@{item.user.username}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{item.user.position} · {item.user.department}</div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                            combined >= 90
                              ? 'bg-emerald-100 text-emerald-800'
                              : combined >= 75
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {combined >= 90 ? 'Outstanding' : combined >= 75 ? 'Satisfactory' : 'Needs Review'}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 text-center">
                        <div>
                          <span className="block text-[9px] font-bold text-slate-400 uppercase">T&R</span>
                          <span className="text-sm font-extrabold text-blue-600">{trAvg}%</span>
                        </div>
                        <div>
                          <span className="block text-[9px] font-bold text-slate-400 uppercase">TRS</span>
                          {completedTrs > 0 ? (
                            <span className="text-sm font-extrabold text-emerald-600">{trsAvg}%</span>
                          ) : hasTrsTasksAssigned ? (
                            <span className="text-sm font-extrabold text-amber-600">0%</span>
                          ) : (
                            <span className="text-sm font-semibold text-slate-400">—</span>
                          )}
                        </div>
                        <div>
                          <span className="block text-[9px] font-bold text-slate-400 uppercase">Overall</span>
                          <span className="text-sm font-black text-slate-900">{combined}%</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 font-medium">{item.reportCount} Reports</span>
                        {hasTrsTasksAssigned && (
                          <span className="text-[10px] text-slate-400">· {completedTrs}/{userTrs} TRS Done</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                        <button
                          onClick={() => setEvaluatingStaffUser(item.user)}
                          className="flex-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 border border-slate-200 transition-all"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View Reports
                        </button>
                        <button
                          onClick={() => handleOpenStaffAppraisal(item.user, 'digital')}
                          className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-all"
                        >
                          <PenTool className="w-3.5 h-3.5" />
                          Appraisal
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>)}
          </div>
        </div>
      )}

      {/* SUB-TAB: PERFORMANCE TRENDS & MONTHLY BREAKDOWN (FEATURES 5, 6, 7) */}
      {activeSubTab === 'trends' && (
        <div className="space-y-6">
          {/* Top Banner & Control Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-600">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Performance Trend Trajectory & Monthly Breakdown
                </h3>
                <div className="mt-1">
                  <span className="inline-block text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Dual-Series Analytics
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Visualizing weekly T&R routine execution against monthly combined averages (T&R + TRS). Staff view personal trajectory; managers view their team.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Staff Selector for Superiors / Admins */}
              {isSuperior ? (
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                  <label className="text-[11px] font-bold text-slate-600">Team Member:</label>
                  <ModernSelect
                    value={targetTrendUserId}
                    onChange={e => setTrendStaffId(e.target.value)}
                    className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                  >
                    <option value={currentUser.id}>Myself ({currentUser.name})</option>
                    {allUsers
                      .filter(u => u.id !== currentUser.id && isAllowedUserAccess(u.id, u.department))
                      .map(u => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.position})
                        </option>
                      ))}
                  </ModernSelect>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-800">{currentUser.name}</span>
                  <span className="text-[10px] text-slate-500">({currentUser.position})</span>
                </div>
              )}

              {/* Year Selector */}
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <ModernSelect
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                >
                  {YEAR_OPTIONS.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </ModernSelect>
              </div>

              {/* One-Click Export My Scores Button */}
              <button
                onClick={handleExportMyScoresCSV}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all"
                title="Download personal score history CSV"
              >
                <Download className="w-4 h-4" /> Export My Scores (CSV)
              </button>
            </div>
          </div>

          {/* Quick Stat Highlights */}
          {(() => {
            const ytdTRReports = targetUserYearReports.filter(r => r.status === 'Approved' || r.status === 'Reviewed');
            const ytdTRAvg = ytdTRReports.length > 0 ? Math.round(ytdTRReports.reduce((s, r) => s + r.trScore, 0) / ytdTRReports.length) : 0;
            const ytdCompletedTRS = targetUserYearTRS.filter(t => t.status === 'Completed');
            const ytdTRSAvg = ytdCompletedTRS.length > 0 ? Math.round(ytdCompletedTRS.reduce((s, t) => s + (t.score ?? 0), 0) / ytdCompletedTRS.length) : 0;
            const ytdCombined = ytdCompletedTRS.length > 0 ? Math.round((ytdTRAvg * 0.5) + (ytdTRSAvg * 0.5)) : ytdTRAvg;

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">YTD Combined Performance</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className={`text-2xl font-black ${ytdCombined >= 80 ? 'text-emerald-600' : ytdCombined >= 70 ? 'text-blue-600' : 'text-amber-600'}`}>
                      {ytdCombined}%
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      {ytdCombined >= 90 ? '★ Exemplary' : ytdCombined >= 80 ? 'Commendable' : ytdCombined >= 70 ? 'Satisfactory' : 'Needs Focus'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">50% Routine T&R + 50% Special TRS</span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">T&R Routine Checklist Average</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-blue-600">{ytdTRAvg}%</span>
                    <span className="text-xs text-slate-500 font-semibold">({ytdTRReports.length} Submitted)</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Pillars: 50% Routine, 20% Time, 30% Quality</span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">TRS Project Tasks Average</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-indigo-600">
                      {ytdCompletedTRS.length > 0 ? `${ytdTRSAvg}%` : 'N/A'}
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      ({ytdCompletedTRS.length} / {targetUserYearTRS.length} Done)
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Pillars: 40% Timeliness, 60% Quality</span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Staff Evaluation Target</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-black text-emerald-700">80.0%</span>
                    <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      Standard Benchmark
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Benchmark line displayed on chart</span>
                </div>
              </div>
            );
          })()}

          {/* CARD 1: PERFORMANCE TREND CHART (FEATURE 5) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  Dual-Series Trajectory: Weekly T&R Routine Scores vs Monthly Combined Average
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bars reflect granular weekly T&R checklist performance. The line tracks the combined monthly average (T&R + TRS deliverables).
                </p>
              </div>

              {/* Chart Legend Summary */}
              <div className="flex items-center gap-3 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-blue-500 inline-block" />
                  <span className="text-slate-700 text-[11px]">Weekly T&R Score (%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 bg-emerald-500 inline-block" />
                  <span className="text-slate-700 text-[11px]">Monthly Combined Avg (%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-0.5 border-b-2 border-dashed border-amber-400 inline-block" />
                  <span className="text-slate-700 text-[11px]">80% Benchmark</span>
                </div>
              </div>
            </div>

            {/* Recharts Interactive Container */}
            <div className="w-full h-80 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={weeklyTrendData}
                  margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                    unit="%"
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1 border border-slate-800">
                            <div className="font-bold border-b border-slate-700 pb-1 flex justify-between gap-3">
                              <span>Week {data.weekNumber} ({data.monthName})</span>
                              <span className="text-slate-400">{selectedYear}</span>
                            </div>
                            <div className="flex justify-between gap-4 text-blue-300">
                              <span>Weekly T&R Score:</span>
                              <span className="font-bold">{data.trScore !== null ? `${data.trScore}%` : 'Not Submitted'}</span>
                            </div>
                            <div className="flex justify-between gap-4 text-emerald-300">
                              <span>Month Combined Avg:</span>
                              <span className="font-bold">{data.combinedMonthlyAvg !== null ? `${data.combinedMonthlyAvg}%` : 'N/A'}</span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <ReferenceLine
                    y={80}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: 'Target 80%', position: 'insideTopRight', fill: '#d97706', fontSize: 10, fontWeight: 'bold' }}
                  />
                  <Bar
                    dataKey="trScore"
                    name="Weekly T&R Score (%)"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="combinedMonthlyAvg"
                    name="Monthly Combined Avg (%)"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#10b981' }}
                    activeDot={{ r: 6 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* CARD 2: MONTH-BY-MONTH SCORE BREAKDOWN TABLE (FEATURE 6) */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                  Month-by-Month Score Breakdown Table ({selectedYear})
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Detailed breakdown showing monthly T&R count & average, TRS completed deliverables & score, and final weighted combined monthly rating.
                </p>
              </div>

              <button
                onClick={handleExportMyScoresCSV}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" /> Export Breakdown Table (CSV)
              </button>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                    <th className="py-3 px-4">Calendar Month</th>
                    <th className="py-3 px-4 text-center">T&R Count</th>
                    <th className="py-3 px-4 text-center">Avg T&R Score</th>
                    <th className="py-3 px-4 text-center">TRS Deliverables</th>
                    <th className="py-3 px-4 text-center">Avg TRS Score</th>
                    <th className="py-3 px-4 text-center">Combined Monthly Score</th>
                    <th className="py-3 px-4 text-center">Performance Rating Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyBreakdown.map(item => (
                    <tr key={item.monthNum} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {item.monthName} ({selectedYear})
                      </td>
                      <td className="py-3 px-4 text-center font-semibold text-slate-700">
                        {item.trCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold border border-blue-100">
                            {item.trCount} reports
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-bold">
                        {item.trAvg !== null ? (
                          <span className={item.trAvg >= 80 ? 'text-emerald-600' : item.trAvg >= 70 ? 'text-blue-600' : 'text-amber-600'}>
                            {item.trAvg}%
                          </span>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-semibold text-slate-700">
                        {item.trsCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold border border-indigo-100">
                            {item.trsCount} tasks
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-bold">
                        {item.trsAvg !== null ? (
                          <span className={item.trsAvg >= 80 ? 'text-emerald-600' : item.trsAvg >= 70 ? 'text-blue-600' : 'text-amber-600'}>
                            {item.trsAvg}%
                          </span>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center font-black">
                        {item.combined !== null ? (
                          <span className={`text-sm px-2.5 py-0.5 rounded-lg border ${
                            item.combined >= 80
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : item.combined >= 70
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {item.combined}%
                          </span>
                        ) : (
                          <span className="text-slate-400">No Data</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${item.tierColor}`}>
                          {item.tierLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Summary Table Footer */}
                {(() => {
                  const activeMonths = monthlyBreakdown.filter(m => m.combined !== null);
                  const totalTRCount = monthlyBreakdown.reduce((sum, m) => sum + m.trCount, 0);
                  const totalTRSCount = monthlyBreakdown.reduce((sum, m) => sum + m.trsCount, 0);
                  const overallCombinedAvg = activeMonths.length > 0
                    ? Math.round(activeMonths.reduce((sum, m) => sum + (m.combined || 0), 0) / activeMonths.length)
                    : 0;

                  return (
                    <tfoot>
                      <tr className="bg-slate-100/90 font-bold border-t-2 border-slate-300 text-slate-800">
                        <td className="py-3 px-4 uppercase text-[11px]">Annual Summary / Totals</td>
                        <td className="py-3 px-4 text-center text-blue-700">{totalTRCount} Total</td>
                        <td className="py-3 px-4 text-center text-slate-500">—</td>
                        <td className="py-3 px-4 text-center text-indigo-700">{totalTRSCount} Total</td>
                        <td className="py-3 px-4 text-center text-slate-500">—</td>
                        <td className="py-3 px-4 text-center font-black text-sm text-emerald-700">
                          {activeMonths.length > 0 ? `${overallCombinedAvg}% YTD` : '—'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="text-[10px] font-black uppercase text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                            {overallCombinedAvg >= 80 ? 'Commendable+' : 'Standard'}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>

            {/* Mobile: modern stacked monthly cards (the wide table keeps its desktop layout) */}
            <div className="md:hidden p-3 sm:p-4 space-y-3">
              {monthlyBreakdown.map(item => {
                const combinedEmphasis = item.combined !== null && item.combined >= 80
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : item.combined !== null && item.combined >= 70
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200';
                return (
                  <div key={item.monthNum} className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                    <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-white min-w-0">
                        <Calendar className="w-4 h-4 text-indigo-300 shrink-0" />
                        <span className="text-sm font-bold truncate">{item.monthName} ({selectedYear})</span>
                      </div>
                      <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full border shrink-0 ${item.tierColor}`}>
                        {item.tierLabel}
                      </span>
                    </div>
                    <div className="p-4 grid grid-cols-2 gap-2.5">
                      <div className="bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">T&R Count</div>
                        <div className="mt-1 text-sm">
                          {item.trCount > 0 ? (
                            <span className="font-black text-blue-700">{item.trCount} reports</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Avg T&R Score</div>
                        <div className="mt-1 text-sm font-black">
                          {item.trAvg !== null ? (
                            <span className={item.trAvg >= 80 ? 'text-emerald-600' : item.trAvg >= 70 ? 'text-blue-600' : 'text-amber-600'}>
                              {item.trAvg}%
                            </span>
                          ) : (
                            <span className="text-slate-300">N/A</span>
                          )}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">TRS Deliverables</div>
                        <div className="mt-1 text-sm">
                          {item.trsCount > 0 ? (
                            <span className="font-black text-indigo-700">{item.trsCount} tasks</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Avg TRS Score</div>
                        <div className="mt-1 text-sm font-black">
                          {item.trsAvg !== null ? (
                            <span className={item.trsAvg >= 80 ? 'text-emerald-600' : item.trsAvg >= 70 ? 'text-blue-600' : 'text-amber-600'}>
                              {item.trsAvg}%
                            </span>
                          ) : (
                            <span className="text-slate-300">N/A</span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 bg-slate-50 rounded-xl px-3 py-3 border border-slate-200 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Combined Monthly Score</div>
                          <div className="mt-1 text-base font-black">
                            {item.combined !== null ? `${item.combined}%` : <span className="text-slate-300">No Data</span>}
                          </div>
                        </div>
                        <span className={`text-sm px-2.5 py-0.5 rounded-lg border ${combinedEmphasis}`}>
                          {item.combined !== null ? `${item.combined}%` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Mobile annual summary */}
              {(() => {
                const activeMonths = monthlyBreakdown.filter(m => m.combined !== null);
                const totalTRCount = monthlyBreakdown.reduce((sum, m) => sum + m.trCount, 0);
                const totalTRSCount = monthlyBreakdown.reduce((sum, m) => sum + m.trsCount, 0);
                const overallCombinedAvg = activeMonths.length > 0
                  ? Math.round(activeMonths.reduce((sum, m) => sum + (m.combined || 0), 0) / activeMonths.length)
                  : 0;
                return (
                  <div className="bg-white border-2 border-slate-200 rounded-2xl shadow-xs p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Annual Summary / Totals</div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-center border border-blue-100">
                        <div className="text-[10px] uppercase tracking-wide text-blue-500 font-bold">T&R Total</div>
                        <div className="mt-1 text-base font-black text-blue-700">{totalTRCount}</div>
                      </div>
                      <div className="bg-indigo-50 rounded-xl px-3 py-2.5 text-center border border-indigo-100">
                        <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-bold">TRS Total</div>
                        <div className="mt-1 text-base font-black text-indigo-700">{totalTRSCount}</div>
                      </div>
                      <div className="col-span-2 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl px-3 py-3 text-center text-white">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-100 font-bold">Combined YTD Average</div>
                        <div className="mt-1 text-lg font-black">
                          {activeMonths.length > 0 ? `${overallCombinedAvg}%` : '—'}
                        </div>
                        <span className="inline-block mt-1 text-[10px] font-black uppercase bg-white/20 px-2 py-0.5 rounded-full">
                          {overallCombinedAvg >= 80 ? 'Commendable+' : 'Standard'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: APPRAISAL E-SIGNATURES & WORKFLOW QUEUE */}
      {activeSubTab === 'approvals' && (
        <div className="space-y-6">
          {/* Section Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 text-[11px] font-bold">
                  Official E-Signature & Multi-Tier Approval System
                </span>
              </div>
              <h3 className="text-lg font-bold">Appraisal Sign-Off & Approval Workflow</h3>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                Supports Option 1 (Physical Print & Sign) and Option 2 (Digital E-Signature). Once signed by Department Superior/Manager, documents automatically route to Executive Management / HR for final approval.
              </p>
            </div>

          </div>

          {/* Status Filter Chips */}
          <div className="flex items-center justify-between gap-2 pb-1 flex-wrap">
            {/* Desktop / tablet: horizontal pill chips */}
            <div className="hidden md:flex items-center gap-1.5 overflow-x-auto">
              {['all', 'Pending Executive Approval', 'Fully Approved', 'Draft'].map(st => {
                const count =
                  st === 'all'
                    ? appraisalsList.length
                    : appraisalsList.filter(a => a.status === st).length;

                return (
                  <button
                    key={st}
                    onClick={() => setAppraisalFilterStatus(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      appraisalFilterStatus === st
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    <span>{st === 'all' ? 'All Records' : st}</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-800 text-[10px]">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Mobile: modern 2x2 segmented filter grid */}
            <div className="md:hidden w-full grid grid-cols-2 gap-2">
              {['all', 'Pending Executive Approval', 'Fully Approved', 'Draft'].map(st => {
                const count =
                  st === 'all'
                    ? appraisalsList.length
                    : appraisalsList.filter(a => a.status === st).length;
                const isActive = appraisalFilterStatus === st;

                return (
                  <button
                    key={st}
                    onClick={() => setAppraisalFilterStatus(st)}
                    className={`rounded-xl px-3 py-3 text-left transition-all ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-md'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-bold leading-tight ${isActive ? 'text-white' : 'text-slate-700'}`}>
                        {st === 'all' ? 'All Records' : st}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black shrink-0 ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-800'
                      }`}>
                        {count}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {isSuperior && (
              <div className="flex items-center gap-2 w-full md:w-auto">
                <ModernSelect
                  onChange={e => {
                    if (!e.target.value) return;
                    const u = allUsers.find(user => user.id === e.target.value);
                    if (u) {
                      handleOpenStaffAppraisal(u, 'digital');
                    }
                    e.target.value = '';
                  }}
                  defaultValue=""
                  className="w-full md:w-auto px-3 py-2.5 md:py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-900 shadow-2xs cursor-pointer transition-colors"
                >
                  <option value="" disabled>+ New Staff Appraisal...</option>
                  {allUsers
                    .filter(u => u.id !== currentUser.id && isAllowedUserAccess(u.id, u.department))
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.department} - {u.position})
                      </option>
                    ))}
                </ModernSelect>
              </div>
            )}
          </div>

          {/* Appraisals Grid List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(() => {
              const filteredList = appraisalsList.filter(a => {
                if (!isAllowedUserAccess(a.staffId, a.department)) return false;
                if (appraisalFilterStatus !== 'all' && a.status !== appraisalFilterStatus) return false;
                return true;
              });

              if (filteredList.length === 0) {
                return (
                  <div className="col-span-full bg-white border border-dashed border-slate-300 rounded-2xl p-12 text-center text-slate-400">
                    <FileBadge className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">No appraisal documents found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Appraisal documents for staff members will appear here for evaluation and digital/print sign-off.
                    </p>
                  </div>
                );
              }

              return filteredList.map(item => (
                <div
                  key={item.id}
                  className={`bg-white border border-slate-200 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all space-y-4 flex flex-col justify-between ${item.status === 'Draft' ? 'print:hidden' : ''}`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {item.period} ({item.year})
                        </span>
                        <h4 className="font-extrabold text-base text-slate-900">{item.staffName}</h4>
                        <p className="text-xs text-slate-500">
                          {item.position} • {item.department}
                        </p>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold shrink-0 ${
                          item.status === 'Fully Approved'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : item.status === 'Pending Executive Approval'
                            ? 'bg-amber-100 text-amber-900 border border-amber-200 animate-pulse'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>

                    {/* Score Badges */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
                      <div>
                        <span className="block text-[9px] font-bold text-slate-400 uppercase">T&R Score</span>
                        <span className="text-sm font-extrabold text-blue-600">{item.trScore}%</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-bold text-slate-400 uppercase">TRS Score</span>
                        <span className="text-sm font-extrabold text-emerald-600">{item.trsScore}%</span>
                      </div>
                      <div>
                        <span className="block text-[9px] font-bold text-slate-400 uppercase">Overall</span>
                        <span className="text-sm font-black text-slate-900">{item.overallScore}%</span>
                      </div>
                    </div>

                    {/* Workflow Progress Status */}
                    <div className="space-y-2 text-xs">
                      {/* Tier 1: Superior Sign-off */}
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-slate-600 font-medium">1. Department Superior / Manager:</span>
                        {item.preparedSignature ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Signed ({item.preparedByName})
                          </span>
                        ) : (
                          <span className="text-amber-600 font-bold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> Pending Sign
                          </span>
                        )}
                      </div>

                      {/* Tier 2: Executive Approval */}
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-slate-600 font-medium">2. Approved By (Exec / HR):</span>
                        {item.approvedSignature ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            Approved ({item.approvedByName})
                          </span>
                        ) : item.status === 'Pending Executive Approval' ? (
                          <span className="text-indigo-600 font-bold flex items-center gap-1">
                            <ArrowRight className="w-3.5 h-3.5 animate-bounce" /> Awaiting HR Approval
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Waiting Superior First</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => openAppraisalModal(item, 'digital')}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex-1 flex items-center justify-center gap-1.5 shadow-xs transition-all"
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Sign / View Digital
                    </button>

                    <button
                      onClick={() => openAppraisalModal(item, 'hard_copy')}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 border border-slate-200 transition-all"
                      title="Print hard copy for physical signature"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print
                    </button>

                    {isSuperior && (
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this appraisal document?')) {
                            deleteAppraisalRecord(item.id, currentUser);
                            loadAppraisals();
                          }
                        }}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-xl hover:text-rose-700 transition-colors"
                        title="Delete Appraisal"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* MODAL: STAFF EVALUATION & REPORT REVIEW */}
      {evaluatingStaffUser && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 relative my-8">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
                    {evaluatingStaffUser.name}
                    <span className="text-xs bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-bold">
                      {evaluatingStaffUser.role.toUpperCase()}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    {evaluatingStaffUser.position} • {evaluatingStaffUser.department} (@{evaluatingStaffUser.username})
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setEvaluatingStaffUser(null);
                  setEditingReportForReview(null);
                  setReviewMessage('');
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reviewMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {reviewMessage}
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600" />
                Submitted Reports for Evaluation
              </h4>

              {/* Monthly Deliverables Fulfillment Audit Section */}
              {(() => {
                const staffTemplate = getTemplateForPosition(evaluatingStaffUser.position, evaluatingStaffUser.department);
                // Yearly duties are audited per ANNUAL cycle: a 2026 cycle ends on
                // 31 Jan 2027, so the reports that can fulfil it are not confined
                // to reports whose `year` field is 2026.
                const yearlyTasks = staffTemplate?.items.filter(it => isYearlyCycle(it.category)) || [];
                const cycleKey = `${selectedYear}`;
                const cycleReports = reports.filter(
                  r =>
                    r.staffId === evaluatingStaffUser.id &&
                    getReportingYearlyCycleKey(r.startDate, r.weekNumber, r.year) === cycleKey
                );
                const monthlyTasks = staffTemplate?.items.filter(it => it.category === 'Monthly') || [];
                const userReports = reports.filter(r => r.staffId === evaluatingStaffUser.id && r.year === selectedYear);

                if (monthlyTasks.length === 0 && yearlyTasks.length === 0) return null;

                return (
                  <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-3.5 mb-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <Calendar className="w-4 h-4 text-purple-600" />
                        Monthly &amp; Year Task Deliverables Compliance Audit ({selectedYear})
                      </div>
                      <span className="text-[10px] font-bold text-purple-900 bg-white border border-purple-200 px-2.5 py-0.5 rounded-full">
                        {monthlyTasks.length} Monthly{yearlyTasks.length > 0 ? ` • ${yearlyTasks.length} Year Task` : ''} Registered
                      </span>
                    </div>

                    {yearlyTasks.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-wide text-orange-800">
                          Annual Cycle {cycleKey} (expires 31 Jan {selectedYear + 1})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {yearlyTasks.map(yTask => {
                            const doneReport = cycleReports.find(r =>
                              r.checklistItems?.some(it =>
                                (it.itemId === yTask.id || (it.title || '').trim().toLowerCase() === (yTask.title || '').trim().toLowerCase()) &&
                                (it.status === 'completed' || it.completed)
                              )
                            );

                            return (
                              <div key={yTask.id} className="p-2.5 bg-white rounded-lg border border-orange-100 text-xs space-y-2 shadow-2xs">
                                <div className="font-bold text-slate-800 flex items-center justify-between gap-1">
                                  <span className="truncate" title={yTask.title}>{yTask.title}</span>
                                  <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-black bg-orange-100 text-orange-800 shrink-0">
                                    Year Task
                                  </span>
                                </div>

                                {cycleReports.length === 0 ? (
                                  <span className="text-[10px] text-slate-400 italic">No reports in this annual cycle yet</span>
                                ) : doneReport ? (
                                  <div className="flex items-center justify-between text-[11px] bg-slate-50 p-1.5 rounded border border-slate-100">
                                    <span className="font-semibold text-slate-600">Cycle {cycleKey}:</span>
                                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      Fulfilled in W{doneReport.weekNumber} {doneReport.year}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between text-[11px] bg-slate-50 p-1.5 rounded border border-slate-100">
                                    <span className="font-semibold text-slate-600">Cycle {cycleKey}:</span>
                                    <span className="font-bold text-amber-700 flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                                      Not Fulfilled
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {monthlyTasks.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      {monthlyTasks.map(mTask => {
                        const activeMonths = Array.from(new Set(userReports.map(r => r.month))).sort((a, b) => a - b);

                        return (
                          <div key={mTask.id} className="p-2.5 bg-white rounded-lg border border-purple-100 text-xs space-y-2 shadow-2xs">
                            <div className="font-bold text-slate-800 flex items-center justify-between gap-1">
                              <span className="truncate" title={mTask.title}>{mTask.title}</span>
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded font-black bg-purple-100 text-purple-800 shrink-0">
                                Monthly
                              </span>
                            </div>

                            {activeMonths.length === 0 ? (
                              <span className="text-[10px] text-slate-400 italic">No monthly reports recorded yet</span>
                            ) : (
                              <div className="space-y-1">
                                {activeMonths.map(mNum => {
                                  const mName = MONTH_NAMES[mNum - 1] || `Month ${mNum}`;
                                  const monthWeeks = getWeeksForMonth(mNum, selectedYear);
                                  const repsInMonth = userReports.filter(r => monthWeeks.includes(r.weekNumber));
                                  const doneReport = repsInMonth.find(r =>
                                    r.checklistItems?.some(it =>
                                      (it.itemId === mTask.id || it.title.trim().toLowerCase() === mTask.title.trim().toLowerCase()) &&
                                      (it.status === 'completed' || it.completed)
                                    )
                                  );

                                  return (
                                    <div key={mNum} className="flex items-center justify-between text-[11px] bg-slate-50 p-1.5 rounded border border-slate-100">
                                      <span className="font-semibold text-slate-600">{mName}:</span>
                                      {doneReport ? (
                                        <span className="font-bold text-emerald-700 flex items-center gap-1">
                                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                          Fulfilled in W{doneReport.weekNumber}
                                        </span>
                                      ) : (
                                        <span className="font-bold text-amber-700 flex items-center gap-1">
                                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                                          Missed / All N/A
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                );
              })()}

              {(() => {
                const userReports = reports.filter(r => r.staffId === evaluatingStaffUser.id);
                if (userReports.length === 0) {
                  return (
                    <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs">
                      No submitted reports found for {evaluatingStaffUser.name} yet.
                    </div>
                  );
                }

                return (
                  <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                    {userReports.map(rep => {
                      const isEditingThis = editingReportForReview?.id === rep.id;

                      return (
                        <div
                          key={rep.id}
                          className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 transition-all hover:border-slate-300"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 pb-2.5">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-900">
                                  Week {rep.weekNumber}, {rep.year}
                                </span>
                                <span className="text-xs text-slate-500 font-medium">
                                  ({formatDateRange(rep.startDate, rep.endDate, rep.weekNumber, rep.year).formattedRange})
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                Submitted on: {new Date(rep.submissionDate).toLocaleDateString()}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                                  rep.status === 'Approved'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : rep.status === 'Reviewed'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}
                              >
                                {rep.status === 'Approved' && <Check className="w-3 h-3" />}
                                Status: {rep.status || 'Submitted'}
                              </span>

                              <span className="font-black text-xs text-blue-700 bg-white border border-blue-200 px-2.5 py-1 rounded-lg">
                                Score: {rep.trScore}%
                              </span>

                              {isSuperior && (
                                <button
                                  onClick={() => {
                                    if (isEditingThis) {
                                      setEditingReportForReview(null);
                                    } else {
                                      setEditingReportForReview(rep);
                                      setReviewStatus((rep.status as any) || 'Submitted');
                                      setReviewFeedback(rep.managerFeedback || '');
                                    }
                                  }}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-xs"
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  {isEditingThis ? 'Close Form' : 'Sign Off / Review'}
                                </button>
                              )}
                            </div>
                          </div>

                          {isEditingThis && (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                if (reviewSaving) return;
                                setReviewSaving(true);
                                try {
                                  const updated: WeeklyReport = {
                                    ...rep,
                                    status: reviewStatus,
                                    managerFeedback: reviewFeedback,
                                    reviewDate: new Date().toISOString()
                                  };
                                  await saveReport(updated, currentUser, 'superior');
                                  setEditingReportForReview(null);
                                  setReviewMessage(`Report for Week ${rep.weekNumber} updated to "${reviewStatus}"!`);
                                  setTimeout(() => setReviewMessage(''), 4000);
                                } catch (err: any) {
                                  showDialog(err?.message || 'Failed to save the review. Please try again.');
                                } finally {
                                  setReviewSaving(false);
                                }
                              }}
                              className="bg-white p-3.5 rounded-xl border border-emerald-300 shadow-xs space-y-3"
                            >
                              <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                                <UserCheck className="w-4 h-4 text-emerald-600" />
                                Update Review Status & Manager Sign-Off
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                    Official Review Status
                                  </label>
                                  <ModernSelect
                                    value={reviewStatus}
                                    onChange={e => setReviewStatus(e.target.value as any)}
                                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 font-bold"
                                  >
                                    <option value="Submitted">Submitted (Pending Review)</option>
                                    <option value="Reviewed">Reviewed (Feedback Added)</option>
                                    <option value="Approved">Approved (Official Sign Off)</option>
                                  </ModernSelect>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                    Manager Feedback / Comments
                                  </label>
                                  <textarea
                                    value={reviewFeedback}
                                    onChange={e => setReviewFeedback(e.target.value)}
                                    placeholder="Add evaluation comments or guidance for staff..."
                                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900 h-16 resize-none"
                                  />
                                </div>
                              </div>

                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingReportForReview(null)}
                                  className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-semibold"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={reviewSaving}
                                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5"
                                >
                                  {reviewSaving ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Send className="w-3.5 h-3.5" />
                                  )}
                                  {reviewSaving ? 'Saving…' : 'Save Status & Sign Off'}
                                </button>
                              </div>
                            </form>
                          )}

                          {rep.managerFeedback && !isEditingThis && (
                            <div className="bg-emerald-50/80 border border-emerald-200 rounded-lg p-2.5 text-xs text-slate-800">
                              <span className="font-bold text-emerald-900 block mb-0.5">
                                Manager Feedback ({rep.status}):
                              </span>
                              <p className="italic text-slate-700">"{rep.managerFeedback}"</p>
                            </div>
                          )}

                          <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-3">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                                Checklist Items ({rep.checklistItems.filter(i => (i.status ? i.status === 'completed' : i.completed)).length} / {rep.checklistItems.filter(i => (i.status ? i.status !== 'na' : true)).length} Completed)
                              </span>
                              <span className="text-xs font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                                T&R Score: {rep.trScore}%
                              </span>
                            </div>

                            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                              {rep.checklistItems.map((item, idx) => {
                                const itemStatus = item.status || (item.completed ? 'completed' : 'incomplete');
                                return (
                                  <div
                                    key={item.itemId || idx}
                                    className={`p-2.5 rounded-lg border text-xs flex items-start justify-between gap-3 ${
                                      itemStatus === 'completed'
                                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950 font-medium'
                                        : itemStatus === 'na'
                                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                                        : 'bg-rose-50/40 border-rose-200 text-rose-950'
                                    }`}
                                  >
                                    <div className="flex items-start gap-2">
                                      {itemStatus === 'completed' ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                                      ) : itemStatus === 'na' ? (
                                        <MinusCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                                      ) : (
                                        <XCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                                      )}
                                      <div>
                                        <span className={`font-semibold ${itemStatus === 'completed' ? 'text-slate-900' : itemStatus === 'na' ? 'text-slate-500 italic' : 'text-slate-700'}`}>
                                          {item.title}
                                        </span>
                                        {item.note && (
                                          <p className="text-[11px] text-slate-500 italic mt-0.5">
                                            Note: "{item.note}"
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {itemStatus === 'na' && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                                          N/A (Exempt)
                                        </span>
                                      )}
                                      <span
                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${frequencyBadgeClassFlat(item.category)}`}
                                        title={frequencyRuleHint(item.category)}
                                      >
                                        {item.category}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {rep.notes && (
                              <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-slate-800">
                                <span className="font-bold text-blue-900 block mb-0.5">Staff Notes / Remarks:</span>
                                <p className="text-slate-700 whitespace-pre-wrap">{rep.notes}</p>
                              </div>
                            )}

                            {rep.aiSummary && (
                              <div className="p-2.5 bg-purple-50/80 border border-purple-200 rounded-lg text-xs text-purple-950">
                                <span className="font-bold text-purple-900 flex items-center gap-1 mb-0.5">
                                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                                  AI Summary:
                                </span>
                                <p className="text-purple-900 italic">{rep.aiSummary}</p>
                              </div>
                            )}

                            {rep.signature && (
                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                                <div className="flex items-center gap-2">
                                  <PenTool className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Signed by <strong>{rep.signature.signeeName}</strong> on {new Date(rep.signature.signedAt).toLocaleDateString()}</span>
                                </div>
                                {rep.signature.dataUrl && (
                                  <SignatureImage
                                    src={rep.signature.dataUrl}
                                    alt="Staff Signature"
                                    className="h-8 max-w-[120px] object-contain bg-slate-50 border border-slate-200 rounded p-1"
                                    fallbackText=""
                                    fallbackClassName="h-8"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  const target = evaluatingStaffUser;
                  setEvaluatingStaffUser(null);
                  handleOpenStaffAppraisal(target, 'digital');
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
              >
                <PenTool className="w-3.5 h-3.5" />
                Appraisal Form (Option 1 / Option 2)
              </button>

              <button
                onClick={() => {
                  setEvaluatingStaffUser(null);
                  setEditingReportForReview(null);
                  setReviewMessage('');
                }}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL PRINTABLE & DIGITAL APPRAISAL DOCUMENT MODAL */}
      {showPrintModal && (() => {
        const activeSignees = activeAppraisal
          ? resolveAppraisalSignees(activeAppraisal.staffName, activeAppraisal.department)
          : null;

        return (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 overflow-y-auto printable-overlay">
          <div className="relative bg-white rounded-2xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl printable-document space-y-6 max-h-[90vh] overflow-y-auto thin-scrollbar">
            {/* Close Button - Top Right */}
            <button
              onClick={() => setShowPrintModal(false)}
              className="absolute top-4 right-4 z-10 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Controls Bar (Hidden in Print Mode) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end border-b border-slate-200 pb-4 gap-3 no-print print:hidden pr-10">

              {/* Mode Switcher: Option 1 vs Option 2 (Only show when evaluating/viewing an individual staff appraisal document) */}
              <div className="flex items-center gap-2 flex-wrap">
                {activeAppraisal && (
                  <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => setAppraisalSignMode('hard_copy')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        appraisalSignMode === 'hard_copy'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Option 1: Physical Print & Hard Sign
                    </button>

                    <button
                      onClick={() => setAppraisalSignMode('digital')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        appraisalSignMode === 'digital'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Option 2: Digital E-Signature Workflow
                    </button>
                  </div>
                )}

                <button
                  onClick={handleTriggerPrint}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                  title="Print Document"
                >
                  <Printer className="w-4 h-4" /> Print Document
                </button>

              </div>
            </div>

            {/* DOCUMENT CONTENT */}
            <div className="space-y-6 font-sans">
              {/* Document Title */}
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-slate-900 uppercase tracking-wide">
                  {activeAppraisal ? 'Official Staff Performance Appraisal Document' : 'Department Performance Score Matrix Summary'}
                </h2>
                <p className="text-sm text-slate-600">
                  {activeAppraisal ? `${activeAppraisal.staffName} (${activeAppraisal.period})` : `Department: ${selectedDept === 'all' ? 'All Departments' : selectedDept} • Year: ${selectedYear}`}
                </p>
              </div>

              {/* Header */}
              <div className="border-b-2 border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">
                    APA {import.meta.env.VITE_APP ?? '1'} Staff Evaluation & Performance Appraisal
                  </h1>
                  <p className="text-xs text-slate-600 font-medium mt-0.5">
                    Centralized T&R Weekly Checklist & TRS Superior Report Performance Document
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-slate-800">
                    Department: <span className="text-blue-700">{activeAppraisal ? activeAppraisal.department : selectedDept === 'all' ? 'All Departments' : selectedDept}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Period: {activeAppraisal ? activeAppraisal.period : `${selectedYear} (${selectedQuarter === 'all' ? 'Full Year' : selectedQuarter})`}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Document Ref: #{activeAppraisal ? activeAppraisal.id : `MATRIX-${Date.now()}`}
                  </div>
                </div>
              </div>

              {/* Individual Target Staff Info (If Active Appraisal Record Selected) */}
              {activeAppraisal && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Employee Name</span>
                    <span className="text-sm font-extrabold text-slate-900">{activeAppraisal.staffName}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Position Title</span>
                    <span className="text-xs font-bold text-slate-700">{activeAppraisal.position}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Department</span>
                    <span className="text-xs font-bold text-slate-700">{activeAppraisal.department}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Overall Evaluation Grade</span>
                    <span className="text-sm font-black text-indigo-700">{activeAppraisal.overallScore}% ({activeAppraisal.overallScore >= 90 ? 'Grade A: Exceeds Target' : activeAppraisal.overallScore >= 75 ? 'Grade B: Satisfactory' : 'Grade C: Action Needed'})</span>
                  </div>
                </div>
              )}

              {/* Department High-Level Summary (If viewing overall matrix) */}
              {!activeAppraisal && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-center">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Department T&R Average</span>
                    <span className="text-xl font-black text-blue-700">{avgTRScore}%</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Department TRS Superior Score</span>
                    <span className="text-xl font-black text-emerald-700">{avgTRSScore}%</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-500 uppercase">Overall Appraisal Score</span>
                    <span className="text-xl font-black text-slate-900">{overallEvaluationScore}%</span>
                  </div>
                </div>
              )}

              {/* Score Matrix Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Performance Metric Score Matrix
                </h4>
                <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-slate-200 text-xs min-w-[640px]">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
                      <th className="p-2 border-r border-slate-200">Staff Member</th>
                      <th className="p-2 border-r border-slate-200">Position & Dept</th>
                      <th className="p-2 border-r border-slate-200 text-center">T&R Score %</th>
                      <th className="p-2 border-r border-slate-200 text-center">TRS Score %</th>
                      <th className="p-2 border-r border-slate-200 text-center">Overall %</th>
                      <th className="p-2 text-center">Evaluation Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAppraisal ? (
                      <tr className="border-b border-slate-200">
                        <td className="p-2.5 border-r border-slate-200 font-bold text-slate-900">{activeAppraisal.staffName}</td>
                        <td className="p-2.5 border-r border-slate-200 text-slate-600">{activeAppraisal.position} ({activeAppraisal.department})</td>
                        <td className="p-2.5 border-r border-slate-200 text-center font-bold text-blue-700">{activeAppraisal.trScore}%</td>
                        <td className="p-2.5 border-r border-slate-200 text-center font-bold text-emerald-700">{activeAppraisal.trsScore}%</td>
                        <td className="p-2.5 border-r border-slate-200 text-center font-extrabold text-slate-900">{activeAppraisal.overallScore}%</td>
                        <td className="p-2.5 text-center font-bold text-slate-800">{activeAppraisal.overallScore >= 90 ? 'Outstanding' : activeAppraisal.overallScore >= 75 ? 'Satisfactory' : 'Needs Action'}</td>
                      </tr>
                    ) : (
                      staffList.map(item => {
                        const agg = rowAgg.get(item.user.id)!;
                        const hasTrsTasksAssigned = agg.hasTrsTasksAssigned;
                        const completedTrs = agg.completedCount;
                        const userTrs = agg.assignedCount;
                        const trAvg = agg.trAvg;
                        const trsAvg = agg.trsAvg;
                        const combined = agg.combined;
                        const grade = combined >= 90 ? 'Outstanding' : combined >= 75 ? 'Satisfactory' : 'Needs Review';

                        return (
                          <tr key={item.user.id} className="border-b border-slate-200">
                            <td className="p-2 border-r border-slate-200 font-bold text-slate-900">{item.user.name}</td>
                            <td className="p-2 border-r border-slate-200 text-slate-600">{item.user.position} ({item.user.department})</td>
                            <td className="p-2 border-r border-slate-200 text-center font-bold text-blue-700">{trAvg}%</td>
                            <td className="p-2 border-r border-slate-200 text-center font-bold text-emerald-700">
                              {completedTrs > 0 ? `${trsAvg}%` : hasTrsTasksAssigned ? '0% (Pending)' : '— (No TRS Reports)'}
                            </td>
                            <td className="p-2 border-r border-slate-200 text-center font-extrabold text-slate-900">{combined}%</td>
                            <td className="p-2 text-center font-semibold text-slate-700">{grade}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>

              {/* SIGNATURE SECTION */}

              {/* A. DEPARTMENT SCORE MATRIX SUMMARY SIGNATURE SECTION (When viewing matrix summary, not an individual staff document) */}
              {!activeAppraisal && (
                <div className="pt-6 border-t border-slate-200 space-y-4">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs text-slate-700 no-print">
                    <div className="flex items-center gap-2 font-medium">
                      <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                      <span><strong>Department Score Matrix Summary.</strong> Consolidated evaluation overview for department record and executive sign-off.</span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium">Click "Print Document" at top right to print</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs text-slate-700 pt-2">
                    <div className="space-y-12">
                      <div>
                        <span className="font-bold text-slate-900 block">Prepared / Verified By:</span>
                        <span className="font-bold text-slate-800 block text-xs mt-1">
                          Department Superior / Manager
                        </span>
                        <span className="text-slate-500 italic block mt-0.5 text-[11px]">
                          Department Superior
                        </span>
                      </div>
                      <div className="border-t border-slate-400 pt-1 flex justify-between font-semibold">
                        <span>Physical Signature & Date: ___________________</span>
                      </div>
                    </div>
                    <div className="space-y-12">
                      <div>
                        <span className="font-bold text-slate-900 block">Acknowledged & Approved By:</span>
                        <span className="font-bold text-slate-800 block text-xs mt-1">
                          Human Resources / Executive Management
                        </span>
                        <span className="text-slate-500 italic block mt-0.5 text-[11px]">
                          Executive Office / HR
                        </span>
                      </div>
                      <div className="border-t border-slate-400 pt-1 flex justify-between font-semibold">
                        <span>Physical Signature & Date: ___________________</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* B. OPTION 1: PHYSICAL PRINT & HARD COPY SIGNATURE BLOCKS (When viewing individual staff appraisal) */}
              {activeAppraisal && appraisalSignMode === 'hard_copy' && (
                <div className="pt-6 border-t border-slate-200 space-y-4">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-xs text-blue-900 no-print">
                    <div className="flex items-center gap-2 font-medium">
                      <Printer className="w-4 h-4 text-blue-600 shrink-0" />
                      <span><strong>Option 1 (Physical Sign):</strong> Ready to print. Click the <strong>Print Document</strong> button at top right to print out this appraisal for handwritten signatures.</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs text-slate-700 pt-2">
                    <div className="space-y-12">
                      <div>
                        <span className="font-bold text-slate-900 block">Prepared / Evaluated By:</span>
                        <span className="font-bold text-slate-800 block text-xs mt-1">
                          {activeSignees ? activeSignees.superiorName : 'Department Superior / Manager'}
                        </span>
                        <span className="text-slate-500 italic block mt-0.5 text-[11px]">
                          {activeSignees ? activeSignees.superiorRole : 'Department Superior'}
                        </span>
                      </div>
                      <div className="border-t border-slate-400 pt-1 flex justify-between font-semibold">
                        <span>Physical Signature & Date: ___________________</span>
                      </div>
                    </div>
                    <div className="space-y-12">
                      <div>
                        <span className="font-bold text-slate-900 block">Acknowledged By:</span>
                        <span className="font-bold text-slate-800 block text-xs mt-1">
                          {activeSignees ? activeSignees.hrName : 'Human Resources / Executive'}
                        </span>
                        <span className="text-slate-500 italic block mt-0.5 text-[11px]">
                          {activeSignees ? activeSignees.hrRole : 'Human Resources'}
                        </span>
                      </div>
                      <div className="border-t border-slate-400 pt-1 flex justify-between font-semibold">
                        <span>Physical Signature & Date: ___________________</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* OPTION 2: INTERACTIVE DIGITAL E-SIGNATURE & AUTOMATED WORKFLOW */}
              {appraisalSignMode === 'digital' && activeAppraisal && (
                <div className="pt-6 border-t border-slate-200 space-y-6">
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between text-xs text-indigo-900 no-print">
                    <div className="flex items-center gap-2 font-medium">
                      <PenTool className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span><strong>Option 2 Selected: Approve Digital.</strong> Sign digitally with handsign, upload image, or select saved profile signature for 1-click reuse.</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs uppercase tracking-wider">
                    <PenTool className="w-4 h-4 text-indigo-600" />
                    Option 2: Multi-Tier Digital E-Signature Verification & Automated Workflow
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* TIER 1: Prepared / Evaluated By (Department Superior / Manager) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <div>
                          <span className="font-bold text-xs text-slate-900 block">1. Prepared / Evaluated By:</span>
                          <span className="text-[11px] text-slate-800 font-bold block mt-0.5">
                            {activeSignees ? activeSignees.superiorName : 'Department Superior'}
                          </span>
                          <span className="text-[10px] text-slate-500 italic">
                            {activeSignees ? activeSignees.superiorRole : 'Department Superior / Manager'}
                          </span>
                        </div>
                        {activeAppraisal.preparedSignature ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Signed
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                            Pending Superior Sign
                          </span>
                        )}
                      </div>

                      {/* Display Signed Details or Interactive Form */}
                      {activeAppraisal.preparedSignature ? (
                        <div className="space-y-2 text-xs">
                          <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900">{activeAppraisal.preparedByName}</span>
                              <span className="text-[10px] text-slate-400">{activeAppraisal.preparedDate}</span>
                            </div>
                            {activeAppraisal.preparedSignature.dataUrl && (
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                {activeAppraisal.preparedSignature.type === 'handwritten' || activeAppraisal.preparedSignature.type === 'uploaded' ? (
                                  <img
                                    src={activeAppraisal.preparedSignature.dataUrl}
                                    alt="Superior Signature"
                                    className="h-12 mx-auto object-contain"
                                  />
                                ) : (
                                  <span className="font-serif italic text-indigo-900 text-sm font-bold">
                                    {activeAppraisal.preparedSignature.dataUrl}
                                  </span>
                                )}
                              </div>
                            )}
                            {activeAppraisal.preparedNotes && (
                              <p className="text-[11px] text-slate-600 italic bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                                Notes: "{activeAppraisal.preparedNotes}"
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {isSuperior ? (
                            <div className="space-y-3">
                              <div>
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">Fill Evaluation Date</label>
                                <input
                                  type="date"
                                  value={preparedDate}
                                  onChange={e => setPreparedDate(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-semibold bg-white"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">Superior Evaluation Notes</label>
                                <textarea
                                  value={preparedNotes}
                                  onChange={e => setPreparedNotes(e.target.value)}
                                  placeholder="Add evaluation remarks or feedback..."
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white h-16 resize-none"
                                />
                              </div>

                              <SignatureCanvas
                                ref={preparedSigCanvasRef}
                                signeeName={currentUser.name}
                                userId={currentUser.id}
                                onSaveSignature={sig => setPreparedSig(sig)}
                                existingSignature={preparedSig}
                              />

                              {hasUserPermission(currentUser, 'evaluatePerformance') && (
                                <button
                                  onClick={() => handleManagerSubmitSign(activeAppraisal)}
                                  disabled={managerSigning}
                                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center gap-2 transition-all"
                                >
                                  {managerSigning ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Send className="w-4 h-4" />
                                  )}
                                  {managerSigning ? 'Signing…' : 'Sign & Forward to Acknowledged By (HR / Executive)'}
                                </button>
                              )}
                              {!hasUserPermission(currentUser, 'evaluatePerformance') && (
                                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-600">
                                  <Lock className="w-4 h-4 mx-auto mb-1 text-slate-400" />
                                  Only your direct superior can sign this appraisal
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-4 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500 italic">
                              Awaiting Department Superior / Manager to evaluate and sign digitally.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* TIER 2: Acknowledged By (Human Resources / Executive) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <div>
                          <span className="font-bold text-xs text-slate-900 block">2. Acknowledged By:</span>
                          <span className="text-[11px] text-slate-800 font-bold block mt-0.5">
                            {activeSignees ? activeSignees.hrName : 'Human Resources'}
                          </span>
                          <span className="text-[10px] text-slate-500 italic">
                            {activeSignees ? activeSignees.hrRole : 'Human Resources / Executive'}
                          </span>
                        </div>
                        {activeAppraisal.approvedSignature ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Fully Acknowledged
                          </span>
                        ) : activeAppraisal.status === 'Pending Executive Approval' ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-extrabold">
                            Ready for HR Acknowledgment
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-medium">
                            Waiting Tier 1 First
                          </span>
                        )}
                      </div>

                      {/* Display Approved Details or Executive Form */}
                      {activeAppraisal.approvedSignature ? (
                        <div className="space-y-2 text-xs">
                          <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-xs space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900">{activeAppraisal.approvedByName}</span>
                              <span className="text-[10px] text-slate-400">{activeAppraisal.approvedDate}</span>
                            </div>
                            {activeAppraisal.approvedSignature.dataUrl && (
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                {activeAppraisal.approvedSignature.type === 'handwritten' || activeAppraisal.approvedSignature.type === 'uploaded' ? (
                                  <img
                                    src={activeAppraisal.approvedSignature.dataUrl}
                                    alt="Executive Signature"
                                    className="h-12 mx-auto object-contain"
                                  />
                                ) : (
                                  <span className="font-serif italic text-indigo-900 text-sm font-bold">
                                    {activeAppraisal.approvedSignature.dataUrl}
                                  </span>
                                )}
                              </div>
                            )}
                            {activeAppraisal.approvedNotes && (
                              <p className="text-[11px] text-slate-600 italic bg-emerald-50/50 p-2 rounded-lg border border-emerald-100">
                                Acknowledgment Notes: "{activeAppraisal.approvedNotes}"
                              </p>
                            )}
                          </div>
                        </div>
                      ) : activeAppraisal.status === 'Pending Executive Approval' ? (
                        <div className="space-y-3">
                          {['admin', 'executive', 'hr'].includes(currentUser.role) ? (
                            <div className="space-y-3">
                              <div>
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">Acknowledgment Date</label>
                                <input
                                  type="date"
                                  value={approvedDate}
                                  onChange={e => setApprovedDate(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-semibold bg-white"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">HR Acknowledgment Notes</label>
                                <textarea
                                  value={approvedNotes}
                                  onChange={e => setApprovedNotes(e.target.value)}
                                  placeholder="Add HR acknowledgment remarks..."
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white h-16 resize-none"
                                />
                              </div>

                              <SignatureCanvas
                                ref={approvedSigCanvasRef}
                                signeeName={currentUser.name}
                                userId={currentUser.id}
                                onSaveSignature={sig => setApprovedSig(sig)}
                                existingSignature={approvedSig}
                              />

                              {hasUserPermission(currentUser, 'approveAppraisals') && (
                                <button
                                  onClick={() => handleExecutiveApproveSign(activeAppraisal)}
                                  disabled={execSigning}
                                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center gap-2 transition-all"
                                >
                                  {execSigning ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <ShieldCheck className="w-4 h-4" />
                                  )}
                                  {execSigning ? 'Acknowledging…' : 'Complete HR Acknowledgment & Sign'}
                                </button>
                              )}
                              {!hasUserPermission(currentUser, 'approveAppraisals') && (
                                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-600">
                                  <Lock className="w-4 h-4 mx-auto mb-1 text-slate-400" />
                                  approveAppraisals permission required to approve
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-center text-xs text-amber-900 font-medium">
                              Document is currently awaiting Human Resources / Executive sign-off.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-4 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-400 italic">
                          Awaiting Department Superior / Manager evaluation signature first before routing to HR.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};
