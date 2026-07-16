import { describe, expect, it, vi } from 'vitest';
import { formDefinitionSchema } from '@pulse/contracts';
import { FileUploadsService } from './file-uploads.service';

const activeForm = { id: 'form-1', slug: 'demo', publicToken: 'tok-1' };

const definition = formDefinitionSchema.parse({
  title: 'attach a receipt',
  fields: [
    {
      key: 'receipt',
      label: 'Receipt',
      type: 'file',
      acceptedMimeTypes: ['application/pdf', 'image/png'],
      maxSizeMb: 2,
    },
  ],
});

function makePrismaStub() {
  return {
    formFileUpload: {
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'upload-1', ...data })),
      findFirst: vi.fn(),
      deleteMany: vi.fn(async (_args: { where: { submissionId: null; createdAt: { lt: Date } } }) => ({ count: 0 })),
    },
  };
}

function makeFormsStub() {
  return {
    getLatestVersion: vi.fn(async () => ({ form: activeForm, version: { id: 'version-1' }, definition, settings: {} })),
    getByPublicToken: vi.fn(async () => ({ form: activeForm, version: { id: 'version-1' }, definition, settings: {} })),
  };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'receipt.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('fake-file-bytes'),
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

describe('FileUploadsService.upload', () => {
  it('rejects when no file is provided', async () => {
    const service = new FileUploadsService(makePrismaStub() as never, makeFormsStub() as never);
    // @ts-expect-error exercising the runtime guard for a missing file
    await expect(service.upload('demo', 'receipt', undefined, 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a field key that is not a file-type field on this form', async () => {
    const service = new FileUploadsService(makePrismaStub() as never, makeFormsStub() as never);
    await expect(service.upload('demo', 'not-a-field', makeFile(), 'user-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a MIME type not in the field-configured accept list', async () => {
    const prisma = makePrismaStub();
    const service = new FileUploadsService(prisma as never, makeFormsStub() as never);
    await expect(
      service.upload('demo', 'receipt', makeFile({ mimetype: 'application/zip' }), 'user-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.formFileUpload.create).not.toHaveBeenCalled();
  });

  it('rejects a file over the field-configured size limit', async () => {
    const service = new FileUploadsService(makePrismaStub() as never, makeFormsStub() as never);
    await expect(
      service.upload('demo', 'receipt', makeFile({ size: 3 * 1024 * 1024 }), 'user-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts a file matching the field config and persists it', async () => {
    const prisma = makePrismaStub();
    const service = new FileUploadsService(prisma as never, makeFormsStub() as never);

    const result = await service.upload('demo', 'receipt', makeFile(), 'user-1');

    expect(prisma.formFileUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ formId: 'form-1', fieldKey: 'receipt', uploadedById: 'user-1' }),
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
    expect(result).toMatchObject({ id: 'upload-1' });
  });
});

describe('FileUploadsService.uploadPublic', () => {
  it('resolves the form by public token and persists with no uploadedById', async () => {
    const prisma = makePrismaStub();
    const forms = makeFormsStub();
    const service = new FileUploadsService(prisma as never, forms as never);

    await service.uploadPublic('tok-1', 'receipt', makeFile());

    expect(forms.getByPublicToken).toHaveBeenCalledWith('tok-1');
    expect(prisma.formFileUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ uploadedById: null }),
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
  });
});

describe('FileUploadsService.getForDownload', () => {
  it('returns the upload when found on this form', async () => {
    const prisma = makePrismaStub();
    prisma.formFileUpload.findFirst.mockResolvedValue({ id: 'upload-1', formId: 'form-1' });
    const service = new FileUploadsService(prisma as never, makeFormsStub() as never);

    await expect(service.getForDownload('demo', 'upload-1')).resolves.toMatchObject({ id: 'upload-1' });
  });

  it('rejects an upload id not found on this form', async () => {
    const prisma = makePrismaStub();
    prisma.formFileUpload.findFirst.mockResolvedValue(null);
    const service = new FileUploadsService(prisma as never, makeFormsStub() as never);

    await expect(service.getForDownload('demo', 'ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FileUploadsService.sweepOrphanedUploads', () => {
  it('deletes only submission-less uploads older than 24h', async () => {
    const prisma = makePrismaStub();
    prisma.formFileUpload.deleteMany.mockResolvedValue({ count: 2 });
    const service = new FileUploadsService(prisma as never, makeFormsStub() as never);

    await service.sweepOrphanedUploads();

    expect(prisma.formFileUpload.deleteMany).toHaveBeenCalledTimes(1);
    const { where } = prisma.formFileUpload.deleteMany.mock.calls[0]![0];
    expect(where.submissionId).toBeNull();
    expect(where.createdAt.lt.getTime()).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000);
  });
});
