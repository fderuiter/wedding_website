-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN     "broadcastBatchDelayMs" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "broadcastBatchSize" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "emailProvider" TEXT NOT NULL DEFAULT 'smtp',
ADD COLUMN     "resendApiKey" TEXT DEFAULT '',
ADD COLUMN     "resendFrom" TEXT DEFAULT '',
ADD COLUMN     "sendgridApiKey" TEXT DEFAULT '',
ADD COLUMN     "sendgridFrom" TEXT DEFAULT '',
ADD COLUMN     "smsProvider" TEXT DEFAULT 'none',
ADD COLUMN     "smtpFrom" TEXT DEFAULT '',
ADD COLUMN     "smtpHost" TEXT DEFAULT '',
ADD COLUMN     "smtpPass" TEXT DEFAULT '',
ADD COLUMN     "smtpPort" INTEGER DEFAULT 587,
ADD COLUMN     "smtpSecure" BOOLEAN DEFAULT false,
ADD COLUMN     "smtpUser" TEXT DEFAULT '',
ADD COLUMN     "twilioAccountSid" TEXT DEFAULT '',
ADD COLUMN     "twilioAuthToken" TEXT DEFAULT '',
ADD COLUMN     "twilioFromNumber" TEXT DEFAULT '';

-- CreateTable
CREATE TABLE "BroadcastMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "targetFilters" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "invitationCodeId" TEXT,
    "guestName" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "BroadcastMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_invitationCodeId_fkey" FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
