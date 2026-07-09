import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Builder-uploaded design assets: option images, question/page media, and
 * theme background/logo. Distinct from FileUploadsService, which handles
 * RESPONDENT answer files — assets are authored by the form builder and
 * served publicly (they're decorative, not sensitive data).
 */
@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(formId: string, file: Express.Multer.File | undefined, createdById: string) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'no file was uploaded' }]);
    if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      throw AppError.validation([{ path: 'file', message: `"${file.mimetype}" is not an accepted image type` }]);
    }
    if (file.size > MAX_BYTES) {
      throw AppError.validation([{ path: 'file', message: 'image exceeds the 5MB limit' }]);
    }

    const form = await this.prisma.form.findUnique({ where: { id: formId }, select: { id: true } });
    if (!form) throw AppError.notFound('Form', formId);

    const row = await this.prisma.formAsset.create({
      data: {
        formId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        // see FileUploadsService for why Buffer needs this copy
        data: new Uint8Array(file.buffer),
        createdById,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
    return row;
  }

  /** Public read — no permission check, images must load in a plain <img src>. */
  async getForDownload(formId: string, assetId: string) {
    const asset = await this.prisma.formAsset.findFirst({ where: { id: assetId, formId } });
    if (!asset) throw AppError.notFound('Asset', assetId);
    return asset;
  }
}
