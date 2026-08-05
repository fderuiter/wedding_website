import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// Strict Test Environment Isolation: Ignore parent shell environment variables during test phase
if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
  const rootDir = process.cwd();
  const envPath = path.join(rootDir, '.env.test');
  const envTest = {};
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let val = match[2].trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          envTest[key] = val;
        }
      }
    } catch {
      // Ignore reading errors
    }
  }

  // Clear parent shell database variables
  const pgVars = ['DATABASE_URL', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGDATASOURCE'];
  for (const v of pgVars) {
    delete process.env[v];
  }

  // Determine the isolated test database URL from dedicated test settings, or use safe fallback
  const testDbUrl = envTest.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
  process.env.DATABASE_URL = testDbUrl;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').min(1, 'DATABASE_URL is required'),
  POSTGRES_URL_NON_POOLING: z.string().url('POSTGRES_URL_NON_POOLING must be a valid URL').optional(),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required').regex(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, 'ADMIN_PASSWORD must be in the format scrypt:[saltBase64]:[keyBase64]'),
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
