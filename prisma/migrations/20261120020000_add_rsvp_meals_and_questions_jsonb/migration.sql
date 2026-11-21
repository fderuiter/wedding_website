-- AlterTable: Add JSONB meal options and custom RSVP questions to SubEvent
ALTER TABLE "SubEvent" ADD COLUMN IF NOT EXISTS "mealOptions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SubEvent" ADD COLUMN IF NOT EXISTS "customQuestions" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: Add JSONB meal selections, custom answers, and plus-one names to SubEventRsvp
ALTER TABLE "SubEventRsvp" ADD COLUMN IF NOT EXISTS "mealSelections" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SubEventRsvp" ADD COLUMN IF NOT EXISTS "customAnswers" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "SubEventRsvp" ADD COLUMN IF NOT EXISTS "plusOneNames" JSONB NOT NULL DEFAULT '[]';
