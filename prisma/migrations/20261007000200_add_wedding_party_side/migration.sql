-- CreateEnum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WeddingPartySide') THEN
        CREATE TYPE "WeddingPartySide" AS ENUM ('BRIDE', 'GROOM', 'JOINT');
    END IF;
END $$;

-- AlterTable
ALTER TABLE "WeddingPartyMember" ADD COLUMN IF NOT EXISTS "side" "WeddingPartySide";

