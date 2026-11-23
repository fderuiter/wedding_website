import { chromium, defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

if (process.env.TEST_WORKER_INDEX === undefined) {
  const staticViolationsPath = path.join(
    process.cwd(),
    'test-results',
    'static-demo-a11y-violations.json'
  );
  fs.mkdirSync(path.dirname(staticViolationsPath), { recursive: true });
  fs.writeFileSync(staticViolationsPath, '{}\n', 'utf8');
}

function resolveChromiumLaunchOptions() {
  const explicitPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicitPath) {
    return {
      executablePath: explicitPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
  }

  try {
    if (fs.existsSync(chromium.executablePath())) {
      return undefined;
    }
  } catch {
    // Fall through to system Chrome probe
  }

  if (fs.existsSync('/usr/bin/google-chrome')) {
    return {
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
  }

  return undefined;
}

const chromiumLaunchOptions = resolveChromiumLaunchOptions();

const staticPort = process.env.STATIC_DEMO_PORT || '4173';
const staticBaseUrl = `http://localhost:${staticPort}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'static-demo.spec.ts',
  outputDir: 'test-results/playwright-static',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: staticBaseUrl,
    contextOptions: {
      reducedMotion: 'reduce',
    },
    trace: 'on-first-retry',
    ...(chromiumLaunchOptions ? { launchOptions: chromiumLaunchOptions } : {}),
  },
  projects: [
    {
      name: 'chromium-static',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-static-demo.mjs',
    url: `${staticBaseUrl}/wedding_website/demo`,
    reuseExistingServer:
      !process.env.CI && process.env.PLAYWRIGHT_REUSE_STATIC_SERVER === 'true',
    timeout: 180000,
  },
});
