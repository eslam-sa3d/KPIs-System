import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema } from '@pulse/contracts';
import { FormKpiMappingsService } from './form-kpi-mappings.service';

const definition = formDefinitionSchema.parse({
  title: 'peer review',
  fields: [
    { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
    { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
    { key: 'score2', label: 'Communication', type: 'rating', scale: 5, required: true },
    { key: 'notes', label: 'Notes', type: 'short_text', required: false },
    { key: 'heading', label: 'Section heading', type: 'section_header', required: false },
  ],
});

function makePrismaStub() {
  return {
    form: {
      findUnique: vi.fn(async (): Promise<{ id: string; slug: string } | null> => ({ id: 'form-1', slug: 'demo' })),
    },
    formKpiMapping: {
      findMany: vi.fn(),
      findUnique: vi.fn(
        async (_args: {
          where: { formId_evaluationAreaId: { formId: string; evaluationAreaId: string } };
        }): Promise<{ id: string } | null> => null,
      ),
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'mapping-1', ...data })),
      delete: vi.fn(),
    },
    evaluationArea: {
      findUnique: vi.fn(
        async (_args: { where: { id: string } }): Promise<{ id: string; name: string } | null> => ({
          id: 'area-1',
          name: 'Leadership',
        }),
      ),
    },
    auditLog: { create: vi.fn() },
  };
}

function makeFormsStub() {
  return {
    getLatestVersion: vi.fn(async () => ({ definition })),
  };
}

