import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema, formSettingsSchema } from '@pulse/contracts';
import { Prisma } from '@prisma/client';
import { SubmissionsService } from './submissions.service';

const turnstileStub = { verify: vi.fn(async () => undefined) };

const activeForm = { id: 'form-1', slug: 'demo', publicToken: null };

function makePrismaStub() {
  return {
    formSubmission: {
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'sub-new', ...data })),
      update: vi.fn(async ({ data }: { data: object }) => ({ id: 'sub-1', ...data })),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    formFileUpload: {
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    form: { findUnique: vi.fn(async () => activeForm) },
    formKpiMapping: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findFirst: vi.fn(),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []) },
    evaluationAreaEntry: {
      upsert: vi.fn(),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      delete: vi.fn(),
    },
    performanceLevel: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as () => unknown)())),
  };
}

const definition = formDefinitionSchema.parse({
  title: 'demo',
  fields: [{ key: 'team', label: 'Team', type: 'short_text', required: true }],
});

function makeFormsStub(settingsOverride: Partial<ReturnType<typeof formSettingsSchema.parse>> = {}) {
  const settings = formSettingsSchema.parse({ ...settingsOverride });
  return {
    getLatestVersion: vi.fn(async () => ({
      form: activeForm,
      version: { id: 'version-1' },
      definition,
      settings,
    })),
    getByPublicToken: vi.fn(async () => ({
      form: activeForm,
      version: { id: 'version-1' },
      definition,
      settings,
    })),
  };
}

describe('SubmissionsService.submit (settings enforcement)', () => {
  let prisma: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    prisma = makePrismaStub();
  });

  it('accepts a submission when the form is open', async () => {
    const forms = makeFormsStub({ acceptingResponses: true });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when the form is not accepting responses', async () => {
    const forms = makeFormsStub({ acceptingResponses: false });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects before the scheduled open date', async () => {
    const forms = makeFormsStub({ opensAt: new Date(Date.now() + 86_400_000).toISOString() });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects after the scheduled close date', async () => {
    const forms = makeFormsStub({ closesAt: new Date(Date.now() - 86_400_000).toISOString() });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('enforces one-response-per-user when a prior submission exists', async () => {
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'existing' });
    const forms = makeFormsStub({ oneResponsePerUser: true });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('skips one-response-per-user for an anonymous submission with no fingerprint', async () => {
    const forms = makeFormsStub({ oneResponsePerUser: true });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submitPublic('tok', { team: 'x' }, null);
    expect(prisma.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ submittedById: null, respondentFingerprint: null }),
    });
  });

  it('enforces one-response-per-user for anonymous submissions via their cookie fingerprint', async () => {
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'existing' });
    const forms = makeFormsStub({ oneResponsePerUser: true });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submitPublic('tok', { team: 'x' }, 'fp-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(prisma.formSubmission.findFirst).toHaveBeenCalledWith({
      where: { formVersion: { formId: 'form-1' }, OR: [{ respondentFingerprint: 'fp-1' }] },
      select: { id: true },
    });
  });

  it('rejects once maxResponses is reached', async () => {
    prisma.formSubmission.count.mockResolvedValue(3);
    const forms = makeFormsStub({ maxResponses: 3 });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('accepts submissions below maxResponses', async () => {
    prisma.formSubmission.count.mockResolvedValue(2);
    const forms = makeFormsStub({ maxResponses: 3 });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
  });

  it('rejects once a matching quota is reached, independent of maxResponses', async () => {
    prisma.formSubmission.count.mockResolvedValue(2); // quota count (no maxResponses set in this test)
    const forms = makeFormsStub({ quotas: [{ fieldKey: 'team', equals: 'x', limit: 2 }] });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('does not enforce a quota for an answer that does not match its equals value', async () => {
    prisma.formSubmission.count.mockResolvedValue(999); // would reject if checked
    const forms = makeFormsStub({ quotas: [{ fieldKey: 'team', equals: 'y', limit: 1 }] });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
  });

  it('generates an edit token when allowRespondentEdit is on', async () => {
    const forms = makeFormsStub({ allowRespondentEdit: true });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ editToken: expect.any(String) }),
    });
  });

  it('checks the turnstile service on public submissions with the requireCaptcha setting', async () => {
    const forms = makeFormsStub({ requireCaptcha: true });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submitPublic('tok', { team: 'x' }, 'fp-1', 'captcha-token');
    expect(turnstileStub.verify).toHaveBeenCalledWith(true, 'captcha-token');
  });

  it('rejects a public submission when the turnstile check fails', async () => {
    const failingTurnstile = {
      verify: vi.fn(async () => {
        throw new Error('bad captcha');
      }),
    };
    const forms = makeFormsStub({ requireCaptcha: true });
    const service = new SubmissionsService(prisma as never, forms as never, failingTurnstile as never);
    await expect(service.submitPublic('tok', { team: 'x' }, 'fp-1', 'bad-token')).rejects.toThrow('bad captcha');
    expect(prisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it('omits the edit token when allowRespondentEdit is off', async () => {
    const forms = makeFormsStub({ allowRespondentEdit: false });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ editToken: undefined }),
    });
  });
});

