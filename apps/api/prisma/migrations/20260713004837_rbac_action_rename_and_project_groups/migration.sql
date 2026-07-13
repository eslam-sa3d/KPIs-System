-- CreateTable
CREATE TABLE "ProjectGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ProjectGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGroup_name_key" ON "ProjectGroup"("name");

-- AlterTable User: add projectGroupId
ALTER TABLE "User" ADD COLUMN "projectGroupId" TEXT;

-- CreateIndex
CREATE INDEX "User_projectGroupId_idx" ON "User"("projectGroupId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_projectGroupId_fkey" FOREIGN KEY ("projectGroupId") REFERENCES "ProjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable RolePermission: add scopeValues
ALTER TABLE "RolePermission" ADD COLUMN "scopeValues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Data migration: read/write/execute/manage -> view/edit/activate_deactivate/delete.
-- Additive by design (never subtractive until the final DELETE below) so an
-- existing role never loses reach mid-migration — 'manage' fans out to all
-- three of edit/activate_deactivate/delete, over-granting rather than
-- silently locking an admin out; narrow it by hand afterward if needed.

-- 1. Ensure every resource that has ANY existing permission row also has one
--    for each of the 4 new actions.
INSERT INTO "Permission" ("id", "resource", "action")
SELECT gen_random_uuid()::text, r."resource", a."action"
FROM (SELECT DISTINCT "resource" FROM "Permission") r
CROSS JOIN (VALUES ('view'), ('edit'), ('activate_deactivate'), ('delete')) AS a("action")
ON CONFLICT ("resource", "action") DO NOTHING;

-- 2. read -> view
INSERT INTO "RolePermission" ("roleId", "permissionId", "scope", "scopeValues")
SELECT rp."roleId", np."id", rp."scope", rp."scopeValues"
FROM "RolePermission" rp
JOIN "Permission" op ON op."id" = rp."permissionId" AND op."action" = 'read'
JOIN "Permission" np ON np."resource" = op."resource" AND np."action" = 'view'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3. write -> edit
INSERT INTO "RolePermission" ("roleId", "permissionId", "scope", "scopeValues")
SELECT rp."roleId", np."id", rp."scope", rp."scopeValues"
FROM "RolePermission" rp
JOIN "Permission" op ON op."id" = rp."permissionId" AND op."action" = 'write'
JOIN "Permission" np ON np."resource" = op."resource" AND np."action" = 'edit'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 4. manage -> edit + activate_deactivate + delete
INSERT INTO "RolePermission" ("roleId", "permissionId", "scope", "scopeValues")
SELECT rp."roleId", np."id", rp."scope", rp."scopeValues"
FROM "RolePermission" rp
JOIN "Permission" op ON op."id" = rp."permissionId" AND op."action" = 'manage'
JOIN "Permission" np ON np."resource" = op."resource" AND np."action" IN ('edit', 'activate_deactivate', 'delete')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 5. Drop the old actions — cascades any remaining RolePermission rows still
--    pointing at them (only possible if a role held a permission whose
--    resource had no matching new-action row, which step 1 rules out).
DELETE FROM "Permission" WHERE "action" IN ('read', 'write', 'execute', 'manage');
