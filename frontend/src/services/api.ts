/**
 * Thin typed fetch client for the APA Staff Report API.
 * The vite dev server proxies /api -> http://localhost:5812.
 * Session cookies (httpOnly) are sent with credentials: 'include'.
 */

const BASE = '/api';

export interface ApiEnvelope<T> {
  success: boolean;
  status: number;
  message?: string;
  data: T;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const AUTH_EXEMPT_PATHS = ['/auth/login', '/auth/refresh', '/auth/session'];

function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT_PATHS.some((p) => path.includes(p));
}

// Single-flight silent refresh. Every 401 during the same expiry window shares
// one rotation request, so N concurrent calls never race each other's cookies.
let refreshPromise: Promise<boolean> | null = null;
let unauthorizedDispatched = false;

async function silentRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const p = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal
        });
        if (!res.ok) return false;
        const json = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
        return !!json?.success;
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    })();
    refreshPromise = p;
    p.finally(() => {
      if (refreshPromise === p) refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  opts?: { timeout?: number },
  retried = false
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = opts?.timeout ?? 20000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError(408, `Request timed out (${timeoutMs/1000}s): ${method} ${path}`);
    }
    throw new ApiError(0, `Network error: ${err?.message || 'request failed'}`);
  } finally {
    clearTimeout(timeout);
  }

  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // non-JSON body (rare)
  }

  if (!res.ok || !json?.success) {
    if (res.status === 401 && !isAuthExempt(path)) {
      // Try one silent rotation + retry. This absorbs the normal case where the
      // 1h access token expired and several requests arrive at once.
      if (!retried) {
        const refreshed = await silentRefresh();
        if (refreshed) {
          unauthorizedDispatched = false;
          return request<T>(method, path, body, opts, true);
        }
        // Rotation can lose a race to a sibling request whose Set-Cookie has
        // not reached this tab yet. Wait briefly, then retry the original
        // request; only a second 401 is treated as a real expiry.
        await new Promise((r) => setTimeout(r, 350));
        return request<T>(method, path, body, opts, true);
      }
      if (!unauthorizedDispatched) {
        unauthorizedDispatched = true;
        window.dispatchEvent(new CustomEvent('apa:unauthorized'));
      }
    }
    throw new ApiError(res.status, json?.message || `Request failed (${res.status})`, json?.data);
  }
  unauthorizedDispatched = false;
  return json.data;
}

export const api = {
  get: <T = unknown>(path: string, opts?: { timeout?: number }) => request<T>('GET', path, undefined, opts),
  post: <T = unknown>(path: string, body?: unknown, opts?: { timeout?: number }) => request<T>('POST', path, body, opts),
  put: <T = unknown>(path: string, body?: unknown, opts?: { timeout?: number }) => request<T>('PUT', path, body, opts),
  del: <T = unknown>(path: string, opts?: { timeout?: number }) => request<T>('DELETE', path, undefined, opts),
  login,
  logout,
  getSession,
  refreshSession,
  uploadSignatureImage,
  resolveSignature
};

// ----------------------------- Auth -----------------------------

export interface SessionUser {
  code: string;
  username: string;
  name: string;
  email: string;
  role: string;
  department: string;
  position: string;
  superior_id?: string | null;
  avatar_url?: string | null;
  must_change_password?: boolean;
  permissions?: Record<string, boolean>;
}

export interface SessionPayload {
  user: SessionUser;
  permissions: Record<string, boolean>;
  sessionExpiresAt?: string;
  refreshed?: boolean;
}

export async function login(username: string, password: string): Promise<SessionPayload> {
  return api.post<SessionPayload>('/auth/login', { username, password });
}

export function logout(): Promise<{ revoked: boolean }> {
  return api.post<{ revoked: boolean }>('/auth/logout');
}

export function getSession(): Promise<SessionPayload> {
  return api.get<SessionPayload>('/auth/session');
}

export function refreshSession(): Promise<SessionPayload> {
  return api.post<SessionPayload>('/auth/refresh');
}

