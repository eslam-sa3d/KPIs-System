import { beforeEach, describe, expect, it } from 'vitest';
import { createPrismaMock } from '../../testing/mocks';
import { PerformanceLevelsService } from './performance-levels.service';

describe('PerformanceLevelsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: PerformanceLevelsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new PerformanceLevelsService(prisma as never);
  });

  describe('list', () => {
    it('lists levels ordered by descending minScore, serialized to numbers', async () => {
      prisma.performanceLevel.findMany.mockResolvedValue([
        { id: 'pl-1', label: 'Outstanding', minScore: 4, maxScore: 5 },
      ]);

      const result = await service.list();

      expect(prisma.performanceLevel.findMany).toHaveBeenCalledWith({ orderBy: { minScore: 'desc' } });
      expect(result).toEqual([{ id: 'pl-1', label: 'Outstanding', minScore: 4, maxScore: 5 }]);
    });
  });

  describe('create', () => {
    it('creates a level, records an audit log entry, and serializes the result', async () => {
      prisma.performanceLevel.create.mockResolvedValue({ id: 'pl-1', label: 'Outstanding', minScore: 4, maxScore: 5 });
      const input = { label: 'Outstanding', minScore: 4, maxScore: 5 };

      const result = await service.create(input, 'admin-1');

      expect(prisma.performanceLevel.create).toHaveBeenCalledWith({ data: input });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'performance_level.created', entity: 'PerformanceLevel', entityId: 'pl-1' },
      });
      expect(result).toEqual({ id: 'pl-1', label: 'Outstanding', minScore: 4, maxScore: 5 });
    });
  });

  describe('update', () => {
    it('rejects an unknown level id', async () => {
      prisma.performanceLevel.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', { minScore: 1 }, 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.performanceLevel.update).not.toHaveBeenCalled();
    });

    it('rejects when the resulting maxScore would be less than minScore', async () => {
      prisma.performanceLevel.findUnique.mockResolvedValue({
        id: 'pl-1',
        label: 'Outstanding',
        minScore: 4,
        maxScore: 5,
      });

      await expect(service.update('pl-1', { maxScore: 3 }, 'admin-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(prisma.performanceLevel.update).not.toHaveBeenCalled();
    });

    it('falls back to the existing minScore/maxScore when only one bound is provided', async () => {
      prisma.performanceLevel.findUnique.mockResolvedValue({
        id: 'pl-1',
        label: 'Outstanding',
        minScore: 4,
        maxScore: 5,
      });
      prisma.performanceLevel.update.mockResolvedValue({
        id: 'pl-1',
        label: 'Outstanding',
        minScore: 4.5,
        maxScore: 5,
      });

      await service.update('pl-1', { minScore: 4.5 }, 'admin-1');

      expect(prisma.performanceLevel.update).toHaveBeenCalledWith({
        where: { id: 'pl-1' },
        data: { minScore: 4.5 },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'performance_level.updated', entity: 'PerformanceLevel', entityId: 'pl-1' },
      });
    });
  });

  describe('remove', () => {
    it('rejects an unknown level id', async () => {
      prisma.performanceLevel.findUnique.mockResolvedValue(null);

      await expect(service.remove('ghost', 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.performanceLevel.delete).not.toHaveBeenCalled();
    });

    it('deletes a level and records an audit log entry', async () => {
      prisma.performanceLevel.findUnique.mockResolvedValue({
        id: 'pl-1',
        label: 'Outstanding',
        minScore: 4,
        maxScore: 5,
      });

      const result = await service.remove('pl-1', 'admin-1');

      expect(prisma.performanceLevel.delete).toHaveBeenCalledWith({ where: { id: 'pl-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'performance_level.deleted', entity: 'PerformanceLevel', entityId: 'pl-1' },
      });
      expect(result).toBeNull();
    });
  });
});
