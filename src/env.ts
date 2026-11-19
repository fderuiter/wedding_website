import { z } from 'zod';

const PLACEHOLDER_STRIPE_KEYS = new Set([
  'sk_test_placeholder_mock_key',
  'pk_test_placeholder_mock_key',
]);

function normalizeOptionalEnv(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').refine(val => {
    try {
      new URL(val);
      return val.startsWith('postgres://') || val.startsWith('postgresql://');
    } catch {
      return false;
    }
  }, {
    message: 'DATABASE_URL must be a valid PostgreSQL URL',
  }),
  POSTGRES_URL_NON_POOLING: z.string().optional().refine(val => {
    if (!val) return true;
    try {
      new URL(val);
      return val.startsWith('postgres://') || val.startsWith('postgresql://');
    } catch {
      return false;
    }
  }, {
    message: 'POSTGRES_URL_NON_POOLING must be a valid PostgreSQL URL',
  }),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required').regex(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, 'ADMIN_PASSWORD must be in the format scrypt:[saltBase64]:[keyBase64]'),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,*.localhost').refine(val => {
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
    .transform(val => val === true || val === 'true' || val === '1')
    .default(false),
  RUN_MIGRATIONS: z.union([z.boolean(), z.string()])
    .transform(val => val === true || val === 'true' || val === '1')
    .default(false),
  GUEST_PASSCODE: z.string().default('wedding2026'),
  GUEST_SESSION_SECRET: z.string().default('default-guest-session-secret'),
  HISTORY_VERSION_LIMIT: z.coerce.number().min(1).default(50),
  CRON_SECRET: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    const trimmedPasscode = data.GUEST_PASSCODE?.trim();
    if (!trimmedPasscode || trimmedPasscode === 'wedding2026') {
      ctx.addIssue({
        code: 'custom',
        path: ['GUEST_PASSCODE'],
        message: 'GUEST_PASSCODE is required and must not use the default fallback in production',
      });
    }
    if (!data.GUEST_SESSION_SECRET || data.GUEST_SESSION_SECRET === 'default-guest-session-secret') {
      ctx.addIssue({
        code: 'custom',
        path: ['GUEST_SESSION_SECRET'],
        message: 'GUEST_SESSION_SECRET is required and must not use the default fallback in production',
      });
    } else if (data.GUEST_SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['GUEST_SESSION_SECRET'],
        message: 'GUEST_SESSION_SECRET must be at least 32 characters long in production',
      });
    }
  }
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
    } else if (data.NODE_ENV !== 'test' && PLACEHOLDER_STRIPE_KEYS.has(stripeSecretKey)) {
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
    } else if (data.NODE_ENV !== 'test' && PLACEHOLDER_STRIPE_KEYS.has(stripePublishableKey)) {
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

// Conditionally skip validation during build (e.g., for Prisma generation without secrets)
// Some CI setups might use NEXT_PHASE or just npm_lifecycle_event.
const isEdge = process.env.NEXT_RUNTIME === 'edge';
const procArgv = (!isEdge && typeof process !== 'undefined' && Array.isArray(process['argv'])) ? process['argv'] : [];
const isScriptRun = procArgv.some((arg: unknown) => typeof arg === 'string' && (
  arg.includes('seed') ||
  arg.includes('generate-') ||
  arg.includes('check-') ||
  arg.includes('verify-')
));

const isStaticExport = process.env.STATIC_EXPORT === 'true' ||
                       process.env.STATIC_EXPORT === '1' ||
                       process.env.npm_lifecycle_event === 'build:export';

const isBuildTime = isEdge ||
                    isStaticExport ||
                    process.env.npm_lifecycle_event === 'build' ||
                    process.env.npm_lifecycle_event === 'build:export' ||
                    process.env.npm_lifecycle_event === 'prebuild' ||
                    process.env.npm_lifecycle_event === 'prisma:generate' ||
                    process.env.npm_lifecycle_event === 'db:seed' ||
                    isScriptRun ||
                    process.env.NODE_ENV === 'test' ||
                    process.env.JEST_WORKER_ID !== undefined;

// In production runtime, strictly require valid environment variables
if (process.env.NODE_ENV === 'production' && !isBuildTime && process.env.NEXT_RUNTIME !== 'edge') {
  if (!process.env.ADMIN_PASSWORD) {
    console.error('❌ Security Error: ADMIN_PASSWORD environment variable is missing in production environment.');
    throw new Error('ADMIN_PASSWORD environment variable is required in production.');
  }
  if (!process.env.GUEST_SESSION_SECRET) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET environment variable is missing in production environment.');
    throw new Error('GUEST_SESSION_SECRET environment variable is required in production.');
  }
  if (process.env.GUEST_SESSION_SECRET === 'default-guest-session-secret') {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must not use the default fallback secret in production.');
    throw new Error('GUEST_SESSION_SECRET must not use the default fallback secret in production.');
  }
  if (process.env.GUEST_SESSION_SECRET.length < 32) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must be at least 32 characters long in production.');
    throw new Error('GUEST_SESSION_SECRET must be at least 32 characters long in production.');
  }
  const trimmedGuestPasscode = process.env.GUEST_PASSCODE?.trim();
  if (!trimmedGuestPasscode) {
    console.error('❌ Security Error: GUEST_PASSCODE environment variable is missing in production environment.');
    throw new Error('GUEST_PASSCODE environment variable is required in production.');
  }
  if (trimmedGuestPasscode === 'wedding2026') {
    console.error('❌ Security Error: GUEST_PASSCODE must not use the default fallback passcode in production.');
    throw new Error('GUEST_PASSCODE must not use the default fallback passcode in production.');
  }
  if (process.env.GUEST_SESSION_SECRET === process.env.GUEST_PASSCODE || process.env.GUEST_SESSION_SECRET === trimmedGuestPasscode) {
    console.error('❌ Security Error: GUEST_SESSION_SECRET must not match GUEST_PASSCODE.');
    throw new Error('GUEST_SESSION_SECRET must not match GUEST_PASSCODE.');
  }
}

