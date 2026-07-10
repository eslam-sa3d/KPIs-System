-- DropIndex
DROP INDEX "EvaluationAreaEntry_evaluationAreaId_personId_periodStart_p_key";

-- AlterTable
ALTER TABLE "EvaluationAreaEntry" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "context" TEXT,
ADD COLUMN     "reviewType" TEXT,
ADD COLUMN     "submissionId" TEXT;

-- AlterTable
ALTER TABLE "FormKpiMapping" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commentFieldKey" TEXT,
ADD COLUMN     "contextFieldKey" TEXT,
ADD COLUMN     "reviewType" TEXT NOT NULL DEFAULT 'peer';

-- CreateIndex
CREATE INDEX "EvaluationAreaEntry_submissionId_idx" ON "EvaluationAreaEntry"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAreaEntry_evaluationAreaId_personId_periodStart_p_key" ON "EvaluationAreaEntry"("evaluationAreaId", "personId", "periodStart", "periodEnd", "enteredById");

-- AddForeignKey
ALTER TABLE "EvaluationAreaEntry" ADD CONSTRAINT "EvaluationAreaEntry_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
