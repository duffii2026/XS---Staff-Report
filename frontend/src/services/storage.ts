/**
 * API-backed data layer.
 *
 * All data is hydrated from the live backend at boot (`initStorage()`),
 * cached in-memory, and every mutation is ALSO pushed to the API. No
 * localStorage, no mock data. The exported function surface is intentionally
 * identical to the legacy local-first layer so all views keep working.
 */
import {
  User, UserPermissions, RoleTemplate, WeeklyReport, TRSTask, ActivityLog,
  ChecklistItem, SubmittedChecklistItem, NotificationItem, AppraisalRecord, SignatureData,
  UserRole, MultiProofData, ScoreDispute, TRSTaskComment, AnnouncementNotice,
  NoticeReadReceipt, OnboardingStatus, UnlockAuditTrail, TRSExtensionRequest,
  ChecklistItemStatus, OrgConfigEntry, OrgConfigKind, WeeklySummary
} from '../types';
import { api, getSession, logout, resolveSignature } from './api';
import { normalizeFrequency, DEFAULT_FREQUENCY, defaultItemStatus } from '../utils/checklistFrequency';
import type { SessionUser } from './api';
import { getWeekDateRange, getTRSubmissionDeadline, toUtcIso } from '../utils/dateUtils';
import { DEPARTMENTS, COMPANY_POSITIONS } from '../data/mockData';

// Convert short-lived S3 (presigned) URLs — e.g. https://<bucket>.s3.<region>.amazonaws.com/reportupload/signature_x.png?... —
// and absolute app-routed URLs (e.g. http://localhost:3000/reportupload/...) into the app's
// stable, non-expiring /reportupload/<name> route. Left as-is otherwise.
function normalizeSignatureUrl(dataUrl?: string): string | undefined {
  if (!dataUrl) return dataUrl;
  const s3Match = dataUrl.match(/amazonaws\.com\/([^?]+)/i);
  if (s3Match) {
    const name = s3Match[1].replace(/\/+/g, '/');
    if (name) return `/${name}`;
  }
  const routedMatch = dataUrl.match(/^https?:\/\/[^/]+\/(reportupload\/[^?]+)/i);
  if (routedMatch) {
    const name = routedMatch[1].replace(/\/+/g, '/');
    if (name) return `/${name}`;
  }
  return dataUrl;
}

function normalizeSig(sig?: { dataUrl?: string } & Record<string, unknown>): any {
  if (!sig) return sig;
  const d = sig.dataUrl as string;
  if (d && (d.includes('amazonaws.com') || /^https?:\/\/[^/]+\/reportupload\//i.test(d))) {
    return { ...sig, dataUrl: normalizeSignatureUrl(d) };
  }
  return sig;
}

// ---------------------------------------------------------------
// In-memory caches
// ---------------------------------------------------------------
let _users: User[] = [];
let _templates: RoleTemplate[] = [];
let _reports: WeeklyReport[] = [];
let _trs: TRSTask[] = [];
let _appraisals: AppraisalRecord[] = [];
let _notifications: NotificationItem[] = [];
let _logs: ActivityLog[] = [];
let _signatures: SignatureData[] = [];
let _notices: AnnouncementNotice[] = [];
let _orgConfig: OrgConfigEntry[] = [];
let _orgConfigLoaded = false;
let _currentUser: User | null = null;
let _hydratePromise: Promise<void> | null = null;
let _hydrateToken = 0;
let _reloadPromise: Promise<void> | null = null;
let _reloadPending = false;
const _orgConfigListeners = new Set<() => void>();

interface DraftCacheEntry {
  checklistItems: SubmittedChecklistItem[];
  notes?: string;
  summary?: WeeklySummary;
  signature?: SignatureData;
  multiProof?: MultiProofData;
  lastSavedAt?: string;
}
let _trDrafts: Record<string, DraftCacheEntry> = {};

// ---------------------------------------------------------------
// Adapters: backend row (snake_case) -> frontend domain type
// ---------------------------------------------------------------
function permissionsMap(perms?: Record<string, boolean>): UserPermissions | undefined {
  if (!perms) return undefined;
  return {
    submitTRReport: !!perms.submitTRReport,
    viewTeamTRReports: !!perms.viewTeamTRReports,
    submitTRSTasks: !!perms.submitTRSTasks,
    evaluatePerformance: !!perms.evaluatePerformance,
    approveAppraisals: !!perms.approveAppraisals,
    manageUsers: !!perms.manageUsers,
    manageTemplates: !!perms.manageTemplates,
    viewAuditLogs: !!perms.viewAuditLogs
  };
}

function adaptUser(r: any, permissions?: Record<string, boolean>): User {
  let onboarding: OnboardingStatus | undefined;
  if (r.onboarding && typeof r.onboarding === 'object') onboarding = r.onboarding as OnboardingStatus;
  else if (typeof r.onboarding === 'string') {
    try { onboarding = JSON.parse(r.onboarding); } catch { onboarding = undefined; }
  }
  return {
    id: r.code,
    username: r.username,
    name: r.name,
    email: r.email || '',
    role: (r.role || 'staff') as UserRole,
    department: r.department || '',
    position: r.position || '',
    superiorId: r.superior_id ?? null,
    avatarUrl: r.avatar_url || undefined,
    permissions: permissionsMap(permissions || r.permissions),
    telegramChatId: r.telegram_chat_id || undefined,
    telegramUsername: r.telegram_username || undefined,
    telegramConnectedAt: r.telegram_connected_at || undefined,
    onboarding,
    mustChangePassword: !!(r.must_change_password || r.mustChangePassword)
  };
}

function adaptNotice(r: any): AnnouncementNotice {
  const receipts: NoticeReadReceipt[] = Array.isArray(r.read_receipts)
    ? r.read_receipts.map((x: any) => ({
        userId: x.user_id || x.userId,
        userName: x.user_name || x.userName || '',
        userRole: (x.user_role || x.userRole || 'staff') as UserRole,
        department: x.department || '',
        readAt: x.read_at || x.readAt || r.created_at || ''
      }))
    : [];
  return {
    id: r.code || r.id,
    title: r.title || '',
    content: r.content || '',
    priority: (r.priority || 'standard') as AnnouncementNotice['priority'],
    category: (r.category || 'General') as AnnouncementNotice['category'],
    authorId: r.author_id || r.authorId || 'system',
    authorName: r.author_name || r.authorName || 'APA Governance',
    authorRole: (r.author_role || r.authorRole || 'admin') as UserRole,
    departmentScope: r.department_scope || r.departmentScope || 'all',
    createdAt: r.created_at || r.createdAt || new Date().toISOString(),
    readReceipts: receipts,
    isPinned: !!(r.is_pinned ?? r.isPinned)
  };
}

function adaptTemplate(r: any): RoleTemplate {
  return {
    id: r.code,
    positionTitle: r.position_title,
    department: r.department || 'All Departments',
    // Stored categories pass through normalizeFrequency so legacy/hand-typed
    // values ('yearly', 'Annual', 'on demand', ...) resolve to a canonical
    // ChecklistFrequency — otherwise a stray casing silently skipped every
    // frequency guard in the report form.
    items: Array.isArray(r.items)
      ? r.items.map((it: any) =>
          it && it.category ? { ...it, category: normalizeFrequency(it.category) } : it
        )
      : [],
    lastUpdated: r.last_updated || r.updated_at?.slice?.(0, 10) || new Date().toISOString().split('T')[0]
  };
}

function adaptReport(r: any): WeeklyReport {
  const sig = normalizeSig(r.signature_display || r.signature);
  const multiProof = r.multiProof || r.multi_proof;
  const dispute = r.dispute;
  return {
    id: r.code,
    staffId: r.staff_code,
    staffName: r.staff_name,
    department: r.department || '',
    position: r.position || '',
    superiorId: r.superior_code ?? null,
    year: Number(r.year),
    quarter: Number(r.quarter),
    month: Number(r.month),
    weekNumber: Number(r.week_number),
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    submissionDate: r.submission_date || '',
    checklistItems: Array.isArray(r.checklistItems) ? r.checklistItems : [],
    trScore: Number(r.tr_score) || 0,
    completionScore: r.completion_score != null ? Number(r.completion_score) : undefined,
    timelinessScore: r.timeliness_score != null ? Number(r.timeliness_score) : undefined,
    qualityScore: r.quality_score != null ? Number(r.quality_score) : undefined,
    signature: sig || undefined,
    notes: r.notes || undefined,
    aiSummary: r.ai_summary || undefined,
    status: (r.status || 'Draft') as WeeklyReport['status'],
    managerFeedback: r.manager_feedback || undefined,
    reviewDate: r.review_date || undefined,
    delayReason: r.delay_reason || undefined,
    latePenaltyWaived: r.late_penalty_waived ? true : undefined,
    waivedBy: r.waived_by || undefined,
    waivedByName: r.waived_by_name || undefined,
    multiProof,
    dispute,
    escalatedTo: r.escalated_to || undefined,
    escalatedToName: r.escalated_to_name || undefined,
    escalationLevel: (r.escalation_level || r.escalationLevel || undefined) as WeeklyReport['escalationLevel'],
    escalatedAt: r.escalated_at || undefined,
    approvedDeadline: r.approvedDeadline || r.approved_deadline || undefined,
    extensionRequest: r.extensionRequest || r.extension_request || undefined,
    extensionHistory: r.extensionHistory || r.extension_history || undefined
  };
}

function adaptTRS(r: any): TRSTask {
  const multiProof = r.multiProof || r.multi_proof;
  const dispute = r.dispute;
  return {
    id: r.code,
    title: r.title,
    assignedBy: r.assigned_by,
    assignedByName: r.assigned_by_name,
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_to_name,
    department: r.department || '',
    description: r.description || '',
    assignedDate: r.assigned_date || '',
    deadline: r.deadline || '',
    code: r.task_code || undefined,
    project: r.project || undefined,
    priority: (r.priority as TRSTask['priority']) || undefined,
    progress: r.progress != null ? Number(r.progress) : undefined,
    instructions: r.instructions || undefined,
    scope: r.scope || undefined,
    qualityCriteria: r.quality_criteria || undefined,
    status: (r.status || 'Pending') as TRSTask['status'],
    evaluationStatus: r.evaluation_status as TRSTask['evaluationStatus'] || undefined,
    evaluationDate: r.evaluation_date || undefined,
    evaluatedBy: r.evaluated_by || undefined,
    completionDate: r.completion_date || undefined,
    score: r.score != null ? Number(r.score) : undefined,
    feedback: r.feedback || undefined,
    staffRemarks: r.staff_remarks || undefined,
    submissionNotes: r.submission_notes || undefined,
    delayReason: r.delay_reason || undefined,
    timelinessScore: r.timeliness_score != null ? Number(r.timeliness_score) : undefined,
    qualityScore: r.quality_score != null ? Number(r.quality_score) : undefined,
    instructionScore: r.instruction_score != null ? Number(r.instruction_score) : undefined,
    scopeScore: r.scope_score != null ? Number(r.scope_score) : undefined,
    accuracyScore: r.accuracy_score != null ? Number(r.accuracy_score) : undefined,
    latePenaltyWaived: r.late_penalty_waived ? true : undefined,
    isDefaulted: !!r.isDefaulted || !!r.is_defaulted,
    defaultedAt: r.defaultedAt || r.defaulted_at || undefined,
    unlockHistory: Array.isArray(r.unlockHistory) ? r.unlockHistory : (Array.isArray(r.unlock_history) ? r.unlock_history : undefined),
    revisionCount: r.revision_count != null ? Number(r.revision_count) : undefined,
    proofUrl: r.proof_url || undefined,
    submittedAt: r.submitted_at || undefined,
    signature: normalizeSig(r.signature_display || r.signature) || undefined,
    multiProof,
    dispute,
    comments: Array.isArray(r.comments) ? r.comments : undefined,
    revisionHistory: r.revisionHistory || r.revision_history || undefined,
    isEscalated: r.isEscalated ?? !!r.is_escalated,
    escalatedTo: r.escalated_to || undefined,
    escalatedToName: r.escalated_to_name || undefined,
    escalatedReason: r.escalated_reason || undefined,
    escalatedAt: r.escalated_at || undefined,
    escalationLevel: (r.escalation_level || r.escalationLevel || undefined) as TRSTask['escalationLevel']
  };
}

const NOTIF_TYPE_MAP: Record<string, NotificationItem['type']> = {
  REPORT_SUBMITTED: 'REPORT_SUBMITTED',
  REPORT_REVIEWED: 'REPORT_REVIEWED',
  REPORT_APPROVED: 'REPORT_REVIEWED',
  REPORT_DELETED: 'REPORT_DELETED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_UPDATED: 'TASK_UPDATED',
  TRS_ASSIGNED: 'TASK_ASSIGNED',
  TRS_SUBMITTED: 'TASK_UPDATED',
  TRS_EVALUATED: 'TASK_UPDATED',
  TRS_REVISION: 'TASK_UPDATED',
  TRS_DEADLINE: 'DEADLINE_ALERT',
  APPRAISAL_SIGNED: 'APPRAISAL_SIGNED',
  APPRAISAL_APPROVED: 'APPRAISAL_APPROVED',
  APPRAISAL_PENDING: 'APPRAISAL_SIGNED',
  SYSTEM: 'SYSTEM',
  DEADLINE_ALERT: 'DEADLINE_ALERT'
};

function adaptNotification(r: any): NotificationItem {
  const linkTab = (r.link_tab || '') as string;
  return {
    id: r.code,
    timestamp: toUtcIso(r.created_at || r.createdAt || ''),
    recipientUserId: r.recipient_user_code || 'all',
    senderId: r.sender_code || 'system',
    senderName: r.sender_name || 'APA System',
    type: NOTIF_TYPE_MAP[r.type || 'SYSTEM'] || 'SYSTEM',
    title: r.title || '',
    message: r.message || '',
    read: !!r.is_read,
    linkTab: (linkTab === 'appraisal' ? 'evaluation' : linkTab) as NotificationItem['linkTab']
  };
}

function adaptLog(r: any): ActivityLog {
  return {
    id: r.code,
    timestamp: r.created_at || r.createdAt || '',
    userId: r.user_code || '',
    username: r.username || 'system',
    userRole: r.user_role || '',
    action: r.action || '',
    details: r.details || '',
    ipAddress: r.ip_address || undefined
  };
}

function adaptAppraisal(r: any): AppraisalRecord {
  const prepared = normalizeSig(r.prepared_signature_display || r.prepared_signature);
  const approved = normalizeSig(r.approved_signature_display || r.approved_signature);
  return {
    id: r.code,
    staffId: r.staff_code,
    staffName: r.staff_name,
    department: r.department || '',
    position: r.position || '',
    year: r.period_year != null ? Number(r.period_year) : undefined,
    periodYear: r.period_year != null ? Number(r.period_year) : undefined,
    periodQuarter: r.period_quarter || undefined,
    periodMonth: r.period_month || undefined,
    period: r.period || undefined,
    trScore: Number(r.tr_score) || 0,
    trsScore: Number(r.trs_score) || 0,
    overallScore: Number(r.overall_score) || 0,
    signatureMode: (r.signature_mode || 'digital') as AppraisalRecord['signatureMode'],
    status: (r.status || 'Draft') as AppraisalRecord['status'],
    preparedByUserId: r.prepared_by_user_code || undefined,
    preparedByName: r.prepared_by_name || undefined,
    preparedByRole: r.prepared_by_role || undefined,
    preparedSignature: prepared || undefined,
    preparedBySignature: prepared || undefined,
    preparedDate: r.prepared_date || undefined,
    preparedNotes: r.prepared_notes || undefined,
    approvedByUserId: r.approved_by_user_code || undefined,
    approvedByName: r.approved_by_name || undefined,
    approvedByRole: r.approved_by_role || undefined,
    approvedSignature: approved || undefined,
    approvedBySignature: approved || undefined,
    approvedDate: r.approved_date || undefined,
    approvedNotes: r.approved_notes || undefined,
    createdAt: r.created_at || r.createdAt || '',
    updatedAt: r.updated_at || r.updatedAt || ''
  };
}

// ---------------------------------------------------------------
// Hydration (one-time, idempotent)
// ---------------------------------------------------------------
const HYDRATE_MAX_ATTEMPTS = 3;
const HYDRATE_RETRY_DELAY_MS = 700;

export type HydrateStatus = 'idle' | 'loading' | 'ready';
type HydrateListener = (status: HydrateStatus) => void;
const _hydrateListeners = new Set<HydrateListener>();

/** Subscribe to hydration activity (boot + reloads). Returns an unsubscribe fn. */
export function subscribeHydration(listener: HydrateListener): () => void {
  _hydrateListeners.add(listener);
  return () => { _hydrateListeners.delete(listener); };
}

function notifyHydration(status: HydrateStatus) {
  _hydrateListeners.forEach((l) => { try { l(status); } catch { /* ignore */ } });
}

async function fetchCached<T>(key: string, pull: () => Promise<T>, set: (v: T) => void, token?: number) {
  let lastErr: any;
  for (let attempt = 1; attempt <= HYDRATE_MAX_ATTEMPTS; attempt++) {
    try {
      const rows = await pull();
      // A newer hydration (e.g. a progress save that triggered reloadStorage)
      // must win: never let an older, slower request overwrite fresher data.
      if (token === undefined || token === _hydrateToken) set(rows);
      return;
    } catch (err: any) {
      lastErr = err;
      const status = err?.status;
      if (status === 401 || status === 403 || status === 404) break; // permanent — don't retry
      if (attempt < HYDRATE_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, HYDRATE_RETRY_DELAY_MS * attempt));
      }
    }
  }
  if (lastErr && lastErr?.status !== 401 && lastErr?.status !== 403 && lastErr?.status !== 404) {
    console.error(`[storage] hydrate ${key} failed:`, lastErr?.message || lastErr);
  }
}

