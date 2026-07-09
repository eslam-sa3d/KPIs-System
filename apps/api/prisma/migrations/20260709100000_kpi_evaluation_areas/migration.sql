-- DropForeignKey
ALTER TABLE "KpiEntry" DROP CONSTRAINT "KpiEntry_kpiId_fkey";
ALTER TABLE "KpiEntry" DROP CONSTRAINT "KpiEntry_enteredById_fkey";

-- DropTable
DROP TABLE "KpiEntry";

-- DropIndex
DROP INDEX "Kpi_code_key";

-- AlterTable
ALTER TABLE "Kpi"
  DROP COLUMN "code",
  DROP COLUMN "description",
  DROP COLUMN "unit",
  DROP COLUMN "direction",
  DROP COLUMN "target",
  DROP COLUMN "cadence",
  DROP COLUMN "metadata";

-- CreateTable
CREATE TABLE "EvaluationArea" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationAreaEntry" (
    "id" TEXT NOT NULL,
    "evaluationAreaId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "enteredById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationAreaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationArea_kpiId_idx" ON "EvaluationArea"("kpiId");

-- CreateIndex
CREATE INDEX "EvaluationAreaEntry_evaluationAreaId_periodStart_idx" ON "EvaluationAreaEntry"("evaluationAreaId", "periodStart");

-- CreateIndex
CREATE INDEX "EvaluationAreaEntry_personId_idx" ON "EvaluationAreaEntry"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAreaEntry_evaluationAreaId_personId_periodStart__key" ON "EvaluationAreaEntry"("evaluationAreaId", "personId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "EvaluationArea" ADD CONSTRAINT "EvaluationArea_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAreaEntry" ADD CONSTRAINT "EvaluationAreaEntry_evaluationAreaId_fkey" FOREIGN KEY ("evaluationAreaId") REFERENCES "EvaluationArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAreaEntry" ADD CONSTRAINT "EvaluationAreaEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAreaEntry" ADD CONSTRAINT "EvaluationAreaEntry_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
