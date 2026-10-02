import { defineConfig } from '@playwright/test';

const runWebServer = !process.env.TEST_CONTAINER;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: process.env.CI ? 1 : undefined,
  webServer: runWebServer ? {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      PORT: '3000',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding',
      POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding',
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-gl-drawing-for-tests',
        '--disable-software-rasterizer',
      ],
    },
  },
});
