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

const port = Number.parseInt(process.env.STATIC_AUDIT_PORT || '4173', 10);
const basePath =
  (process.env.NEXT_PUBLIC_BASE_PATH || '/wedding_website/demo').trim().replace(/\/+$/, '') || '';
const origin = `http://127.0.0.1:${port}`;
const fallbackExecutablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './e2e/static',
  testMatch: '**/*.audit.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 180_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(fallbackExecutablePath ? { executablePath: fallbackExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium-static',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-static-export.mjs',
    url: `${origin}/__health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      NEXT_PUBLIC_BASE_PATH: basePath || '/wedding_website/demo',
      STATIC_AUDIT_PORT: String(port),
    },
  },
});
