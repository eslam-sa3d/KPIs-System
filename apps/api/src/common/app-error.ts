import { ErrorCode, FieldIssue } from '@pulse/contracts';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * The only exception type services are allowed to throw for expected failures.
 * The GlobalExceptionFilter maps it onto the standard error envelope.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: FieldIssue[],
  ) {
    super(message);
    this.status = STATUS_BY_CODE[code];
  }

  static notFound(entity: string, id: string): AppError {
    return new AppError('NOT_FOUND', `${entity} "${id}" was not found`);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static validation(details: FieldIssue[]): AppError {
    return new AppError('VALIDATION_ERROR', 'Request validation failed', details);
  }
}
