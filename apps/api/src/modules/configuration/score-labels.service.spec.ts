import { beforeEach, describe, expect, it } from 'vitest';
import { createPrismaMock } from '../../testing/mocks';
import { ScoreLabelsService } from './score-labels.service';

describe('ScoreLabelsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ScoreLabelsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ScoreLabelsService(prisma as never);
  });

  describe('list', () => {
    it('lists labels ordered by descending score', async () => {
      prisma.scoreLabel.findMany.mockResolvedValue([{ id: 'sl-1', label: 'Outstanding', score: 5 }]);

      const result = await service.list();

      expect(prisma.scoreLabel.findMany).toHaveBeenCalledWith({ orderBy: { score: 'desc' } });
      expect(result).toEqual([{ id: 'sl-1', label: 'Outstanding', score: 5 }]);
    });
  });

  describe('create', () => {
    it('creates a label and records an audit log entry', async () => {
      prisma.scoreLabel.create.mockResolvedValue({ id: 'sl-1', label: 'Outstanding', score: 5 });
      const input = { label: 'Outstanding', score: 5 };

      const result = await service.create(input, 'admin-1');

      expect(prisma.scoreLabel.create).toHaveBeenCalledWith({ data: input });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'score_label.created', entity: 'ScoreLabel', entityId: 'sl-1' },
      });
      expect(result).toEqual({ id: 'sl-1', label: 'Outstanding', score: 5 });
    });
  });

  describe('update', () => {
    it('rejects an unknown label id', async () => {
      prisma.scoreLabel.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', { score: 3 }, 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.scoreLabel.update).not.toHaveBeenCalled();
    });

    it('updates a label and records an audit log entry', async () => {
      prisma.scoreLabel.findUnique.mockResolvedValue({ id: 'sl-1', label: 'Outstanding', score: 5 });
      prisma.scoreLabel.update.mockResolvedValue({ id: 'sl-1', label: 'Outstanding', score: 4 });

      await service.update('sl-1', { score: 4 }, 'admin-1');

      expect(prisma.scoreLabel.update).toHaveBeenCalledWith({ where: { id: 'sl-1' }, data: { score: 4 } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'score_label.updated', entity: 'ScoreLabel', entityId: 'sl-1' },
      });
    });
  });

  describe('remove', () => {
    it('rejects an unknown label id', async () => {
      prisma.scoreLabel.findUnique.mockResolvedValue(null);

      await expect(service.remove('ghost', 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.scoreLabel.delete).not.toHaveBeenCalled();
    });

    it('deletes a label and records an audit log entry', async () => {
      prisma.scoreLabel.findUnique.mockResolvedValue({ id: 'sl-1', label: 'Outstanding', score: 5 });

      const result = await service.remove('sl-1', 'admin-1');

      expect(prisma.scoreLabel.delete).toHaveBeenCalledWith({ where: { id: 'sl-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'score_label.deleted', entity: 'ScoreLabel', entityId: 'sl-1' },
      });
      expect(result).toBeNull();
    });
  });
});
