import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'dummy-build-password',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
});
