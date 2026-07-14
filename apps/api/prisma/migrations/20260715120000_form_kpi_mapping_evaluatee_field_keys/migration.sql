-- AlterTable
-- `evaluateeFieldKey` (single, optional) is replaced by `evaluateeFieldKeys`
-- (array, default empty) so a mapping can name several candidate fields —
-- tried in order, first-answered-wins — instead of exactly one. Backfill
-- existing single values into the new array before dropping the old column.
ALTER TABLE "FormKpiMapping" ADD COLUMN "evaluateeFieldKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "FormKpiMapping"
SET "evaluateeFieldKeys" = CASE
  WHEN "evaluateeFieldKey" IS NOT NULL AND "evaluateeFieldKey" != '' THEN ARRAY["evaluateeFieldKey"]
  ELSE ARRAY[]::TEXT[]
END;

ALTER TABLE "FormKpiMapping" DROP COLUMN "evaluateeFieldKey";
