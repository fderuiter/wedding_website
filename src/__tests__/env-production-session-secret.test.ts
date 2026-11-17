/** @jest-environment node */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('Production Boot Guest Session Secret Validation', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const validAdminPassword = 'scrypt:c2FsdA==:aGFzaA==';
  const validDatabaseUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding';
  const valid32Secret = 'a-secure-guest-session-secret-32-chars-minimum!';

  function runEnvBoot(envOverrides: Record<string, string | undefined>) {
    // Construct clean env object
    const cleanEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
    };

    for (const [key, val] of Object.entries(envOverrides)) {
      if (val !== undefined) {
        cleanEnv[key] = val;
      }
    }

    return spawnSync(
      process.execPath,
      ['--input-type=module', '-e', 'import("./src/env.ts")'],
      {
        cwd: rootDir,
        env: cleanEnv,
        encoding: 'utf-8',
      }
    );
  }

  describe('Production Environment (NODE_ENV=production)', () => {
    it('halts startup when GUEST_SESSION_SECRET is unset', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_SESSION_SECRET environment variable is missing in production environment');
    });

    it('halts startup when GUEST_SESSION_SECRET is empty string', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: '',
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_SESSION_SECRET environment variable is missing in production environment');
    });

    it('halts startup when GUEST_SESSION_SECRET equals default-guest-session-secret', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: 'default-guest-session-secret',
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_SESSION_SECRET must not use the default fallback secret in production');
    });

    it('halts startup when GUEST_SESSION_SECRET is shorter than 32 characters (entropy check)', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: 'too-short-secret-under-32-chars',
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_SESSION_SECRET must be at least 32 characters long in production');
    });

    it('halts startup when GUEST_SESSION_SECRET matches GUEST_PASSCODE', () => {
      const passcode = 'custom-wedding-passcode-for-testing-1234';
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: passcode,
        GUEST_SESSION_SECRET: passcode,
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_SESSION_SECRET must not match GUEST_PASSCODE');
    });

    it('succeeds when a distinct secret of at least 32 characters is present', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: valid32Secret,
      });

      expect(res.status).toBe(0);
    });
  });

  describe('Non-Production Environments (development / test)', () => {
    it('starts successfully in development without requiring manual secret configuration', () => {
      const res = runEnvBoot({
        NODE_ENV: 'development',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
      });

      expect(res.status).toBe(0);
    });

    it('starts successfully in test without requiring manual secret configuration', () => {
      const res = runEnvBoot({
        NODE_ENV: 'test',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
      });

      expect(res.status).toBe(0);
    });
  });
});
