import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema } from '@pulse/contracts';
import { FormKpiMappingsService } from './form-kpi-mappings.service';

const definition = formDefinitionSchema.parse({
  title: 'peer review',
  fields: [
    { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
    { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
    { key: 'notes', label: 'Notes', type: 'short_text', required: false },
  ],
});

function makePrismaStub() {
  return {
    form: {
      findUnique: vi.fn(async (): Promise<{ id: string; slug: string } | null> => ({ id: 'form-1', slug: 'demo' })),
    },
    formKpiMapping: {
      findMany: vi.fn(),
      findUnique: vi.fn(async (): Promise<{ id: string } | null> => null),
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'mapping-1', ...data })),
      delete: vi.fn(),
    },
    evaluationArea: {
      findUnique: vi.fn(async (): Promise<{ id: string; name: string } | null> => ({ id: 'area-1', name: 'Leadership' })),
    },
    auditLog: { create: vi.fn() },
  };
}

function makeFormsStub() {
  return {
    getLatestVersion: vi.fn(async () => ({ definition })),
  };
}

const validInput = { evaluationAreaId: 'area-1', evaluateeFieldKey: 'evaluatee', scoreFieldKey: 'score' };

describe('FormKpiMappingsService.create', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let forms: ReturnType<typeof makeFormsStub>;

  beforeEach(() => {
    prisma = makePrismaStub();
    forms = makeFormsStub();
  });

  it('creates a mapping when both fields and the Evaluation Area exist', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await service.create('form-1', validInput, 'admin-1');

    expect(prisma.formKpiMapping.create).toHaveBeenCalledWith({
      data: {
        formId: 'form-1',
        evaluationAreaId: 'area-1',
        evaluateeFieldKey: 'evaluatee',
        scoreFieldKey: 'score',
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when evaluateeFieldKey does not reference a person field', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(
      service.create('form-1', { ...validInput, evaluateeFieldKey: 'notes' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.formKpiMapping.create).not.toHaveBeenCalled();
  });

  it('rejects when scoreFieldKey does not reference a rating/nps/slider field', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(
      service.create('form-1', { ...validInput, scoreFieldKey: 'notes' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an unknown Evaluation Area', async () => {
    prisma.evaluationArea.findUnique.mockResolvedValue(null);
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(service.create('form-1', validInput, 'admin-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a duplicate mapping for the same (form, evaluationArea) pair', async () => {
    prisma.formKpiMapping.findUnique.mockResolvedValue({ id: 'existing' });
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(service.create('form-1', validInput, 'admin-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects an unknown form', async () => {
    prisma.form.findUnique.mockResolvedValue(null);
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(service.create('ghost', validInput, 'admin-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('FormKpiMappingsService.delete', () => {
  it('deletes an existing mapping and audit-logs it', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findFirst.mockResolvedValue({ id: 'mapping-1', formId: 'form-1' });
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    await service.delete('form-1', 'mapping-1', 'admin-1');

    expect(prisma.formKpiMapping.delete).toHaveBeenCalledWith({ where: { id: 'mapping-1' } });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects deleting a mapping that does not belong to this form', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findFirst.mockResolvedValue(null);
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    await expect(service.delete('form-1', 'ghost', 'admin-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
