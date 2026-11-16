-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN "stripePaymentIntentId" TEXT,
ADD COLUMN "stripeChargeId" TEXT,
ADD COLUMN "transactionTimestamp" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contributor_stripePaymentIntentId_idx" ON "Contributor"("stripePaymentIntentId");
