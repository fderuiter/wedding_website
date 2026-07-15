UPDATE "SnapshotVersion" SET "entityType" = CONCAT(UPPER(SUBSTRING("entityType", 1, 1)), SUBSTRING("entityType", 2));
