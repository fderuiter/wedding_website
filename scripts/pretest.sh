#!/bin/sh
# Ensure node modules installed before running build & tests
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi
# We don't necessarily need to run build before every test run if we are just running jest unit tests,
# but if the user wants it, we'll keep it.
# Actually, the CI workflow runs pnpm run build explicitly.
# Local development might want it though.
# Fixed the npm run build to pnpm run build
# Also need to provide dummy env vars if build is required
POSTGRES_PRISMA_URL="postgresql://user:pass@localhost:5432/db" POSTGRES_URL_NON_POOLING="postgresql://user:pass@localhost:5432/db" ADMIN_PASSWORD="test" pnpm run build
