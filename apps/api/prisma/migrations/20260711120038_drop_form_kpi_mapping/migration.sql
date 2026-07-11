/*
  Warnings:

  - You are about to drop the `FormKpiMapping` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FormKpiMapping" DROP CONSTRAINT "FormKpiMapping_evaluationAreaId_fkey";

-- DropForeignKey
ALTER TABLE "FormKpiMapping" DROP CONSTRAINT "FormKpiMapping_formId_fkey";

-- DropTable
DROP TABLE "FormKpiMapping";
