import {
  S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { nanoid } from 'nanoid';
import fs from 'fs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/http.js';

/**
 * Credentials for this instance.
 * - If no AWS_SHARED_CREDENTIALS_FILE is configured, use the default provider chain
 *   (~/.aws/credentials → env vars → IAM role).
 * - APP2: its own credentials file + profile (AWS_SHARED_CREDENTIALS_FILE / AWS_PROFILE).
 *   If that file is missing on the machine (Windows path on a Linux server, etc.),
 *   the override is dropped here too and the default chain is used instead of throwing.
 */
export function resolveS3Credentials() {
  const filepath = env.AWS_SHARED_CREDENTIALS_FILE;
  if (!filepath) return undefined;
  if (!fs.existsSync(filepath)) {
    console.warn(`[S3] credentials file not found (${filepath}); using default AWS credential chain`);
    return undefined;
  }
  return fromIni({ filepath, profile: env.AWS_PROFILE || undefined });
}

let _client = null;
export function getS3() {
  if (!_client) {
    const credentials = resolveS3Credentials();
    _client = new S3Client({
      region: env.AWS_REGION,
      ...(credentials ? { credentials } : {}),
      // Large proof files (up to 30 MB) must not be cut off mid-upload:
      // a 10-minute request window instead of the SDK default, plus
      // automatic retries so a transient S3 hiccup surfaces as a retry,
      // not a 500 to the browser.
      requestHandler: new NodeHttpHandler({
        requestTimeout: 10 * 60 * 1000,
        connectionTimeout: 30 * 1000
      }),
      maxAttempts: 4
    });
  }
  return _client;
}

export function cleanPrefix(p) {
  return (p || '').replace(/^\/+|\/+$/g, '');
}

/** Signature objects live flat under the configured prefix (e.g. reportupload/signature_xxx.png). */
export function signaturesPrefix() {
  return cleanPrefix(env.AWS_S3_PREFIX);
}

/**
 * Build a flat S3 object key, e.g. reportupload/signature_Nee8LaywACvR.png
 * (no userCode / signatures nesting layers).
 */
export function buildKey(userCode, ext = '.png', kind = 'signature', id = nanoid(12)) {
  void userCode;
  return `${signaturesPrefix()}/${kind}_${id}${ext}`;
}

/**
 * Public URL for a stored signature object, served by the app itself
 * (frontend /reportupload => backend routing), e.g.
 * /reportupload/signature_Nee8LaywACvR.png
 *
 * Returned relative so it resolves against whatever origin serves the app
 * (staff.apa1-eva.com, staff.apa2-eva.com, local dev, etc.).
 */
export function toPublicUrl(key) {
  if (!key) return key;
  if (/^https?:\/\//.test(key)) return key; // already external
  // Strip the configured prefix so leftovers never leak into the URL path.
  const name = key.split('/').slice(1).join('/') || key;
  return `/reportupload/${name}`;
}

export async function presignGet(key, expiresIn = env.AWS_S3_SIGN_EXPIRY_S) {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key; // already external
  try {
    const cmd = new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key });
    return await getSignedUrl(getS3(), cmd, { expiresIn });
  } catch (err) {
    console.error('[S3 presign]', err.message);
    return null;
  }
}

/**
 * S3 object metadata travels as HTTP headers, so a value must be printable
 * ASCII and free of CR/LF/control characters — otherwise the whole upload dies
 * with `Invalid character in header content ["x-amz-meta-filename"]`.
 * Real-world filenames are not: "รายงาน.pdf" (Khmer), CJK, emoji, or a stray
 * newline are all valid on disk but illegal in a header.
 *
 * Printable-ASCII names are passed through untouched so ordinary filenames stay
 * readable; anything else is percent-encoded, which is 100% ASCII and losslessly
 * reversible. (Metadata is informational here — the true filename is stored in
 * the DB / returned to the client.)
 */
function headerSafeMeta(value) {
  const s = String(value);
  return /^[\x20-\x7E]*$/.test(s) ? s : encodeURIComponent(s);
}

export async function uploadBuffer(key, buffer, contentType, metadata = {}) {
  try {
    const cmd = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: Object.fromEntries(
        Object.entries(metadata)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, headerSafeMeta(v)])
      )
    });
    await getS3().send(cmd);
    return key;
  } catch (err) {
    console.error('[S3 upload]', err.message);
    throw new ApiError(500, `Upload to S3 failed: ${err.message}`);
  }
}

/** Multi-proof file key, e.g. reportupload/proof_Nee8LaywACvR.pdf */
export function proofUploadPath(userCode, ext = '.pdf', id = nanoid(12)) {
  void userCode;
  return `${signaturesPrefix()}/proof_${id}${ext.startsWith('.') ? ext : `.${ext}`}`;
}

/** Upload a proof file buffer (PDF/image/doc/zip) to S3 and return its key + public URL. */
export async function uploadProofFile(userCode, { name, mime, buffer, ext }) {
  const key = proofUploadPath(userCode, ext);
  await uploadBuffer(key, buffer, mime, {
    uploader: userCode,
    kind: 'proof',
    filename: name || key.split('/').pop() || 'file'
  });
  return { key, url: toPublicUrl(key) };
}

export async function deleteObject(key) {
  if (!key || /^https?:\/\//.test(key)) return;
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }));
  } catch (err) {
    console.error('[S3 delete]', err.message);
  }
}

/**
 * Upload a base64 signature from the SignatureCanvas.
 * If it is a real image (data:image/...), upload the PNG to S3 and return
 * { s3Key, dataUrl(branded public url) }. If it is a text stamp (digital_type /
 * verified text), return unchanged (stored as text).
 */
export async function uploadSignatureDataUrl(userCode, signature) {
  if (!signature) return null;
  const { dataUrl, type, signeeName, signedAt } = signature;

  if (!dataUrl || typeof dataUrl !== 'string') return signature;

  // Text stamps pass through untouched (no binary to store)
  if (!/^data:image\//i.test(dataUrl)) {
    return { type: type || 'digital_type', dataUrl, s3Key: null, signedAt, signeeName };
  }

  const mimeMatch = dataUrl.match(/^data:(image\/(png|jpeg|webp));base64,[\s\S]*$/i);
  if (!mimeMatch) {
    throw new ApiError(400, 'Unsupported signature image format. Use PNG/JPEG/WebP.');
  }
  const mime = mimeMatch[1].toLowerCase();
  const ext = mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : '.webp';
  const base64 = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');

  const key = buildKey(userCode, ext);
  await uploadBuffer(key, buffer, mime, {
    signeeName: signeeName || userCode,
    userCode,
    signedAt: signedAt || new Date().toISOString(),
    kind: 'signature'
  });

  return {
    type,
    s3Key: key,
    dataUrl: toPublicUrl(key),
    signedAt,
    signeeName
  };
}

/**
 * Make a stored signature display-ready.
 * Uses the stable public URL (streamed through the app's /reportupload route) instead of
 * a short-lived presigned URL, so signature images never expire on saved/detail pages.
 */
export async function prepareSignature(signature) {
  if (!signature) return null;
  if (signature.s3Key) {
    return { ...signature, dataUrl: toPublicUrl(signature.s3Key) };
  }
  return signature;
}

export async function verifyBucket() {
  try {
    await getS3().send(new HeadBucketCommand({ Bucket: env.AWS_S3_BUCKET }));
    return { ok: true, region: env.AWS_REGION, bucket: env.AWS_S3_BUCKET };
  } catch (err) {
    return { ok: false, region: env.AWS_REGION, bucket: env.AWS_S3_BUCKET, error: err.message };
  }
}
