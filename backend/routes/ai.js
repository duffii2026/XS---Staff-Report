import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { getOne, query } from '../config/db.js';
import { requireUser } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { canAccessUser, getSubordinateCodes } from '../services/scoping.js';
import { logActivity, makeCode } from '../services/audit.js';

const router = Router();

let _client = null;
async function genaiClient() {
  if (!env.GEMINI_API_KEY) return null;
  if (_client) return _client;
  const { GoogleGenAI } = await import('@google/genai');
  _client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return _client;
}

/** GET /api/ai/status — is Gemini configured? */
router.get('/status', requireUser, asyncHandler(async (req, res) => {
  ok(res, { enabled: !!env.GEMINI_API_KEY });
}));

/** POST /api/ai/summarize — generate rubric feedback summary for a report/task */
router.post('/summarize', requireUser, asyncHandler(async (req, res) => {
  const client = await genaiClient();
  if (!client) throw new ApiError(501, 'AI is not configured (missing GEMINI_API_KEY).');

  const { kind = 'report', code, tone = 'professional' } = req.body || {};
  const text = req.body?.text || '';
  if (!text) throw new ApiError(400, 'text is required.');

  // Optional access check when a report code is referenced
  if (kind === 'report' && code) {
    const report = await getOne('SELECT * FROM reports WHERE code = ?', [code]);
    if (!report) throw new ApiError(404, 'Report not found.');
    if (!['admin', 'executive', 'hr'].includes(req.user.role)) {
      const subs = await getSubordinateCodes(req.user.code);
      if (report.staff_code !== req.user.code && !subs.includes(report.staff_code)) throw new ApiError(403, 'No access.');
    }
  }

  const prompt = `You are an APA staff-management assistant.
Write concise, constructive ${tone} feedback for a staff ${kind}.
Base it strictly on this content — never invent achievements or numbers:
"""
${text.slice(0, 6000)}
"""
Return a plain-text summary (3-6 sentences) plus 2 bullet action items.`;

  try {
    const result = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt
    });
    ok(res, { output: toPlainText(result.text) });
  } catch (err) {
    throw new ApiError(502, `AI generation failed: ${err.message}`);
  }
}));

/**
 * POST /api/ai/summarize-report  |  POST /api/ai/generate-summary
 *
 * "AI Executive Weekly Summary" for the T&R form. Accepts the structured
 * checklist payload the SPA posts and returns { summary }.
 *
 * Registered under both names on purpose: an older frontend server still
 * intercepts `/ai/summarize-report` locally (and fails with a stale API key),
 * while every other `/api/*` path is proxied straight to this backend. The SPA
 * calls `/generate-summary`, so it works with or without that frontend restart.
 */
/**
 * Render AI output as plain text.
 *
 * The summary is dropped into a simple <div>, so Markdown would show up as raw
 * `#`, `**`, `*` and `---` noise. Strips headings, bold/italic, code fences,
 * horizontal rules and bullet markers while keeping the wording, numbering and
 * line breaks intact. Applied after generation as a safety net — the prompt
 * already asks for plain text, but models do not always comply.
 */
