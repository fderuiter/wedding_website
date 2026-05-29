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

echo "Starting application..."
exec "$@"