describe('SubmissionsService respondent self-edit', () => {
  it('updates a submission found by its edit token', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'sub-1', editToken: 'tok-abc' });
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.updateByEditToken('public-tok', 'tok-abc', { team: 'y' });

    expect(prisma.formSubmission.findFirst).toHaveBeenCalledWith({
      where: { editToken: 'tok-abc', formVersion: { formId: 'form-1' } },
    });
    expect(prisma.formSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { answers: { team: 'y' }, score: Prisma.DbNull },
    });
  });

  it('rejects an unknown edit token', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.findFirst.mockResolvedValue(null);
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await expect(service.updateByEditToken('public-tok', 'nope', { team: 'y' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('fetches a submission by its edit token for prefill', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.findFirst.mockResolvedValue({ answers: { team: 'x' } });
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    const result = await service.getByEditToken('public-tok', 'tok-abc');
    expect(result).toEqual({ answers: { team: 'x' } });
  });
});

describe('SubmissionsService webhook delivery', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fires a POST to the configured webhook on submit, without blocking the response', async () => {
    const prisma = makePrismaStub();
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true }));
    global.fetch = fetchMock as never;
    const forms = makeFormsStub({ webhookUrl: 'https://example.com/hook' });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { team: 'x' }, 'user-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.com/hook');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ formSlug: 'demo', submissionId: 'sub-new', answers: { team: 'x' } });
  });

  it('does not fire a webhook when none is configured', async () => {
    const prisma = makePrismaStub();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    global.fetch = fetchMock as never;
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { team: 'x' }, 'user-1');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fail the submission when webhook delivery throws', async () => {
    const prisma = makePrismaStub();
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as never;
    const forms = makeFormsStub({ webhookUrl: 'https://example.com/hook' });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await expect(service.submit('demo', { team: 'x' }, 'user-1')).resolves.toBeDefined();
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
  });
});