const validInput = {
  evaluationAreaId: 'area-1',
  evaluateeFieldKey: 'evaluatee',
  scoreFieldKey: 'score',
  reviewType: 'peer' as const,
  anonymous: false,
};

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
        reviewType: 'peer',
        anonymous: false,
        contextFieldKey: undefined,
        commentFieldKey: undefined,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('accepts a reviewType/anonymous/context/comment field selection', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await service.create(
      'form-1',
      { ...validInput, reviewType: 'manager', anonymous: true, contextFieldKey: 'notes', commentFieldKey: 'notes' },
      'admin-1',
    );

    expect(prisma.formKpiMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewType: 'manager',
        anonymous: true,
        contextFieldKey: 'notes',
        commentFieldKey: 'notes',
      }),
    });
  });

  it('rejects a contextFieldKey/commentFieldKey that does not exist on the form', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(
      service.create('form-1', { ...validInput, contextFieldKey: 'ghost-field' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.formKpiMapping.create).not.toHaveBeenCalled();
  });

  it('rejects when evaluateeFieldKey does not reference a person field', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(
      service.create('form-1', { ...validInput, evaluateeFieldKey: 'notes' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.formKpiMapping.create).not.toHaveBeenCalled();
  });

  it('creates a self-assessment mapping when evaluateeFieldKey is omitted', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    const { evaluateeFieldKey: _omit, ...withoutEvaluatee } = validInput;
    await service.create('form-1', withoutEvaluatee, 'admin-1');

    expect(prisma.formKpiMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ evaluateeFieldKey: undefined }),
    });
  });

  it('allows linking a field type with no live-scoring formula (e.g. short_text) — it just never scores', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(service.create('form-1', { ...validInput, scoreFieldKey: 'notes' }, 'admin-1')).resolves.toMatchObject(
      { id: 'mapping-1' },
    );
  });

  it('rejects when scoreFieldKey references a section_header, which has no answer at all', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(
      service.create('form-1', { ...validInput, scoreFieldKey: 'heading' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects when scoreFieldKey does not reference any field on the form', async () => {
    const service = new FormKpiMappingsService(prisma as never, forms as never);
    await expect(
      service.create('form-1', { ...validInput, scoreFieldKey: 'ghost' }, 'admin-1'),
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

describe('FormKpiMappingsService.bulkCreate', () => {
  const areas: Record<string, { id: string; name: string } | null> = {
    'area-1': { id: 'area-1', name: 'Leadership' },
    'area-2': { id: 'area-2', name: 'Communication' },
  };

  /** existingMappings is per-call, not shared, so tests can't leak state into each other. */
  function makeBulkPrismaStub(existingMappings: Record<string, { id: string } | null> = {}) {
    const prisma = makePrismaStub();
    prisma.evaluationArea.findUnique.mockImplementation(async ({ where }) =>
      Object.prototype.hasOwnProperty.call(areas, where.id) ? areas[where.id]! : null,
    );
    prisma.formKpiMapping.findUnique.mockImplementation(
      async ({ where }) => existingMappings[where.formId_evaluationAreaId.evaluationAreaId] ?? null,
    );
    return prisma;
  }

  const bulkInput = {
    evaluateeFieldKey: 'evaluatee',
    reviewType: 'peer' as const,
    anonymous: false,
    mappings: [
      { evaluationAreaId: 'area-1', scoreFieldKey: 'score' },
      { evaluationAreaId: 'area-2', scoreFieldKey: 'score2' },
    ],
  };

  it('creates every row when all are valid and unmapped', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    const result = await service.bulkCreate('form-1', bulkInput, 'admin-1');

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(prisma.formKpiMapping.create).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('skips a row whose Evaluation Area is already mapped on this form, keeping the rest', async () => {
    const prisma = makeBulkPrismaStub({ 'area-2': { id: 'mapping-existing' } });
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    const result = await service.bulkCreate('form-1', bulkInput, 'admin-1');

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ evaluationAreaId: 'area-1' });
    expect(result.skipped).toEqual([
      { evaluationAreaId: 'area-2', reason: 'this form is already mapped to "Communication"' },
    ]);
  });

  it('skips a row referencing an unknown Evaluation Area', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    const result = await service.bulkCreate(
      'form-1',
      { evaluateeFieldKey: 'evaluatee', reviewType: 'peer' as const, anonymous: false, mappings: [{ evaluationAreaId: 'ghost-area', scoreFieldKey: 'score' }] },
      'admin-1',
    );

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual([{ evaluationAreaId: 'ghost-area', reason: 'evaluation area not found' }]);
  });

  it('creates a row whose scoreFieldKey has no live-scoring formula (e.g. short_text) — it just never scores', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    const result = await service.bulkCreate(
      'form-1',
      { evaluateeFieldKey: 'evaluatee', reviewType: 'peer' as const, anonymous: false, mappings: [{ evaluationAreaId: 'area-1', scoreFieldKey: 'notes' }] },
      'admin-1',
    );

    expect(result.skipped).toHaveLength(0);
    expect(result.created).toHaveLength(1);
  });

  it('skips a row whose scoreFieldKey references a section_header, which has no answer at all', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    const result = await service.bulkCreate(
      'form-1',
      { evaluateeFieldKey: 'evaluatee', reviewType: 'peer' as const, anonymous: false, mappings: [{ evaluationAreaId: 'area-1', scoreFieldKey: 'heading' }] },
      'admin-1',
    );

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual([
      { evaluationAreaId: 'area-1', reason: '"heading" must reference a question on this form' },
    ]);
  });

  it('rejects the whole batch when evaluateeFieldKey is not a person field', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    await expect(
      service.bulkCreate('form-1', { ...bulkInput, evaluateeFieldKey: 'notes' }, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.formKpiMapping.create).not.toHaveBeenCalled();
  });

  it('creates every row as self-assessment when evaluateeFieldKey is omitted', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);
    const { evaluateeFieldKey: _omit, ...withoutEvaluatee } = bulkInput;

    const result = await service.bulkCreate('form-1', withoutEvaluatee, 'admin-1');

    expect(result.created).toHaveLength(2);
    expect(prisma.formKpiMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evaluateeFieldKey: undefined }) }),
    );
  });

  it('does not audit-log when nothing was created', async () => {
    const prisma = makeBulkPrismaStub();
    const service = new FormKpiMappingsService(prisma as never, makeFormsStub() as never);

    await service.bulkCreate(
      'form-1',
      { evaluateeFieldKey: 'evaluatee', reviewType: 'peer' as const, anonymous: false, mappings: [{ evaluationAreaId: 'ghost-area', scoreFieldKey: 'score' }] },
      'admin-1',
    );

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
