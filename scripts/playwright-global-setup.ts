import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_E2E_ADMIN_PASSWORD =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';

export default async function globalSetup(): Promise<void> {
  if (!process.env.TEST_CONTAINER) {
    return;
  }

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dbUser = process.env.DB_USER || 'wedding';
  const dbPassword = process.env.DB_PASSWORD || 'wedding123';
  const dbPort = process.env.DB_PORT || '5432';
  const dbName = process.env.DB_NAME || 'wedding';
  const containerDatabaseUrl = `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@127.0.0.1:${dbPort}/${dbName}?schema=public`;

  const result = spawnSync('npx', ['tsx', 'scripts/seed.ts'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DATABASE_URL: containerDatabaseUrl,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || DEFAULT_E2E_ADMIN_PASSWORD,
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `Playwright container globalSetup failed to seed ${dbName} on 127.0.0.1:${dbPort} (exit ${result.status ?? 1})`
    );
  }
}