async function hydrateSession(): Promise<void> {
  try {
    const session = await getSession();
    if (session?.user) {
      _currentUser = adaptUser(session.user, session.permissions);
    } else {
      _currentUser = null;
    }
  } catch {
    // Transient network/timeout failure: keep the user we already have instead
    // of blanking the session. A real expiry surfaces via the api layer's 401
    // retry and the global "Session Expired" dialog.
  }
}

async function hydrateData(token: number): Promise<void> {
  const p = _currentUser?.permissions;

  const tasks: Promise<void>[] = [
    fetchCached('users', () => api.get<any[]>('/users').then((rows) => rows.map((r) => adaptUser(r, r.permissions))), (v) => { _users = v; }, token),
    fetchCached('templates', () => api.get<any[]>('/templates').then((rows) => rows.map(adaptTemplate)), (v) => { _templates = v; }, token),
    fetchCached('reports', () => api.get<any[]>('/reports').then((rows) => rows.map(adaptReport)), (v) => { _reports = v; }, token),
    fetchCached('trs', () => api.get<any[]>('/trs').then((rows) => rows.map(adaptTRS)), (v) => { _trs = v; }, token),
    fetchCached('signatures', () => getSavedSignaturesFromApi(), (v) => { _signatures = v; }, token),
    fetchCached('notices', () => api.get<any[]>('/notices').then((rows) => rows.map(adaptNotice)), (v) => { _notices = v; }, token),
    fetchCached('notifications', () => api.get<any[]>('/notifications').then((rows) => rows.map(adaptNotification)), (v) => { _notifications = v; }, token),
    // Master department/position lists. Uses its own try/catch inside
    // refreshOrgConfig so a missing migrate_v5.sql doesn't fail the whole boot.
    (async () => { await refreshOrgConfig(); })()
  ];

  // Permission-gated datasets — only fetch what the user can actually see,
  // so logins don't wait on endpoints that would 401/403 anyway.
  // All roles can open the Performance Evaluation tab; the endpoint scopes each
  // user to their own appraisal plus their subordinates.
  tasks.push(fetchCached('appraisals', () => api.get<any[]>('/appraisals').then((rows) => rows.map(adaptAppraisal)), (v) => { _appraisals = v; }, token));
  if (p?.viewAuditLogs) {
    tasks.push(fetchCached('audit', () => api.get<{ rows: any[] }>('/audit?limit=100').then((d) => d.rows.map(adaptLog)), (v) => { _logs = v; }, token));
  }
  if (p?.submitTRReport) {
    tasks.push(fetchCached('drafts', () => api.get<any[]>('/reports/drafts').then((rows) => {
      const map: Record<string, DraftCacheEntry> = {};
      for (const r of rows) {
        const key = `${r.staff_code || r.staffCode}_${r.year}_${r.week_number}`;
        map[key] = {
          checklistItems: Array.isArray(r.draft?.checklistItems) ? r.draft.checklistItems : [],
          notes: r.draft?.notes,
          summary: r.draft?.summary,
          signature: r.draft?.signature,
          multiProof: r.draft?.multiProof,
          lastSavedAt: r.last_saved_at || r.lastSavedAt
        };
      }
      return map;
    }), (v) => { _trDrafts = v; }, token));
  }

  await Promise.all(tasks);
}

async function hydrate(): Promise<void> {
  const token = ++_hydrateToken;
  await hydrateSession();

  // Guests can't reach any data endpoint (401/403) — the login page only
  // needs the session check, so skip the rest to make boot near-instant.
  if (!_currentUser) return;

  await hydrateData(token);

  // Run the auto-lock scan on every login/open (staff scan their own tasks,
  // admin/HR/executive scan all) and refresh the TRS cache so newly locked
  // cards appear. This is fire-and-forget: it must NOT delay the ready signal
  // (the Loading screen) — the daemon also re-runs the scan hourly.
  void (async () => {
    try {
      await api.post<{ locked?: number }>('/trs/scan-lock');
      const rows = await api.get<any[]>('/trs');
      if (token === _hydrateToken) _trs = rows.map(adaptTRS);
    } catch { /* non-blocking */ }
  })();
}

