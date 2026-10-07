-- CreateEnum
CREATE TYPE "WeddingPartySide" AS ENUM ('BRIDE', 'GROOM', 'JOINT');

-- AlterTable
ALTER TABLE "WeddingPartyMember" ADD COLUMN "side" "WeddingPartySide";
