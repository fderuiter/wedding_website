import { z } from 'zod';
import {
  isLoopbackPostgresHost,
  isValidPostgresUrl,
  normalizePostgresUrl,
  parsePostgresUrl,
} from './lib/postgres-url.js';
import {
  getProductionTrustProxyError,
  isValidTrustProxyInput,
  parseTrustProxyValue,
} from './lib/trustProxyPolicy.js';

const DISALLOWED_PROD_REMOTE_POSTGRES_TLS_MODES = new Set([
  'disable',
  'allow',
  'prefer',
  'no-verify',
]);

function getInsecureProductionPostgresTlsError(
  rawUrl: string | undefined,
  varName: 'DATABASE_URL' | 'POSTGRES_URL_NON_POOLING'
): string | null {
  if (!rawUrl || !isValidPostgresUrl(rawUrl)) {
    return null;
  }
  const parsed = parsePostgresUrl(rawUrl);
  if (parsed.isUnixSocket || isLoopbackPostgresHost(parsed.host)) {
    return null;
  }
  // Preserve explicit sslmode=disable opt-out for the internal single-host Compose `db` service
  if (parsed.host.toLowerCase() === 'db' && parsed.sslmode === 'disable') {
    return null;
  }
  if (DISALLOWED_PROD_REMOTE_POSTGRES_TLS_MODES.has(parsed.tlsMode)) {
    return `${varName} must not use insecure TLS mode "${parsed.tlsMode}" for remote PostgreSQL hosts in production; omit sslmode (defaults to verify-full) or set sslmode=require, sslmode=verify-ca, or sslmode=verify-full`;
  }
  return null;
}

function enforceProductionPostgresTlsRefinement(
  data: {
    NODE_ENV: 'development' | 'test' | 'production';
    DATABASE_URL: string;
    POSTGRES_URL_NON_POOLING?: string;
  },
  ctx: z.RefinementCtx
): void {
  if (data.NODE_ENV !== 'production' || isBuildTime) {
    return;
  }
  for (const varName of ['DATABASE_URL', 'POSTGRES_URL_NON_POOLING'] as const) {
    const tlsError = getInsecureProductionPostgresTlsError(data[varName], varName);
    if (tlsError) {
      ctx.addIssue({
        code: 'custom',
        path: [varName],
        message: tlsError,
      });
    }
  }
}

function enforceProductionTrustProxyRefinement(
  data: {
    NODE_ENV: 'development' | 'test' | 'production';
    ALLOWED_HOSTS: string;
    TRUST_PROXY: boolean | number;
  },
  ctx: z.RefinementCtx
): void {
  const trustProxyError = getProductionTrustProxyError({
    isProduction: data.NODE_ENV === 'production',
    isBuildTime,
    isE2ETestMode: process.env.E2E_TEST === 'true',
    allowedHosts: data.ALLOWED_HOSTS,
    parsedTrustProxy: data.TRUST_PROXY,
  });
  if (trustProxyError) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_PROXY'],
      message: trustProxyError,
    });
  }
}

function isPlaceholderStripeKey(key: string): boolean {
  const prefix = key.slice(0, 3);
  return (prefix === 'sk_' || prefix === 'pk_') && key.slice(3) === 'test_placeholder_mock_key';
}

const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;

const BUILD_FALLBACK_ADMIN_PASSWORD =
  'scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

const ALWAYS_BLOCKED_PROD_ADMIN_HASHES = new Set([
  'scrypt:c2FsdA==:aGFzaA==',
  BUILD_FALLBACK_ADMIN_PASSWORD,
]);

const E2E_FALLBACK_ADMIN_HASHES = new Set([
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
]);

const ALWAYS_BLOCKED_PROD_GUEST_PASSCODES = new Set([
  'wedding2026',
  'your-unique-guest-passcode',
  'replace-with-unique-guest-passcode',
]);

const E2E_FALLBACK_GUEST_PASSCODES = new Set([
  'playwright-e2e-guest-passcode',
  'build-fallback-guest-passcode',
  'test-standalone-guest-passcode',
]);

