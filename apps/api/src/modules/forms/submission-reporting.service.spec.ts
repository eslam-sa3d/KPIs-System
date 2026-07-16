import { describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema, formSettingsSchema } from '@pulse/contracts';
import { SubmissionReportingService } from './submission-reporting.service';

const activeForm = { id: 'form-1', slug: 'demo', publicToken: null };

function makePrismaStub() {
  return {
    formSubmission: {
      findMany: vi.fn(),
      count: vi.fn(async (): Promise<number> => 0),
    },
    user: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    performanceLevel: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    auditLog: { create: vi.fn() },
  };
}

describe('SubmissionReportingService.summary', () => {
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
    const summary = await service.summary('qc-eval');

    const level = summary.fields.find((f) => f.key === 'level')!;
    expect(level.counts).toEqual({ [levelId]: 1 });
    expect(level.optionLabels).toEqual({ [levelId]: 'Associate Expert (Project Lead)' });
  });
});

describe('SubmissionReportingService.exportCsv', () => {
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

    const service = new SubmissionReportingService(prisma as never, forms as never);
    const csv = await service.exportCsv('export-repro', 'admin-1');

    const [header, row] = csv.split('\n');
    expect(header).toBe('submitted_at,submitted_by,respondent_name,respondent_email,evaluatee,root_cause,notes');
    expect(row).toBe('2026-01-01T00:00:00.000Z,respondent@pulse.local,,,Ana Ivanova,Sam Reyes,plain text');
  });
});
