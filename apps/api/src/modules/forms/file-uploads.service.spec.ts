import { describe, expect, it, vi } from 'vitest';
import { FileUploadsService } from './file-uploads.service';

describe('FileUploadsService.sweepOrphanedUploads', () => {
  it('deletes only submission-less uploads older than 24h', async () => {
    const prisma = {
      formFileUpload: {
        deleteMany: vi.fn(async (_args: { where: { submissionId: null; createdAt: { lt: Date } } }) => ({
          count: 2,
        })),
      },
    };
    const service = new FileUploadsService(prisma as never, {} as never);

    await service.sweepOrphanedUploads();

    expect(prisma.formFileUpload.deleteMany).toHaveBeenCalledTimes(1);
    const { where } = prisma.formFileUpload.deleteMany.mock.calls[0]![0];
    expect(where.submissionId).toBeNull();
    expect(where.createdAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000);
  });
});
