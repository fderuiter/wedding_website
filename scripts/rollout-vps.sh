#!/usr/bin/env bash
# Zero-downtime VPS standby loopback rollout script
# Builds wedding-website:latest once via `app`, runs `migration`, warms
# `app-standby` on 127.0.0.1:${STANDBY_PORT:-3001}:3000, verifies `/api/live`
# and `/api/ready`, recreates `app` on 127.0.0.1:${PORT:-3000}:3000 while host
# reverse proxies fail over seamlessly, verifies `app` readiness, and retires
# `app-standby`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

read_dotenv_value() {
  local key="$1"
  local env_file="${REPO_ROOT}/.env"
  if [ ! -f "${env_file}" ]; then
    return 0
  fi

  local line=""
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "${env_file}" | tail -n 1 || true)"
  if [ -z "${line}" ]; then
    return 0
  fi

  local val="${line#*=}"
  # Trim leading whitespace
  val="${val#"${val%%[![:space:]]*}"}"

  if [[ "${val}" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]]; then
    val="${BASH_REMATCH[1]}"
  elif [[ "${val}" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
    val="${BASH_REMATCH[1]}"
  else
    # Strip trailing unquoted inline comment and trailing whitespace
    val="${val%%[[:space:]]#*}"
    val="${val%"${val##*[![:space:]]}"}"
  fi

  # Unescape Docker Compose literal $$ sequences
  printf '%s' "${val//\$\$/\$}"
}

resolve_setting() {
  local var_name="$1"
  local default_val="$2"
  local current_val="${!var_name-}"
  if [ -n "${current_val}" ]; then
    printf '%s' "${current_val}"
    return 0
  fi
  local dotenv_val=""
  dotenv_val="$(read_dotenv_value "${var_name}")"
  if [ -n "${dotenv_val}" ]; then
    printf '%s' "${dotenv_val}"
    return 0
  fi
  printf '%s' "${default_val}"
}

PORT="$(resolve_setting PORT 3000)"
STANDBY_PORT="$(resolve_setting STANDBY_PORT 3001)"
ALLOWED_HOSTS_RESOLVED="$(resolve_setting ALLOWED_HOSTS 'localhost,127.0.0.1,*.localhost')"
ROLLOUT_WAIT_SECONDS="${ROLLOUT_WAIT_SECONDS:-60}"
DB_WAIT_SECONDS="${DB_WAIT_SECONDS:-60}"
STANDBY_DRAIN_SECONDS="${STANDBY_DRAIN_SECONDS:-6}"

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || ! [[ "${STANDBY_PORT}" =~ ^[0-9]+$ ]]; then
  echo "❌ PORT (${PORT}) and STANDBY_PORT (${STANDBY_PORT}) must be numeric TCP port numbers." >&2
  exit 1
fi

if [ "${PORT}" = "${STANDBY_PORT}" ]; then
  echo "❌ STANDBY_PORT (${STANDBY_PORT}) must differ from primary PORT (${PORT})." >&2
  exit 1
fi

resolve_probe_host() {
  local raw_hosts="$1"
  local IFS=','
  read -ra entries <<< "${raw_hosts}"
  for entry in "${entries[@]}"; do
    local trimmed="${entry#"${entry%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    trimmed="${trimmed#\*.}"
    if [ -n "${trimmed}" ]; then
      printf '%s' "${trimmed}"
      return 0
    fi
  done
  printf 'localhost'
}

PROBE_HOST="$(resolve_probe_host "${ALLOWED_HOSTS_RESOLVED}")"

BASE_COMPOSE_ARGS=(-f docker-compose.yml)
if [ -n "${COMPOSE_EXTRA_FILES:-}" ]; then
  IFS=':' read -ra extra_files <<< "${COMPOSE_EXTRA_FILES}"
  for extra_file in "${extra_files[@]}"; do
    if [ -n "${extra_file}" ]; then
      BASE_COMPOSE_ARGS+=(-f "${extra_file}")
    fi
  done
fi
ROLLOUT_COMPOSE_ARGS=("${BASE_COMPOSE_ARGS[@]}" -f docker-compose.rollout.yml)

STANDBY_ACTIVE=false

retire_standby() {
  if [ "${STANDBY_ACTIVE}" = "true" ]; then
    echo "🧹 Stopping and removing standby container (app-standby)..."
    docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" stop app-standby >/dev/null 2>&1 || true
    docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" rm -f app-standby >/dev/null 2>&1 || true
    STANDBY_ACTIVE=false
  fi
}

on_exit() {
  local exit_code=$?
  if [ "${STANDBY_ACTIVE}" = "true" ]; then
    retire_standby
  fi
  exit "${exit_code}"
}
trap on_exit EXIT INT TERM

probe_http_ok() {
  local url="$1"
  local host_header="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 -H "Host: ${host_header}" -o /dev/null "${url}" 2>/dev/null
  else
    node -e "fetch(process.argv[1],{headers:{Host:process.argv[2]},signal:AbortSignal.timeout(3000)}).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "${url}" "${host_header}"
  fi
}

wait_for_service_probes() {
  local label="$1"
  local service_name="$2"
  local target_port="$3"
  local timeout_sec="$4"
  shift 4
  local compose_args=("$@")

  local live_url="http://127.0.0.1:${target_port}/api/live"
  local ready_url="http://127.0.0.1:${target_port}/api/ready"
  local deadline=$((SECONDS + timeout_sec))

  echo "⏳ Waiting for ${label} on 127.0.0.1:${target_port} (Host: ${PROBE_HOST})..."
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    local cid=""
    cid="$(docker compose "${compose_args[@]}" ps -q "${service_name}" 2>/dev/null || true)"
    if [ -n "${cid}" ]; then
      local state=""
      state="$(docker inspect -f '{{.State.Status}}' "${cid}" 2>/dev/null || true)"
      if [ "${state}" = "exited" ] || [ "${state}" = "dead" ]; then
        echo "❌ ${label} (${service_name}) exited unexpectedly during startup:" >&2
        docker compose "${compose_args[@]}" logs --tail=50 "${service_name}" >&2 || true
        return 1
      fi
    fi

    if probe_http_ok "${live_url}" "${PROBE_HOST}" && probe_http_ok "${ready_url}" "${PROBE_HOST}"; then
      echo "✅ ${label} passed /api/live and /api/ready probes on 127.0.0.1:${target_port}."
      return 0
    fi
    sleep 0.5
  done

  echo "❌ Timed out after ${timeout_sec}s waiting for ${label} probes (${live_url}, ${ready_url})." >&2
  docker compose "${compose_args[@]}" logs --tail=50 "${service_name}" >&2 || true
  return 1
}

wait_for_db_healthy() {
  local deadline=$((SECONDS + DB_WAIT_SECONDS))
  echo "🗄️  Ensuring PostgreSQL service (db) is running and healthy..."
  docker compose "${BASE_COMPOSE_ARGS[@]}" up -d db

  while [ "${SECONDS}" -lt "${deadline}" ]; do
    local db_cid=""
    db_cid="$(docker compose "${BASE_COMPOSE_ARGS[@]}" ps -q db 2>/dev/null || true)"
    if [ -n "${db_cid}" ]; then
      local health=""
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${db_cid}" 2>/dev/null || true)"
      if [ "${health}" = "healthy" ]; then
        echo "✅ PostgreSQL service (db) is healthy."
        return 0
      fi
    fi
    sleep 1
  done

  echo "❌ Timed out after ${DB_WAIT_SECONDS}s waiting for db to report healthy." >&2
  docker compose "${BASE_COMPOSE_ARGS[@]}" logs --tail=50 db >&2 || true
  return 1
}

echo "🚀 Starting zero-downtime standby loopback rollout (primary=127.0.0.1:${PORT}, standby=127.0.0.1:${STANDBY_PORT})..."

# 1. Ensure PostgreSQL is running and healthy
wait_for_db_healthy

# 2. Build wedding-website:latest once via sole build owner `app`
if [ "${SKIP_IMAGE_BUILD:-false}" != "true" ]; then
  echo "🔨 Building wedding-website:latest once via service 'app'..."
  docker compose "${BASE_COMPOSE_ARGS[@]}" build app
else
  echo "⏭️  Skipping image build (SKIP_IMAGE_BUILD=true)."
fi

# 3. Apply pending Prisma schema migrations offline before starting updated containers
echo "📦 Running database migrations via service 'migration'..."
docker compose "${BASE_COMPOSE_ARGS[@]}" run --rm migration

# 4. Boot and warm standby container on 127.0.0.1:${STANDBY_PORT}:3000
echo "🟢 Starting standby slot 'app-standby' on 127.0.0.1:${STANDBY_PORT}:3000..."
STANDBY_ACTIVE=true
docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" up -d --no-deps --no-build --force-recreate app-standby

# 5. Verify standby liveness and readiness before touching primary `app`
wait_for_service_probes "standby slot (app-standby)" "app-standby" "${STANDBY_PORT}" "${ROLLOUT_WAIT_SECONDS}" "${ROLLOUT_COMPOSE_ARGS[@]}"

# 6. Recreate primary `app` container while reverse proxy fails over to standby
echo "🔄 Updating primary service 'app' on 127.0.0.1:${PORT}:3000..."
docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" up -d --no-deps --no-build --force-recreate app

# 7. Verify primary `app` liveness and readiness before retiring standby
wait_for_service_probes "primary service (app)" "app" "${PORT}" "${ROLLOUT_WAIT_SECONDS}" "${ROLLOUT_COMPOSE_ARGS[@]}"

# Allow host reverse proxy fail_timeout / fail_duration window to expire and
# drain active connections back to primary `127.0.0.1:${PORT}` before stopping standby
if [ "${STANDBY_DRAIN_SECONDS}" -gt 0 ] 2>/dev/null; then
  echo "⏳ Waiting ${STANDBY_DRAIN_SECONDS}s for reverse proxy failback to primary 127.0.0.1:${PORT}..."
  sleep "${STANDBY_DRAIN_SECONDS}"
fi

# 8. Stop and remove standby slot
retire_standby

echo "🎉 Zero-downtime rollout complete! Primary 'app' is serving on 127.0.0.1:${PORT} and 'app-standby' has been retired."
