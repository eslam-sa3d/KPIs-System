import { Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { AppError } from './app-error';

/**
 * Validates request bodies against a shared @pulse/contracts Zod schema.
 * Usage: @Body(new ZodValidationPipe(createRoleSchema)) input: CreateRoleInput
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.validation(
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
