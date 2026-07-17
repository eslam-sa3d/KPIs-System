import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KpiDashboardService } from './kpi-dashboard.service';
import { RbacService } from '../rbac/rbac.service';

function makeRedisStub() {
  return { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn() };
}

function makePrismaStub() {
  return {
    kpi: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    kpiAssignment: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    rolePermission: {
      // Default: unrestricted (an 'all'-scoped grant) — matches calling these
      // services directly in a test, bypassing the @RequirePermissions guard
      // that would otherwise guarantee the caller holds a real grant. Tests
      // exercising scope restriction override this per-case.
      findMany: vi.fn(async (): Promise<Array<{ scope: string; scopeValues?: string[] }>> => [{ scope: 'all' }]),
      findFirst: vi.fn(async (): Promise<{ roleId: string } | null> => null),
    },
    evaluationArea: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    subCriteria: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    evaluationAreaEntry: {
      findUnique: vi.fn(),
      // getTeamOverview always queries this now, to blend each member's
      // `score` (also powers the Performance-Level visibility gate) — []
      // by default so tests that don't care about it don't have to mock it.
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []) },
    form: {
      findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    },
    formKpiMapping: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    formSubmission: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      count: vi.fn(async (): Promise<number> => 0),
    },
    performanceLevel: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    scoreLabel: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    // Default: no row yet, i.e. unrestricted — every test that doesn't care
    // about the dashboard-form-scope filter gets every form's data, same as
    // before this concept existed. Tests exercising the filter override this.
    dashboardFormScope: { findUnique: vi.fn(async (): Promise<{ formIds: string[] } | null> => null), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
}

/** loadScoredSubmissions' fixtures — a single rating-type mapping on one
 *  form, reused across listMine/getTeamOverview/getPersonBreakdown/
 *  getMeasurementGaps/getRecentFeedback/getActivityTrend, which all read
 *  through it now instead of EvaluationAreaEntry directly. */
const ratingFormDefinition = {
  title: 'QA evaluation',
  fields: [{ key: 'score', label: 'Rating', type: 'rating', scale: 5, required: true }],
};

function mockOneMapping(prisma: ReturnType<typeof makePrismaStub>, overrides: Record<string, unknown> = {}) {
  const mapping = {
    id: 'mapping-1',
    formId: 'form-1',
    evaluationAreaId: 'area-1',
    evaluateeFieldKeys: [] as string[],
    scoreFieldKey: 'score',
    reviewType: 'peer',
    anonymous: false,
    contextFieldKey: null as string | null,
    commentFieldKey: null as string | null,
    evaluationArea: {
      id: 'area-1',
      name: 'Leadership',
      isActive: true,
      kpiId: 'kpi-1',
      kpi: { name: 'QA Lead Evaluation' },
    },
    ...overrides,
  };
  prisma.formKpiMapping.findMany.mockResolvedValue([mapping]);
  // A superset shape: satisfies loadScoredSubmissions' own {id, versions}
  // query, getMeasurementGaps' separate {slug, versions, kpiMappings:
  // {scoreFieldKey}} query, and loadRawActivity's {kpiMappings:
  // {evaluationArea: {isActive}}} query — all three go through this same
  // mocked fn, and a stub (unlike real Prisma) returns every field
  // regardless of `select`. `evaluationArea.isActive: true` here correctly
  // makes loadRawActivity treat this form as mapped (excluded from raw
  // activity), matching what mockOneMapping represents.
  prisma.form.findMany.mockResolvedValue([
    {
      id: 'form-1',
      slug: 'qa-form',
      status: 'published',
      versions: [{ definition: ratingFormDefinition }],
      kpiMappings: [{ scoreFieldKey: 'score', evaluationArea: { isActive: true } }],
    },
  ]);
  return mapping;
}

function submissionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    answers: { score: 4 },
    submittedById: 'evaluator-1',
    createdAt: new Date('2026-03-01T09:00:00Z'),
    formVersion: { formId: 'form-1' },
    ...overrides,
  };
}

function mockUsers(prisma: ReturnType<typeof makePrismaStub>, users: Array<Record<string, unknown>>) {
  prisma.user.findMany.mockResolvedValue(
    users.map((u) => ({ isActive: true, isKpiApplicable: true, displayName: 'Someone', ...u })),
  );
}

const activeKpi = { id: 'kpi-1', name: 'QA Lead Evaluation', isActive: true };
const activeArea = { id: 'area-1', kpiId: 'kpi-1', name: 'Leadership', cadence: 'quarterly', isActive: true };
const actorId = 'admin-1';

