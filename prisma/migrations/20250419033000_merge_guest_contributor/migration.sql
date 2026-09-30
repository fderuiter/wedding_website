-- allow-destructive: Historical merge of Guest into Contributor
-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "isPlusOne" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "amount" SET DEFAULT 0,
ALTER COLUMN "date" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "registryItemId" DROP NOT NULL;

-- Migrate Data from Guest to Contributor
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Guest') THEN
    INSERT INTO "Contributor" ("id", "name", "email", "isPlusOne", "createdAt", "updatedAt", "amount", "date")
    SELECT 
      "id",
      "firstName" || ' ' || "lastName" AS "name",
      "email",
      "isPlusOne",
      "createdAt",
      "updatedAt",
      0 AS "amount",
      CURRENT_TIMESTAMP AS "date"
    FROM "Guest";

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Rsvp') THEN
      ALTER TABLE "Rsvp" DROP CONSTRAINT IF EXISTS "Rsvp_guestId_fkey";
      DROP TABLE IF EXISTS "Rsvp";
    END IF;

    DROP TABLE IF EXISTS "Guest";
  END IF;
END $$;
