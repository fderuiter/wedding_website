import { defineConfig } from '@prisma/config';
import { normalizePostgresUrl } from './src/lib/postgres-url.js';

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = normalizePostgresUrl(process.env.DATABASE_URL);
}
if (process.env.POSTGRES_URL_NON_POOLING) {
  process.env.POSTGRES_URL_NON_POOLING = normalizePostgresUrl(process.env.POSTGRES_URL_NON_POOLING);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Provide a fallback dummy URL for build environments where the actual DB is not needed (e.g., CI)
    // We use process.env directly instead of the `env()` helper because `env()` throws if the variable is missing.
    url: process.env.DATABASE_URL ?? 'postgresql://dummy:dummy@localhost:5432/dummy',
    // Only bind shadowDatabaseUrl when POSTGRES_URL_NON_POOLING is explicitly configured
    shadowDatabaseUrl: process.env.POSTGRES_URL_NON_POOLING || undefined,
  },
});
