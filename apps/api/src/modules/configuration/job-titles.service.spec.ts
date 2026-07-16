import { beforeEach, describe, expect, it } from 'vitest';
import { createPrismaMock } from '../../testing/mocks';
import { JobTitlesService } from './job-titles.service';

describe('JobTitlesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: JobTitlesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new JobTitlesService(prisma as never);
  });

  describe('list', () => {
    it('lists job titles ordered by label', () => {
      service.list();

      expect(prisma.jobTitle.findMany).toHaveBeenCalledWith({ orderBy: { label: 'asc' } });
    });
  });

  describe('create', () => {
    it('creates a job title and records an audit log entry', async () => {
      prisma.jobTitle.create.mockResolvedValue({ id: 'jt-1', label: 'Engineer' });

      const result = await service.create({ label: 'Engineer' }, 'admin-1');

      expect(prisma.jobTitle.create).toHaveBeenCalledWith({ data: { label: 'Engineer' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'job_title.created', entity: 'JobTitle', entityId: 'jt-1' },
      });
      expect(result).toMatchObject({ id: 'jt-1' });
    });
  });

  describe('update', () => {
    it('rejects an unknown job title id', async () => {
      prisma.jobTitle.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', { label: 'New label' }, 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.jobTitle.update).not.toHaveBeenCalled();
    });

    it('updates a job title and records an audit log entry', async () => {
      prisma.jobTitle.findUnique.mockResolvedValue({ id: 'jt-1', label: 'Engineer' });
      prisma.jobTitle.update.mockResolvedValue({ id: 'jt-1', label: 'Senior Engineer' });

      const result = await service.update('jt-1', { label: 'Senior Engineer' }, 'admin-1');

      expect(prisma.jobTitle.update).toHaveBeenCalledWith({
        where: { id: 'jt-1' },
        data: { label: 'Senior Engineer' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'job_title.updated', entity: 'JobTitle', entityId: 'jt-1' },
      });
      expect(result).toMatchObject({ label: 'Senior Engineer' });
    });
  });

  describe('remove', () => {
    it('rejects an unknown job title id', async () => {
      prisma.jobTitle.findUnique.mockResolvedValue(null);

      await expect(service.remove('ghost', 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(prisma.jobTitle.delete).not.toHaveBeenCalled();
    });

    it('deletes a job title and records an audit log entry', async () => {
      prisma.jobTitle.findUnique.mockResolvedValue({ id: 'jt-1', label: 'Engineer' });

      const result = await service.remove('jt-1', 'admin-1');

      expect(prisma.jobTitle.delete).toHaveBeenCalledWith({ where: { id: 'jt-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: { actorId: 'admin-1', action: 'job_title.deleted', entity: 'JobTitle', entityId: 'jt-1' },
      });
      expect(result).toBeNull();
    });
  });
});
