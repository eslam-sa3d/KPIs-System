-- Whether a person should be scored/tracked by the KPI system at all.
-- Defaults true so every existing user keeps showing up in the dashboard's
-- team overview exactly as before this column existed.
ALTER TABLE "User" ADD COLUMN "isKpiApplicable" BOOLEAN NOT NULL DEFAULT true;
