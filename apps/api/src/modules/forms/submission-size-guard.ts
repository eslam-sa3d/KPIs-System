import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';

/**
 * summary()/buildExportTable() (SubmissionReportingService) and backfillMapping()
 * (FormKpiScoringService) all load every submission matching some filter into
 * memory and reduce client-side — necessary because the aggregation shape
 * differs per field type (select counts, likert matrices, ranking positions,
 * quiz-score distributions, ...) and expressing all of that as dynamic
 * per-field-type SQL would be its own significant, error-prone project. Below
 * this cap that's a fine, simple design; above it, it's an unbounded-memory
 * risk with no ceiling. Rather than let it degrade silently, all three fail
 * fast with a clear error once a form crosses this line — the real fix at
 * that point is a background export job, not a bigger cap.
 */
export const MAX_SUBMISSIONS_FOR_SYNC_REPORT = 20_000;

export async function assertSyncReportSizeOk(
  prisma: PrismaService,
  where: Prisma.FormSubmissionWhereInput,
): Promise<void> {
  const count = await prisma.formSubmission.count({ where });
  if (count > MAX_SUBMISSIONS_FOR_SYNC_REPORT) {
    throw new AppError(
      'CONFLICT',
      `This form has ${count} responses, above the ${MAX_SUBMISSIONS_FOR_SYNC_REPORT}-response limit for on-demand summaries/exports — this needs a background export job rather than a synchronous request. Contact an administrator.`,
    );
  }
}
