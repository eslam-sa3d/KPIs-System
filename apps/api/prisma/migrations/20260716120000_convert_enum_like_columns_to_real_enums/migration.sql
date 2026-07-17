-- EvaluationArea.cadence: String -> enum, in-place cast (no data loss)
CREATE TYPE "EvaluationAreaCadence" AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');
ALTER TABLE "EvaluationArea"
  ALTER COLUMN "cadence" TYPE "EvaluationAreaCadence" USING ("cadence"::"EvaluationAreaCadence");

-- Form.status: String -> enum, in-place cast (no data loss)
CREATE TYPE "FormStatus" AS ENUM ('draft', 'published', 'archived');
ALTER TABLE "Form" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Form"
  ALTER COLUMN "status" TYPE "FormStatus" USING ("status"::"FormStatus");
ALTER TABLE "Form" ALTER COLUMN "status" SET DEFAULT 'draft';

-- RolePermission.scope: String -> enum, in-place cast (no data loss)
CREATE TYPE "PermissionScope" AS ENUM ('all', 'department', 'project_group', 'own', 'level');
ALTER TABLE "RolePermission" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "RolePermission"
  ALTER COLUMN "scope" TYPE "PermissionScope" USING ("scope"::"PermissionScope");
ALTER TABLE "RolePermission" ALTER COLUMN "scope" SET DEFAULT 'all';
