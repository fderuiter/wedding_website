import { defineConfig } from '@prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Provide a fallback dummy URL for build environments where the actual DB is not needed (e.g., CI)
    // We use process.env directly instead of the `env()` helper because `env()` throws if the variable is missing.
    url: process.env.POSTGRES_PRISMA_URL ?? "postgresql://dummy:dummy@localhost:5432/dummy",
    // Provide a fallback for the shadow database URL as well
    shadowDatabaseUrl: process.env.POSTGRES_URL_NON_POOLING ?? "postgresql://dummy:dummy@localhost:5432/dummy_shadow",
  },
});
