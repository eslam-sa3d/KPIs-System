import { Injectable } from '@nestjs/common';
import { FormDefinition } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { FormsService } from './forms.service';

/**
 * Files for `file`-type fields are uploaded ahead of the containing
 * submission (the field's answer is this row's id) — matching the MS Forms
 * UX where a file attaches to the question immediately, before "submit".
 * Stored as a DB blob (see FormFileUpload's schema comment for the tradeoff).
 */
@Injectable()
export class FileUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
  ) {}

  async upload(formSlug: string, fieldKey: string, file: Express.Multer.File, uploadedById: string | null) {
    const { form, definition } = await this.forms.getLatestVersion(formSlug);
    return this.uploadFor(form.id, definition, fieldKey, file, uploadedById);
  }

  async uploadPublic(token: string, fieldKey: string, file: Express.Multer.File) {
    const { form, definition } = await this.forms.getByPublicToken(token);
    return this.uploadFor(form.id, definition, fieldKey, file, null);
  }

  private async uploadFor(
    formId: string,
    definition: FormDefinition,
    fieldKey: string,
    file: Express.Multer.File | undefined,
    uploadedById: string | null,
  ) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'no file was uploaded' }]);

    const field = definition.fields.find((f) => f.key === fieldKey);
    if (!field || field.type !== 'file') {
      throw AppError.validation([{ path: 'fieldKey', message: `"${fieldKey}" is not a file field on this form` }]);
    }
    if (!field.acceptedMimeTypes.includes(file.mimetype)) {
      throw AppError.validation([
        { path: 'file', message: `"${file.mimetype}" is not an accepted file type for this question` },
      ]);
    }
    const maxBytes = field.maxSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw AppError.validation([
        { path: 'file', message: `file exceeds the ${field.maxSizeMb}MB limit for this question` },
      ]);
    }

    const row = await this.prisma.formFileUpload.create({
      data: {
        formId,
        fieldKey,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        // Buffer's ArrayBufferLike backing isn't assignable to Prisma's
        // Bytes (Uint8Array<ArrayBuffer>) type under every TS version this
        // monorepo resolves to — copy into a plain Uint8Array to sidestep it.
        data: new Uint8Array(file.buffer),
        uploadedById,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
    return row;
  }

  /** For an authenticated download — permission is checked at the controller (form_submissions:read). */
  async getForDownload(formSlug: string, uploadId: string) {
    const { form } = await this.forms.getLatestVersion(formSlug);
    const upload = await this.prisma.formFileUpload.findFirst({
      where: { id: uploadId, formId: form.id },
    });
    if (!upload) throw AppError.notFound('Upload', uploadId);
    return upload;
  }
}