const ALWAYS_BLOCKED_PROD_SESSION_SECRETS = new Set([
  'default-guest-session-secret',
  'your-dedicated-guest-session-secret',
  'replace-with-random-secret-at-least-32-characters',
]);

const E2E_FALLBACK_SESSION_SECRETS = new Set([
  'playwright-e2e-session-secret-32-chars-min',
  'test-guest-session-secret-key-at-least-32-chars',
  'test-standalone-guest-session-secret-32chars',
]);

const STRICT_BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeStrictBase64ByteLength(b64: string): number | null {
  if (!b64 || b64.length % 4 !== 0 || !STRICT_BASE64_REGEX.test(b64)) {
    return null;
  }
  try {
    const bin = atob(b64);
    return bin.length;
  } catch {
    return null;
  }
}

function stripEnvQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isCloudflareR2ApiEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'r2.cloudflarestorage.com' || host.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return /(?:^|\/\/|\.)r2\.cloudflarestorage\.com(?:[:/]|$)/i.test(endpoint);
  }
}

function isValidScryptAdminPassword(val: string): boolean {
  const normalized = stripEnvQuotes(val);
  const parts = normalized.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const saltBytes = decodeStrictBase64ByteLength(parts[1]);
  const keyBytes = decodeStrictBase64ByteLength(parts[2]);
  return saltBytes === SCRYPT_SALT_BYTES && keyBytes === SCRYPT_KEY_BYTES;
}

function normalizeOptionalEnv(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const unquoted = stripEnvQuotes(val);
  return unquoted.length > 0 ? unquoted : undefined;
}

// Conditionally skip production secret placeholder validation during build (e.g., for Next.js compilation or Prisma generation)
const isEdge = process.env.NEXT_RUNTIME === 'edge';
const procArgv = (!isEdge && typeof process !== 'undefined' && Array.isArray(process['argv'])) ? process['argv'] : [];
const isScriptRun = procArgv.some((arg: unknown) => typeof arg === 'string' && (
  arg.includes('seed') ||
  arg.includes('generate-') ||
  arg.includes('check-') ||
  arg.includes('verify-') ||
  arg.includes('preflight-')
));

const isStaticExport = process.env.STATIC_EXPORT === 'true' ||
                       process.env.STATIC_EXPORT === '1' ||
                       process.env.npm_lifecycle_event === 'build:export';

