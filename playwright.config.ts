import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const runWebServer = !process.env.TEST_CONTAINER;

// Detect if schema is currently configured for SQLite
let isSqlite = false;
try {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  if (fs.existsSync(schemaPath)) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    isSqlite = schemaContent.includes('provider = "sqlite"') || schemaContent.includes('provider="sqlite"');
  }
} catch (e) {}

const defaultDbUrl = isSqlite
  ? `file:${path.join(process.cwd(), 'test.db')}`
  : 'postgresql://dummy:dummy@localhost:5432/dummy';

export default defineConfig({
  testDir: './e2e',
  webServer: runWebServer ? {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || defaultDbUrl,
      POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL || (isSqlite ? '' : 'postgresql://dummy:dummy@localhost:5432/dummy'),
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==',
    },
  } : undefined,
  use: {
    baseURL: process.env.BASE_URL || process.env.TEST_URL || 'http://127.0.0.1:3000',
  },
});
