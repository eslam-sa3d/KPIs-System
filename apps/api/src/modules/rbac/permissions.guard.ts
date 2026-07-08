import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionKey } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { RbacService } from './rbac.service';

/**
 * Enforces @RequirePermissions(...) on every route (registered globally).
 * Routes without the decorator only require authentication.
 * Depends on RbacService's contract, not its storage (DIP) — the Redis/Postgres
 * resolution strategy can change without touching any consumer.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    const granted = await this.rbac.getEffectivePermissions(user.id);
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length) {
      throw AppError.forbidden(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
