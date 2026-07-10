-- DropForeignKey
ALTER TABLE "FormKpiMapping" DROP CONSTRAINT IF EXISTS "FormKpiMapping_formId_fkey";
ALTER TABLE "FormKpiMapping" DROP CONSTRAINT IF EXISTS "FormKpiMapping_evaluationAreaId_fkey";

-- DropTable
DROP TABLE IF EXISTS "FormKpiMapping";
