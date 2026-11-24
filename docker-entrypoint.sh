#!/bin/bash
set -e

export NPM_CONFIG_UPDATE_NOTIFIER=false
export NO_UPDATE_NOTIFIER=1
export CHECKPOINT_DISABLE=1

# Allow standalone password-hash utility invocations inside Docker without DATABASE_URL
if { [ "${1:-}" = "node" ] && [[ "${2:-}" == *generate-password-hash.mjs ]]; } || [[ "${1:-}" == *generate-password-hash.mjs ]]; then
  exec "$@"
fi

# Strip matching outer quotes injected by `docker run --env-file`
strip_outer_quotes() {
  local val="$1"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  if [ "${#val}" -ge 2 ]; then
    if [[ "$val" == \"*\" && "$val" == *\" ]]; then
      val="${val:1:${#val}-2}"
    elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
      val="${val:1:${#val}-2}"
    fi
  fi
  printf '%s' "$val"
}

if [ -n "${DATABASE_URL+x}" ]; then
  DATABASE_URL="$(strip_outer_quotes "$DATABASE_URL")"
  export DATABASE_URL
fi
if [ -n "${POSTGRES_URL_NON_POOLING+x}" ]; then
  POSTGRES_URL_NON_POOLING="$(strip_outer_quotes "$POSTGRES_URL_NON_POOLING")"
  if [ -z "$POSTGRES_URL_NON_POOLING" ]; then
    unset POSTGRES_URL_NON_POOLING
  else
    export POSTGRES_URL_NON_POOLING
  fi
fi

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

normalize_pg_url_env() {
  local env_name="$1"
  PG_URL_ENV_NAME="$env_name" node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const envName = process.env.PG_URL_ENV_NAME ?? "DATABASE_URL";
    const raw = process.env[envName] ?? "";
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
}

if ! NORMALIZED_DATABASE_URL="$(normalize_pg_url_env DATABASE_URL)"; then
  echo "ERROR: Invalid format for DATABASE_URL. Must be a valid PostgreSQL URI with an explicit host or ?host=/... Unix socket path."
  exit 1
fi
export DATABASE_URL="$NORMALIZED_DATABASE_URL"

if [ -n "${POSTGRES_URL_NON_POOLING:-}" ]; then
  if [[ ! "$POSTGRES_URL_NON_POOLING" =~ ^postgres(ql)?:// ]]; then
    echo "ERROR: Invalid format for POSTGRES_URL_NON_POOLING. Must start with postgres:// or postgresql://"
    exit 1
  fi
  if ! NORMALIZED_NON_POOLING_URL="$(normalize_pg_url_env POSTGRES_URL_NON_POOLING)"; then
    echo "ERROR: Invalid format for POSTGRES_URL_NON_POOLING. Must be a valid PostgreSQL URI with an explicit host or ?host=/... Unix socket path."
    exit 1
  fi
  export POSTGRES_URL_NON_POOLING="$NORMALIZED_NON_POOLING_URL"
fi

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