async function getSavedSignaturesFromApi(): Promise<SignatureData[]> {
  try {
    const rows = await api.get<any[]>('/signatures');
    return rows.map((r) => ({
      type: (r.sig_type || 'handwritten') as SignatureData['type'],
      dataUrl: normalizeSignatureUrl(r.displayUrl) || '',
      signedAt: r.signed_at || '',
      signeeName: r.signee_name || ''
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
export function initStorage(): Promise<void> {
  if (!_hydratePromise) {
    _hydratePromise = (async () => {
      notifyHydration('loading');
      try {
        await hydrate();
      } finally {
        notifyHydration('ready');
      }
    })();
    // release the resolved promise so getters during boot don't block
    const p = _hydratePromise;
    const reset = () => { if (_hydratePromise === p) _hydratePromise = null; };
    p.then(reset, reset);
  }
  return _hydratePromise;
}

/**
 * Re-hydrate after a mutation, collapsing bursts into at most one extra pass.
 * While a reload is running, later calls set a pending flag instead of starting
 * another hydration; the running loop repeats once so the last mutation is
 * always reflected, and every caller awaits the same promise.
 */
export function reloadStorage(): Promise<void> {
  if (_reloadPromise) {
    _reloadPending = true;
    return _reloadPromise;
  }
  const run = async () => {
    do {
      _reloadPending = false;
      _hydratePromise = null;
      await initStorage();
    } while (_reloadPending);
  };
  const p = run();
  _reloadPromise = p;
  const reset = () => { if (_reloadPromise === p) _reloadPromise = null; };
  p.then(reset, reset);
  return p;
}

// Consolidated cache getters (sync — components rely on sync reads after boot)
export function getCacheState() {
  return {
    users: _users, templates: _templates, reports: _reports, trs: _trs,
    appraisals: _appraisals, notifications: _notifications, logs: _logs,
    signatures: _signatures, currentUser: _currentUser
  };
}

// ---------------------------------------------------------------
// Current User Session
// ---------------------------------------------------------------
export function getCurrentUser(): User | null {
  return _currentUser;
}

/** Map a login/session payload into the domain User (used right after api.login). */
export function userFromSession(sessionUser: SessionUser, permissions?: Record<string, boolean>): User {
  return adaptUser(sessionUser, permissions);
}

export function setCurrentUser(user: User) {
  _currentUser = user;
}

export async function logoutUser() {
  try { await logout(); } catch { /* 401 on logout is fine */ }
  _currentUser = null;
  _users = []; _templates = []; _reports = []; _trs = []; _appraisals = [];
  _notifications = []; _logs = []; _signatures = [];
  _orgConfig = []; _orgConfigLoaded = false;
  _hydratePromise = null;
}

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------
export function getUsers(): User[] {
  return _users;
}

/** Re-pull the users list from the backend (targeted refresh — no full storage reload). */
export async function refreshUsers(): Promise<void> {
  try {
    const rows = await api.get<any[]>('/users');
    _users = rows.map((r) => adaptUser(r, r.permissions));
  } catch { /* keep current local copy on failure */ }
}

/**
 * Re-pull only the T&R reports list from the backend.
 * Targeted refresh used when the T&R tab is re-activated: the view stays
 * mounted (hidden) across tab switches, so without this the list can show
 * stale or missing rows until a full page reload. Unlike reloadStorage() this
 * does NOT re-check the session or touch any other dataset.
 */
export async function refreshReports(): Promise<void> {
  try {
    const rows = await api.get<any[]>('/reports');
    _reports = rows.map(adaptReport);
  } catch { /* keep current local copy on failure */ }
}

export function saveUsers(users: User[]) {
  _users = users;
}

export async function createUser(
  newUser: Omit<User, 'id'>,
  actingAdmin: User
): Promise<{ created: User; message: string }> {
  const clean = (s: string) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const id = `user_${clean(newUser.username)}_${Date.now().toString(36)}`;
  await api.post('/users', {
    username: newUser.username,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    department: newUser.department,
    position: newUser.position,
    superior_id: newUser.superiorId || null,
    password: newUser.password || null
  });
  const created: User = { ...newUser, id };
  if (!_users.some((u) => u.id === created.id)) {
    _users = [..._users, created];
  }
  return {
    created,
    message: `Created user account for ${created.name} (@${created.username}). Temp login set — staff must change it on first login.`
  };
}

export function updateUserPassword(userId: string, newPw: string, actingAdmin: User) {
  api.put(`/users/${userId}/password`, {
    newPassword: newPw
  }).catch((e) => console.error('updateUserPassword:', e));
}

export async function changeMyPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  try {
    await api.put(`/users/${userId}/password`, {
      currentPassword,
      newPassword
    });
    return { success: true, message: 'Password changed successfully.' };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to change password.' };
  }
}

/** Set a new password for a user flagged as "must change password" (first login / admin reset). No current password required. */
export async function changeForcedPassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; message: string; user: User | null }> {
  try {
    await api.put(`/users/${userId}/password`, { newPassword });
    if (_currentUser && _currentUser.id === userId) {
      _currentUser = { ..._currentUser, mustChangePassword: false };
    }
    return { success: true, message: 'Password updated successfully.', user: _currentUser };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to change password.', user: null };
  }
}

export function updateUser(userId: string, updatedFields: Partial<User>, actingAdmin: User): User | null {
  const idx = _users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const updated = { ..._users[idx], ...updatedFields };
  _users[idx] = updated;
  if (_currentUser?.id === userId) _currentUser = updated;

  api.put(`/users/${userId}`, {
    name: updated.name, email: updated.email, department: updated.department,
    position: updated.position, avatar_url: updated.avatarUrl,
    role: updated.role, superior_id: updated.superiorId,
    telegram_chat_id: updated.telegramChatId
  }).catch((e) => console.error('updateUser:', e));
  return updated;
}

export interface RevealedCredential {
  code: string;
  username: string;
  name: string;
  password: string;
}

/** Fetch a user's plaintext password. Admin only — the server re-verifies the
 *  acting admin's own password and audit logs the reveal. The returned value is
 *  a live credential: never persist it, and let the caller clear it on a timer. */
export async function revealUserPassword(userId: string, adminPassword: string): Promise<RevealedCredential> {
  return api.post<RevealedCredential>(`/users/${userId}/reveal-password`, { adminPassword });
}

export function updateUserTelegramConnection(
  userId: string,
  telegramChatId?: string,
  telegramUsername?: string
): User | null {
  const upd = updateUser(userId, {
    telegramChatId: telegramChatId?.trim() || undefined,
    telegramUsername: telegramUsername?.trim() || undefined,
    telegramConnectedAt: telegramChatId ? new Date().toISOString() : undefined
  }, _currentUser || ({ id: 'self', role: 'staff' } as User));
  api.put('/telegram/me', { telegram_chat_id: telegramChatId?.trim() || null, telegram_username: telegramUsername?.trim() || null })
    .catch((e) => console.error('tg me:', e));
  return upd;
}

export function updateUserPermissions(
  userId: string,
  newPermissions: UserPermissions,
  actingAdmin: User
): User | null {
  const idx = _users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const updated = { ..._users[idx], permissions: newPermissions };
  _users[idx] = updated;
  if (_currentUser?.id === userId) _currentUser = updated;

  api.put(`/users/${userId}/permissions`, { permissions: newPermissions })
    .catch((e) => console.error('updateUserPermissions:', e));
  return updated;
}

/** Re-apply the role-default permission matrix (Admin Console) to every active user. */
export async function syncPermissionsMatrix(): Promise<{ synced: number }> {
  const res = await api.post<{ synced: number }>('/users/permissions/sync');
  await reloadStorage();
  return res;
}

/** Refresh the current user/storage state from the backend. */
export function refreshState(): void {
  hydrate();
}

export async function deleteUser(userId: string, actingAdmin: User): Promise<{ success: boolean; message: string }> {
  if (userId === actingAdmin.id) return { success: false, message: 'You cannot delete your own active account.' };
  const targetUser = _users.find((u) => u.id === userId);
  if (!targetUser) return { success: false, message: 'User account not found.' };
  try {
    await api.del(`/users/${userId}`);
    _users = _users.filter((u) => u.id !== userId).map((u) => (u.superiorId === userId ? { ...u, superiorId: null } : u));
    return { success: true, message: `Successfully deactivated staff account for ${targetUser.name} (@${targetUser.username}).` };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to deactivate staff account.' };
  }
}

// ---------------------------------------------------------------
// Templates
// ---------------------------------------------------------------
export function getRoleTemplates(): RoleTemplate[] {
  return _templates;
}

export function getTemplateForPosition(positionTitle?: string, department?: string): RoleTemplate | undefined {
  const templates = _templates;
  const pos = (positionTitle || '').toLowerCase().trim();
  const dept = (department || '').toLowerCase().trim();
  if (!pos) return undefined;
  if (dept) {
    const exact = templates.find((t) => t.positionTitle.toLowerCase().trim() === pos && (t.department || '').toLowerCase().trim() === dept);
    if (exact) return exact;
  }
  return templates.find(
    (t) => t.positionTitle.toLowerCase().trim() === pos &&
      ['all', 'all departments', 'all departments (company-wide)', 'general', 'company-wide', ''].includes((t.department || '').toLowerCase().trim())
  );
}

export function checkTemplateExists(
  positionTitle: string,
  department: string,
  excludeId?: string | null,
  excludeKey?: { positionTitle: string; department: string } | null
): boolean {
  const targetPos = positionTitle.toLowerCase().trim();
  const targetDept = (department || '').toLowerCase().trim();
  const exPos = excludeKey ? excludeKey.positionTitle.toLowerCase().trim() : null;
  const exDept = excludeKey ? (excludeKey.department || '').toLowerCase().trim() : null;
  return _templates.some((t) => {
    if (excludeId && t.id === excludeId) return false;
    // Duplicates are blocked when templates are created, so position + department
    // uniquely identifies one. Excluding on that pair too means a template can never
    // be reported as a duplicate of itself, even if the id it was opened with is stale.
    if (exPos !== null &&
        t.positionTitle.toLowerCase().trim() === exPos &&
        (t.department || '').toLowerCase().trim() === exDept) return false;
    return t.positionTitle.toLowerCase().trim() === targetPos && (t.department || '').toLowerCase().trim() === targetDept;
  });
}

export function saveRoleTemplate(template: RoleTemplate, actingUser: User) {
  const seen = new Set<string>();
  template.items = template.items.filter((it) => {
    const key = `${(it.category || 'Weekly').toLowerCase()}:${(it.title || it.description || '').toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const idx = _templates.findIndex(
    (t) => t.id === template.id ||
      (t.positionTitle.toLowerCase().trim() === template.positionTitle.toLowerCase().trim() &&
        (t.department || '').toLowerCase().trim() === (template.department || '').toLowerCase().trim())
  );
  if (idx !== -1) {
    _templates[idx] = { ..._templates[idx], ...template, id: _templates[idx].id };
    api.put(`/templates/${_templates[idx].id}`, {
      position_title: template.positionTitle, department: template.department, items: template.items
    }).catch((e) => console.error('tpl upd:', e));
  } else {
    const withId = { ...template, id: template.id || `tmpl_${Date.now()}` };
    _templates = [..._templates, withId];
    api.post('/templates', {
      position_title: template.positionTitle, department: template.department, items: template.items
    }).then((created: any) => {
      // The server mints the authoritative code. Adopt it immediately instead of
      // leaving a client-side tmpl_<timestamp> id in play: the list, the editor's
      // editingTemplateId, and checkTemplateExists() must all agree on one identifier.
      const serverCode = created?.code;
      if (serverCode && serverCode !== withId.id) {
        _templates = _templates.map(t => t.id === withId.id ? { ...t, id: serverCode } : t);
      }
      return reloadStorage();
    }).catch((e) => console.error('tpl new:', e));
  }
}

export function deleteRoleTemplate(templateId: string, actingUser: User) {
  _templates = _templates.filter((t) => t.id !== templateId);
  api.del(`/templates/${templateId}`).catch((e) => console.error('tpl del:', e));
}

export function exportTemplateCSV(template: RoleTemplate): string {
  const headers = ['Category', 'Deliverable Description'];
  const rows = template.items.map((item) => [`"${item.category}"`, `"${(item.title || item.description || '').replace(/"/g, '""')}"`]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export interface TemplateImportResult {
  template: RoleTemplate;
  itemCount: number;
  duplicatesSkipped: number;
  isExisting: boolean;
}

export function parseAndImportTemplateCSV(
  csvText: string,
  positionTitle: string,
  department: string,
  actingUser: User
): TemplateImportResult | null {
  const rawLines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const items: ChecklistItem[] = [];
  const seen = new Set<string>();
  let duplicatesSkipped = 0;

  const parseCSVLine = (text: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; }
      else cur += char;
    }
    result.push(cur.trim());
    return result;
  };

  const startIdx = rawLines.length > 0 && (rawLines[0].toLowerCase().includes('category') || rawLines[0].toLowerCase().includes('deliverable')) ? 1 : 0;
  for (let i = startIdx; i < rawLines.length; i++) {
    const cols = parseCSVLine(rawLines[i]);
    if (cols.length >= 2) {
      const category = normalizeFrequency(cols[0]);
      const title = cols[1].trim();
      if (title.length > 0) {
        const key = `${category.toLowerCase()}:${title.toLowerCase()}`;
        if (seen.has(key)) duplicatesSkipped++;
        else {
          seen.add(key);
          items.push({ id: `item_${Date.now()}_${i}`, category, title, weight: 1 });
        }
      }
    } else if (cols.length === 1 && cols[0].trim().length > 0) {
      // Single-column CSV: no category given, so the deliverable is a fixed routine.
      const title = cols[0].trim();
      const key = `${DEFAULT_FREQUENCY.toLowerCase()}:${title.toLowerCase()}`;
      if (seen.has(key)) duplicatesSkipped++;
      else {
        seen.add(key);
        items.push({ id: `item_${Date.now()}_${i}`, category: DEFAULT_FREQUENCY, title, weight: 1 });
      }
    }
  }

  if (items.length === 0) return null;

  const existing = getTemplateForPosition(positionTitle, department);
  const isExisting = !!existing;
  const newTemplate: RoleTemplate = {
    id: existing ? existing.id : `tmpl_${Date.now()}`,
    positionTitle,
    department,
    items,
    lastUpdated: new Date().toISOString().split('T')[0]
  };
  saveRoleTemplate(newTemplate, actingUser);
  return { template: newTemplate, itemCount: items.length, duplicatesSkipped, isExisting };
}

// ---------------------------------------------------------------
// Reports
// ---------------------------------------------------------------
export function getReports(): WeeklyReport[] {
  return _reports;
}

export function getSubordinateUserIds(userId: string): Set<string> {
  // Adjacency map built in one pass, then a BFS down the chain. The previous
  // fixpoint rescanned every user until nothing changed, which is O(users x
  // depth) and ran on nearly every TRReportView render (via the 5
  // getVisibleReportsForUser calls and 3 direct calls). BFS is O(users) and is
  // also cycle-safe: a malformed org chart with a reporting loop terminates
  // instead of spinning.
  const childrenOf = new Map<string, string[]>();
  for (const u of _users) {
    if (!u.superiorId) continue;
    const sibs = childrenOf.get(u.superiorId);
    if (sibs) sibs.push(u.id);
    else childrenOf.set(u.superiorId, [u.id]);
  }

  const out = new Set<string>();
  const queue: string[] = [userId];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    const kids = childrenOf.get(id);
    if (!kids) continue;
    for (const kid of kids) {
      if (out.has(kid)) continue;
      out.add(kid);
      queue.push(kid);
    }
  }
  return out;
}

