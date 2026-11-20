-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN "confirmationEmailSentAt" TIMESTAMP(3),
ADD COLUMN "alertEmailSentAt" TIMESTAMP(3);
