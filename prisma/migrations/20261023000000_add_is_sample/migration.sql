-- AlterTable
ALTER TABLE "Media" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WeddingPartyMember" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Attraction" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RegistryItem" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InvitationCode" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SeatingTable" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;
