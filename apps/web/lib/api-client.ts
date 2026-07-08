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

async function tryRefresh(): Promise<boolean> {
  const envelope = await rawRequest<TokenGrant>('/v1/auth/refresh', { method: 'POST' });
  if (envelope.success) {
    accessToken = envelope.data.accessToken;
    currentUser = envelope.data.user;
    return true;
  }
  return false;
}

/** Core request: unwraps the envelope, silently refreshing once on 401. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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

/** Authenticated file download (e.g. CSV export) — outside the JSON envelope. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_URL}/api${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!response.ok) throw new ApiRequestError('INTERNAL_ERROR', 'Export failed', response.status);
  const url = URL.createObjectURL(await response.blob());
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
