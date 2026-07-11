-- CreateTable
CREATE TABLE "FormKpiMapping" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "evaluationAreaId" TEXT NOT NULL,
    "evaluateeFieldKey" TEXT NOT NULL,
    "scoreFieldKey" TEXT NOT NULL,
    "reviewType" TEXT NOT NULL DEFAULT 'peer',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "contextFieldKey" TEXT,
    "commentFieldKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormKpiMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormKpiMapping_evaluationAreaId_idx" ON "FormKpiMapping"("evaluationAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "FormKpiMapping_formId_evaluationAreaId_key" ON "FormKpiMapping"("formId", "evaluationAreaId");

-- AddForeignKey
ALTER TABLE "FormKpiMapping" ADD CONSTRAINT "FormKpiMapping_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormKpiMapping" ADD CONSTRAINT "FormKpiMapping_evaluationAreaId_fkey" FOREIGN KEY ("evaluationAreaId") REFERENCES "EvaluationArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
