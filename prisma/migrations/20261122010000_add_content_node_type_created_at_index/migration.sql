-- CreateIndex
CREATE INDEX IF NOT EXISTS "ContentNode_type_createdAt_idx" ON "ContentNode"("type", "createdAt" DESC);
