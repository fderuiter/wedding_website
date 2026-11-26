-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "invitationCodeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PRIMARY',
    "email" TEXT,
    "phone" TEXT,
    "dietaryNotes" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "seatNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubEventMemberRsvp" (
    "id" TEXT NOT NULL,
    "subEventRsvpId" TEXT NOT NULL,
    "householdMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mealOptionId" TEXT,
    "dietaryNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubEventMemberRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseholdMember_invitationCodeId_displayOrder_idx" ON "HouseholdMember"("invitationCodeId", "displayOrder");

-- CreateIndex
CREATE INDEX "HouseholdMember_email_idx" ON "HouseholdMember"("email");

-- CreateIndex
CREATE INDEX "HouseholdMember_phone_idx" ON "HouseholdMember"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SubEventMemberRsvp_subEventRsvpId_householdMemberId_key" ON "SubEventMemberRsvp"("subEventRsvpId", "householdMemberId");

-- CreateIndex
CREATE INDEX "SubEventMemberRsvp_householdMemberId_idx" ON "SubEventMemberRsvp"("householdMemberId");

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_invitationCodeId_fkey" FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubEventMemberRsvp" ADD CONSTRAINT "SubEventMemberRsvp_subEventRsvpId_fkey" FOREIGN KEY ("subEventRsvpId") REFERENCES "SubEventRsvp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubEventMemberRsvp" ADD CONSTRAINT "SubEventMemberRsvp_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotent Backfill 1: Primary HouseholdMember rows (displayOrder = 0) for every InvitationCode
INSERT INTO "HouseholdMember" (
    "id",
    "invitationCodeId",
    "fullName",
    "firstName",
    "lastName",
    "role",
    "email",
    "phone",
    "dietaryNotes",
    "tags",
    "displayOrder",
    "seatNumber",
    "createdAt",
    "updatedAt"
)
SELECT
    substr(src.hash_hex, 1, 8) || '-' || substr(src.hash_hex, 9, 4) || '-4' || substr(src.hash_hex, 14, 3) || '-a' || substr(src.hash_hex, 18, 3) || '-' || substr(src.hash_hex, 21, 12) AS "id",
    src."invitationCodeId",
    src."fullName",
    NULLIF(split_part(src."fullName", ' ', 1), '') AS "firstName",
    NULLIF(BTRIM(substr(src."fullName", char_length(split_part(src."fullName", ' ', 1)) + 1)), '') AS "lastName",
    'PRIMARY' AS "role",
    src."email",
    src."phone",
    src."dietaryNotes",
    src."tags",
    0 AS "displayOrder",
    src."seatNumber",
    src."createdAt",
    src."updatedAt"
FROM (
    SELECT
        ic."id" AS "invitationCodeId",
        md5('hm:' || ic."id" || ':0') AS hash_hex,
        COALESCE(NULLIF(regexp_replace(BTRIM(ic."guestName"), '\s+', ' ', 'g'), ''), 'Primary Guest') AS "fullName",
        NULLIF(BTRIM(ic."email"), '') AS "email",
        CASE
            WHEN ic."extraFields" IS NOT NULL
                 AND jsonb_typeof(ic."extraFields") = 'object'
                 AND jsonb_typeof(ic."extraFields" -> 'phone') = 'string'
            THEN NULLIF(BTRIM(ic."extraFields" ->> 'phone'), '')
            ELSE NULL
        END AS "phone",
        NULLIF(BTRIM(ic."dietaryNotes"), '') AS "dietaryNotes",
        COALESCE(ic."partyTags", ARRAY[]::TEXT[]) AS "tags",
        ic."seatNumber",
        ic."createdAt",
        ic."updatedAt"
    FROM "InvitationCode" ic
    WHERE NOT EXISTS (
        SELECT 1
        FROM "HouseholdMember" hm
        WHERE hm."invitationCodeId" = ic."id"
          AND hm."displayOrder" = 0
    )
) src
ON CONFLICT ("id") DO NOTHING;

-- Idempotent Backfill 2: Companion HouseholdMember rows (displayOrder = 1..N)
WITH invite_companion_bounds AS (
    SELECT
        ic."id" AS "invitationCodeId",
        ic."guestName",
        ic."plusOneFirstName",
        ic."plusOneLastName",
        ic."extraFields",
        ic."plusOneSeatNumbers",
        ic."partyTags",
        ic."createdAt",
        ic."updatedAt",
        GREATEST(
            COALESCE(ic."plusOneAllocations", 0),
            CASE
                WHEN NULLIF(BTRIM(COALESCE(ic."plusOneFirstName", '') || ' ' || COALESCE(ic."plusOneLastName", '')), '') IS NOT NULL
                THEN 1
                ELSE 0
            END,
            CASE
                WHEN ic."extraFields" IS NOT NULL
                     AND jsonb_typeof(ic."extraFields") = 'object'
                     AND jsonb_typeof(ic."extraFields" -> 'plusOneNames') = 'array'
                THEN jsonb_array_length(ic."extraFields" -> 'plusOneNames')
                ELSE 0
            END,
            COALESCE(cardinality(ic."plusOneSeatNumbers"), 0),
            COALESCE((
                SELECT MAX(
                    GREATEST(
                        COALESCE(r."plusOneCount", 0),
                        CASE
                            WHEN r."plusOneNames" IS NOT NULL AND jsonb_typeof(r."plusOneNames") = 'array'
                            THEN jsonb_array_length(r."plusOneNames")
                            ELSE 0
                        END,
                        CASE
                            WHEN r."status" = 'attending'
                                 AND r."mealSelections" IS NOT NULL
                                 AND jsonb_typeof(r."mealSelections") = 'array'
                            THEN GREATEST(0, jsonb_array_length(r."mealSelections") - 1)
                            ELSE 0
                        END
                    )
                )
                FROM "SubEventRsvp" r
                WHERE r."invitationCodeId" = ic."id"
            ), 0)
        ) AS companion_count
    FROM "InvitationCode" ic
),
companion_slots AS (
    SELECT
        b."invitationCodeId",
        gs.slot_idx,
        md5('hm:' || b."invitationCodeId" || ':' || gs.slot_idx::text) AS hash_hex,
        COALESCE(
            CASE
                WHEN b."extraFields" IS NOT NULL
                     AND jsonb_typeof(b."extraFields") = 'object'
                     AND jsonb_typeof(b."extraFields" -> 'plusOneNames') = 'array'
                     AND jsonb_array_length(b."extraFields" -> 'plusOneNames') >= gs.slot_idx
                THEN NULLIF(regexp_replace(BTRIM(b."extraFields" -> 'plusOneNames' ->> (gs.slot_idx - 1)), '\s+', ' ', 'g'), '')
                ELSE NULL
            END,
            CASE
                WHEN gs.slot_idx = 1
                THEN NULLIF(regexp_replace(BTRIM(COALESCE(b."plusOneFirstName", '') || ' ' || COALESCE(b."plusOneLastName", '')), '\s+', ' ', 'g'), '')
                ELSE NULL
            END,
            (
                SELECT NULLIF(regexp_replace(BTRIM(r."plusOneNames" ->> (gs.slot_idx - 1)), '\s+', ' ', 'g'), '')
                FROM "SubEventRsvp" r
                WHERE r."invitationCodeId" = b."invitationCodeId"
                  AND r."plusOneNames" IS NOT NULL
                  AND jsonb_typeof(r."plusOneNames") = 'array'
                  AND jsonb_array_length(r."plusOneNames") >= gs.slot_idx
                  AND NULLIF(BTRIM(r."plusOneNames" ->> (gs.slot_idx - 1)), '') IS NOT NULL
                ORDER BY CASE WHEN r."status" = 'attending' THEN 0 ELSE 1 END, r."updatedAt" DESC
                LIMIT 1
            )
        ) AS explicit_name,
        COALESCE(NULLIF(BTRIM(b."guestName"), ''), 'Primary Guest') AS primary_name,
        b."plusOneSeatNumbers"[gs.slot_idx] AS seat_num,
        b."createdAt",
        b."updatedAt"
    FROM invite_companion_bounds b
    CROSS JOIN LATERAL generate_series(1, b.companion_count) AS gs(slot_idx)
    WHERE b.companion_count > 0
      AND NOT EXISTS (
          SELECT 1
          FROM "HouseholdMember" hm
          WHERE hm."invitationCodeId" = b."invitationCodeId"
            AND hm."displayOrder" = gs.slot_idx
      )
),
resolved_companions AS (
    SELECT
        cs.*,
        COALESCE(cs.explicit_name, 'Plus-One #' || cs.slot_idx::text) AS resolved_name,
        CASE
            WHEN cs.explicit_name IS NOT NULL AND cs.explicit_name ~* '\m(child|kid|kids|infant|toddler)\M'
            THEN 'CHILD'
            WHEN cs.slot_idx = 1 AND cs.explicit_name IS NOT NULL
            THEN 'PARTNER'
            ELSE 'PLUS_ONE'
        END AS resolved_role
    FROM companion_slots cs
)
INSERT INTO "HouseholdMember" (
    "id",
    "invitationCodeId",
    "fullName",
    "firstName",
    "lastName",
    "role",
    "email",
    "phone",
    "dietaryNotes",
    "tags",
    "displayOrder",
    "seatNumber",
    "createdAt",
    "updatedAt"
)
SELECT
    substr(rc.hash_hex, 1, 8) || '-' || substr(rc.hash_hex, 9, 4) || '-4' || substr(rc.hash_hex, 14, 3) || '-a' || substr(rc.hash_hex, 18, 3) || '-' || substr(rc.hash_hex, 21, 12) AS "id",
    rc."invitationCodeId",
    rc.resolved_name AS "fullName",
    CASE
        WHEN rc.explicit_name IS NOT NULL THEN NULLIF(split_part(rc.explicit_name, ' ', 1), '')
        ELSE NULL
    END AS "firstName",
    CASE
        WHEN rc.explicit_name IS NOT NULL THEN NULLIF(BTRIM(substr(rc.explicit_name, char_length(split_part(rc.explicit_name, ' ', 1)) + 1)), '')
        ELSE NULL
    END AS "lastName",
    rc.resolved_role AS "role",
    NULL AS "email",
    NULL AS "phone",
    NULL AS "dietaryNotes",
    CASE
        WHEN rc.resolved_role = 'CHILD' THEN ARRAY['kids']::TEXT[]
        ELSE ARRAY[]::TEXT[]
    END AS "tags",
    rc.slot_idx AS "displayOrder",
    rc.seat_num AS "seatNumber",
    rc."createdAt",
    rc."updatedAt"
FROM resolved_companions rc
ON CONFLICT ("id") DO NOTHING;

-- Idempotent Backfill 3: SubEventMemberRsvp rows for every existing SubEventRsvp x HouseholdMember
INSERT INTO "SubEventMemberRsvp" (
    "id",
    "subEventRsvpId",
    "householdMemberId",
    "status",
    "mealOptionId",
    "dietaryNotes",
    "createdAt",
    "updatedAt"
)
SELECT
    substr(src.hash_hex, 1, 8) || '-' || substr(src.hash_hex, 9, 4) || '-4' || substr(src.hash_hex, 14, 3) || '-a' || substr(src.hash_hex, 18, 3) || '-' || substr(src.hash_hex, 21, 12) AS "id",
    src."subEventRsvpId",
    src."householdMemberId",
    src."status",
    src."mealOptionId",
    src."dietaryNotes",
    src."createdAt",
    src."updatedAt"
FROM (
    SELECT
        r."id" AS "subEventRsvpId",
        hm."id" AS "householdMemberId",
        md5('semr:' || r."id" || ':' || hm."id") AS hash_hex,
        CASE
            WHEN hm."displayOrder" = 0 THEN
                CASE
                    WHEN r."status" IN ('attending', 'declined', 'pending') THEN r."status"
                    ELSE 'pending'
                END
            WHEN r."status" = 'attending' AND hm."displayOrder" <= COALESCE(r."plusOneCount", 0) THEN 'attending'
            WHEN r."status" IN ('attending', 'declined') THEN 'declined'
            ELSE 'pending'
        END AS "status",
        CASE
            WHEN hm."displayOrder" = 0
                 AND r."status" = 'attending'
                 AND r."mealSelections" IS NOT NULL
                 AND jsonb_typeof(r."mealSelections") = 'array'
                 AND jsonb_array_length(r."mealSelections") >= 1
            THEN NULLIF(BTRIM(r."mealSelections" ->> 0), '')
            WHEN hm."displayOrder" >= 1
                 AND r."status" = 'attending'
                 AND hm."displayOrder" <= COALESCE(r."plusOneCount", 0)
                 AND r."mealSelections" IS NOT NULL
                 AND jsonb_typeof(r."mealSelections") = 'array'
                 AND jsonb_array_length(r."mealSelections") > hm."displayOrder"
            THEN NULLIF(BTRIM(r."mealSelections" ->> hm."displayOrder"), '')
            ELSE NULL
        END AS "mealOptionId",
        CASE
            WHEN hm."displayOrder" = 0 THEN NULLIF(BTRIM(r."dietaryNotes"), '')
            ELSE NULL
        END AS "dietaryNotes",
        r."createdAt",
        r."updatedAt"
    FROM "SubEventRsvp" r
    INNER JOIN "HouseholdMember" hm ON hm."invitationCodeId" = r."invitationCodeId"
) src
ON CONFLICT ("subEventRsvpId", "householdMemberId") DO NOTHING;
