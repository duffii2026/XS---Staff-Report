import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query } from '../config/db.js';
import { requireUser, requireRole } from '../middleware/auth.js';
import { createApiKey, deleteApiKey } from '../services/apiKey.js';
import { logActivity } from '../services/audit.js';

const router = Router();

/** GET /api/api-keys — list own keys (no raw values) */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, name, IFNULL(scopes, '["*"]') AS scopes, last_used_at, expires_at, is_active, created_at
     FROM api_keys WHERE user_code = ? ORDER BY created_at DESC`,
    [req.user.code]
  );
  ok(res, rows.map((r) => ({ ...r, scopes: JSON.parse(r.scopes) })));
}));

/** POST /api/api-keys — create (returns raw key ONCE) */
router.post('/', requireUser, requireRole(['admin', 'executive', 'hr']), asyncHandler(async (req, res) => {
  const { name = 'api-key', scopes = ['*'] } = req.body || {};
  const created = await createApiKey(req.user.code, String(name).slice(0, 128), scopes);
  await logActivity(req.user, { action: 'API_KEY_CREATE', details: `Created API key ${created.name}`, req });
  ok(res, { ...created }, 201);
}));

/** DELETE /api/api-keys/:id */
router.delete('/:id', requireUser, asyncHandler(async (req, res) => {
  await deleteApiKey(Number(req.params.id), req.user.code);
  await logActivity(req.user, { action: 'API_KEY_DELETE', details: `Deleted API key ${req.params.id}`, req });
  ok(res, { deleted: true });
}));

export default router;