function toPlainText(md) {
  if (!md) return '';
  let t = String(md);

  // Fenced code blocks: keep the inner text, drop the backtick fences.
  t = t.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');

  // Headings: "### Title" -> "Title"
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');

  // Bold / italic wrappers, outermost first: ***x*** -> **x** -> x
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/___(.+?)___/g, '$1');
  t = t.replace(/__(.+?)__/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/(^|[^_\w])_([^_\n]+)_(?=$|[^_\w])/gm, '$1$2');

  // Horizontal rules ("---", "***") -> blank line
  t = t.replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, '');

  // Bullet markers "* text" / "- text" / "+ text" -> "text" (numbered kept)
  t = t.replace(/^(\s*)[-*+]\s+/gm, '$1');

  // Inline code and links
  t = t.replace(/`([^`\n]+)`/g, '$1');
  t = t.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1');

  // Collapse runs of blank lines
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

function parseJson(v) {
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

/** Keep only meaningful Weekly Summary Form fields in the AI prompt. */
function compactWeeklySummary(raw) {
  const s = parseJson(raw);
  if (!s || typeof s !== 'object') return null;
  const out = {};
  const put = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    out[key] = value;
  };
  put('weekStatus', s.weekStatus);
  put('overallComment', s.overallComment);
  put('meetings', (Array.isArray(s.meetings) ? s.meetings : []).map((m) => ({
    title: m.title, date: m.date, type: m.type, attendees: m.attendees, decisions: m.decisions
  })));
  put('problems', (Array.isArray(s.problems) ? s.problems : []).map((p) => ({
    title: p.title, category: p.category, severity: p.severity, description: p.description, state: p.state
  })));
  put('challenges', (Array.isArray(s.challenges) ? s.challenges : []).map((c) => ({
    challenge: c.challenge, impact: c.impact
  })));
  put('needs', (Array.isArray(s.needs) ? s.needs : []).map((n) => ({
    what: n.what, from: n.from, by: n.by
  })));
  put('ideas', (Array.isArray(s.ideas) ? s.ideas : []).map((i) => ({
    suggestion: i.suggestion, area: i.area, benefit: i.benefit
  })));
  put('achievements', s.achievements);
  put('priorities', Array.isArray(s.priorities) ? s.priorities.filter(Boolean) : s.priorities);
  return Object.keys(out).length ? out : null;
}

function adaptTeamSummary(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    reportCodes: parseJson(row.report_codes) || [],
    reportSnapshot: parseJson(row.report_snapshot) || [],
    reportCount: Number(row.report_count) || 0,
    summaryText: row.summary_text,
    model: row.model || null,
    createdAt: row.created_at
  };
}

async function handleGenerateSummary(req, res) {
  const client = await genaiClient();
  if (!client) throw new ApiError(501, 'AI is not configured (missing GEMINI_API_KEY).');

  const {
    staffName = '',
    position = '',
    department = '',
    period = '',
    checklistItems = [],
    trsTasks = [],
    notes = ''
  } = req.body || {};

  const prompt = `
You are an executive HR and Operations AI Assistant evaluating a weekly/monthly staff report.

Staff Details:
- Name: ${staffName}
- Position: ${position}
- Department: ${department}
- Reporting Period: ${period}

T&R (JD Checklist Items Submitted):
${JSON.stringify(Array.isArray(checklistItems) ? checklistItems : [], null, 2)}

TRS (Superior Requested Extra Tasks):
${JSON.stringify(Array.isArray(trsTasks) ? trsTasks : [], null, 2)}

Staff Additional Notes:
"${notes || 'None provided'}"

Provide a plain-text analysis with these three sections:
1. Executive Weekly Summary (2-3 key accomplishments)
2. Performance Score Assessment & Timeliness
3. Outstanding Strengths & Areas of Support / Action Items for Manager

