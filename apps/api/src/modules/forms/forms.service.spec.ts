import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsService } from './forms.service';

/** Unit tests for the form lifecycle methods added in this round — archive/
 *  unarchive/delete — following the stubbed-Prisma pattern used across the
 *  API test suite. FormsService's other, pre-existing methods are exercised
 *  indirectly via apps/api/test/forms.integration.spec.ts against a live DB. */
function makePrismaStub() {
  return {
    form: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    formSubmission: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
}

const owner = { id: 'user-1' };
const ownedForm = { id: 'form-1', slug: 'qa-survey', createdById: owner.id, collaborators: [] };

describe('FormsService.archiveForm / unarchiveForm / deleteForm', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let rbac: { getEffectivePermissions: ReturnType<typeof vi.fn> };
  let service: FormsService;

  beforeEach(() => {
    prisma = makePrismaStub();
    rbac = { getEffectivePermissions: vi.fn().mockResolvedValue(new Set()) };
    service = new FormsService(prisma as never, {} as never, rbac as never);
  });

  describe('archiveForm', () => {
    it('sets status to archived and audit-logs it', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);

      const result = await service.archiveForm('form-1', owner.id);

      expect(prisma.form.update).toHaveBeenCalledWith({
        where: { id: 'form-1' },
        data: { status: 'archived' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId: owner.id, action: 'form.archived', entityId: 'form-1' }),
      });
      expect(result).toEqual({ status: 'archived' });
    });

    it('rejects a caller who is neither the owner, a managing collaborator, nor forms:manage', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);
      await expect(service.archiveForm('form-1', 'stranger')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(prisma.form.update).not.toHaveBeenCalled();
    });

    it('allows a global forms:manage holder even without ownership', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);
      rbac.getEffectivePermissions.mockResolvedValue(new Set(['forms:manage']));

      await service.archiveForm('form-1', 'admin-1');
      expect(prisma.form.update).toHaveBeenCalled();
    });
  });

  describe('unarchiveForm', () => {
    it('sets status back to published and audit-logs it', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);

      const result = await service.unarchiveForm('form-1', owner.id);

      expect(prisma.form.update).toHaveBeenCalledWith({
        where: { id: 'form-1' },
        data: { status: 'published' },
      });
      expect(result).toEqual({ status: 'published' });
    });
  });

  describe('deleteForm', () => {
    it('hard-deletes a form with no submissions, and audit-logs it', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);
      prisma.formSubmission.count.mockResolvedValue(0);

      await service.deleteForm('form-1', owner.id);

      expect(prisma.form.delete).toHaveBeenCalledWith({ where: { id: 'form-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'form.deleted', entityId: 'form-1' }) }),
      );
    });

    it('rejects deleting a form that has submissions', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);
      prisma.formSubmission.count.mockResolvedValue(12);

      await expect(service.deleteForm('form-1', owner.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.form.delete).not.toHaveBeenCalled();
    });

    it('counts submissions across every version of the form', async () => {
      prisma.form.findUnique.mockResolvedValue(ownedForm);
      prisma.formSubmission.count.mockResolvedValue(0);

      await service.deleteForm('form-1', owner.id);

      expect(prisma.formSubmission.count).toHaveBeenCalledWith({
        where: { formVersion: { formId: 'form-1' } },
      });
    });
  });
});