export function getVisibleReportsForUser(currentUser: User): WeeklyReport[] {
  if (['admin', 'executive', 'hr'].includes(currentUser.role)) return [..._reports];
  const subIds = getSubordinateUserIds(currentUser.id);
  // Hoisted out of the filter: the old body ran _users.find() per report, making
  // this O(reports x users) on every render.
  const directIds = new Set(_users.filter((u) => u.superiorId === currentUser.id).map((u) => u.id));
  return _reports.filter(
    (r) => r.staffId === currentUser.id || subIds.has(r.staffId) || directIds.has(r.staffId)
  );
}

export async function saveReport(report: WeeklyReport, currentUser: User, source?: 'superior' | undefined): Promise<{ ok: boolean; conflict?: boolean; message?: string; code?: string }> {
  const idx = _reports.findIndex((r) => r.id === report.id);
  if (idx !== -1) _reports[idx] = report;
  else _reports.unshift(report);

  try {
    const signature = await resolveSignature(report.signature);
    const body: Record<string, unknown> = {
      checklist_items: report.checklistItems,
      notes: report.notes,
      // AI Executive Weekly Summary — persisted so it survives a reload and
      // shows on the report detail. Never sent before, which is why generated
      // summaries vanished after refresh.
      ai_summary: report.aiSummary ?? null,
      signature,
      week_number: report.weekNumber,
      year: report.year,
      quarter: report.quarter,
      month: report.month,
      start_date: report.startDate,
      end_date: report.endDate,
      submission_date: report.submissionDate
    };

    const isSubmission = report.submissionDate && report.status !== 'Draft' && report.status !== 'Reviewed';
    const isReviewAction = report.status === 'Approved' || report.status === 'Reviewed' || (report.status === 'Submitted' && source === 'superior');

    if (idx === -1) {
      // New report: the backend assigns its own code, so create the draft first.
      const created = await api.post<{ code: string }>('/reports', {
        ...body,
        staff_code: report.staffId,
        staff_name: report.staffName,
        department: report.department,
        position: report.position,
        superior_code: report.superiorId,
        signature
      });
      const serverCode = created.code;
      report = { ...report, id: serverCode };
      const cacheIdx = _reports.findIndex((r) => r.id === report.id);
      if (cacheIdx !== -1) _reports[cacheIdx] = report;
      else _reports.unshift(report);
      if (isSubmission) {
        await api.post(`/reports/${serverCode}/submit`, {
          ...body,
          signature,
          multi_proof: report.multiProof,
          delay_reason: report.delayReason || null,
          submission_rating: report.trScore,
          // Pillar 1/2 are computed client-side (Pillar 1 excludes N/A
          // deliverables per the Scoring Policy) and sent explicitly so the
          // server persists the 0-50 / 0-20 scales as-is. Omitted, the server
          // falls back to a 0-100 percentage that also counts N/A items.
          completion_score: report.completionScore,
          timeliness_score: report.timelinessScore
        });
      }
    } else if (isReviewAction) {
      // Superior review / approval: persist grade, feedback, and score breakdown via /review
      await api.post(`/reports/${report.id}/review`, {
        status: report.status,
        approved: report.status === 'Approved',
        feedback: report.managerFeedback || null,
        tr_score: report.trScore,
        completion_score: report.completionScore,
        timeliness_score: report.timelinessScore,
        quality_score: report.qualityScore,
        late_penalty_waived: report.latePenaltyWaived,
        waived_by: report.waivedBy,
        waived_by_name: report.waivedByName
      });
    } else if (isSubmission) {
      await api.post(`/reports/${report.id}/submit`, {
        ...body,
        signature,
        multi_proof: report.multiProof,
        delay_reason: report.delayReason || null,
        submission_rating: report.trScore,
        completion_score: report.completionScore,
        timeliness_score: report.timelinessScore
      });
    } else {
      await api.put(`/reports/${report.id}`, {
        ...body,
        // Draft saves also carry Pillar 1 on the 0-50 scale. Omitted, the server
        // recomputes it as a 0-100 percentage, which the UI then clamps to 50 and
        // made every draft read a constant 50/50 no matter what was checked off.
        completion_score: report.completionScore,
        multi_proof: report.multiProof,
        dispute: report.dispute,
        delay_reason: report.delayReason,
        late_penalty_waived: report.latePenaltyWaived,
        waived_by: report.waivedBy,
        waived_by_name: report.waivedByName
      });
    }
    await reloadStorage();
    // `code` is the server-assigned report code — new reports get it from the
    // create call above, existing ones keep their own id. Callers need it to
    // attach side-table records (e.g. the Weekly Summary Form).
    return { ok: true, code: report.id };
  } catch (e: any) {
    if (e?.status === 409) {
      // Duplicate report rejected by the server — remove the optimistic local entry
      // so the conflicted report never stays in the reported list.
      _reports = _reports.filter((r) => r.id !== report.id);
      return { ok: false, conflict: true, message: e?.message || 'A report for this week already exists. Please choose a different report period.' };
    }
    if (e?.status !== 401 && e?.status !== 403) {
      console.error('saveReport:', e?.message || e);
    }
    return { ok: false, message: e?.message || 'Failed to save report.' };
  }
}

// ---------------------------------------------------------------
// Weekly Summary Form (Sections A-J) — own table `tr_weekly_summaries`,
// keyed by report code. Never stored as columns on `reports`.
// ---------------------------------------------------------------
export async function saveWeeklySummary(
  reportCode: string,
  summary: WeeklySummary
): Promise<{ ok: boolean; message?: string }> {
  try {
    await api.put(`/reports/${reportCode}/summary`, { summary });
    return { ok: true };
  } catch (e: any) {
    if (e?.status !== 401 && e?.status !== 403) {
      console.error('saveWeeklySummary:', e?.message || e);
    }
    return { ok: false, message: e?.message || 'Failed to save the weekly summary.' };
  }
}

export async function fetchWeeklySummary(reportCode: string): Promise<WeeklySummary | null> {
  try {
    const res = await api.get<{ summary: WeeklySummary | null }>(
      `/reports/${reportCode}/summary`
    );
    return res?.summary || null;
  } catch {
    return null;
  }
}

export function deleteReport(reportId: string, actingUser: User) {
  _reports = _reports.filter((r) => r.id !== reportId);
  api.del(`/reports/${reportId}`).catch((e) => console.error('deleteReport:', e));
}

// ---------------------------------------------------------------
// T&R Weekly Report Deadline Extension (API-backed)
// ---------------------------------------------------------------
export async function requestTRExtension(
  reportId: string,
  weekNumber: number,
  year: number,
  targetEndDate: string,
  requestedDeadline: string,
  reason: string,
  currentUser: User,
  templateChecklist: SubmittedChecklistItem[] = []
): Promise<{ success: boolean; message: string; report: WeeklyReport }> {
  let report: WeeklyReport;
  const existing = _reports.find((r) => r.id === reportId);
  if (existing) {
    report = { ...existing };
  } else {
    const tmpl = getTemplateForPosition(currentUser.position, currentUser.department);
    const initialChecklist = templateChecklist && templateChecklist.length > 0
      ? templateChecklist
      : tmpl && tmpl.items && tmpl.items.length > 0
        ? tmpl.items.map((it) => ({
            itemId: it.id,
            title: it.title,
            category: it.category,
            completed: false,
            status: defaultItemStatus(it.category),
            note: ''
          }))
        : [];
    const weekRange = getWeekDateRange(weekNumber, year);
    report = {
      id: reportId,
      staffId: currentUser.id,
      staffName: currentUser.name,
      department: currentUser.department,
      position: currentUser.position,
      superiorId: currentUser.superiorId,
      year,
      quarter: Math.min(4, Math.max(1, Math.ceil(weekNumber / 13))),
      month: Math.min(12, Math.max(1, Math.ceil(weekNumber / 4.33))),
      weekNumber,
      startDate: weekRange.startDate,
      endDate: targetEndDate || weekRange.endDate,
      submissionDate: new Date().toISOString(),
      checklistItems: initialChecklist,
      trScore: 0,
      status: 'Draft'
    };
  }

  const extensionReq: TRSExtensionRequest = {
    id: `ext_tr_${Date.now()}`,
    requestedAt: new Date().toISOString(),
    requestedDeadline,
    reason: reason.trim(),
    status: 'Pending',
    previousDeadline: getTRSubmissionDeadline(targetEndDate).formattedDeadline
  };

  report = { ...report, extensionRequest: extensionReq };
  const idx = _reports.findIndex((r) => r.id === report.id);
  if (idx !== -1) _reports[idx] = report;
  else _reports.unshift(report);

  try {
    // If this is a locally-created shell (no server row yet), create the draft first
    // so the extension request can be persisted against a real report code.
    if (!existing && report.id.startsWith('rep_')) {
      const created = await api.post<{ code: string }>('/reports', {
        staff_code: report.staffId,
        staff_name: report.staffName,
        department: report.department,
        position: report.position,
        superior_code: report.superiorId,
        week_number: report.weekNumber,
        year: report.year,
        quarter: report.quarter,
        month: report.month,
        start_date: report.startDate,
        end_date: report.endDate,
        checklist_items: report.checklistItems
      });
      const serverCode = created.code;
      report = { ...report, id: serverCode };
      const cacheIdx = _reports.findIndex((r) => r.id === report.id);
      if (cacheIdx !== -1) _reports[cacheIdx] = report;
      else _reports.unshift(report);
    }
    await api.put(`/reports/${report.id}`, {
      extension_request: extensionReq,
      approved_deadline: undefined
    });
    await reloadStorage();
  } catch (e: any) {
    console.error('requestTRExtension:', e?.message || e);
  }
  return { success: true, message: 'Extension request submitted to your superior.', report };
}

