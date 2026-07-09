-- AlterTable: assets are uploaded during drafting, before a Form row exists —
-- formId starts null and is claimed when the definition referencing it publishes.
ALTER TABLE "FormAsset" ALTER COLUMN "formId" DROP NOT NULL;
