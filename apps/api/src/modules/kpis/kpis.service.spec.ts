import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordEvaluationAreaEntrySchema } from '@pulse/contracts';
import { KpisService } from './kpis.service';
import { RbacService } from '../rbac/rbac.service';

function makeRedisStub() {
  return { get: vi.fn(), set: vi.fn(), del: vi.fn() };
}

function makePrismaStub() {
  return {
    kpi: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    kpiAssignment: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    rolePermission: { findMany: vi.fn(), findFirst: vi.fn(async (): Promise<{ roleId: string } | null> => null) },
    evaluationArea: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    subCriteria: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    evaluationAreaEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    form: {
      findMany: vi.fn(
        async (): Promise<
          Array<{
            slug: string;
            versions: Array<{ definition: unknown }>;
            kpiMappings: Array<{ scoreFieldKey: string }>;
          }>
        > => [],
      ),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
}

const activeKpi = { id: 'kpi-1', name: 'QA Lead Evaluation', isActive: true };
const activeArea = { id: 'area-1', kpiId: 'kpi-1', name: 'Leadership', cadence: 'quarterly', isActive: true };
const evaluatee = { id: 'user-2', displayName: 'Evaluatee', email: 'evaluatee@pulse.local' };
const actorId = 'admin-1';

describe('KpisService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: KpisService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaStub();
    const rbac = new RbacService(prisma as never, makeRedisStub() as never);
    service = new KpisService(prisma as never, rbac);
  });

  describe('createKpi', () => {
    it('creates and audit-logs a new KPI', async () => {
      prisma.kpi.create.mockResolvedValue(activeKpi);

      await service.createKpi({ name: 'QA Lead Evaluation' }, actorId);

      expect(prisma.kpi.create).toHaveBeenCalledWith({ data: { name: 'QA Lead Evaluation' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'kpi.created', entityId: 'kpi-1' }),
      });
    });

    it('passes weight straight through to Prisma when provided', async () => {
      prisma.kpi.create.mockResolvedValue({ ...activeKpi, weight: 25 });

      await service.createKpi({ name: 'QA Lead Evaluation', weight: 25 }, actorId);

      expect(prisma.kpi.create).toHaveBeenCalledWith({ data: { name: 'QA Lead Evaluation', weight: 25 } });
    });
  });

  describe('updateKpi', () => {
    it('updates an existing KPI and audit-logs it', async () => {
      prisma.kpi.findUnique.mockResolvedValue(activeKpi);
      prisma.kpi.update.mockResolvedValue({ ...activeKpi, name: 'Renamed' });

      await service.updateKpi('kpi-1', { name: 'Renamed' }, actorId);

      expect(prisma.kpi.update).toHaveBeenCalledWith({ where: { id: 'kpi-1' }, data: { name: 'Renamed' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'kpi.updated', entityId: 'kpi-1' }),
      });
    });

    it('rejects an unknown KPI', async () => {
      prisma.kpi.findUnique.mockResolvedValue(null);
      await expect(service.updateKpi('ghost', { name: 'x' }, actorId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.kpi.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteKpi', () => {
    it('hard-deletes a KPI with no recorded entries, and audit-logs it', async () => {
      prisma.kpi.findUnique.mockResolvedValue({
        ...activeKpi,
        evaluationAreas: [{ _count: { entries: 0 } }, { _count: { entries: 0 } }],
      });

      await service.deleteKpi('kpi-1', actorId);

      expect(prisma.kpi.delete).toHaveBeenCalledWith({ where: { id: 'kpi-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'kpi.deleted', entityId: 'kpi-1' }),
      });
    });

    it('rejects deleting a KPI that has recorded entries', async () => {
      prisma.kpi.findUnique.mockResolvedValue({
        ...activeKpi,
        evaluationAreas: [{ _count: { entries: 3 } }],
      });

      await expect(service.deleteKpi('kpi-1', actorId)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.kpi.delete).not.toHaveBeenCalled();
    });

    it('force-deletes a KPI with recorded entries and audit-logs the destroyed count', async () => {
      prisma.kpi.findUnique.mockResolvedValue({
        ...activeKpi,
        evaluationAreas: [{ _count: { entries: 3 } }, { _count: { entries: 2 } }],
      });

      await service.deleteKpi('kpi-1', actorId, true);

      expect(prisma.kpi.delete).toHaveBeenCalledWith({ where: { id: 'kpi-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId,
          action: 'kpi.force_deleted',
          entityId: 'kpi-1',
          detail: expect.objectContaining({ destroyedEntryCount: 5 }),
        }),
      });
    });

    it('force=true on a KPI with no recorded entries behaves like a normal delete', async () => {
      prisma.kpi.findUnique.mockResolvedValue({
        ...activeKpi,
        evaluationAreas: [{ _count: { entries: 0 } }],
      });

      await service.deleteKpi('kpi-1', actorId, true);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'kpi.deleted' }),
      });
    });

    it('rejects an unknown KPI', async () => {
      prisma.kpi.findUnique.mockResolvedValue(null);
      await expect(service.deleteKpi('ghost', actorId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.kpi.delete).not.toHaveBeenCalled();
    });
  });

  describe('createEvaluationArea / updateEvaluationArea / deleteEvaluationArea', () => {
    it('creates an area under an existing KPI and audit-logs it', async () => {
      prisma.kpi.findUnique.mockResolvedValue(activeKpi);
      prisma.evaluationArea.create.mockResolvedValue(activeArea);

      await service.createEvaluationArea('kpi-1', { name: 'Leadership', cadence: 'quarterly' }, actorId);

      expect(prisma.evaluationArea.create).toHaveBeenCalledWith({
        data: { kpiId: 'kpi-1', name: 'Leadership', cadence: 'quarterly' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'evaluation_area.created', entityId: 'area-1' }),
      });
    });

    it('rejects creating an area under an unknown KPI', async () => {
      prisma.kpi.findUnique.mockResolvedValue(null);
      await expect(
        service.createEvaluationArea('ghost', { name: 'x', cadence: 'weekly' }, actorId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('updates an area scoped to its KPI and audit-logs it', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(activeArea);
      await service.updateEvaluationArea('kpi-1', 'area-1', { isActive: false }, actorId);
      expect(prisma.evaluationArea.findFirst).toHaveBeenCalledWith({ where: { id: 'area-1', kpiId: 'kpi-1' } });
      expect(prisma.evaluationArea.update).toHaveBeenCalledWith({
        where: { id: 'area-1' },
        data: { isActive: false },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'evaluation_area.updated', entityId: 'area-1' }),
      });
    });

    it('rejects updating an area that does not belong to the given KPI', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(null);
      await expect(service.updateEvaluationArea('other-kpi', 'area-1', { name: 'x' }, actorId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('hard-deletes an area with no recorded entries, and audit-logs it', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue({ ...activeArea, _count: { entries: 0 } });
      await service.deleteEvaluationArea('kpi-1', 'area-1', actorId);
      expect(prisma.evaluationArea.delete).toHaveBeenCalledWith({ where: { id: 'area-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'evaluation_area.deleted', entityId: 'area-1' }),
      });
    });

    it('rejects deleting an area that has recorded entries', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue({ ...activeArea, _count: { entries: 5 } });
      await expect(service.deleteEvaluationArea('kpi-1', 'area-1', actorId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(prisma.evaluationArea.delete).not.toHaveBeenCalled();
    });
  });

  describe('createSubCriteria / updateSubCriteria / deleteSubCriteria', () => {
    const activeSubCriteria = { id: 'sub-1', evaluationAreaId: 'area-1', name: 'Punctuality' };

    it('creates a sub-criteria under an existing area and audit-logs it', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(activeArea);
      prisma.subCriteria.create.mockResolvedValue(activeSubCriteria);

      await service.createSubCriteria('kpi-1', 'area-1', { name: 'Punctuality' }, actorId);

      expect(prisma.evaluationArea.findFirst).toHaveBeenCalledWith({ where: { id: 'area-1', kpiId: 'kpi-1' } });
      expect(prisma.subCriteria.create).toHaveBeenCalledWith({
        data: { evaluationAreaId: 'area-1', name: 'Punctuality' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'sub_criteria.created', entityId: 'sub-1' }),
      });
    });

    it('rejects creating a sub-criteria under an area that does not belong to the given KPI', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(null);
      await expect(service.createSubCriteria('other-kpi', 'area-1', { name: 'x' }, actorId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.subCriteria.create).not.toHaveBeenCalled();
    });

    it('updates a sub-criteria scoped to its area and KPI, and audit-logs it', async () => {
      prisma.subCriteria.findFirst.mockResolvedValue(activeSubCriteria);
      prisma.subCriteria.update.mockResolvedValue({ ...activeSubCriteria, name: 'Renamed' });

      await service.updateSubCriteria('kpi-1', 'area-1', 'sub-1', { name: 'Renamed' }, actorId);

      expect(prisma.subCriteria.findFirst).toHaveBeenCalledWith({
        where: { id: 'sub-1', evaluationAreaId: 'area-1', evaluationArea: { kpiId: 'kpi-1' } },
      });
      expect(prisma.subCriteria.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { name: 'Renamed' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'sub_criteria.updated', entityId: 'sub-1' }),
      });
    });

    it('rejects updating a sub-criteria that does not belong to the given area/KPI', async () => {
      prisma.subCriteria.findFirst.mockResolvedValue(null);
      await expect(
        service.updateSubCriteria('kpi-1', 'other-area', 'sub-1', { name: 'x' }, actorId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.subCriteria.update).not.toHaveBeenCalled();
    });

    it('hard-deletes a sub-criteria with no guard, and audit-logs it', async () => {
      prisma.subCriteria.findFirst.mockResolvedValue(activeSubCriteria);

      await service.deleteSubCriteria('kpi-1', 'area-1', 'sub-1', actorId);

      expect(prisma.subCriteria.delete).toHaveBeenCalledWith({ where: { id: 'sub-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'sub_criteria.deleted', entityId: 'sub-1' }),
      });
    });

    it('rejects deleting an unknown sub-criteria', async () => {
      prisma.subCriteria.findFirst.mockResolvedValue(null);
      await expect(service.deleteSubCriteria('kpi-1', 'area-1', 'ghost', actorId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.subCriteria.delete).not.toHaveBeenCalled();
    });
  });

  describe('recordEntry', () => {
    const input = { personId: 'user-2', value: 4, periodStart: '2026-07-01', periodEnd: '2026-09-30' };

    it('records an entry for an active area and known person, and audit-logs it', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(activeArea);
      prisma.user.findUnique.mockResolvedValue(evaluatee);
      prisma.evaluationAreaEntry.findUnique.mockResolvedValue(null);
      prisma.evaluationAreaEntry.create.mockResolvedValue({ id: 'entry-1' });

      await service.recordEntry('kpi-1', 'area-1', input, 'evaluator-1');

      expect(prisma.evaluationAreaEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          evaluationAreaId: 'area-1',
          personId: 'user-2',
          value: 4,
          enteredById: 'evaluator-1',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-09-30'),
        }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 'evaluator-1',
          action: 'evaluation_area_entry.recorded',
          entityId: 'entry-1',
        }),
      });
    });

    it('rejects duplicate (area, person, period) entries with CONFLICT', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(activeArea);
      prisma.user.findUnique.mockResolvedValue(evaluatee);
      prisma.evaluationAreaEntry.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.recordEntry('kpi-1', 'area-1', input, 'evaluator-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(prisma.evaluationAreaEntry.create).not.toHaveBeenCalled();
    });

    it('rejects entries for an inactive area', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue({ ...activeArea, isActive: false });
      await expect(service.recordEntry('kpi-1', 'area-1', input, 'evaluator-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('rejects an unknown area', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(null);
      await expect(service.recordEntry('kpi-1', 'ghost', input, 'evaluator-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects an unknown person', async () => {
      prisma.evaluationArea.findFirst.mockResolvedValue(activeArea);
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.recordEntry('kpi-1', 'area-1', input, 'evaluator-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('updateEntry / deleteEntry', () => {
    const existingEntry = { id: 'entry-1', evaluationAreaId: 'area-1', personId: 'user-2', value: 3 };

    it('updateEntry corrects the value and audit-logs it', async () => {
      prisma.evaluationAreaEntry.findFirst.mockResolvedValue(existingEntry);
      prisma.evaluationAreaEntry.update.mockResolvedValue({ ...existingEntry, value: 4.5 });

      await service.updateEntry('kpi-1', 'area-1', 'entry-1', { value: 4.5 }, actorId);

      expect(prisma.evaluationAreaEntry.findFirst).toHaveBeenCalledWith({
        where: { id: 'entry-1', evaluationAreaId: 'area-1', evaluationArea: { kpiId: 'kpi-1' } },
      });
      expect(prisma.evaluationAreaEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { value: 4.5 },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'evaluation_area_entry.updated', entityId: 'entry-1' }),
      });
    });

    it('updateEntry rejects an entry outside the given kpi/area', async () => {
      prisma.evaluationAreaEntry.findFirst.mockResolvedValue(null);
      await expect(service.updateEntry('kpi-1', 'area-1', 'ghost', { value: 4 }, actorId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.evaluationAreaEntry.update).not.toHaveBeenCalled();
    });

    it('deleteEntry removes the entry and audit-logs it', async () => {
      prisma.evaluationAreaEntry.findFirst.mockResolvedValue(existingEntry);

      await service.deleteEntry('kpi-1', 'area-1', 'entry-1', actorId);

      expect(prisma.evaluationAreaEntry.delete).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId, action: 'evaluation_area_entry.deleted', entityId: 'entry-1' }),
      });
    });

    it('deleteEntry rejects an unknown entry', async () => {
      prisma.evaluationAreaEntry.findFirst.mockResolvedValue(null);
      await expect(service.deleteEntry('kpi-1', 'area-1', 'ghost', actorId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.evaluationAreaEntry.delete).not.toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('is idempotent: returns the existing assignment without creating or auditing', async () => {
      prisma.kpi.findUnique.mockResolvedValue(activeKpi);
      prisma.kpiAssignment.findFirst.mockResolvedValue({ id: 'assign-1' });

      const result = await service.assign('kpi-1', { deliveryStream: 'digital' }, 'admin-1');

      expect(result).toEqual({ id: 'assign-1' });
      expect(prisma.kpiAssignment.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('creates and audits a new mapping', async () => {
      prisma.kpi.findUnique.mockResolvedValue(activeKpi);
      prisma.kpiAssignment.findFirst.mockResolvedValue(null);
      prisma.kpiAssignment.create.mockResolvedValue({ id: 'assign-2' });

      await service.assign('kpi-1', { roleId: '4dd4a6f6-1d2b-4c8a-9d0e-000000000001' }, 'admin-1');

      expect(prisma.kpiAssignment.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'kpi.assigned', entityId: 'kpi-1' }),
      });
    });
  });

  describe('unassign', () => {
    it('deletes an existing assignment and audit-logs it', async () => {
      prisma.kpiAssignment.findFirst.mockResolvedValue({ id: 'assign-1', kpiId: 'kpi-1' });

      await service.unassign('kpi-1', 'assign-1', 'admin-1');

      expect(prisma.kpiAssignment.delete).toHaveBeenCalledWith({ where: { id: 'assign-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'kpi.unassigned', entityId: 'kpi-1' }),
      });
    });

    it('rejects an assignment that does not belong to this KPI', async () => {
      prisma.kpiAssignment.findFirst.mockResolvedValue(null);

      await expect(service.unassign('kpi-1', 'ghost', 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.kpiAssignment.delete).not.toHaveBeenCalled();
    });
  });

  describe('list — RolePermission.scope enforcement', () => {
    it('shows every KPI (active and inactive — this is the admin management view) when the caller holds an "all"-scoped kpis:read grant', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'all' }]);
      prisma.kpi.count.mockResolvedValue(2);
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.kpi.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('shows every KPI when the caller holds both an "all" and a narrower grant (union, not intersect)', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'department' }, { scope: 'all' }]);
      prisma.kpi.count.mockResolvedValue(2);
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.kpi.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('filters to the caller own roles/department when every kpis:read grant is scoped narrower than "all"', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'department' }]);
      prisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-1', roles: [{ roleId: 'role-1' }] });
      prisma.kpi.count.mockResolvedValue(1);
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.kpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            assignments: { some: { OR: [{ roleId: { in: ['role-1'] } }, { departmentId: 'dept-1' }] } },
          },
        }),
      );
    });

    it('filters to the caller when they hold no kpis:read grant at all (defensive default)', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.count.mockResolvedValue(0);
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.kpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignments: expect.anything() }) }),
      );
    });
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

    it("includes each KPI's evaluation areas and their recent entries with the evaluatee's name", async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.listMine('user-1');

      const include = prisma.kpi.findMany.mock.calls[0]![0].include;
      expect(include.evaluationAreas.include.entries.include.person.select).toEqual({ id: true, displayName: true });
    });

    it("excludes entries for evaluatees no longer flagged isKpiApplicable, so they don't linger in the dashboard", async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.listMine('user-1');

      const include = prisma.kpi.findMany.mock.calls[0]![0].include;
      expect(include.evaluationAreas.include.entries.where).toEqual({ person: { isKpiApplicable: true } });
    });

    function kpiWithOneEntry(entryOverrides: Record<string, unknown>) {
      return [
        {
          ...activeKpi,
          evaluationAreas: [
            {
              ...activeArea,
              entries: [
                {
                  id: 'entry-1',
                  anonymous: true,
                  enteredById: 'evaluator-1',
                  enteredBy: { id: 'evaluator-1', displayName: 'Peer One' },
                  ...entryOverrides,
                },
              ],
              subCriteria: [],
            },
          ],
        },
      ];
    }

    it('withholds the evaluator on an anonymous entry from a caller without kpis:manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneEntry({}));
      prisma.rolePermission.findFirst.mockResolvedValue(null);

      const [kpi] = await service.listMine('user-1');

      const entry = kpi!.evaluationAreas[0]!.entries[0]!;
      expect(entry.enteredById).toBe('');
      expect(entry.enteredBy).toEqual({ id: '', displayName: 'anonymous' });
    });

    it('reveals the evaluator on an anonymous entry to a caller with kpis:manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneEntry({}));
      prisma.rolePermission.findFirst.mockResolvedValue({ roleId: 'role-1' });

      const [kpi] = await service.listMine('user-1');

      const entry = kpi!.evaluationAreas[0]!.entries[0]!;
      expect(entry.enteredById).toBe('evaluator-1');
      expect(entry.enteredBy.displayName).toBe('Peer One');
    });

    it('never withholds the evaluator on a non-anonymous entry', async () => {
      prisma.user.findUnique.mockResolvedValue({ departmentId: null, roles: [] });
      prisma.kpi.findMany.mockResolvedValue(kpiWithOneEntry({ anonymous: false }));
      prisma.rolePermission.findFirst.mockResolvedValue(null);

      const [kpi] = await service.listMine('user-1');

      expect(kpi!.evaluationAreas[0]!.entries[0]!.enteredById).toBe('evaluator-1');
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
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { members } = await service.getTeamOverview();

      expect(members).toEqual([
        expect.objectContaining({ id: 'user-2', hasKpi: false, finalScore: null, lastUpdated: null }),
      ]);
    });

    it('marks a covered user with no recorded entries as hasKpi: true with a null finalScore', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { members } = await service.getTeamOverview();

      expect(members).toEqual([
        expect.objectContaining({ id: 'user-1', hasKpi: true, finalScore: null, lastUpdated: null }),
      ]);
    });

    it('blends each area into a final score the same way computeKpi does client-side: latest-period average per area, then averaged across areas', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([
        {
          assignments: [{ roleId: 'role-1', departmentId: null }],
          evaluationAreas: [{ id: 'area-1' }, { id: 'area-2' }],
        },
      ]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        // area-1's latest period (two raters, averaged to 4)
        {
          personId: 'user-1',
          evaluationAreaId: 'area-1',
          value: 3,
          periodStart: new Date('2026-02-01'),
          periodEnd: new Date('2026-02-28'),
          createdAt: new Date('2026-02-28T10:00:00Z'),
        },
        {
          personId: 'user-1',
          evaluationAreaId: 'area-1',
          value: 5,
          periodStart: new Date('2026-02-01'),
          periodEnd: new Date('2026-02-28'),
          // most recently *submitted* entry overall, despite an earlier periodEnd than area-2's
          createdAt: new Date('2026-03-01T09:00:00Z'),
        },
        // area-1's earlier period — excluded from the average
        {
          personId: 'user-1',
          evaluationAreaId: 'area-1',
          value: 1,
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-01-31'),
          createdAt: new Date('2026-01-31T09:00:00Z'),
        },
        // area-2 has just one entry, value 2 — its periodEnd is the latest of all
        // four rows, but it was actually *submitted* earliest (a backdated period)
        {
          personId: 'user-1',
          evaluationAreaId: 'area-2',
          value: 2,
          periodStart: new Date('2026-02-01'),
          periodEnd: new Date('2026-03-15'),
          createdAt: new Date('2026-02-15T09:00:00Z'),
        },
      ]);

      const { members } = await service.getTeamOverview();

      // area-1 latest avg = 4, area-2 latest avg = 2 → final score = 3
      expect(members[0]!.finalScore).toBe(3);
      // previousScore only draws from areas that actually have a prior
      // period — area-2 has just one period (contributes nothing here), so
      // previousScore is area-1's own previous-period avg (1), not diluted
      // by treating area-2's missing history as a 0 or excluding the person entirely.
      expect(members[0]!.previousScore).toBe(1);
      // lastUpdated tracks the most recent createdAt (actual submission time),
      // not the latest periodEnd — proven by area-2's later periodEnd losing
      // out to area-1's later-submitted entry.
      expect(members[0]!.lastUpdated).toBe(new Date('2026-03-01T09:00:00Z').toISOString());
    });

    it('reports previousScore as null (not 0) when no area has a prior period yet', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        {
          personId: 'user-1',
          evaluationAreaId: 'area-1',
          value: 4,
          periodStart: new Date('2026-02-01'),
          periodEnd: new Date('2026-02-28'),
          createdAt: new Date('2026-02-28T10:00:00Z'),
        },
      ]);

      const { members } = await service.getTeamOverview();

      expect(members[0]!.finalScore).toBe(4);
      expect(members[0]!.previousScore).toBeNull();
    });

    it('treats a KPI assignment with no active evaluation areas as not covering anyone', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser]);
      prisma.kpi.findMany.mockResolvedValue([{ ...coveringKpi, evaluationAreas: [] }]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { members } = await service.getTeamOverview();

      expect(members[0]!.hasKpi).toBe(false);
    });

    it('surfaces department name and role names for the table', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...coveredUser, department: { name: 'Quality Assurance' } }]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { members } = await service.getTeamOverview();

      expect(members[0]!.department).toBe('Quality Assurance');
      expect(members[0]!.roles).toEqual(['QA Engineer']);
    });

    it('returns totalActiveUsers as the count of active users queried', async () => {
      prisma.user.findMany.mockResolvedValue([coveredUser, uncoveredUser]);
      prisma.kpi.findMany.mockResolvedValue([coveringKpi]);
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { totalActiveUsers } = await service.getTeamOverview();

      expect(totalActiveUsers).toBe(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, isKpiApplicable: true } }),
      );
    });
  });

  describe('getPersonBreakdown', () => {
    const person = { id: 'user-2', displayName: 'Evaluatee', departmentId: null, roles: [] };

    it('rejects an unknown person', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getPersonBreakdown('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("blends the person's own entries per area into a latest/previous value, same as everywhere else", async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'QA Lead Evaluation',
          evaluationAreas: [
            {
              id: 'area-1',
              name: 'Leadership',
              cadence: 'quarterly',
              entries: [
                { value: 3, periodStart: new Date('2026-02-01') },
                { value: 5, periodStart: new Date('2026-02-01') },
                { value: 1, periodStart: new Date('2026-01-01') },
              ],
            },
          ],
        },
      ]);

      const breakdown = await service.getPersonBreakdown('user-2');

      expect(breakdown.personId).toBe('user-2');
      expect(breakdown.displayName).toBe('Evaluatee');
      expect(breakdown.kpis).toEqual([
        {
          id: 'kpi-1',
          name: 'QA Lead Evaluation',
          areas: [{ id: 'area-1', name: 'Leadership', cadence: 'quarterly', latestValue: 4, previousValue: 1 }],
        },
      ]);
    });

    it('reports null latest/previous for an area with no entries yet, rather than omitting it', async () => {
      prisma.user.findUnique.mockResolvedValue(person);
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'QA Lead Evaluation',
          evaluationAreas: [{ id: 'area-1', name: 'Leadership', cadence: 'quarterly', entries: [] }],
        },
      ]);

      const breakdown = await service.getPersonBreakdown('user-2');

      expect(breakdown.kpis[0]!.areas[0]).toMatchObject({ latestValue: null, previousValue: null });
    });

    it('scopes the query to KPIs covering the selected person, not the caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...person, departmentId: 'dept-1', roles: [{ roleId: 'role-1' }] });
      prisma.kpi.findMany.mockResolvedValue([]);

      await service.getPersonBreakdown('user-2');

      expect(prisma.kpi.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            assignments: { some: { OR: [{ roleId: { in: ['role-1'] } }, { departmentId: 'dept-1' }] } },
          },
        }),
      );
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

    it('flags a weekly-cadence area whose last entry is well past its grace period', async () => {
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'Delivery',
          evaluationAreas: [
            {
              id: 'area-1',
              name: 'Sprint velocity',
              cadence: 'weekly',
              entries: [{ createdAt: daysAgo(30) }],
            },
          ],
        },
      ]);

      const { staleAreas } = await service.getMeasurementGaps();

      expect(staleAreas.total).toBe(1);
      expect(staleAreas.items[0]).toMatchObject({ kpiId: 'kpi-1', areaId: 'area-1', cadence: 'weekly' });
    });

    it('does not flag an area scored within its own cadence grace period', async () => {
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'Annual review',
          evaluationAreas: [
            { id: 'area-1', name: 'Leadership', cadence: 'yearly', entries: [{ createdAt: daysAgo(30) }] },
          ],
        },
      ]);

      const { staleAreas } = await service.getMeasurementGaps();

      expect(staleAreas.total).toBe(0);
    });

    it('flags an area with zero entries ever as stale, with lastScoredAt null', async () => {
      prisma.kpi.findMany.mockResolvedValue([
        {
          id: 'kpi-1',
          name: 'New KPI',
          evaluationAreas: [{ id: 'area-1', name: 'Quality', cadence: 'monthly', entries: [] }],
        },
      ]);

      const { staleAreas } = await service.getMeasurementGaps();

      expect(staleAreas.items[0]).toMatchObject({ lastScoredAt: null });
    });
  });

  describe('getRecentFeedback', () => {
    const feedbackEntry = {
      id: 'entry-1',
      anonymous: false,
      context: 'Level: Senior',
      comment: 'Great communication this quarter.',
      createdAt: new Date('2026-03-01T09:00:00Z'),
      person: { displayName: 'Evaluatee' },
      enteredBy: { displayName: 'Rater One' },
      evaluationArea: { name: 'Communication', kpiId: 'kpi-1', kpi: { name: 'QA Lead Evaluation' } },
    };

    it('maps entries into the digest shape, querying only rows with context or comment', async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([feedbackEntry]);

      const { entries } = await service.getRecentFeedback();

      expect(prisma.evaluationAreaEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ context: { not: null } }, { comment: { not: null } }] },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(entries).toEqual([
        {
          id: 'entry-1',
          kpiId: 'kpi-1',
          kpiName: 'QA Lead Evaluation',
          areaName: 'Communication',
          personName: 'Evaluatee',
          evaluatorName: 'Rater One',
          anonymous: false,
          context: 'Level: Senior',
          comment: 'Great communication this quarter.',
          createdAt: '2026-03-01T09:00:00.000Z',
        },
      ]);
    });

    it('never withholds the evaluator identity, even on an anonymous entry — kpis:manage already entitles the caller', async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([{ ...feedbackEntry, anonymous: true }]);

      const { entries } = await service.getRecentFeedback();

      expect(entries[0]).toMatchObject({ anonymous: true, evaluatorName: 'Rater One' });
    });

    it('scopes to one KPI when kpiId is passed', async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      await service.getRecentFeedback('kpi-1');

      expect(prisma.evaluationAreaEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ context: { not: null } }, { comment: { not: null } }], evaluationArea: { kpiId: 'kpi-1' } },
        }),
      );
    });
  });

  describe('getActivityTrend', () => {
    beforeEach(() => {
      // A known Wednesday, so "this week"'s Monday is unambiguous.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-11T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns exactly ACTIVITY_TREND_WEEKS points, oldest first, ending on the current week', async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { points } = await service.getActivityTrend();

      expect(points).toHaveLength(12);
      expect(points[0]!.weekStart).toBe('2025-12-22');
      expect(points[11]!.weekStart).toBe('2026-03-09'); // Monday of the current week
    });

    it('buckets entries by the Monday of their own week, and counts every entry that week', async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([
        { createdAt: new Date('2026-03-09T08:00:00Z') }, // Monday of current week
        { createdAt: new Date('2026-03-11T20:00:00Z') }, // Wednesday, same week
        { createdAt: new Date('2026-03-02T09:00:00Z') }, // previous week
      ]);

      const { points } = await service.getActivityTrend();

      expect(points.find((p) => p.weekStart === '2026-03-09')?.count).toBe(2);
      expect(points.find((p) => p.weekStart === '2026-03-02')?.count).toBe(1);
    });

    it('reports 0, not an omitted point, for a week with no activity', async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      const { points } = await service.getActivityTrend();

      expect(points.every((p) => p.count === 0)).toBe(true);
    });

    it("queries only entries within the window's earliest week", async () => {
      prisma.evaluationAreaEntry.findMany.mockResolvedValue([]);

      await service.getActivityTrend();

      expect(prisma.evaluationAreaEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { gte: new Date('2025-12-22T00:00:00.000Z') } } }),
      );
    });
  });
});

describe('recordEvaluationAreaEntrySchema', () => {
  it('rejects inverted periods', () => {
    const result = recordEvaluationAreaEntrySchema.safeParse({
      personId: '4dd4a6f6-1d2b-4c8a-9d0e-000000000001',
      value: 4,
      periodStart: '2026-07-07',
      periodEnd: '2026-07-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a value outside the 0-5 range', () => {
    const result = recordEvaluationAreaEntrySchema.safeParse({
      personId: '4dd4a6f6-1d2b-4c8a-9d0e-000000000001',
      value: 5.5,
      periodStart: '2026-07-01',
      periodEnd: '2026-07-07',
    });
    expect(result.success).toBe(false);
  });
});
