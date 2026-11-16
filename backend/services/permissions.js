// Permission matrix — mirrors frontend types.ts (7 keys + role defaults).
// 'evaluatePerformance' is intentionally absent: the Performance Evaluation tab is
// open to every role, and signing an appraisal is authorised by role in
// requirePermission() below rather than by an admin-toggleable feature flag.
// 'gradeTRSTasks' is intentionally absent for the same reason: grading a TRS task
// is authorised by the reporting hierarchy (see routes/trs.js evaluate/reopen),
// not by an admin-toggleable feature flag.
// 'assignTRSTasks' is intentionally absent because creating and delegating a TRS
// task is open to every authenticated staff member; who you may delegate TO is
// still constrained by the reporting hierarchy in routes/trs.js.
export const PERMISSION_KEYS = [
  'submitTRReport',
  'viewTeamTRReports',
  'submitTRSTasks',
  'approveAppraisals',
  'manageUsers',
  'manageTemplates',
  'viewAuditLogs'
];

export const ROLE_DEFAULT_PERMISSIONS = {
  admin: {
    submitTRReport: true,
    viewTeamTRReports: true,
    submitTRSTasks: true,
    approveAppraisals: true,
    manageUsers: true,
    manageTemplates: true,
    viewAuditLogs: true
  },
  executive: {
    submitTRReport: true,
    viewTeamTRReports: true,
    submitTRSTasks: true,
    approveAppraisals: true,
    manageUsers: true,
    manageTemplates: true,
    viewAuditLogs: true
  },
  hr: {
    submitTRReport: true,
    viewTeamTRReports: true,
    submitTRSTasks: true,
    approveAppraisals: true,
    manageUsers: true,
    manageTemplates: true,
    viewAuditLogs: true
  },
  manager: {
    submitTRReport: true,
    viewTeamTRReports: true,
    submitTRSTasks: true,
    approveAppraisals: false,
    manageUsers: false,
    manageTemplates: true,
    viewAuditLogs: false
  },
  staff: {
    submitTRReport: true,
    viewTeamTRReports: false,
    submitTRSTasks: true,
    approveAppraisals: false,
    manageUsers: false,
    manageTemplates: false,
    viewAuditLogs: false
  }
};

export function emptyPermissions() {
  const perms = {};
  for (const k of PERMISSION_KEYS) perms[k] = false;
  return perms;
}

// Merge role defaults with the user's stored overrides (from user_permissions rows)
export function mergePermissions(role, stored = {}) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.staff;
  const out = { ...defaults };
  for (const [key, allowed] of Object.entries(stored || {})) {
    if (key in out) out[key] = !!allowed;
  }
  // Legacy rows for the removed evaluatePerformance, gradeTRSTasks and
  // assignTRSTasks flags are ignored above (key not in defaults) — signing
  // authority comes from the role, grading authority from the reporting hierarchy,
  // and task delegation from the hierarchy too. Existing user_permissions rows for
  // those keys are harmless and need no migration.
  return out;
}

// Build the stored-override map { key: bool } from DB rows
export function rowsToPermissionMap(rows) {
  const map = {};
  for (const r of rows || []) map[r.permission_key] = !!r.allowed;
  return map;
}