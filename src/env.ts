import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').refine(val => {
    if (val.startsWith('file:') || val.startsWith('sqlite:') || val.includes('.db')) {
      return true;
    }
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'DATABASE_URL must be a valid URL or SQLite path',
  }),
  POSTGRES_URL_NON_POOLING: z.string().optional().refine(val => {
    if (!val) return true;
    if (val.startsWith('file:') || val.startsWith('sqlite:') || val.includes('.db')) {
      return true;
    }
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, {
    message: 'POSTGRES_URL_NON_POOLING must be a valid URL or SQLite path',
  }),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required').regex(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, 'ADMIN_PASSWORD must be in the format scrypt:[saltBase64]:[keyBase64]'),
  GUEST_PASSCODE: z.string().default('wedding2026'),
  HISTORY_VERSION_LIMIT: z.coerce.number().min(1).default(50),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
}).superRefine((data, ctx) => {
  const keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const presentKeys = keys.filter(key => !!data[key]);
  if (presentKeys.length > 0 && presentKeys.length < keys.length) {
    const missingKeys = keys.filter(key => !data[key]);
    missingKeys.forEach(key => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Incomplete S3 credentials: ${key} is required when other S3 variables are set`,
      });
    });
  }
});

// Conditionally skip validation during build (e.g., for Prisma generation without secrets)
// Some CI setups might use NEXT_PHASE or just npm_lifecycle_event.
const isBuildTime = process.env.npm_lifecycle_event === 'build' ||
                    process.env.npm_lifecycle_event === 'prisma:generate' ||
                    process.env.npm_lifecycle_event === 'db:seed' ||
                    process.env.NODE_ENV === 'test' ||
                    process.env.JEST_WORKER_ID !== undefined;

// Even during build, fail if incomplete S3 credentials are provided explicitly
const keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
const presentKeys = keys.filter(key => !!process.env[key]);
if (presentKeys.length > 0 && presentKeys.length < keys.length) {
  const missingKeys = keys.filter(key => !process.env[key]);
  console.error('❌ Incomplete S3 credentials provided in environment variables:', missingKeys.join(', '));
  throw new Error('Incomplete S3 credentials provided in environment variables');
}

let _env: z.infer<typeof envSchema>;

if (isBuildTime && (!process.env.DATABASE_URL || !process.env.ADMIN_PASSWORD)) {
  // Use fallbacks for build tasks
  _env = {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING || 'postgresql://dummy:dummy@localhost:5432/dummy_shadow',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==',
    GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'wedding2026',
    HISTORY_VERSION_LIMIT: process.env.HISTORY_VERSION_LIMIT ? parseInt(process.env.HISTORY_VERSION_LIMIT, 10) : 50,
    S3_BUCKET: process.env.S3_BUCKET || undefined,
    S3_REGION: process.env.S3_REGION || undefined,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || undefined,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || undefined,
    S3_ENDPOINT: process.env.S3_ENDPOINT || undefined,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL || undefined,
  };
} else {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    throw new Error('Invalid environment variables');
  }
  _env = parsed.data;
}

export const env = new Proxy(_env, {
  get(target, prop) {
    if (typeof prop === 'string' && process.env.JEST_WORKER_ID !== undefined) {
      return process.env[prop] ?? target[prop as keyof typeof target];
    }
    return target[prop as keyof typeof target];
  }
});
