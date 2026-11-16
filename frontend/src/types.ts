export type UserRole = 'admin' | 'hr' | 'executive' | 'manager' | 'staff';

export interface UserPermissions {
  submitTRReport: boolean;      // T&R Staff Weekly Reporting
  viewTeamTRReports: boolean;   // Team T&R Review & Monitoring
  submitTRSTasks: boolean;      // TRS Task Execution & Submission
  evaluatePerformance: boolean; // Staff Performance Evaluation — role-derived, not admin-toggleable
  approveAppraisals: boolean;   // Executive Appraisal Final Approval
  manageUsers: boolean;         // User Accounts & Permission Controls
  manageTemplates: boolean;     // JD Position Template Configuration
  viewAuditLogs: boolean;       // System Audit Trail & Security Logs
}

export interface PermissionDefinition {
  key: keyof UserPermissions;
  title: string;
  category: 'Staff Reporting (T&R)' | 'Task Delegation (TRS)' | 'Performance Appraisal' | 'System & Administration';
  description: string;
  recommendedRoles: UserRole[];
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: 'submitTRReport',
    title: 'T&R Staff Weekly Reporting',
    category: 'Staff Reporting (T&R)',
    description: 'Allows staff to fill out weekly job description (JD) task checklists, track progress, and submit weekly activity reports to direct superiors.',
    recommendedRoles: ['staff', 'manager', 'executive', 'admin']
  },
  {
    key: 'viewTeamTRReports',
    title: 'Team T&R Review & Monitoring',
    category: 'Staff Reporting (T&R)',
    description: 'Grants access to review, inspect, and provide supervisor feedback on submitted weekly reports for direct reports and department team members.',
    recommendedRoles: ['manager', 'executive', 'admin']
  },
  {
    key: 'submitTRSTasks',
    title: 'TRS Task Execution & Submission',
    category: 'Task Delegation (TRS)',
    description: 'Enables user to receive assigned superior tasks, update completion status, attach proof documents/notes, and submit for evaluation.',
    recommendedRoles: ['staff', 'manager', 'executive', 'admin']
  },
  {
    key: 'approveAppraisals',
    title: 'Executive Appraisal Final Approval',
    category: 'Performance Appraisal',
    description: 'Grants executive-level sign-off authority to grant final board approvals and e-sign pending staff appraisal documents.',
    recommendedRoles: ['executive', 'admin']
  },
  {
    key: 'manageUsers',
    title: 'User Accounts & Permission Controls',
    category: 'System & Administration',
    description: 'Grants permission to create new user accounts, edit staff profiles, reset passwords, and dynamically grant or revoke feature access checkboxes.',
    recommendedRoles: ['admin']
  },
  {
    key: 'manageTemplates',
    title: 'JD Position Template Configuration',
    category: 'System & Administration',
    description: 'Allows creating, modifying, and exporting Job Description (JD) checklist templates and weighting criteria for various job titles.',
    recommendedRoles: ['admin', 'manager']
  },
  {
    key: 'viewAuditLogs',
    title: 'System Audit Trail & Security Logs',
    category: 'System & Administration',
    description: 'Grants access to view security activity audit logs, user login history, administrative action trails, and system timestamps.',
    recommendedRoles: ['admin']
  }
];

export function getDefaultPermissions(role: UserRole): UserPermissions {
  switch (role) {
    case 'admin':
      return {
        submitTRReport: true,
        viewTeamTRReports: true,
        submitTRSTasks: true,
        evaluatePerformance: true,
        approveAppraisals: true,
        manageUsers: true,
        manageTemplates: true,
        viewAuditLogs: true
      };
    case 'hr':
    case 'executive':
      return {
        submitTRReport: true,
        viewTeamTRReports: true,
        submitTRSTasks: true,
        evaluatePerformance: true,
        approveAppraisals: true,
        manageUsers: true,
        manageTemplates: true,
        viewAuditLogs: true
      };
    case 'manager':
      return {
        submitTRReport: true,
        viewTeamTRReports: true,
        submitTRSTasks: true,
        evaluatePerformance: true,
        approveAppraisals: false,
        manageUsers: false,
        manageTemplates: true,
        viewAuditLogs: false
      };
    case 'staff':
    default:
      return {
        submitTRReport: true,
        viewTeamTRReports: false,
        submitTRSTasks: true,
        evaluatePerformance: false,
        approveAppraisals: false,
        manageUsers: false,
        manageTemplates: false,
        viewAuditLogs: false
      };
  }
}