// Even during build, fail if incomplete S3 credentials are provided explicitly
const keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
const presentKeys = keys.filter(key => !!process.env[key]);
if (presentKeys.length > 0 && presentKeys.length < keys.length) {
  const missingKeys = keys.filter(key => !process.env[key]);
  console.error('❌ Incomplete S3 credentials provided in environment variables:', missingKeys.join(', '));
  throw new Error('Incomplete S3 credentials provided in environment variables');
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
    if (val && PLACEHOLDER_STRIPE_KEYS.has(val)) {
      console.error(`❌ Security Error: ${key} must not use a placeholder mock key in non-test environments.`);
      throw new Error(`${key} must not use a placeholder mock key in non-test environments.`);
    }
  }
}

let _env: z.infer<typeof envSchema>;

if (process.env.NEXT_RUNTIME === 'edge' || isStaticExport || (isBuildTime && (!process.env.DATABASE_URL || !process.env.ADMIN_PASSWORD || !process.env.ALLOWED_HOSTS || !process.env.GUEST_PASSCODE || !process.env.GUEST_SESSION_SECRET))) {
  // Use fallbacks for build tasks
  _env = {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING || 'postgresql://dummy:dummy@localhost:5432/dummy_shadow',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==',
    ALLOWED_HOSTS: process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1,*.localhost',
    MULTISITE_ENABLED: process.env.MULTISITE_ENABLED === 'true' || process.env.MULTISITE_ENABLED === '1',
    RUN_MIGRATIONS: process.env.RUN_MIGRATIONS === 'true' || process.env.RUN_MIGRATIONS === '1',
    GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'wedding2026',
    GUEST_SESSION_SECRET: process.env.GUEST_SESSION_SECRET || 'default-guest-session-secret',
    HISTORY_VERSION_LIMIT: process.env.HISTORY_VERSION_LIMIT ? parseInt(process.env.HISTORY_VERSION_LIMIT, 10) : 50,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    S3_BUCKET: process.env.S3_BUCKET || undefined,
    S3_REGION: process.env.S3_REGION || undefined,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || undefined,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || undefined,
    S3_ENDPOINT: process.env.S3_ENDPOINT || undefined,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL || undefined,
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
      const val = process.env[prop];
      if (val !== undefined && val !== '') {
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
