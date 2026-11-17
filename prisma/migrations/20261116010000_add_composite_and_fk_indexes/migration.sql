-- CreateIndex
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_idx" ON "BroadcastRecipient"("broadcastId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_invitationCodeId_idx" ON "BroadcastRecipient"("invitationCodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contributor_registryItemId_idx" ON "Contributor"("registryItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contributor_invitationCodeId_idx" ON "Contributor"("invitationCodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Contributor_thankYouStatus_date_idx" ON "Contributor"("thankYouStatus", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RegistryItem_imageId_idx" ON "RegistryItem"("imageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RegistryItem_category_price_idx" ON "RegistryItem"("category", "price");
