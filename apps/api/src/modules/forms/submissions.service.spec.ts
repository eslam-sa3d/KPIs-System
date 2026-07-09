import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema, formSettingsSchema } from '@pulse/contracts';
import { SubmissionsService } from './submissions.service';

const activeForm = { id: 'form-1', publicToken: null };

function makePrismaStub() {
  return {
    formSubmission: {
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'sub-new', ...data })),
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
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as () => unknown)(),
    ),
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
    const service = new SubmissionsService(prisma as never, forms as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when the form is not accepting responses', async () => {
    const forms = makeFormsStub({ acceptingResponses: false });
    const service = new SubmissionsService(prisma as never, forms as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects before the scheduled open date', async () => {
    const forms = makeFormsStub({ opensAt: new Date(Date.now() + 86_400_000).toISOString() });
    const service = new SubmissionsService(prisma as never, forms as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects after the scheduled close date', async () => {
    const forms = makeFormsStub({ closesAt: new Date(Date.now() - 86_400_000).toISOString() });
    const service = new SubmissionsService(prisma as never, forms as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('enforces one-response-per-user when a prior submission exists', async () => {
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'existing' });
    const forms = makeFormsStub({ oneResponsePerUser: true });
    const service = new SubmissionsService(prisma as never, forms as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('skips one-response-per-user for an anonymous submission with no fingerprint', async () => {
    const forms = makeFormsStub({ oneResponsePerUser: true });
    const service = new SubmissionsService(prisma as never, forms as never);
    await service.submitPublic('tok', { team: 'x' }, null);
    expect(prisma.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(prisma.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ submittedById: null, respondentFingerprint: null }),
    });
  });

  it('enforces one-response-per-user for anonymous submissions via their cookie fingerprint', async () => {
    prisma.formSubmission.findFirst.mockResolvedValue({ id: 'existing' });
    const forms = makeFormsStub({ oneResponsePerUser: true });
    const service = new SubmissionsService(prisma as never, forms as never);
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
    const service = new SubmissionsService(prisma as never, forms as never);
    await expect(service.submit('demo', { team: 'x' }, 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('accepts submissions below maxResponses', async () => {
    prisma.formSubmission.count.mockResolvedValue(2);
    const forms = makeFormsStub({ maxResponses: 3 });
    const service = new SubmissionsService(prisma as never, forms as never);
    await service.submit('demo', { team: 'x' }, 'user-1');
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
    const service = new SubmissionsService(prisma as never, makeFileFormsStub() as never);
    await expect(service.submit('attach-a-receipt', { receipt: 'upload-x' }, 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.formSubmission.create).not.toHaveBeenCalled();
  });

  it('accepts a file answer that resolves to a real upload, and links it to the new submission', async () => {
    const prisma = makePrismaStub();
    prisma.formFileUpload.findMany.mockResolvedValue([{ id: 'upload-x' }]);
    const service = new SubmissionsService(prisma as never, makeFileFormsStub() as never);
    await service.submit('attach-a-receipt', { receipt: 'upload-x' }, 'user-1');
    expect(prisma.formSubmission.create).toHaveBeenCalledTimes(1);
    expect(prisma.formFileUpload.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['upload-x'] } },
      data: { submissionId: 'sub-new' },
    });
  });
});

describe('SubmissionsService.deleteAllSubmissions', () => {
  it('deletes every submission on the current version and audit-logs the count', async () => {
    const prisma = makePrismaStub();
    prisma.formSubmission.deleteMany.mockResolvedValue({ count: 7 });
    const forms = makeFormsStub();
    const service = new SubmissionsService(prisma as never, forms as never);

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

    const service = new SubmissionsService(prisma as never, forms as never);
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
  });
});
