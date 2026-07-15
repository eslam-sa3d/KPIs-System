-- AlterTable
ALTER TABLE "User" ADD COLUMN "jobTitleId" TEXT;

-- CreateIndex
CREATE INDEX "User_jobTitleId_idx" ON "User"("jobTitleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
