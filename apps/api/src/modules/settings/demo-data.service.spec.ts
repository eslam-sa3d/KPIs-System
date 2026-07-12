import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoDataService } from './demo-data.service';

/** Previously zero test coverage on this module, including its destructive
 *  DELETE path. Full seed() creation cascade (dozens of sequential Prisma
 *  calls plus Math.random() jitter) is exercised end-to-end by the seeded
 *  demo data an admin can inspect in the portal, not re-mocked here — these
 *  tests focus on what unit tests are actually good at: the re-seed guard
 *  and the exact scope of what remove() deletes. */
function makePrismaStub() {
  return {
    $transaction: vi.fn(),
    user: { count: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    kpi: { count: vi.fn(), deleteMany: vi.fn() },
    form: { count: vi.fn(), deleteMany: vi.fn() },
    role: { count: vi.fn(), deleteMany: vi.fn() },
    department: { count: vi.fn(), deleteMany: vi.fn() },
    formSubmission: { count: vi.fn(), deleteMany: vi.fn() },
    evaluationAreaEntry: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}

const EMPTY_STATUS_COUNTS = [0, 0, 0, 0, 0, 0];

describe('DemoDataService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: DemoDataService;

  beforeEach(() => {
    prisma = makePrismaStub();
    service = new DemoDataService(prisma as never, {} as never);
  });

  describe('status', () => {
    it('reports absent when every demo-tagged count is zero', async () => {
      prisma.$transaction.mockResolvedValue(EMPTY_STATUS_COUNTS);

      const status = await service.status();

      expect(status.present).toBe(false);
      expect(status.counts).toEqual({ users: 0, kpis: 0, forms: 0, roles: 0, departments: 0, submissions: 0 });
      expect(status).not.toHaveProperty('demoPassword');
      expect(status.demoUsers).toHaveLength(3);
    });

    it('reports present once any of users/kpis/forms exist', async () => {
      prisma.$transaction.mockResolvedValue([3, 2, 1, 1, 2, 10]);

      const status = await service.status();

      expect(status.present).toBe(true);
      expect(status.counts.submissions).toBe(10);
    });
  });

  describe('seed', () => {
    it('refuses to re-seed when demo data already exists', async () => {
      prisma.$transaction.mockResolvedValue([3, 2, 1, 1, 2, 10]);

      await expect(service.seed('admin-1')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.$transaction.mockResolvedValue(EMPTY_STATUS_COUNTS);
    });

    it('deletes demo submissions by form slug OR by demo-domain submitter, before deleting the forms', async () => {
      await service.remove('admin-1');

      expect(prisma.formSubmission.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { formVersion: { form: { slug: { startsWith: 'demo-' } } } },
            { submittedBy: { email: { endsWith: '@pulse.demo' } } },
          ],
        },
      });
      expect(prisma.form.deleteMany).toHaveBeenCalledWith({ where: { slug: { startsWith: 'demo-' } } });

      const submissionCallOrder = prisma.formSubmission.deleteMany.mock.invocationCallOrder[0]!;
      const formCallOrder = prisma.form.deleteMany.mock.invocationCallOrder[0]!;
      expect(submissionCallOrder).toBeLessThan(formCallOrder);
    });

    it('deletes evaluation area entries scoped to demo KPIs or demo-domain participants, before deleting the KPIs', async () => {
      await service.remove('admin-1');

      expect(prisma.evaluationAreaEntry.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { evaluationArea: { kpi: { name: { startsWith: 'Demo: ' } } } },
            { person: { email: { endsWith: '@pulse.demo' } } },
            { enteredBy: { email: { endsWith: '@pulse.demo' } } },
          ],
        },
      });
      expect(prisma.kpi.deleteMany).toHaveBeenCalledWith({ where: { name: { startsWith: 'Demo: ' } } });

      const entryCallOrder = prisma.evaluationAreaEntry.deleteMany.mock.invocationCallOrder[0]!;
      const kpiCallOrder = prisma.kpi.deleteMany.mock.invocationCallOrder[0]!;
      expect(entryCallOrder).toBeLessThan(kpiCallOrder);
    });

    it('never touches a real (non-demo-tagged) record: every filter requires the demo marker', async () => {
      await service.remove('admin-1');

      expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { email: { endsWith: '@pulse.demo' } } });
      expect(prisma.role.deleteMany).toHaveBeenCalledWith({
        where: { name: { startsWith: 'Demo ' }, isSystem: false },
      });
      expect(prisma.department.deleteMany).toHaveBeenCalledWith({ where: { name: { startsWith: 'Demo ' } } });
    });

    it('detaches real users from a demo department before deleting it', async () => {
      await service.remove('admin-1');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { department: { name: { startsWith: 'Demo ' } } },
        data: { departmentId: null },
      });
      const detachOrder = prisma.user.updateMany.mock.invocationCallOrder[0]!;
      const deptDeleteOrder = prisma.department.deleteMany.mock.invocationCallOrder[0]!;
      expect(detachOrder).toBeLessThan(deptDeleteOrder);
    });

    it('audit-logs the removal', async () => {
      await service.remove('admin-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'settings.demo_data_removed', entity: 'DemoData' },
      });
    });
  });
});
