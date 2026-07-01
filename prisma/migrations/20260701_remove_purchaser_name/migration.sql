-- Migrate existing purchaserName data to Contributor table
INSERT INTO "Contributor" ("id", "name", "email", "isPlusOne", "amount", "date", "registryItemId", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    "purchaserName",
    NULL,
    false,
    CASE WHEN "amountContributed" > 0 THEN "amountContributed" ELSE "price" END,
    CURRENT_TIMESTAMP,
    "id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "RegistryItem"
WHERE "purchaserName" IS NOT NULL;

-- Drop the column
ALTER TABLE "RegistryItem" DROP COLUMN "purchaserName";
