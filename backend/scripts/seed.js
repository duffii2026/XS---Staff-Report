// Seed script — loads starter data into the configured database.
// Run: npm run seed  (from backend/)
import mysql from 'mysql2/promise';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { PERMISSION_KEYS, ROLE_DEFAULT_PERMISSIONS } from '../services/permissions.js';
import { encryptPassword } from '../services/passwordCrypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------
const USERS = [
  { code: 'user_shawn', username: 'shawn',     name: 'Mr. SN',  email: 'shawn@company.corp',    role: 'admin',     department: 'GM Office',       position: 'GM',             superiorId: null,  avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_cfo',   username: 'cfo',       name: 'Mr. CFO', email: 'cfo@company.corp',      role: 'executive', department: 'CFO Office',      position: 'CFO',            superiorId: null,  avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_hr',    username: 'hr',        name: 'Ms. HR', email: 'hr@company.corp',       role: 'hr',       department: 'Human Resources', position: 'HR Manager',    superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_chunny', username: 'chunny',   name: 'Mr. CY',  email: 'chunny@company.corp',   role: 'manager',   department: 'Digital Marketing', position: 'Manager',        superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_maly',  username: 'maly',      name: 'Ms. ML',  email: 'maly@company.corp',     role: 'manager',   department: 'Operation',        position: 'Manager',        superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_pheng', username: 'pheng',     name: 'Mr. BSP', email: 'pheng@company.corp',    role: 'manager',   department: 'Marketing',        position: 'Manager',        superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_sreykhouch', username: 'sreykhouch', name: 'Ms. SK', email: 'sreykhouch@company.corp', role: 'manager', department: 'GM Office', position: 'Assistant GM', superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_bormey', username: 'bormey',   name: 'Ms. BM',  email: 'bormey@company.corp',   role: 'manager',   department: 'Operation',        position: 'Supervisor',     superiorId: 'user_maly',  avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_sokmouy', username: 'sokmouy', name: 'Ms. SM',  email: 'sokmouy@company.corp',  role: 'manager',   department: 'Marketing',        position: 'Assistant GM',   superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_naomi', username: 'naomi',     name: 'Ms. TNM', email: 'naomi@company.corp',    role: 'manager',   department: 'HR',               position: 'Supervisor',     superiorId: 'user_sokmouy', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_tola',  username: 'tola',      name: 'Mr. TL',  email: 'tola@company.corp',     role: 'manager',   department: 'Marketing',        position: 'Supervisor',     superiorId: 'user_pheak', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_pheak', username: 'pheak',     name: 'Mr. OSP', email: 'pheak@company.corp',    role: 'manager',   department: 'SEP',              position: 'Assistant Manager', superiorId: 'user_shawn', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_korb',  username: 'korb',      name: 'Mr. EK',  email: 'korb@company.corp',     role: 'manager',   department: 'Digital Marketing', position: 'Supervisor',    superiorId: 'user_chunny', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_chandara', username: 'chandara', name: 'Mr. DR', email: 'chandara@company.corp', role: 'manager',  department: 'DT',               position: 'Supervisor',     superiorId: 'user_chunny', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_sophak', username: 'sophak',   name: 'Mr. PSP', email: 'sophak@company.corp',   role: 'staff',     department: 'Digital Marketing', position: 'Assistant Supervisor', superiorId: 'user_korb', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
  { code: 'user_admin', username: 'Admin',     name: 'Administrator', email: 'admin@company.corp', role: 'admin', department: 'Others', position: 'Administrator', superiorId: null, avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80' }
];

const TEMPLATES = [
  { code: 'tmpl_agm', positionTitle: 'Assistant GM', department: 'Marketing', items: [
    { id: 'agm1', title: 'Review and consolidate departmental weekly milestone reports for GM review', category: 'Weekly', weight: 5, description: 'Track progress across all active operational streams' },
    { id: 'agm2', title: 'Coordinate cross-functional project alignment meetings between department heads', category: 'Weekly', weight: 5, description: 'Ensure timely resolution of operational blockers' },
    { id: 'agm3', title: 'Monitor weekly marketing campaigns and team KPI deliverables', category: 'Weekly', weight: 4, description: 'Review performance metrics vs quarterly goals' },
    { id: 'agm4', title: 'Supervise urgent TRS action items delegated by General Manager', category: 'Weekly', weight: 5, description: 'Follow up with department supervisors on execution' },
    { id: 'agm5', title: 'Prepare monthly executive summary and strategic performance dashboard', category: 'Monthly', weight: 5, description: 'Present key business metrics to Executive Committee' }
  ] },
  { code: 'tmpl_mgr', positionTitle: 'Manager', department: 'Marketing', items: [
    { id: 'mgr1', title: 'Conduct weekly department team standup and assign sprint priorities', category: 'Weekly', weight: 5, description: 'Align team deliverables with weekly targets' },
    { id: 'mgr2', title: 'Review, evaluate, and approve direct subordinate weekly T&R reports', category: 'Weekly', weight: 5, description: 'Provide constructive feedback and performance guidance' },
    { id: 'mgr3', title: 'Delegate and monitor superior TRS tasks to team members', category: 'Weekly', weight: 4, description: 'Track task deadlines and verify submitted proof deliverables' },
    { id: 'mgr4', title: 'Track departmental operational budget spending and resource allocation', category: 'Weekly', weight: 4, description: 'Maintain adherence to quarterly plan' },
    { id: 'mgr5', title: 'Submit monthly departmental operational accomplishment report', category: 'Monthly', weight: 5, description: 'Deliver comprehensive summary to GM Office' }
  ] },
  { code: 'tmpl_sup', positionTitle: 'Supervisor', department: 'Operation', items: [
    { id: 'sup1', title: 'Supervise daily field operations and ensure standard operating procedures (SOP)', category: 'Weekly', weight: 5, description: 'Maintain operational compliance and quality standards' },
    { id: 'sup2', title: 'Review staff shift attendance, task allocations, and daily logs', category: 'Weekly', weight: 4, description: 'Resolve daily operational discrepancies' },
    { id: 'sup3', title: 'Execute and submit superior-delegated TRS task deliverables', category: 'Weekly', weight: 5, description: 'Meet all assigned deadlines and quality benchmarks' },
    { id: 'sup4', title: 'Conduct weekly safety & operational efficiency inspection', category: 'Weekly', weight: 4, description: 'Document checklist and flag any risks immediately' },
    { id: 'sup5', title: 'Compile monthly team operational productivity and resource review', category: 'Monthly', weight: 5, description: 'Submit to Department Manager by end of month' }
  ] },
  { code: 'tmpl_asst_sup', positionTitle: 'Assistant Supervisor', department: 'Digital Marketing', items: [
    { id: 'asup1', title: 'Assist supervisor in monitoring daily task completion and workflow', category: 'Weekly', weight: 5, description: 'Ensure team members adhere to schedule' },
    { id: 'asup2', title: 'Execute assigned digital marketing campaigns and content scheduling', category: 'Weekly', weight: 5, description: 'Verify posts, links, and tracking tags' },
    { id: 'asup3', title: 'Gather weekly performance metrics and draft campaign analytics report', category: 'Weekly', weight: 4, description: 'Track CTR, conversions, and engagement rates' },
    { id: 'asup4', title: 'Complete assigned TRS action items with verified documentation', category: 'Weekly', weight: 5, description: 'Submit proof deliverables prior to deadline' },
    { id: 'asup5', title: 'Conduct monthly content archive and competitor benchmark analysis', category: 'Monthly', weight: 4, description: 'Submit insights to Supervisor and Manager' }
  ] },
  { code: 'tmpl_dev_sr', positionTitle: 'Senior Software Engineer', department: 'Back Office', items: [
    { id: 'dev1', title: 'Complete weekly sprint code reviews for assigned team PRs', category: 'Weekly', weight: 5, description: 'Ensure quality standards and 24h turnaround time' },
    { id: 'dev2', title: 'Deliver assigned user stories and engineering bug fixes', category: 'Weekly', weight: 5, description: 'Check off Jira/GitHub issues in active sprint' },
    { id: 'dev3', title: 'Maintain backend API uptime and monitor production error logs', category: 'Weekly', weight: 4, description: 'Review Cloud Run logs and Datadog alerts' },
    { id: 'dev4', title: 'Participate in weekly agile engineering grooming & standups', category: 'Weekly', weight: 3, description: 'Attendance and active contribution' },
    { id: 'dev5', title: 'Conduct monthly system architecture & security vulnerability assessment', category: 'Monthly', weight: 5, description: 'Audit package vulnerabilities and code dependencies' },
    { id: 'dev6', title: 'Submit monthly technical debt optimization report', category: 'Monthly', weight: 4, description: 'Propose refactoring priorities to Engineering Director' }
  ] },
  { code: 'tmpl_dev_fe', positionTitle: 'Frontend Engineer', department: 'Design Team', items: [
    { id: 'fe1', title: 'Implement dynamic UI components according to Figma design specs', category: 'Weekly', weight: 5, description: 'Ensure high pixel precision and Tailwind responsiveness' },
    { id: 'fe2', title: 'Run cross-browser performance and accessibility audit (WCAG AA)', category: 'Weekly', weight: 4, description: 'Check contrast and Lighthouse scores above 90' },
    { id: 'fe3', title: 'Fix reported frontend bugs and customer UI tickets', category: 'Weekly', weight: 4, description: 'Resolve open GitHub issues' },
    { id: 'fe4', title: 'Update frontend UI component library & documentation', category: 'Monthly', weight: 3, description: 'Maintain modular design guidelines' }
  ] },
  { code: 'tmpl_hr_sup', positionTitle: 'Supervisor', department: 'HR', items: [
    { id: 'hr_sup1', title: 'Audit weekly staff attendance, fingerprint logs, and leave approval records', category: 'Weekly', weight: 5, description: 'Verify timesheet accuracy for all departments' },
    { id: 'hr_sup2', title: 'Conduct weekly recruitment candidate screening and interview coordination', category: 'Weekly', weight: 4, description: 'Fill open departmental requisitions on schedule' },
    { id: 'hr_sup3', title: 'Review and execute superior TRS action items and staff relations cases', category: 'Weekly', weight: 5, description: 'Address workplace and compliance matters' },
    { id: 'hr_sup4', title: 'Prepare monthly salary adjustment, bonus review, and payroll computation', category: 'Monthly', weight: 5, description: 'Execute salary adjustments in cycle week; N/A in off-weeks' },
    { id: 'hr_sup5', title: 'Submit monthly NSSF and tax compliance declaration report', category: 'Monthly', weight: 5, description: 'Monthly regulatory submission' }
  ] },
  { code: 'tmpl_hr_spec', positionTitle: 'HR Specialist', department: 'HR', items: [
    { id: 'hr1', title: 'Process weekly staff attendance, leave requests, and payroll logs', category: 'Weekly', weight: 5, description: 'Verify timesheets and sign-offs' },
    { id: 'hr2', title: 'Conduct new employee onboarding and orientation sessions', category: 'Weekly', weight: 4, description: 'Provide system setup and welcome documentation' },
    { id: 'hr3', title: 'Screen job applicant resumes and schedule candidate interviews', category: 'Weekly', weight: 4, description: 'Maintain candidate pipeline in HR portal' },
    { id: 'hr4', title: 'Prepare monthly staff headcount and turnover analysis report', category: 'Monthly', weight: 5, description: 'Submit to HR Director by 28th' }
  ] },
  { code: 'tmpl_sales_acc', positionTitle: 'Account Executive', department: 'Digital Marketing', items: [
    { id: 'sales1', title: 'Log minimum 25 prospect calls/outreach touchpoints per week', category: 'Weekly', weight: 5, description: 'Track leads in CRM dashboard' },
    { id: 'sales2', title: 'Conduct product demonstrations and client discovery meetings', category: 'Weekly', weight: 5, description: 'Present solution capabilities to qualified leads' },
    { id: 'sales3', title: 'Send custom proposals and follow up with pending client deals', category: 'Weekly', weight: 4, description: 'Advance deals to closed-won stage' },
    { id: 'sales4', title: 'Submit monthly sales forecast & deal pipeline revenue report', category: 'Monthly', weight: 5, description: 'Review progress toward quarterly target' }
  ] }
];

const TRS_TASKS = [
  { code: 'trs_cpam_1', title: 'please check the CPAM', assignedBy: 'user_shawn', assignedByName: 'Mr. SN', assignedTo: 'user_sokmouy', assignedToName: 'Ms. SM', department: 'Marketing', description: 'please check in as soon as possible', assignedDate: '2026-08-10', deadline: '2026-08-12', status: 'Completed', progress: 100, completionDate: '2026-08-10', submittedAt: '2026-08-10T14:30:00Z', submissionNotes: 'CPAM reviewed and verified all items.', proofUrl: 'https://drive.google.com/file/d/cpam-verification-report.pdf', timelinessScore: 40, score: null, feedback: 'Submitted on time. Timeliness: 40/40 pts. Pending superior quality review and evaluation.', staffRemarks: 'CPAM reviewed and verified all items.' },
  { code: 'trs_urgent_promo', title: 'Finalize Mid-Year Marketing Campaign Strategy & Budget', assignedBy: 'user_shawn', assignedByName: 'Mr. SN', assignedTo: 'user_sokmouy', assignedToName: 'Ms. SM', department: 'Marketing', description: 'Review promotional channel ROI and submit finalized marketing budget breakdown for Q3.', assignedDate: '2026-08-20', deadline: '2026-08-27', status: 'In Progress', priority: 'Urgent', progress: 60, score: null, staffRemarks: 'Gathering agency proposals and ad spend estimates.' },
  { code: 'trs_sup_ops', title: 'Quarterly Inventory Audit & Warehouse Logistics Review', assignedBy: 'user_maly', assignedByName: 'Ms. ML', assignedTo: 'user_bormey', assignedToName: 'Ms. BM', department: 'Operation', description: 'Complete on-site inventory reconciliation and report any discrepancies.', assignedDate: '2026-08-18', deadline: '2026-08-25', status: 'In Progress', priority: 'High', progress: 40, score: null, staffRemarks: 'Audit in progress across Sector B and C.' },
  { code: 'trs_dt_urgent', title: 'System Server Security & Access Control Review', assignedBy: 'user_shawn', assignedByName: 'Mr. SN', assignedTo: 'user_chandara', assignedToName: 'Mr. DR', department: 'DT', description: 'Conduct comprehensive access token review and patch legacy endpoints.', assignedDate: '2026-08-19', deadline: '2026-08-24', status: 'Pending', priority: 'High', progress: 0, score: null }
];

const APPRAISALS = [
  { code: 'appraisal_naomi_2026', staffCode: 'user_naomi', staffName: 'Ms. TNM', department: 'HR', position: 'Supervisor', periodYear: 2026, periodQuarter: 'Full Year', period: '2026 (Full Year)', trScore: 92, trsScore: 88, overallScore: 90, status: 'Pending Executive Approval', signatureMode: 'digital', preparedByUserCode: 'user_sokmouy', preparedByName: 'Ms. SM', preparedByRole: 'Assistant GM', preparedDate: '2026-08-15', preparedNotes: 'Consistently maintains HR operational benchmarks, timely recruitment logs, and staff compliance checklists.', preparedSignature: { type: 'digital_type', dataUrl: 'Verified Digital Stamp: Ms. SM [2026-08-15]', signedAt: '2026-08-15T10:30:00Z', signeeName: 'Ms. SM' } },
  { code: 'appraisal_tola_2026', staffCode: 'user_tola', staffName: 'Mr. TL', department: 'Marketing', position: 'Supervisor', periodYear: 2026, periodQuarter: 'Full Year', period: '2026 (Full Year)', trScore: 94, trsScore: 96, overallScore: 95, status: 'Fully Approved', signatureMode: 'digital', preparedByUserCode: 'user_pheng', preparedByName: 'Mr. BSP', preparedByRole: 'Manager', preparedDate: '2026-08-10', preparedNotes: 'Exemplary campaign delivery, outstanding T&R tracking, and timely TRS superior task execution.', preparedSignature: { type: 'digital_type', dataUrl: 'Verified Digital Stamp: Mr. BSP [2026-08-10]', signedAt: '2026-08-10T14:00:00Z', signeeName: 'Mr. BSP' }, approvedByUserCode: 'user_shawn', approvedByName: 'Mr. SN', approvedByRole: 'GM', approvedDate: '2026-08-11', approvedNotes: 'Official executive board approval granted. Promoted to higher grade tier.', approvedSignature: { type: 'digital_type', dataUrl: 'Verified Digital Stamp: Mr. SN (GM) [2026-08-11]', signedAt: '2026-08-11T09:15:00Z', signeeName: 'Mr. SN' } },
  { code: 'appraisal_korb_2026', staffCode: 'user_korb', staffName: 'Mr. EK', department: 'Digital Marketing', position: 'Supervisor', periodYear: 2026, periodQuarter: 'Full Year', period: '2026 (Full Year)', trScore: 88, trsScore: 84, overallScore: 86, status: 'Draft', signatureMode: 'digital' }
];

const NOTIFICATIONS = [
  { code: 'notif_seed_1', recipientUserCode: 'user_shawn', senderCode: 'user_sokmouy', senderName: 'Ms. SM', type: 'REPORT_SUBMITTED', title: 'Weekly Report Submitted', message: 'Ms. SM submitted Weekly T&R Report for Week 33 (Score: 90%).', linkTab: 'tr', read: false },
  { code: 'notif_seed_2', recipientUserCode: 'user_sokmouy', senderCode: 'user_shawn', senderName: 'Mr. SN', type: 'TASK_ASSIGNED', title: 'New TRS Task Delegated', message: 'Mr. SN assigned you a new task: "Finalize Mid-Year Marketing Campaign Strategy & Budget" due on 2026-08-27.', linkTab: 'trs', read: false },
  { code: 'notif_seed_3', recipientUserCode: 'user_bormey', senderCode: 'user_maly', senderName: 'Ms. ML', type: 'TASK_ASSIGNED', title: 'New TRS Task Delegated', message: 'Ms. ML assigned you a task: "Quarterly Inventory Audit & Warehouse Logistics Review".', linkTab: 'trs', read: true },
  { code: 'notif_seed_4', recipientUserCode: 'user_sophak', senderCode: 'user_korb', senderName: 'Mr. EK', type: 'REPORT_REVIEWED', title: 'Report Reviewed', message: 'Mr. EK evaluated & marked your Week 32 report as "Reviewed". Feedback added.', linkTab: 'tr', read: false }
];

const ACTIVITY_LOGS = [
  { code: 'log_seed_1', userCode: 'user_admin', username: 'admin', userRole: 'admin', action: 'SYSTEM_BOOT', details: 'System initialized with Master Admin credentials and automated department hierarchies.', ipAddress: '127.0.0.1' },
  { code: 'log_seed_2', userCode: 'user_shawn', username: 'shawn', userRole: 'admin', action: 'SYSTEM_SEED', details: 'Configured database seeded with demo users, templates, TRS tasks, and appraisals.', ipAddress: '127.0.0.1' }
];

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Normalize ISO strings (2026-08-10T14:30:00Z) to MySQL DATETIME (2026-08-10 14:30:00)
function toDatetime(v) {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v} 00:00:00`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  console.log(`Seeding ${env.DB_NAME} ...`);

  const schemaPath = path.resolve(__dirname, '../sql/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: true,
    timezone: 'Z'
  });

  // 1) apply schema
  await conn.query(schema);
  console.log('Schema applied.');

  // 2) users + encrypted passwords
  const userPassword = async (username) => `${username}2026`;
  for (const u of USERS) {
    const pw = await userPassword(u.username);
    await conn.execute(
      `INSERT INTO users (code, username, password_hash, name, email, role, department, position, superior_id, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), is_active = 1`,
      [u.code, u.username, encryptPassword(pw), u.name, u.email, u.role, u.department, u.position, u.superiorId, u.avatar]
    );

    // permissions
    const defaults = ROLE_DEFAULT_PERMISSIONS[u.role] || {};
    for (const key of PERMISSION_KEYS) {
      const allowed = defaults[key] ? 1 : 0;
      await conn.execute(
        `INSERT INTO user_permissions (user_code, permission_key, allowed) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)`,
        [u.code, key, allowed]
      );
    }
  }
  console.log(`Users seeded: ${USERS.length}`);

  // 3) role templates
  for (const t of TEMPLATES) {
    await conn.execute(
      `INSERT INTO role_templates (code, position_title, department, last_updated, items, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE items = VALUES(items), last_updated = VALUES(last_updated)`,
      [t.code, t.positionTitle, t.department, '2026-08-01', JSON.stringify(t.items), 'user_admin']
    );
  }
  console.log(`Role templates seeded: ${TEMPLATES.length}`);

  // 4) TRS tasks
  for (const t of TRS_TASKS) {
    await conn.execute(
      `INSERT INTO trs_tasks
        (code, title, assigned_by, assigned_by_name, assigned_to, assigned_to_name, department, description,
         assigned_date, deadline, priority, progress, status, completion_date, submitted_at, submission_notes,
         proof_url, timeliness_score, score, feedback, staff_remarks)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), priority = VALUES(priority), progress = VALUES(progress), status = VALUES(status)`,
      [t.code, t.title, t.assignedBy, t.assignedByName, t.assignedTo, t.assignedToName, t.department, t.description,
       t.assignedDate, t.deadline, t.priority || null, t.progress ?? 0, t.status, toDatetime(t.completionDate),
       toDatetime(t.submittedAt), t.submissionNotes || null, t.proofUrl || null,
       t.timelinessScore != null ? t.timelinessScore : null, t.score != null ? t.score : null,
       t.feedback || null, t.staffRemarks || null]
    );
  }
  console.log(`TRS tasks seeded: ${TRS_TASKS.length}`);

  // 5) appraisals
  for (const a of APPRAISALS) {
    await conn.execute(
      `INSERT INTO appraisals
        (code, staff_code, staff_name, department, position, period_year, period_quarter, period,
         tr_score, trs_score, overall_score, status, signature_mode,
         prepared_by_user_code, prepared_by_name, prepared_by_role, prepared_date, prepared_notes, prepared_signature,
         approved_by_user_code, approved_by_name, approved_by_role, approved_date, approved_notes, approved_signature)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE overall_score = VALUES(overall_score), status = VALUES(status)`,
      [a.code, a.staffCode, a.staffName, a.department, a.position, a.periodYear, a.periodQuarter, a.period,
       a.trScore, a.trsScore, a.overallScore, a.status, a.signatureMode,
       a.preparedByUserCode || null, a.preparedByName || null, a.preparedByRole || null, toDatetime(a.preparedDate), a.preparedNotes || null,
       a.preparedSignature ? JSON.stringify(a.preparedSignature) : null,
       a.approvedByUserCode || null, a.approvedByName || null, a.approvedByRole || null, toDatetime(a.approvedDate), a.approvedNotes || null,
       a.approvedSignature ? JSON.stringify(a.approvedSignature) : null]
    );
  }
  console.log(`Appraisals seeded: ${APPRAISALS.length}`);

  // 6) notifications
  for (const n of NOTIFICATIONS) {
    await conn.execute(
      `INSERT INTO notifications (code, recipient_user_code, sender_code, sender_name, type, title, message, link_tab, is_read)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title = VALUES(title)`,
      [n.code, n.recipientUserCode, n.senderCode, n.senderName, n.type, n.title, n.message, n.linkTab, n.read ? 1 : 0]
    );
  }
  console.log(`Notifications seeded: ${NOTIFICATIONS.length}`);

  // 7) activity logs
  for (const l of ACTIVITY_LOGS) {
    await conn.execute(
      `INSERT INTO activity_logs (code, user_code, username, user_role, action, details, ip_address)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE details = VALUES(details)`,
      [l.code, l.userCode, l.username, l.userRole, l.action, l.details, l.ipAddress]
    );
  }
  console.log(`Activity logs seeded: ${ACTIVITY_LOGS.length}`);

  // 8) telegram config (single row)
  const tgTriggers = {
    notifyTRSubmitted: true, notifyTRReviewed: true, notifyTRSAssigned: true, notifyTRSStatusChanged: true,
    notifyTRSSubmitted: true, notifyTRSScored: true, notifyDeadlines: true, notifyDailyDigest: false,
    notifyAppraisalPending: true, notifyAppraisalApproved: true
  };
  const tgUserMap = {
    user_sokmouy: { username: '@sokmouy_sm', chatId: '110293847', enableDirectDMs: true },
    user_shawn: { username: '@shawn_sn', chatId: '992837461', enableDirectDMs: true },
    user_maly: { username: '@maly_ml', chatId: '883746251', enableDirectDMs: true },
    user_bormey: { username: '@bormey_bm', chatId: '774635241', enableDirectDMs: true },
    user_chandara: { username: '@chandara_dr', chatId: '665544332', enableDirectDMs: true },
    user_chhaiya: { username: '@chhaiya_ch', chatId: '554433221', enableDirectDMs: true }
  };
  await conn.execute(
    `INSERT INTO telegram_config (id, is_enabled, bot_token, bot_username, main_group_chat_id, channel_name, triggers, user_map)
     VALUES (1, 1, '', '@APATaskReportBot', NULL, 'APA Staff Reporting & Superior Task Alerts', ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), triggers = VALUES(triggers), user_map = VALUES(user_map)`,
    [JSON.stringify(tgTriggers), JSON.stringify(tgUserMap)]
  );
  console.log('Telegram config seeded.');

  // 9) bootstrap daemon API key (print raw once)
  const rawKey = `apa_k_${crypto.randomBytes(24).toString('base64url')}`;
  await conn.execute(
    `INSERT INTO api_keys (key_hash, user_code, name, scopes, expires_at, is_active)
     VALUES (?, 'user_admin', 'system-daemon', ?, NULL, 1)`,
    [sha256(rawKey), JSON.stringify(['*'])]
  );

  await conn.end();

  console.log('\n====================================================');
  console.log('Seed complete. Demo credentials:' +
    '\n  - admin : admin2026' +
    '\n  - shawn (GM) : shawn2026' +
    '\n  - sokmouy (Assistant GM) : sokmouy2026' +
    '\n  - chunny (Manager) : chunny2026' +
    '\n  - sophak (Staff) : sophak2026');
  console.log('Daemon API key (SEND-NEXT becomes unusable, store it):');
  console.log('  ' + rawKey);
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
