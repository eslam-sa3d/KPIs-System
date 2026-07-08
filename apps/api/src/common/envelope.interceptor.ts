import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ApiSuccess, PaginationMeta } from '@pulse/contracts';
import { Observable, map } from 'rxjs';
import { randomUUID } from 'node:crypto';

/** Controllers return `paged(items, meta)` to attach pagination to the envelope. */
export interface PagedResult<T> {
  __paged: true;
  items: T[];
  pagination: PaginationMeta;
}

export const paged = <T>(items: T[], pagination: PaginationMeta): PagedResult<T> => ({
  __paged: true,
  items,
  pagination,
});

/**
 * Wraps EVERY successful controller response in the standard ApiEnvelope.
 * Registered globally in main.ts — no route can opt out.
 */
@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    const request = context.switchToHttp().getRequest();
    const requestId: string = request.headers['x-request-id'] ?? randomUUID();

    return next.handle().pipe(
      map((body) => {
        const meta = { requestId, timestamp: new Date().toISOString() };
        if (body && typeof body === 'object' && '__paged' in body) {
          const { items, pagination } = body as PagedResult<unknown>;
          return { success: true as const, data: items, meta: { ...meta, pagination } };
        }
        return { success: true as const, data: body ?? null, meta };
      }),
    );
  }
}