export async function reviewTRExtension(
  report: WeeklyReport,
  decision: 'Approved' | 'Rejected',
  reviewNote: string,
  currentUser: User
): Promise<{ success: boolean; message: string; report?: WeeklyReport }> {
  const idx = _reports.findIndex((r) => r.id === report.id);
  const current: WeeklyReport = idx !== -1 ? { ..._reports[idx] } : { ...report };
  if (!current.extensionRequest) return { success: false, message: 'No pending extension request found for this report.' };

  const req = { ...current.extensionRequest };
  req.status = decision;
  req.reviewedBy = currentUser.id;
  req.reviewedByName = currentUser.name;
  req.reviewedAt = new Date().toISOString();
  req.reviewNote = reviewNote.trim();

  if (decision === 'Approved') {
    current.approvedDeadline = req.requestedDeadline;
    current.latePenaltyWaived = true;
    current.waivedBy = currentUser.id;
    current.waivedByName = currentUser.name;
  }

  current.extensionHistory = current.extensionHistory || [];
  current.extensionHistory.push({ ...req });
  current.extensionRequest = req;
  if (idx !== -1) _reports[idx] = current;

  try {
    await api.post(`/reports/${current.id}/extension/review`, {
      decision,
      review_note: reviewNote.trim(),
      extension_request: req,
      extension_history: current.extensionHistory,
      approved_deadline: current.approvedDeadline || undefined,
      waived_by: current.waivedBy,
      waived_by_name: current.waivedByName
    });
    await reloadStorage();
  } catch (e: any) {
    return {
      success: false,
      message: e?.message || (e?.status === 403
        ? 'You do not have permission to review this extension request.'
        : 'Failed to save the extension review. Please try again.')
    };
  }
  return {
    success: true,
    message: decision === 'Approved' ? `Extension approved! Updated deadline: ${current.approvedDeadline}.` : 'Extension request declined.',
    report: current
  };
}

// ---------------------------------------------------------------
// TRS Tasks
// ---------------------------------------------------------------
export function getTRSTasks(): TRSTask[] {
  return _trs;
}

export function deleteTRSTask(taskId: string, actingUser: User): { success: boolean; error?: string } {
  const target = _trs.find((t) => t.id === taskId);
  if (!target) return { success: false, error: 'Task not found' };
  // Authorization: self-assigned owner can delete; if assigned by superior, only superiors can delete
  if (['admin', 'executive', 'hr'].includes(actingUser.role)) {
    _trs = _trs.filter((t) => t.id !== taskId);
    api.del(`/trs/${taskId}`).catch((e) => console.error('deleteTRSTask:', e));
    return { success: true };
  }
  const isSelfAssigned = target.assignedBy === target.assignedTo && target.assignedTo === actingUser.id;
  const isAssigneeButNotSelfAssigned = target.assignedTo === actingUser.id && !isSelfAssigned;
  if (isAssigneeButNotSelfAssigned) {
    return { success: false, error: `Permission Denied: Only a superior (the delegating superior, an Admin, or the assignee's superior) can delete this task.` };
  }
  const isAuthorized = isSelfAssigned ||
    (target.assignedBy === actingUser.id ||
      getSubordinateUserIds(actingUser.id).has(target.assignedTo));
  if (!isAuthorized) return { success: false, error: `Permission Denied: Only a superior (the delegating superior, an Admin, or the assignee's superior) can delete this task.` };
  _trs = _trs.filter((t) => t.id !== taskId);
  api.del(`/trs/${taskId}`).catch((e) => console.error('deleteTRSTask:', e));
  return { success: true };
}

export function getVisibleTRSTasksForUser(currentUser: User): TRSTask[] {
  // Generic super-admin account (username === 'admin') sees everything.
  // Everyone else — including role-based admins/executives like the GM —
  // only sees their own tasks and those of their direct subordinates.
  if (currentUser.username === 'admin' && currentUser.role === 'admin') return [..._trs];
  const directSubIds = new Set(_users.filter((u) => u.superiorId === currentUser.id).map((u) => u.id));
  return _trs.filter((t) => {
    if (t.assignedBy === currentUser.id || t.assignedTo === currentUser.id) return true;
    return directSubIds.has(t.assignedTo);
  });
}

/**
 * Persistence intent for saveTRSTask.
 *
 * This used to be INFERRED from which fields happened to be populated, which was
 * unreliable and caused two real defects:
 *  - a 100% progress update carried a locally invented score/feedback, so the
 *    assignee's own progression was routed to POST /evaluate (a superior action);
 *  - `isSubmission` tested `!!submittedAt` first, so grading an ALREADY submitted
 *    task was routed to POST /submit and rejected with
 *    403 "Only the assignee can submit this task."
 * Callers now state the intent; 'auto' keeps the legacy inference.
 */
export type TRSSaveIntent = 'auto' | 'submit' | 'evaluate' | 'update';

export async function saveTRSTask(task: TRSTask, actingUser: User, intent: TRSSaveIntent = 'auto'): Promise<TRSTask> {
  const prog = task.progress !== undefined ? task.progress : (task.status === 'Completed' ? 100 : (task.status === 'In Progress' ? 50 : 0));
  let alignedStatus = task.status;
  let compDate = task.completionDate;
  if (prog >= 100 && task.evaluationStatus !== 'Revision') { alignedStatus = 'Completed'; compDate = compDate || new Date().toISOString().split('T')[0]; }
  else if (prog === 0 && !task.submittedAt) alignedStatus = 'Pending';
  else if (prog > 0 && prog < 100) alignedStatus = 'In Progress';

  const normalizedTask: TRSTask = { ...task, progress: prog, status: alignedStatus, completionDate: compDate };
  const idx = _trs.findIndex((t) => t.id === normalizedTask.id);
  if (idx !== -1) _trs[idx] = normalizedTask;
  else _trs.unshift(normalizedTask);

  (async () => {
    const signature = await resolveSignature(normalizedTask.signature);
    // An explicit intent always wins. Under 'auto', an evaluation is detected by
    // the score+feedback pair, and it is checked BEFORE the submission test so a
    // superior grading an already-submitted task is never sent to /submit.
    const isEvaluation =
      intent === 'evaluate' ||
      (intent === 'auto' && normalizedTask.score !== undefined && normalizedTask.feedback !== undefined);
    const isSubmission =
      intent === 'submit' ||
      (intent === 'auto' && !isEvaluation
        && (!!normalizedTask.submittedAt || normalizedTask.status === 'Completed'));

    if (isSubmission) {
      await api.post(`/trs/${normalizedTask.id}/submit`, {
        completion_date: normalizedTask.completionDate,
        submission_notes: normalizedTask.submissionNotes,
        proof_url: normalizedTask.proofUrl,
        staff_remarks: normalizedTask.staffRemarks,
        delay_reason: normalizedTask.delayReason,
        signature
      });
    } else if (isEvaluation) {
      // TRS rubric (PolicyModal tab 3): 40 pts timeliness + 60 pts quality, the
      // latter split across three 20-pt standards. All four values are sent so the
      // grade survives a reload — previously only the quality aggregate was sent
      // and the per-standard breakdown plus the waiver flag were silently dropped.
      // The backend derives the total and re-clamps each factor; it no longer
      // trusts `score`/`timeliness_score` from the client.
      await api.post(`/trs/${normalizedTask.id}/evaluate`, {
        score: normalizedTask.score,
        feedback: normalizedTask.feedback,
        quality_score: normalizedTask.qualityScore,
        instruction_score: normalizedTask.instructionScore,
        scope_score: normalizedTask.scopeScore,
        accuracy_score: normalizedTask.accuracyScore,
        timeliness_score: normalizedTask.timelinessScore,
        late_penalty_waived: normalizedTask.latePenaltyWaived,
        // The backend treats revision: true as "send back for rework" — it returns
        // the task to In Progress, clears the provisional score and advances
        // revision_count (capped at 2 per PolicyModal tab 3). Without this flag a
        // revision request was recorded as a plain "Reviewed" grade.
        revision: normalizedTask.evaluationStatus === 'Revision',
        approved: normalizedTask.evaluationStatus === 'Approved'
      });
    } else if (idx === -1) {
      await api.post('/trs', {
        title: normalizedTask.title,
        description: normalizedTask.description,
        assigned_to: normalizedTask.assignedTo,
        assigned_by: normalizedTask.assignedBy,
        assigned_date: normalizedTask.assignedDate,
        deadline: normalizedTask.deadline,
        task_code: normalizedTask.code,
        project: normalizedTask.project,
        priority: normalizedTask.priority || 'Medium',
        progress: normalizedTask.progress,
        instructions: normalizedTask.instructions,
        scope: normalizedTask.scope,
        quality_criteria: normalizedTask.qualityCriteria,
        department: normalizedTask.department
      });
    } else if (intent === 'auto'
      && normalizedTask.progress !== undefined && normalizedTask.progress > 0
      && normalizedTask.progress < 100 && !normalizedTask.submittedAt) {
      await api.post(`/trs/${normalizedTask.id}/progress`, { progress: normalizedTask.progress });
    } else {
      await api.put(`/trs/${normalizedTask.id}`, {
        title: normalizedTask.title,
        assigned_date: normalizedTask.assignedDate,
        progress: normalizedTask.progress,
        completion_date: normalizedTask.completionDate,
        staff_remarks: normalizedTask.staffRemarks,
        submission_notes: normalizedTask.submissionNotes,
        multi_proof: normalizedTask.multiProof,
        dispute: normalizedTask.dispute,
        delay_reason: normalizedTask.delayReason,
        is_escalated: normalizedTask.isEscalated,
        escalation_level: normalizedTask.escalationLevel,
        escalated_to: normalizedTask.escalatedTo,
        escalated_to_name: normalizedTask.escalatedToName,
        escalated_reason: normalizedTask.escalatedReason,
        escalated_at: normalizedTask.escalatedAt
      });
    }
    await reloadStorage();
  })().catch((e) => console.error('saveTRSTask:', e));
  return normalizedTask;
}

/**
 * Create a TRS task on the server and return the persisted row.
 *
 * Unlike saveTRSTask(), this does NOT insert the task into the cache before the
 * POST succeeds. A newly created task used to appear in the table with a
 * temporary local id; changing its progression before POST /trs finished then
 * failed with 404 "Task not found." Callers should show an "uploading" state
 * until this promise resolves.
 */
export async function createTRSTask(task: TRSTask, actingUser: User): Promise<TRSTask> {
  const prog = Math.min(100, Math.max(0, Math.round(Number(task.progress) || 0)));
  const res = await api.post<{ code: string }>('/trs', {
    title: task.title,
    description: task.description,
    assigned_to: task.assignedTo,
    assigned_by: task.assignedBy || actingUser.id,
    assigned_date: task.assignedDate,
    deadline: task.deadline,
    task_code: task.code,
    project: task.project,
    priority: task.priority || 'Medium',
    progress: prog,
    instructions: task.instructions,
    scope: task.scope,
    quality_criteria: task.qualityCriteria,
    department: task.department
  });

  const created: TRSTask = {
    ...task,
    id: res.code,
    progress: prog,
    status: 'Pending'
  };

  try {
    await refreshTRSTasks();
    return _trs.find((t) => t.id === res.code) || created;
  } catch {
    // The POST succeeded, so never surface a create failure just because the
    // follow-up refresh failed. Keep the row locally until the next load.
    _trs = [created, ..._trs.filter((t) => t.id !== created.id)];
    return created;
  }
}

/**
 * Refresh only the TRS task cache. Used after progress edits so the slider does
 * not trigger a full hydration (users, reports, notices, notifications…) for
 * every queued save.
 */
export async function refreshTRSTasks(): Promise<void> {
  const rows = await api.get<any[]>('/trs');
  _trs = rows.map(adaptTRS);
}

