-- AlterTable: anonymous public-link respondents get a cookie-based fingerprint
-- so oneResponsePerUser can be enforced without an account (previously
-- signed-in submitters only).
ALTER TABLE "FormSubmission" ADD COLUMN "respondentFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "FormSubmission_respondentFingerprint_idx" ON "FormSubmission"("respondentFingerprint");
