import { describe, expect, it, vi } from 'vitest';
import { AssetsService } from './assets.service';

function makePrismaStub() {
  return {
    formAsset: {
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'asset-1', ...data })),
      findUnique: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async (_args: { where: { formId: null; createdAt: { lt: Date } } }) => ({ count: 0 })),
    },
  };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'logo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    buffer: Buffer.from('fake-image-bytes'),
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

describe('AssetsService.upload', () => {
  it('rejects when no file is provided', async () => {
    const service = new AssetsService(makePrismaStub() as never);
    await expect(service.upload(undefined, 'user-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // Regression test for the SVG stored-XSS fix: assets are served back
  // publicly with no Content-Disposition (see getForDownload), and an SVG
  // can carry an inline <script>/event-handler payload — it must never be
  // an accepted upload type, unlike the other raster formats.
  it('rejects an SVG upload', async () => {
    const prisma = makePrismaStub();
    const service = new AssetsService(prisma as never);
    await expect(service.upload(makeFile({ mimetype: 'image/svg+xml' }), 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.formAsset.create).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized MIME type', async () => {
    const service = new AssetsService(makePrismaStub() as never);
    await expect(service.upload(makeFile({ mimetype: 'application/pdf' }), 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a file over the 5MB limit', async () => {
    const service = new AssetsService(makePrismaStub() as never);
    await expect(service.upload(makeFile({ size: 6 * 1024 * 1024 }), 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])('accepts a %s upload', async (mimetype) => {
    const prisma = makePrismaStub();
    const service = new AssetsService(prisma as never);
    const result = await service.upload(makeFile({ mimetype }), 'user-1');

    expect(prisma.formAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mimeType: mimetype, createdById: 'user-1' }),
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
    expect(result).toMatchObject({ id: 'asset-1' });
  });
});

describe('AssetsService.getForDownload', () => {
  it('returns the asset when found', async () => {
    const prisma = makePrismaStub();
    prisma.formAsset.findUnique.mockResolvedValue({ id: 'asset-1', mimeType: 'image/png' });
    const service = new AssetsService(prisma as never);

    await expect(service.getForDownload('asset-1')).resolves.toMatchObject({ id: 'asset-1' });
  });

  it('rejects an unknown asset id', async () => {
    const prisma = makePrismaStub();
    prisma.formAsset.findUnique.mockResolvedValue(null);
    const service = new AssetsService(prisma as never);

    await expect(service.getForDownload('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('AssetsService.claim', () => {
  it('attaches only still-orphaned assets among the given ids to the form', async () => {
    const prisma = makePrismaStub();
    const service = new AssetsService(prisma as never);

    await service.claim('form-1', ['asset-1', 'asset-2']);

    expect(prisma.formAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['asset-1', 'asset-2'] }, formId: null },
      data: { formId: 'form-1' },
    });
  });

  it('is a no-op for an empty id list', async () => {
    const prisma = makePrismaStub();
    const service = new AssetsService(prisma as never);

    await service.claim('form-1', []);

    expect(prisma.formAsset.updateMany).not.toHaveBeenCalled();
  });
});

describe('AssetsService.sweepOrphanedAssets', () => {
  it('deletes only unclaimed (formId null) assets older than 24h', async () => {
    const prisma = makePrismaStub();
    prisma.formAsset.deleteMany.mockResolvedValue({ count: 1 });
    const service = new AssetsService(prisma as never);

    await service.sweepOrphanedAssets();

    expect(prisma.formAsset.deleteMany).toHaveBeenCalledTimes(1);
    const { where } = prisma.formAsset.deleteMany.mock.calls[0]![0];
    expect(where.formId).toBeNull();
    expect(where.createdAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000);
  });
});
