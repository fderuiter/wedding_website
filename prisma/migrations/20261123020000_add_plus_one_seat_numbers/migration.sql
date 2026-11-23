-- Add inline party plus-one seat numbers array to InvitationCode
ALTER TABLE "InvitationCode" ADD COLUMN IF NOT EXISTS "plusOneSeatNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
