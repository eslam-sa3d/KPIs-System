import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsService } from './forms.service';

/** Unit tests for the form lifecycle methods added in this round — archive/
 *  unarchive/delete — following the stubbed-Prisma pattern used across the
 *  API test suite. FormsService's other, pre-existing methods are exercised
 *  indirectly via apps/api/test/forms.integration.spec.ts against a live DB. */
function makePrismaStub() {
  return {
    form: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
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

describe('FormsService.listForms', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: FormsService;

  const definition = { title: 'Sprint check', fields: [{ key: 'q1', label: 'Q1', type: 'rating' }] };

  function formRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'form-1',
      slug: 'sprint-check',
      status: 'published',
      publicToken: null,
      settings: null,
      folder: null,
      createdAt: new Date('2026-01-01'),
      versions: [{ version: 1, definition, submissions: [] }],
      kpiMappings: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = makePrismaStub();
    service = new FormsService(prisma as never, {} as never, {} as never);
  });

  it('reports hasSubmissionGap: false for an accepting form scored within the last 30 days', async () => {
    prisma.form.findMany.mockResolvedValue([
      formRow({ versions: [{ version: 1, definition, submissions: [{ createdAt: new Date() }] }] }),
    ]);

    const [item] = await service.listForms();

    expect(item!.hasSubmissionGap).toBe(false);
    expect(item!.lastSubmissionAt).not.toBeNull();
  });

  it('flags an accepting form with no submissions in 30+ days as hasSubmissionGap', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 45);
    prisma.form.findMany.mockResolvedValue([
      formRow({ versions: [{ version: 1, definition, submissions: [{ createdAt: old }] }] }),
    ]);

    const [item] = await service.listForms();

    expect(item!.hasSubmissionGap).toBe(true);
  });

  it('flags an accepting form that has never received a submission as hasSubmissionGap', async () => {
    prisma.form.findMany.mockResolvedValue([formRow()]);

    const [item] = await service.listForms();

    expect(item!.hasSubmissionGap).toBe(true);
    expect(item!.lastSubmissionAt).toBeNull();
  });

  it('never flags a draft form as hasSubmissionGap, even with zero submissions', async () => {
    prisma.form.findMany.mockResolvedValue([formRow({ status: 'draft' })]);

    const [item] = await service.listForms();

    expect(item!.hasSubmissionGap).toBe(false);
  });

  it('flags an archived form still linked to a KPI as mappedWhileClosed', async () => {
    prisma.form.findMany.mockResolvedValue([formRow({ status: 'archived', kpiMappings: [{ id: 'mapping-1' }] })]);

    const [item] = await service.listForms();

    expect(item!.mappedWhileClosed).toBe(true);
  });

  it('does not flag a currently-accepting, mapped form as mappedWhileClosed', async () => {
    prisma.form.findMany.mockResolvedValue([formRow({ kpiMappings: [{ id: 'mapping-1' }] })]);

    const [item] = await service.listForms();

    expect(item!.mappedWhileClosed).toBe(false);
  });

  it('treats a form past its own closesAt as not currently accepting', async () => {
    const settings = { acceptingResponses: true, closesAt: '2020-01-01T00:00:00.000Z' };
    prisma.form.findMany.mockResolvedValue([formRow({ settings, kpiMappings: [{ id: 'mapping-1' }] })]);

    const [item] = await service.listForms();

    expect(item!.mappedWhileClosed).toBe(true);
    expect(item!.hasSubmissionGap).toBe(false); // not "accepting", so no submission-gap signal either
  });
});
