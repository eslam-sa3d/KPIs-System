-- AlterTable
ALTER TABLE "Form" ADD COLUMN "folder" TEXT;

-- AlterTable
ALTER TABLE "FormCollaborator" ADD COLUMN "canViewResponses" BOOLEAN NOT NULL DEFAULT false;
