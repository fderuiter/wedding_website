-- CreateTable
CREATE TABLE "AuthLockout" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthLockout_pkey" PRIMARY KEY ("keyHash")
);

-- CreateIndex
CREATE INDEX "AuthLockout_resetAt_idx" ON "AuthLockout"("resetAt");
