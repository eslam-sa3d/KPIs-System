-- CreateTable
CREATE TABLE "PerformanceLevel" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minScore" DECIMAL(65,30) NOT NULL,
    "maxScore" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceLevel_pkey" PRIMARY KEY ("id")
);
