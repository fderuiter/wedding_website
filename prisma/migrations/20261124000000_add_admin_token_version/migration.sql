-- Add monotonic adminTokenVersion counter to AppConfig for server-side admin session revocation
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "adminTokenVersion" INTEGER NOT NULL DEFAULT 1;
