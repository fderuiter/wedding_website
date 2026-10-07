-- AlterTable
ALTER TABLE "InvitationCode" ADD COLUMN "email" TEXT,
ADD COLUMN "dietaryNotes" TEXT,
ADD COLUMN "plusOneAllocations" INTEGER DEFAULT 0,
ADD COLUMN "extraFields" JSONB;
