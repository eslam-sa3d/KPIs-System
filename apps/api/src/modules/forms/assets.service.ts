import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Builder-uploaded design assets: option images, question/page media, and
 * theme background/logo. Distinct from FileUploadsService, which handles
 * RESPONDENT answer files. Uploaded while a form is still a draft — before
 * any Form row exists — so an asset starts orphaned (formId null) and is
 * claimed once the definition referencing it is actually published; the
 * exact pattern FileUploadsService already uses for pre-submit uploads.
 * Served publicly: these are decorative, not sensitive data.
 */
@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(file: Express.Multer.File | undefined, createdById: string) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'no file was uploaded' }]);
    if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      throw AppError.validation([{ path: 'file', message: `"${file.mimetype}" is not an accepted image type` }]);
    }
    if (file.size > MAX_BYTES) {
      throw AppError.validation([{ path: 'file', message: 'image exceeds the 5MB limit' }]);
    }

    return this.prisma.formAsset.create({
      data: {
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        // see FileUploadsService for why Buffer needs this copy
        data: new Uint8Array(file.buffer),
        createdById,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
  }

  /** Public read — no permission check, images must load in a plain <img src>. */
  async getForDownload(assetId: string) {
    const asset = await this.prisma.formAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw AppError.notFound('Asset', assetId);
    return asset;
  }

  /** Attaches every referenced, still-orphaned asset to the form it was just published on. */
  async claim(formId: string, assetIds: string[]) {
    if (assetIds.length === 0) return;
    await this.prisma.formAsset.updateMany({
      where: { id: { in: assetIds }, formId: null },
      data: { formId },
    });
  }
}
