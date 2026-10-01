-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN "partner1Name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "partner2Name" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "brideName" DROP NOT NULL,
ALTER COLUMN "groomName" DROP NOT NULL;

-- Backfill partner names from legacy bride/groom fields if available
UPDATE "AppConfig"
SET "partner1Name" = COALESCE("brideName", ''),
    "partner2Name" = COALESCE("groomName", '')
WHERE ("partner1Name" = '' OR "partner1Name" IS NULL)
  AND (("brideName" IS NOT NULL AND "brideName" != '') OR ("groomName" IS NOT NULL AND "groomName" != ''));
