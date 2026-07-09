import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { FormAccessGuard } from './form-access.guard';

function makeContext(params: Record<string, string>, user?: { id: string }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params, user }) }),
  } as unknown as ExecutionContext;
}

describe('FormAccessGuard', () => {
  let prisma: {
    form: { findUnique: ReturnType<typeof vi.fn> };
    formCollaborator: { findUnique: ReturnType<typeof vi.fn> };
  };
  let rbac: { getEffectivePermissions: ReturnType<typeof vi.fn> };
  let guard: FormAccessGuard;

  beforeEach(() => {
    prisma = {
      form: { findUnique: vi.fn() },
      formCollaborator: { findUnique: vi.fn() },
    };
    rbac = { getEffectivePermissions: vi.fn(async () => new Set()) };
    guard = new FormAccessGuard(prisma as never, rbac as never);
  });

  it('passes through routes with no slug/formId param', async () => {
    await expect(guard.canActivate(makeContext({}, { id: 'u1' }))).resolves.toBe(true);
    expect(prisma.form.findUnique).not.toHaveBeenCalled();
  });

  it('passes through unauthenticated requests (public routes)', async () => {
    await expect(guard.canActivate(makeContext({ slug: 'demo' }))).resolves.toBe(true);
    expect(prisma.form.findUnique).not.toHaveBeenCalled();
  });

  it('allows anyone when the form is not restricted', async () => {
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
    await expect(guard.canActivate(makeContext({ slug: 'demo' }, { id: 'stranger' }))).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
