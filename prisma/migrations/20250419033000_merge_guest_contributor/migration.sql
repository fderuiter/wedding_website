-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN "email" TEXT,
ADD COLUMN "isPlusOne" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "amount" SET DEFAULT 0,
ALTER COLUMN "date" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "registryItemId" DROP NOT NULL;

-- Migrate Data from Guest to Contributor
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

-- DropForeignKey
ALTER TABLE "Rsvp" DROP CONSTRAINT "Rsvp_guestId_fkey";

-- DropTable
DROP TABLE "Rsvp";

-- DropTable
DROP TABLE "Guest";
