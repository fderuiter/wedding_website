import { execFile } from 'child_process';
import fs from 'fs';
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

  it('executes local prisma migrate deploy from PATH when RUN_MIGRATIONS=true', (done) => {
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
});
