import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to run a command and inherit streams or fail
function runCommand(command, args, options = {}) {
  const { ignoreFailure = false, ...spawnOptions } = options;
  const result = child_process.spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    ...spawnOptions
  });
  if (result.status !== 0) {
    const errorMsg = `Command failed: ${command} ${args.join(' ')}`;
    console.error(errorMsg);
    if (!ignoreFailure) {
      process.exit(result.status || 1);
    }
  }
}

async function main() {
  // 1. Verify dependency alignment
  const lockfilePath = path.join(rootDir, 'package-lock.json');
  const hashCacheDir = path.join(rootDir, 'node_modules');
  const hashCachePath = path.join(hashCacheDir, '.package-lock-hash');

  let needsInstall = false;

  if (!fs.existsSync(hashCacheDir)) {
    needsInstall = true;
  } else {
    if (fs.existsSync(lockfilePath)) {
      const lockfileContent = fs.readFileSync(lockfilePath);
      const currentHash = crypto.createHash('sha256').update(lockfileContent).digest('hex');

      let cachedHash = '';
      if (fs.existsSync(hashCachePath)) {
        cachedHash = fs.readFileSync(hashCachePath, 'utf8').trim();
      }

      if (currentHash !== cachedHash) {
        needsInstall = true;
      }
    } else {
      needsInstall = !fs.existsSync(hashCacheDir);
    }
  }

  if (needsInstall) {
    console.log('Local dependencies out of sync or missing. Performing clean installation...');
    // Silent trigger of dependency installation (only output on failure)
    const result = child_process.spawnSync('npm', ['ci'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    if (result.status !== 0) {
      console.error('Dependency installation failed!');
      if (result.stdout) console.error(result.stdout.toString());
      if (result.stderr) console.error(result.stderr.toString());
      process.exit(result.status || 1);
    }

    // Write the hash after successful install
    if (fs.existsSync(lockfilePath)) {
      const lockfileContent = fs.readFileSync(lockfilePath);
      const currentHash = crypto.createHash('sha256').update(lockfileContent).digest('hex');
      fs.mkdirSync(hashCacheDir, { recursive: true });
      fs.writeFileSync(hashCachePath, currentHash, 'utf8');
    }
    console.log('Dependency installation completed successfully.');
  }

  // 2. Selective Execution based on lifecycle event
  const lifecycleEvent = process.env.npm_lifecycle_event || '';
  const isUnitTest = lifecycleEvent.includes('test');

  if (isUnitTest) {
    console.log('Unit test phase detected. Skipping full build...');

    const testResultsDir = path.join(rootDir, 'test-results');
    fs.mkdirSync(testResultsDir, { recursive: true });
    fs.writeFileSync(path.join(testResultsDir, 'jest-a11y-violations.json'), '[]\n', 'utf8');

    // Check if Docker is available and running
    let dockerRunning = false;
    try {
      const docInfo = child_process.spawnSync('docker', ['info'], { stdio: 'ignore', shell: true });
      if (docInfo.status === 0) {
        dockerRunning = true;
      }
    } catch {
      // Docker command not found or not running
    }

    if (dockerRunning) {
      console.log('Ensuring local PostgreSQL database container is running...');
      const ciComposeArgs = [
        'compose',
        '--env-file',
        '.env.ci',
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.ci.yml',
      ];
      const ciComposeEnv = {
        ...process.env,
        DB_USER: process.env.DB_USER || 'wedding',
        DB_PASSWORD: process.env.DB_PASSWORD || 'wedding123',
        DB_NAME: process.env.DB_NAME || 'wedding',
        ADMIN_PASSWORD:
          process.env.ADMIN_PASSWORD ||
          'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
        GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'build-fallback-guest-passcode',
        GUEST_SESSION_SECRET:
          process.env.GUEST_SESSION_SECRET || 'playwright-e2e-session-secret-32-chars-min',
      };
      const startResult = child_process.spawnSync('docker', [...ciComposeArgs, 'up', '-d', 'db'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: true,
        env: ciComposeEnv,
      });

      if (startResult.status !== 0) {
        console.warn('Failed to start database container via docker compose. Proceeding assuming database is already running...');
      } else {
        console.log('Waiting for database to be ready...');
        let ready = false;
        for (let i = 0; i < 15; i++) {
          try {
            const check = child_process.spawnSync('docker', [...ciComposeArgs, 'exec', '-T', 'db', 'pg_isready', '-U', 'wedding'], { stdio: 'ignore', shell: true, cwd: rootDir, env: ciComposeEnv });
            if (check.status === 0) {
              ready = true;
              console.log('Database is ready.');
              break;
            }
          } catch {
            // Ignored
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!ready) {
          console.log('Database was not ready in time, proceeding anyway...');
        }
      }
    } else {
      console.log('Docker command not found or daemon not running. Skipping database container auto-start.');
    }

    const envPath = path.join(rootDir, '.env.test');

    // Strict Test Environment Isolation: Ignore parent shell database environment variables and isolated test variables
    const pgVars = [
      'DATABASE_URL',
      'POSTGRES_URL_NON_POOLING',
      'PGDATABASE',
      'PGUSER',
      'PGPASSWORD',
      'PGHOST',
      'PGPORT',
      'PGDATASOURCE',
      'ADMIN_PASSWORD',
    ];
    for (const v of pgVars) {
      delete process.env[v];
    }

    if (fs.existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
      } catch {
        // Fallback if error reading file
      }
    }

    // Determine the isolated test database URL from dedicated test settings, or use safe fallback
    const testDbUrl = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

    process.env.DATABASE_URL = testDbUrl;

    const parsedTestUrl = new URL(testDbUrl);
    const targetDbName = decodeURIComponent(parsedTestUrl.pathname.replace(/^\//, ''));
    const targetSchema = parsedTestUrl.searchParams.get('schema') || 'public';
    const isIsolatedTestDb = targetDbName === 'wedding_test' || targetDbName.endsWith('_test');

    if (isIsolatedTestDb && /^[A-Za-z0-9_-]+$/.test(targetDbName)) {
      try {
        const { default: pg } = await import('pg');
        const adminUrl = new URL(testDbUrl);
        adminUrl.pathname = '/postgres';
        adminUrl.search = '';
        const adminClient = new pg.Client({ connectionString: adminUrl.toString() });
        await adminClient.connect();
        try {
          const existsResult = await adminClient.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [targetDbName]
          );
          if (existsResult.rowCount === 0) {
            const escapedDb = targetDbName.replace(/"/g, '""');
            await adminClient.query(`CREATE DATABASE "${escapedDb}"`);
          }
        } finally {
          await adminClient.end();
        }
      } catch {
        // Database may be unreachable when running unit-only suites without Docker; let Prisma report if needed
      }
    }

    console.log('Applying Prisma migrations to isolated test database (provider: postgresql)...');

    const migrateEnv = { ...process.env, DATABASE_URL: testDbUrl };
    delete migrateEnv.POSTGRES_URL_NON_POOLING;

    const migrateResult = child_process.spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: migrateEnv,
    });

    const migrateStdout = migrateResult.stdout ? migrateResult.stdout.toString() : '';
    const migrateStderr = migrateResult.stderr ? migrateResult.stderr.toString() : '';
    if (migrateStdout) process.stdout.write(migrateStdout);
    if (migrateStderr) process.stderr.write(migrateStderr);

    if (migrateResult.status !== 0) {
      const combinedMigrateOutput = `${migrateStdout}\n${migrateStderr}`;
      if (
        /\bP3005\b/.test(combinedMigrateOutput) &&
        isIsolatedTestDb &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(targetSchema)
      ) {
        console.warn(
          `Detected unbaselined schema "${targetSchema}" in "${targetDbName}" from prior local "prisma db push" state (P3005). Resetting "${targetSchema}" schema and retrying "npx prisma migrate deploy"...`
        );
        const { default: pg } = await import('pg');
        const resetClient = new pg.Client({ connectionString: testDbUrl });
        await resetClient.connect();
        try {
          const escapedSchema = targetSchema.replace(/"/g, '""');
          await resetClient.query(`DROP SCHEMA IF EXISTS "${escapedSchema}" CASCADE`);
          await resetClient.query(`CREATE SCHEMA "${escapedSchema}"`);
          await resetClient.query(`GRANT ALL ON SCHEMA "${escapedSchema}" TO CURRENT_USER`);
          await resetClient.query(`GRANT ALL ON SCHEMA "${escapedSchema}" TO PUBLIC`);
        } finally {
          await resetClient.end();
        }

        runCommand('npx', ['prisma', 'migrate', 'deploy'], {
          env: migrateEnv,
        });
      } else {
        console.error('Command failed: npx prisma migrate deploy');
        process.exit(migrateResult.status || 1);
      }
    }

    // Run Prisma Client generation after migrate deploy so it is aligned with the active schema
    console.log('Generating Prisma Client...');
    runCommand('npm', ['run', 'prisma:generate']);

    console.log('Staging documentation portal...');
    runCommand('npx', ['tsx', 'scripts/generate-portal.ts']);
  } else {
    console.log('Running full build...');
    runCommand('npm', ['run', 'build']);
  }
}

main().catch(err => {
  console.error('Pretest preflight script failed with error:', err);
  process.exit(1);
});
