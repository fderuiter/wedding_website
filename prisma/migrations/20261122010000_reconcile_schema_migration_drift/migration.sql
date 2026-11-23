-- Reconcile historical schema drift between prisma/migrations/ and prisma/schema.prisma

-- 1. Backfill legacy RegistryItem.image URLs into Media before dropping RegistryItem.image
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = CURRENT_SCHEMA()
      AND table_name = 'RegistryItem'
      AND column_name = 'image'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "Media" ("id", "url", "altText", "isDecorative", "isSample", "createdAt", "updatedAt")
      SELECT
        'legacy-registry-media-' || r."id",
        BTRIM(r."image"),
        r."name",
        false,
        r."isSample",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "RegistryItem" r
      WHERE (r."imageId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Media" m WHERE m."id" = r."imageId"))
        AND r."image" IS NOT NULL
        AND BTRIM(r."image") <> ''
      ON CONFLICT ("id") DO NOTHING
    $sql$;

    EXECUTE $sql$
      UPDATE "RegistryItem" r
      SET "imageId" = 'legacy-registry-media-' || r."id"
      WHERE (r."imageId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Media" m WHERE m."id" = r."imageId"))
        AND r."image" IS NOT NULL
        AND BTRIM(r."image") <> ''
    $sql$;
  END IF;
END $$;

-- 2. Backfill any remaining NULL or orphaned RegistryItem.imageId values with a fallback placeholder Media row
INSERT INTO "Media" ("id", "url", "altText", "isDecorative", "isSample", "createdAt", "updatedAt")
SELECT
  '00000000-0000-4000-8000-000000000001',
  '/images/placeholder.png',
  NULL,
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "RegistryItem" r
  WHERE r."imageId" IS NULL
     OR NOT EXISTS (SELECT 1 FROM "Media" m WHERE m."id" = r."imageId")
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "RegistryItem" r
SET "imageId" = '00000000-0000-4000-8000-000000000001'
WHERE r."imageId" IS NULL
   OR NOT EXISTS (SELECT 1 FROM "Media" m WHERE m."id" = r."imageId");

-- 3. Clean orphaned nullable relation IDs before enforcing foreign key constraints
UPDATE "WeddingPartyMember" w
SET "photoId" = NULL
WHERE w."photoId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Media" m WHERE m."id" = w."photoId");

UPDATE "Attraction" a
SET "imageId" = NULL
WHERE a."imageId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Media" m WHERE m."id" = a."imageId");

UPDATE "Contributor" c
SET "registryItemId" = NULL
WHERE c."registryItemId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "RegistryItem" r WHERE r."id" = c."registryItemId");

UPDATE "Contributor" c
SET "invitationCodeId" = NULL
WHERE c."invitationCodeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "InvitationCode" i WHERE i."id" = c."invitationCodeId");

-- 4. Align AppConfig column defaults and Prisma @updatedAt column defaults
ALTER TABLE "AppConfig"
  ALTER COLUMN "weddingDate" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "seoKeywords" SET DEFAULT '{{partner1Name}} and {{partner2Name}}''s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding, {{partner1Name}} and {{partner2Name}} registry, wedding details, wedding ceremony, wedding reception',
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Attraction" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ContentNode" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Contributor" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "InvitationCode" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Media" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "RegistryItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "WeddingPartyMember" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 5. Contract phase for RegistryItem.imageId nullability and deprecated RegistryItem.image column
-- allow-destructive: Contract phase enforcing NOT NULL on RegistryItem.imageId after backfilling legacy image URLs and placeholder Media records
ALTER TABLE "RegistryItem" ALTER COLUMN "imageId" SET NOT NULL;

-- allow-destructive: Contract phase dropping deprecated RegistryItem.image column after migrating URLs to Media and switching runtime code to RegistryItem.imageId
ALTER TABLE "RegistryItem" DROP COLUMN IF EXISTS "image";

-- 6. Add SnapshotVersion composite index for entity history lookups
CREATE INDEX IF NOT EXISTS "SnapshotVersion_entityType_entityId_createdAt_idx"
  ON "SnapshotVersion"("entityType", "entityId", "createdAt" DESC);

-- 7. Add reconciled foreign key constraints idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WeddingPartyMember_photoId_fkey'
      AND connamespace = CURRENT_SCHEMA()::regnamespace
  ) THEN
    ALTER TABLE "WeddingPartyMember"
      ADD CONSTRAINT "WeddingPartyMember_photoId_fkey"
      FOREIGN KEY ("photoId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Attraction_imageId_fkey'
      AND connamespace = CURRENT_SCHEMA()::regnamespace
  ) THEN
    ALTER TABLE "Attraction"
      ADD CONSTRAINT "Attraction_imageId_fkey"
      FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RegistryItem_imageId_fkey'
      AND connamespace = CURRENT_SCHEMA()::regnamespace
  ) THEN
    ALTER TABLE "RegistryItem"
      ADD CONSTRAINT "RegistryItem_imageId_fkey"
      FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Contributor_registryItemId_fkey'
      AND connamespace = CURRENT_SCHEMA()::regnamespace
  ) THEN
    ALTER TABLE "Contributor"
      ADD CONSTRAINT "Contributor_registryItemId_fkey"
      FOREIGN KEY ("registryItemId") REFERENCES "RegistryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Contributor_invitationCodeId_fkey'
      AND connamespace = CURRENT_SCHEMA()::regnamespace
  ) THEN
    ALTER TABLE "Contributor"
      ADD CONSTRAINT "Contributor_invitationCodeId_fkey"
      FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
