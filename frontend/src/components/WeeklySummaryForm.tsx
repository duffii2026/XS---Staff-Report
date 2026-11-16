import React, { useState } from 'react';
import {
  WeeklySummary,
  SummaryMeeting,
  SummaryProblem,
  SummaryChallenge,
  SummaryNeed,
  SummaryIdea
} from '../types';
import { uploadProofFile } from '../services/api';
import { Plus, Trash2, Paperclip, Loader2, AlertTriangle } from 'lucide-react';

const INPUT =
  'w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white';
const LABEL = 'block text-xs font-semibold text-slate-700 mb-1';
const REQ = <span className="text-rose-600"> *</span>;

const MAX = {
  overallComment: 300,
  meetingTitle: 100,
  attendees: 300,
  decisions: 400,
  problemTitle: 100,
  problemDesc: 500,
  challenge: 400,
  impact: 300,
  need: 300,
  suggestion: 500,
  benefit: 300,
  achievements: 500,
  priority: 150,
  feedback: 500
} as const;

/** Section H is dynamic (add/remove) — this caps how many priorities can be added. */
const MAX_PRIORITIES = 5;

export const EMPTY_SUMMARY: WeeklySummary = {
  weekStatus: '',
  overallComment: '',
  hadMeetings: null,
  meetings: [],
  noProblems: false,
  problems: [],
  challenges: [],
  needs: [],
  ideas: [],
  achievements: '',
  priorities: [''],
  confirmed: false
};

const WEEK_STATUSES: { v: string; label: string; hint: string; tone: string }[] = [
  { v: 'On track', label: 'On track', hint: 'Everything normal', tone: 'emerald' },
  { v: 'Minor delays', label: 'Minor delays', hint: 'Small slips', tone: 'amber' },
  { v: 'Significant delays', label: 'Significant delays', hint: 'Work is behind', tone: 'orange' },
  { v: 'Blocked', label: 'Blocked', hint: 'Cannot continue', tone: 'rose' }
];

const MEETING_TYPES = [
  'Team meeting',
  'With superior / management',
  'Cross-department',
  'External party / client',
  'Training / briefing',
  'Other'
];
const PROBLEM_CATEGORIES = [
  'Workload',
  'System / tool',
  'People / team',
  'Process / policy',
  'Resources / equipment',
  'External party',
  'Other'
];
const PROBLEM_STATES = ['Resolved', 'Ongoing', 'Need help'];
const NEED_SOURCES = ['Direct superior', 'Another department', 'IT / system team', 'Other'];
const IDEA_AREAS = [
  'Process / workflow',
  'System / tool',
  'Team / people',
  'Cost or time saving',
  'Policy',
  'Other'
];

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <div className="text-[11px] text-slate-400 text-right mt-0.5">
      {value.length}/{max}
    </div>
  );
}

function SectionHead({
  letter,
  title,
  required,
  desc
}: {
  letter: string;
  title: string;
  required: boolean;
  desc: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-sm font-bold text-slate-900">
          {letter}. {title}
        </h4>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            required
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}
        >
          {required ? 'Required' : 'Optional'}
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>
    </div>
  );
}

