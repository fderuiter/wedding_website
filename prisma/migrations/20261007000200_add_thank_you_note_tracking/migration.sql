-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN "thankYouStatus" TEXT NOT NULL DEFAULT 'Unsent',
ADD COLUMN "thankYouSentAt" TIMESTAMP(3),
ADD COLUMN "thankYouNote" TEXT;
