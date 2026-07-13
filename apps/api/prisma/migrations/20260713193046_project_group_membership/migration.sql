/*
  Warnings:

  - You are about to drop the column `projectGroupId` on the `User` table. Existing single-group
    assignments are migrated into the new `ProjectGroupMember` join table below before the column
    is dropped, so no membership data is lost.

*/
-- CreateTable
CREATE TABLE "ProjectGroupMember" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectGroupMember_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateIndex
CREATE INDEX "ProjectGroupMember_groupId_idx" ON "ProjectGroupMember"("groupId");

-- CreateIndex
CREATE INDEX "ProjectGroupMember_userId_idx" ON "ProjectGroupMember"("userId");

-- AddForeignKey
ALTER TABLE "ProjectGroupMember" ADD CONSTRAINT "ProjectGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGroupMember" ADD CONSTRAINT "ProjectGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BackfillData: carry each user's single project-group assignment into the new join table
INSERT INTO "ProjectGroupMember" ("userId", "groupId", "createdAt")
SELECT "id", "projectGroupId", CURRENT_TIMESTAMP FROM "User" WHERE "projectGroupId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_projectGroupId_fkey";

-- DropIndex
DROP INDEX "User_projectGroupId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "projectGroupId";
