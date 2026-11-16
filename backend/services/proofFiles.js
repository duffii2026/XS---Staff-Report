import { cleanPrefix, deleteObject } from './s3.js';
import { env } from '../config/env.js';

/**
 * Shared proof-file helpers.
 *
 * A single source of truth for reading a `multi_proof` blob and turning its
 * entries into S3 object keys — used by the file manager, and by every delete
 * path so that removing a T&R report / TRS task also removes its files from S3.
 */

/** Safe JSON parse (returns null on absent / malformed data). */
export function parseJson(v) {
  if (!v) return null;
  try {
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}

/** Collect uploaded proof entries (not cloud/telegram links) from a multiProof blob. */
export function proofFiles(multiProof) {
  const mp = parseJson(multiProof);
  if (!mp || !Array.isArray(mp.files)) return [];
  return mp.files.filter((f) => f && f.url);
}

/**
 * S3 object key backing a proof file. Returns null for external links
 * (cloud / Telegram) so those are never sent to S3 for deletion.
 */
export function s3KeyFor(file) {
  if (!file) return null;
  if (file.s3Key) return file.s3Key;
  const url = String(file.url || '');
  if (!url.startsWith('/reportupload/')) return null;
  const prefix = cleanPrefix(env.AWS_S3_PREFIX);
  const name = url.slice('/reportupload/'.length);
  return prefix ? `${prefix}/${name}` : name;
}

/** Derive the S3 key from a bare proof URL (legacy single-proof columns). */
export function s3KeyFromUrl(url) {
  if (!url) return null;
  return s3KeyFor({ url });
}

/**
 * Delete every S3 object behind the supplied multiProof blobs and legacy proof
 * URLs. Best-effort and never throws: the DB row is already gone by the time
 * this runs, so a missing object or a transient S3 error must not abort the
 * caller's delete. Returns the keys that were submitted for deletion.
 */
export async function deleteProofFilesFromS3(multiProofBlobs = [], legacyUrls = []) {
  const keys = new Set();

  for (const blob of multiProofBlobs) {
    for (const f of proofFiles(blob)) {
      const key = s3KeyFor(f);
      if (key) keys.add(key);
    }
  }
  for (const url of legacyUrls) {
    const key = s3KeyFromUrl(url);
    if (key) keys.add(key);
  }

  const attempted = [];
  for (const key of keys) {
    // deleteObject() already no-ops on external URLs and swallows S3 errors,
    // logging them — so this loop can never reject.
    await deleteObject(key);
    attempted.push(key);
  }
  return attempted;
}
