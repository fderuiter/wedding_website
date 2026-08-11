-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN "showCountdown" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showAddToCalendar" BOOLEAN NOT NULL DEFAULT true;
