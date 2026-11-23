-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN IF NOT EXISTS "refundedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reminderEmailSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contributor_stripeChargeId_idx" ON "Contributor"("stripeChargeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contributor_status_idx" ON "Contributor"("status");
