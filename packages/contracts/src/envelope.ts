/**
 * Standardized API contract — the ONLY shapes the API is allowed to return.
 *
 * Success:
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": { "requestId": "…", "timestamp": "…", "pagination": { … }? }
 * }
 *
 * Error:
 * {
 *   "success": false,
 *   "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [ … ]? },
 *   "meta": { "requestId": "…", "timestamp": "…" }
 * }
 *
 * Enforced server-side by ApiEnvelopeInterceptor + GlobalExceptionFilter.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldIssue {
  /** JSON path of the offending field, e.g. "fields[2].label" */
  path: string;
  message: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: FieldIssue[];
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  pagination?: PaginationMeta;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiError;
  meta: ResponseMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Standard query contract for every paginated list endpoint. */
export interface PageQuery {
  page?: number; // 1-based, default 1
  pageSize?: number; // default 25, max 100
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export const PAGE_DEFAULTS = { page: 1, pageSize: 25, maxPageSize: 100 } as const;

/** Clamps a PageQuery's page/pageSize to sane bounds — page ≥ 1, pageSize
 *  capped at PAGE_DEFAULTS.maxPageSize — the same clamping every paginated
 *  service does before running its query. */
export function resolvePageBounds(query: PageQuery): { page: number; pageSize: number } {
  return {
    page: Math.max(Number(query.page ?? PAGE_DEFAULTS.page), 1),
    pageSize: Math.min(Number(query.pageSize ?? PAGE_DEFAULTS.pageSize), PAGE_DEFAULTS.maxPageSize),
  };
}

export function buildPaginationMeta(page: number, pageSize: number, totalItems: number): PaginationMeta {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}
