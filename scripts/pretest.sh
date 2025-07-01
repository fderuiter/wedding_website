#!/bin/sh
# Ensure node modules installed before running build & tests
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi
npm run build
