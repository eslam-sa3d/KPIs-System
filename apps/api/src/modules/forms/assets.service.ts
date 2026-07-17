import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

// SVG is deliberately excluded — these are served back publicly with no
// Content-Disposition (see getForDownload), and an SVG can carry an inline
// <script>/event-handler payload, making it a stored-XSS vector unlike the
// other accepted raster formats.
const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Builder-uploaded design assets: option images, question/page media.
 * Distinct from FileUploadsService, which handles
 * RESPONDENT answer files. Uploaded while a form is still a draft — before
 * any Form row exists — so an asset starts orphaned (formId null) and is
 * claimed once the definition referencing it is actually published; the
 * exact pattern FileUploadsService already uses for pre-submit uploads.
 * Served publicly: these are decorative, not sensitive data.
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** An asset is uploaded while a form is still a draft (see class comment) — if the draft
   *  is abandoned without publishing, that row is orphaned forever without this sweep. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepOrphanedAssets(): Promise<void> {
    const { count } = await this.prisma.formAsset.deleteMany({
      where: { formId: null, createdAt: { lt: new Date(Date.now() - ORPHAN_AGE_MS) } },
    });
    if (count > 0) this.logger.log(`swept ${count} orphaned design asset(s)`);
  }

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