export function getUserPermissions(user: User): UserPermissions {
  const defaults = getDefaultPermissions(user.role);
  if (!user.permissions) return defaults;
  return { ...defaults, ...user.permissions };
}

export function hasUserPermission(user: User, permKey: keyof UserPermissions): boolean {
  if (user.role === 'admin') return true;
  // evaluatePerformance is no longer an admin-toggleable feature: every role may
  // open the Performance Evaluation tab, but only superiors can sign an appraisal.
  // Derived from role so it cannot be revoked per-user from the console.
  if (permKey === 'evaluatePerformance') {
    return ['manager', 'executive', 'hr'].includes(user.role);
  }
  const perms = getUserPermissions(user);
  return !!perms[permKey];
}

export interface OnboardingStatus {
  completed: boolean;
  telegramConnected: boolean;
  jdReviewed: boolean;
  firstReportSubmitted: boolean;
  dismissedAt?: string;
}

export interface User {
  id: string;
  username: string;
  password?: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  position: string;
  superiorId: string | null;
  avatarUrl?: string;
  permissions?: UserPermissions;
  telegramChatId?: string;
  telegramUsername?: string;
  telegramConnectedAt?: string;
  onboarding?: OnboardingStatus;
  mustChangePassword?: boolean;
}

/**
 * Checklist deliverable frequency, stored per template item in
 * `role_templates.items` JSON (no DB enum to change).
 *
 * - Weekly  : fixed routine, must be done every week. N/A is never allowed.
 * - Monthly : periodic duty, N/A allowed EXCEPT in the month's final week when
 *             it was not completed in an earlier week of that same month.
 *             A monthly deliverable is scheduled by its owner in exactly one week
 *             of the month, and that first record claims it: the week being filled
 *             in stays editable while it is a draft, every OTHER week of that month
 *             shows it locked, submitting freezes it, and a new month releases it.
 * - Anytime : ad-hoc / on-requirement duty. Staff may select N/A at any time,
 *             in any week, with no month-end lock.
 * - Yearly  : annual duty. Same shape as Monthly but the cycle unit is a YEAR:
 *             the owner schedules it in exactly one week of the cycle and that
 *             record claims it (1 submission per year — every other week of the
 *             cycle shows it locked). N/A is allowed everywhere EXCEPT during the
 *             cycle's final month, which is the FIRST month of the following
 *             calendar year (a 2026 cycle therefore runs into January 2027 and
 *             expires on 31 Jan 2027). From 1 February the cycle rolls over and
 *             the deliverable returns to N/A.
 */
export type ChecklistFrequency = 'Weekly' | 'Monthly' | 'Anytime' | 'Yearly';
export type ChecklistItemStatus = 'completed' | 'incomplete' | 'na';

export interface ChecklistItem {
  id: string;
  title: string;
  category: ChecklistFrequency;
  weight: number; // 1-5
  description?: string;
}

export interface RoleTemplate {
  id: string;
  positionTitle: string;
  department: string;
  items: ChecklistItem[];
  lastUpdated: string;
  version?: number; // Template version (increments on edit, e.g. v1, v2)
  effectiveYear?: number;
  effectiveWeek?: number;
}

