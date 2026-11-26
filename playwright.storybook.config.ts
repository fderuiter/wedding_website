import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, defineConfig, devices } from '@playwright/test';

function resolveChromiumExecutable(): string | undefined {
  const explicitPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }

  try {
    const defaultExecutable = chromium.executablePath();
    if (defaultExecutable && fs.existsSync(defaultExecutable)) {
      return undefined;
    }
  } catch {
    // Fall back to pre-installed system/cache Chromium binaries below
  }

  const msPlaywrightDir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(msPlaywrightDir)) {
    const entries = fs
      .readdirSync(msPlaywrightDir)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const entry of entries) {
      const candidate = path.join(msPlaywrightDir, entry, 'chrome-linux64', 'chrome');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (fs.existsSync('/usr/bin/google-chrome')) {
    return '/usr/bin/google-chrome';
  }

  return undefined;
}

const port = Number.parseInt(process.env.STORYBOOK_AUDIT_PORT || '4174', 10);
const storybookDir = (process.env.STORYBOOK_STATIC_DIR || 'storybook-static').trim();
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/wedding_website/storybook';
const normalizedBasePath = rawBasePath.trim().replace(/\/+$/, '');
const basePath = normalizedBasePath === '/' ? '' : normalizedBasePath;
const origin = `http://127.0.0.1:${port}`;
const fallbackExecutablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './e2e/storybook',
  testMatch: '**/*.audit.ts',
  outputDir: 'test-results/playwright-storybook',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 300_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(fallbackExecutablePath ? { executablePath: fallbackExecutablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disk-cache-size=1',
      ],
    },
  },
  projects: [
    {
      name: 'chromium-storybook',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-static-export.mjs',
    url: `${origin}/__health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      STATIC_EXPORT_DIR: storybookDir,
      NEXT_PUBLIC_BASE_PATH: basePath || '/',
      STATIC_AUDIT_PORT: String(port),
    },
  },
});
