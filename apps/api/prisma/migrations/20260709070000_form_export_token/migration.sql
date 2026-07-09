-- AlterTable
ALTER TABLE "Form" ADD COLUMN "exportToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Form_exportToken_key" ON "Form"("exportToken");
