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
  const isCi = Boolean(process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0');

  // 1. Verify dependency alignment (local environments only; CI jobs already run npm ci)
  if (isCi) {
    console.log('CI environment detected. Skipping redundant dependency installation check.');
  } else {
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
  }

  // 2. Selective Execution based on lifecycle event
  const lifecycleEvent = process.env.npm_lifecycle_event || '';
  const isUnitTest = lifecycleEvent.includes('test');

  if (isUnitTest) {
    console.log('Unit test phase detected. Skipping full build...');

    const testResultsDir = path.join(rootDir, 'test-results');
    fs.mkdirSync(testResultsDir, { recursive: true });
    fs.writeFileSync(path.join(testResultsDir, 'jest-a11y-violations.json'), '[]\n', 'utf8');

    if (isCi) {
      console.log('CI environment detected. Using workflow PostgreSQL service without starting local Docker Compose.');
    } else {
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
        const ciComposeArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml'];
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
    }

    const envPath = path.join(rootDir, '.env.test');

    // Strict Test Environment Isolation: Ignore parent shell database environment variables and isolated test variables
    const pgVars = ['DATABASE_URL', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGDATASOURCE', 'ADMIN_PASSWORD'];
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

    console.log('Synchronizing schema to isolated test database (provider: postgresql)...');

    runCommand('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: testDbUrl }
    });

    const prismaClientDir = path.join(rootDir, 'node_modules', '.prisma', 'client');
    if (!isCi || !fs.existsSync(prismaClientDir)) {
      // Run Prisma Client generation after db push when running locally or if client artifacts are missing
      console.log('Generating Prisma Client...');
      runCommand('npm', ['run', 'prisma:generate']);
    }

    console.log('Staging documentation portal...');
    runCommand('npx', ['tsx', 'scripts/generate-portal.ts', '--skip-sync']);
  } else {
    console.log('Running full build...');
    runCommand('npm', ['run', 'build']);
  }
}

main().catch(err => {
  console.error('Pretest preflight script failed with error:', err);
  process.exit(1);
});
