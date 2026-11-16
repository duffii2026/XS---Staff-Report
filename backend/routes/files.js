import { Router } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3, cleanPrefix, uploadProofFile } from '../services/s3.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { requireUser } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';

const router = Router();          // public streaming (GET /reportupload/*)
const uploadsRouter = Router();   // authenticated uploads (POST /api/files/upload)

const STREAM_EXT_RE = /\.(png|jpe?g|webp|gif|pdf|docx?|xlsx?|pptx?|zip|txt)$/i;

const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'txt'];
const MIME_BY_EXT = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  txt: 'text/plain'
};
const MAX_PROOF_BYTES = 15 * 1024 * 1024; // 15 MB

/** GET /reportupload/:name — stream an S3 object (flat key reportupload/<file>) */
router.get('/reportupload/:name', asyncHandler(async (req, res) => {
  const name = req.params.name;
  if (!STREAM_EXT_RE.test(name)) throw new ApiError(400, 'Invalid file name.');

  const key = `${cleanPrefix(env.AWS_S3_PREFIX)}/${name}`;
  try {
    const data = await getS3().send(new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }));
    const extMatch = /\.([^.]+)$/.exec(name);
    const ct = data.ContentType
      || (extMatch ? MIME_BY_EXT[extMatch[1].toLowerCase()] : undefined)
      || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (/\.pdf$/i.test(name)) res.setHeader('Content-Disposition', 'inline; filename="' + name + '"');
    data.Body.pipe(res);
  } catch (err) {
    throw new ApiError(404, 'File not found.');
  }
}));

/**
 * POST /api/files/upload — save a proof file (PDF/image/document/zip) to S3
 * and return { key, url } so the DB stores only the S3 reference.
 */
uploadsRouter.post('/upload', requireUser, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const dataUrl = b.dataUrl;
  if (!name) throw new ApiError(400, 'File name is required.');
  if (!dataUrl || typeof dataUrl !== 'string') throw new ApiError(400, 'File payload (dataUrl) is required.');

  const extMatch = name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError(400, `Unsupported file type "${ext || 'unknown'}". Allowed: ${ALLOWED_EXT.join(', ')}.`);
  }

  const payload = dataUrl.match(/^data:([a-zA-Z0-9.+-/]+);base64,([\s\S]+)$/i);
  if (!payload) throw new ApiError(400, 'Invalid file payload.');
  const mime = payload[1].toLowerCase();
  const buffer = Buffer.from(payload[2], 'base64');
  if (buffer.length === 0) throw new ApiError(400, 'Empty file.');
  if (buffer.length > MAX_PROOF_BYTES) {
    throw new ApiError(413, `File exceeds the ${Math.round(MAX_PROOF_BYTES / 1024 / 1024)} MB upload limit.`);
  }

  const s3Mime = (mime.startsWith('image/') || mime === 'application/pdf')
    ? mime
    : (MIME_BY_EXT[ext] || 'application/octet-stream');

  const { key, url } = await uploadProofFile(req.user.code, { name, mime: s3Mime, buffer, ext: `.${ext}` });
  await logActivity(req.user, { action: 'PROOF_UPLOAD', details: `Uploaded proof file ${name} -> ${key}`, req });
  ok(res, { key, url, name, size: buffer.length }, 201);
}));

export default router;
export { uploadsRouter };
