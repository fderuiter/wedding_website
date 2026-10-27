import { defineConfig } from '@playwright/test';
import fs from 'fs';

const runWebServer = !process.env.TEST_CONTAINER;
const defaultChromePath = '/usr/bin/google-chrome';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(defaultChromePath) ? defaultChromePath : undefined);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  webServer: runWebServer ? {
    command: process.env.CI ? 'node .next/standalone/server.js' : 'npm run dev',
    url: 'http://127.0.0.1:3000/api/ready',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      PORT: '3000',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=4096',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public',
      POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==',
      ALLOWED_HOSTS: process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1,*.localhost,example.com,*.example.com',
      GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'wedding2026',
      E2E_TEST: 'true',
    },
  } : undefined,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    launchOptions: {
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-site-isolation-trials',
        '--js-flags=--max-old-space-size=4096 --expose-gc',
      ],
    },
  },
});
