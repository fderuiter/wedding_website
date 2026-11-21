#!/bin/bash
set -e

# The GitHub action checks for secrets during deployment,
# but we also fail gracefully here in case the image is run manually.
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: Missing mandatory configuration secret: DATABASE_URL."
  exit 1
fi

if [[ ! "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
  echo "ERROR: Invalid format for DATABASE_URL. Must start with postgres:// or postgresql://"
  exit 1
fi

export NPM_CONFIG_UPDATE_NOTIFIER=false
export NO_UPDATE_NOTIFIER=1
export CHECKPOINT_DISABLE=1

if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "Running database migrations (RUN_MIGRATIONS=true)..."
  if [ -x "./node_modules/.bin/prisma" ]; then
    ./node_modules/.bin/prisma migrate deploy
  elif command -v prisma >/dev/null 2>&1; then
    prisma migrate deploy
  else
    echo "ERROR: Local Prisma CLI binary not found at ./node_modules/.bin/prisma."
    exit 1
  fi
else
  echo "Skipping automatic container database migration (decoupled to explicit CI/CD migration step)."
fi
echo "Starting application..."
exec "$@"
