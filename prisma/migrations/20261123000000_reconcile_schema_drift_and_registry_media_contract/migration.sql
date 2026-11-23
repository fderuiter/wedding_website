-- Backfill Media records for legacy RegistryItem rows before enforcing RegistryItem.imageId
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
      SELECT DISTINCT ON (target_media_id)
        target_media_id,
        CASE
          WHEN is_safe_legacy_url THEN trimmed_image
          ELSE '/images/placeholder.png'
        END,
        NULL,
        CASE
          WHEN is_safe_legacy_url THEN false
          ELSE true
        END,
        r."isSample",
        r."createdAt",
        r."updatedAt"
      FROM (
        SELECT
          ri.*,
          CASE
            WHEN ri."imageId" IS NOT NULL AND LENGTH(BTRIM(ri."imageId")) BETWEEN 1 AND 255
              THEN BTRIM(ri."imageId")
            ELSE (
              SUBSTRING(md5('registry-item-media:' || ri."id") FROM 1 FOR 8) || '-' ||
              SUBSTRING(md5('registry-item-media:' || ri."id") FROM 9 FOR 4) || '-4' ||
              SUBSTRING(md5('registry-item-media:' || ri."id") FROM 14 FOR 3) || '-a' ||
              SUBSTRING(md5('registry-item-media:' || ri."id") FROM 18 FOR 3) || '-' ||
              SUBSTRING(md5('registry-item-media:' || ri."id") FROM 21 FOR 12)
            )
          END AS target_media_id,
          BTRIM(COALESCE(ri."image", '')) AS trimmed_image,
          (
            ri."image" IS NOT NULL
            AND BTRIM(ri."image") <> ''
            AND LENGTH(BTRIM(ri."image")) <= 2000
            AND POSITION(E'\\' IN BTRIM(ri."image")) = 0
            AND BTRIM(ri."image") !~* '%(00|5c)'
            AND (
              BTRIM(ri."image") ~ '^https?://[^/\s?#]+(/[^\s]*)?$'
              OR BTRIM(ri."image") ~ '^data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$'
              OR (
                BTRIM(ri."image") !~ '^[A-Za-z][A-Za-z0-9+.-]*:'
                AND POSITION('..' IN BTRIM(ri."image")) = 0
                AND POSITION('//' IN BTRIM(ri."image")) = 0
              )
            )
          ) AS is_safe_legacy_url
        FROM "RegistryItem" ri
        WHERE ri."imageId" IS NULL
           OR LENGTH(BTRIM(ri."imageId")) NOT BETWEEN 1 AND 255
           OR NOT EXISTS (
             SELECT 1 FROM "Media" m WHERE m."id" = BTRIM(ri."imageId")
           )
      ) r
      ORDER BY target_media_id, r."createdAt" ASC
      ON CONFLICT ("id") DO NOTHING
    $sql$;
  ELSE
    INSERT INTO "Media" ("id", "url", "altText", "isDecorative", "isSample", "createdAt", "updatedAt")
    SELECT DISTINCT ON (target_media_id)
      target_media_id,
      '/images/placeholder.png',
      NULL,
      true,
      r."isSample",
      r."createdAt",
      r."updatedAt"
    FROM (
      SELECT
        ri.*,
        CASE
          WHEN ri."imageId" IS NOT NULL AND LENGTH(BTRIM(ri."imageId")) BETWEEN 1 AND 255
            THEN BTRIM(ri."imageId")
          ELSE (
            SUBSTRING(md5('registry-item-media:' || ri."id") FROM 1 FOR 8) || '-' ||
            SUBSTRING(md5('registry-item-media:' || ri."id") FROM 9 FOR 4) || '-4' ||
            SUBSTRING(md5('registry-item-media:' || ri."id") FROM 14 FOR 3) || '-a' ||
            SUBSTRING(md5('registry-item-media:' || ri."id") FROM 18 FOR 3) || '-' ||
            SUBSTRING(md5('registry-item-media:' || ri."id") FROM 21 FOR 12)
          )
        END AS target_media_id
      FROM "RegistryItem" ri
      WHERE ri."imageId" IS NULL
         OR LENGTH(BTRIM(ri."imageId")) NOT BETWEEN 1 AND 255
         OR NOT EXISTS (
           SELECT 1 FROM "Media" m WHERE m."id" = BTRIM(ri."imageId")
         )
    ) r
    ORDER BY target_media_id, r."createdAt" ASC
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;

UPDATE "RegistryItem" r
SET "imageId" = CASE
  WHEN r."imageId" IS NOT NULL AND LENGTH(BTRIM(r."imageId")) BETWEEN 1 AND 255
    THEN BTRIM(r."imageId")
  ELSE (
    SUBSTRING(md5('registry-item-media:' || r."id") FROM 1 FOR 8) || '-' ||
    SUBSTRING(md5('registry-item-media:' || r."id") FROM 9 FOR 4) || '-4' ||
    SUBSTRING(md5('registry-item-media:' || r."id") FROM 14 FOR 3) || '-a' ||
    SUBSTRING(md5('registry-item-media:' || r."id") FROM 18 FOR 3) || '-' ||
    SUBSTRING(md5('registry-item-media:' || r."id") FROM 21 FOR 12)
  )
END
WHERE r."imageId" IS NULL
   OR r."imageId" <> BTRIM(r."imageId")
   OR LENGTH(BTRIM(r."imageId")) NOT BETWEEN 1 AND 255
   OR NOT EXISTS (
     SELECT 1 FROM "Media" m WHERE m."id" = r."imageId"
   );

-- Clear orphaned optional foreign-key references before adding constraints
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
  AND NOT EXISTS (SELECT 1 FROM "InvitationCode" ic WHERE ic."id" = c."invitationCodeId");

-- AlterTable
ALTER TABLE "AppConfig" ALTER COLUMN "seoKeywords" SET DEFAULT '{{partner1Name}} and {{partner2Name}}''s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding, {{partner1Name}} and {{partner2Name}} registry, wedding details, wedding ceremony, wedding reception',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Attraction" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ContentNode" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Contributor" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InvitationCode" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Media" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RegistryItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- allow-destructive: Contract phase enforcing non-null RegistryItem.imageId after backfilling Media records for all legacy items
ALTER TABLE "RegistryItem" ALTER COLUMN "imageId" SET NOT NULL;

-- allow-destructive: Contract phase dropping deprecated RegistryItem.image column after migrating all legacy URLs to Media records
ALTER TABLE "RegistryItem" DROP COLUMN IF EXISTS "image";

-- AlterTable
ALTER TABLE "WeddingPartyMember" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SnapshotVersion_entityType_entityId_createdAt_idx" ON "SnapshotVersion"("entityType", "entityId", "createdAt" DESC);

-- AddForeignKey
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