function EntryCard({
  index,
  title,
  badge,
  readOnly,
  onRemove,
  children
}: {
  index: number;
  title: string;
  badge?: React.ReactNode;
  readOnly?: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-200 border-l-4 border-l-amber-400 bg-slate-50 rounded-xl p-3 mb-2.5">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
          {title} {index + 1}
          {badge}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="text-rose-600 hover:text-rose-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function AddBtn({
  onClick,
  label,
  disabled
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 bg-white border border-dashed border-emerald-500 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
    >
      <Plus className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…'
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export interface WeeklySummaryFormProps {
  value: WeeklySummary;
  onChange: (v: WeeklySummary) => void;
  taskTitles: string[];
  weekStart: string;
  weekEnd: string;
  readOnly?: boolean;
  /** Hide Section J so the host page can render it after its own Section I (attachments). */
  hideConfirm?: boolean;
}

/**
 * Weekly Summary Form — IRG-HR-FRM-WSUM-001 v1.1, Sections A-J.
 * Format/spec only; rendered with the app's existing Tailwind styling.
 */
export const WeeklySummaryForm: React.FC<WeeklySummaryFormProps> = ({
  value,
  onChange,
  taskTitles,
  weekStart,
  weekEnd,
  readOnly = false,
  hideConfirm = false
}) => {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [uploadErr, setUploadErr] = useState('');

  const update = (patch: Partial<WeeklySummary>) => onChange({ ...value, ...patch });

  const handleMinutes = async (idx: number, file?: File) => {
    if (!file || readOnly) return;
    if (file.size > 30 * 1024 * 1024) {
      setUploadErr('Minutes file exceeds the 30 MB limit.');
      return;
    }
    const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase();
    if (!['.pdf', '.docx', '.jpg', '.jpeg', '.png'].includes(ext)) {
      setUploadErr('Minutes of meeting must be PDF, DOCX, JPG or PNG.');
      return;
    }
    setUploadingIdx(idx);
    setUploadErr('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error('Could not read the selected file.'));
        r.readAsDataURL(file);
      });
      const up = await uploadProofFile({ name: file.name, dataUrl });
      const list = [...value.meetings];
      list[idx] = { ...list[idx], minutesName: up.name || file.name, minutesUrl: up.url };
      update({ meetings: list });
    } catch (e: any) {
      setUploadErr(e?.message || 'Failed to upload the minutes of meeting.');
    } finally {
      setUploadingIdx(null);
    }
  };

  const severityBadge = (sev: string) => {
    if (!sev) return null;
    const tone =
      sev[0] === 'H'
        ? 'bg-rose-100 text-rose-700 border-rose-200'
        : sev[0] === 'M'
          ? 'bg-amber-100 text-amber-700 border-amber-200'
          : 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone}`}>
        {sev.split(' ')[0]}
      </span>
    );
  };

  const renderOptions = (current: string, onPick: (v: string) => void) =>
    WEEK_STATUSES.map((s) => (
      <button
        key={s.v}
        type="button"
        disabled={readOnly}
        onClick={() => onPick(s.v)}
        className={`border-2 rounded-xl p-2.5 text-center cursor-pointer transition-all disabled:cursor-not-allowed ${
          current === s.v
            ? s.tone === 'emerald'
              ? 'border-emerald-500 bg-emerald-50'
              : s.tone === 'amber'
                ? 'border-amber-500 bg-amber-50'
                : s.tone === 'orange'
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-rose-500 bg-rose-50'
            : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
      >
        <span className="block text-xs font-bold text-slate-800">{s.label}</span>
        <span className="block text-[10px] text-slate-500 mt-0.5">{s.hint}</span>
      </button>
    ));

  return (
    <div className="space-y-4">
      {/* A */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white">
        <SectionHead
          letter="A"
          title="Overall week status"
          required
          desc="How did your week go overall?"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
          {renderOptions(value.weekStatus, (v) =>
            update({ weekStatus: v as WeeklySummary['weekStatus'] })
          )}
        </div>
        <label className={LABEL} htmlFor="wsOverall">
          Overall comment (optional)
        </label>
        <textarea
          id="wsOverall"
          rows={2}
          maxLength={MAX.overallComment}
          disabled={readOnly}
          value={value.overallComment}
          onChange={(e) => update({ overallComment: e.target.value })}
          placeholder="One or two sentences that sum up the week."
          className={INPUT}
        />
        <Counter value={value.overallComment} max={MAX.overallComment} />
      </div>

      {/* B */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white">
        <SectionHead
          letter="B"
          title="Meetings & minutes of meeting"
          required
          desc="If a meeting was held, its minutes of meeting must be attached. Up to 10 meetings."
        />
        <label className={LABEL}>
          Did you have any meeting this week?{REQ}
        </label>
        <div className="grid grid-cols-2 gap-2.5 max-w-[320px] mb-3">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              disabled={readOnly}
              onClick={() => update({ hadMeetings: v })}
              className={`border-2 rounded-xl p-2.5 text-center text-xs font-bold cursor-pointer transition-all disabled:cursor-not-allowed ${
                value.hadMeetings === v
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>

        {value.hadMeetings === true && (
          <div className="space-y-2.5">
            {value.meetings.map((m, i) => (
              <EntryCard key={i} index={i} title="Meeting" readOnly={readOnly} onRemove={() => {
                const list = value.meetings.filter((_, j) => j !== i);
                update({ meetings: list });
              }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className={LABEL}>
                      Meeting title{REQ}
                    </label>
                    <input
                      type="text"
                      maxLength={MAX.meetingTitle}
                      disabled={readOnly}
                      value={m.title}
                      onChange={(e) => {
                        const list = [...value.meetings];
                        list[i] = { ...m, title: e.target.value };
                        update({ meetings: list });
                      }}
                      placeholder="Name or topic of the meeting"
                      className={INPUT}
                    />
                    <Counter value={m.title} max={MAX.meetingTitle} />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Meeting date{REQ}
                    </label>
                    <input
                      type="date"
                      disabled={readOnly}
                      value={m.date}
                      min={weekStart || undefined}
                      max={weekEnd || undefined}
                      onChange={(e) => {
                        const list = [...value.meetings];
                        list[i] = { ...m, date: e.target.value };
                        update({ meetings: list });
                      }}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Meeting type{REQ}
                    </label>
                    <Select
                      value={m.type}
                      onChange={(v) => {
                        const list = [...value.meetings];
                        list[i] = { ...m, type: v };
                        update({ meetings: list });
                      }}
                      options={MEETING_TYPES}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={LABEL}>
                      Attendees{REQ}
                    </label>
                    <textarea
                      rows={2}
                      maxLength={MAX.attendees}
                      disabled={readOnly}
                      value={m.attendees}
                      onChange={(e) => {
                        const list = [...value.meetings];
                        list[i] = { ...m, attendees: e.target.value };
                        update({ meetings: list });
                      }}
                      placeholder="Names or departments who attended"
                      className={INPUT}
                    />
                    <Counter value={m.attendees} max={MAX.attendees} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={LABEL}>
                      Key decisions / outcomes (optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={MAX.decisions}
                      disabled={readOnly}
                      value={m.decisions}
                      onChange={(e) => {
                        const list = [...value.meetings];
                        list[i] = { ...m, decisions: e.target.value };
                        update({ meetings: list });
                      }}
                      placeholder="Short summary. Full detail is in the minutes."
                      className={INPUT}
                    />
                    <Counter value={m.decisions} max={MAX.decisions} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={LABEL}>
                      Minutes of meeting{REQ}
                      <span className="font-normal text-slate-500">
                        {' '}
                        · PDF, DOCX, JPG, PNG · max 30 MB
                      </span>
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="file"
                        accept=".pdf,.docx,.jpg,.jpeg,.png"
                        disabled={readOnly || uploadingIdx === i}
                        onChange={(e) => handleMinutes(i, e.target.files?.[0])}
                        className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                      />
                      {uploadingIdx === i && (
                        <span className="text-[11px] text-blue-600 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
                        </span>
                      )}
                    </div>
                    {m.minutesUrl && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                        <Paperclip className="w-3.5 h-3.5 shrink-0" />
                        <a
                          href={m.minutesUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline truncate"
                        >
                          {m.minutesName}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </EntryCard>
            ))}
            {uploadErr && (
              <p className="text-[11px] text-rose-600 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {uploadErr}
              </p>
            )}
            <AddBtn
              onClick={() =>
                update({
                  meetings: [
                    ...value.meetings,
                    { title: '', date: '', type: '', attendees: '', decisions: '' }
                  ]
                })
              }
              label="Add a meeting"
              disabled={readOnly || value.meetings.length >= 10}
            />
          </div>
        )}
      </div>

      {/* C */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white">
        <SectionHead
          letter="C"
          title="Problems & issues"
          required
          desc='Tick "no problems" or add at least one problem. Up to 5 entries.'
        />
        <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={value.noProblems}
            disabled={readOnly}
            onChange={(e) => update({ noProblems: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-blue-600"
          />
          <span className="text-xs text-slate-700">No problems or issues this week</span>
        </label>

        {!value.noProblems && (
          <div className="mt-3 space-y-2.5">
            {value.problems.map((p, i) => (
              <EntryCard
                key={i}
                index={i}
                    title="Problem"
                    badge={severityBadge(p.severity)}
                    readOnly={readOnly}
                    onRemove={() => update({ problems: value.problems.filter((_, j) => j !== i) })}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className={LABEL}>
                      Problem title{REQ}
                    </label>
                    <input
                      type="text"
                      maxLength={MAX.problemTitle}
                      disabled={readOnly}
                      value={p.title}
                      onChange={(e) => {
                        const list = [...value.problems];
                        list[i] = { ...p, title: e.target.value };
                        update({ problems: list });
                      }}
                      placeholder="Short name of the problem"
                      className={INPUT}
                    />
                    <Counter value={p.title} max={MAX.problemTitle} />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Category{REQ}
                    </label>
                    <Select
                      value={p.category}
                      onChange={(v) => {
                        const list = [...value.problems];
                        list[i] = { ...p, category: v };
                        update({ problems: list });
                      }}
                      options={PROBLEM_CATEGORIES}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Severity{REQ}
                    </label>
                    <Select
                      value={p.severity}
                      onChange={(v) => {
                        const list = [...value.problems];
                        list[i] = { ...p, severity: v as SummaryProblem['severity'] };
                        update({ problems: list });
                      }}
                      options={[
                        'Low - small effect, handled alone',
                        'Medium - slows the work',
                        'High - work is stopped or at risk'
                      ]}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={LABEL}>
                      Description{REQ}
                    </label>
                    <textarea
                      rows={3}
                      maxLength={MAX.problemDesc}
                      disabled={readOnly}
                      value={p.description}
                      onChange={(e) => {
                        const list = [...value.problems];
                        list[i] = { ...p, description: e.target.value };
                        update({ problems: list });
                      }}
                      placeholder="What happened, when, and the effect on the work."
                      className={INPUT}
                    />
                    <Counter value={p.description} max={MAX.problemDesc} />
                  </div>
                  <div>
                    <label className={LABEL}>Related task (optional)</label>
                    <select
                      value={p.relatedTask}
                      disabled={readOnly}
                      onChange={(e) => {
                        const list = [...value.problems];
                        list[i] = { ...p, relatedTask: e.target.value };
                        update({ problems: list });
                      }}
                      className={INPUT}
                    >
                      <option value="">Not related to a task</option>
                      {taskTitles.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>
                      Current state{REQ}
                    </label>
                    <Select
                      value={p.state}
                      onChange={(v) => {
                        const list = [...value.problems];
                        list[i] = { ...p, state: v };
                        update({ problems: list });
                      }}
                      options={PROBLEM_STATES}
                    />
                  </div>
                </div>
              </EntryCard>
            ))}
            <AddBtn
              onClick={() =>
                update({
                  problems: [
                    ...value.problems,
                    {
                      title: '',
                      category: '',
                      severity: '',
                      description: '',
                      relatedTask: '',
                      state: ''
                    }
                  ]
                })
              }
              label="Add a problem"
              disabled={readOnly || value.problems.length >= 5}
            />
          </div>
        )}
      </div>

      {/* D */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white">
        <SectionHead
          letter="D"
          title="Challenges & risks"
          required={false}
          desc="Not a problem yet, but may become one soon. Up to 3 entries."
        />
        <div className="space-y-2.5">
          {value.challenges.map((c, i) => (
            <EntryCard
              key={i}
              index={i}
                  title="Challenge or risk"
                  readOnly={readOnly}
                  onRemove={() =>
                    update({ challenges: value.challenges.filter((_, j) => j !== i) })
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className={LABEL}>
                    Challenge or risk{REQ}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={MAX.challenge}
                    disabled={readOnly}
                    value={c.challenge}
                    onChange={(e) => {
                      const list = [...value.challenges];
                      list[i] = { ...c, challenge: e.target.value };
                      update({ challenges: list });
                    }}
                    className={INPUT}
                  />
                  <Counter value={c.challenge} max={MAX.challenge} />
                </div>
                <div className="md:col-span-2">
                  <label className={LABEL}>Possible impact (optional)</label>
                  <input
                    type="text"
                    maxLength={MAX.impact}
                    disabled={readOnly}
                    value={c.impact}
                    onChange={(e) => {
                      const list = [...value.challenges];
                      list[i] = { ...c, impact: e.target.value };
                      update({ challenges: list });
                    }}
                    placeholder="What could happen if it is not handled."
                    className={INPUT}
                  />
                  <Counter value={c.impact} max={MAX.impact} />
                </div>
              </div>
            </EntryCard>
          ))}
          <AddBtn
            onClick={() =>
              update({ challenges: [...value.challenges, { challenge: '', impact: '' }] })
            }
            label="Add a challenge or risk"
            disabled={readOnly || value.challenges.length >= 3}
          />
        </div>
      </div>

      {/* E */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white">
        <SectionHead
          letter="E"
          title="Support or decision needed"
          required={false}
          desc="What do you need from your superior or others? Up to 3 entries."
        />
        <div className="space-y-2.5">
          {value.needs.map((n, i) => (
            <EntryCard
              key={i}
              index={i}
                  title="Request"
                  readOnly={readOnly}
                  onRemove={() => update({ needs: value.needs.filter((_, j) => j !== i) })}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className={LABEL}>
                    What is needed{REQ}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={MAX.need}
                    disabled={readOnly}
                    value={n.what}
                    onChange={(e) => {
                      const list = [...value.needs];
                      list[i] = { ...n, what: e.target.value };
                      update({ needs: list });
                    }}
                    placeholder="The support, approval or decision requested."
                    className={INPUT}
                  />
                  <Counter value={n.what} max={MAX.need} />
                </div>
                <div>
                  <label className={LABEL}>
                    Needed from{REQ}
                  </label>
                  <Select
                    value={n.from}
                    onChange={(v) => {
                      const list = [...value.needs];
                      list[i] = { ...n, from: v };
                      update({ needs: list });
                    }}
                    options={NEED_SOURCES}
                  />
                </div>
                <div>
                  <label className={LABEL}>Needed by (optional)</label>
                  <input
                    type="date"
                    disabled={readOnly}
                    value={n.by}
                    min={weekStart || undefined}
                    onChange={(e) => {
                      const list = [...value.needs];
                      list[i] = { ...n, by: e.target.value };
                      update({ needs: list });
                    }}
                    className={INPUT}
                  />
                </div>
              </div>
            </EntryCard>
          ))}
          <AddBtn
            onClick={() => update({ needs: [...value.needs, { what: '', from: '', by: '' }] })}
            label="Add a request"
            disabled={readOnly || value.needs.length >= 3}
          />
        </div>
      </div>

      {/* F */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white">
        <SectionHead
          letter="F"
          title="Suggestions & improvement ideas"
          required={false}
          desc="Ideas to improve the work, system or process. Up to 3 entries."
        />
        <div className="space-y-2.5">
          {value.ideas.map((s, i) => (
            <EntryCard
              key={i}
              index={i}
                  title="Suggestion"
                  readOnly={readOnly}
                  onRemove={() => update({ ideas: value.ideas.filter((_, j) => j !== i) })}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className={LABEL}>
                    Suggestion{REQ}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={MAX.suggestion}
                    disabled={readOnly}
                    value={s.suggestion}
                    onChange={(e) => {
                      const list = [...value.ideas];
                      list[i] = { ...s, suggestion: e.target.value };
                      update({ ideas: list });
                    }}
                    className={INPUT}
                  />
                  <Counter value={s.suggestion} max={MAX.suggestion} />
                </div>
                <div>
                  <label className={LABEL}>
                    Area{REQ}
                  </label>
                  <Select
                    value={s.area}
                    onChange={(v) => {
                      const list = [...value.ideas];
                      list[i] = { ...s, area: v };
                      update({ ideas: list });
                    }}
                    options={IDEA_AREAS}
                  />
                </div>
                <div>
                  <label className={LABEL}>Expected benefit (optional)</label>
                  <input
                    type="text"
                    maxLength={MAX.benefit}
                    disabled={readOnly}
                    value={s.benefit}
                    onChange={(e) => {
                      const list = [...value.ideas];
                      list[i] = { ...s, benefit: e.target.value };
                      update({ ideas: list });
                    }}
                    className={INPUT}
                  />
                  <Counter value={s.benefit} max={MAX.benefit} />
                </div>
              </div>
            </EntryCard>
          ))}
          <AddBtn
            onClick={() =>
              update({ ideas: [...value.ideas, { suggestion: '', area: '', benefit: '' }] })
            }
            label="Add a suggestion"
            disabled={readOnly || value.ideas.length >= 3}
          />
        </div>
      </div>

      {/* G + H */}
      <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-4">
        <div>
          <SectionHead
            letter="G"
            title="Achievements & highlights"
            required={false}
            desc="Good results, praise received, or work that went especially well."
          />
          <textarea
            rows={3}
            maxLength={MAX.achievements}
            disabled={readOnly}
            value={value.achievements}
            onChange={(e) => update({ achievements: e.target.value })}
            placeholder="Write here…"
            className={INPUT}
          />
          <Counter value={value.achievements} max={MAX.achievements} />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SectionHead
            letter="H"
            title="Focus for next week"
            required={false}
            desc="Top priorities for the coming week. Add or remove entries as needed."
          />
          <div className="space-y-2.5">
            {value.priorities.map((p, i) => (
              <EntryCard
                key={i}
                index={i}
                title="Priority"
                readOnly={readOnly}
                onRemove={() =>
                  update({ priorities: value.priorities.filter((_, j) => j !== i) })
                }
              >
                <input
                  type="text"
                  maxLength={MAX.priority}
                  disabled={readOnly}
                  value={p}
                  onChange={(e) => {
                    const list = [...value.priorities];
                    list[i] = e.target.value;
                    update({ priorities: list });
                  }}
                  placeholder="Most important focus for next week"
                  className={INPUT}
                />
                <Counter value={p} max={MAX.priority} />
              </EntryCard>
            ))}
            <AddBtn
              onClick={() => update({ priorities: [...value.priorities, ''] })}
              label="Add a priority"
              disabled={readOnly || value.priorities.length >= MAX_PRIORITIES}
            />
          </div>
        </div>
      </div>

      {/* J */}
      {!hideConfirm && (
        <div className="border border-slate-200 rounded-xl p-4 bg-white">
          <SectionHead
            letter="J"
            title="Confirmation & submit"
            required
            desc="Confirm the information before submitting the checklist and summary together."
          />
          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={value.confirmed}
              disabled={readOnly}
              onChange={(e) => update({ confirmed: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-blue-600"
            />
            <span className="text-xs text-slate-700">
              I confirm that the information in this weekly checklist and summary is correct.
            </span>
          </label>
        </div>
      )}
    </div>
  );
};

/** Spec §6: an empty entry (added but nothing typed) is removed automatically on submit. */
function blank(fields: (string | undefined)[]): boolean {
  return fields.every((f) => !String(f || '').trim());
}

export function stripEmptyEntries(s: WeeklySummary): WeeklySummary {
  return {
    ...s,
    meetings: s.hadMeetings
      ? s.meetings.filter(
          (m) => !blank([m.title, m.date, m.type, m.attendees, m.decisions, m.minutesUrl])
        )
      : [],
    problems: s.noProblems
      ? []
      : s.problems.filter(
          (p) => !blank([p.title, p.category, p.severity, p.description, p.relatedTask, p.state])
        ),
    challenges: s.challenges.filter((c) => !blank([c.challenge, c.impact])),
    needs: s.needs.filter((n) => !blank([n.what, n.from, n.by])),
    ideas: s.ideas.filter((i) => !blank([i.suggestion, i.area, i.benefit])),
    priorities: (s.priorities || []).filter((p) => !blank([p]))
  };
}

/** Spec §6 validation — returns human-readable errors, empty when valid. */
export function validateWeeklySummary(
  summary: WeeklySummary,
  weekStart?: string,
  weekEnd?: string
): string[] {
  const errs: string[] = [];

  if (!summary.weekStatus) errs.push('Section A: choose the overall week status.');

  if (summary.hadMeetings === null) {
    errs.push('Section B: answer "Did you have any meeting this week?"');
  } else if (summary.hadMeetings) {
    // Empty entries are stripped before this runs (spec §6).
    if (summary.meetings.length === 0) {
      errs.push('Section B: add at least one meeting.');
    }
    summary.meetings.forEach((m, i) => {
      const nm = m.title.trim() ? `"${m.title.trim()}"` : `Meeting ${i + 1}`;
      const missing = [m.title, m.date, m.type, m.attendees].some((v) => !String(v).trim());
      if (missing) errs.push(`Section B, ${nm}: complete all required fields.`);
      if (!m.minutesUrl) errs.push(`Section B, ${nm}: minutes of meeting are not attached.`);
      if (m.date && weekStart && weekEnd && (m.date < weekStart || m.date > weekEnd)) {
        errs.push(`Section B, ${nm}: meeting date must fall inside the report week.`);
      }
    });
  }

  if (!summary.noProblems) {
    if (summary.problems.length === 0) {
      errs.push(
        'Section C: tick "No problems or issues this week" or add at least one problem.'
      );
    }
    summary.problems.forEach((p, i) => {
      if (
        !p.title.trim() ||
        !p.category ||
        !p.severity ||
        !p.description.trim() ||
        !p.state
      ) {
        errs.push(`Section C, Problem ${i + 1}: complete all required fields.`);
      }
    });
  }

  summary.needs.forEach((n, i) => {
    if (!n.what.trim() || !n.from) errs.push(`Section E, Request ${i + 1}: complete all required fields.`);
    if (n.by && weekStart && n.by < weekStart) {
      errs.push(`Section E, Request ${i + 1}: "Needed by" cannot be earlier than the week start.`);
    }
  });

  summary.ideas.forEach((s, i) => {
    if (!s.suggestion.trim() || !s.area) {
      errs.push(`Section F, Suggestion ${i + 1}: complete all required fields.`);
    }
  });

  if (!summary.confirmed) errs.push('Section J: tick the confirmation.');

  return errs;
}