describe('SubmissionsService file-answer integrity', () => {
  const fileDefinition = formDefinitionSchema.parse({
    title: 'attach a receipt',
    fields: [
      {
        key: 'receipt',
        label: 'Receipt',
        type: 'file',
        acceptedMimeTypes: ['application/pdf'],
      },
    ],
  });

  function makeFileFormsStub() {
    return {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'version-1' },
        definition: fileDefinition,
        settings: formSettingsSchema.parse({}),
      })),
    };
  }

  it('rejects a file answer that does not reference a real upload for this form', async () => {
    const prisma = makePrismaStub();
    prisma.formFileUpload.findMany.mockResolvedValue([]); // upload id not found
    const service = new SubmissionsService(prisma as never, makeFileFormsStub() as never, turnstileStub as never);
    await expect(service.submit('attach-a-receipt', { receipt: 'upload-x' }, 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it('accepts a file answer that resolves to a real upload, and links it to the new submission', async () => {
    const prisma = makePrismaStub();
    prisma.formFileUpload.findMany.mockResolvedValue([{ id: 'upload-x' }]);
    const service = new SubmissionsService(prisma as never, makeFileFormsStub() as never, turnstileStub as never);
    await service.submit('attach-a-receipt', { receipt: 'upload-x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
    expect(prisma.formFileUpload.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['upload-x'] } },
      data: { submissionId: 'sub-new' },
    });
  });
});

describe('SubmissionsService.updateSubmission', () => {
  it('re-validates and updates an existing submission on the current version', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'sub-1', formVersionId: 'version-1' });
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.updateSubmission('demo', 'sub-1', { team: 'y' }, 'admin-1');

    expect(prisma.formSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { answers: { team: 'y' }, score: Prisma.DbNull },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: 'submission.updated',
        entity: 'FormSubmission',
        entityId: 'sub-1',
        detail: { formSlug: 'demo' },
      },
    });
  });

  it('rejects an edit that fails validation against the current definition', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'sub-1', formVersionId: 'version-1' });
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await expect(service.updateSubmission('demo', 'sub-1', {}, 'admin-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.formSubmission.update).not.toHaveBeenCalled();
  });

  it('rejects editing a submission that belongs to an older version', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.findFirst.mockResolvedValue(null); // not found on the CURRENT version
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await expect(service.updateSubmission('demo', 'sub-old', { team: 'y' }, 'admin-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('SubmissionsService — Forms→KPI bridge', () => {
  const kpiDefinition = formDefinitionSchema.parse({
    title: 'peer review',
    fields: [
      { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
      { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
    ],
  });

  function makeKpiFormsStub() {
    return {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'version-1' },
        definition: kpiDefinition,
        settings: formSettingsSchema.parse({}),
      })),
      getByPublicToken: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'version-1' },
        definition: kpiDefinition,
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

  it('upserts a normalized EvaluationAreaEntry on submission when a mapping matches', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1');

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
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1');
    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 2 }, 'evaluator-2');

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
    const forms = makeKpiFormsStub();
    forms.getLatestVersion.mockResolvedValue({
      form: activeForm,
      version: { id: 'version-1' },
      definition: formDefinitionSchema.parse({
        title: 'peer review',
        fields: [
          { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
          { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
          { key: 'team', label: 'Team', type: 'short_text', required: false },
        ],
      }),
      settings: formSettingsSchema.parse({}),
    });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit(
      'demo',
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4, team: 'digital-channels' },
      'evaluator-1',
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
    const forms = makeKpiFormsStub();
    forms.getLatestVersion.mockResolvedValue({
      form: activeForm,
      version: { id: 'version-1' },
      definition: formDefinitionSchema.parse({
        title: 'peer review',
        fields: [
          { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
          { key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true },
          { key: 'helper', label: 'Who else helped?', type: 'person', required: false },
        ],
      }),
      settings: formSettingsSchema.parse({}),
    });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit(
      'demo',
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4, helper: helperId },
      'evaluator-1',
    );

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [helperId] } } }));
    const call = prisma.evaluationAreaEntry.upsert.mock.calls[0]![0];
    expect(call.create.context).toBe('Helper Person');
  });

  it('self-assessment: scores the submitter themselves when the mapping has no evaluateeFieldKeys', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([{ ...mapping, evaluateeFieldKeys: [] }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'evaluator-1', isActive: true });
    const forms = makeKpiFormsStub();
    forms.getLatestVersion.mockResolvedValue({
      form: activeForm,
      version: { id: 'version-1' },
      definition: formDefinitionSchema.parse({
        title: 'self review',
        fields: [{ key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true }],
      }),
      settings: formSettingsSchema.parse({}),
    });
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { score: 4 }, 'evaluator-1');

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
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1');

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
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1');

    expect(prisma.evaluationAreaEntry.delete).not.toHaveBeenCalled();
    expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips mapping application for anonymous public submissions (no enteredById)', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submitPublic(
      'token-1',
      { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
      'fingerprint-1',
    );

    expect(prisma.formKpiMapping.findMany).not.toHaveBeenCalled();
    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('skips a mapping whose evaluatee answer resolves to an inactive user', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: false });
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1');

    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('skips a mapping on an inactive Evaluation Area', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([
      { ...mapping, evaluationArea: { ...mapping.evaluationArea, isActive: false } },
    ]);
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1');

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
  });

  it('a failing mapping never fails the submission itself', async () => {
    const prisma = makePrismaStub();
    prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
    prisma.user.findUnique.mockRejectedValue(new Error('db blip'));
    const forms = makeKpiFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    await expect(
      service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 }, 'evaluator-1'),
    ).resolves.toMatchObject({ id: 'sub-new' });
  });

  describe('normalizeScore — non-rating/nps/slider scoreable types', () => {
    function makeService(scoreField: object) {
      const prisma = makePrismaStub();
      prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
      prisma.user.findUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', isActive: true });
      const forms = makeKpiFormsStub();
      forms.getLatestVersion.mockResolvedValue({
        form: activeForm,
        version: { id: 'version-1' },
        definition: formDefinitionSchema.parse({
          title: 'peer review',
          fields: [
            { key: 'evaluatee', label: 'Who are you reviewing?', type: 'person', required: true },
            { key: 'score', label: 'Score', required: true, ...scoreField },
          ],
        }),
        settings: formSettingsSchema.parse({}),
      });
      return { prisma, service: new SubmissionsService(prisma as never, forms as never, turnstileStub as never) };
    }

    it('boolean: no scores 0, yes scores 5', async () => {
      const { prisma, service } = makeService({ type: 'boolean' });
      await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: false }, 'evaluator-1');
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(0);

      const { prisma: prisma2, service: service2 } = makeService({ type: 'boolean' });
      await service2.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: true }, 'evaluator-1');
      expect(prisma2.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(5);
    });

    it("select: scores by the chosen option's position in the list", async () => {
      const { prisma, service } = makeService({
        type: 'select',
        options: [
          { value: 'a', label: 'Poor' },
          { value: 'b', label: 'Fair' },
          { value: 'c', label: 'Great' },
        ],
      });
      await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 'b' }, 'evaluator-1');
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(2.5); // 1/(3-1)*5
    });

    it('select: a free-text "other:" answer has no fixed position, so it is skipped', async () => {
      const { prisma, service } = makeService({
        type: 'select',
        options: [
          { value: 'a', label: 'Poor' },
          { value: 'b', label: 'Fair' },
        ],
        allowOther: true,
      });
      await service.submit(
        'demo',
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 'other:something' },
        'evaluator-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });

    it('multi_select: scores by the fraction of options selected', async () => {
      const { prisma, service } = makeService({
        type: 'multi_select',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
          { value: 'd', label: 'D' },
        ],
      });
      await service.submit(
        'demo',
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: ['a', 'b'] },
        'evaluator-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(2.5); // 2/4*5
    });

    it('number: normalizes against a configured min/max range like a slider', async () => {
      const { prisma, service } = makeService({ type: 'number', min: 0, max: 10 });
      await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 5 }, 'evaluator-1');
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(2.5); // (5-0)/10*5
    });

    it('number: without a configured range, clamps the raw value directly to 0-5', async () => {
      const { prisma, service } = makeService({ type: 'number' });
      await service.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 3 }, 'evaluator-1');
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(3);

      const { prisma: prisma2, service: service2 } = makeService({ type: 'number' });
      await service2.submit('demo', { evaluatee: '11111111-1111-4111-8111-111111111111', score: 99 }, 'evaluator-1');
      expect(prisma2.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(5); // clamped
    });

    it('likert: scores by the average statement position across the shared scale', async () => {
      const { prisma, service } = makeService({
        type: 'likert',
        statements: [
          { value: 's1', label: 'Communication' },
          { value: 's2', label: 'Punctuality' },
        ],
        scale: ['never', 'rarely', 'sometimes', 'always'],
      });
      await service.submit(
        'demo',
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: { s1: 1, s2: 3 } },
        'evaluator-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBeCloseTo(10 / 3); // avg(1,3)=2, 2/3*5
    });

    it("performance_level: scores by the midpoint of the chosen level's configured range", async () => {
      const { prisma, service } = makeService({ type: 'performance_level' });
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: '22222222-2222-4222-8222-222222222222', minScore: 4, maxScore: 5 },
        { id: '33333333-3333-4333-8333-333333333333', minScore: 0, maxScore: 1 },
      ]);
      await service.submit(
        'demo',
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: '22222222-2222-4222-8222-222222222222' },
        'evaluator-1',
      );
      expect(prisma.evaluationAreaEntry.upsert.mock.calls[0]![0].create.value).toBe(4.5);
    });

    it('performance_level: an id matching no configured level is skipped', async () => {
      const { prisma, service } = makeService({ type: 'performance_level' });
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: '22222222-2222-4222-8222-222222222222', minScore: 4, maxScore: 5 },
      ]);
      await service.submit(
        'demo',
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: '44444444-4444-4444-8444-444444444444' },
        'evaluator-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });

    it('a type with no numeric interpretation (short_text) is never scored', async () => {
      const { prisma, service } = makeService({ type: 'short_text' });
      await service.submit(
        'demo',
        { evaluatee: '11111111-1111-4111-8111-111111111111', score: 'great job' },
        'evaluator-1',
      );
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });
  });

  describe('backfillMapping', () => {
    it('scores every existing submission on the form against the mapping, into its own createdAt period', async () => {
      const prisma = makePrismaStub();
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
      const forms = makeKpiFormsStub();
      const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

      const result = await service.backfillMapping('form-1', 'mapping-1');

      expect(result).toEqual({ scored: 2, skipped: 0 });
      expect(prisma.evaluationAreaEntry.upsert).toHaveBeenCalledTimes(2);
      const [first, second] = prisma.evaluationAreaEntry.upsert.mock.calls.map((c) => c[0]);
      // monthly cadence: each submission scores into ITS OWN month, not today's
      expect(first.create.periodStart.getUTCMonth()).toBe(0); // January
      expect(second.create.periodStart.getUTCMonth()).toBe(1); // February
    });

    it('skips anonymous (no submittedById) submissions, same rule as live submissions', async () => {
      const prisma = makePrismaStub();
      prisma.formKpiMapping.findFirst.mockResolvedValue(mapping);
      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-old-1',
          answers: { evaluatee: '11111111-1111-4111-8111-111111111111', score: 4 },
          submittedById: null,
          createdAt: new Date('2025-01-15T00:00:00.000Z'),
        },
      ]);
      const forms = makeKpiFormsStub();
      const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

      const result = await service.backfillMapping('form-1', 'mapping-1');

      expect(result).toEqual({ scored: 0, skipped: 1 });
      expect(prisma.evaluationAreaEntry.upsert).not.toHaveBeenCalled();
    });

    it('rejects a mapping that does not belong to this form', async () => {
      const prisma = makePrismaStub();
      prisma.formKpiMapping.findFirst.mockResolvedValue(null);
      const forms = makeKpiFormsStub();
      const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

      await expect(service.backfillMapping('form-1', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('SubmissionsService.deleteAllSubmissions', () => {
  it('deletes every submission on the current version and audit-logs the count', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.deleteMany.mockResolvedValue({ count: 7 });
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);

    const result = await service.deleteAllSubmissions('demo', 'admin-1');

    expect(prisma.formSubmission.deleteMany).toHaveBeenCalledWith({ where: { formVersionId: 'version-1' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: 'submissions.deleted_all',
        entity: 'Form',
        entityId: 'demo',
        detail: { count: 7 },
      },
    });
    expect(result).toEqual({ deleted: 7 });
  });
});

describe('SubmissionsService.summary', () => {
  it('computes NPS, averages, likert matrix, and ranking positions', async () => {
    const prisma = makePrismaStub();
    const npsDefinition = formDefinitionSchema.parse({
      title: 'survey',
      fields: [
        { key: 'nps', label: 'NPS', type: 'nps' },
        { key: 'score', label: 'Score', type: 'number' },
        {
          key: 'mood',
          label: 'Mood',
          type: 'likert',
          statements: [{ value: 'tools', label: 'Tools' }],
          scale: ['bad', 'ok', 'great'],
        },
        {
          key: 'prio',
          label: 'Priority',
          type: 'ranking',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
      ],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition: npsDefinition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    prisma.formSubmission.findMany.mockResolvedValue([
      { answers: { nps: 9, score: 10, mood: { tools: 2 }, prio: ['a', 'b'] }, createdAt: new Date() },
      { answers: { nps: 10, score: 20, mood: { tools: 2 }, prio: ['b', 'a'] }, createdAt: new Date() },
      { answers: { nps: 3, score: 30, mood: { tools: 0 }, prio: ['a', 'b'] }, createdAt: new Date() },
    ]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('survey');

    expect(summary.responses).toBe(3);
    const nps = summary.fields.find((f) => f.key === 'nps')!;
    // promoters(>=9): 2, detractors(<=6): 1, total 3 -> (2-1)/3*100 = 33
    expect(nps.npsScore).toBe(33);

    const score = summary.fields.find((f) => f.key === 'score')!;
    expect(score.average).toBe(20);
    expect(score.min).toBe(10);
    expect(score.max).toBe(30);

    const mood = summary.fields.find((f) => f.key === 'mood')!;
    expect(mood.matrix).toEqual({ tools: { '2': 2, '0': 1 } });

    const prio = summary.fields.find((f) => f.key === 'prio')!;
    // a: positions [1,2,1] avg 1.33; b: positions [2,1,2] avg 1.67
    expect(prio.averagePosition!.a).toBeCloseTo(4 / 3, 5);
    expect(prio.averagePosition!.b).toBeCloseTo(5 / 3, 5);
    expect(prio.optionLabels).toEqual({ a: 'A', b: 'B' });
    expect(mood.optionLabels).toEqual({ tools: 'Tools' });
  });

  it('drops routine context fields (evaluation type, period, respondent role) from the summary', async () => {
    const prisma = makePrismaStub();
    const definition = formDefinitionSchema.parse({
      title: 'qa eval',
      fields: [
        { key: 'eval_type', label: 'Evaluation Type', type: 'short_text' },
        { key: 'period', label: 'Period (e.g., Q2, H1, Annual 2026)', type: 'short_text' },
        { key: 'role', label: 'Your Role', type: 'short_text' },
        { key: 'notes', label: 'Notes', type: 'long_text' },
      ],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    prisma.formSubmission.findMany.mockResolvedValue([
      { answers: { eval_type: 'QA', period: 'Q2', role: 'Lead', notes: 'fine' }, createdAt: new Date() },
    ]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('qa-eval');

    expect(summary.fields.map((f) => f.key)).toEqual(['notes']);
  });

  it('drops the same context fields even with incidental spacing differences in the label', async () => {
    const prisma = makePrismaStub();
    const definition = formDefinitionSchema.parse({
      title: 'qa eval',
      fields: [
        { key: 'period', label: 'Period (e.g., Q2 , H1 , Annual 2026)', type: 'short_text' },
        { key: 'notes', label: 'Notes', type: 'long_text' },
      ],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    prisma.formSubmission.findMany.mockResolvedValue([
      { answers: { period: 'Q2', notes: 'fine' }, createdAt: new Date() },
    ]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('qa-eval');

    expect(summary.fields.map((f) => f.key)).toEqual(['notes']);
  });

  it('resolves a "person" field\'s answers to display names instead of raw user ids', async () => {
    const prisma = makePrismaStub();
    const definition = formDefinitionSchema.parse({
      title: 'eval',
      fields: [{ key: 'evaluatee', label: 'Evaluatee', type: 'person' }],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    prisma.formSubmission.findMany.mockResolvedValue([
      { answers: { evaluatee: 'user-1' }, createdAt: new Date() },
      { answers: { evaluatee: 'user-deleted' }, createdAt: new Date() },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Ana Ivanova' }]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('eval');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: expect.arrayContaining(['user-1', 'user-deleted']) } } }),
    );
    const evaluatee = summary.fields.find((f) => f.key === 'evaluatee')!;
    expect(evaluatee.samples).toEqual(['(deleted user)', 'Ana Ivanova']);
  });

  it("resolves a UUID-shaped answer to a display name even on a field not typed 'person'", async () => {
    const prisma = makePrismaStub();
    const definition = formDefinitionSchema.parse({
      title: 'per-area evaluatee',
      fields: [{ key: 'area_owner', label: 'Root Cause Analysis', type: 'short_text' }],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    const uuid = 'aba51f55-559d-4372-87a3-dcafe0b302eb';
    prisma.formSubmission.findMany.mockResolvedValue([
      { answers: { area_owner: uuid }, createdAt: new Date() },
      { answers: { area_owner: 'just a normal text answer' }, createdAt: new Date() },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: uuid, displayName: 'Sam Reyes' }]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('per-area-evaluatee');

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [uuid] } } }));
    const area = summary.fields.find((f) => f.key === 'area_owner')!;
    expect(area.samples).toEqual(['just a normal text answer', 'Sam Reyes']);
  });

  it('leaves a UUID-shaped answer as-is when it does not match any user (not a false "(deleted user)")', async () => {
    const prisma = makePrismaStub();
    const definition = formDefinitionSchema.parse({
      title: 'coincidental uuid',
      fields: [{ key: 'ref_code', label: 'Reference Code', type: 'short_text' }],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    const uuid = '11111111-2222-3333-4444-555555555555';
    prisma.formSubmission.findMany.mockResolvedValue([{ answers: { ref_code: uuid }, createdAt: new Date() }]);
    prisma.user.findMany.mockResolvedValue([]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('coincidental-uuid');

    const field = summary.fields.find((f) => f.key === 'ref_code')!;
    expect(field.samples).toEqual([uuid]);
  });

  it("keys a select field's counts by the raw option value but exposes optionLabels for display — including a 'link to a user' option whose value IS that user's id", async () => {
    const prisma = makePrismaStub();
    const userId = 'aba51f55-559d-4372-87a3-dcafe0b302eb';
    const definition = formDefinitionSchema.parse({
      title: 'user picker select',
      fields: [
        {
          key: 'owner',
          label: 'Owner',
          type: 'select',
          options: [
            { value: userId, label: 'Sam Reyes' },
            { value: 'other-team', label: 'Other Team' },
          ],
        },
      ],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    prisma.formSubmission.findMany.mockResolvedValue([
      { answers: { owner: userId }, createdAt: new Date() },
      { answers: { owner: userId }, createdAt: new Date() },
      { answers: { owner: 'other-team' }, createdAt: new Date() },
    ]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('user-picker-select');

    const owner = summary.fields.find((f) => f.key === 'owner')!;
    // counts stays keyed by the raw value — response-summary.tsx's click-to-filter
    // exact-matches this against the stored answer, so it must not become the label.
    expect(owner.counts).toEqual({ [userId]: 2, 'other-team': 1 });
    expect(owner.optionLabels).toEqual({ [userId]: 'Sam Reyes', 'other-team': 'Other Team' });
  });

  it("keys a performance_level field's counts by the raw level id and exposes optionLabels resolving it to that level's own label", async () => {
    const prisma = makePrismaStub();
    const levelId = 'aba51f55-559d-4372-87a3-dcafe0b302eb';
    const definition = formDefinitionSchema.parse({
      title: 'qc eval',
      fields: [{ key: 'level', label: 'Levels', type: 'performance_level' }],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    prisma.performanceLevel.findMany.mockResolvedValue([{ id: levelId, label: 'Associate Expert (Project Lead)' }]);
    prisma.formSubmission.findMany.mockResolvedValue([{ answers: { level: levelId }, createdAt: new Date() }]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const summary = await service.summary('qc-eval');

    const level = summary.fields.find((f) => f.key === 'level')!;
    expect(level.counts).toEqual({ [levelId]: 1 });
    expect(level.optionLabels).toEqual({ [levelId]: 'Associate Expert (Project Lead)' });
  });
});

describe('SubmissionsService.exportCsv', () => {
  it("resolves a 'person' field and a UUID-shaped text field to display names, leaving other cells alone", async () => {
    const prisma = makePrismaStub();
    const definition = formDefinitionSchema.parse({
      title: 'export repro',
      fields: [
        { key: 'evaluatee', label: 'Evaluatee', type: 'person' },
        { key: 'root_cause', label: 'Root Cause Analysis', type: 'short_text' },
        { key: 'notes', label: 'Notes', type: 'long_text' },
      ],
    });
    const forms = {
      getLatestVersion: vi.fn(async () => ({
        form: activeForm,
        version: { id: 'v1' },
        definition,
        settings: formSettingsSchema.parse({}),
      })),
    };
    const uuid = 'aba51f55-559d-4372-87a3-dcafe0b302eb';
    prisma.formSubmission.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        submittedBy: { email: 'respondent@pulse.local' },
        answers: { evaluatee: 'user-1', root_cause: uuid, notes: 'plain text' },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-1', displayName: 'Ana Ivanova' },
      { id: uuid, displayName: 'Sam Reyes' },
    ]);

    const service = new SubmissionsService(prisma as never, forms as never, turnstileStub as never);
    const csv = await service.exportCsv('export-repro', 'admin-1');

    const [header, row] = csv.split('\n');
    expect(header).toBe('submitted_at,submitted_by,respondent_name,respondent_email,evaluatee,root_cause,notes');
    expect(row).toBe('2026-01-01T00:00:00.000Z,respondent@pulse.local,,,Ana Ivanova,Sam Reyes,plain text');
  });
});
