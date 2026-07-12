import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { FormAccessGuard } from './form-access.guard';
import { FormPermissionAction } from './form-permission.decorator';

function makeContext(params: Record<string, string>, user?: { id: string }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('FormAccessGuard', () => {
  let prisma: {
    form: { findUnique: ReturnType<typeof vi.fn> };
    formCollaborator: { findUnique: ReturnType<typeof vi.fn> };
  };
  let rbac: { getEffectivePermissions: ReturnType<typeof vi.fn> };
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let guard: FormAccessGuard;

  function setAction(action: FormPermissionAction | undefined) {
    reflector.getAllAndOverride.mockReturnValue(action);
  }

  beforeEach(() => {
    prisma = {
      form: { findUnique: vi.fn() },
      formCollaborator: { findUnique: vi.fn() },
    };
    rbac = { getEffectivePermissions: vi.fn(async () => new Set()) };
    reflector = { getAllAndOverride: vi.fn(() => undefined) };
    guard = new FormAccessGuard(prisma as never, rbac as never, reflector as never);
  });

  it('passes through routes with no slug/formId param', async () => {
    await expect(guard.canActivate(makeContext({}, { id: 'u1' }))).resolves.toBe(true);
    expect(prisma.form.findUnique).not.toHaveBeenCalled();
  });

  it('passes through unauthenticated requests (public routes)', async () => {
    await expect(guard.canActivate(makeContext({ slug: 'demo' }))).resolves.toBe(true);
    expect(prisma.form.findUnique).not.toHaveBeenCalled();
  });

  it('allows anyone when the form is not restricted and has no @FormPermission', async () => {
    prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
    await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'stranger' }))).resolves.toBe(true);
  });

  it('allows the creator of a restricted form', async () => {
    prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: true, createdById: 'owner' });
    await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'owner' }))).resolves.toBe(true);
  });

  it('allows an invited collaborator', async () => {
    prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: true, createdById: 'owner' });
    prisma.formCollaborator.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(guard.canActivate(makeContext({ formId: 'f1' }, { id: 'guest' }))).resolves.toBe(true);
  });

  it('allows a global forms:manage holder even without an invite', async () => {
    prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: true, createdById: 'owner' });
    prisma.formCollaborator.findUnique.mockResolvedValue(null);
    rbac.getEffectivePermissions.mockResolvedValue(new Set(['forms:manage']));
    await expect(guard.canActivate(makeContext({ formId: 'f1' }, { id: 'admin' }))).resolves.toBe(true);
  });

  it('rejects an uninvited, non-admin stranger', async () => {
    prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: true, createdById: 'owner' });
    prisma.formCollaborator.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'stranger' }))).rejects.toBeInstanceOf(AppError);
  });

  describe('@FormPermission tiers', () => {
    it('allows the form owner regardless of tier', async () => {
      setAction('manage');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'owner' }))).resolves.toBe(true);
    });

    it('allows a canViewResponses collaborator for the view tier', async () => {
      setAction('view');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      prisma.formCollaborator.findUnique.mockResolvedValue({ canManage: false, canViewResponses: true });
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'viewer' }))).resolves.toBe(true);
    });

    it('rejects a canViewResponses collaborator for the manage tier', async () => {
      setAction('manage');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      prisma.formCollaborator.findUnique.mockResolvedValue({ canManage: false, canViewResponses: true });
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'viewer' }))).rejects.toBeInstanceOf(AppError);
    });

    it('allows a canManage collaborator for either tier', async () => {
      setAction('manage');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      prisma.formCollaborator.findUnique.mockResolvedValue({ canManage: true, canViewResponses: false });
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'coowner' }))).resolves.toBe(true);
    });

    it('falls back to global form_submissions:read for the view tier', async () => {
      setAction('view');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      prisma.formCollaborator.findUnique.mockResolvedValue(null);
      rbac.getEffectivePermissions.mockResolvedValue(new Set(['form_submissions:read']));
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'admin' }))).resolves.toBe(true);
    });

    it('falls back to global form_submissions:manage for the manage tier', async () => {
      setAction('manage');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      prisma.formCollaborator.findUnique.mockResolvedValue(null);
      rbac.getEffectivePermissions.mockResolvedValue(new Set(['form_submissions:manage']));
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'admin' }))).resolves.toBe(true);
    });

    it('rejects a stranger with no tier, no ownership, and no matching global permission', async () => {
      setAction('view');
      prisma.form.findUnique.mockResolvedValue({ id: 'f1', restricted: false, createdById: 'owner' });
      prisma.formCollaborator.findUnique.mockResolvedValue(null);
      await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'stranger' }))).rejects.toBeInstanceOf(
        AppError,
      );
    });
  });
});
