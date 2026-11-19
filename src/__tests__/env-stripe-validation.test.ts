/** @jest-environment node */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  getStripeCapability,
  getStripeInstance,
  getStripePromise,
  isValidStripePublishableKey,
  isValidStripeSecretKey,
} from '@/lib/stripe';

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: jest.fn((key: string) => Promise.resolve({ mockedKey: key })),
}));

describe('Stripe Startup Environment Validation & Runtime Capability Detection', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const validAdminPassword = 'scrypt:c2FsdA==:aGFzaA==';
  const validDatabaseUrl = 'postgresql://wedding:wedding123@localhost:5432/wedding';
  const validGuestSessionSecret = 'a-secure-guest-session-secret-32-chars-minimum!';

  function runEnvBoot(envOverrides: Record<string, string | undefined>) {
    const cleanEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
    };

    for (const [key, val] of Object.entries(envOverrides)) {
      if (val !== undefined) {
        cleanEnv[key] = val;
      }
    }

    return spawnSync(process.execPath, ['--input-type=module', '-e', 'import("./src/env.ts")'], {
      cwd: rootDir,
      env: cleanEnv,
      encoding: 'utf-8',
    });
  }

  describe('Startup Validation (src/env.ts)', () => {
    it('Acceptance Criterion 1: fails fast when only STRIPE_SECRET_KEY is provided without NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: validGuestSessionSecret,
        STRIPE_SECRET_KEY: 'sk_live_valid_secret_key_12345',
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Incomplete Stripe credentials');
      expect(res.stderr).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
    });

    it('Acceptance Criterion 1: fails fast when only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is provided without STRIPE_SECRET_KEY', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: validGuestSessionSecret,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_valid_publishable_key_12345',
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Incomplete Stripe credentials');
      expect(res.stderr).toContain('STRIPE_SECRET_KEY');
    });

    it('Requirement 2: rejects placeholder mock Stripe keys in non-test environments', () => {
      const prodRes = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: validGuestSessionSecret,
        STRIPE_SECRET_KEY: 'sk_test_placeholder_mock_key',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder_mock_key',
      });

      expect(prodRes.status).not.toBe(0);
      expect(prodRes.stderr).toContain('must not use a placeholder mock key');

      const devRes = runEnvBoot({
        NODE_ENV: 'development',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        STRIPE_SECRET_KEY: 'sk_test_placeholder_mock_key',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder_mock_key',
      });

      expect(devRes.status).not.toBe(0);
      expect(devRes.stderr).toContain('must not use a placeholder mock key');
    });

    it('rejects malformed Stripe key prefixes at startup', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: validGuestSessionSecret,
        STRIPE_SECRET_KEY: 'invalid_secret_prefix',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'invalid_pub_prefix',
        STRIPE_WEBHOOK_SECRET: 'invalid_webhook_prefix',
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('STRIPE_SECRET_KEY must start with sk_ or rk_');
      expect(res.stderr).toContain('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with pk_');
      expect(res.stderr).toContain('STRIPE_WEBHOOK_SECRET must start with whsec_');
    });

    it('succeeds when all Stripe variables are omitted (optional group)', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: validGuestSessionSecret,
      });

      expect(res.status).toBe(0);
    });

    it('succeeds when both valid card keys and optional webhook secret are provided', () => {
      const res = runEnvBoot({
        NODE_ENV: 'production',
        ADMIN_PASSWORD: validAdminPassword,
        DATABASE_URL: validDatabaseUrl,
        GUEST_SESSION_SECRET: validGuestSessionSecret,
        STRIPE_SECRET_KEY: 'sk_live_real_secret_key_987654321',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_real_publishable_key_987654321',
        STRIPE_WEBHOOK_SECRET: 'whsec_real_webhook_secret_987654321',
      });

      expect(res.status).toBe(0);
    });
  });

  describe('Runtime Capability & Non-Test Guards (src/lib/stripe.ts)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.clearAllMocks();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('rejects placeholder keys in non-test validation checks', () => {
      expect(isValidStripeSecretKey('sk_test_placeholder_mock_key', false)).toBe(false);
      expect(isValidStripePublishableKey('pk_test_placeholder_mock_key', false)).toBe(false);
      expect(isValidStripeSecretKey('sk_live_1234567890', false)).toBe(true);
      expect(isValidStripePublishableKey('pk_live_1234567890', false)).toBe(true);
    });

    it('throws from getStripeInstance and skips loadStripe in non-test runtimes without valid credentials', async () => {
      const { loadStripe } = jest.requireMock('@stripe/stripe-js');
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

      expect(getStripeCapability()).toEqual({
        cardCheckoutEnabled: false,
        stripePublishableKey: null,
      });

      expect(() => getStripeInstance()).toThrow(/Card checkout is not configured/i);

      const clientResult = await getStripePromise();
      expect(clientResult).toBeNull();
      expect(loadStripe).not.toHaveBeenCalled();
    });
  });
});