describe('KpiDashboardService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: KpiDashboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaStub();
    const rbac = new RbacService(prisma as never, makeRedisStub() as never);
    service = new KpiDashboardService(prisma as never, rbac, makeRedisStub() as never);
  });

  describe('listMine', () => {
    it('scopes to the caller roles and department — never client input', async () => {
      prisma.user.findUnique.mockResolvedValue({
        departmentId: 'dept-1',
        roles: [{ roleId: 'role-1' }, { roleId: 'role-2' }],
      });
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.listMine('user-1');

      expect(prisma.kpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            assignments: {
              some: {
                OR: [{ roleId: { in: ['role-1', 'role-2'] } }, { departmentId: 'dept-1' }],
              },
            },
          },
        }),
      );
    });

    it('omits the department clause for users without a department', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.listMine('user-1');

      const where = prisma.kpi.findMany.mock.calls[0]![0].where;
      expect(where.assignments.some.OR).toEqual([{ roleId: { in: [] } }]);
    });

    function kpiWithOneArea() {
      return [{ ...activeKpi, evaluationAreas: [{ ...activeArea, subCriteria: [] }] }];
    }

    it("includes each KPI's evaluation areas with their recent raw submissions", async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture()]);
      mockUsers(prisma, [
        { id: 'evaluator-1', displayName: 'Peer One' },
        { id: 'user-2', displayName: 'Evaluatee' },
      ]);

      const [kpi] = await service.listMine('user-1');

      const submission = kpi!.evaluationAreas[0]!.recentSubmissions[0]!;
      expect(submission.display).toBe('4/5');
      expect(submission.personName).toBe('Peer One'); // self-assessment: evaluateeFieldKeys unset
    });

    it('carries a normalized latestValue blended from EvaluationAreaEntry, for the status-strip widget', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        { evaluationAreaId: 'area-1', value: 3, periodStart: new Date('2026-02-01') },
        { evaluationAreaId: 'area-1', value: 5, periodStart: new Date('2026-02-01') },
      ]);

      const [kpi] = await service.listMine('user-1');

      expect(kpi!.latestValue).toBe(4);
    });

    it('reports latestValue as null when no legacy entry exists for any of its areas', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());

      const [kpi] = await service.listMine('user-1');

      expect(kpi!.latestValue).toBeNull();
    });

    it('withholds the evaluator on an anonymous mapping from a caller without kpis:manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());
      mockOneMapping(prisma, { anonymous: true, evaluateeFieldKeys: ['evaluatee'] });
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ answers: { score: 4, evaluatee: 'user-2' } }),
      ]);
      mockUsers(prisma, [
        { id: 'evaluator-1', displayName: 'Peer One' },
        { id: 'user-2', displayName: 'Evaluatee' },
      ]);
      prisma.rolePermission.findFirst.mockResolvedValue(null);

      const [kpi] = await service.listMine('user-1');

      const submission = kpi!.evaluationAreas[0]!.recentSubmissions[0]!;
      expect(submission.enteredById).toBe('');
      expect(submission.enteredBy).toEqual({ id: '', displayName: 'anonymous' });
    });

    it('reveals the evaluator on an anonymous mapping to a caller with kpis:manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());
      mockOneMapping(prisma, { anonymous: true, evaluateeFieldKeys: ['evaluatee'] });
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ answers: { score: 4, evaluatee: 'user-2' } }),
      ]);
      mockUsers(prisma, [
        { id: 'evaluator-1', displayName: 'Peer One' },
        { id: 'user-2', displayName: 'Evaluatee' },
      ]);
      prisma.rolePermission.findFirst.mockResolvedValue({ roleId: 'role-1' });

      const [kpi] = await service.listMine('user-1');

      const submission = kpi!.evaluationAreas[0]!.recentSubmissions[0]!;
      expect(submission.enteredById).toBe('evaluator-1');
      expect(submission.enteredBy.displayName).toBe('Peer One');
    });

    it('never withholds the evaluator on a non-anonymous mapping', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());
      mockOneMapping(prisma, { anonymous: false });
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture()]);
      mockUsers(prisma, [{ id: 'evaluator-1', displayName: 'Peer One' }]);
      prisma.rolePermission.findFirst.mockResolvedValue(null);

      const [kpi] = await service.listMine('user-1');

      expect(kpi!.evaluationAreas[0]!.recentSubmissions[0]!.enteredById).toBe('evaluator-1');
    });

    it("excludes a submission whose evaluatee is no longer isKpiApplicable, so they don't linger in the dashboard", async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneArea());
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture()]);
      mockUsers(prisma, [{ id: 'evaluator-1', displayName: 'Peer One', isKpiApplicable: false }]);

      const [kpi] = await service.listMine('user-1');

      expect(kpi!.evaluationAreas[0]!.recentSubmissions).toEqual([]);
    });
  });

  describe('getTeamOverview', () => {
    const coveredUser = {
      id: 'user-1',
      displayName: 'Covered User',
      email: 'covered@pulse.local',
      departmentId: null,
      department: null,
      roles: [{ roleId: 'role-1', role: { name: 'QA Engineer' } }],
    };
    const uncoveredUser = {
      id: 'user-2',
      displayName: 'Uncovered User',
      email: 'uncovered@pulse.local',
      departmentId: null,
      department: null,
      roles: [],
    };
    const coveringKpi = {
      assignments: [{ roleId: 'role-1', departmentId: null }],
      evaluationAreas: [{ id: 'area-1' }],
    };

    it('marks a user whose roles/department match no active KPI assignment as hasKpi: false', async () => {
      prisma.user.findMany.mockResolvedValue([uncoveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members).toEqual([
        expect.objectContaining({ id: 'user-2', hasKpi: false, latestSubmission: null, lastUpdated: null }),
      ]);
    });

    it('marks a covered user with no scored submissions as hasKpi: true with a null latestSubmission', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members).toEqual([
        expect.objectContaining({ id: 'user-1', hasKpi: true, latestSubmission: null, lastUpdated: null }),
      ]);
    });

    it("shows the person's single most recent submission, raw, on its own scale", async () => {
      // user.findMany backs both the roster query AND loadScoredSubmissions'
      // own evaluatee/evaluator lookup — one merged fixture satisfies both,
      // since a second .mockResolvedValue would just overwrite the first.
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ id: 'sub-old', submittedById: 'user-1', createdAt: new Date('2026-02-01T09:00:00Z') }),
        submissionFixture({
          id: 'sub-new',
          submittedById: 'user-1',
          answers: { score: 5 },
          createdAt: new Date('2026-03-01T09:00:00Z'),
        }),
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestSubmission).toEqual({
        raw: 5,
        display: '5/5',
        areaName: 'Leadership',
        kpiName: 'QA Lead Evaluation',
        submittedAt: new Date('2026-03-01T09:00:00Z').toISOString(),
      });
      expect(members[0]!.lastUpdated).toBe(new Date('2026-03-01T09:00:00Z').toISOString());
    });

    it('sets previousSubmission when the second-most-recent submission came through the same mapping', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({
          id: 'sub-old',
          submittedById: 'user-1',
          answers: { score: 2 },
          createdAt: new Date('2026-02-01T09:00:00Z'),
        }),
        submissionFixture({
          id: 'sub-new',
          submittedById: 'user-1',
          answers: { score: 5 },
          createdAt: new Date('2026-03-01T09:00:00Z'),
        }),
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.previousSubmission).toEqual({
        raw: 2,
        display: '2/5',
        submittedAt: new Date('2026-02-01T09:00:00Z').toISOString(),
      });
    });

    it('leaves previousSubmission null when there is only one submission yet', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ submittedById: 'user-1' })]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.previousSubmission).toBeNull();
    });

    it('treats a KPI assignment with no active evaluation areas as not covering anyone', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([{ ...coveringKpi, evaluationAreas: [] }]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.hasKpi).toBe(false);
    });

    it('surfaces department name and role names for the table', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, department: { name: 'Quality Assurance' } }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.department).toBe('Quality Assurance');
      expect(members[0]!.roles).toEqual(['QA Engineer']);
    });

    it('returns totalActiveUsers as the count of active users queried', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser, uncoveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);

      const { totalActiveUsers } = await service.getTeamOverview(actorId);

      expect(totalActiveUsers).toBe(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, isKpiApplicable: true } }),
      );
    });

    it("carries each member's blended score from EvaluationAreaEntry — the status cards' basis — regardless of Performance-Level gating", async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        { personId: 'user-1', evaluationAreaId: 'area-1', value: 3, periodStart: new Date('2026-02-01') },
        { personId: 'user-1', evaluationAreaId: 'area-1', value: 5, periodStart: new Date('2026-02-01') },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.score).toBe(4);
    });

    it('reports score as null for a member with no EvaluationAreaEntry rows', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.score).toBeNull();
    });

    it("takes a member's single most recent scored submission's value as latestScore — never sums or averages across submissions", async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      // rawFieldValue takes a rating field's raw answer as-is (no stretching
      // onto any common scale) — the newer submission (5) wins over the
      // older one (4); if this were summed it'd be 9.
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ id: 'sub-1', submittedById: 'user-1', answers: { score: 4 }, createdAt: new Date('2026-02-01T09:00:00Z') }),
        submissionFixture({ id: 'sub-2', submittedById: 'user-1', answers: { score: 5 }, createdAt: new Date('2026-03-01T09:00:00Z') }),
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(5);
    });

    it("matches latestScore against the configured Performance Level ranges (not score's fixed 0-5 bands)", async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ id: 'sub-1', submittedById: 'user-1', answers: { score: 4 }, createdAt: new Date('2026-02-01T09:00:00Z') }),
        submissionFixture({ id: 'sub-2', submittedById: 'user-1', answers: { score: 5 }, createdAt: new Date('2026-03-01T09:00:00Z') }),
      ]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-low', label: 'Needs work', minScore: 0, maxScore: 4 },
        { id: 'level-high', label: 'Outstanding', minScore: 5, maxScore: 10 },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(5);
      expect(members[0]!.performanceLevel).toEqual({ id: 'level-high', label: 'Outstanding' });
    });

    it('reports performanceLevel as null when latestScore falls in a gap between configured ranges', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ submittedById: 'user-1' })]);
      prisma.performanceLevel.findMany.mockResolvedValue([{ id: 'level-1', label: 'Outstanding', minScore: 10, maxScore: 20 }]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).not.toBeNull();
      expect(members[0]!.performanceLevel).toBeNull();
    });

    it('reports latestScore and performanceLevel as null for a member with no scored submissions', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBeNull();
      expect(members[0]!.performanceLevel).toBeNull();
    });

    it('never falls back to the legacy blended score for performanceLevel — stays null until a real latestScore exists', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      // Legacy EvaluationAreaEntry data exists (e.g. old seed data), but no
      // real FormKpiMapping/FormSubmission — performanceLevel must ignore it.
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        { personId: 'user-1', evaluationAreaId: 'area-1', value: 5, periodStart: new Date('2026-02-01') },
      ]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-1', label: 'Over-Achieved', minScore: 4, maxScore: 5 },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBeNull();
      expect(members[0]!.score).toBe(5);
      expect(members[0]!.performanceLevel).toBeNull();
    });

    it("matches the highest-minScore level a latestScore still meets, open-ended above the top range's maxScore", async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      // rating/scale-5 of 5 normalizes to 5 (see normalizeScore) — above
      // every configured range's maxScore (top range: 2.0-3.0).
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ submittedById: 'user-1', answers: { score: 5 } })]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-over', label: 'Over-Achieved', minScore: 2, maxScore: 3 },
        { id: 'level-achieved', label: 'Achieved', minScore: 1.1, maxScore: 1.9 },
        { id: 'level-under', label: 'Under Achieved', minScore: 0, maxScore: 1 },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(5);
      expect(members[0]!.performanceLevel).toEqual({ id: 'level-over', label: 'Over-Achieved' });
    });

    it('fills a gap between two configured ranges by rounding down to the lower one', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      // rawFieldValue sums a rating field's raw answer as-is — a raw of 2
      // sums to latestScore 2, inside the 1-3 gap between "Under Achieved"
      // (0-1) and "Achieved" (3-5).
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ submittedById: 'user-1', answers: { score: 2 } })]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-achieved', label: 'Achieved', minScore: 3, maxScore: 5 },
        { id: 'level-under', label: 'Under Achieved', minScore: 0, maxScore: 1 },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(2);
      expect(members[0]!.performanceLevel).toEqual({ id: 'level-under', label: 'Under Achieved' });
    });

    it('reports performanceLevel as null when latestScore is below every configured range', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ submittedById: 'user-1', answers: { score: 1 } })]);
      prisma.performanceLevel.findMany.mockResolvedValue([{ id: 'level-1', label: 'Achieved', minScore: 2, maxScore: 3 }]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(1);
      expect(members[0]!.performanceLevel).toBeNull();
    });

    it("sums a score_label field's exact configured score, unstretched, and matches it against a Performance Level range authored on that same scale", async () => {
      // The real-world scenario this feature is for: a score_label field
      // (Under Achieved=1, Achieved=2, Over-Achieved=3) and Performance
      // Levels authored on that same 0-3 scale — not the old 0-5 scale.
      const scoreLabelDefinition = {
        title: 'Sprint review',
        fields: [
          { key: 'evaluatee', label: 'Who', type: 'person' },
          { key: 'rating', label: 'Rating', type: 'score_label' },
        ],
      };
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.formKpiMapping.findMany.mockResolvedValue([
        {
          id: 'mapping-1',
          formId: 'form-1',
          evaluationAreaId: 'area-1',
          evaluateeFieldKeys: ['evaluatee'],
          scoreFieldKey: 'rating',
          reviewType: 'peer',
          anonymous: false,
          contextFieldKey: null,
          commentFieldKey: null,
          evaluationArea: { id: 'area-1', name: 'Leadership', isActive: true, kpiId: 'kpi-1', kpi: { name: 'QA Lead Evaluation' } },
        },
      ]);
      prisma.form.findMany.mockResolvedValue([
        {
          id: 'form-1',
          slug: 'sprint-review',
          status: 'published',
          versions: [{ definition: scoreLabelDefinition }],
          kpiMappings: [{ scoreFieldKey: 'rating', evaluationArea: { isActive: true } }],
        },
      ]);
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ id: 'sub-1', submittedById: 'user-1', answers: { evaluatee: 'user-1', rating: 'label-over' } }),
      ]);
      prisma.scoreLabel.findMany.mockResolvedValue([
        { id: 'label-under', label: 'Under Achieved', score: 1 },
        { id: 'label-achieved', label: 'Achieved', score: 2 },
        { id: 'label-over', label: 'Over-Achieved', score: 3 },
      ]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-over', label: 'Over-Achieved', minScore: 2, maxScore: 3 },
        { id: 'level-achieved', label: 'Achieved', minScore: 1.1, maxScore: 1.9 },
        { id: 'level-under', label: 'Under Achieved', minScore: 0, maxScore: 1 },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(3);
      expect(members[0]!.performanceLevel).toEqual({ id: 'level-over', label: 'Over-Achieved' });
    });

    it("restricts the roster to members whose own performanceLevel is one of the caller's allowed Performance Levels", async () => {
      const thirdUser = { ...coveredUser, id: 'user-3', displayName: 'Third User', isActive: true, isKpiApplicable: true };
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }, thirdUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'level', scopeValues: ['level-1'] }]);
      prisma.performanceLevel.findMany.mockResolvedValue([{ id: 'level-1', label: 'Outstanding', minScore: 4, maxScore: 5 }]);
      mockOneMapping(prisma);
      // user-1's latestScore (5) matches level-1 (4-5); user-3's (1) doesn't
      // — self-assessment submissions (mockOneMapping's default
      // evaluateeFieldKeys: []), so submittedById is the evaluatee.
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ id: 'sub-1', submittedById: 'user-1', answers: { score: 5 } }),
        submissionFixture({ id: 'sub-3', submittedById: 'user-3', answers: { score: 1 } }),
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members.map((m) => m.id)).toEqual(['user-1']);
      expect(members[0]!.latestScore).toBe(5);
      expect(members[0]!.performanceLevel).toEqual({ id: 'level-1', label: 'Outstanding' });
    });

    it('excludes an unranked or never-scored member even when the caller is otherwise unrestricted vs. restricted-to-nothing', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'level', scopeValues: [] }]);
      prisma.performanceLevel.findMany.mockResolvedValue([{ id: 'level-1', label: 'Outstanding', minScore: 4, maxScore: 5 }]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members).toEqual([]);
    });

    it('counts raw-activity submissions on unmapped forms, naming a person via a "select a user" option', async () => {
      // detectReferencedUserIds only treats a non-'person' field's answer as a
      // person reference when it's UUID-shaped (see UUID_PATTERN) — a real
      // user id, not the short 'user-1'-style ids used elsewhere in this
      // file, so this fixture needs its own UUID-shaped user.
      const uuidUserId = '11111111-1111-1111-1111-111111111111';
      const definition = {
        title: 'Sprint check-in',
        fields: [
          {
            key: 'team',
            label: 'Team member',
            type: 'select',
            options: [{ value: uuidUserId, label: 'Covered User', userId: uuidUserId }],
          },
          { key: 'note', label: 'Note', type: 'short_text' },
        ],
      };
      prisma.user.findMany.mockResolvedValue([
        { ...coveredUser, id: uuidUserId, isActive: true, isKpiApplicable: true },
      ]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      // Zero active-area mappings — genuinely unmapped, unlike mockOneMapping's form-1.
      prisma.form.findMany.mockResolvedValue([
        { id: 'form-2', slug: 'sprint-check-in', status: 'published', versions: [{ definition }], kpiMappings: [] },
      ]);
      prisma.formSubmission.count.mockResolvedValue(1);
      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-raw-1',
          answers: { team: uuidUserId, note: 'looking good' },
          submittedById: uuidUserId,
          createdAt: new Date('2026-03-01T09:00:00Z'),
          formVersion: { formId: 'form-2' },
        },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.rawActivityCount).toBe(1);
    });

    it('folds a score_label answer on a form with NO KPI mapping into latestScore — a real answer counts with no mapping required', async () => {
      const uuidUserId = '33333333-3333-3333-3333-333333333333';
      const definition = {
        title: 'Sprint check-in',
        fields: [
          { key: 'team', label: 'Team member', type: 'person' },
          { key: 'rating', label: 'Rating', type: 'score_label' },
        ],
      };
      prisma.user.findMany.mockResolvedValue([
        { ...coveredUser, id: uuidUserId, isActive: true, isKpiApplicable: true },
      ]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      // Zero active-area mappings — genuinely unmapped.
      prisma.form.findMany.mockResolvedValue([
        { id: 'form-2', slug: 'sprint-check-in', status: 'published', versions: [{ definition }], kpiMappings: [] },
      ]);
      prisma.formSubmission.count.mockResolvedValue(1);
      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-raw-1',
          answers: { team: uuidUserId, rating: 'label-over' },
          submittedById: uuidUserId,
          createdAt: new Date('2026-03-01T09:00:00Z'),
          formVersion: { formId: 'form-2' },
        },
      ]);
      prisma.scoreLabel.findMany.mockResolvedValue([{ id: 'label-over', label: 'Over-Achieved', score: 3 }]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-over', label: 'Over-Achieved', minScore: 2, maxScore: 3 },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestScore).toBe(3);
      expect(members[0]!.performanceLevel).toEqual({ id: 'level-over', label: 'Over-Achieved' });
    });

    it('excludes a form with an active KPI mapping from raw-activity counts', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma); // form-1: kpiMappings: [{ evaluationArea: { isActive: true } }]

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.rawActivityCount).toBe(0);
    });

    it('prefers an unmapped-form scoreable answer over an older KPI-mapped scored submission for latestScore — never sums the two', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma); // form-1 mapped, rating field, scored submission below answers 4, dated Jan 1 (older)
      prisma.formSubmission.count.mockResolvedValue(1);
      // form-1 is mapped so loadScoredSubmissions sees it; form-2 is
      // unmapped so loadRawActivity sees it — args shape, not call order,
      // tells the mock which path is asking (see the "prefers the more
      // recent" lastUpdated test above for why).
      const rawDefinition = {
        title: 'Check-in',
        fields: [
          { key: 'team', label: 'Team', type: 'person' },
          { key: 'rating', label: 'Rating', type: 'score_label' },
        ],
      };
      prisma.form.findMany.mockImplementation(async (args: { where?: { status?: string } } = {}) => {
        if (args.where?.status === 'published') {
          return [
            { id: 'form-2', slug: 'check-in', status: 'published', versions: [{ definition: rawDefinition }], kpiMappings: [] },
          ];
        }
        return [{ id: 'form-1', versions: [{ definition: ratingFormDefinition }] }];
      });
      prisma.formSubmission.findMany.mockImplementation(
        async (args: { where?: { formVersion?: { formId?: { in?: string[] } } } } = {}) => {
          const formIds = args.where?.formVersion?.formId?.in ?? [];
          if (formIds.includes('form-2')) {
            return [
              {
                id: 'sub-raw-1',
                answers: { team: 'user-1', rating: 'label-1' },
                submittedById: 'user-1',
                createdAt: new Date('2026-03-01T09:00:00Z'),
                formVersion: { formId: 'form-2' },
              },
            ];
          }
          return [
            submissionFixture({ submittedById: 'user-1', answers: { score: 4 }, createdAt: new Date('2026-01-01T09:00:00Z') }),
          ];
        },
      );
      prisma.scoreLabel.findMany.mockResolvedValue([{ id: 'label-1', label: 'On track', score: 2 }]);

      const { members } = await service.getTeamOverview(actorId);

      // The unmapped form's score_label answer (2, dated Mar 1) is more
      // recent than the scored submission (4, dated Jan 1) — if this
      // summed the two it'd be 6.
      expect(members[0]!.latestScore).toBe(2);
    });

    it('reports lastUpdated from raw activity when a member has no scored submission at all', async () => {
      const uuidUserId = '22222222-2222-2222-2222-222222222222';
      const definition = {
        title: 'Sprint check-in',
        fields: [{ key: 'team', label: 'Team member', type: 'person' }],
      };
      prisma.user.findMany.mockResolvedValue([
        { ...coveredUser, id: uuidUserId, isActive: true, isKpiApplicable: true },
      ]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.form.findMany.mockResolvedValue([
        { id: 'form-2', slug: 'sprint-check-in', status: 'published', versions: [{ definition }], kpiMappings: [] },
      ]);
      prisma.formSubmission.count.mockResolvedValue(1);
      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-raw-1',
          answers: { team: uuidUserId },
          submittedById: uuidUserId,
          createdAt: new Date('2026-03-05T09:00:00Z'),
          formVersion: { formId: 'form-2' },
        },
      ]);

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.latestSubmission).toBeNull();
      expect(members[0]!.lastUpdated).toBe('2026-03-05T09:00:00.000Z');
    });

    it('prefers the more recent of a scored submission and a raw-activity one for lastUpdated', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, isActive: true, isKpiApplicable: true }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      mockOneMapping(prisma); // form-1: mapped, scored submission below dated Jan 1
      prisma.formSubmission.count.mockResolvedValue(1);
      // loadScoredSubmissions queries by {id: {in: formIds}} with no status
      // filter; loadRawActivity queries {status: 'published', ...} — args
      // shape, not call order, tells the mock which path is asking, since
      // both loadScoredSubmissions and loadRawActivity run inside the same
      // Promise.all and their DB calls can interleave.
      const rawDefinition = { title: 'Check-in', fields: [{ key: 'team', label: 'Team', type: 'person' }] };
      prisma.form.findMany.mockImplementation(async (args: { where?: { status?: string } } = {}) => {
        if (args.where?.status === 'published') {
          return [
            { id: 'form-2', slug: 'check-in', status: 'published', versions: [{ definition: rawDefinition }], kpiMappings: [] },
          ];
        }
        return [{ id: 'form-1', versions: [{ definition: ratingFormDefinition }] }];
      });
      prisma.formSubmission.findMany.mockImplementation(
        async (args: { where?: { formVersion?: { formId?: { in?: string[] } } } } = {}) => {
          const formIds = args.where?.formVersion?.formId?.in ?? [];
          if (formIds.includes('form-2')) {
            return [
              {
                id: 'sub-raw-1',
                answers: { team: 'user-1' },
                submittedById: 'user-1',
                createdAt: new Date('2026-02-15T09:00:00Z'),
                formVersion: { formId: 'form-2' },
              },
            ];
          }
          return [submissionFixture({ submittedById: 'user-1', createdAt: new Date('2026-01-01T09:00:00Z') })];
        },
      );

      const { members } = await service.getTeamOverview(actorId);

      expect(members[0]!.lastUpdated).toBe('2026-02-15T09:00:00.000Z');
    });
  });

  describe('getPersonBreakdown', () => {
    const person = { id: 'user-2', displayName: 'Evaluatee', departmentId: null, roles: [] };

    it('rejects an unknown person', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getPersonBreakdown('ghost', actorId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("returns the person's own scored submissions, most recent first, raw", async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([{ evaluationAreas: [{ id: 'area-1' }] }]);
      mockOneMapping(prisma, { evaluateeFieldKeys: ['evaluatee'] });
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({
          id: 'sub-old',
          answers: { score: 2, evaluatee: 'user-2' },
          createdAt: new Date('2026-02-01T09:00:00Z'),
        }),
        submissionFixture({
          id: 'sub-new',
          answers: { score: 5, evaluatee: 'user-2' },
          createdAt: new Date('2026-03-01T09:00:00Z'),
        }),
      ]);
      mockUsers(prisma, [
        { id: 'user-2', displayName: 'Evaluatee' },
        { id: 'evaluator-1', displayName: 'Rater One' },
      ]);

      const breakdown = await service.getPersonBreakdown('user-2', actorId);

      expect(breakdown.personId).toBe('user-2');
      expect(breakdown.displayName).toBe('Evaluatee');
      expect(breakdown.submissions).toEqual([
        expect.objectContaining({ raw: 5, display: '5/5', kpiId: 'kpi-1', areaId: 'area-1' }),
        expect.objectContaining({ raw: 2, display: '2/5' }),
      ]);
    });

    it('returns an empty feed when the person has never been scored', async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([{ evaluationAreas: [{ id: 'area-1' }] }]);

      const breakdown = await service.getPersonBreakdown('user-2', actorId);

      expect(breakdown.submissions).toEqual([]);
      expect(breakdown.latestScore).toBeNull();
      expect(breakdown.performanceLevel).toBeNull();
    });

    it('never falls back to the legacy blended score for performanceLevel — stays null until a real latestScore exists', async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([{ evaluationAreas: [{ id: 'area-1' }] }]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        { personId: 'user-2', evaluationAreaId: 'area-1', value: 5, periodStart: new Date('2026-02-01') },
      ]);
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'level-1', label: 'Over-Achieved', minScore: 4, maxScore: 5 },
      ]);

      const breakdown = await service.getPersonBreakdown('user-2', actorId);

      expect(breakdown.latestScore).toBeNull();
      expect(breakdown.performanceLevel).toBeNull();
    });

    it("takes this person's single most recent scored submission's value as latestScore — never sums or averages", async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([{ evaluationAreas: [{ id: 'area-1' }] }]);
      mockOneMapping(prisma, { evaluateeFieldKeys: ['evaluatee'] });
      // rawFieldValue takes a rating field's raw answer as-is — the newer
      // submission (5) wins over the older one (2); if this summed the two
      // it'd be 7.
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({
          id: 'sub-old',
          answers: { score: 2, evaluatee: 'user-2' },
          createdAt: new Date('2026-01-01T09:00:00Z'),
        }),
        submissionFixture({
          id: 'sub-new',
          answers: { score: 5, evaluatee: 'user-2' },
          createdAt: new Date('2026-03-01T09:00:00Z'),
        }),
      ]);
      mockUsers(prisma, [
        { id: 'user-2', displayName: 'Evaluatee' },
        { id: 'evaluator-1', displayName: 'Rater One' },
      ]);
      prisma.performanceLevel.findMany.mockResolvedValue([{ id: 'level-1', label: 'On track', minScore: 5, maxScore: 10 }]);

      const breakdown = await service.getPersonBreakdown('user-2', actorId);

      expect(breakdown.latestScore).toBe(5);
      expect(breakdown.performanceLevel).toEqual({ id: 'level-1', label: 'On track' });
    });

    it('withholds the evaluator on an anonymous mapping from a caller without kpis:manage', async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([{ evaluationAreas: [{ id: 'area-1' }] }]);
      mockOneMapping(prisma, { anonymous: true, evaluateeFieldKeys: ['evaluatee'] });
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({ answers: { score: 4, evaluatee: 'user-2' } }),
      ]);
      mockUsers(prisma, [
        { id: 'user-2', displayName: 'Evaluatee' },
        { id: 'evaluator-1', displayName: 'Rater One' },
      ]);
      prisma.rolePermission.findFirst.mockResolvedValue(null);

      const breakdown = await service.getPersonBreakdown('user-2', actorId);

      expect(breakdown.submissions[0]).toMatchObject({ anonymous: true, evaluatorName: 'anonymous' });
    });

    it('scopes the query to KPIs covering the selected person, not the caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...person, departmentId: 'dept-1', roles: [{ roleId: 'role-1' }] });
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.getPersonBreakdown('user-2', actorId);

      expect(prisma.kpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            assignments: { some: { OR: [{ roleId: { in: ['role-1'] } }, { departmentId: 'dept-1' }] } },
          },
        }),
      );
    });

    it("lists the person's raw-activity submissions from unmapped forms, with every answer formatted", async () => {
      // detectReferencedUserIds only treats a non-'person' field's answer as a
      // person reference when it's UUID-shaped (see UUID_PATTERN) — a real
      // user id, not the short 'user-2'-style id used elsewhere in this file.
      const uuidUserId = '22222222-2222-2222-2222-222222222222';
      const definition = {
        title: 'Sprint check-in',
        fields: [
          {
            key: 'team',
            label: 'Team member',
            type: 'select',
            options: [{ value: uuidUserId, label: 'Evaluatee', userId: uuidUserId }],
          },
          { key: 'note', label: 'Note', type: 'short_text' },
        ],
      };
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([{ evaluationAreas: [{ id: 'area-1' }] }]);
      prisma.form.findMany.mockResolvedValue([
        { id: 'form-2', slug: 'sprint-check-in', status: 'published', versions: [{ definition }], kpiMappings: [] },
      ]);
      prisma.formSubmission.count.mockResolvedValue(1);
      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-raw-1',
          answers: { team: uuidUserId, note: 'looking good' },
          submittedById: 'user-1',
          createdAt: new Date('2026-03-01T09:00:00Z'),
          formVersion: { formId: 'form-2' },
        },
      ]);
      mockUsers(prisma, [
        { id: 'user-1', displayName: 'Rater One' },
        { id: uuidUserId, displayName: 'Evaluatee' },
      ]);

      const breakdown = await service.getPersonBreakdown(uuidUserId, actorId);

      expect(breakdown.rawActivity).toEqual([
        {
          formId: 'form-2',
          formSlug: 'sprint-check-in',
          formTitle: 'Sprint check-in',
          submittedByName: 'Rater One',
          submissionId: 'sub-raw-1',
          submittedAt: '2026-03-01T09:00:00.000Z',
          answers: [
            { fieldKey: 'team', fieldLabel: 'Team member', display: 'Evaluatee' },
            { fieldKey: 'note', fieldLabel: 'Note', display: 'looking good' },
          ],
        },
      ]);
    });
  });

  describe('getMeasurementGaps', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    it('flags a score-eligible question with no FormKpiMapping, and excludes one already mapped', async () => {
      prisma.form.findMany.mockResolvedValue([
        {
          slug: 'sprint-check',
          versions: [
            {
              definition: {
                title: 'Sprint check',
                fields: [
                  { key: 'confidence', label: 'Confidence', type: 'rating' },
                  { key: 'velocity', label: 'Velocity', type: 'number' },
                ],
              },
            },
          ],
          kpiMappings: [{ scoreFieldKey: 'velocity' }],
        },
      ]);
      prisma.kpi.findMany.mockResolvedValue([]);

      const { unmappedQuestions } = await service.getMeasurementGaps();

      expect(unmappedQuestions.total).toBe(1);
      expect(unmappedQuestions.items).toEqual([
        { formSlug: 'sprint-check', formTitle: 'Sprint check', fieldKey: 'confidence', fieldLabel: 'Confidence' },
      ]);
    });

    it('ignores field types that can never be a score (e.g. short_text, section_header)', async () => {
      prisma.form.findMany.mockResolvedValue([
        {
          slug: 'sprint-check',
          versions: [
            {
              definition: {
                title: 'Sprint check',
                fields: [
                  { key: 'notes', label: 'Notes', type: 'short_text' },
                  { key: 'heading', label: 'Section', type: 'section_header' },
                ],
              },
            },
          ],
          kpiMappings: [],
        },
      ]);
      prisma.kpi.findMany.mockResolvedValue([]);

      const { unmappedQuestions } = await service.getMeasurementGaps();

      expect(unmappedQuestions.total).toBe(0);
    });

    it('skips a form with no published version yet', async () => {
      prisma.form.findMany.mockResolvedValue([{ slug: 'draft-form', versions: [], kpiMappings: [] }]);
      prisma.kpi.findMany.mockResolvedValue([]);

      const { unmappedQuestions } = await service.getMeasurementGaps();

      expect(unmappedQuestions.total).toBe(0);
    });

    it('flags a weekly-cadence area whose last submission is well past its grace period', async () => {
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'Delivery',
          evaluationAreas: [{ id: 'area-1', name: 'Sprint velocity', cadence: 'weekly' }],
        },
      ]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ createdAt: daysAgo(30) })]);
      mockUsers(prisma, [{ id: 'evaluator-1', displayName: 'Rater One' }]);

      const { staleAreas } = await service.getMeasurementGaps();

      expect(staleAreas.total).toBe(1);
      expect(staleAreas.items[0]).toMatchObject({ kpiId: 'kpi-1', areaId: 'area-1', cadence: 'weekly' });
    });

    it('does not flag an area scored within its own cadence grace period', async () => {
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'Annual review',
          evaluationAreas: [{ id: 'area-1', name: 'Leadership', cadence: 'yearly' }],
        },
      ]);
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture({ createdAt: daysAgo(30) })]);
      mockUsers(prisma, [{ id: 'evaluator-1', displayName: 'Rater One' }]);

      const { staleAreas } = await service.getMeasurementGaps();

      expect(staleAreas.total).toBe(0);
    });

    it('flags an area never scored at all as stale, with lastScoredAt null', async () => {
      prisma.kpi.findMany.mockResolvedValue([
        { id: 'kpi-1', name: 'New KPI', evaluationAreas: [{ id: 'area-1', name: 'Quality', cadence: 'monthly' }] },
      ]);

      const { staleAreas } = await service.getMeasurementGaps();

      expect(staleAreas.items[0]).toMatchObject({ lastScoredAt: null });
    });
  });

  describe('getRecentFeedback', () => {
    function mockFeedbackSubmission(overrides: Record<string, unknown> = {}) {
      mockOneMapping(prisma, { contextFieldKey: 'level', commentFieldKey: 'comment', ...overrides });
      prisma.formSubmission.findMany.mockResolvedValue([
        submissionFixture({
          answers: { score: 4, level: 'Senior', comment: 'Great communication this quarter.' },
          createdAt: new Date('2026-03-01T09:00:00Z'),
        }),
      ]);
      mockUsers(prisma, [
        { id: 'evaluator-1', displayName: 'Rater One' },
        { id: 'user-1', displayName: 'Evaluatee' },
      ]);
    }

    it('maps submissions into the digest shape, only ones with a context or comment answer', async () => {
      mockFeedbackSubmission();

      const { entries } = await service.getRecentFeedback();

      expect(entries).toEqual([
        {
          id: 'sub-1-mapping-1',
          kpiId: 'kpi-1',
          kpiName: 'QA Lead Evaluation',
          areaName: 'Leadership',
          // self-assessment (evaluateeFieldKeys unset): submitter scores themselves
          personName: 'Rater One',
          evaluatorName: 'Rater One',
          anonymous: false,
          display: '4/5',
          context: 'Senior',
          comment: 'Great communication this quarter.',
          createdAt: '2026-03-01T09:00:00.000Z',
        },
      ]);
    });

    it('excludes a submission with no context or comment answer', async () => {
      mockOneMapping(prisma);
      prisma.formSubmission.findMany.mockResolvedValue([submissionFixture()]);
      mockUsers(prisma, [{ id: 'evaluator-1', displayName: 'Rater One' }]);

      const { entries } = await service.getRecentFeedback();

      expect(entries).toEqual([]);
    });

    it('never withholds the evaluator identity, even on an anonymous mapping — dashboards:view already sees it', async () => {
      mockFeedbackSubmission({ anonymous: true });

      const { entries } = await service.getRecentFeedback();

      expect(entries[0]).toMatchObject({ anonymous: true, evaluatorName: 'Rater One' });
    });

    it('scopes to one KPI when kpiId is passed', async () => {
      mockFeedbackSubmission();

      const { entries } = await service.getRecentFeedback('some-other-kpi');

      expect(entries).toEqual([]);
    });
  });

  describe('getActivityTrend', () => {
    beforeEach(() => {
      // A known Wednesday, so "this week"'s Monday is unambiguous.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
      prisma.formKpiMapping.findMany.mockResolvedValue([{ formId: 'form-1' }]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns exactly ACTIVITY_TREND_WEEKS points, oldest first, ending on the current week', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([]);

      const { points } = await service.getActivityTrend();

      expect(points).toHaveLength(12);
      expect(points[0]!.weekStart).toBe('2025-12-22');
      expect(points[11]!.weekStart).toBe('2026-03-09'); // Monday of the current week
    });

    it('buckets submissions by the Monday of their own week, and counts every one that week', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([
        { createdAt: new Date('2026-03-09T08:00:00Z') }, // Monday of current week
        { createdAt: new Date('2026-03-11T20:00:00Z') }, // Wednesday, same week
        { createdAt: new Date('2026-03-02T09:00:00Z') }, // previous week
      ]);

      const { points } = await service.getActivityTrend();

      expect(points.find((p) => p.weekStart === '2026-03-09')?.count).toBe(2);
      expect(points.find((p) => p.weekStart === '2026-03-02')?.count).toBe(1);
    });

    it('reports 0, not an omitted point, for a week with no activity', async () => {
      prisma.formSubmission.findMany.mockResolvedValue([]);

      const { points } = await service.getActivityTrend();

      expect(points.every((p) => p.count === 0)).toBe(true);
    });

    it("queries only submissions within the window's earliest week, to KPI-mapped forms", async () => {
      prisma.formSubmission.findMany.mockResolvedValue([]);

      await service.getActivityTrend();

      expect(prisma.formSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            formVersion: { formId: { in: ['form-1'] } },
            createdAt: { gte: new Date('2025-12-22T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('returns no points-worth of activity when no form is KPI-mapped, without querying submissions', async () => {
      prisma.formKpiMapping.findMany.mockResolvedValue([]);

      const { points } = await service.getActivityTrend();

      expect(prisma.formSubmission.findMany).not.toHaveBeenCalled();
      expect(points.every((p) => p.count === 0)).toBe(true);
    });
  });
});
