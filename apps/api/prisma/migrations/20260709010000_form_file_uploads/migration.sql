-- CreateTable
CREATE TABLE "FormFileUpload" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormFileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormFileUpload_formId_idx" ON "FormFileUpload"("formId");

-- CreateIndex
CREATE INDEX "FormFileUpload_submissionId_idx" ON "FormFileUpload"("submissionId");

-- AddForeignKey
ALTER TABLE "FormFileUpload" ADD CONSTRAINT "FormFileUpload_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFileUpload" ADD CONSTRAINT "FormFileUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFileUpload" ADD CONSTRAINT "FormFileUpload_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