/**
 * Persist a Task Progression change.
 *
 * Deliberately does NOT go through saveTRSTask(): that helper infers intent from
 * which fields are populated, and a 100% progression used to carry a locally
 * invented score + feedback, which routed the request to POST /trs/:code/evaluate
 * — a superior grading action. The assignee was then rejected for grading a task
 * that had not been submitted yet (or for grading their own task).
 *
 * POST /progress is the endpoint the assignee is authorised for. PUT /trs/:code is
 * not: it only allows the creator, management, or the assignee's superior, so an
 * assignee who did not create the task could not move their own slider.
 */
export async function updateTRSTaskProgress(taskCode: string, progress: number): Promise<void> {
  const p = Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));
  await api.post(`/trs/${taskCode}/progress`, { progress: p }, { timeout: 15000 });

  // Keep the cache correct even if the follow-up GET fails.
  const idx = _trs.findIndex((t) => t.id === taskCode);
  if (idx !== -1) {
    _trs[idx] = {
      ..._trs[idx],
      progress: p,
      status: p === 0 ? 'Pending' : 'In Progress'
    };
  }
  try {
    await refreshTRSTasks();
  } catch {
    // Optimistic cache entry above remains; the next load will reconcile.
  }
}

/**
 * Escalate a TRS task to a senior superior via POST /trs/:code/escalate.
 *
 * This is the persistence path for the "Maximum 2 Revision Cycles" rule
 * (PolicyModal tab 3): once both cycles are used, a further revision request
 * escalates instead of opening a third cycle. The escalation columns
 * (escalation_level / escalated_to / escalated_reason / escalated_at) only exist
 * on this endpoint — they cannot be written through the grade/revision payload.
 */
export async function escalateTRSTask(
  taskCode: string,
  escalatedTo: string,
  escalatedToName: string,
  reason: string
): Promise<void> {
  await api.post(`/trs/${taskCode}/escalate`, {
    escalated_to: escalatedTo,
    escalated_to_name: escalatedToName,
    escalated_reason: reason
  });
  await reloadStorage();
}

export async function unlockTRSTask(
  taskCode: string,
  reason: string,
  waivePenalty: boolean
): Promise<{ code: string; unlockHistory?: UnlockAuditTrail[] }> {
  const data = await api.post<{ code: string; unlock_history?: UnlockAuditTrail[] }>(`/trs/${taskCode}/unlock`, {
    reason,
    waive_penalty: waivePenalty
  });
  await reloadStorage();
  return { code: data.code, unlockHistory: data.unlock_history };
}

export async function lockTRSTask(taskCode: string): Promise<{ code: string }> {
  const data = await api.post<{ code: string }>(`/trs/${taskCode}/lock`, {});
  await reloadStorage();
  return data;
}

// ---------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------
export function getNotifications(): NotificationItem[] {
  return _notifications;
}

export function getNotificationsForUser(currentUser: User): NotificationItem[] {
  return _notifications.filter((n) => {
    if (n.recipientUserId === currentUser.id || n.recipientUserId === 'all') return true;
    if (n.recipientUserId === 'superiors' && (currentUser.role === 'manager' || currentUser.role === 'executive' || currentUser.role === 'admin')) return true;
    return false;
  });
}

