import { z } from 'zod';

const isBuildOrTest = process.env.npm_lifecycle_event === 'build' || process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_script?.includes('build');

const envSchema = z.object({
  POSTGRES_PRISMA_URL: z.string().url("POSTGRES_PRISMA_URL must be a valid URL"),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.format());
  if (!isBuildOrTest) {
    throw new Error("Invalid environment variables");
  } else {
    console.warn("⚠️ Bypassing environment validation crash because we are in build or test mode.");
  }
}

export const env = parsed.success ? parsed.data : {
  POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL || 'postgres://test:test@localhost:5432/test',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
} as any;
