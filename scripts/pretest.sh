#!/bin/sh
# Ensure node modules installed before running build & tests
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi

# Detect whether a full build is required based on the specific test suite being run
case "$npm_lifecycle_event" in
  *test*)
    echo "Unit test phase detected. Skipping full build, running prisma generate..."
    npm run prisma:generate
    ;;
  *)
    echo "Running full build..."
    npm run build
    ;;
esac

