import type { ApiEnvelope, AuthenticatedUser, TokenGrant } from '@pulse/contracts';

/**
 * Envelope-aware API client for the portal.
 *
 * Token model: the access token lives ONLY in memory (module scope) — never
 * localStorage, so XSS can't exfiltrate a persisted credential. The refresh
 * token lives in an httpOnly cookie the browser attaches to /api/v1/auth/*.
 * On a 401 we attempt one silent refresh, then replay the request.
 */

// || (not ??): an unset repo Variable reaches the build as '' — fall through.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let accessToken: string | null = null;
let currentUser: AuthenticatedUser | null = null;

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  return (await response.json()) as ApiEnvelope<T>;
}

/**
 * Single-flight refresh: refresh tokens are single-use (rotation + reuse
 * detection), so two concurrent refreshes would consume the same cookie and
 * the second would be treated as theft, revoking the session family. Every
 * caller joins the one in-flight attempt instead.
 */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const envelope = await rawRequest<TokenGrant>('/v1/auth/refresh', { method: 'POST' });
      if (envelope.success) {
        accessToken = envelope.data.accessToken;
        currentUser = envelope.data.user;
        return true;
      }
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Core request: unwraps the envelope, silently refreshing once on 401. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // A hard navigation may still be restoring the session — join it rather
  // than sending an unauthenticated request that triggers a second refresh.
  if (!accessToken && refreshInFlight) await refreshInFlight;

  let envelope = await rawRequest<T>(path, init);

  if (!envelope.success && envelope.error.code === 'UNAUTHENTICATED' && (await tryRefresh())) {
    envelope = await rawRequest<T>(path, init);
  }

  if (!envelope.success) {
    const status = envelope.error.code === 'UNAUTHENTICATED' ? 401 : 400;
    throw new ApiRequestError(envelope.error.code, envelope.error.message, status);
  }
  return envelope.data;
}

export async function login(email: string, password: string): Promise<AuthenticatedUser> {
  const grant = await api<TokenGrant>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  accessToken = grant.accessToken;
  currentUser = grant.user;
  return grant.user;
}

export async function logout(): Promise<void> {
  await api<null>('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
  accessToken = null;
  currentUser = null;
}

/** Multipart file upload (question attachments) — bypasses the JSON envelope's Content-Type. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body,
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!envelope.success) {
    const status = envelope.error.code === 'UNAUTHENTICATED' ? 401 : 400;
    throw new ApiRequestError(envelope.error.code, envelope.error.message, status);
  }
  return envelope.data;
}

/** Uploads a builder design asset (option image, question/page media, theme background/logo). */
export function uploadAsset<T>(file: File): Promise<T> {
  return uploadFile<T>('/v1/forms/assets', file);
}

/** Public, unauthenticated URL for a design asset — safe to use directly in an <img src>. */
export function assetUrl(assetId: string): string {
  return `${API_URL}/api/v1/forms/assets/${assetId}`;
}

/** Authenticated file download (e.g. CSV export, an uploaded attachment) — outside the JSON envelope. */
export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await fetch(`${API_URL}/api${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!response.ok) throw new ApiRequestError('INTERNAL_ERROR', 'Download failed', response.status);
  // prefer the server's Content-Disposition filename (e.g. the uploader's original filename) when present
  const match = response.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackFilename;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Builds and downloads a CSV from data already in the browser (e.g. a
 *  client-computed dashboard export) — no server round-trip needed. */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const escape = (cell: string | number) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Restores the session from the refresh cookie (e.g. after a hard reload). */
export async function restoreSession(): Promise<AuthenticatedUser | null> {
  if (currentUser) return currentUser;
  return (await tryRefresh()) ? currentUser : null;
}
