import { describe, expect, it, vi } from 'vitest';
import { AssetsService } from './assets.service';

describe('AssetsService.sweepOrphanedAssets', () => {
  it('deletes only unclaimed (formId null) assets older than 24h', async () => {
    const prisma = {
      formAsset: {
        deleteMany: vi.fn(async (_args: { where: { formId: null; createdAt: { lt: Date } } }) => ({
          count: 1,
        })),
      },
    };
    const service = new AssetsService(prisma as never);

    await service.sweepOrphanedAssets();

    expect(prisma.formAsset.deleteMany).toHaveBeenCalledTimes(1);
    const { where } = prisma.formAsset.deleteMany.mock.calls[0]![0];
    expect(where.formId).toBeNull();
    expect(where.createdAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000);
  });
});
