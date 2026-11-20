-- AlterTable: Add global RSVP deadline, silent grace period, manual lock, and closed message to AppConfig
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "rsvpOpen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "rsvpDeadlineDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "rsvpGracePeriodHours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "rsvpClosedMessage" TEXT NOT NULL DEFAULT '';
