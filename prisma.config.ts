import { defineConfig } from '@prisma/config';

const isSqlite = process.env.DATABASE_URL?.startsWith('file:') || process.env.DATABASE_URL?.startsWith('sqlite:') || process.env.DATABASE_URL?.includes('.db');

const getShadowUrl = () => {
  if (isSqlite) return undefined;
  return process.env.SHADOW_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
};

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Provide a fallback dummy URL for build environments where the actual DB is not needed (e.g., CI)
    // We use process.env directly instead of the `env()` helper because `env()` throws if the variable is missing.
    url: process.env.DATABASE_URL ?? 'postgresql://dummy:dummy@localhost:5432/dummy',
    // Provide a fallback for the shadow database URL as well
    shadowDatabaseUrl: getShadowUrl(),
  },
});