const isBuildTime = isEdge ||
                    isStaticExport ||
                    process.env.NEXT_PHASE === 'phase-production-build' ||
                    process.env.npm_lifecycle_event === 'build' ||
                    process.env.npm_lifecycle_event === 'build:docker' ||
                    process.env.npm_lifecycle_event === 'build:export' ||
                    process.env.npm_lifecycle_event === 'prebuild' ||
                    process.env.npm_lifecycle_event === 'prisma:generate' ||
                    process.env.npm_lifecycle_event === 'db:seed' ||
                    isScriptRun ||
                    process.env.NODE_ENV === 'test' ||
                    process.env.JEST_WORKER_ID !== undefined;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').transform(stripEnvQuotes).refine(val => {
    return val.length > 0 && isValidPostgresUrl(val);
  }, {
    message: 'DATABASE_URL must be a valid PostgreSQL URL',
  }).transform(val => normalizePostgresUrl(val)),
  POSTGRES_URL_NON_POOLING: z.string().optional().refine(val => {
    const normalized = normalizeOptionalEnv(val);
    if (!normalized) return true;
    return isValidPostgresUrl(normalized);
  }, {
    message: 'POSTGRES_URL_NON_POOLING must be a valid PostgreSQL URL',
  }).transform(val => {
    const normalized = normalizeOptionalEnv(val);
    return normalized ? normalizePostgresUrl(normalized) : undefined;
  }),
  ADMIN_PASSWORD: z
    .string()
    .min(1, 'ADMIN_PASSWORD is required')
    .transform(stripEnvQuotes)
    .refine(isValidScryptAdminPassword, {
      message:
        'ADMIN_PASSWORD must be in the format scrypt:[16-byte saltBase64]:[64-byte keyBase64]',
    }),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,*.localhost').transform(stripEnvQuotes).refine(val => {
    if (!val || typeof val !== 'string') return false;
    const hosts = val.split(',').map(h => h.trim()).filter(Boolean);
    if (hosts.length === 0) return false;
    return hosts.every(h => {
      return /^((\*\.|\.)?[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*|localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:[0-9]+)?$/.test(h);
    });
  }, {
    message: 'ALLOWED_HOSTS must be a non-empty comma-separated list of valid host domains or wildcard patterns',
  }),
  MULTISITE_ENABLED: z.union([z.boolean(), z.string()])
    .transform(val => {
      const normalized = typeof val === 'string' ? stripEnvQuotes(val) : val;
      return normalized === true || normalized === 'true' || normalized === '1';
    })
    .default(false),
  RUN_MIGRATIONS: z.union([z.boolean(), z.string()])
    .transform(val => {
      const normalized = typeof val === 'string' ? stripEnvQuotes(val) : val;
      return normalized === true || normalized === 'true' || normalized === '1';
    })
    .default(false),
  TRUST_PROXY: z.union([z.boolean(), z.number().int().min(0), z.string()])
    .optional()
    .default(false)
    .refine(isValidTrustProxyInput, {
      message: 'TRUST_PROXY must be true, false, or a non-negative integer hop count',
    })
    .transform((val): boolean | number => parseTrustProxyValue(val)),
  GUEST_PASSCODE: z.string().default('wedding2026').transform(stripEnvQuotes),
  GUEST_SESSION_SECRET: z.string().default('default-guest-session-secret').transform(stripEnvQuotes),
  HISTORY_VERSION_LIMIT: z.preprocess(
    val => (typeof val === 'string' ? stripEnvQuotes(val) : val),
    z.coerce.number().min(1)
  ).default(50),
  CRON_SECRET: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  S3_BUCKET: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  S3_REGION: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  S3_ACCESS_KEY_ID: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  S3_SECRET_ACCESS_KEY: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  S3_ENDPOINT: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  S3_PUBLIC_URL: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  STRIPE_SECRET_KEY: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional().transform(val => normalizeOptionalEnv(val)),
  STRIPE_WEBHOOK_SECRET: z.string().optional().transform(val => normalizeOptionalEnv(val)),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && !isBuildTime) {
    const isE2ETestMode = process.env.E2E_TEST === 'true';
    const trimmedAdminHash = data.ADMIN_PASSWORD?.trim() ?? '';
    if (
      ALWAYS_BLOCKED_PROD_ADMIN_HASHES.has(trimmedAdminHash) ||
      (!isE2ETestMode && E2E_FALLBACK_ADMIN_HASHES.has(trimmedAdminHash))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_PASSWORD'],
        message: 'ADMIN_PASSWORD must not use a placeholder or E2E fallback hash in production',
      });
    }

    const trimmedPasscode = data.GUEST_PASSCODE?.trim();
    if (
      !trimmedPasscode ||
      ALWAYS_BLOCKED_PROD_GUEST_PASSCODES.has(trimmedPasscode) ||
      (!isE2ETestMode && E2E_FALLBACK_GUEST_PASSCODES.has(trimmedPasscode))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GUEST_PASSCODE'],
        message: 'GUEST_PASSCODE is required and must not use a placeholder or fallback passcode in production',
      });
    }
    if (
      !data.GUEST_SESSION_SECRET ||
      ALWAYS_BLOCKED_PROD_SESSION_SECRETS.has(data.GUEST_SESSION_SECRET) ||
      (!isE2ETestMode && E2E_FALLBACK_SESSION_SECRETS.has(data.GUEST_SESSION_SECRET))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GUEST_SESSION_SECRET'],
        message: 'GUEST_SESSION_SECRET is required and must not use a placeholder or fallback secret in production',
      });
    } else if (data.GUEST_SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['GUEST_SESSION_SECRET'],
        message: 'GUEST_SESSION_SECRET must be at least 32 characters long in production',
      });
    }
  }
  enforceProductionPostgresTlsRefinement(data, ctx);
  enforceProductionTrustProxyRefinement(data, ctx);
  if (
    data.GUEST_SESSION_SECRET &&
    data.GUEST_PASSCODE &&
    (data.GUEST_SESSION_SECRET === data.GUEST_PASSCODE || data.GUEST_SESSION_SECRET === data.GUEST_PASSCODE.trim())
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['GUEST_SESSION_SECRET'],
      message: 'GUEST_SESSION_SECRET must not match GUEST_PASSCODE',
    });
  }
  const keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const presentKeys = keys.filter(key => !!data[key]);
  if (presentKeys.length > 0 && presentKeys.length < keys.length) {
    const missingKeys = keys.filter(key => !data[key]);
    missingKeys.forEach(key => {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Incomplete S3 credentials: ${key} is required when other S3 variables are set`,
      });
    });
  }
  if (data.S3_REGION?.toLowerCase() === 'auto' && !data.S3_ENDPOINT) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_ENDPOINT'],
      message:
        'Cloudflare R2 configurations with S3_REGION=auto must specify S3_ENDPOINT (for example, https://<ACCOUNT_ID>.r2.cloudflarestorage.com)',
    });
  }
  if (data.S3_ENDPOINT && isCloudflareR2ApiEndpoint(data.S3_ENDPOINT) && !data.S3_PUBLIC_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_PUBLIC_URL'],
      message:
        'Cloudflare R2 private API endpoints (*.r2.cloudflarestorage.com) cannot serve public assets directly; configure S3_PUBLIC_URL',
    });
  }

  const stripeSecretKey = normalizeOptionalEnv(data.STRIPE_SECRET_KEY);
  const stripePublishableKey = normalizeOptionalEnv(data.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const stripeWebhookSecret = normalizeOptionalEnv(data.STRIPE_WEBHOOK_SECRET);

  if (stripeSecretKey && !stripePublishableKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
      message: 'Incomplete Stripe credentials: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required when STRIPE_SECRET_KEY is set',
    });
  }
  if (stripePublishableKey && !stripeSecretKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['STRIPE_SECRET_KEY'],
      message: 'Incomplete Stripe credentials: STRIPE_SECRET_KEY is required when NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set',
    });
  }

  if (stripeSecretKey) {
    if (!stripeSecretKey.startsWith('sk_') && !stripeSecretKey.startsWith('rk_')) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'STRIPE_SECRET_KEY must start with sk_ or rk_',
      });
    } else if (data.NODE_ENV !== 'test' && isPlaceholderStripeKey(stripeSecretKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'STRIPE_SECRET_KEY must not use a placeholder mock key in non-test environments',
      });
    }
  }

  if (stripePublishableKey) {
    if (!stripePublishableKey.startsWith('pk_')) {
      ctx.addIssue({
        code: 'custom',
        path: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
        message: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with pk_',
      });
    } else if (data.NODE_ENV !== 'test' && isPlaceholderStripeKey(stripePublishableKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
        message: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must not use a placeholder mock key in non-test environments',
      });
    }
  }

  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('whsec_')) {
    ctx.addIssue({
      code: 'custom',
      path: ['STRIPE_WEBHOOK_SECRET'],
      message: 'STRIPE_WEBHOOK_SECRET must start with whsec_',
    });
  }
});

// In production runtime, strictly require valid environment variables
if (process.env.NODE_ENV === 'production' && !isBuildTime && process.env.NEXT_RUNTIME !== 'edge') {
  const isE2ETestMode = normalizeOptionalEnv(process.env.E2E_TEST) === 'true';
  const trimmedAdminPassword = normalizeOptionalEnv(process.env.ADMIN_PASSWORD);
  if (!trimmedAdminPassword) {
    console.error('❌ Security Error: ADMIN_PASSWORD environment variable is missing in production environment.');
    throw new Error('ADMIN_PASSWORD environment variable is required in production.');
  }
  if (!isValidScryptAdminPassword(trimmedAdminPassword)) {
    console.error(
      '❌ Security Error: ADMIN_PASSWORD must be in the format scrypt:[16-byte saltBase64]:[64-byte keyBase64].'
    );
    throw new Error(
      'ADMIN_PASSWORD must be in the format scrypt:[16-byte saltBase64]:[64-byte keyBase64].'
    );
  }
  if (
    ALWAYS_BLOCKED_PROD_ADMIN_HASHES.has(trimmedAdminPassword) ||
    (!isE2ETestMode && E2E_FALLBACK_ADMIN_HASHES.has(trimmedAdminPassword))
  ) {
    console.error('❌ Security Error: ADMIN_PASSWORD must not use a placeholder or E2E fallback hash in production.');
    throw new Error('ADMIN_PASSWORD must not use a placeholder or E2E fallback hash in production.');
  }
  const normalizedGuestSessionSecret = normalizeOptionalEnv(process.env.GUEST_SESSION_SECRET);
  if (!normalizedGuestSessionSecret) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET environment variable is missing in production environment.');
    throw new Error('GUEST_SESSION_SECRET environment variable is required in production.');
  }
  if (normalizedGuestSessionSecret === 'default-guest-session-secret') {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must not use the default fallback secret in production.');
    throw new Error('GUEST_SESSION_SECRET must not use the default fallback secret in production.');
  }
  if (
    ALWAYS_BLOCKED_PROD_SESSION_SECRETS.has(normalizedGuestSessionSecret) ||
    (!isE2ETestMode && E2E_FALLBACK_SESSION_SECRETS.has(normalizedGuestSessionSecret))
  ) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must not use a placeholder or E2E fallback secret in production.');
    throw new Error('GUEST_SESSION_SECRET must not use a placeholder or E2E fallback secret in production.');
  }
  if (normalizedGuestSessionSecret.length < 32) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must be at least 32 characters long in production.');
    throw new Error('GUEST_SESSION_SECRET must be at least 32 characters long in production.');
  }
  const trimmedGuestPasscode = normalizeOptionalEnv(process.env.GUEST_PASSCODE);
  if (!trimmedGuestPasscode) {
    console.error('❌ Security Error: GUEST_PASSCODE environment variable is missing in production environment.');
    throw new Error('GUEST_PASSCODE environment variable is required in production.');
  }
  if (trimmedGuestPasscode === 'wedding2026') {
    console.error('❌ Security Error: GUEST_PASSCODE must not use the default fallback passcode in production.');
    throw new Error('GUEST_PASSCODE must not use the default fallback passcode in production.');
  }
  if (
    ALWAYS_BLOCKED_PROD_GUEST_PASSCODES.has(trimmedGuestPasscode) ||
    (!isE2ETestMode && E2E_FALLBACK_GUEST_PASSCODES.has(trimmedGuestPasscode))
  ) {
    console.error('❌ Security Error: GUEST_PASSCODE must not use a placeholder or E2E fallback passcode in production.');
    throw new Error('GUEST_PASSCODE must not use a placeholder or E2E fallback passcode in production.');
  }
  if (normalizedGuestSessionSecret === trimmedGuestPasscode) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must not match GUEST_PASSCODE.');
    throw new Error('GUEST_SESSION_SECRET must not match GUEST_PASSCODE.');
  }
  const bootDatabaseUrlTlsError = getInsecureProductionPostgresTlsError(
    normalizeOptionalEnv(process.env.DATABASE_URL),
    'DATABASE_URL'
  );
  if (bootDatabaseUrlTlsError) {
    console.error(`❌ Security Error: ${bootDatabaseUrlTlsError}.`);
    throw new Error(`${bootDatabaseUrlTlsError}.`);
  }
  const bootNonPoolingUrlTlsError = getInsecureProductionPostgresTlsError(
    normalizeOptionalEnv(process.env.POSTGRES_URL_NON_POOLING),
    'POSTGRES_URL_NON_POOLING'
  );
  if (bootNonPoolingUrlTlsError) {
    console.error(`❌ Security Error: ${bootNonPoolingUrlTlsError}.`);
    throw new Error(`${bootNonPoolingUrlTlsError}.`);
  }
  const bootTrustProxyError = getProductionTrustProxyError({
    isProduction: true,
    isBuildTime,
    isE2ETestMode,
    allowedHosts: normalizeOptionalEnv(process.env.ALLOWED_HOSTS),
    rawTrustProxy: process.env.TRUST_PROXY,
  });
  if (bootTrustProxyError) {
    console.error(`❌ Security Error: ${bootTrustProxyError}.`);
    throw new Error(`${bootTrustProxyError}.`);
  }
}

// Even during build, fail if incomplete or invalid S3/R2 credentials are provided explicitly
const keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
const presentKeys = keys.filter(key => Boolean(normalizeOptionalEnv(process.env[key])));
if (presentKeys.length > 0 && presentKeys.length < keys.length) {
  const missingKeys = keys.filter(key => !normalizeOptionalEnv(process.env[key]));
  console.error('❌ Incomplete S3 credentials provided in environment variables:', missingKeys.join(', '));
  throw new Error('Incomplete S3 credentials provided in environment variables');
}
const bootS3Region = normalizeOptionalEnv(process.env.S3_REGION);
const bootS3Endpoint = normalizeOptionalEnv(process.env.S3_ENDPOINT);
const bootS3PublicUrl = normalizeOptionalEnv(process.env.S3_PUBLIC_URL);
if (bootS3Region?.toLowerCase() === 'auto' && !bootS3Endpoint) {
  console.error('❌ Invalid S3 configuration: S3_REGION=auto (Cloudflare R2) requires S3_ENDPOINT.');
  throw new Error(
    'Cloudflare R2 configurations with S3_REGION=auto must specify S3_ENDPOINT (for example, https://<ACCOUNT_ID>.r2.cloudflarestorage.com)'
  );
}
if (bootS3Endpoint && isCloudflareR2ApiEndpoint(bootS3Endpoint) && !bootS3PublicUrl) {
  console.error(
    '❌ Invalid S3 configuration: Private Cloudflare R2 API endpoints (*.r2.cloudflarestorage.com) require S3_PUBLIC_URL.'
  );
  throw new Error(
    'Cloudflare R2 private API endpoints (*.r2.cloudflarestorage.com) cannot serve public assets directly; configure S3_PUBLIC_URL'
  );
}

// Fail fast if incomplete or invalid Stripe card credentials are provided
const stripeCardKeys = ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] as const;
const presentStripeCardKeys = stripeCardKeys.filter(key => Boolean(normalizeOptionalEnv(process.env[key])));
if (presentStripeCardKeys.length > 0 && presentStripeCardKeys.length < stripeCardKeys.length) {
  const missingStripeKeys = stripeCardKeys.filter(key => !normalizeOptionalEnv(process.env[key]));
  console.error('❌ Incomplete Stripe credentials provided in environment variables:', missingStripeKeys.join(', '));
  throw new Error(`Incomplete Stripe credentials provided in environment variables: missing ${missingStripeKeys.join(', ')}`);
}
if (process.env.NODE_ENV !== 'test') {
  for (const key of stripeCardKeys) {
    const val = normalizeOptionalEnv(process.env[key]);
    if (val && isPlaceholderStripeKey(val)) {
      console.error(`❌ Security Error: ${key} must not use a placeholder mock key in non-test environments.`);
      throw new Error(`${key} must not use a placeholder mock key in non-test environments.`);
    }
  }
}

let _env: z.infer<typeof envSchema>;

if (process.env.NEXT_RUNTIME === 'edge' || isStaticExport || (isBuildTime && (!normalizeOptionalEnv(process.env.DATABASE_URL) || !normalizeOptionalEnv(process.env.ADMIN_PASSWORD) || !normalizeOptionalEnv(process.env.ALLOWED_HOSTS) || !normalizeOptionalEnv(process.env.GUEST_PASSCODE) || !normalizeOptionalEnv(process.env.GUEST_SESSION_SECRET)))) {
  // Use fallbacks for build tasks
  const fallbackDbUrl = normalizeOptionalEnv(process.env.DATABASE_URL);
  const fallbackShadowUrl = normalizeOptionalEnv(process.env.POSTGRES_URL_NON_POOLING);
  const fallbackMultisite = normalizeOptionalEnv(process.env.MULTISITE_ENABLED);
  const fallbackMigrations = normalizeOptionalEnv(process.env.RUN_MIGRATIONS);
  const fallbackHistoryLimit = normalizeOptionalEnv(process.env.HISTORY_VERSION_LIMIT);
  _env = {
    NODE_ENV: (normalizeOptionalEnv(process.env.NODE_ENV) as 'development' | 'test' | 'production') || 'development',
    DATABASE_URL: fallbackDbUrl && isValidPostgresUrl(fallbackDbUrl)
      ? normalizePostgresUrl(fallbackDbUrl)
      : (fallbackDbUrl || 'postgresql://dummy:dummy@localhost:5432/dummy'),
    POSTGRES_URL_NON_POOLING: fallbackShadowUrl && isValidPostgresUrl(fallbackShadowUrl)
      ? normalizePostgresUrl(fallbackShadowUrl)
      : (fallbackShadowUrl || 'postgresql://dummy:dummy@localhost:5432/dummy_shadow'),
    ADMIN_PASSWORD: normalizeOptionalEnv(process.env.ADMIN_PASSWORD) || BUILD_FALLBACK_ADMIN_PASSWORD,
    ALLOWED_HOSTS: normalizeOptionalEnv(process.env.ALLOWED_HOSTS) || 'localhost,127.0.0.1,*.localhost',
    MULTISITE_ENABLED: fallbackMultisite === 'true' || fallbackMultisite === '1',
    RUN_MIGRATIONS: fallbackMigrations === 'true' || fallbackMigrations === '1',
    TRUST_PROXY: parseTrustProxyValue(process.env.TRUST_PROXY),
    GUEST_PASSCODE: normalizeOptionalEnv(process.env.GUEST_PASSCODE) || 'wedding2026',
    GUEST_SESSION_SECRET: normalizeOptionalEnv(process.env.GUEST_SESSION_SECRET) || 'default-guest-session-secret',
    HISTORY_VERSION_LIMIT: fallbackHistoryLimit ? parseInt(fallbackHistoryLimit, 10) : 50,
    CRON_SECRET: normalizeOptionalEnv(process.env.CRON_SECRET),
    S3_BUCKET: normalizeOptionalEnv(process.env.S3_BUCKET),
    S3_REGION: normalizeOptionalEnv(process.env.S3_REGION),
    S3_ACCESS_KEY_ID: normalizeOptionalEnv(process.env.S3_ACCESS_KEY_ID),
    S3_SECRET_ACCESS_KEY: normalizeOptionalEnv(process.env.S3_SECRET_ACCESS_KEY),
    S3_ENDPOINT: normalizeOptionalEnv(process.env.S3_ENDPOINT),
    S3_PUBLIC_URL: normalizeOptionalEnv(process.env.S3_PUBLIC_URL),
    STRIPE_SECRET_KEY: normalizeOptionalEnv(process.env.STRIPE_SECRET_KEY),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: normalizeOptionalEnv(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    STRIPE_WEBHOOK_SECRET: normalizeOptionalEnv(process.env.STRIPE_WEBHOOK_SECRET),
  };
} else {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const errorDetails = JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2);
    console.error('❌ Invalid environment variables:', errorDetails);
    throw new Error(`Invalid environment variables: ${errorDetails}`);
  }
  _env = parsed.data;
}

export const env = new Proxy(_env, {
  get(target, prop) {
    if (typeof prop === 'string') {
      const rawVal = process.env[prop];
      if (prop === 'TRUST_PROXY') {
        return rawVal !== undefined && rawVal !== '' ? parseTrustProxyValue(rawVal) : target.TRUST_PROXY;
      }
      if (rawVal !== undefined && rawVal !== '') {
        const val = stripEnvQuotes(rawVal);
        if (val === '') {
          return target[prop as keyof typeof target];
        }
        if (prop === 'DATABASE_URL' || prop === 'POSTGRES_URL_NON_POOLING') {
          return isValidPostgresUrl(val) ? normalizePostgresUrl(val) : val;
        }
        if (prop === 'MULTISITE_ENABLED' || prop === 'RUN_MIGRATIONS') {
          return val === 'true' || val === '1';
        }
        if (prop === 'HISTORY_VERSION_LIMIT') {
          const num = parseInt(val, 10);
          return isNaN(num) ? target.HISTORY_VERSION_LIMIT : num;
        }
        return val;
      }
    }
    return target[prop as keyof typeof target];
  }
});
