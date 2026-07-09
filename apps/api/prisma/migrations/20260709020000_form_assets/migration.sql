-- CreateTable
CREATE TABLE "FormAsset" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormAsset_formId_idx" ON "FormAsset"("formId");

-- AddForeignKey
ALTER TABLE "FormAsset" ADD CONSTRAINT "FormAsset_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAsset" ADD CONSTRAINT "FormAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
