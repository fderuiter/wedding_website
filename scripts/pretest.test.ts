/** @jest-environment node */

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { server as mswServer } from '../src/mocks/server';
import {
  DEFAULT_TEST_DATABASE_URL,
  isCiEnv,
  isDatabaseRequired,
  main,
  parseDatabaseEndpoint,
  probeTcpReadiness,
  pruneUnreachableOptionalPackages,
  recordInstallState,
  resolveTestEnvironment,
  shouldGeneratePrismaClient,
  shouldInstallDependencies,
  writeLockfileHash,
} from './pretest.mjs';

describe('CI-aware pretest & Jest setup environment orchestration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pretest-ci-aware-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isCiEnv & shouldInstallDependencies', () => {
    it('treats node_modules as aligned when CI=true and node_modules/.package-lock.json exists even without .package-lock-hash', () => {
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      const nmDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, '.package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');

      expect(isCiEnv({ CI: 'true' })).toBe(true);
      expect(isCiEnv({ CI: '1' })).toBe(true);
      expect(isCiEnv({ CI: 'false' })).toBe(false);
      expect(isCiEnv({})).toBe(false);

      expect(shouldInstallDependencies({ rootDir: tempDir, env: { CI: 'true' } })).toBe(false);
      // Locally without CI=true and without .package-lock-hash, reinstall is triggered
      expect(shouldInstallDependencies({ rootDir: tempDir, env: {} })).toBe(true);
    });

    it('treats node_modules as aligned locally when node_modules/.package-lock-hash matches package-lock.json', () => {
      const lockContent = '{"name":"wedding_website","lockfileVersion":3}\n';
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), lockContent, 'utf8');
      const writtenHash = writeLockfileHash(tempDir);

      const expectedHash = crypto.createHash('sha256').update(lockContent).digest('hex');
      expect(writtenHash).toBe(expectedHash);
      expect(shouldInstallDependencies({ rootDir: tempDir, env: {} })).toBe(false);

      // Drift in package-lock.json invalidates hash locally
      fs.writeFileSync(
        path.join(tempDir, 'package-lock.json'),
        '{"name":"wedding_website","lockfileVersion":3,"drifted":true}\n',
        'utf8'
      );
      expect(shouldInstallDependencies({ rootDir: tempDir, env: {} })).toBe(true);
    });
  });

  describe('resolveTestEnvironment & jest.setup.js parity', () => {
    const sampleEnvTest = [
      `DATABASE_URL="${DEFAULT_TEST_DATABASE_URL}"`,
      'ADMIN_PASSWORD="scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw=="',
      'GUEST_PASSCODE="build-fallback-guest-passcode"',
      'GUEST_SESSION_SECRET="playwright-e2e-session-secret-32-chars-min"',
    ].join('\n');

    function evaluateJestSetupEnvIife(
      mockCwd: string,
      mockEnv: Record<string, string | undefined>
    ): Record<string, string | undefined> {
      const jestSetupPath = path.join(process.cwd(), 'jest.setup.js');
      const rawSetup = fs.readFileSync(jestSetupPath, 'utf8');
      const startMarker = '(() => {';
      const endMarker = '})();';
      const startIdx = rawSetup.indexOf(startMarker);
      const endIdx = rawSetup.indexOf(endMarker, startIdx);
      expect(startIdx).toBeGreaterThan(-1);
      expect(endIdx).toBeGreaterThan(startIdx);

      const iifeSource = rawSetup.slice(startIdx, endIdx + endMarker.length);
      const fakeProcess = {
        cwd: () => mockCwd,
        env: mockEnv,
        loadEnvFile: (filePath: string) => {
          const content = fs.readFileSync(filePath, 'utf8');
          for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (!m || mockEnv[m[1]] !== undefined) continue;
            let val = m[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
              val = val.slice(1, -1);
            }
            mockEnv[m[1]] = val;
          }
        },
      };

      vm.runInNewContext(iifeSource, {
        fs,
        path,
        process: fakeProcess,
      });

      return mockEnv;
    }

    it('isolates parent shell DATABASE_URL locally using .env.test when neither CI=true nor TEST_DATABASE_URL is set', () => {
      fs.writeFileSync(path.join(tempDir, '.env.test'), sampleEnvTest, 'utf8');

      const pretestEnv: Record<string, string | undefined> = {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_dev?schema=public',
        POSTGRES_URL_NON_POOLING: 'postgresql://wedding:wedding123@localhost:5432/wedding_shadow?schema=public',
        PGUSER: 'personal_dev_user',
      };
      const resolvedPretest = resolveTestEnvironment({ rootDir: tempDir, env: pretestEnv });
      expect(resolvedPretest).toBe(DEFAULT_TEST_DATABASE_URL);
      expect(pretestEnv.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL);
      expect(pretestEnv.POSTGRES_URL_NON_POOLING).toBeUndefined();
      expect(pretestEnv.PGUSER).toBeUndefined();
      expect(pretestEnv.GUEST_PASSCODE).toBe('build-fallback-guest-passcode');

      const jestEnv = evaluateJestSetupEnvIife(tempDir, {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_dev?schema=public',
        POSTGRES_URL_NON_POOLING: 'postgresql://wedding:wedding123@localhost:5432/wedding_shadow?schema=public',
        PGUSER: 'personal_dev_user',
      });
      expect(jestEnv.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL);
      expect(jestEnv.POSTGRES_URL_NON_POOLING).toBeUndefined();
      expect(jestEnv.PGUSER).toBeUndefined();
      expect(jestEnv.GUEST_PASSCODE).toBe('build-fallback-guest-passcode');
    });

    it('preserves caller DATABASE_URL when CI=true in both pretest.mjs and jest.setup.js', () => {
      fs.writeFileSync(path.join(tempDir, '.env.test'), sampleEnvTest, 'utf8');
      const ciCustomUrl = 'postgresql://ci_user:ci_pass@127.0.0.1:5439/ci_isolated?schema=public';

      const pretestEnv: Record<string, string | undefined> = {
        CI: 'true',
        DATABASE_URL: ciCustomUrl,
      };
      expect(resolveTestEnvironment({ rootDir: tempDir, env: pretestEnv })).toBe(ciCustomUrl);
      expect(pretestEnv.DATABASE_URL).toBe(ciCustomUrl);
      expect(pretestEnv.ADMIN_PASSWORD).toContain('scrypt:');

      const jestEnv = evaluateJestSetupEnvIife(tempDir, {
        CI: 'true',
        DATABASE_URL: ciCustomUrl,
      });
      expect(jestEnv.DATABASE_URL).toBe(ciCustomUrl);
      expect(jestEnv.ADMIN_PASSWORD).toContain('scrypt:');
    });

    it('preserves TEST_DATABASE_URL override locally without CI=true in both pretest.mjs and jest.setup.js', () => {
      fs.writeFileSync(path.join(tempDir, '.env.test'), sampleEnvTest, 'utf8');
      const customTestUrl = 'postgresql://sandbox:pass@127.0.0.1:5440/sandbox_test?schema=public';

      const pretestEnv: Record<string, string | undefined> = {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_dev?schema=public',
        TEST_DATABASE_URL: customTestUrl,
      };
      expect(resolveTestEnvironment({ rootDir: tempDir, env: pretestEnv })).toBe(customTestUrl);
      expect(pretestEnv.DATABASE_URL).toBe(customTestUrl);

      const jestEnv = evaluateJestSetupEnvIife(tempDir, {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_dev?schema=public',
        TEST_DATABASE_URL: customTestUrl,
      });
      expect(jestEnv.DATABASE_URL).toBe(customTestUrl);
    });
  });

  describe('parseDatabaseEndpoint & probeTcpReadiness', () => {
    it('extracts host and port from PostgreSQL connection strings with 5432 fallback', () => {
      expect(
        parseDatabaseEndpoint('postgresql://wedding:wedding123@127.0.0.1:5433/wedding_test?schema=public')
      ).toEqual({ host: '127.0.0.1', port: 5433 });

      expect(parseDatabaseEndpoint('postgresql://wedding:wedding123@db.internal/wedding_test')).toEqual({
        host: 'db.internal',
        port: 5432,
      });

      expect(parseDatabaseEndpoint('postgresql://wedding:wedding123@[::1]:5435/wedding_test')).toEqual({
        host: '::1',
        port: 5435,
      });
    });

    it('detects active TCP listeners and returns false once closed', async () => {
      mswServer.close();
      const tcpServer = net.createServer();
      try {
        await new Promise<void>((resolve) => {
          tcpServer.listen(0, '127.0.0.1', () => resolve());
        });
        const address = tcpServer.address();
        expect(address && typeof address === 'object').toBe(true);
        const port = (address as net.AddressInfo).port;

        expect(await probeTcpReadiness('127.0.0.1', port, 500)).toBe(true);

        await new Promise<void>((resolve, reject) => {
          tcpServer.close((err) => (err ? reject(err) : resolve()));
        });

        expect(await probeTcpReadiness('127.0.0.1', port, 250)).toBe(false);
      } finally {
        mswServer.listen();
      }
    });
  });

  describe('main() lifecycle orchestration', () => {
    it('skips npm ci, docker compose up -d db, and duplicate prisma:generate in CI with pre-installed modules and active DB', async () => {
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      const nmDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(path.join(nmDir, '.prisma/client'), { recursive: true });
      fs.writeFileSync(path.join(nmDir, '.package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      fs.writeFileSync(path.join(nmDir, '.prisma/client/index.js'), 'export {};\n', 'utf8');

      const commands: Array<{ cmd: string; args: string[]; env?: Record<string, string | undefined> }> = [];
      const probeCalls: Array<{ host: string; port: number }> = [];
      const customCiDbUrl = 'postgresql://wedding:wedding123@127.0.0.1:5439/ci_test?schema=public';
      const env: Record<string, string | undefined> = {
        CI: 'true',
        DATABASE_URL: customCiDbUrl,
      };

      expect(shouldGeneratePrismaClient({ rootDir: tempDir, env })).toBe(false);

      await main({
        rootDir: tempDir,
        env,
        argv: ['node', 'scripts/pretest.mjs'],
        ensureDatabase: async () => {},
        probeTcp: async (host: string, port: number) => {
          probeCalls.push({ host, port });
          return true;
        },
        spawnSync: (cmd: string, args: string[], opts?: { env?: Record<string, string | undefined> }) => {
          commands.push({ cmd, args, env: opts?.env });
          return { status: 0 };
        },
        exit: (code: number) => {
          throw new Error(`Unexpected exit(${code})`);
        },
      });

      expect(probeCalls).toEqual([{ host: '127.0.0.1', port: 5439 }]);
      expect(commands.map((c) => `${c.cmd} ${c.args.join(' ')}`)).toEqual([
        'npx prisma migrate deploy',
      ]);
      expect(commands[0]?.env?.DATABASE_URL).toBe(customCiDbUrl);
      expect(
        fs.readFileSync(path.join(tempDir, 'test-results/jest-a11y-violations.json'), 'utf8')
      ).toBe('[]\n');
    });

    it('runs strict npm ci without --legacy-peer-deps on stale lockfile and starts docker compose db locally when port 5432 is offline', async () => {
      const lockContent = '{"name":"wedding_website","lockfileVersion":3}\n';
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), lockContent, 'utf8');
      fs.writeFileSync(
        path.join(tempDir, '.env.test'),
        `DATABASE_URL="${DEFAULT_TEST_DATABASE_URL}"\n`,
        'utf8'
      );
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'node_modules/.package-lock-hash'), 'stale-hash\n', 'utf8');

      const events: string[] = [];
      const env: Record<string, string | undefined> = {
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_dev?schema=public',
      };

      await main({
        rootDir: tempDir,
        env,
        argv: ['node', 'scripts/pretest.mjs'],
        ensureDatabase: async () => {},
        probeTcp: async (host: string, port: number) => {
          events.push(`probe:${host}:${port}`);
          return false;
        },
        spawnSync: (cmd: string, args: string[]) => {
          events.push(`spawn:${cmd} ${args.join(' ')}`);
          if (cmd === 'npm' && args[0] === 'ci') {
            // Simulate postinstall generating Prisma Client
            fs.mkdirSync(path.join(tempDir, 'node_modules/.prisma/client'), { recursive: true });
            fs.writeFileSync(
              path.join(tempDir, 'node_modules/.prisma/client/index.js'),
              'export {};\n',
              'utf8'
            );
          }
          return { status: 0 };
        },
        sleep: async () => {},
        exit: (code: number) => {
          throw new Error(`Unexpected exit(${code})`);
        },
      });

      // Verify strict npm ci without --legacy-peer-deps and updated hash file
      expect(events[0]).toBe('spawn:npm ci');
      expect(events.some((e) => e.includes('--legacy-peer-deps'))).toBe(false);
      const expectedHash = crypto.createHash('sha256').update(lockContent).digest('hex');
      expect(fs.readFileSync(path.join(tempDir, 'node_modules/.package-lock-hash'), 'utf8')).toBe(
        expectedHash
      );

      // Verify TCP probe ran BEFORE docker compose up -d db
      const probeIdx = events.indexOf('probe:localhost:5432');
      const composeUpIdx = events.indexOf(
        'spawn:docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml up -d db'
      );
      expect(probeIdx).toBeGreaterThan(-1);
      expect(composeUpIdx).toBeGreaterThan(probeIdx);

      // Verify isolated DATABASE_URL from .env.test
      expect(env.DATABASE_URL).toBe(DEFAULT_TEST_DATABASE_URL);
      expect(events).toContain('spawn:npx prisma migrate deploy');
      expect(events.some((e) => e.includes('generate-portal.ts'))).toBe(false);
    });

    it('records install state and skips prisma migrate deploy on warm runs until schema or migrations change', async () => {
      const lockContent = '{"name":"wedding_website","lockfileVersion":3}\n';
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), lockContent, 'utf8');
      fs.mkdirSync(path.join(tempDir, 'prisma/migrations/20260101000000_init'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'prisma/schema.prisma'), 'model AppConfig { id Int @id }\n', 'utf8');
      fs.writeFileSync(
        path.join(tempDir, 'prisma/migrations/20260101000000_init/migration.sql'),
        'CREATE TABLE "AppConfig" ("id" INTEGER PRIMARY KEY);\n',
        'utf8'
      );
      fs.mkdirSync(path.join(tempDir, 'node_modules/.prisma/client'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'node_modules/.prisma/client/index.js'), 'export {};\n', 'utf8');

      recordInstallState(tempDir);
      expect(shouldInstallDependencies({ rootDir: tempDir, env: {} })).toBe(false);
      expect(shouldGeneratePrismaClient({ rootDir: tempDir, env: {} })).toBe(false);

      const spawned: string[] = [];
      await main({
        rootDir: tempDir,
        env: { TEST_DATABASE_URL: DEFAULT_TEST_DATABASE_URL },
        argv: ['node', 'scripts/pretest.mjs'],
        ensureDatabase: async () => {},
        probeTcp: async () => true,
        probeDbState: async () => ({ hasAppConfigTable: true, allMigrationsApplied: true }),
        spawnSync: (cmd: string, args: string[]) => {
          spawned.push(`${cmd} ${args.join(' ')}`);
          return { status: 0 };
        },
        exit: (code: number) => {
          throw new Error(`Unexpected exit(${code})`);
        },
      });
      // First run executes migrate deploy and records dbSync state
      expect(spawned).toEqual(['npx prisma migrate deploy']);

      spawned.length = 0;
      await main({
        rootDir: tempDir,
        env: { TEST_DATABASE_URL: DEFAULT_TEST_DATABASE_URL },
        argv: ['node', 'scripts/pretest.mjs'],
        ensureDatabase: async () => {},
        probeTcp: async () => true,
        probeDbState: async () => ({ hasAppConfigTable: true, allMigrationsApplied: true }),
        spawnSync: (cmd: string, args: string[]) => {
          spawned.push(`${cmd} ${args.join(' ')}`);
          return { status: 0 };
        },
        exit: (code: number) => {
          throw new Error(`Unexpected exit(${code})`);
        },
      });
      // Warm run skips both migrate deploy and prisma:generate
      expect(spawned).toEqual([]);

      // Modifying schema.prisma invalidates both dbSync and prismaClientSchemaHash
      fs.appendFileSync(path.join(tempDir, 'prisma/schema.prisma'), '// comment\n', 'utf8');
      await main({
        rootDir: tempDir,
        env: { TEST_DATABASE_URL: DEFAULT_TEST_DATABASE_URL },
        argv: ['node', 'scripts/pretest.mjs'],
        ensureDatabase: async () => {},
        probeTcp: async () => true,
        probeDbState: async () => ({ hasAppConfigTable: true, allMigrationsApplied: true }),
        spawnSync: (cmd: string, args: string[]) => {
          spawned.push(`${cmd} ${args.join(' ')}`);
          return { status: 0 };
        },
        exit: (code: number) => {
          throw new Error(`Unexpected exit(${code})`);
        },
      });
      expect(spawned).toEqual(['npx prisma migrate deploy', 'npm run prisma:generate']);
    });

    it('resets isolated test schema and retries prisma migrate deploy on P3005 error', async () => {
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      const nmDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(path.join(nmDir, '.prisma/client'), { recursive: true });
      fs.writeFileSync(path.join(nmDir, '.package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      fs.writeFileSync(path.join(nmDir, '.prisma/client/index.js'), 'export {};\n', 'utf8');

      const resetCalls: Array<{ url: string; schema: string }> = [];
      let migrateAttempts = 0;

      await main({
        rootDir: tempDir,
        env: {
          CI: 'true',
          DATABASE_URL: DEFAULT_TEST_DATABASE_URL,
        },
        argv: ['node', 'scripts/pretest.mjs'],
        ensureDatabase: async () => {},
        resetSchema: async (url: string, schema: string) => {
          resetCalls.push({ url, schema });
        },
        probeTcp: async () => true,
        spawnSync: (cmd: string, args: string[]) => {
          if (cmd === 'npx' && args.join(' ') === 'prisma migrate deploy') {
            migrateAttempts += 1;
            if (migrateAttempts === 1) {
              return {
                status: 1,
                stderr: Buffer.from('Error: P3005 The database schema is not empty.\n'),
              };
            }
          }
          return { status: 0 };
        },
        exit: (code: number) => {
          throw new Error(`Unexpected exit(${code})`);
        },
      });

      expect(migrateAttempts).toBe(2);
      expect(resetCalls).toEqual([{ url: DEFAULT_TEST_DATABASE_URL, schema: 'public' }]);
    });

    it('logs a warning, skips offline migrations, still generates Prisma Client when missing, and runs migrations once PostgreSQL becomes reachable', async () => {
      const lockContent = '{"name":"wedding_website","lockfileVersion":3}\n';
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), lockContent, 'utf8');
      fs.mkdirSync(path.join(tempDir, 'prisma/migrations/20260101000000_init'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'prisma/schema.prisma'), 'model AppConfig { id Int @id }\n', 'utf8');
      fs.writeFileSync(
        path.join(tempDir, 'prisma/migrations/20260101000000_init/migration.sql'),
        'CREATE TABLE "AppConfig" ("id" INTEGER PRIMARY KEY);\n',
        'utf8'
      );
      writeLockfileHash(tempDir);

      // Seed stale dbSync to confirm offline fallback leaves dbSync unset
      const pretestStatePath = path.join(tempDir, 'node_modules/.cache/pretest-state.json');
      fs.mkdirSync(path.dirname(pretestStatePath), { recursive: true });
      fs.writeFileSync(
        pretestStatePath,
        JSON.stringify({ dbSync: { schemaHash: 'stale', testDbUrl: DEFAULT_TEST_DATABASE_URL } }),
        'utf8'
      );

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const spawned: string[] = [];
      let ensureDbCalled = 0;

      try {
        await main({
          rootDir: tempDir,
          env: { TEST_DATABASE_URL: DEFAULT_TEST_DATABASE_URL },
          argv: ['node', 'scripts/pretest.mjs'],
          ensureDatabase: async () => {
            ensureDbCalled += 1;
          },
          probeTcp: async () => false,
          spawnSync: (cmd: string, args: string[]) => {
            const fullCmd = `${cmd} ${args.join(' ')}`;
            spawned.push(fullCmd);
            if (fullCmd === 'docker info') {
              return { status: 1 };
            }
            if (fullCmd === 'npm run prisma:generate') {
              fs.mkdirSync(path.join(tempDir, 'node_modules/.prisma/client'), { recursive: true });
              fs.writeFileSync(
                path.join(tempDir, 'node_modules/.prisma/client/index.js'),
                'export {};\n',
                'utf8'
              );
            }
            return { status: 0 };
          },
          exit: (code: number) => {
            throw new Error(`Unexpected exit(${code})`);
          },
        });

        expect(ensureDbCalled).toBe(0);
        expect(spawned).toEqual(['docker info', 'npm run prisma:generate']);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('PostgreSQL is offline at localhost:5432; skipping Prisma migrations')
        );

        const offlineState = JSON.parse(fs.readFileSync(pretestStatePath, 'utf8')) as {
          dbSync?: unknown;
          prismaClientSchemaHash?: string;
        };
        expect(offlineState.dbSync).toBeUndefined();
        expect(offlineState.prismaClientSchemaHash).toBeDefined();

        // Non-default custom port skips Docker Compose auto-start immediately when offline
        spawned.length = 0;
        await main({
          rootDir: tempDir,
          env: {
            TEST_DATABASE_URL: 'postgresql://wedding:wedding123@127.0.0.1:59999/wedding_test?schema=public',
          },
          argv: ['node', 'scripts/pretest.mjs'],
          ensureDatabase: async () => {
            ensureDbCalled += 1;
          },
          probeTcp: async () => false,
          spawnSync: (cmd: string, args: string[]) => {
            spawned.push(`${cmd} ${args.join(' ')}`);
            return { status: 0 };
          },
          exit: (code: number) => {
            throw new Error(`Unexpected exit(${code})`);
          },
        });
        expect(ensureDbCalled).toBe(0);
        expect(spawned).toEqual([]);

        // Once PostgreSQL becomes reachable, migrations run automatically and populate dbSync
        spawned.length = 0;
        await main({
          rootDir: tempDir,
          env: { TEST_DATABASE_URL: DEFAULT_TEST_DATABASE_URL },
          argv: ['node', 'scripts/pretest.mjs'],
          ensureDatabase: async () => {
            ensureDbCalled += 1;
          },
          probeTcp: async () => true,
          probeDbState: async () => ({ hasAppConfigTable: true, allMigrationsApplied: true }),
          spawnSync: (cmd: string, args: string[]) => {
            spawned.push(`${cmd} ${args.join(' ')}`);
            return { status: 0 };
          },
          exit: (code: number) => {
            throw new Error(`Unexpected exit(${code})`);
          },
        });

        expect(ensureDbCalled).toBe(1);
        expect(spawned).toEqual(['npx prisma migrate deploy']);
        const onlineState = JSON.parse(fs.readFileSync(pretestStatePath, 'utf8')) as {
          dbSync?: { schemaHash?: string; testDbUrl?: string };
        };
        expect(onlineState.dbSync?.testDbUrl).toBe(DEFAULT_TEST_DATABASE_URL);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('fails preflight immediately with exit(1) when PostgreSQL is offline and CI_REQUIRE_DB=true or --require-db is set', async () => {
      expect(isDatabaseRequired({ env: {}, argv: ['node', 'scripts/pretest.mjs'] })).toBe(false);
      expect(
        isDatabaseRequired({ env: { CI_REQUIRE_DB: 'false' }, argv: ['node', 'scripts/pretest.mjs'] })
      ).toBe(false);
      expect(
        isDatabaseRequired({ env: {}, argv: ['node', 'scripts/pretest.mjs', '--require-db=false'] })
      ).toBe(false);
      expect(
        isDatabaseRequired({ env: { CI_REQUIRE_DB: 'true' }, argv: ['node', 'scripts/pretest.mjs'] })
      ).toBe(true);
      expect(
        isDatabaseRequired({ env: { CI_REQUIRE_DB: '1' }, argv: ['node', 'scripts/pretest.mjs'] })
      ).toBe(true);
      expect(
        isDatabaseRequired({ env: {}, argv: ['node', 'scripts/pretest.mjs', '--require-db'] })
      ).toBe(true);
      expect(
        isDatabaseRequired({ env: {}, argv: ['node', 'scripts/pretest.mjs', '--require-db=true'] })
      ).toBe(true);

      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      const nmDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(path.join(nmDir, '.prisma/client'), { recursive: true });
      fs.writeFileSync(path.join(nmDir, '.package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
      fs.writeFileSync(path.join(nmDir, '.prisma/client/index.js'), 'export {};\n', 'utf8');
      writeLockfileHash(tempDir);

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const ciExitCodes: number[] = [];
        const ciSpawned: string[] = [];
        await main({
          rootDir: tempDir,
          env: {
            CI: 'true',
            CI_REQUIRE_DB: 'true',
            DATABASE_URL: DEFAULT_TEST_DATABASE_URL,
          },
          argv: ['node', 'scripts/pretest.mjs'],
          probeTcp: async () => false,
          spawnSync: (cmd: string, args: string[]) => {
            ciSpawned.push(`${cmd} ${args.join(' ')}`);
            return { status: 0 };
          },
          exit: (code: number) => {
            ciExitCodes.push(code);
          },
        });
        expect(ciExitCodes).toEqual([1]);
        expect(ciSpawned).toEqual([]);

        const flagExitCodes: number[] = [];
        const flagSpawned: string[] = [];
        await main({
          rootDir: tempDir,
          env: { TEST_DATABASE_URL: DEFAULT_TEST_DATABASE_URL },
          argv: ['node', 'scripts/pretest.mjs', '--require-db'],
          probeTcp: async () => false,
          spawnSync: (cmd: string, args: string[]) => {
            flagSpawned.push(`${cmd} ${args.join(' ')}`);
            return { status: 1 };
          },
          exit: (code: number) => {
            flagExitCodes.push(code);
          },
        });
        expect(flagExitCodes).toEqual([1]);
        expect(flagSpawned).toEqual(['docker info']);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('prunes unpacked unreachable WASM optional packages on non-wasm32 hosts and skips hash recording on --package-lock-only', async () => {
      const lockPayload = {
        name: 'wedding_website',
        lockfileVersion: 3,
        packages: {
          '': {
            dependencies: {
              sharp: '0.35.5',
            },
          },
          'node_modules/sharp': {
            version: '0.35.5',
            optionalDependencies: {
              '@img/sharp-linux-x64': '0.35.5',
              '@img/sharp-webcontainers-wasm32': '0.35.5',
            },
          },
          'node_modules/@img/sharp-linux-x64': {
            version: '0.35.5',
            optional: true,
            os: ['linux'],
            cpu: ['x64'],
          },
          'node_modules/@img/sharp-webcontainers-wasm32': {
            version: '0.35.5',
            optional: true,
            cpu: ['wasm32'],
            dependencies: {
              '@img/sharp-wasm32': '0.35.5',
            },
          },
          'node_modules/@img/sharp-wasm32': {
            version: '0.35.5',
            optional: true,
            dependencies: {
              '@emnapi/runtime': '^1.11.3',
            },
          },
          'node_modules/@emnapi/runtime': {
            version: '1.11.3',
            optional: true,
          },
        },
      };
      fs.writeFileSync(
        path.join(tempDir, 'package-lock.json'),
        `${JSON.stringify(lockPayload, null, 2)}\n`,
        'utf8'
      );

      const nmDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(path.join(nmDir, '@img/sharp-linux-x64'), { recursive: true });
      fs.mkdirSync(path.join(nmDir, '@img/sharp-wasm32'), { recursive: true });
      fs.mkdirSync(path.join(nmDir, '@emnapi/runtime'), { recursive: true });
      fs.writeFileSync(
        path.join(nmDir, '.package-lock.json'),
        `${JSON.stringify(
          {
            lockfileVersion: 3,
            packages: {
              'node_modules/@img/sharp-linux-x64': { version: '0.35.5', optional: true },
              'node_modules/@img/sharp-wasm32': { version: '0.35.5', optional: true },
              'node_modules/@emnapi/runtime': { version: '1.11.3', optional: true },
            },
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      // Lockfile-only postinstall run must not write .package-lock-hash or prune node_modules
      await main({
        rootDir: tempDir,
        env: { npm_config_package_lock_only: 'true' },
        argv: ['node', 'scripts/pretest.mjs', '--record-install-state'],
      });
      expect(fs.existsSync(path.join(nmDir, '.package-lock-hash'))).toBe(false);
      expect(fs.existsSync(path.join(nmDir, '@img/sharp-wasm32'))).toBe(true);

      // On wasm32 hosts, WASM optional packages are preserved
      expect(
        pruneUnreachableOptionalPackages(tempDir, { platform: 'linux', arch: 'wasm32' })
      ).toEqual([]);
      expect(fs.existsSync(path.join(nmDir, '@img/sharp-wasm32'))).toBe(true);

      // On non-wasm32 hosts, recordInstallState prunes unreachable WASM packages and updates hidden lockfile
      recordInstallState(tempDir, { platform: 'linux', arch: 'x64' });
      expect(fs.existsSync(path.join(nmDir, '@img/sharp-linux-x64'))).toBe(true);
      expect(fs.existsSync(path.join(nmDir, '@img/sharp-wasm32'))).toBe(false);
      expect(fs.existsSync(path.join(nmDir, '@emnapi/runtime'))).toBe(false);
      expect(fs.existsSync(path.join(nmDir, '@emnapi'))).toBe(false);
      expect(fs.existsSync(path.join(nmDir, '.package-lock-hash'))).toBe(true);

      const hiddenLock = JSON.parse(
        fs.readFileSync(path.join(nmDir, '.package-lock.json'), 'utf8')
      ) as { packages: Record<string, unknown> };
      expect(Object.keys(hiddenLock.packages)).toEqual(['node_modules/@img/sharp-linux-x64']);
    });
  });
});
