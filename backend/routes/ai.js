import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { getOne } from '../config/db.js';
import { requireUser } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { getSubordinateCodes } from '../services/scoping.js';

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
      model: 'gemini-2.0-flash',
      contents: prompt
    });
    ok(res, { output: result.text || '' });
  } catch (err) {
    throw new ApiError(502, `AI generation failed: ${err.message}`);
  }
}));

export default router;
