import { Router } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3, cleanPrefix, uploadProofFile, deleteObject } from '../services/s3.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { requireUser, requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/audit.js';
import { query, getOne } from '../config/db.js';
import { getSubordinateCodes } from '../services/scoping.js';
import { parseJson, proofFiles, s3KeyFor } from '../services/proofFiles.js';

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
const MAX_PROOF_BYTES = 30 * 1024 * 1024; // 30 MB

function safeSize(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fileNameFromUrl(url) {
  try {
    const name = String(url).split('/').pop() || 'file';
    return decodeURIComponent(name);
  } catch {
    return String(url).split('/').pop() || 'file';
  }
}

/**
 * GET /api/files — file manager: every proof file attached to a submitted
 * T&R report or TRS task. Admin sees all; every other role sees only files
 * owned by themselves or one of their direct/indirect subordinates.
 */
uploadsRouter.get('/', requireUser, asyncHandler(async (req, res) => {
  const actor = req.user;
  let scopeCodes = null;
  if (actor.role !== 'admin') {
    const subs = await getSubordinateCodes(actor.code);
    scopeCodes = [actor.code, ...subs];
  }

  const out = [];

  // T&R weekly report attachments (owned by the report's staff member).
  {
    const args = [];
    let where = 'multi_proof IS NOT NULL';
    if (scopeCodes) {
      where += ` AND staff_code IN (${scopeCodes.map(() => '?').join(',')})`;
      args.push(...scopeCodes);
    }
    const rows = await query(
      `SELECT id, code, staff_code, staff_name, department, year, week_number, status, multi_proof
       FROM reports WHERE ${where}`,
      args
    );
    for (const r of rows) {
      proofFiles(r.multi_proof).forEach((f, i) => {
        out.push({
          id: `tr_${r.code}_${f.id || i}`,
          source: 'TR',
          sourceCode: r.code,
          sourceId: r.id,
          sourceLabel: `Week ${r.week_number}, ${r.year}`,
          weekNumber: Number(r.week_number),
          year: Number(r.year),
          ownerCode: r.staff_code,
          ownerName: r.staff_name,
          department: r.department,
          name: f.name || fileNameFromUrl(f.url),
          url: f.url,
          s3Key: f.s3Key || null,
          size: safeSize(f.size),
          uploadedAt: f.uploadedAt || null,
          status: r.status
        });
      });
    }
  }

  // TRS task attachments (owned by the assignee who submitted the task).
  {
    const args = [];
    let where = '(multi_proof IS NOT NULL OR proof_url IS NOT NULL)';
    if (scopeCodes) {
      where += ` AND assigned_to IN (${scopeCodes.map(() => '?').join(',')})`;
      args.push(...scopeCodes);
    }
    const rows = await query(
      `SELECT id, code, task_code, title, assigned_to, assigned_to_name, department,
              status, submitted_at, multi_proof, proof_url
       FROM trs_tasks WHERE ${where}`,
      args
    );
    for (const r of rows) {
      const seenUrls = new Set();
      proofFiles(r.multi_proof).forEach((f, i) => {
        seenUrls.add(f.url);
        out.push({
          id: `trs_${r.code}_${f.id || i}`,
          source: 'TRS',
          sourceCode: r.code,
          sourceId: r.id,
          sourceLabel: r.title || r.task_code || r.code,
          ownerCode: r.assigned_to,
          ownerName: r.assigned_to_name,
          department: r.department,
          name: f.name || fileNameFromUrl(f.url),
          url: f.url,
          s3Key: f.s3Key || null,
          size: safeSize(f.size),
          uploadedAt: f.uploadedAt || r.submitted_at || null,
          status: r.status
        });
      });
      if (r.proof_url && !seenUrls.has(r.proof_url)) {
        out.push({
          id: `trs_${r.code}_legacy`,
          source: 'TRS',
          sourceCode: r.code,
          sourceId: r.id,
          sourceLabel: r.title || r.task_code || r.code,
          ownerCode: r.assigned_to,
          ownerName: r.assigned_to_name,
          department: r.department,
          name: fileNameFromUrl(r.proof_url),
          url: r.proof_url,
          s3Key: null,
          size: null,
          uploadedAt: r.submitted_at || null,
          status: r.status
        });
      }
    }
  }

  out.sort((a, b) => {
    const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
    const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
    return tb - ta;
  });

  ok(res, out);
}));

/**
 * DELETE /api/files?source=TR|TRS&sourceCode=<code>&url=<file url>
 * Delete one proof file: it is removed from the source T&R report / TRS task
 * and its S3 object is deleted.
 *
 * Restricted to administrators only — every other role may view files but
 * never delete them.
 */
uploadsRouter.delete('/', requireUser, requireRole(['admin']), asyncHandler(async (req, res) => {
  const source = String(req.query.source || '').trim().toUpperCase();
  const sourceCode = String(req.query.sourceCode || '').trim();
  const url = String(req.query.url || '').trim();
  if (!source || !sourceCode || !url) {
    throw new ApiError(400, 'source, sourceCode and url are required.');
  }
  if (!['TR', 'TRS'].includes(source)) throw new ApiError(400, 'Invalid source.');

  const actor = req.user;

  if (source === 'TR') {
    const row = await getOne(
      'SELECT id, code, staff_code, staff_name, multi_proof, status FROM reports WHERE code = ?',
      [sourceCode]
    );
    if (!row) throw new ApiError(404, 'Report not found.');
    if (row.status === 'Approved') {
      throw new ApiError(400, 'Files on an approved report cannot be deleted.');
    }

    const mp = parseJson(row.multi_proof);
    const files = mp && Array.isArray(mp.files) ? mp.files : [];
    const target = files.find((f) => f && f.url === url);
    if (!target) throw new ApiError(404, 'File not found on this report.');

    const next = { ...mp, files: files.filter((f) => !(f && f.url === url)) };
    await query('UPDATE reports SET multi_proof = ? WHERE code = ?', [JSON.stringify(next), row.code]);
    await deleteObject(s3KeyFor(target));
    await logActivity(actor, {
      action: 'PROOF_DELETE',
      details: `Deleted proof file "${target.name || url}" from report ${row.code} (${row.staff_name})`,
      req
    });
    ok(res, { deleted: true, source: 'TR', sourceCode: row.code });
    return;
  }

  // TRS task attachment.
  const row = await getOne(
    `SELECT id, code, title, assigned_to, assigned_to_name, multi_proof, proof_url, evaluation_status
     FROM trs_tasks WHERE code = ?`,
    [sourceCode]
  );
  if (!row) throw new ApiError(404, 'Task not found.');
  if (row.evaluation_status === 'Approved') {
    throw new ApiError(400, 'Files on an approved task cannot be deleted.');
  }

  const mp = parseJson(row.multi_proof);
  const files = mp && Array.isArray(mp.files) ? mp.files : [];
  const target = files.find((f) => f && f.url === url);

  if (target) {
    const next = { ...mp, files: files.filter((f) => !(f && f.url === url)) };
    await query('UPDATE trs_tasks SET multi_proof = ? WHERE code = ?', [JSON.stringify(next), row.code]);
    await deleteObject(s3KeyFor(target));
    await logActivity(actor, {
      action: 'PROOF_DELETE',
      details: `Deleted proof file "${target.name || url}" from task ${row.code} (${row.title || ''})`,
      req
    });
    ok(res, { deleted: true, source: 'TRS', sourceCode: row.code });
    return;
  }

  // Legacy single-proof attachment (trs_tasks.proof_url).
  if (row.proof_url && row.proof_url === url) {
    await query('UPDATE trs_tasks SET proof_url = NULL WHERE code = ?', [row.code]);
    await deleteObject(s3KeyFor({ url }));
    await logActivity(actor, {
      action: 'PROOF_DELETE',
      details: `Deleted proof file "${fileNameFromUrl(url)}" from task ${row.code} (${row.title || ''})`,
      req
    });
    ok(res, { deleted: true, source: 'TRS', sourceCode: row.code });
    return;
  }

  throw new ApiError(404, 'File not found on this task.');
}));

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
