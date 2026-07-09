-- AlterTable
ALTER TABLE "Kpi" ADD COLUMN "weight" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "SubCriteria" (
    "id" TEXT NOT NULL,
    "evaluationAreaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubCriteria_evaluationAreaId_idx" ON "SubCriteria"("evaluationAreaId");

-- AddForeignKey
ALTER TABLE "SubCriteria" ADD CONSTRAINT "SubCriteria_evaluationAreaId_fkey" FOREIGN KEY ("evaluationAreaId") REFERENCES "EvaluationArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
