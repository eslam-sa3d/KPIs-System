-- AlterTable
-- IF NOT EXISTS: this migration got stuck "started but never finished" on
-- production (likely two concurrent deploys racing and killing the first
-- mid-ALTER), which blocks all future `migrate deploy` runs until manually
-- resolved. Making the SQL idempotent means a `migrate resolve --rolled-back`
-- + retry (see render.yaml) is safe to run blind, without knowing whether
-- the column already landed before the process was killed.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