// S3 image-dataUrl uploader
export async function uploadSignatureImage(input: {
  dataUrl: string;
  type?: string;
  signeeName?: string;
  signedAt?: string;
}): Promise<{ signature: { s3Key: string | null; dataUrl: string; signedAt?: string; signeeName?: string; type?: string }; displayUrl: string }> {
  return api.post('/signatures/upload', input);
}

// Upload a proof file (PDF/image/document/zip) to S3; returns the stored key + public URL.
// 30 MB files take a while to parse + push to S3, so this uses a long timeout
// instead of the 20s default (which aborted large uploads mid-flight).
export async function uploadProofFile(input: {
  name: string;
  dataUrl: string;
}): Promise<{ key: string; url: string; name: string; size: number }> {
  return uploadProofFileWithProgress(input);
}

export interface FileUploadProgress {
  loaded: number;
  total: number;
  percent: number; // 0-100 for THIS file
}

/**
 * Same as uploadProofFile but reports real byte-level upload progress.
 * Uses XHR because `fetch` has no upload-progress event — this is what makes
 * an accurate "% uploading" indicator possible instead of a fake animation.
 */
export function uploadProofFileWithProgress(
  input: { name: string; dataUrl: string },
  onProgress?: (p: FileUploadProgress) => void
): Promise<{ key: string; url: string; name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/files/upload`);
    xhr.withCredentials = true;
    xhr.timeout = 10 * 60 * 1000; // matches the fetch timeout above
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      const total = e.total || 0;
      const percent = e.lengthComputable && total > 0 ? Math.round((e.loaded / total) * 100) : 0;
      onProgress({ loaded: e.loaded, total, percent: Math.min(100, percent) });
    };

    xhr.onload = () => {
      let json: ApiEnvelope<{ key: string; url: string; name: string; size: number }> | null = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON body
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.success) {
        onProgress?.({ loaded: 1, total: 1, percent: 100 });
        resolve(json.data);
      } else {
        reject(
          new ApiError(
            xhr.status,
            json?.message || `Request failed (${xhr.status})`,
            json?.data
          )
        );
      }
    };

    xhr.onerror = () => reject(new ApiError(0, 'Network error: upload failed'));
    xhr.ontimeout = () =>
      reject(new ApiError(408, 'Request timed out (600s): POST /files/upload'));

    xhr.send(JSON.stringify(input));
  });
}

// File manager: all submitted proof files within scope (admin sees all, others see self + subordinates)
export async function getSubmittedFiles(): Promise<import('../types').SubmittedFile[]> {
  return api.get<import('../types').SubmittedFile[]>('/files');
}

// File manager: delete one proof file from the report / task it belongs to.
export async function deleteSubmittedFile(input: {
  source: 'TR' | 'TRS';
  sourceCode: string;
  url: string;
}): Promise<{ deleted: boolean }> {
  const params = new URLSearchParams({
    source: input.source,
    sourceCode: input.sourceCode,
    url: input.url
  });
  return api.del<{ deleted: boolean }>(`/files?${params.toString()}`);
}

// If a signature dataUrl is an embeddable image (not an S3/text stamp), upload it
// and return the S3-backed signature object. Pass-through otherwise.
export async function resolveSignature(sig?: {
  dataUrl?: string;
  s3Key?: string | null;
  type?: string;
  signeeName?: string;
  signedAt?: string;
} | null): Promise<{ dataUrl?: string; s3Key?: string | null; type?: string; signeeName?: string; signedAt?: string } | undefined> {
  if (!sig || !sig.dataUrl) return sig ?? undefined;
  if (sig.s3Key) return sig;
  if (!/^data:image\//i.test(sig.dataUrl)) return sig; // text stamp
  try {
    const uploaded = await uploadSignatureImage({
      dataUrl: sig.dataUrl,
      type: sig.type,
      signeeName: sig.signeeName,
      signedAt: sig.signedAt
    });
    return uploaded.signature;
  } catch (err) {
    console.error('Signature upload failed:', err);
    return sig;
  }
}