export interface ProofItem {
  id: string;
  type: 'file' | 'cloud_link' | 'telegram_link';
  name: string; // File name or link title
  url: string; // S3 public URL (uploaded files) or web / Telegram link
  s3Key?: string; // S3 object key for uploaded proof files
  size?: number; // bytes (for file)
  uploadedAt: string;
}

export interface MultiProofData {
  files: ProofItem[];
  cloudLinks: ProofItem[];
  telegramLinks: ProofItem[];
}

export interface TRSTaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  userAvatar?: string;
  message: string;
  createdAt: string;
  replyToCommentId?: string;
  authorId?: string;
  authorName?: string;
  authorRole?: UserRole;
  replyToId?: string;
}

export interface NoticeReadReceipt {
  userId: string;
  userName: string;
  userRole: UserRole;
  department: string;
  readAt: string;
}

export interface AnnouncementNotice {
  id: string;
  title: string;
  content: string;
  priority: 'urgent' | 'important' | 'standard';
  category: 'General' | 'Policy' | 'Deadline' | 'System';
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  departmentScope?: string; // 'all' or specific department
  createdAt: string;
  readReceipts: NoticeReadReceipt[];
  isPinned?: boolean;
}

export interface ScoreDispute {
  status: 'Pending' | 'Resolved' | 'Rejected';
  reason: string;
  requestedAt: string;
  staffId: string;
  staffName: string;
  originalScore: number;
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  revisedScore?: number;
}

export interface TRSTaskRevisionLog {
  count: number;
  date: string;
  requestedBy: string;
  requestedByName: string;
  feedback: string;
}

export interface UnlockAuditTrail {
  unlockedAt: string;
  unlockedBy: string;
  unlockedByName: string;
  unlockedByRole?: string;
  reason: string;
  waiveLatePenalty: boolean;
  previousStatus?: string;
}

export interface TRSExtensionRequest {
  id: string;
  requestedAt: string;
  requestedDeadline: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  previousDeadline: string;
}

export interface SubmittedChecklistItem {
  itemId: string;
  title: string;
  category: ChecklistFrequency;
  completed: boolean; // Backwards compatible (true when status === 'completed')
  status?: ChecklistItemStatus; // 'completed' | 'incomplete' | 'na'
  note?: string;
}

export interface TRSTask {
  id: string;
  title: string;
  assignedBy: string; // Superior user ID
  assignedByName: string;
  assignedTo: string; // Staff user ID
  assignedToName: string;
  department: string;
  description: string;
  assignedDate: string;
  deadline: string;
  code?: string; // Unique task code, e.g. TRS-001
  project?: string; // Project / operational stream name
  priority?: 'Urgent' | 'High' | 'Medium' | 'Low';
  progress?: number; // 0 - 100 completion percentage
  instructions?: string; // 1. Instruction: guidance and steps
  scope?: string; // 2. Scope: boundaries and deliverables
  qualityCriteria?: string; // 3. Quality: acceptance standards
  status: 'Pending' | 'In Progress' | 'Completed' | 'Overdue' | 'Defaulted';
  evaluationStatus?: 'Approved' | 'Reviewed' | 'Revision';
  evaluationDate?: string;
  evaluatedBy?: string;
  completionDate?: string;
  score?: number; // 0 - 100 (undefined while pending superior evaluation)
  feedback?: string; // Superior evaluation notes/feedback
  staffRemarks?: string; // Staff remarks, progress notes, or comments before/during execution
  submissionNotes?: string; // Deliverable submission accomplishment notes
  delayReason?: string; // Mandatory explanation if submitted after deadline
  timelinessScore?: number; // 0 - 40 pts automated timeliness score
  qualityScore?: number; // 0 - 60 pts total quality score
  instructionScore?: number; // 0 - 20 pts Pillar 1: Instruction compliance
  scopeScore?: number; // 0 - 20 pts Pillar 2: Scope coverage
  accuracyScore?: number; // 0 - 20 pts Pillar 3: Quality & accuracy standard
  latePenaltyWaived?: boolean; // Superior granted waiver for late submission
  isDefaulted?: boolean; // Auto-locked at 0% — 7+ days past deadline without submission
  defaultedAt?: string;
  unlockHistory?: UnlockAuditTrail[]; // Administrative unlock audit trail
  revisionCount?: number; // Number of times revision was requested (Max 2 before auto-escalating on 3rd)
  revisionHistory?: TRSTaskRevisionLog[];
  isEscalated?: boolean;
  escalatedTo?: string; // Superior user ID
  escalatedToName?: string;
  escalatedReason?: string;
  escalatedAt?: string;
  escalationLevel?: 'none' | 'reminded' | 'escalated';
  dispute?: ScoreDispute;
  proofUrl?: string;
  multiProof?: MultiProofData;
  comments?: TRSTaskComment[];
  submittedAt?: string;
  signature?: SignatureData;
}