export function addNotification(notif: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>): NotificationItem {
  const newNotif: NotificationItem = {
    ...notif,
    id: `notif_${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    read: false
  };
  _notifications = [newNotif, ..._notifications.slice(0, 99)];
  return newNotif;
}

export function markNotificationAsRead(id: string) {
  _notifications = _notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
  api.post(`/notifications/${id}/read`).catch((e) => console.error('notif read:', e));
}

export function markAllNotificationsAsRead(userId: string) {
  _notifications = _notifications.map((n) => (n.recipientUserId === userId || n.recipientUserId === 'all' || n.recipientUserId === 'superiors' ? { ...n, read: true } : n));
  api.post('/notifications/read-all').catch((e) => console.error('notif read-all:', e));
}

export function clearNotificationsForUser(userId: string) {
  _notifications = _notifications.filter((n) => !(n.recipientUserId === userId || n.recipientUserId === 'all' || n.recipientUserId === 'superiors'));
  api.del('/notifications').catch((e) => console.error('notif clear:', e));
}

// ---------------------------------------------------------------
// Activity Logs
// ---------------------------------------------------------------
export function getActivityLogs(): ActivityLog[] {
  return _logs;
}

/**
 * Pull the audit trail from the server, optionally scoped to one calendar year.
 * The boot hydration only caches the 100 most recent rows, so the Admin Console
 * uses this to load a full year on demand.
 */
export async function fetchActivityLogs(opts: { year?: number } = {}): Promise<ActivityLog[]> {
  const params = new URLSearchParams();
  if (opts.year) {
    params.set('year', String(opts.year));
    params.set('limit', '5000'); // a whole year must not be truncated
  } else {
    params.set('limit', '1000');
  }
  const d = await api.get<{ rows: any[] }>(`/audit?${params.toString()}`);
  const rows = (d.rows || []).map(adaptLog);
  _logs = rows;
  return rows;
}

export function addActivityLog(userId: string, username: string, userRole: string, action: string, details: string) {
  const newLog: ActivityLog = {
    id: `log_${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    userId, username, userRole, action, details, ipAddress: '127.0.0.1'
  };
  _logs = [newLog, ..._logs.slice(0, 99)];
}

/** Wipe the audit trail (admin only). Returns how many entries were removed. */
export async function clearActivityLogs(): Promise<number> {
  const res = await api.del<{ count?: number }>('/audit');
  try {
    const d = await api.get<{ rows: any[] }>('/audit?limit=100');
    _logs = d.rows.map(adaptLog);
  } catch {
    _logs = [];
  }
  return res?.count ?? 0;
}

// ---------------------------------------------------------------
// Appraisals
// ---------------------------------------------------------------
export function getAppraisalRecords(): AppraisalRecord[] {
  return _appraisals;
}

export function getVisibleAppraisalRecords(currentUser: User): AppraisalRecord[] {
  if (['admin', 'executive', 'hr'].includes(currentUser.role)) return _appraisals;
  const subIds = getSubordinateUserIds(currentUser.id);
  return _appraisals.filter((a) => {
    if (a.preparedByUserId === currentUser.id || a.staffId === currentUser.id) return true;
    if (subIds.has(a.staffId)) return true;
    const staffUser = _users.find((u) => u.id === a.staffId);
    return !!(staffUser && staffUser.superiorId === currentUser.id);
  });
}

export function saveAppraisalRecord(appraisal: AppraisalRecord, actingUser: User) {
  const idx = _appraisals.findIndex((r) => r.id === appraisal.id);
  if (idx !== -1) _appraisals[idx] = appraisal;
  else _appraisals.unshift(appraisal);

  (async () => {
    if (appraisal.status === 'Fully Approved') {
      const signature = await resolveSignature(appraisal.approvedSignature || appraisal.approvedBySignature);
      await api.post(`/appraisals/${appraisal.id}/approve`, { signature, notes: appraisal.approvedNotes });
    } else if (appraisal.status === 'Pending Executive Approval') {
      const signature = await resolveSignature(appraisal.preparedSignature || appraisal.preparedBySignature);
      await api.post(`/appraisals/${appraisal.id}/sign-prepare`, { signature, notes: appraisal.preparedNotes });
    } else if (idx === -1) {
      await api.post('/appraisals', {
        staff_code: appraisal.staffId,
        tr_score: appraisal.trScore,
        trs_score: appraisal.trsScore,
        period_year: appraisal.periodYear,
        period_quarter: appraisal.periodQuarter,
        period_month: appraisal.periodMonth,
        period: appraisal.period,
        signature_mode: appraisal.signatureMode
      });
    } else {
      await api.put(`/appraisals/${appraisal.id}`, {
        tr_score: appraisal.trScore,
        trs_score: appraisal.trsScore,
        period_year: appraisal.periodYear,
        period_quarter: appraisal.periodQuarter
      });
    }
    await reloadStorage();
  })().catch((e) => console.error('saveAppraisal:', e));
}

export function deleteAppraisalRecord(id: string, actingUser: User) {
  _appraisals = _appraisals.filter((r) => r.id !== id);
  api.del(`/appraisals/${id}`).catch((e) => console.error('del appraisal:', e));
}

// ---------------------------------------------------------------
// Saved signatures
// ---------------------------------------------------------------
export function getSavedSignatures(userId?: string): SignatureData[] {
  void userId;
  return _signatures;
}

export function saveUserSignature(userId: string | undefined, sig: SignatureData): SignatureData[] {
  const isStoredOnS3 = /(\.s3\.[a-z0-9-]+\.amazonaws\.com\/)/i.test(sig.dataUrl) || /^https?:\/\/s3\.[a-z0-9-]+\.amazonaws\.com\//i.test(sig.dataUrl) || /^\/reportupload\//i.test(sig.dataUrl);
  if (isStoredOnS3) return _signatures; // already stored on S3 — avoid re-upload
  _signatures = [sig, ..._signatures.filter((s) => s.signedAt !== sig.signedAt)].slice(0, 6);
  (async () => {
    try {
      await api.post('/signatures', { signature: sig });
      _signatures = await getSavedSignaturesFromApi();
    } catch (e) {
      console.error('sig save:', e);
    }
  })();
  return _signatures;
}

export function deleteUserSignature(userId: string | undefined, signedAt: string): SignatureData[] {
  const target = _signatures.find((s) => s.signedAt === signedAt);
  _signatures = _signatures.filter((s) => s.signedAt !== signedAt);
  void target;
  return _signatures;
}

// ---------------------------------------------------------------
// Signee resolution (kept for compatibility; uses cached users)
// ---------------------------------------------------------------
export function resolveAppraisalSignees(staffName: string, department: string) {
  const staff = _users.find((u) => u.name.toLowerCase() === staffName.toLowerCase() || u.id === staffName);
  let superiorName = 'Department Superior / Manager';
  let superiorRole = 'Department Superior';
  if (staff && staff.superiorId) {
    const superiorUser = _users.find((u) => u.id === staff.superiorId);
    if (superiorUser) { superiorName = superiorUser.name; superiorRole = `${superiorUser.position} (${superiorUser.department})`; }
  }
  if (superiorName === 'Department Superior / Manager') {
    const deptManager = _users.find((u) => u.department === department && (u.role === 'manager' || u.role === 'admin'));
    if (deptManager) { superiorName = deptManager.name; superiorRole = `${deptManager.position} (${deptManager.department})`; }
  }
  let hrName = 'Executive Management / HR';
  let hrRole = 'Human Resources / Executive';
  const hrUser = _users.find((u) => u.department === 'Human Resources' || u.role === 'executive' || (u.department === 'General Management' && u.role === 'admin'));
  if (hrUser) { hrName = hrUser.name; hrRole = `${hrUser.position} (${hrUser.department})`; }
  return { superiorName, superiorRole, hrName, hrRole };
}

// ---------------------------------------------------------------
// Reset
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// V2 Feature Helpers — Working Days, Escalation, Disputes, Comments
// ---------------------------------------------------------------
export function calculateWorkingDaysElapsed(startDateStr: string, endDate: Date = new Date()): number {
  if (!startDateStr) return 0;
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const target = new Date(endDate);
  target.setHours(0, 0, 0, 0);
  while (cur < target) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function getSeniorSuperior(userId?: string): User | undefined {
  const users = _users;
  if (!userId) return users.find((u) => ['admin', 'executive', 'hr'].includes(u.role));
  const directSuperior = users.find((u) => u.id === userId);
  if (!directSuperior) return users.find((u) => ['admin', 'executive', 'hr'].includes(u.role));
  if (directSuperior.superiorId) {
    const senior = users.find((u) => u.id === directSuperior.superiorId);
    if (senior) return senior;
  }
  return users.find((u) => (u.role === 'executive' || u.role === 'admin') && u.id !== userId);
}

export function getStaffActiveTaskCount(staffId: string): {
  total: number;
  pending: number;
  inProgress: number;
  tasks: TRSTask[];
  workloadLevel: 'light' | 'moderate' | 'heavy';
} {
  const staffTasks = _trs.filter((t) => t.assignedTo === staffId && t.status !== 'Completed');
  const pending = staffTasks.filter((t) => t.status === 'Pending').length;
  const inProgress = staffTasks.filter((t) => t.status === 'In Progress').length;
  const total = staffTasks.length;
  let workloadLevel: 'light' | 'moderate' | 'heavy' = 'light';
  if (total >= 5) workloadLevel = 'heavy';
  else if (total >= 3) workloadLevel = 'moderate';
  return { total, pending, inProgress, tasks: staffTasks, workloadLevel };
}

export function getTRDraft(userId: string, year: number, weekNumber: number): {
  checklistItems: SubmittedChecklistItem[];
  notes?: string;
  summary?: WeeklySummary;
  signature?: SignatureData;
  multiProof?: MultiProofData;
  lastSavedAt: string;
} | null {
  const key = `${userId}_${year}_${weekNumber}`;
  const cache = _trDrafts[key];
  if (!cache) return null;
  return {
    checklistItems: cache.checklistItems || [],
    notes: cache.notes,
    summary: cache.summary,
    signature: cache.signature,
    multiProof: cache.multiProof,
    lastSavedAt: cache.lastSavedAt || new Date().toISOString()
  };
}

/**
 * True when a saved draft no longer corresponds to the user's current JD template.
 * Drafts are restored verbatim, so a position/department change (or a re-uploaded
 * template) otherwise leaves a staff member filling in another role's deliverables.
 * Returns false when there is no template to compare against, so a missing template
 * never discards someone's work.
 */
export function isDraftStaleForTemplate(
  draftItems: { itemId?: string }[],
  template: RoleTemplate | undefined
): boolean {
  if (!template || !template.items.length) return false;
  if (!draftItems.length) return false;
  const tplIds = new Set(template.items.map(i => i.id));
  const draftIds = new Set(draftItems.map(i => i.itemId).filter(Boolean) as string[]);
  if (!draftIds.size) return false;
  if (draftIds.size !== tplIds.size) return true;
  for (const id of tplIds) if (!draftIds.has(id)) return true;
  return false;
}

export function getMyTRDrafts(userId: string): {  year: number;
  weekNumber: number;
  checklistItems: SubmittedChecklistItem[];
  notes?: string;
  signature?: SignatureData;
  multiProof?: MultiProofData;
  lastSavedAt: string;
}[] {
  const prefix = `${userId}_`;
  const out: {
    year: number; weekNumber: number; checklistItems: SubmittedChecklistItem[];
    notes?: string; signature?: SignatureData; multiProof?: MultiProofData; lastSavedAt: string;
  }[] = [];
  for (const [key, cache] of Object.entries(_trDrafts)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length).split('_');
    const year = Number(rest[0]);
    const weekNumber = Number(rest[1]);
    if (!year || !weekNumber) continue;
    out.push({
      year, weekNumber,
      checklistItems: cache.checklistItems || [],
      notes: cache.notes,
      signature: cache.signature,
      multiProof: cache.multiProof,
      lastSavedAt: cache.lastSavedAt || new Date().toISOString()
    });
  }
  return out.sort((a, b) => a.year - b.year || a.weekNumber - b.weekNumber);
}

export function saveTRDraft(
  userId: string,
  year: number,
  weekNumber: number,
  draftData: { checklistItems: SubmittedChecklistItem[]; notes?: string; summary?: WeeklySummary; signature?: SignatureData; multiProof?: MultiProofData }
): void {
  const key = `${userId}_${year}_${weekNumber}`;
  const lastSavedAt = new Date().toISOString();
  _trDrafts[key] = { ...draftData, lastSavedAt };
  api.put(`/reports/draft/${userId}/${year}/${weekNumber}`, { draft_data: draftData })
    .catch((e) => console.error('saveTRDraft:', e));
}

export function clearTRDraft(userId: string, year: number, weekNumber: number): Promise<void> {
  const key = `${userId}_${year}_${weekNumber}`;
  delete _trDrafts[key];
  return api
    .del(`/reports/draft/${userId}/${year}/${weekNumber}`)
    .then(() => undefined)
    .catch((e) => { console.error('clearTRDraft:', e); throw e; });
}

export function submitScoreDispute(
  targetType: 'tr' | 'trs',
  targetId: string,
  reason: string,
  currentUser: User
): { success: boolean; message: string } {
  if (targetType === 'tr') {
    const repIdx = _reports.findIndex((r) => r.id === targetId);
    if (repIdx === -1) return { success: false, message: 'Report not found.' };
    const report = _reports[repIdx];
    if (report.dispute) return { success: false, message: 'A dispute has already been submitted for this report (limit 1 dispute per report).' };

    const reviewDate = report.reviewDate || report.submissionDate;
    const daysElapsed = calculateWorkingDaysElapsed(reviewDate);
    if (daysElapsed > 3) return { success: false, message: 'Score dispute window has expired (must be submitted within 3 working days of publication).' };

    const dispute: ScoreDispute = {
      status: 'Pending',
      reason,
      requestedAt: new Date().toISOString(),
      staffId: currentUser.id,
      staffName: currentUser.name,
      originalScore: report.trScore
    };
    _reports[repIdx] = { ...report, dispute };

    addActivityLog(currentUser.id, currentUser.username, currentUser.role, 'SCORE_DISPUTE_SUBMITTED',
      `Submitted score dispute for Week ${report.weekNumber} report (Original Score: ${report.trScore}%). Reason: ${reason}`);

    api.post(`/reports/${targetId}/dispute`, { reason })
      .then(() => reloadStorage())
      .catch((e) => console.error('submitScoreDispute:', e));
    return { success: true, message: 'Score dispute submitted successfully. Your superior has been notified.' };
  } else {
    const taskIdx = _trs.findIndex((t) => t.id === targetId);
    if (taskIdx === -1) return { success: false, message: 'Task not found.' };
    const task = _trs[taskIdx];
    if (task.dispute) return { success: false, message: 'A dispute has already been submitted for this task (limit 1 dispute per task).' };

    const evalDate = task.evaluationDate || task.completionDate || task.deadline;
    const daysElapsed = calculateWorkingDaysElapsed(evalDate);
    if (daysElapsed > 3) return { success: false, message: 'Score dispute window has expired (must be submitted within 3 working days of publication).' };

    const dispute: ScoreDispute = {
      status: 'Pending',
      reason,
      requestedAt: new Date().toISOString(),
      staffId: currentUser.id,
      staffName: currentUser.name,
      originalScore: task.score ?? 0
    };
    _trs[taskIdx] = { ...task, dispute };

    addActivityLog(currentUser.id, currentUser.username, currentUser.role, 'SCORE_DISPUTE_SUBMITTED',
      `Submitted score dispute for TRS task "${task.title}" (Original Score: ${task.score ?? 0}%). Reason: ${reason}`);

    api.post(`/trs/${targetId}/dispute`, { reason })
      .then(() => reloadStorage())
      .catch((e) => console.error('submitScoreDispute:', e));
    return { success: true, message: 'Score dispute submitted successfully. Your superior has been notified.' };
  }
}

export function resolveScoreDispute(
  targetType: 'tr' | 'trs',
  targetId: string,
  decision: 'accept' | 'reject',
  resolutionNote: string,
  revisedScore?: number,
  currentUser?: User
): { success: boolean; message: string } {
  if (targetType === 'tr') {
    const repIdx = _reports.findIndex((r) => r.id === targetId);
    if (repIdx === -1) return { success: false, message: 'Report not found.' };
    const report = _reports[repIdx];
    if (!report.dispute) return { success: false, message: 'No dispute found for this report.' };

    const finalScore = decision === 'accept' && revisedScore !== undefined ? revisedScore : report.trScore;
    const updated = {
      ...report,
      dispute: {
        ...report.dispute,
        status: decision === 'accept' ? 'Resolved' : 'Rejected' as ScoreDispute['status'],
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.id,
        resolvedByName: currentUser?.name || 'Superior',
        resolutionNote,
        revisedScore: decision === 'accept' ? finalScore : undefined
      },
      trScore: decision === 'accept' && revisedScore !== undefined ? finalScore : report.trScore
    };
    _reports[repIdx] = updated;

    addActivityLog(currentUser?.id || 'superior', currentUser?.username || 'manager', currentUser?.role || 'manager', 'SCORE_DISPUTE_RESOLVED',
      `Resolved dispute for Week ${report.weekNumber} report (${decision === 'accept' ? `Adjusted to ${finalScore}%` : 'Original score upheld'}). Notes: ${resolutionNote}`);

    api.post(`/reports/${targetId}/dispute/resolve`, {
      decision, resolution_note: resolutionNote, revised_score: revisedScore
    }).then(() => reloadStorage()).catch((e) => console.error('resolveScoreDispute:', e));
    return { success: true, message: `Dispute marked as ${decision === 'accept' ? 'Resolved (Score Adjusted)' : 'Rejected (Score Upheld)'}.` };
  } else {
    const taskIdx = _trs.findIndex((t) => t.id === targetId);
    if (taskIdx === -1) return { success: false, message: 'Task not found.' };
    const task = _trs[taskIdx];
    if (!task.dispute) return { success: false, message: 'No dispute found for this task.' };

    const finalScore = decision === 'accept' && revisedScore !== undefined ? revisedScore : task.score ?? 0;
    const updated = {
      ...task,
      dispute: {
        ...task.dispute,
        status: decision === 'accept' ? 'Resolved' : 'Rejected' as ScoreDispute['status'],
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.id,
        resolvedByName: currentUser?.name || 'Superior',
        resolutionNote,
        revisedScore: decision === 'accept' ? finalScore : undefined
      },
      score: decision === 'accept' && revisedScore !== undefined ? finalScore : task.score
    };
    _trs[taskIdx] = updated;

    addActivityLog(currentUser?.id || 'superior', currentUser?.username || 'manager', currentUser?.role || 'manager', 'SCORE_DISPUTE_RESOLVED',
      `Resolved dispute for TRS task "${task.title}" (${decision === 'accept' ? `Adjusted to ${finalScore}%` : 'Original score upheld'}). Notes: ${resolutionNote}`);

    api.post(`/trs/${targetId}/dispute/resolve`, {
      decision, resolution_note: resolutionNote, revised_score: revisedScore
    }).then(() => reloadStorage()).catch((e) => console.error('resolveScoreDispute:', e));
    return { success: true, message: `Dispute marked as ${decision === 'accept' ? 'Resolved (Score Adjusted)' : 'Rejected (Score Upheld)'}.` };
  }
}

export function addTRSTaskComment(
  taskId: string,
  message: string,
  currentUser: User,
  replyToCommentId?: string
): { success: boolean; comment?: TRSTaskComment; task?: TRSTask; messageText: string } {
  const taskIdx = _trs.findIndex((t) => t.id === taskId);
  if (taskIdx === -1) return { success: false, messageText: 'Task not found.' };

  const task = _trs[taskIdx];
  const tempId = `comment_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newComment: TRSTaskComment = {
    id: tempId,
    taskId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    userAvatar: currentUser.avatarUrl,
    authorId: currentUser.id,
    authorName: currentUser.name,
    authorRole: currentUser.role,
    message: message.trim(),
    createdAt: new Date().toISOString(),
    replyToCommentId,
    replyToId: replyToCommentId
  };

  const updated = {
    ...task,
    comments: [...(task.comments || []), newComment]
  };
  _trs[taskIdx] = updated;

  const recipientUserId = currentUser.id === task.assignedTo ? task.assignedBy : task.assignedTo;
  addNotification({
    recipientUserId,
    senderId: currentUser.id,
    senderName: currentUser.name,
    type: 'TASK_UPDATED',
    title: `💬 New Message on TRS Task "${task.title}"`,
    message: `${currentUser.name} posted a comment: "${message.length > 80 ? message.slice(0, 80) + '...' : message}"`,
    linkTab: 'trs'
  });

  addActivityLog(currentUser.id, currentUser.username, currentUser.role, 'TASK_COMMENT_ADDED',
    `Posted comment on task "${task.title}": "${message.slice(0, 60)}${message.length > 60 ? '...' : ''}"`);

  api.post(`/trs/${taskId}/comments`, { message, reply_to_code: replyToCommentId || null })
    .then((res: any) => {
      if (res?.comment?.id) {
        const i = _trs.findIndex((t) => t.id === taskId);
        if (i !== -1) {
          _trs[i] = {
            ..._trs[i],
            comments: (_trs[i].comments || []).map((c) => (c.id === tempId ? { ...c, id: res.comment.id } : c))
          };
        }
      }
      return reloadStorage();
    })
    .catch((e) => console.error('addTRSTaskComment:', e));

  return { success: true, comment: newComment, task: updated, messageText: 'Comment posted successfully.' };
}

// ---------------------------------------------------------------
// V2 Feature: Announcements / Notice Board (API-backed)
// ---------------------------------------------------------------

export function getAnnouncements(): AnnouncementNotice[] {
  return _notices;
}

/** Number of announcements scoped to the user (department scope or 'all') that
 *  the user has not yet opened/read. Used for the Notices tab badge. */
export function getUnreadNoticeCount(currentUser: User): number {
  if (!currentUser) return 0;
  let count = 0;
  for (const n of _notices) {
    if (n.departmentScope && n.departmentScope !== 'all' && n.departmentScope !== currentUser.department) continue;
    const isRead = (n.readReceipts || []).some((r) => r.userId === currentUser.id);
    if (!isRead) count++;
  }
  return count;
}

export function saveAnnouncement(
  notice: AnnouncementNotice,
  currentUser: User
): { success: boolean; message: string } {
  const idx = _notices.findIndex((n) => n.id === notice.id);
  if (idx !== -1) _notices[idx] = { ..._notices[idx], ...notice };
  else _notices.unshift(notice);

  addActivityLog(currentUser.id, currentUser.username, currentUser.role,
    idx !== -1 ? 'NOTICE_UPDATED' : 'NOTICE_PUBLISHED',
    `${idx !== -1 ? 'Updated' : 'Published'} announcement: "${notice.title}" [Priority: ${notice.priority.toUpperCase()}]`);

  api.post('/notices', {
    code: notice.id,
    title: notice.title,
    content: notice.content,
    priority: notice.priority,
    category: notice.category,
    department_scope: notice.departmentScope || 'all',
    is_pinned: !!notice.isPinned
  })
    .then((res: any) => {
      if (res?.code && res.code !== notice.id) {
        const i = _notices.findIndex((n) => n.id === notice.id);
        if (i !== -1) _notices[i] = { ..._notices[i], id: res.code };
      }
      return reloadStorage();
    })
    .catch((e) => console.error('saveAnnouncement:', e));

  return { success: true, message: `Announcement ${idx !== -1 ? 'updated' : 'published'} successfully.` };
}

export function deleteAnnouncement(
  noticeId: string,
  currentUser: User
): { success: boolean; message: string } {
  const target = _notices.find((n) => n.id === noticeId);
  _notices = _notices.filter((n) => n.id !== noticeId);
  addActivityLog(currentUser.id, currentUser.username, currentUser.role, 'NOTICE_DELETED',
    `Deleted announcement: "${target?.title || noticeId}"`);
  api.del(`/notices/${noticeId}`)
    .then(() => reloadStorage())
    .catch((e) => console.error('deleteAnnouncement:', e));
  return { success: true, message: 'Announcement deleted successfully.' };
}

export function markNoticeAsRead(noticeId: string, currentUser: User): void {
  const idx = _notices.findIndex((n) => n.id === noticeId);
  if (idx === -1) return;
  const notice = _notices[idx];
  if (!notice.readReceipts) notice.readReceipts = [];
  if (notice.readReceipts.some((r) => r.userId === currentUser.id)) return;
  const receipt: NoticeReadReceipt = {
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    department: currentUser.department,
    readAt: new Date().toISOString()
  };
  notice.readReceipts.push(receipt);
  _notices[idx] = notice;
  api.post(`/notices/${noticeId}/read`, {})
    .then(() => reloadStorage())
    .catch((e) => console.error('markNoticeAsRead:', e));
}

// ---------------------------------------------------------------
// V2 Feature: Staff Onboarding Checklist (API-backed)
// ---------------------------------------------------------------

function defaultOnboarding(): OnboardingStatus {
  return { completed: false, telegramConnected: false, jdReviewed: false, firstReportSubmitted: false };
}

export function getUserOnboardingStatus(user?: User | null): OnboardingStatus {
  if (!user || !user.id) return { ...defaultOnboarding(), completed: true };
  const base = user.onboarding && typeof user.onboarding === 'object'
    ? { ...defaultOnboarding(), ...user.onboarding }
    : defaultOnboarding();
  base.telegramConnected = !!(user.telegramChatId || user.telegramUsername || base.telegramConnected);
  const firstReportSubmitted = base.firstReportSubmitted || _reports.some((r) => r.staffId === user.id);
  const jdReviewed = base.jdReviewed || false;
  base.firstReportSubmitted = firstReportSubmitted;
  base.jdReviewed = jdReviewed;
  base.completed = base.telegramConnected && base.jdReviewed && base.firstReportSubmitted;
  return base;
}

function patchUserOnboarding(userId: string, patch: Partial<OnboardingStatus>): OnboardingStatus {
  const cached = _users.find((u) => u.id === userId);
  const status = getUserOnboardingStatus(cached || { id: userId } as User);
  const next: OnboardingStatus = { ...status, ...patch };
  next.completed = next.telegramConnected && next.jdReviewed && next.firstReportSubmitted;
  return next;
}

export function updateUserOnboardingStep(
  userId: string,
  step: keyof OnboardingStatus,
  value: boolean
): OnboardingStatus {
  const next = patchUserOnboarding(userId, { [step]: value } as Partial<OnboardingStatus>);
  api.put(`/users/${userId}/onboarding`, { step, value })
    .then(() => reloadStorage())
    .catch((e) => console.error('updateUserOnboardingStep:', e));
  return next;
}

export function dismissOnboarding(userId: string): void {
  const next = patchUserOnboarding(userId, { dismissedAt: new Date().toISOString() });
  api.put(`/users/${userId}/onboarding`, { dismissedAt: next.dismissedAt })
    .then(() => reloadStorage())
    .catch((e) => console.error('dismissOnboarding:', e));
}

// ---------------------------------------------------------------
// Org config — admin-managed Departments & Position / Job Titles
// ---------------------------------------------------------------
function adaptOrgConfig(r: any): OrgConfigEntry {
  const rawActive = r.isActive ?? r.is_active;
  return {
    id: Number(r.id),
    kind: r.kind as OrgConfigKind,
    name: String(r.name),
    isActive: rawActive === undefined ? true : Boolean(rawActive),
    usageCount: Number(r.usageCount ?? r.usage_count ?? 0),
    createdAt: r.createdAt || r.created_at,
    updatedAt: r.updatedAt || r.updated_at,
    deactivatedAt: r.deactivatedAt ?? r.deactivated_at ?? null
  };
}

function setOrgConfig(entries: OrgConfigEntry[]) {
  _orgConfig = entries;
  _orgConfigLoaded = true;
  _orgConfigListeners.forEach((cb) => cb());
}

/** Subscribe to master-list changes so open dropdowns re-render. Returns an unsubscribe fn. */
export function subscribeOrgConfig(cb: () => void): () => void {
  _orgConfigListeners.add(cb);
  return () => { _orgConfigListeners.delete(cb); };
}

/** True once the master lists have been pulled from the API at least once. */
export function isOrgConfigLoaded(): boolean {
  return _orgConfigLoaded;
}

/**
 * Re-pull the master lists. Includes soft-deleted rows so the admin console
 * can show and reactivate them. Never throws — on failure the previous copy
 * is kept so the rest of the app keeps working.
 */
export async function refreshOrgConfig(): Promise<void> {
  try {
    const rows = await api.get<any[]>('/org-config?includeInactive=1');
    setOrgConfig(rows.map(adaptOrgConfig));
  } catch (e: any) {
    console.error('[storage] org config refresh failed:', e?.message || e);
  }
}

/** All master entries, optionally filtered by kind. Includes inactive rows. */
export function getOrgConfigEntries(kind?: OrgConfigKind): OrgConfigEntry[] {
  return kind ? _orgConfig.filter((e) => e.kind === kind) : _orgConfig;
}

/**
 * Active department names for every dropdown in the app.
 * Falls back to the hardcoded list if the API call has not succeeded yet
 * (e.g. migrate_v5.sql has not been run), so a missing migration degrades
 * gracefully instead of emptying every dropdown.
 */
export function getDepartments(): string[] {
  const active = _orgConfig.filter((e) => e.kind === 'department' && e.isActive).map((e) => e.name);
  return active.length || _orgConfigLoaded ? active : [...DEPARTMENTS];
}

/** Active position / job title names. Same graceful fallback as getDepartments(). */
export function getPositions(): string[] {
  const active = _orgConfig.filter((e) => e.kind === 'position' && e.isActive).map((e) => e.name);
  return active.length || _orgConfigLoaded ? active : [...COMPANY_POSITIONS];
}

/** Create a department or position. Re-adding a deactivated name reactivates it. */
export async function createOrgConfigEntry(
  kind: OrgConfigKind,
  name: string,
  actingAdmin: User
): Promise<OrgConfigEntry> {
  const created = await api.post<any>('/org-config', { kind, name: String(name || '').trim() });
  const entry = adaptOrgConfig(created);
  const idx = _orgConfig.findIndex((e) => e.id === entry.id);
  if (idx === -1) setOrgConfig([..._orgConfig, entry]);
  else {
    const next = [..._orgConfig];
    next[idx] = entry;
    setOrgConfig(next);
  }
  return entry;
}

/** Rename an entry (rewrites live assignments server-side) and/or set its active flag. */
export async function updateOrgConfigEntry(
  id: number,
  patch: { name?: string; isActive?: boolean },
  actingAdmin: User
): Promise<OrgConfigEntry> {
  const updated = await api.put<any>(`/org-config/${id}`, patch);
  const entry = adaptOrgConfig(updated);
  const idx = _orgConfig.findIndex((e) => e.id === id);
  if (idx !== -1) {
    const next = [..._orgConfig];
    next[idx] = { ...next[idx], ...entry };
    setOrgConfig(next);
  }
  return entry;
}

/** Soft-delete an entry. Staff assignments are intentionally left untouched. */
export async function deactivateOrgConfigEntry(
  id: number,
  actingAdmin: User
): Promise<{ entry: OrgConfigEntry; usageCount: number; message: string }> {
  const res = await api.del<any>(`/org-config/${id}`);
  const entry = adaptOrgConfig(res);
  const idx = _orgConfig.findIndex((e) => e.id === id);
  if (idx !== -1) {
    const next = [..._orgConfig];
    next[idx] = { ...next[idx], ...entry, isActive: false };
    setOrgConfig(next);
  }
  return { entry, usageCount: entry.usageCount, message: res?.message || `Deactivated "${entry.name}".` };
}

export function resetSystemData() {

  _users = []; _templates = []; _reports = []; _trs = []; _appraisals = [];
  _notifications = []; _logs = []; _signatures = [];
  _notices = []; _trDrafts = {};
  _orgConfig = []; _orgConfigLoaded = false;
  _currentUser = null;
  _hydratePromise = null;
  return initStorage();
}