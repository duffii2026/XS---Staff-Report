import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { query, getOne } from '../config/db.js';
import { requireUser } from '../middleware/auth.js';
import { uploadSignatureDataUrl, deleteObject, toPublicUrl } from '../services/s3.js';
import { logActivity } from '../services/audit.js';
import { toMySqlDatetime } from '../services/auth.js';

const router = Router();

/** GET /api/signatures — saved personal signatures (presigned display urls) */
router.get('/', requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, sig_type, s3_key, signee_name, signed_at, created_at
     FROM saved_signatures WHERE user_code = ? ORDER BY signed_at DESC`,
    [req.user.code]
  );
  const out = [];
  for (const r of rows) {
    out.push({ ...r, displayUrl: toPublicUrl(r.s3_key) });
  }
  ok(res, out);
}));

/** POST /api/signatures/upload — upload an image dataUrl to S3, returns S3 ref */
router.post('/upload', requireUser, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.dataUrl || typeof b.dataUrl !== 'string') throw new ApiError(400, 'dataUrl is required.');

  const uploaded = await uploadSignatureDataUrl(req.user.code, {
    dataUrl: b.dataUrl,
    type: b.type || 'handwritten',
    signeeName: b.signeeName || req.user.name,
    signedAt: b.signedAt || new Date().toISOString()
  });
  ok(res, {
    signature: uploaded,
    displayUrl: uploaded.s3Key ? toPublicUrl(uploaded.s3Key) : uploaded.dataUrl
  }, 201);
}));

/** POST /api/signatures — save reusable signature (upload to S3) */
router.post('/', requireUser, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.signature?.dataUrl) throw new ApiError(400, 'signature.dataUrl is required.');

  const uploaded = await uploadSignatureDataUrl(req.user.code, b.signature);
  if (!uploaded.s3Key) throw new ApiError(400, 'Only image signatures can be saved (data:image/...).');

  await query(
    `INSERT INTO saved_signatures (user_code, sig_type, s3_key, signee_name, signed_at)
     VALUES (?, ?, ?, ?, ?)`,
    [req.user.code, b.signature.type === 'digital_type' ? 'digital_type' : (b.signature.type === 'uploaded' ? 'uploaded' : 'handwritten'),
     uploaded.s3Key, b.signature.signeeName || req.user.name,
     toMySqlDatetime(uploaded.signedAt ? new Date(uploaded.signedAt) : new Date())]
  );
  await logActivity(req.user, { action: 'SIGNATURE_SAVE', details: `Saved signature ${uploaded.s3Key}`, req });
  ok(res, { s3Key: uploaded.s3Key, displayUrl: toPublicUrl(uploaded.s3Key) }, 201);
}));

/** DELETE /api/signatures/:id */
router.delete('/:id', requireUser, asyncHandler(async (req, res) => {
  const row = await getOne('SELECT * FROM saved_signatures WHERE id = ? AND user_code = ?', [req.params.id, req.user.code]);
  if (!row) throw new ApiError(404, 'Signature not found.');
  await query('DELETE FROM saved_signatures WHERE id = ?', [req.params.id]);
  await deleteObject(row.s3_key);
  await logActivity(req.user, { action: 'SIGNATURE_DELETE', details: `Deleted signature ${row.s3_key}`, req });
  ok(res, { deleted: true });
}));

export default router;
