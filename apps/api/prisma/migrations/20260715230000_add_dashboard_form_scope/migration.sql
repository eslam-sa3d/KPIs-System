-- CreateTable
CREATE TABLE "DashboardFormScope" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "formIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardFormScope_pkey" PRIMARY KEY ("id")
);
