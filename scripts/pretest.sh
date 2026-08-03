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

    # Start database container if docker is available and docker daemon is running
    if command -v docker >/dev/null 2>&1; then
      if docker info >/dev/null 2>&1; then
        echo "Ensuring local PostgreSQL database container is running..."
        docker compose up -d db

        echo "Waiting for database to be ready..."
        for i in $(seq 1 15); do
          if docker compose exec db pg_isready -U wedding >/dev/null 2>&1; then
            echo "Database is ready."
            break
          fi
          sleep 1
        done
      else
        echo "Docker daemon not running. Skipping database container auto-start."
      fi
    else
      echo "Docker command not found. Skipping database container auto-start."
    fi

    # Synchronize schema to isolated test database
    export DATABASE_URL="${DATABASE_URL:-postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public}"
    echo "Synchronizing schema to isolated test database: $DATABASE_URL"
    npx prisma db push --accept-data-loss
    ;;
  *)
    echo "Running full build..."
    npm run build
    ;;
esac

