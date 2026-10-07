-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN IF NOT EXISTS "themePreset" TEXT NOT NULL DEFAULT 'classic';
