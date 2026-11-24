import { defineConfig, devices } from '@playwright/test';

const runsPagesShowcaseExplicitly = process.argv.some((arg) =>
  arg.includes('pages-showcase.spec.ts')
);
const runWebServer = !process.env.TEST_CONTAINER && !runsPagesShowcaseExplicitly;
const reuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === 'true';
const defaultE2EAdminPassword =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';
const localDbBootstrapScript = [
  'import cp from \'node:child_process\';',
  'const composeArgs = [\'compose\', \'--env-file\', \'.env.ci\', \'-f\', \'docker-compose.yml\', \'-f\', \'docker-compose.ci.yml\'];',
  `const composeEnv = { ...process.env, DB_PASSWORD: process.env.DB_PASSWORD || 'wedding123', ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '${defaultE2EAdminPassword}', GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'playwright-e2e-guest-passcode', GUEST_SESSION_SECRET: process.env.GUEST_SESSION_SECRET || 'playwright-e2e-session-secret-32-chars-min' };`,
  'if (cp.spawnSync(\'docker\', [\'info\'], { stdio: \'ignore\', shell: true }).status === 0) {',
  '  cp.spawnSync(\'docker\', [...composeArgs, \'up\', \'-d\', \'db\'], { stdio: \'inherit\', shell: true, env: composeEnv });',
  '  for (let i = 0; i < 30; i++) {',
  '    if (cp.spawnSync(\'docker\', [...composeArgs, \'exec\', \'-T\', \'db\', \'pg_isready\', \'-h\', \'127.0.0.1\', \'-U\', \'wedding\'], { stdio: \'ignore\', shell: true, env: composeEnv }).status === 0) break;',
  '    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);',
  '  }',
  '}',
].join(' ');
const localWebServerCommand = [
  `node --input-type=module -e "${localDbBootstrapScript}"`,
  'npx prisma db push --accept-data-loss',
  'npx tsx scripts/seed.ts',
  'npm run dev',
].join(' && ');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: runsPagesShowcaseExplicitly ? [] : ['**/pages-showcase.spec.ts'],
  outputDir: 'test-results/playwright',
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  webServer: runWebServer ? {
    command: process.env.CI ? 'node .next/standalone/server.js' : localWebServerCommand,
    url: 'http://localhost:3000/api/ready',
    reuseExistingServer,
    timeout: 120000,
    env: {
      PORT: '3000',
      HOSTNAME: 'localhost',
      NODE_ENV: process.env.CI ? 'production' : 'development',
      NODE_OPTIONS: '--max-old-space-size=4096',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public',
      POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || defaultE2EAdminPassword,
      ALLOWED_HOSTS: process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1,*.localhost,example.com,*.example.com',
      GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'playwright-e2e-guest-passcode',
      GUEST_SESSION_SECRET: process.env.GUEST_SESSION_SECRET || 'playwright-e2e-session-secret-32-chars-min',
      E2E_TEST: 'true',
    },
  } : undefined,
  use: {
    baseURL: 'http://localhost:3000',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
