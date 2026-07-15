import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').min(1, 'DATABASE_URL is required'),
  POSTGRES_URL_NON_POOLING: z.string().url('POSTGRES_URL_NON_POOLING must be a valid URL').optional(),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required').regex(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, 'ADMIN_PASSWORD must be in the format scrypt:[saltBase64]:[keyBase64]'),
  HISTORY_VERSION_LIMIT: z.coerce.number().min(1).default(50),
});

// Conditionally skip validation during build (e.g., for Prisma generation without secrets)
// Some CI setups might use NEXT_PHASE or just npm_lifecycle_event.
const isBuildTime = process.env.npm_lifecycle_event === 'build' ||
                    process.env.npm_lifecycle_event === 'prisma:generate' ||
                    process.env.NODE_ENV === 'test' ||
                    process.env.JEST_WORKER_ID !== undefined;

let _env: z.infer<typeof envSchema>;

if (isBuildTime && (!process.env.DATABASE_URL || !process.env.ADMIN_PASSWORD)) {
  // Use fallbacks for build tasks
  _env = {
    NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING || 'postgresql://dummy:dummy@localhost:5432/dummy_shadow',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==',
    HISTORY_VERSION_LIMIT: process.env.HISTORY_VERSION_LIMIT ? parseInt(process.env.HISTORY_VERSION_LIMIT, 10) : 50,
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
