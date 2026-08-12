import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

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
      const startResult = child_process.spawnSync('docker', ['compose', 'up', '-d', 'db'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: true
      });

      if (startResult.status !== 0) {
        console.warn('Failed to start database container via docker compose. Proceeding assuming database is already running...');
      } else {
        console.log('Waiting for database to be ready...');
        let ready = false;
        for (let i = 0; i < 15; i++) {
          try {
            const check = child_process.spawnSync('docker', ['compose', 'exec', 'db', 'pg_isready', '-U', 'wedding'], { stdio: 'ignore', shell: true });
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
    let testDbUrl = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
    
    // Check if we should fallback to SQLite if postgres is not accessible
    const isPostgresUrl = testDbUrl.startsWith('postgres://') || testDbUrl.startsWith('postgresql://');
    if (isPostgresUrl) {
      console.log('Checking if PostgreSQL database is reachable on localhost:5432...');
      const postgresActive = await new Promise((resolve) => {
        const socket = net.createConnection({ port: 5432, host: 'localhost', timeout: 1000 });
        socket.on('connect', () => {
          socket.end();
          resolve(true);
        });
        socket.on('error', () => {
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });

      if (!postgresActive) {
        console.warn('PostgreSQL is not reachable. Falling back to zero-config SQLite test database (file:./test.db)...');
        testDbUrl = 'file:./test.db';
      } else {
        console.log('PostgreSQL database is active.');
      }
    }

    process.env.DATABASE_URL = testDbUrl;

    // Run schema adaptation before doing db push and generate
    const { adapt } = await import('./adapt-schema.js');
    adapt();

    console.log(`Synchronizing schema to isolated test database: ${testDbUrl}`);

    runCommand('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: testDbUrl },
      ignoreFailure: true
    });

    // Run Prisma Client generation after adaptation/push so it is perfectly aligned with the correct schema provider
    console.log('Generating Prisma Client matching the active schema...');
    runCommand('npm', ['run', 'prisma:generate']);
  } else {
    console.log('Running full build...');
    runCommand('npm', ['run', 'build']);
  }
}

main().catch(err => {
  console.error('Pretest preflight script failed with error:', err);
  process.exit(1);
});
