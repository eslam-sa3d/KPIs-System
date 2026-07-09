-- DropForeignKey
ALTER TABLE "FormSubmission" DROP CONSTRAINT "FormSubmission_submittedById_fkey";

-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "FormSubmission" ALTER COLUMN "submittedById" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Form_publicToken_key" ON "Form"("publicToken");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