OUTPUT RULES — plain text only:
- Do NOT use Markdown. No # headings, no ** bold, no * bullets, no --- rules, no backticks.
- Use plain lines and the numbered section headings exactly as above.
- Keep each bullet on its own line, starting with the section number or a simple dash.
- Encouraging, concise, professional, and actionable.
Base it strictly on the content above — never invent achievements, numbers or deliverables that are not listed.
`.slice(0, 12000);

  try {
    const result = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt
    });
    await logActivity(req.user, {
      action: 'AI_SUMMARY_GENERATED',
      details: `Generated AI weekly summary for ${period || 'this period'} (${staffName || 'n/a'})`,
      req
    }).catch(() => {});
    ok(res, { summary: toPlainText(result.text) });
  } catch (err) {
    throw new ApiError(502, `AI generation failed: ${err.message}`);
  }
}

router.post('/generate-summary', requireUser, asyncHandler(handleGenerateSummary));
router.post('/summarize-report', requireUser, asyncHandler(handleGenerateSummary));

/**
 * POST /api/ai/team-summaries
 *
 * Consolidate one or more subordinate T&R reports into a single saved AI
 * summary. Each call inserts a new immutable `tr_team_summaries` row so the
 * SPA can render it as chat-style history.
 */
router.post('/team-summaries', requireUser, asyncHandler(async (req, res) => {
  const client = await genaiClient();
  if (!client) throw new ApiError(501, 'AI is not configured (missing GEMINI_API_KEY).');

  const rawCodes = req.body?.reportCodes;
  if (!Array.isArray(rawCodes) || rawCodes.length === 0) {
    throw new ApiError(400, 'reportCodes is required.');
  }
  const codes = [...new Set(rawCodes.map((c) => String(c || '').trim()).filter(Boolean))];
  if (codes.length === 0) throw new ApiError(400, 'reportCodes is required.');
  if (codes.length > 20) throw new ApiError(400, 'Select no more than 20 reports at a time.');

  const placeholders = codes.map(() => '?').join(',');
  const rows = await query(`SELECT * FROM reports WHERE code IN (${placeholders})`, codes);
  if (rows.length === 0) throw new ApiError(404, 'No reports found.');

  const reportByCode = new Map(rows.map((r) => [r.code, r]));
  const missing = codes.filter((c) => !reportByCode.has(c));
  if (missing.length) throw new ApiError(404, `Report not found: ${missing.join(', ')}`);

  for (const report of rows) {
    if (!(await canAccessUser(req.user, report.staff_code))) {
      throw new ApiError(403, 'You do not have access to all selected reports.');
    }
  }

  const summaries = await query(
    `SELECT report_code, summary_data FROM tr_weekly_summaries WHERE report_code IN (${placeholders})`,
    codes
  );
  const summaryByCode = new Map(summaries.map((s) => [s.report_code, s.summary_data]));
  const ordered = codes.map((c) => reportByCode.get(c));

  const reportBlocks = ordered.map((r) => ({
    reportCode: r.code,
    staffName: r.staff_name,
    position: r.position,
    department: r.department,
    period: `Week ${r.week_number}, ${r.year}`,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    scores: {
      tr: Number(r.tr_score) || 0,
      completion: r.completion_score != null ? Number(r.completion_score) : null,
      timeliness: r.timeliness_score != null ? Number(r.timeliness_score) : null,
      quality: r.quality_score != null ? Number(r.quality_score) : null
    },
    checklist: (parseJson(r.checklist_items) || []).map((it) => ({
      title: it.title,
      category: it.category,
      status: it.status || (it.completed ? 'Done' : 'Incomplete'),
      note: it.note || undefined
    })),
    notes: r.notes || undefined,
    weeklySummary: compactWeeklySummary(summaryByCode.get(r.code))
  }));

  const prompt = `
You are an executive HR and Operations AI Assistant. Consolidate the following subordinate T&R reports into ONE professional team summary.

Selected Reports:
${JSON.stringify(reportBlocks, null, 2).slice(0, 16000)}

Provide a plain-text analysis with these numbered sections:
1. Team Overview
2. Key Accomplishments
3. Recurring Problems & Challenges
4. Requests / Support Needed
5. Individual Highlights
6. Recommended Manager Actions

OUTPUT RULES — plain text only:
- Do NOT use Markdown. No # headings, no ** bold, no * bullets, no --- rules, no backticks.
- Use the numbered section headings exactly as above.
- Keep each bullet on its own line, starting with the section number or a simple dash.
- Be concise, professional, and actionable.
- Base the summary strictly on the supplied reports. Never invent achievements, numbers, staff, or deliverables.
`.slice(0, 20000);

  let generated;
  try {
    const result = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt
    });
    generated = toPlainText(result.text);
  } catch (err) {
    throw new ApiError(502, `AI generation failed: ${err.message}`);
  }
  if (!generated) throw new ApiError(502, 'AI returned an empty summary.');

  const code = makeCode('teamsum');
  const title = `Team Summary — ${ordered.length} Report${ordered.length === 1 ? '' : 's'}`;
  const snapshot = ordered.map((r) => ({
    code: r.code,
    staffCode: r.staff_code,
    staffName: r.staff_name,
    position: r.position,
    department: r.department,
    weekNumber: Number(r.week_number),
    year: Number(r.year),
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    trScore: Number(r.tr_score) || 0
  }));

  await query(
    `INSERT INTO tr_team_summaries
       (code, generated_by, generated_by_name, title, report_codes, report_snapshot, report_count, summary_text, model)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [code, req.user.code, req.user.name || null, title, JSON.stringify(codes), JSON.stringify(snapshot), ordered.length, generated, env.GEMINI_MODEL || null]
  );

  const saved = await getOne('SELECT * FROM tr_team_summaries WHERE code = ?', [code]);
  await logActivity(req.user, {
    action: 'AI_TEAM_SUMMARY_GENERATED',
    details: `Generated team summary for ${ordered.length} report(s)`,
    req
  }).catch(() => {});
  ok(res, { summary: adaptTeamSummary(saved) });
}));