export interface SignatureData {
  type: 'handwritten' | 'digital_type' | 'uploaded' | 'badge';
  dataUrl: string; // Base64 canvas image, uploaded image data URL, or text stamp
  signedAt: string;
  signeeName: string;
}

export interface WeeklyReport {
  id: string;
  staffId: string;
  staffName: string;
  department: string;
  position: string;
  superiorId: string | null;
  year: number;
  quarter: number; // 1, 2, 3, 4
  month: number; // 1 - 12
  weekNumber: number; // 1 - 52
  startDate: string;
  endDate: string;
  submissionDate: string;
  checklistItems: SubmittedChecklistItem[];
  trScore: number; // 0 - 100%
  completionScore?: number; // 0 - 50 pts (from checklist completion)
  timelinessScore?: number; // 0 - 20 pts (submitted on or before deadline)
  qualityScore?: number; // 0 - 30 pts (superior quality verification)
  signature?: SignatureData;
  notes?: string;
  delayReason?: string; // Explanation for late or retroactive submission (e.g. system adoption backfill)
  latePenaltyWaived?: boolean; // Superior granted waiver for late submission
  waivedBy?: string; // Superior ID who granted waiver
  waivedByName?: string; // Superior name who granted waiver
  aiSummary?: string;
  multiProof?: MultiProofData;
  templateVersion?: number;
  templateId?: string;
  status: 'Draft' | 'Submitted' | 'Reviewed' | 'Approved';
  managerFeedback?: string;
  reviewDate?: string;
  dispute?: ScoreDispute;
  escalatedTo?: string; // Senior superior user ID
  escalatedToName?: string;
  escalationLevel?: 'none' | 'reminded' | 'escalated';
  escalatedAt?: string;
  approvedDeadline?: string; // Official extended submission deadline (superior approved grace period)
  extensionRequest?: TRSExtensionRequest; // Staff extension request before or during deadline
  extensionHistory?: TRSExtensionRequest[]; // Historical log of requested extensions
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  userRole: string;
  action: string;
  details: string;
  ipAddress?: string;
}

export interface PerformanceFilter {
  department: string;
  year: number;
  quarter: string; // 'all' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
  month: string; // 'all' | '1'..'12'
  staffId: string; // 'all' | staffId
}

export interface NotificationItem {
  id: string;
  timestamp: string;
  recipientUserId: string; // 'all' or specific userId or 'superiors'
  senderId: string;
  senderName: string;
  type: 'REPORT_SUBMITTED' | 'REPORT_REVIEWED' | 'REPORT_DELETED' | 'TASK_ASSIGNED' | 'TASK_UPDATED' | 'APPRAISAL_SIGNED' | 'APPRAISAL_APPROVED' | 'DEADLINE_ALERT' | 'SYSTEM' | 'DISPUTE_SUBMITTED' | 'DISPUTE_RESOLVED' | 'REVIEW_ESCALATED' | 'MONTHLY_NA_WARNING' | 'REVISION_ESCALATED';
  title: string;
  message: string;
  read: boolean;
  linkTab?: 'tr' | 'trs' | 'evaluation' | 'admin';
}

