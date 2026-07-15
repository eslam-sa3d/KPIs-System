-- Let a form map several questions to the SAME Evaluation Area, distinguished
-- by subCriteriaId, without one mapping's scores silently overwriting another's.

-- DropIndex: (formId, evaluationAreaId) — one mapping per form per area, period
DROP INDEX "FormKpiMapping_formId_evaluationAreaId_key";

-- CreateIndex: (formId, evaluationAreaId, subCriteriaId) — now scoped by sub-criteria too
CREATE UNIQUE INDEX "FormKpiMapping_formId_evaluationAreaId_subCriteriaId_key" ON "FormKpiMapping"("formId", "evaluationAreaId", "subCriteriaId");

-- AlterTable: EvaluationAreaEntry gains a nullable link back to the mapping that produced it
ALTER TABLE "EvaluationAreaEntry" ADD COLUMN "mappingId" TEXT;

-- DropIndex: the old 5-column uniqueness key
DROP INDEX "EvaluationAreaEntry_area_person_period_evaluator_key";

-- CreateIndex: mappingId joins the key, so two mappings sharing an Evaluation Area
-- (different subCriteriaId) each keep their own entry per person/period/evaluator
CREATE UNIQUE INDEX "EvaluationAreaEntry_area_person_period_evaluator_mapping_key" ON "EvaluationAreaEntry"("evaluationAreaId", "personId", "periodStart", "periodEnd", "enteredById", "mappingId");

-- CreateIndex
CREATE INDEX "EvaluationAreaEntry_mappingId_idx" ON "EvaluationAreaEntry"("mappingId");

-- AddForeignKey
ALTER TABLE "EvaluationAreaEntry" ADD CONSTRAINT "EvaluationAreaEntry_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "FormKpiMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;
