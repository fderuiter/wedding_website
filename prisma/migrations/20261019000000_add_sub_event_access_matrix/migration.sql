-- CreateTable
CREATE TABLE "SubEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "locationName" TEXT DEFAULT '',
    "location" TEXT DEFAULT '',
    "category" TEXT DEFAULT '',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubEventAccess" (
    "id" TEXT NOT NULL,
    "subEventId" TEXT NOT NULL,
    "invitationCodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubEventAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubEventRsvp" (
    "id" TEXT NOT NULL,
    "subEventId" TEXT NOT NULL,
    "invitationCodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "plusOneCount" INTEGER NOT NULL DEFAULT 0,
    "dietaryNotes" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubEventRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubEventAccess_subEventId_invitationCodeId_key" ON "SubEventAccess"("subEventId", "invitationCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "SubEventRsvp_subEventId_invitationCodeId_key" ON "SubEventRsvp"("subEventId", "invitationCodeId");

-- AddForeignKey
ALTER TABLE "SubEventAccess" ADD CONSTRAINT "SubEventAccess_subEventId_fkey" FOREIGN KEY ("subEventId") REFERENCES "SubEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubEventAccess" ADD CONSTRAINT "SubEventAccess_invitationCodeId_fkey" FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubEventRsvp" ADD CONSTRAINT "SubEventRsvp_subEventId_fkey" FOREIGN KEY ("subEventId") REFERENCES "SubEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubEventRsvp" ADD CONSTRAINT "SubEventRsvp_invitationCodeId_fkey" FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
