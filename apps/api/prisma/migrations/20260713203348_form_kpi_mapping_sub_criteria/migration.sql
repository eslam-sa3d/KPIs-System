-- AlterTable
ALTER TABLE "FormKpiMapping" ADD COLUMN     "subCriteriaId" TEXT;

-- CreateIndex
CREATE INDEX "FormKpiMapping_subCriteriaId_idx" ON "FormKpiMapping"("subCriteriaId");

-- AddForeignKey
ALTER TABLE "FormKpiMapping" ADD CONSTRAINT "FormKpiMapping_subCriteriaId_fkey" FOREIGN KEY ("subCriteriaId") REFERENCES "SubCriteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
