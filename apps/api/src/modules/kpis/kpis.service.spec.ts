import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordEvaluationAreaEntrySchema } from '@pulse/contracts';
import { KpisService } from './kpis.service';

function makePrismaStub() {
  return {
    kpi: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    kpiAssignment: { findFirst: vi.fn(), create: vi.fn() },
    evaluationArea: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    evaluationAreaEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
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
    service = new KpisService(prisma as never);
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
      await expect(
        service.updateEvaluationArea('other-kpi', 'area-1', { name: 'x' }, actorId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
      await expect(
        service.updateEntry('kpi-1', 'area-1', 'ghost', { value: 4 }, actorId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
