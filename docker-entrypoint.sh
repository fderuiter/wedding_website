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

ENTRYPOINT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POSTGRES_URL_HELPER=""
for candidate in "$ENTRYPOINT_DIR/src/lib/postgres-url.js" "/app/src/lib/postgres-url.js" "./src/lib/postgres-url.js"; do
  if [ -f "$candidate" ]; then
    POSTGRES_URL_HELPER="$candidate"
    break
  fi
done

if ! NORMALIZED_DATABASE_URL="$(
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const raw = process.env.DATABASE_URL ?? "";
    const helperPath = process.argv[1] ?? "";
    if (helperPath) {
      const { normalizePostgresUrl } = await import(pathToFileURL(helperPath).href);
      process.stdout.write(normalizePostgresUrl(raw));
    } else {
      if (!/^(postgres|postgresql):\/\//.test(raw) || /[\x00-\x20\x7f#]/.test(raw)) {
        process.exit(1);
      }
      const afterScheme = raw.replace(/^(postgres|postgresql):\/\//, "");
      const qIdx = afterScheme.indexOf("?");
      const beforeQ = qIdx === -1 ? afterScheme : afterScheme.slice(0, qIdx);
      const query = qIdx === -1 ? "" : afterScheme.slice(qIdx + 1);
      const sIdx = beforeQ.indexOf("/");
      const authority = sIdx === -1 ? beforeQ : beforeQ.slice(0, sIdx);
      const pathPart = sIdx === -1 ? "" : beforeQ.slice(sIdx);
      const atIdx = authority.indexOf("@");
      if (atIdx !== authority.lastIndexOf("@")) process.exit(1);
      const userinfo = atIdx === -1 ? null : authority.slice(0, atIdx);
      const hostPort = atIdx === -1 ? authority : authority.slice(atIdx + 1);
      const host = hostPort.startsWith("[") ? hostPort : hostPort.split(":")[0];
      const params = new URLSearchParams(query);
      const qHost = params.get("host") ?? "";
      const validSocket = qHost.startsWith("/") && qHost.length > 1 && !/^\/+$/.test(qHost);
      let normalized = raw;
      if (!host) {
        if (!validSocket) process.exit(1);
        const scheme = raw.startsWith("postgresql://") ? "postgresql" : "postgres";
        const portSuffix = hostPort.includes(":") ? ":" + hostPort.split(":")[1] : "";
        normalized = `${scheme}://${userinfo !== null ? userinfo + "@" : ""}localhost${portSuffix}${pathPart}${qIdx === -1 ? "" : "?" + query}`;
      }
      const parsed = new URL(normalized);
      if (!parsed.hostname) process.exit(1);
      process.stdout.write(normalized);
    }
  ' "$POSTGRES_URL_HELPER" 2>/dev/null
)"; then
  echo "ERROR: Invalid format for DATABASE_URL. Must be a valid PostgreSQL URI with an explicit host or ?host=/... Unix socket path."
  exit 1
fi
export DATABASE_URL="$NORMALIZED_DATABASE_URL"

export NPM_CONFIG_UPDATE_NOTIFIER=false
export NO_UPDATE_NOTIFIER=1
export CHECKPOINT_DISABLE=1

if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "Running database migrations (RUN_MIGRATIONS=true)..."
  if [ -x "./node_modules/.bin/prisma" ]; then
    env -u POSTGRES_URL_NON_POOLING ./node_modules/.bin/prisma migrate deploy
  elif command -v prisma >/dev/null 2>&1; then
    env -u POSTGRES_URL_NON_POOLING prisma migrate deploy
  else
    echo "ERROR: Local Prisma CLI binary not found at ./node_modules/.bin/prisma."
    exit 1
  fi
else
  echo "Skipping automatic container database migration (decoupled to explicit CI/CD migration step)."
fi

if [[ "${1:-}" == *"prisma"* ]] && [ "${2:-}" = "migrate" ]; then
  unset POSTGRES_URL_NON_POOLING
fi

echo "Starting application..."
exec "$@"
