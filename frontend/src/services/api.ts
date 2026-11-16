/**
 * Thin typed fetch client for the APA Staff Report API.
 * The vite dev server proxies /api -> http://localhost:5811.
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

async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
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
      throw new ApiError(408, `Request timed out (20s): ${method} ${path}`);
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
    if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/refresh')) {
      window.dispatchEvent(new CustomEvent('apa:unauthorized'));
    }
    throw new ApiError(res.status, json?.message || `Request failed (${res.status})`, json?.data);
  }
  return json.data;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
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
export async function uploadProofFile(input: {
  name: string;
  dataUrl: string;
}): Promise<{ key: string; url: string; name: string; size: number }> {
  return api.post('/files/upload', input);
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