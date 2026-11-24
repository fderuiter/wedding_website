import { execFile } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ENTRYPOINT_PATH = path.resolve(__dirname, '../../docker-entrypoint.sh');

describe('docker-entrypoint.sh', () => {
  it('fails fast when DATABASE_URL is missing', (done) => {
    execFile(ENTRYPOINT_PATH, ['echo', 'booted'], { env: { ...process.env, DATABASE_URL: '' } }, (error, stdout, stderr) => {
      expect(error).not.toBeNull();
      expect(error?.code).toBe(1);
      const output = stdout + stderr;
      expect(output).toContain('ERROR: Missing mandatory configuration secret: DATABASE_URL.');
      expect(output).not.toContain('Running database migrations...');
      done();
    });
  });

  it('fails when DATABASE_URL format is invalid', (done) => {
    execFile(ENTRYPOINT_PATH, ['echo', 'booted'], { env: { ...process.env, DATABASE_URL: 'invalid_connection_string' } }, (error, stdout, stderr) => {
      expect(error).not.toBeNull();
      expect(error?.code).toBe(1);
      const output = stdout + stderr;
      expect(output).toContain('ERROR: Invalid format for DATABASE_URL.');
      expect(output).not.toContain('Running database migrations...');
      done();
    });
  });

  it('boots application immediately without executing database migrations when DATABASE_URL is valid', (done) => {
    const validUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding';
    execFile(ENTRYPOINT_PATH, ['echo', 'booted'], { env: { ...process.env, DATABASE_URL: validUrl } }, (error, stdout, stderr) => {
      expect(error).toBeNull();
      const output = stdout + stderr;
      expect(output).toContain('Starting application...');
      expect(output).toContain('booted');
      expect(output).not.toContain('Running database migrations...');
      expect(output).not.toContain('prisma migrate');
      done();
    });
  });

  it('executes ./node_modules/.bin/prisma migrate deploy locally with npm update checks disabled when RUN_MIGRATIONS=true', (done) => {
    const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-workdir-'));
    const localBinDir = path.join(tempWorkDir, 'node_modules', '.bin');
    fs.mkdirSync(localBinDir, { recursive: true });
    const stubPrismaPath = path.join(localBinDir, 'prisma');
    fs.writeFileSync(
      stubPrismaPath,
      '#!/bin/sh\necho "LOCAL_PRISMA_INVOKED:$*:NOTIFIER=$NPM_CONFIG_UPDATE_NOTIFIER:CHECKPOINT=$CHECKPOINT_DISABLE"\nexit 0\n',
      { mode: 0o755 },
    );

    const validUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding';
    execFile(
      ENTRYPOINT_PATH,
      ['echo', 'booted'],
      {
        cwd: tempWorkDir,
        env: {
          ...process.env,
          DATABASE_URL: validUrl,
          RUN_MIGRATIONS: 'true',
        },
      },
      (error, stdout, stderr) => {
        fs.rmSync(tempWorkDir, { recursive: true, force: true });
        expect(error).toBeNull();
        const output = stdout + stderr;
        expect(output).toContain('Running database migrations (RUN_MIGRATIONS=true)...');
        expect(output).toContain('LOCAL_PRISMA_INVOKED:migrate deploy:NOTIFIER=false:CHECKPOINT=1');
        expect(output).not.toContain('npm notice');
        expect(output).toContain('booted');
        done();
      },
    );
  });

  it('executes local prisma migrate deploy from PATH when RUN_MIGRATIONS=true and ./node_modules/.bin/prisma is absent', (done) => {
    const tempBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-bin-'));
    const stubPrismaPath = path.join(tempBinDir, 'prisma');
    fs.writeFileSync(
      stubPrismaPath,
      '#!/bin/sh\necho "STUB_PRISMA_INVOKED:$*"\nexit 0\n',
      { mode: 0o755 },
    );

    const validUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding';
    execFile(
      ENTRYPOINT_PATH,
      ['echo', 'booted'],
      {
        cwd: tempBinDir,
        env: {
          ...process.env,
          DATABASE_URL: validUrl,
          RUN_MIGRATIONS: 'true',
          PATH: `${tempBinDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        },
      },
      (error, stdout, stderr) => {
        fs.rmSync(tempBinDir, { recursive: true, force: true });
        expect(error).toBeNull();
        const output = stdout + stderr;
        expect(output).toContain('Running database migrations (RUN_MIGRATIONS=true)...');
        expect(output).toContain('STUB_PRISMA_INVOKED:migrate deploy');
        expect(output).toContain('booted');
        done();
      },
    );
  });

  it('rejects empty-host TCP URIs that omit a valid ?host=/... socket path without leaking credentials', (done) => {
    const secret = 'TOP_SECRET_DB_PASSWORD_77';
    execFile(
      ENTRYPOINT_PATH,
      ['echo', 'booted'],
      {
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://wedding:${secret}@/wedding_db`,
        },
      },
      (error, stdout, stderr) => {
        expect(error).not.toBeNull();
        expect(error?.code).toBe(1);
        const output = stdout + stderr;
        expect(output).toContain('ERROR: Invalid format for DATABASE_URL.');
        expect(output).not.toContain(secret);
        expect(output).not.toContain('booted');
        done();
      },
    );
  });

  it('accepts and normalizes @/ Cloud SQL Unix socket URIs to @localhost before running migrations and booting', (done) => {
    const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-socket-'));
    const localBinDir = path.join(tempWorkDir, 'node_modules', '.bin');
    fs.mkdirSync(localBinDir, { recursive: true });
    const stubPrismaPath = path.join(localBinDir, 'prisma');
    fs.writeFileSync(
      stubPrismaPath,
      '#!/bin/sh\necho "PRISMA_SEES_HOST=$(printf %s "$DATABASE_URL" | sed -E "s|^[^@]+@([^/?]+).*|\\1|")"\nexit 0\n',
      { mode: 0o755 },
    );

    const socketShorthandUrl =
      'postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/my-proj:us-central1:wedding-db';

    execFile(
      ENTRYPOINT_PATH,
      ['node', '-e', 'process.stdout.write("APP_HOST=" + new URL(process.env.DATABASE_URL).hostname + "\\n")'],
      {
        cwd: tempWorkDir,
        env: {
          ...process.env,
          DATABASE_URL: socketShorthandUrl,
          RUN_MIGRATIONS: 'true',
        },
      },
      (error, stdout, stderr) => {
        fs.rmSync(tempWorkDir, { recursive: true, force: true });
        expect(error).toBeNull();
        const output = stdout + stderr;
        expect(output).toContain('PRISMA_SEES_HOST=localhost');
        expect(output).toContain('APP_HOST=localhost');
        done();
      },
    );
  });

  it('runs node scripts/generate-password-hash.mjs without DATABASE_URL or executing migrations', (done) => {
    const repoRoot = path.resolve(__dirname, '../..');
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.DATABASE_URL;
    cleanEnv.RUN_MIGRATIONS = 'true';

    execFile(
      ENTRYPOINT_PATH,
      ['node', 'scripts/generate-password-hash.mjs', 'secret'],
      {
        cwd: repoRoot,
        env: cleanEnv,
      },
      (error, stdout, stderr) => {
        expect(error).toBeNull();
        expect(stderr).toBe('');
        expect(stdout.trim()).toMatch(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
        done();
      },
    );
  });

  it('strips matching outer double and single quotes from DATABASE_URL injected by docker run --env-file', (done) => {
    const rawUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding?schema=public';
    execFile(
      ENTRYPOINT_PATH,
      ['node', '-e', 'process.stdout.write("UNQUOTED_URL=" + process.env.DATABASE_URL + "\\n")'],
      {
        env: {
          ...process.env,
          DATABASE_URL: `"${rawUrl}"`,
        },
      },
      (doubleErr, doubleStdout) => {
        expect(doubleErr).toBeNull();
        expect(doubleStdout).toContain(`UNQUOTED_URL=${rawUrl}`);

        execFile(
          ENTRYPOINT_PATH,
          ['node', '-e', 'process.stdout.write("UNQUOTED_SINGLE=" + process.env.DATABASE_URL + "\\n")'],
          {
            env: {
              ...process.env,
              DATABASE_URL: `'${rawUrl}'`,
            },
          },
          (singleErr, singleStdout) => {
            expect(singleErr).toBeNull();
            expect(singleStdout).toContain(`UNQUOTED_SINGLE=${rawUrl}`);
            done();
          },
        );
      },
    );
  });

  it('aborts before invoking prisma migrate deploy when ssl=true targets a plaintext PostgreSQL server without leaking credentials', (done) => {
    const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-tls-gate-'));
    const localBinDir = path.join(tempWorkDir, 'node_modules', '.bin');
    fs.mkdirSync(localBinDir, { recursive: true });
    const stubPrismaPath = path.join(localBinDir, 'prisma');
    fs.writeFileSync(
      stubPrismaPath,
      '#!/bin/sh\necho "UNSAFE_PLAINTEXT_MIGRATE_INVOKED"\nexit 0\n',
      { mode: 0o755 },
    );

    const plainServer = net.createServer((socket) => {
      socket.once('data', () => {
        socket.end(Buffer.from('N', 'ascii'));
      });
    });

    plainServer.listen(0, '127.0.0.1', () => {
      const { port } = plainServer.address() as net.AddressInfo;
      const secret = 'ENTRYPOINT_TLS_SECRET_882';
      const sslTrueUrl = `postgresql://wedding:${secret}@127.0.0.1:${port}/wedding?ssl=true`;

      execFile(
        ENTRYPOINT_PATH,
        ['echo', 'booted'],
        {
          cwd: tempWorkDir,
          env: {
            ...process.env,
            DATABASE_URL: sslTrueUrl,
            RUN_MIGRATIONS: 'true',
          },
        },
        (error, stdout, stderr) => {
          fs.rmSync(tempWorkDir, { recursive: true, force: true });
          plainServer.close(() => {
            expect(error).not.toBeNull();
            expect(error?.code).toBe(1);
            const output = stdout + stderr;
            expect(output).toContain('Pre-migration PostgreSQL TLS handshake check failed');
            expect(output).not.toContain('UNSAFE_PLAINTEXT_MIGRATE_INVOKED');
            expect(output).not.toContain('booted');
            expect(output).not.toContain(secret);
            done();
          });
        },
      );
    });
  });
});
