import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema, formSettingsSchema } from '@pulse/contracts';
import { FormKpiScoringService } from './form-kpi-scoring.service';

const redisStub = { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn() };

const activeForm = { id: 'form-1', slug: 'demo', publicToken: null };

function makePrismaStub() {
  return {
    form: { findUnique: vi.fn(async () => activeForm) },
    formKpiMapping: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findFirst: vi.fn(),
    },
    formSubmission: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      count: vi.fn(async (): Promise<number> => 0),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []) },
    evaluationAreaEntry: {
      upsert: vi.fn(),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      delete: vi.fn(),
    },
    performanceLevel: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    scoreLabel: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
  };
}

const kpiDefinition = formDefinitionSchema.parse({
  title: 'peer review',
  fields: [
    { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
    { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
  ],
});

function makeFormsStub(definition = kpiDefinition) {
  return {
    getLatestVersion: vi.fn(async () => ({
      form: activeForm,
      version: { id: 'version-1' },
      definition,
      settings: formSettingsSchema.parse({}),
    })),
    getByPublicToken: vi.fn(async () => ({
      form: activeForm,
      version: { id: 'version-1' },
      definition,
      settings: formSettingsSchema.parse({}),
    })),
  };
}

const mapping = {
  id: 'mapping-1',
  formId: 'form-1',
  evaluationAreaId: 'area-1',
  evaluateeFieldKeys: ['evaluatee'],
  scoreFieldKey: 'score',
  reviewType: 'peer',
  anonymous: false,
  contextFieldKey: null as string | null,
  commentFieldKey: null as string | null,
  evaluationArea: { id: 'area-1', kpiId: 'kpi-1', cadence: 'monthly', isActive: true },
};

describe('FormKpiScoringService.applyKpiMappings', () => {
  it('upserts a normalized EvaluationAreaEntry on submission when a mapping matches', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'evaluator-1',
      'sub-new',
    );

    expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.evaluationAreaEntry.upsert.mock.calls[0]![0];
    expect(call.where.evaluationAreaId_personId_periodStart_periodEnd_enteredById_mappingId.enteredById).toBe(
      'evaluator-1',
    );
    expect(call.create.evaluationAreaId).toBe('area-1');
    expect(call.create.personId).toBe('11111111-1111-4111-8111-111111111111');
    expect(call.create.enteredById).toBe('evaluator-1');
    expect(call.create.value).toBeCloseTo(3.75); // (4-1)/(5-1)*5
    expect(call.create.reviewType).toBe('peer');
    expect(call.create.submissionId).toBe('sub-new');
  });

  it('keys the upsert by evaluator too, so a second rater adds a distinct entry instead of overwriting', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'evaluator-1',
      'sub-1',
    );
    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 2 },
      'evaluator-2',
      'sub-2',
    );

    expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(2);
    const [first, second] = prisma.evaluationAreaEntry.upsert.mock.calls.map((c) => c[0]);
    expect(first.where.evaluationAreaId_personId_periodStart_periodEnd_enteredById_mappingId.enteredById).toBe(
      'evaluator-1',
    );
    expect(second.where.evaluationAreaId_personId_periodStart_periodEnd_enteredById_mappingId.enteredById).toBe(
      'evaluator-2',
    );
  });

  it('snapshots reviewType/anonymous/context/comment from the mapping onto the entry', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([
      { ...mapping, reviewType: 'manager', anonymous: true, contextFieldKey: 'team', commentFieldKey: 'team' },
    ]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    const definition = formDefinitionSchema.parse({
      title: 'peer review',
      fields: [
        { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
        { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
        { key: 'team', label: 'Team', type: 'short_text', required: false },
      ],
    });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub(definition) as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      definition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4, team: 'digital-channels' },
      'evaluator-1',
      'sub-new',
    );

    const call = prisma.evaluationAreaEntry.upsert.mock.calls[0]![0];
    expect(call.create.reviewType).toBe('manager');
    expect(call.create.anonymous).toBe(true);
    expect(call.create.context).toBe('digital-channels');
    expect(call.create.comment).toBe('digital-channels');
  });

  it("resolves a 'person'-typed context field to a display name instead of the raw user id", async () => {
    const prisma = makePrismaStub();
    const helperId = '22222222-2222-4222-8222-222222222222';
    prisma.formKpiMapping.findMany.mockResolvedValue([{ ...mapping, contextFieldKey: 'helper' }]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    prisma.user.findMany.mockResolvedValue([{ id: helperId, displayName: 'Helper Person' }]);
    const definition = formDefinitionSchema.parse({
      title: 'peer review',
      fields: [
        { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
        { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
        { key: 'helper', label: 'Who else helped?', type: 'person', required: false },
      ],
    });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub(definition) as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      definition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4, helper: helperId },
      'evaluator-1',
      'sub-new',
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [helperId] } } }));
    const call = prisma.evaluationAreaEntry.upsert.mock.calls[0]![0];
    expect(call.create.context).toBe('Helper Person');
  });

  it('self-assessment: scores the submitter themselves when the mapping has no evaluateeFieldKeys', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([{ ...mapping, evaluateeFieldKeys: [] }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'evaluator-1', isActive: true });
    const definition = formDefinitionSchema.parse({
      title: 'self review',
      fields: [{ key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true }],
    });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub(definition) as never, redisStub as never);

    await service.applyKpiMappings('form-1', definition, { score: 4 }, 'evaluator-1', 'sub-new');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'evaluator-1' } });
    const call = prisma.evaluationAreaEntry.upsert.mock.calls[0]![0];
    expect(call.create.personId).toBe('evaluator-1');
    expect(call.create.enteredById).toBe('evaluator-1');
  });

  it('deletes a stale entry left under a different personId by an earlier resolution of the same submission', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    // this submission previously scored a DIFFERENT person for this same area
    // (e.g. the mapping used to be self-assessment, or the evaluatee answer changed)
    prisma.evaluationAreaEntry.findFirst.mockResolvedValue({ id: 'stale-entry-1' });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'evaluator-1',
      'sub-new',
    );

    expect(prisma.evaluationAreaEntry.findFirst).toHaveBeenCalledWith({
      where: {
        submissionId: 'sub-new',
        mappingId: 'mapping-1',
        personId: { not: '11111111-1111-4111-8111-111111111111' },
      },
      select: { id: true },
    });
    expect(prisma.evaluationAreaEntry.delete).toHaveBeenCalledWith({ where: { id: 'stale-entry-1' } });
    expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not delete anything when the resolved evaluatee has not changed', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    prisma.evaluationAreaEntry.findFirst.mockResolvedValue(null);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'evaluator-1',
      'sub-new',
    );

    expect(prisma.evaluationAreaEntry.delete).not.toHaveBeenCalled();
    expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips mapping application for anonymous public submissions (no enteredById)', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      null,
      'sub-new',
    );

    expect(prisma.formKpiMapping.findMany).not.toHaveBeenCalled();
    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('skips a mapping whose evaluatee answer resolves to an inactive user', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: false });
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'evaluator-1',
      'sub-new',
    );

    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('skips a mapping on an inactive Evaluation Area', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([
      { ...mapping, evaluationArea: { ...mapping.evaluationArea, isActive: false } },
    ]);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await service.applyKpiMappings(
      'form-1',
      kpiDefinition,
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'evaluator-1',
      'sub-new',
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('a failing mapping never throws — it is swallowed and logged', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockRejectedValue(new Error('db blip'));
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await expect(
      service.applyKpiMappings(
        'form-1',
        kpiDefinition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
        'evaluator-1',
        'sub-new',
      ),
    ).resolves.toBeUndefined();
  });

  describe('normalizeScore — non-rating/nps/slider scoreable types', () => {
    function makeService(scoreField: object) {
      const prisma = makePrismaStub();
      prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
      prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
      const definition = formDefinitionSchema.parse({
        title: 'peer review',
        fields: [
          { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
          { key: 'score', label: 'Score', required: true, ...scoreField },
        ],
      });
      return {
        prisma,
        definition,
        service: new FormKpiScoringService(prisma as never, makeFormsStub(definition) as never, redisStub as never),
      };
    }

    it('boolean: no scores 0, yes scores 5', async () => {
      const { prisma, definition, service } = makeService({ type: 'boolean' });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: false },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(0);

      const { prisma: prisma2, definition: definition2, service: service2 } = makeService({ type: 'boolean' });
      await service2.applyKpiMappings(
        'form-1',
        definition2,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: true },
        'evaluator-1',
        'sub-2',
      );
      expect(prisma2.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(5);
    });

    it("select: scores by the chosen option's position in the list", async () => {
      const { prisma, definition, service } = makeService({
        type: 'select',
        options: [
          { value: 'a', label: 'Poor' },
          { value: 'b', label: 'Fair' },
          { value: 'c', label: 'Great' },
        ],
      });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 'b' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(2.5); // 1/(3-1)*5
    });

    it('select: a free-text "other:" answer has no fixed position, so it is skipped', async () => {
      const { prisma, definition, service } = makeService({
        type: 'select',
        options: [
          { value: 'a', label: 'Poor' },
          { value: 'b', label: 'Fair' },
        ],
        allowOther: true,
      });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 'other:something' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });

    it('multi_select: scores by the fraction of options selected', async () => {
      const { prisma, definition, service } = makeService({
        type: 'multi_select',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
          { value: 'd', label: 'D' },
        ],
      });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: ['a', 'b'] },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(2.5); // 2/4*5
    });

    it('number: normalizes against a configured min/max range like a slider', async () => {
      const { prisma, definition, service } = makeService({ type: 'number', min: 0, max: 10 });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 5 },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(2.5); // (5-0)/10*5
    });

    it('number: without a configured range, clamps the raw value directly to 0-5', async () => {
      const { prisma, definition, service } = makeService({ type: 'number' });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 3 },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(3);

      const { prisma: prisma2, definition: definition2, service: service2 } = makeService({ type: 'number' });
      await service2.applyKpiMappings(
        'form-1',
        definition2,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 99 },
        'evaluator-1',
        'sub-2',
      );
      expect(prisma2.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(5); // clamped
    });

    it('likert: scores by the average statement position across the shared scale', async () => {
      const { prisma, definition, service } = makeService({
        type: 'likert',
        statements: [
          { value: 's1', label: 'Communication' },
          { value: 's2', label: 'Punctuality' },
        ],
        scale: ['never', 'rarely', 'sometimes', 'always'],
      });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: { s1: 1, s2: 3 } },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(10 / 3); // avg(1,3)=2, 2/3*5
    });

    it("performance_level: scores by the midpoint of the chosen level's configured range", async () => {
      const { prisma, definition, service } = makeService({ type: 'performance_level' });
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: '22222222-2222-4222-8222-222222222222', minScore: 4, maxScore: 5 },
        { id: '33333333-3333-4333-8333-333333333333', minScore: 0, maxScore: 1 },
      ]);
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: '22222222-2222-4222-8222-222222222222' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(4.5);
    });

    it('performance_level: an id matching no configured level is skipped', async () => {
      const { prisma, definition, service } = makeService({ type: 'performance_level' });
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: '22222222-2222-4222-8222-222222222222', minScore: 4, maxScore: 5 },
      ]);
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: '44444444-4444-4444-8444-444444444444' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });

    it("score_label: scores by the chosen label's configured score", async () => {
      const { prisma, definition, service } = makeService({ type: 'score_label' });
      prisma.scoreLabel.findMany.mockResolvedValue([
        { id: '22222222-2222-4222-8222-222222222222', score: 5 },
        { id: '33333333-3333-4333-8333-333333333333', score: 0 },
      ]);
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: '22222222-2222-4222-8222-222222222222' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(5);
    });

    it('score_label: an id matching no configured label is skipped', async () => {
      const { prisma, definition, service } = makeService({ type: 'score_label' });
      prisma.scoreLabel.findMany.mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222', score: 5 }]);
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: '44444444-4444-4444-8444-444444444444' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });

    it('a type with no numeric interpretation (short_text) is never scored', async () => {
      const { prisma, definition, service } = makeService({ type: 'short_text' });
      await service.applyKpiMappings(
        'form-1',
        definition,
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 'great job' },
        'evaluator-1',
        'sub-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });
  });
});

