-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN "editToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmission_editToken_key" ON "FormSubmission"("editToken");