/** GET /api/ai/team-summaries — current user's saved summary history */
router.get('/team-summaries', requireUser, asyncHandler(async (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(100, Math.floor(requested)))
    : 20;
  const beforeIdRaw = Number(req.query.beforeId);
  const beforeId = Number.isFinite(beforeIdRaw) && beforeIdRaw > 0 ? Math.floor(beforeIdRaw) : null;
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const q = String(req.query.q || '').trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !dateRe.test(from)) throw new ApiError(400, 'Invalid from date.');
  if (to && !dateRe.test(to)) throw new ApiError(400, 'Invalid to date.');

  const baseWhere = ['generated_by = ?'];
  const baseArgs = [req.user.code];
  if (from) {
    baseWhere.push('created_at >= ?');
    baseArgs.push(`${from} 00:00:00`);
  }
  if (to) {
    baseWhere.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    baseArgs.push(`${to} 00:00:00`);
  }
  if (q) {
    const like = `%${q}%`;
    baseWhere.push('(summary_text LIKE ? OR title LIKE ? OR CAST(report_snapshot AS CHAR) LIKE ?)');
    baseArgs.push(like, like, like);
  }

  const pageWhere = [...baseWhere];
  const pageArgs = [...baseArgs];
  if (beforeId != null) {
    pageWhere.push('id < ?');
    pageArgs.push(beforeId);
  }

  const rows = await query(
    `SELECT * FROM tr_team_summaries
     WHERE ${pageWhere.join(' AND ')}
     ORDER BY id DESC
     LIMIT ${limit + 1}`,
    pageArgs
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const totalRow = await getOne(
    `SELECT COUNT(*) AS c FROM tr_team_summaries WHERE ${baseWhere.join(' AND ')}`,
    baseArgs
  );

  ok(res, {
    summaries: pageRows.map(adaptTeamSummary),
    total: Number(totalRow?.c) || 0,
    hasMore
  });
}));

/** DELETE /api/ai/team-summaries/:code — remove one of the caller's saved summaries */
router.delete('/team-summaries/:code', requireUser, asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!code) throw new ApiError(400, 'Summary code is required.');
  const row = await getOne(
    'SELECT code FROM tr_team_summaries WHERE code = ? AND generated_by = ?',
    [code, req.user.code]
  );
  if (!row) throw new ApiError(404, 'Summary not found.');
  await query(
    'DELETE FROM tr_team_summaries WHERE code = ? AND generated_by = ?',
    [code, req.user.code]
  );
  await logActivity(req.user, {
    action: 'AI_TEAM_SUMMARY_DELETED',
    details: `Deleted saved team summary ${code}`,
    req
  }).catch(() => {});
  ok(res, { deleted: true });
}));


/**
 * POST /api/ai/suggest-jd-checklist — generate a JD checklist template for a position.
 * Moved here from the frontend server so the Gemini key stays backend-only.
 */
router.post('/suggest-jd-checklist', requireUser, asyncHandler(async (req, res) => {
  const client = await genaiClient();
  if (!client) throw new ApiError(501, 'AI is not configured (missing GEMINI_API_KEY).');

  const { positionTitle = '', department = '' } = req.body || {};
  if (!positionTitle) throw new ApiError(400, 'positionTitle is required.');

  const prompt = `Generate 6 standard, high-impact weekly/monthly Job Description (JD) checklist tasks for the position of "${positionTitle}" in the "${department}" department.

Return ONLY a valid JSON array of objects with keys:
- "title": string (Actionable task title)
- "category": string ("Weekly" or "Monthly")
- "weight": number (Importance weight from 1 to 5)
- "description": string (Brief expectation description)

Do NOT include markdown block markers like \`\`\`json.`;

  try {
    const result = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt
    });
    let rawText = result.text || '[]';
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    let checklist;
    try {
      checklist = JSON.parse(rawText);
    } catch {
      throw new ApiError(502, 'AI returned an unreadable checklist template. Please try again.');
    }
    ok(res, { checklist });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, `AI generation failed: ${err.message}`);
  }
}));

export default router;
