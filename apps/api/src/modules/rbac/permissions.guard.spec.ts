import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from './permissions.guard';

/**
 * PermissionsGuard is registered globally (APP_GUARD) and is the single
 * enforcement point behind every @RequirePermissions(...) decorator across
 * every controller — KpisController, RolesController, UsersController, and
 * the rest. Testing it directly here proves the guarantee "an unauthorized
 * caller gets rejected" once, thoroughly, without needing a live HTTP server
 * or database to exercise each controller individually.
 */
function makeContext(opts: { required?: string[]; user?: { id: string } | null }) {
  const request = { user: opts.user ?? null };
  return {
    reflector: { getAllAndOverride: vi.fn().mockReturnValue(opts.required) },
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  };
}

describe('PermissionsGuard', () => {
  let rbac: { getEffectivePermissions: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    rbac = { getEffectivePermissions: vi.fn() };
  });

  it('allows the request through when the route has no @RequirePermissions decorator', async () => {
    const { reflector, context } = makeContext({ required: undefined, user: { id: 'user-1' } });
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request (no user on it) with UNAUTHENTICATED', async () => {
    const { reflector, context } = makeContext({ required: ['kpis:read'], user: null });
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a caller missing the single required permission with FORBIDDEN', async () => {
    const { reflector, context } = makeContext({ required: ['kpis:manage'], user: { id: 'user-1' } });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['kpis:read']));
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows a caller who holds the single required permission', async () => {
    const { reflector, context } = makeContext({ required: ['kpis:read'], user: { id: 'user-1' } });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['kpis:read', 'forms:read']));
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects when a route requires multiple permissions and the caller is missing even one (e.g. the KPI series endpoint)', async () => {
    const { reflector, context } = makeContext({
      required: ['kpis:read', 'kpi_entries:read'],
      user: { id: 'user-1' },
    });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['kpis:read'])); // missing kpi_entries:read
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows when the caller holds every one of multiple required permissions', async () => {
    const { reflector, context } = makeContext({
      required: ['kpis:read', 'kpi_entries:read'],
      user: { id: 'user-1' },
    });
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['kpis:read', 'kpi_entries:read']));
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a caller with zero granted permissions attempting a manage-tier action (e.g. deleting a role)', async () => {
    const { reflector, context } = makeContext({ required: ['roles:manage'], user: { id: 'user-1' } });
    rbac.getEffectivePermissions.mockResolvedValue(new Set());
    const guard = new PermissionsGuard(reflector as never, rbac as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
