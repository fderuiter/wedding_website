/** @jest-environment node */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('Production Boot Guest Session Secret Validation', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const validAdminPassword =
    'scrypt:dW5pdC10ZXN0LXNhbHQxNg==:PxxxlLtwOUqVGvw72ACcfwWGGFau07MUM+msUoc1D7VCuwBRorFQiYrVmcl29ZeTYQoAfO/azRoQ1cQKvm9Tmw==';
  const validDatabaseUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding';
  const valid32Secret = 'a-secure-guest-session-secret-32-chars-minimum!';
  const validGuestPasscode = 'custom-production-guest-passcode-2026';

  function runEnvBoot(envOverrides: Record<string, string | undefined>, extraArgs: string[] = []) {
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
      ['--input-type=module', '-e', 'import("./src/env.ts")', ...extraArgs],
      {
        cwd: rootDir,
        env: cleanEnv as unknown as NodeJS.ProcessEnv,
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

    it('halts startup when GUEST_PASSCODE is unset', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: valid32Secret,
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_PASSCODE environment variable is missing in production environment');
    });

    it('halts startup when GUEST_PASSCODE is empty or whitespace', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: '   ',
        GUEST_SESSION_SECRET: valid32Secret,
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_PASSCODE environment variable is missing in production environment');
    });

    it('halts startup when GUEST_PASSCODE equals default wedding2026', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: 'wedding2026',
        GUEST_SESSION_SECRET: valid32Secret,
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('GUEST_PASSCODE must not use the default fallback passcode in production');
    });

    it('halts startup when ADMIN_PASSWORD uses invalid 4-byte scrypt:c2FsdA==:aGFzaA== placeholder', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'scrypt:c2FsdA==:aGFzaA==',
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: validGuestPasscode,
        GUEST_SESSION_SECRET: valid32Secret,
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('scrypt:[16-byte saltBase64]:[64-byte keyBase64]');
    });

    it('halts startup when ADMIN_PASSWORD, GUEST_PASSCODE, or GUEST_SESSION_SECRET uses E2E or template placeholders in production', () => {
      const e2eAdminRes = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD:
          'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: validGuestPasscode,
        GUEST_SESSION_SECRET: valid32Secret,
      });
      expect(e2eAdminRes.status).not.toBe(0);
      expect(e2eAdminRes.stderr).toContain('ADMIN_PASSWORD must not use a placeholder or E2E fallback hash in production');

      const dummyAdminRes = runEnvBoot({
        NODE_ENV: 'production',
        E2E_TEST: 'true',
        ADMIN_PASSWORD:
          'scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: 'playwright-e2e-guest-passcode',
        GUEST_SESSION_SECRET: 'playwright-e2e-session-secret-32-chars-min',
      });
      expect(dummyAdminRes.status).not.toBe(0);
      expect(dummyAdminRes.stderr).toContain('ADMIN_PASSWORD must not use a placeholder or E2E fallback hash in production');

      const e2ePasscodeRes = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: 'playwright-e2e-guest-passcode',
        GUEST_SESSION_SECRET: valid32Secret,
      });
      expect(e2ePasscodeRes.status).not.toBe(0);
      expect(e2ePasscodeRes.stderr).toContain('GUEST_PASSCODE must not use a placeholder or E2E fallback passcode in production');

      const e2eSessionRes = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: validGuestPasscode,
        GUEST_SESSION_SECRET: 'playwright-e2e-session-secret-32-chars-min',
      });
      expect(e2eSessionRes.status).not.toBe(0);
      expect(e2eSessionRes.stderr).toContain('GUEST_SESSION_SECRET must not use a placeholder or E2E fallback secret in production');
    });

    it('succeeds when a distinct secret of at least 32 characters and unique GUEST_PASSCODE are present', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: validGuestPasscode,
        GUEST_SESSION_SECRET: valid32Secret,
      });

      expect(res.status).toBe(0);
    });

    it('preserves build-time and static-export bypasses in NODE_ENV=production without runtime secrets', () => {
      const buildRes = runEnvBoot({
        NODE_ENV: 'production',
        npm_lifecycle_event: 'build',
      });
      expect(buildRes.status).toBe(0);

      const nextPhaseRes = runEnvBoot({
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
      });
      expect(nextPhaseRes.status).toBe(0);

      const exportRes = runEnvBoot({
        NODE_ENV: 'production',
        STATIC_EXPORT: 'true',
      });
      expect(exportRes.status).toBe(0);

      const preflightRes = runEnvBoot(
        {
          NODE_ENV: 'production',
        },
        ['scripts/preflight-migration-summary.ts']
      );
      expect(preflightRes.status).toBe(0);
    });

    it('permits .env.example guest placeholders during npm_lifecycle_event=build with a valid admin hash or dummy template hash', () => {
      const withValidAdminRes = runEnvBoot({
        NODE_ENV: 'production',
        npm_lifecycle_event: 'build',
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding?schema=public',
        ADMIN_PASSWORD: validAdminPassword,
        ALLOWED_HOSTS: 'localhost,127.0.0.1,*.localhost,wedding.example,*.wedding.example',
        GUEST_PASSCODE: 'your-unique-guest-passcode',
        GUEST_SESSION_SECRET: 'your-dedicated-guest-session-secret',
      });
      expect(withValidAdminRes.status).toBe(0);

      const withTemplateDefaultsRes = runEnvBoot({
        NODE_ENV: 'production',
        npm_lifecycle_event: 'build',
        DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding?schema=public',
        ADMIN_PASSWORD:
          'scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        ALLOWED_HOSTS: 'localhost,127.0.0.1,*.localhost,wedding.example,*.wedding.example',
        GUEST_PASSCODE: 'your-unique-guest-passcode',
        GUEST_SESSION_SECRET: 'your-dedicated-guest-session-secret',
      });
      expect(withTemplateDefaultsRes.status).toBe(0);
    });

    it('rejects .env.example guest placeholders at production runtime and permits E2E fallbacks only when E2E_TEST=true', () => {
      const templatePasscodeRes = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: 'your-unique-guest-passcode',
        GUEST_SESSION_SECRET: valid32Secret,
      });
      expect(templatePasscodeRes.status).not.toBe(0);
      expect(templatePasscodeRes.stderr).toContain(
        'GUEST_PASSCODE must not use a placeholder or E2E fallback passcode in production'
      );

      const templateSecretRes = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: validGuestPasscode,
        GUEST_SESSION_SECRET: 'your-dedicated-guest-session-secret',
      });
      expect(templateSecretRes.status).not.toBe(0);
      expect(templateSecretRes.stderr).toContain(
        'GUEST_SESSION_SECRET must not use a placeholder or E2E fallback secret in production'
      );

      const e2eRuntimeRes = runEnvBoot({
        NODE_ENV: 'production',
        E2E_TEST: 'true',
        ADMIN_PASSWORD:
          'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
        DATABASE_URL: validDatabaseUrl,
        GUEST_PASSCODE: 'playwright-e2e-guest-passcode',
        GUEST_SESSION_SECRET: 'playwright-e2e-session-secret-32-chars-min',
      });
      expect(e2eRuntimeRes.status).toBe(0);
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