export interface TelegramUserMapping {
  chatId?: string;
  username?: string; // e.g. @sokmouy
  enableDirectDMs: boolean;
}

export interface TelegramConfig {
  isEnabled: boolean;
  botToken: string;
  hasToken?: boolean; // backend reports presence of a stored token (never the token itself)
  botUsername: string; // e.g. @APATaskReportBot
  mainGroupChatId?: string; // Optional group/channel if ever needed in future
  channelName?: string;
  triggers: {
    notifyTRSubmitted: boolean;
    notifyTRReviewed: boolean;
    notifyTRSAssigned: boolean;
    notifyTRSStatusChanged: boolean;
    notifyTRSSubmitted: boolean;
    notifyTRSScored: boolean;
    notifyDeadlines: boolean; // Auto alerts for 5,4,3,2,1 days and overdue
    notifyDailyDigest: boolean;
    notifyAppraisalPending: boolean;
    notifyAppraisalApproved: boolean;
  };
  userTelegramHandles: Record<string, TelegramUserMapping>; // userId -> TelegramUserMapping
  createdAt?: string;
  updatedAt?: string;
}

export interface TelegramOutboxMessage {
  id: string;
  timestamp: string;
  eventType: 'TR_SUBMIT' | 'TR_REVIEW' | 'TRS_ASSIGN' | 'TRS_STATUS' | 'TRS_SUBMIT' | 'TRS_SCORE' | 'DEADLINE_ALERT' | 'APPRAISAL_PENDING' | 'APPRAISAL_APPROVED' | 'TEST_MESSAGE' | 'DISPUTE_SUBMITTED' | 'DISPUTE_RESOLVED' | 'REVIEW_ESCALATED' | 'MONTHLY_NA_WARNING' | 'REVISION_ESCALATED';
  targetType: 'group' | 'direct_dm' | 'all';
  targetChatId: string;
  targetRecipientName: string;
  formattedText: string;
  status: 'queued' | 'sent' | 'simulated' | 'failed';
  errorMessage?: string;
}

export interface AppraisalRecord {
  id: string;
  staffId: string;
  staffName: string;
  department: string;
  position: string;
  year?: number;
  periodYear?: number;
  periodQuarter?: string;
  periodMonth?: string;
  period?: string;
  trScore: number;
  trsScore: number;
  overallScore: number;
  evaluationStatus?: 'Outstanding' | 'Satisfactory' | 'Needs Review';
  signatureMode: 'physical' | 'digital' | 'hard_copy';
  status: 'Draft' | 'Pending Executive Approval' | 'Fully Approved';

  // Prepared / Evaluated By (Department Superior / Manager)
  preparedByUserId?: string;
  preparedByName?: string;
  preparedByRole?: string;
  preparedSignature?: SignatureData;
  preparedBySignature?: SignatureData;
  preparedDate?: string;
  preparedNotes?: string;

  // Approved By (Executive Management / HR)
  approvedByUserId?: string;
  approvedByName?: string;
  approvedByRole?: string;
  approvedSignature?: SignatureData;
  approvedBySignature?: SignatureData;
  approvedDate?: string;
  approvedNotes?: string;

  createdAt: string;
  updatedAt: string;
}


// ---------------------------------------------------------------
// Org config (admin-managed Departments & Position / Job Titles)
// ---------------------------------------------------------------
export type OrgConfigKind = 'department' | 'position';

export interface OrgConfigEntry {
  id: number;
  kind: OrgConfigKind;
  name: string;
  /** false = soft-deleted: hidden from all dropdowns, history preserved. */
  isActive: boolean;
  usageCount: number;
  createdAt?: string;
  updatedAt?: string;
  deactivatedAt?: string | null;
}
