import React, { useState, useEffect } from 'react';
import {
  FileText,
  Clock,
  Award,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  ShieldCheck,
  X,
  HelpCircle,
  Calendar,
  Layers,
  Info,
  CheckSquare,
  Calculator,
  UserCheck,
  ClipboardCheck
} from 'lucide-react';

interface PolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'jd' | 'tr' | 'trs' | 'unlocks';
}

/** Compact label/number chip used by the mobile card layouts. Module scope so it is
 *  not re-created (and re-mounted) on every PolicyModal render. */
const StatChip: React.FC<{ label: string; value: string | number; active?: boolean }> = ({ label, value, active }) => (
  <div className={`flex-1 min-w-0 rounded-lg py-1.5 px-1 text-center border ${active ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200'}`}>
    <div className={`text-[13px] font-extrabold leading-none ${active ? 'text-slate-800' : 'text-slate-400'}`}>{value}</div>
    <div className={`text-[8px] font-bold uppercase tracking-wide mt-1 leading-none truncate ${active ? 'text-slate-500' : 'text-slate-300'}`}>{label}</div>
  </div>
);

export const PolicyModal: React.FC<PolicyModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'jd'
}) => {
  const [activeTab, setActiveTab] = useState<'jd' | 'tr' | 'trs' | 'unlocks'>(defaultTab);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const PILLAR1_EXAMPLES = [
    { label: 'All 5 DONE',                                done: 5, na: 0, locked: 0, applicable: 5, score: '50 / 50', delta: 'Full',    scoreCls: 'text-emerald-700', deltaCls: 'text-emerald-700', labelCls: 'text-emerald-800',  accent: 'bg-emerald-50/40 border-emerald-200', muted: false },
    { label: '1 NOT DONE',                                done: 4, na: 0, locked: 0, applicable: 5, score: '40 / 50', delta: '-10',    scoreCls: 'text-blue-700',    deltaCls: 'text-rose-600',    labelCls: 'text-rose-700',     accent: 'bg-white border-slate-200', muted: false },
    { label: '2 NOT DONE',                                done: 3, na: 0, locked: 0, applicable: 5, score: '30 / 50', delta: '-20',    scoreCls: 'text-amber-700',   deltaCls: 'text-rose-600',    labelCls: 'text-rose-700',     accent: 'bg-white border-slate-200', muted: false },
    { label: '3 NOT DONE',                                done: 2, na: 0, locked: 0, applicable: 5, score: '20 / 50', delta: '-30',    scoreCls: 'text-orange-700',  deltaCls: 'text-rose-600',    labelCls: 'text-rose-700',     accent: 'bg-white border-slate-200', muted: false },
    { label: '4 NOT DONE',                                done: 1, na: 0, locked: 0, applicable: 5, score: '10 / 50', delta: '-40',    scoreCls: 'text-orange-700',  deltaCls: 'text-rose-600',    labelCls: 'text-rose-700',     accent: 'bg-white border-slate-200', muted: false },
    { label: 'All 5 NOT DONE',                            done: 0, na: 0, locked: 0, applicable: 5, score: '0 / 50',  delta: '-50',    scoreCls: 'text-rose-700',    deltaCls: 'text-rose-600',    labelCls: 'text-rose-800',     accent: 'bg-white border-slate-200', muted: true },
    { label: '3 DONE, 1 N/A, 1 LOCKED',                   done: 3, na: 1, locked: 1, applicable: 3, score: '50 / 50', delta: 'No cut', scoreCls: 'text-emerald-700', deltaCls: 'text-blue-700',     labelCls: 'text-blue-900',     accent: 'bg-blue-50/50 border-blue-200', muted: false },
    { label: '2 DONE, 1 N/A, 1 LOCKED, 1 NOT DONE',       done: 2, na: 1, locked: 1, applicable: 3, score: '33 / 50', delta: '-17',    scoreCls: 'text-blue-700',    deltaCls: 'text-rose-600',    labelCls: 'text-blue-900',     accent: 'bg-blue-50/50 border-blue-200', muted: false },
  ];

  const PILLAR2_ROWS = [
    { timing: 'On-Time (≤ Monday 11:30 AM or Approved Extension)', score: '20 / 20 pts', penalty: 'None (Full Score)', max: 'Up to 100%', scoreCls: 'text-emerald-700', penaltyCls: 'text-slate-500',   maxCls: 'text-emerald-700', timingCls: 'text-emerald-800', accent: 'bg-emerald-50/40 border-emerald-200', icon: null },
    { timing: '1 Day Late (Tuesday)',                             score: '15 / 20 pts', penalty: '-5 pts',           max: 'Up to 95%',  scoreCls: 'text-blue-700',    penaltyCls: 'text-rose-600',    maxCls: 'text-slate-700',   timingCls: 'text-slate-800',   accent: 'bg-white border-slate-200', icon: null },
    { timing: '2 to 3 Days Late (Wednesday – Thursday)',           score: '10 / 20 pts', penalty: '-10 pts',          max: 'Up to 90%',  scoreCls: 'text-amber-700',   penaltyCls: 'text-rose-600',    maxCls: 'text-slate-700',   timingCls: 'text-slate-800',   accent: 'bg-white border-slate-200', icon: null },
    { timing: '4 to 5 Days Late (Friday – Saturday)',             score: '5 / 20 pts',  penalty: '-15 pts',          max: 'Up to 85%',  scoreCls: 'text-orange-700',  penaltyCls: 'text-rose-600',    maxCls: 'text-slate-700',   timingCls: 'text-slate-800',   accent: 'bg-white border-slate-200', icon: null },
    { timing: '> 5 Days Late (Sunday onwards)',                    score: '0 / 20 pts',  penalty: '-20 pts',          max: 'Up to 80%',  scoreCls: 'text-rose-700',    penaltyCls: 'text-rose-600',    maxCls: 'text-slate-700',   timingCls: 'text-rose-800',    accent: 'bg-white border-slate-200', icon: null },
    { timing: '> 7 Days Past Deadline (Unsubmitted / Abandoned)', score: '0 / 100 pts', penalty: 'Defaulted (0%)',   max: '0% Flat Zero', scoreCls: 'text-rose-700',  penaltyCls: 'text-rose-700',    maxCls: 'text-rose-700',    timingCls: 'text-rose-900',    accent: 'bg-rose-50/70 border-rose-200', icon: 'lock' },
  ];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto overscroll-contain animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] sm:max-h-[90vh] sm:my-auto flex flex-col overflow-hidden animate-in fade-in sm:zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-4 py-3.5 sm:px-5 sm:py-4 bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white flex items-start sm:items-center justify-between gap-2 shrink-0">
          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/10 backdrop-blur-xs border border-white/20 flex items-center justify-center text-white shrink-0 shadow-xs">
              <FileText className="w-5 h-5 text-blue-200" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm sm:text-base text-white tracking-wide">
                  APA Scoring & Submission Policy
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-100 text-[10px] font-black uppercase tracking-wider border border-white/20">
                  Official Standard
                </span>
              </div>
              <p className="hidden sm:block text-xs text-blue-100/80 mt-0.5">
                Transparent rules, evaluation rubrics, late decay scales, and auto-lock criteria
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 -m-1 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer shrink-0"
            title="Close Policy Handbook"
            aria-label="Close policy handbook"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-2 sm:px-4 pt-2 gap-1.5 sm:gap-2 overflow-x-auto thin-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('jd')}
            className={`py-2 px-2.5 sm:px-3 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 border-t border-x shrink-0 whitespace-nowrap ${
              activeTab === 'jd'
                ? 'bg-white border-slate-200 text-blue-700 -mb-px shadow-2xs font-black'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="sm:hidden">1. JD</span>
            <span className="hidden sm:inline">1. JD Policy &amp; Governance</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tr')}
            className={`py-2 px-2.5 sm:px-3 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 border-t border-x shrink-0 whitespace-nowrap ${
              activeTab === 'tr'
                ? 'bg-white border-slate-200 text-indigo-700 -mb-px shadow-2xs font-black'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="sm:hidden">2. T&amp;R</span>
            <span className="hidden sm:inline">2. Weekly T&amp;R Reports</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('trs')}
            className={`py-2 px-2.5 sm:px-3 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 border-t border-x shrink-0 whitespace-nowrap ${
              activeTab === 'trs'
                ? 'bg-white border-slate-200 text-purple-700 -mb-px shadow-2xs font-black'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-purple-600 shrink-0" />
            <span className="sm:hidden">3. TRS</span>
            <span className="hidden sm:inline">3. TRS Delegated Tasks</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('unlocks')}
            className={`py-2 px-2.5 sm:px-3 text-xs font-bold rounded-t-xl transition-all cursor-pointer flex items-center gap-1.5 border-t border-x shrink-0 whitespace-nowrap ${
              activeTab === 'unlocks'
                ? 'bg-white border-slate-200 text-emerald-700 -mb-px shadow-2xs font-black'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="sm:hidden">4. Unlocks</span>
            <span className="hidden sm:inline">4. Manager Unlocks &amp; Audit</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-6 overflow-y-auto overscroll-contain space-y-5 sm:space-y-6 flex-1 min-h-0 text-slate-700 text-xs leading-relaxed">
          
          {/* TAB 1: JOB DESCRIPTION (JD) POLICY & GOVERNANCE */}
          {activeTab === 'jd' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Introduction Card */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <Lock className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-slate-900 text-sm">Job Description (JD) Policy &amp; Governance</h4>
                    <span className="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full border border-blue-200">
                      HR &amp; Admin Managed
                    </span>
                    <span className="text-[10px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                      Staff Self-Upload Prohibited
                    </span>
                  </div>
                  <p className="text-slate-600 text-xs mt-1.5 leading-relaxed">
                    To maintain organizational integrity and uniform evaluation benchmarks across all departments, all Job Description templates and weekly deliverable checklists are officially locked and maintained exclusively by <strong>HR &amp; Admin</strong>.
                  </p>
                </div>
              </div>

              {/* 3 Core Rules of JD Governance */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-2">
                    <Lock className="w-4 h-4" />
                  </div>
                  <h5 className="font-bold text-slate-900 text-xs">1. Centralized Authority</h5>
                  <p className="text-slate-600 text-[11px] mt-1 leading-snug">
                    All checklists are locked to authorized positions. Staff cannot upload, alter, add, or delete JD templates directly.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center mb-2">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <h5 className="font-bold text-slate-900 text-xs">2. Modification Procedure</h5>
                  <p className="text-slate-600 text-[11px] mt-1 leading-snug">
                    If duties change, notify your direct supervisor. The supervisor submits a change request to HR &amp; Admin, who verifies and updates the system.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-2">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <h5 className="font-bold text-slate-900 text-xs">3. One-Click Template Sync</h5>
                  <p className="text-slate-600 text-[11px] mt-1 leading-snug">
                    Once HR approves and registers updates, staff click "Sync Latest Official JD" in their weekly report to refresh deliverables instantly.
                  </p>
                </div>
              </div>

              {/* Step by step flow */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h5 className="font-bold text-slate-900 text-xs mb-2">Step-by-Step JD Modification Protocol:</h5>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
                  <li><strong>Staff Request:</strong> Staff informs their line manager that responsibilities or deliverables have evolved.</li>
                  <li><strong>Supervisor Endorsement:</strong> Direct manager reviews duties and submits formal revision request to HR &amp; Admin.</li>
                  <li><strong>HR &amp; Admin Audit &amp; System Update:</strong> HR validates against company organizational grading and publishes the official template.</li>
                  <li><strong>Live Activation:</strong> New checklist immediately populates all future and draft reports for that position.</li>
                </ol>
              </div>

              {/* Checklist N/A Fairness Rule */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-[11px] text-amber-900 leading-relaxed">
                  <strong>Fairness Rule (N/A Tasks):</strong> If a scheduled JD deliverable is not applicable during a particular week (e.g. quarterly audit during week 2), staff may mark it as <em>N/A</em>. It is excluded from the denominator so it never unfairly lowers the completion score.
                </div>
              </div>
            </div>
          )}
          
          {/* TAB 1: WEEKLY T&R POLICY */}
          {activeTab === 'tr' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Introduction Card */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Official T&R Evaluation Rubric (3-Part Standard)</h4>
                  <p className="text-slate-600 text-xs mt-1">
                    Every weekly Job Description report is evaluated on a standardized <strong>100-Point Scale</strong> across three core pillars:
                  </p>
                </div>
              </div>

              {/* 3 Pillars Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-extrabold text-blue-600 text-sm">Pillar 1</span>
                    <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full">50 Pts Max</span>
                  </div>
                  <h5 className="font-bold text-slate-900">Checklist Completion</h5>
                  <p className="text-slate-500 text-[11px] mt-1">
                    Calculated from the percentage of <strong>DONE</strong> weekly, monthly and Year Task deliverables.
                    Tasks left <strong>NOT DONE</strong> deduct points; items marked <strong>N/A</strong> or
                    <strong> LOCKED</strong> are excluded from the calculation. See the worked example below.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-extrabold text-indigo-600 text-sm">Pillar 2</span>
                    <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded-full">20 Pts Max</span>
                  </div>
                  <h5 className="font-bold text-slate-900">Submission Timeliness</h5>
                  <p className="text-slate-500 text-[11px] mt-1">
                    Mandatory deadline: <strong>Monday at 11:30 AM</strong> following the reporting week. Late submissions deduct points according to the penalty decay schedule.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-extrabold text-emerald-600 text-sm">Pillar 3</span>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full">30 Pts Max</span>
                  </div>
                  <h5 className="font-bold text-slate-900">Superior Quality Review</h5>
                  <p className="text-slate-500 text-[11px] mt-1">
                    Your direct superior reviews deliverables, proof attachments, notes, and assigns a qualitative grade upon official sign-off.
                  </p>
                </div>
              </div>

              {/* PILLAR 1: CHECKLIST COMPLETION SCORING & DEDUCTION SCHEDULE */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                    Pillar 1: Checklist Completion Scoring &amp; Deduction Schedule
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">50 Points Max</span>
                </div>

                <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="text-slate-800">
                      <strong>Calculation Formula:</strong>{' '}
                      <span className="font-semibold text-blue-700">
                        Score = (Done Tasks ÷ Applicable Tasks) × 50 Pts
                      </span>
                    </div>
                    <div className="text-slate-700">
                      <strong>Point Value per Task:</strong>{' '}
                      <span className="font-semibold text-indigo-700">
                        50 ÷ Applicable Tasks
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 italic">
                    (Applicable Tasks = Total Checklist Tasks &minus; N/A Tasks &minus; LOCKED Tasks = <strong className="not-italic">DONE + NOT DONE</strong>)
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
                    <div className="font-bold text-slate-800 text-xs">Task Evaluation &amp; N/A Rules:</div>
                    <ul className="space-y-1.5 pl-1">
                      <li className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold">•</span>
                        <span><strong>Weekly Tasks:</strong> Weekly routine duties start as Not Done. Staff may choose N/A when a task does not apply to the reporting period.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold">•</span>
                        <span><strong>Monthly Tasks (N/A Allowed When Not Scheduled):</strong> N/A is strictly for monthly deliverables during weeks when they are not scheduled (or if already completed earlier in the month). On the month's final week, N/A is locked if not completed earlier. Each monthly task is scheduled in <em>one</em> week only &mdash; every other week of that month then shows it as <strong>LOCKED</strong>.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold">•</span>
                        <span><strong>Year Tasks (1 Submission per Annual Cycle):</strong> A Year Task is fulfilled in a single week of the annual cycle; every other week of that cycle shows it as <strong>LOCKED</strong>. N/A remains available until the cycle ends, then is locked in the cycle's final month (January), where the task expires on 31 Jan.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold">•</span>
                        <span><strong>Anytime Tasks (N/A Always Allowed):</strong> Ad-hoc duties carry no fixed schedule, so N/A may be set at any time and they are never LOCKED.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold">•</span>
                        <span><strong>LOCKED Tasks Are Excluded, Not Penalised:</strong> A Monthly or Year Task already fulfilled in an earlier week of the same cycle shows as LOCKED here. It is removed from the denominator, so the later week is never docked for a task it is not allowed to perform again.</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-slate-400 font-bold">•</span>
                        <span><strong>The Fairness Rule:</strong> Tasks marked as N/A or LOCKED are excluded from the calculation, so you are never penalized for tasks that were not scheduled for that week.</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* What "Applicable" Means */}
                <div className="p-3 sm:p-4 bg-white border-b border-slate-200 space-y-3">
                  <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <HelpCircle className="w-4 h-4 text-slate-600 shrink-0" />
                      <span className="font-extrabold text-slate-800 text-xs uppercase">What Does &ldquo;Applicable&rdquo; Mean?</span>
                    </div>
                    <p className="text-slate-700 text-[11px]">
                      <strong>Applicable</strong> is simply the number of tasks on your checklist that
                      <strong> count</strong> toward your score. It is the tasks you were genuinely expected to perform
                      this week. Only two states are counted:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      <div className="rounded-md bg-white border border-emerald-200 px-2.5 py-1.5">
                        <span className="font-black text-emerald-700 text-[11px]">DONE &nbsp;&rarr;&nbsp; COUNTS</span>
                        <p className="text-slate-600 text-[10px] mt-0.5">You finished it. It adds to the numerator.</p>
                      </div>
                      <div className="rounded-md bg-white border border-rose-200 px-2.5 py-1.5">
                        <span className="font-black text-rose-700 text-[11px]">NOT DONE &nbsp;&rarr;&nbsp; COUNTS</span>
                        <p className="text-slate-600 text-[10px] mt-0.5">It was expected of you. It drags the score down.</p>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 px-2.5 py-1.5">
                        <span className="font-black text-slate-500 text-[11px]">N/A &nbsp;&rarr;&nbsp; DOES NOT COUNT</span>
                        <p className="text-slate-600 text-[10px] mt-0.5">Not scheduled this week. Removed from the total.</p>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 px-2.5 py-1.5">
                        <span className="font-black text-slate-500 text-[11px]">LOCKED &nbsp;&rarr;&nbsp; DOES NOT COUNT</span>
                        <p className="text-slate-600 text-[10px] mt-0.5">Already done in an earlier week of this cycle.</p>
                      </div>
                    </div>
                    <p className="text-slate-700 text-[11px] mt-2">
                      <strong>Applicable = DONE + NOT DONE</strong>. So with 5 tasks, if 1 is N/A and 1 is LOCKED,
                      only <strong>3 tasks are applicable</strong> &mdash; and those 3 carry the full 50 points between them.
                    </p>
                  </div>
                </div>

                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 text-[11px]">
                      <th className="py-2 px-3 font-semibold">Completion Rate</th>
                      <th className="py-2 px-3 font-semibold">Pillar 1 Score</th>
                      <th className="py-2 px-3 font-semibold">Deduction (Loss)</th>
                      <th className="py-2 px-3 font-semibold hidden sm:table-cell">5-Task Role Example</th>
                      <th className="py-2 px-3 font-semibold hidden md:table-cell">10-Task Role Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/30">
                      <td className="py-2 px-3 font-bold text-emerald-800">100% (All Tasks Done)</td>
                      <td className="py-2 px-3 font-extrabold text-emerald-700">50 / 50 pts</td>
                      <td className="py-2 px-3 text-slate-500 font-medium">0 pts (No deduction)</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">5 of 5 done (50 pts)</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">10 of 10 done (50 pts)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">80% – 90%</td>
                      <td className="py-2 px-3 font-bold text-blue-700">40 – 45 / 50 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-5 to -10 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">4 of 5 done (40 pts, -10)</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">8-9 of 10 done (40-45 pts)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">60% – 70%</td>
                      <td className="py-2 px-3 font-bold text-amber-700">30 – 35 / 50 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-15 to -20 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">3 of 5 done (30 pts, -20)</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">6-7 of 10 done (30-35 pts)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">40% – 50%</td>
                      <td className="py-2 px-3 font-bold text-orange-700">20 – 25 / 50 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-25 to -30 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">2 of 5 done (20 pts, -30)</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">4-5 of 10 done (20-25 pts)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">20% – 30%</td>
                      <td className="py-2 px-3 font-bold text-rose-700">10 – 15 / 50 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-35 to -40 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">1 of 5 done (10 pts, -40)</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">2-3 of 10 done (10-15 pts)</td>
                    </tr>
                    <tr className="bg-rose-50/50">
                      <td className="py-2 px-3 font-bold text-rose-900">0% (All Tasks Not Done)</td>
                      <td className="py-2 px-3 font-black text-rose-700">0 / 50 pts</td>
                      <td className="py-2 px-3 text-rose-700 font-bold">-50 pts (Flat Zero)</td>
                      <td className="py-2 px-3 text-rose-700 hidden sm:table-cell">0 of 5 done (0 pts, -50)</td>
                      <td className="py-2 px-3 text-rose-700 hidden md:table-cell">0 of 10 done (0 pts, -50)</td>
                    </tr>
                  </tbody>
                </table>

                {/* Worked Example — 5 Tasks */}
                <div className="border-t border-slate-200">
                  <div className="bg-slate-50 px-3 sm:px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Calculator className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="font-bold text-slate-800 text-[11px] sm:text-xs whitespace-nowrap">
                        Worked Example &mdash; 5 Tasks on Your Checklist
                      </span>
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500 shrink-0">Pillar 1</span>
                  </div>

                  {/* Mobile: card list — no horizontal scroll */}
                  <div className="sm:hidden divide-y divide-slate-100">
                    {PILLAR1_EXAMPLES.map((r) => (
                      <div key={r.label} className={`px-3 py-2.5 border-l-4 ${r.accent}`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className={`text-[11px] font-extrabold leading-snug ${r.labelCls}`}>
                            {r.label}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className={`block text-[13px] font-black leading-none ${r.scoreCls}`}>{r.score}</span>
                            <span className={`block text-[9px] font-bold leading-none mt-1 ${r.deltaCls}`}>{r.delta}</span>
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <StatChip label="Done" value={r.done} active={r.done > 0} />
                          <StatChip label="N/A" value={r.na} active={r.na > 0} />
                          <StatChip label="Locked" value={r.locked} active={r.locked > 0} />
                          <StatChip label="Applicable" value={r.applicable} active />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: full table */}
                  <div className="hidden sm:block overflow-x-auto thin-scrollbar">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 text-[11px]">
                          <th className="py-2 px-3 font-semibold">Scenario</th>
                          <th className="py-2 px-3 font-semibold text-center whitespace-nowrap">DONE</th>
                          <th className="py-2 px-3 font-semibold text-center whitespace-nowrap">N/A</th>
                          <th className="py-2 px-3 font-semibold text-center whitespace-nowrap">LOCKED</th>
                          <th className="py-2 px-3 font-semibold text-center whitespace-nowrap">Applicable</th>
                          <th className="py-2 px-3 font-semibold whitespace-nowrap">Pillar 1</th>
                          <th className="py-2 px-3 font-semibold whitespace-nowrap">vs 50</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {PILLAR1_EXAMPLES.map((r) => (
                          <tr key={r.label} className={r.muted ? '' : (r.accent.startsWith('bg-blue') ? 'bg-blue-50/40' : (r.accent.startsWith('bg-emerald') ? 'bg-emerald-50/30' : ''))}>
                            <td className={`py-2 px-3 font-extrabold ${r.labelCls}`}>{r.label}</td>
                            <td className="py-2 px-3 text-center font-semibold text-slate-700">{r.done}</td>
                            <td className={`py-2 px-3 text-center ${r.na > 0 ? 'font-semibold text-slate-600' : 'text-slate-400'}`}>{r.na}</td>
                            <td className={`py-2 px-3 text-center ${r.locked > 0 ? 'font-semibold text-slate-600' : 'text-slate-400'}`}>{r.locked}</td>
                            <td className="py-2 px-3 text-center font-semibold text-slate-700">{r.applicable}</td>
                            <td className={`py-2 px-3 font-extrabold ${r.scoreCls}`}>{r.score}</td>
                            <td className={`py-2 px-3 font-semibold ${r.deltaCls}`}>{r.delta}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 sm:px-4 py-2.5 bg-slate-50/70 border-t border-slate-200">
                    <p className="text-slate-500 text-[10px]">
                      Scores round to the nearest whole point. <strong>Applicable = DONE + NOT DONE</strong> tasks only; N/A and
                      LOCKED tasks leave the count entirely. A week where every task is N/A or LOCKED still scores
                      <strong> 50 / 50</strong>; a week with <strong>no tasks at all</strong> scores <strong>0 / 50</strong>
                      &mdash; the one case where an empty checklist does not earn full credit.
                    </p>
                  </div>
                </div>
              </div>

              {/* PILLAR 2: SUBMISSION TIMELINESS SCORING & DEDUCTION SCHEDULE */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    Pillar 2: Submission Timeliness Scoring &amp; Deduction Schedule
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">20 Points Max</span>
                </div>

                <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="text-xs text-slate-800">
                      <strong>Official Submission Cutoff:</strong>{' '}
                      <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-indigo-700 font-bold">
                        Monday before 11:30 AM
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      <strong>Penalty Waiver:</strong>{' '}
                      <span className="text-emerald-700 font-semibold">
                        Manager can waive delay penalty for approved justification (restores 20/20 pts)
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Late submissions deduct points according to the graduated daily decay schedule below. Drafts unsubmitted after 7 days past deadline auto-lock to <strong>0% Flat Zero</strong>.
                  </p>
                </div>

                {/* Mobile: card list — no horizontal scroll */}
                <div className="sm:hidden divide-y divide-slate-100">
                  {PILLAR2_ROWS.map((r) => (
                    <div key={r.timing} className={`px-3 py-2.5 border-l-4 ${r.accent}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-[11px] font-bold leading-snug ${r.timingCls}`}>
                          {r.icon === 'lock' && <Lock className="w-3 h-3 text-rose-600 shrink-0 inline-block align-[-2px] mr-1" />}
                          {r.timing}
                        </span>
                        <span className={`shrink-0 text-[13px] font-black leading-tight ${r.scoreCls}`}>{r.score}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-[10px]">
                        <span className={`font-bold ${r.penaltyCls}`}>{r.penalty}</span>
                        <span className="text-slate-300">&bull;</span>
                        <span className={`font-semibold ${r.maxCls}`}>{r.max}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden sm:block overflow-x-auto thin-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 text-[11px]">
                      <th className="py-2 px-3 font-semibold">Submission Timing</th>
                      <th className="py-2 px-3 font-semibold">Pillar 2 Score</th>
                      <th className="py-2 px-3 font-semibold">Deduction (Loss)</th>
                      <th className="py-2 px-3 font-semibold">Maximum Report Score</th>
                      <th className="py-2 px-3 font-semibold hidden sm:table-cell">Example Timing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/30">
                      <td className="py-2 px-3 font-bold text-emerald-800">On-Time (≤ Monday 11:30 AM or Approved Waiver)</td>
                      <td className="py-2 px-3 font-extrabold text-emerald-700">20 / 20 pts</td>
                      <td className="py-2 px-3 text-slate-500 font-medium">0 pts (Full Score)</td>
                      <td className="py-2 px-3 font-bold text-emerald-700">Up to 100%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Monday ≤ 11:30 AM</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">1 Day Late</td>
                      <td className="py-2 px-3 font-bold text-blue-700">15 / 20 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-5 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 95%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Tuesday</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">2 to 3 Days Late</td>
                      <td className="py-2 px-3 font-bold text-amber-700">10 / 20 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-10 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 90%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Wednesday – Thursday</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">4 to 5 Days Late</td>
                      <td className="py-2 px-3 font-bold text-orange-700">5 / 20 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-15 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 85%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Friday – Saturday</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-rose-800">&gt; 5 Days Late</td>
                      <td className="py-2 px-3 font-bold text-rose-700">0 / 20 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-bold">-20 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 80%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Sunday onwards</td>
                    </tr>
                    <tr className="bg-rose-50/60">
                      <td className="py-2.5 px-3 font-bold text-rose-900 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        &gt; 7 Days Overdue (Abandoned Draft)
                      </td>
                      <td className="py-2.5 px-3 font-black text-rose-700">0 / 100 pts</td>
                      <td className="py-2.5 px-3 font-bold text-rose-700">Defaulted (0%)</td>
                      <td className="py-2.5 px-3 font-black text-rose-700">0% Flat Zero</td>
                      <td className="py-2.5 px-3 text-rose-700 hidden sm:table-cell font-bold">Auto-locked past 7 days</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>

              {/* PILLAR 3: SUPERIOR QUALITY REVIEW SCORING & DEDUCTION SCHEDULE */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Pillar 3: Superior Quality Review Scoring &amp; Deduction Schedule
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">30 Points Max</span>
                </div>

                <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 space-y-2">
                  <div className="text-xs text-slate-800 font-bold">
                    3 Quality Standards (10 Pts Each = 30 Pts Total):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <span className="font-bold text-emerald-700 block mb-0.5">1. Proof &amp; Evidence (10 Pts)</span>
                      <p className="text-slate-600 leading-snug">Deliverable file attachments, screenshots, or links verifying that the assigned JD tasks were actually done.</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <span className="font-bold text-blue-700 block mb-0.5">2. Work Quality &amp; Standard (10 Pts)</span>
                      <p className="text-slate-600 leading-snug">Deliverables meet operational accuracy, required position format, and departmental benchmarks.</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <span className="font-bold text-indigo-700 block mb-0.5">3. Accuracy &amp; Notes (10 Pts)</span>
                      <p className="text-slate-600 leading-snug">Staff accomplishment remarks are clear, precise, and verified against work output without discrepancies.</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-snug">
                    <strong>Mandatory Justification Rule:</strong> If the superior grades Deliverable Quality below 70% (&lt;21/30 points), they <strong>must write constructive feedback</strong> explaining why points were deducted and required improvements.
                  </p>
                </div>

                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 text-[11px]">
                      <th className="py-2 px-3 font-semibold">Quality Grade</th>
                      <th className="py-2 px-3 font-semibold">Pillar 3 Score</th>
                      <th className="py-2 px-3 font-semibold">Deduction (Loss)</th>
                      <th className="py-2 px-3 font-semibold">Deliverable Standard</th>
                      <th className="py-2 px-3 font-semibold hidden sm:table-cell">Superior Review Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/30">
                      <td className="py-2 px-3 font-bold text-emerald-800">⭐ Excellent (100%)</td>
                      <td className="py-2 px-3 font-extrabold text-emerald-700">30 / 30 pts</td>
                      <td className="py-2 px-3 text-slate-500 font-medium">0 pts (No deduction)</td>
                      <td className="py-2 px-3 text-slate-700">All deliverables verified with clear proof, thorough notes, and zero errors (10/10/10).</td>
                      <td className="py-2 px-3 text-emerald-800 font-bold hidden sm:table-cell">Full Approval &amp; Sign-Off</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">✅ Good / Satisfactory (80%–90%)</td>
                      <td className="py-2 px-3 font-bold text-blue-700">25 / 30 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-5 pts</td>
                      <td className="py-2 px-3 text-slate-700">Routine tasks done properly according to JD standard; minor proof or formatting gaps.</td>
                      <td className="py-2 px-3 text-slate-700 font-medium hidden sm:table-cell">Standard Approval</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">⚠️ Acceptable (70%)</td>
                      <td className="py-2 px-3 font-bold text-amber-700">20 / 30 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-10 pts</td>
                      <td className="py-2 px-3 text-slate-700">Baseline operational output met; deliverables acceptable but lack depth or documentation.</td>
                      <td className="py-2 px-3 text-slate-700 font-medium hidden sm:table-cell">Approved with Notes</td>
                    </tr>
                    <tr className="bg-rose-50/40">
                      <td className="py-2 px-3 font-bold text-rose-900">❌ Needs Improvement (&lt; 70%)</td>
                      <td className="py-2 px-3 font-black text-rose-700">≤ 15 / 30 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-bold">-15 to -30 pts</td>
                      <td className="py-2 px-3 text-slate-700">Deficiencies found, missing critical proofs, or substandard execution.</td>
                      <td className="py-2 px-3 text-rose-700 font-bold hidden sm:table-cell">Mandatory Written Feedback Required</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Auto-Lock Highlight Box */}
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <h5 className="font-bold text-amber-950 text-xs">The 7-Day Auto-Lock Rule</h5>
                  <p className="text-amber-900 text-[11px] mt-1">
                    Reports not submitted within 7 days of the official deadline are automatically marked as <strong>Defaulted (0%)</strong> and locked.
                    Staff cannot submit retroactively unless their direct superior or an Admin issues an administrative unlock with an approved justification.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TRS TASKS POLICY */}
          {activeTab === 'trs' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
                <Layers className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">TRS Delegated Task Scoring (100 Pts Standard)</h4>
                  <p className="text-slate-600 text-xs mt-1">
                    Each assigned TRS task carries an individual deadline set by the assigner. Scoring is partitioned into <strong>40 Pts Timeliness</strong> + <strong>60 Pts Quality</strong>.
                  </p>
                </div>
              </div>

              {/* TRS Scoring Components */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-extrabold text-blue-600 text-xs">Pillar 1: Timeliness (Automated)</span>
                    <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 rounded-full">40 Pts Max</span>
                  </div>
                  <p className="text-slate-600 text-[11px]">
                    Evaluates submission punctuality relative to the assigned task deadline. On-time earns full 40/40 pts. Late submissions deduct points according to the graduated schedule. Superiors may waive delays if justified.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-extrabold text-indigo-600 text-xs">Pillar 2: Superior Quality Review</span>
                    <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded-full">60 Pts Max</span>
                  </div>
                  <p className="text-slate-600 text-[11px]">
                    Superior grades the deliverable across 3 standards: <strong>Instruction Compliance</strong> (20 pts), <strong>Scope Coverage</strong> (20 pts), and <strong>Accuracy Benchmark</strong> (20 pts).
                  </p>
                </div>
              </div>

              {/* PILLAR 1: TASK TIMELINESS SCORING & DEDUCTION SCHEDULE */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    Pillar 1: Task Timeliness Scoring &amp; Deduction Schedule
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">40 Points Max</span>
                </div>

                <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="text-xs text-slate-800">
                      <strong>Assigned Task Deadline:</strong>{' '}
                      <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-blue-700 font-bold">
                        Set individually by delegating superior
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      <strong>Extension &amp; Waiver:</strong>{' '}
                      <span className="text-emerald-700 font-semibold">
                        Proactive extensions / manager waivers preserve full 40/40 pts
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Evaluates submission punctuality relative to the assigned task deadline. On-time earns full 40/40 pts. Late submissions deduct points according to the graduated schedule below.
                  </p>
                </div>

                <div className="overflow-x-auto thin-scrollbar">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 text-[11px]">
                      <th className="py-2 px-3 font-semibold">Submission Timing</th>
                      <th className="py-2 px-3 font-semibold">Timeliness Score</th>
                      <th className="py-2 px-3 font-semibold">Deduction (Loss)</th>
                      <th className="py-2 px-3 font-semibold">Max Task Score</th>
                      <th className="py-2 px-3 font-semibold hidden sm:table-cell">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/30">
                      <td className="py-2 px-3 font-bold text-emerald-800">On-Time (or Approved Extension / Waived)</td>
                      <td className="py-2 px-3 font-extrabold text-emerald-700">40 / 40 pts</td>
                      <td className="py-2 px-3 text-slate-500 font-medium">0 pts (Full Score)</td>
                      <td className="py-2 px-3 font-bold text-emerald-700">Up to 100%</td>
                      <td className="py-2 px-3 text-emerald-800 font-bold hidden sm:table-cell">On schedule</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">1 Day Late</td>
                      <td className="py-2 px-3 font-bold text-blue-700">30 / 40 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-10 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 90%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Minor delay</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">2 to 3 Days Late</td>
                      <td className="py-2 px-3 font-bold text-amber-700">20 / 40 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-20 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 80%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Moderate delay</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">4 to 5 Days Late</td>
                      <td className="py-2 px-3 font-bold text-orange-700">10 / 40 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-30 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 70%</td>
                      <td className="py-2 px-3 text-slate-700 hidden sm:table-cell">Significant delay</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-rose-800">&gt; 5 Days Late</td>
                      <td className="py-2 px-3 font-bold text-rose-700">0 / 40 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-bold">-40 pts</td>
                      <td className="py-2 px-3 font-semibold text-slate-700">Up to 60%</td>
                      <td className="py-2 px-3 text-rose-700 hidden sm:table-cell">Critical delay</td>
                    </tr>
                    <tr className="bg-rose-50/60">
                      <td className="py-2.5 px-3 font-bold text-rose-900 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        &gt; 7 Days Overdue (Unsubmitted / Abandoned)
                      </td>
                      <td className="py-2.5 px-3 font-black text-rose-700">0 / 100 pts</td>
                      <td className="py-2.5 px-3 font-bold text-rose-700">Defaulted (0%)</td>
                      <td className="py-2.5 px-3 font-black text-rose-700">0% Flat Zero</td>
                      <td className="py-2.5 px-3 text-rose-700 font-bold hidden sm:table-cell">Auto-locked</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>

              {/* PILLAR 2: SUPERIOR QUALITY REVIEW SCORING & DEDUCTION SCHEDULE */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <ClipboardCheck className="w-3.5 h-3.5 text-indigo-600" />
                    Pillar 2: Superior Quality Review Scoring &amp; Deduction Schedule
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">60 Points Max</span>
                </div>

                <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 space-y-2">
                  <div className="text-xs text-slate-800 font-bold">
                    3 Quality Standards (20 Pts Each = 60 Pts Total):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <span className="font-bold text-indigo-700 block mb-0.5">1. Instruction Compliance (20 Pts)</span>
                      <p className="text-slate-600 leading-snug">Adherence to supervisor's specific guidelines, workflow, and briefing instructions.</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <span className="font-bold text-blue-700 block mb-0.5">2. Scope Coverage (20 Pts)</span>
                      <p className="text-slate-600 leading-snug">Thoroughness in delivering all expected outputs, assigned deliverables, and research materials.</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                      <span className="font-bold text-emerald-700 block mb-0.5">3. Accuracy Benchmark (20 Pts)</span>
                      <p className="text-slate-600 leading-snug">Precision, data correctness, absence of errors, and supporting verification files.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 leading-snug">
                      <strong>Maximum 2 Revision Cycles:</strong> Superiors may request up to 2 revisions. A 3rd attempt auto-escalates to senior management.
                    </div>
                    <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-snug">
                      <strong>Mandatory Justification Rule:</strong> If graded below 70% (&lt;42/60 points), superiors <strong>must write constructive feedback</strong>.
                    </div>
                  </div>
                </div>

                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 text-[11px]">
                      <th className="py-2 px-3 font-semibold">Quality Rating</th>
                      <th className="py-2 px-3 font-semibold">Pillar 2 Score</th>
                      <th className="py-2 px-3 font-semibold">Deduction (Loss)</th>
                      <th className="py-2 px-3 font-semibold hidden md:table-cell">Component Breakdown</th>
                      <th className="py-2 px-3 font-semibold">Deliverable Standard</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-emerald-50/30">
                      <td className="py-2 px-3 font-bold text-emerald-800">⭐ Exceptional (100%)</td>
                      <td className="py-2 px-3 font-extrabold text-emerald-700">60 / 60 pts</td>
                      <td className="py-2 px-3 text-slate-500 font-medium">0 pts (No deduction)</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">20 / 20 / 20 pts</td>
                      <td className="py-2 px-3 text-slate-700">Exceeds instructions; complete scope, verified accuracy, and robust proof.</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">✅ Good / Satisfactory (80%–90%)</td>
                      <td className="py-2 px-3 font-bold text-blue-700">50 / 60 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-10 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">16–18 / 16–18 / 16–18 pts</td>
                      <td className="py-2 px-3 text-slate-700">Objective accomplished thoroughly; minor non-critical polish needed.</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-slate-800">⚠️ Acceptable (70%–75%)</td>
                      <td className="py-2 px-3 font-bold text-amber-700">42 / 60 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-medium">-18 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">14 / 14 / 14 pts</td>
                      <td className="py-2 px-3 text-slate-700">Meets baseline requirements without exceeding expectations.</td>
                    </tr>
                    <tr className="bg-rose-50/40">
                      <td className="py-2 px-3 font-bold text-rose-900">❌ Needs Revision (&lt; 70%)</td>
                      <td className="py-2 px-3 font-black text-rose-700">≤ 36 / 60 pts</td>
                      <td className="py-2 px-3 text-rose-600 font-bold">-24 to -60 pts</td>
                      <td className="py-2 px-3 text-slate-700 hidden md:table-cell">≤ 12 in each standard</td>
                      <td className="py-2 px-3 text-slate-700">Inadequate quality; returned for revision (Counts towards 2-cycle limit; mandatory feedback).</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Key Rules Callouts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="font-bold text-slate-900 flex items-center gap-1 mb-1">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" /> Proactive Extension Requests
                  </div>
                  <p className="text-slate-600">
                    Staff should request an extension <em>before</em> the deadline passes. If the manager approves, full timeliness points (40/40) are preserved.
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="font-bold text-slate-900 flex items-center gap-1 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Maximum 2 Revision Cycles
                  </div>
                  <p className="text-slate-600">
                    If deliverables require corrections, superiors may request revision up to 2 times. If still unsatisfactory, the task is locked for final grading as-is to avoid infinite loops.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MANAGER UNLOCKS & AUDIT TRAIL */}
          {activeTab === 'unlocks' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">Managerial Override & Administrative Unlocks</h4>
                  <p className="text-slate-600 text-xs mt-1">
                    While deadlines and auto-locks are automated, company policy provides authorized superiors with discretion to unlock reports or waive penalties for valid emergencies.
                  </p>
                </div>
              </div>

              {/* 2 Unlock Modes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-2">
                    <Unlock className="w-4 h-4" />
                  </div>
                  <h5 className="font-bold text-slate-900 text-xs">Option A: Unlock + Waive Late Penalty</h5>
                  <p className="text-slate-500 text-[11px] mt-1">
                    Used for genuine emergencies (hospitalization, approved emergency leave, client-side blockage). The report is reopened and staff can earn up to full 20/20 timeliness on a T&amp;R report, or 40/40 on a TRS task.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-bold mb-2">
                    <Lock className="w-4 h-4" />
                  </div>
                  <h5 className="font-bold text-slate-900 text-xs">Option B: Unlock Only (No Penalty Waiver)</h5>
                  <p className="text-slate-500 text-[11px] mt-1">
                    Used when staff missed the deadline through negligence, but management still mandates them to document their work. Staff can submit to receive checklist and quality grading, but late penalties remain.
                  </p>
                </div>
              </div>

              {/* Golden Rule: Staff Still Must Do the Work */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <h5 className="font-bold text-blue-950 text-xs">The Duty Principle: Staff Must Still Deliver</h5>
                  <p className="text-blue-900 text-[11px] mt-1">
                    An administrative unlock does NOT award automatic points. It simply removes the lock so the staff member can complete their checklist, upload their proof of work, and submit for evaluation.
                  </p>
                </div>
              </div>

              {/* Permanent Audit Trail Guarantee */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 shadow-2xs">
                <h5 className="font-bold text-slate-900 text-xs flex items-center gap-1.5 mb-1.5">
                  <ShieldCheck className="w-4 h-4 text-slate-700" />
                  Permanent Audit Trail Guarantee
                </h5>
                <p className="text-slate-600 text-[11px]">
                  To guarantee company-wide integrity and eliminate favoritism, every administrative unlock and penalty waiver is permanently logged in the system with:
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600 text-[11px]">
                  <li><strong>Manager Name &amp; Role</strong> who authorized the unlock</li>
                  <li><strong>Exact Timestamp</strong> of the action</li>
                  <li><strong>Mandatory Written Reason</strong> explaining the emergency or justification</li>
                  <li><strong>Visibility:</strong> Recorded in the administrative activity logs and permanently displayed on the report card.</li>
                </ul>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 bg-slate-100 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
          <span className="text-[11px] text-slate-500 font-medium text-center sm:text-left hidden sm:block">
            APA Operational Compliance &amp; Accountability Framework
          </span>
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 sm:py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            I Understand
          </button>
        </div>

      </div>
    </div>
  );
};
