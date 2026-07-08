import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordKpiEntrySchema } from '@pulse/contracts';
import { KpisService } from './kpis.service';

function makePrismaStub() {
  return {
    kpi: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    kpiAssignment: { findFirst: vi.fn(), create: vi.fn() },
    kpiEntry: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
}

const activeKpi = {
  id: 'kpi-1',
  code: 'DEL-VEL-01',
  name: 'Sprint velocity',
  unit: 'points',
  direction: 'higher_is_better',
  target: 40,
  cadence: 'weekly',
  isActive: true,
};

describe('KpisService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: KpisService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaStub();
    service = new KpisService(prisma as never);
  });

  describe('recordEntry', () => {
    const input = { value: 42, periodStart: '2026-07-01', periodEnd: '2026-07-07' };

    it('records an entry for an active KPI', async () => {
      prisma.kpi.findUnique.mockResolvedValue(activeKpi);
      prisma.kpiEntry.findUnique.mockResolvedValue(null);
      prisma.kpiEntry.create.mockResolvedValue({ id: 'entry-1' });

      await service.recordEntry('kpi-1', input, 'user-1');

      expect(prisma.kpiEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kpiId: 'kpi-1',
          value: 42,
          enteredById: 'user-1',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-07-07'),
        }),
      });
    });

    it('rejects duplicate periods with CONFLICT', async () => {
      prisma.kpi.findUnique.mockResolvedValue(activeKpi);
      prisma.kpiEntry.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.recordEntry('kpi-1', input, 'user-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(prisma.kpiEntry.create).not.toHaveBeenCalled();
    });

    it('rejects entries for inactive KPIs', async () => {
      prisma.kpi.findUnique.mockResolvedValue({ ...activeKpi, isActive: false });
      await expect(service.recordEntry('kpi-1', input, 'user-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('rejects unknown KPIs', async () => {
      prisma.kpi.findUnique.mockResolvedValue(null);
      await expect(service.recordEntry('ghost', input, 'user-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
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
  });
});

describe('recordKpiEntrySchema', () => {
  it('rejects inverted periods', () => {
    const result = recordKpiEntrySchema.safeParse({
      value: 10,
      periodStart: '2026-07-07',
      periodEnd: '2026-07-01',
    });
    expect(result.success).toBe(false);
  });
});
