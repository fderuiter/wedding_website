-- AlterTable
ALTER TABLE "InvitationCode" ADD COLUMN     "householdName" TEXT,
ADD COLUMN     "partyGroup" TEXT,
ADD COLUMN     "partyTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "InvitationCode_partyTags_idx" ON "InvitationCode" USING GIN ("partyTags");
