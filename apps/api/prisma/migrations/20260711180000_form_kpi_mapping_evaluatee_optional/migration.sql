-- Null evaluateeFieldKey now means self-assessment: the submitter scores
-- themselves instead of a distinct "person" field's answer (see
-- SubmissionsService.applyOneMapping).
ALTER TABLE "FormKpiMapping" ALTER COLUMN "evaluateeFieldKey" DROP NOT NULL;
