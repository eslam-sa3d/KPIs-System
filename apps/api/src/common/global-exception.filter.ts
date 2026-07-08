import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiFailure } from '@pulse/contracts';
import { randomUUID } from 'node:crypto';
import { AppError } from './app-error';

/**
 * Converts every thrown error into the standard error envelope.
 * Unexpected errors are logged with full detail but returned as an opaque
 * INTERNAL_ERROR — internals never leak to clients.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const requestId: string = request.headers['x-request-id'] ?? randomUUID();

    const { status, body } = this.toEnvelope(exception, requestId);
    if (status >= 500) {
      this.logger.error({ requestId, path: request.url, exception });
    }
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown, requestId: string): { status: number; body: ApiFailure } {
    const meta = { requestId, timestamp: new Date().toISOString() };

    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          success: false,
          error: { code: exception.code, message: exception.message, details: exception.details },
          meta,
        },
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: 429,
        body: {
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests — please retry later' },
          meta,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 401 ? 'UNAUTHENTICATED'
        : status === 403 ? 'FORBIDDEN'
        : status === 404 ? 'NOT_FOUND'
        : 'INTERNAL_ERROR';
      return {
        status,
        body: { success: false, error: { code, message: exception.message }, meta },
      };
    }

    return {
      status: 500,
      body: {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        meta,
      },
    };
  }
}