describe('FormKpiScoringService.backfillMapping', () => {
  let prisma: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    prisma = makePrismaStub();
  });

  it('scores every existing submission on the form against the mapping, into its own createdAt period', async () => {
    prisma.formKpiMapping.findFirst.mockResolvedValue(mapping);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    prisma.formSubmission.findMany.mockResolvedValue([
      {
        id: 'sub-old-1',
        answers: { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
        submittedById: 'evaluator-1',
        createdAt: new Date('2025-01-15T00:00:00.000Z'),
      },
      {
        id: 'sub-old-2',
        answers: { evaluatee: '11111111-1111-4111-8111-111111111111', score: 5 },
        submittedById: 'evaluator-2',
        createdAt: new Date('2025-02-15T00:00:00.000Z'),
      },
    ]);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    const result = await service.backfillMapping('form-1', 'mapping-1');

    expect(result).toEqual({ scored: 2, skipped: 0, skippedReasons: {} });
    expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(2);
    const [first, second] = prisma.evaluationAreaEntry.upsert.mock.calls.map((c) => c[0]);
    // monthly cadence: each submission scores into ITS OWN month, not today's
    expect(first.create.periodStart.getUTCMonth()).toBe(0); // January
    expect(second.create.periodStart.getUTCMonth()).toBe(1); // February
  });

  it('skips anonymous (no submittedById) submissions, same rule as live submissions', async () => {
    prisma.formKpiMapping.findFirst.mockResolvedValue(mapping);
    prisma.formSubmission.findMany.mockResolvedValue([
      {
        id: 'sub-old-1',
        answers: { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
        submittedById: null,
        createdAt: new Date('2025-01-15T00:00:00.000Z'),
      },
    ]);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    const result = await service.backfillMapping('form-1', 'mapping-1');

    expect(result).toEqual({
      scored: 0,
      skipped: 1,
      skippedReasons: { 'anonymous submission (no evaluator)': 1 },
    });
    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('breaks down why submissions were skipped when a score answer cannot be normalized', async () => {
    prisma.formKpiMapping.findFirst.mockResolvedValue(mapping);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    prisma.formSubmission.findMany.mockResolvedValue([
      {
        id: 'sub-old-1',
        answers: { evaluatee: '11111111-1111-4111-8111-111111111111' }, // score field never answered
        submittedById: 'evaluator-1',
        createdAt: new Date('2025-01-15T00:00:00.000Z'),
      },
      {
        id: 'sub-old-2',
        answers: {}, // no evaluatee answered either
        submittedById: 'evaluator-2',
        createdAt: new Date('2025-02-15T00:00:00.000Z'),
      },
    ]);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    const result = await service.backfillMapping('form-1', 'mapping-1');

    expect(result.scored).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.skippedReasons).toEqual({
      'score field was not answered': 1,
      'no evaluatee field was answered': 1,
    });
  });

  it('rejects a mapping that does not belong to this form', async () => {
    prisma.formKpiMapping.findFirst.mockResolvedValue(null);
    const service = new FormKpiScoringService(prisma as never, makeFormsStub() as never, redisStub as never);

    await expect(service.backfillMapping('form-1', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
