#!/usr/bin/env bash
# Zero-downtime VPS standby loopback rollout script
# Builds wedding-website:latest once via `app`, runs `migration`, warms
# `app-standby` on 127.0.0.1:${STANDBY_PORT:-3001}:3000, verifies `/api/live`,
# `/api/health`, and `/api/ready`, recreates `app` on 127.0.0.1:${PORT:-3000}:3000 while host
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
ROLLOUT_WAIT_SECONDS="${ROLLOUT_WAIT_SECONDS:-60}"
ROLLOUT_POLL_INTERVAL="${ROLLOUT_POLL_INTERVAL:-0.5}"
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
HAS_PREVIOUS_IMAGE=false
ROLLOUT_PHASE="pre-cutover"

retire_standby() {
  if [ "${STANDBY_ACTIVE}" = "true" ]; then
    echo "🧹 Stopping and removing standby container (app-standby)..."
    docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" stop app-standby >/dev/null 2>&1 || true
    docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" rm -f app-standby >/dev/null 2>&1 || true
    STANDBY_ACTIVE=false
  fi
}

restore_previous_image_tag() {
  if [ "${HAS_PREVIOUS_IMAGE}" = "true" ] && docker image inspect wedding-website:previous >/dev/null 2>&1; then
    echo "⏪ Restoring wedding-website:previous to wedding-website:latest..." >&2
    docker tag wedding-website:previous wedding-website:latest
    return $?
  fi
  return 1
}

print_manual_recovery_commands() {
  local base_args_display="${BASE_COMPOSE_ARGS[*]}"
  local rollout_args_display="${ROLLOUT_COMPOSE_ARGS[*]}"
  {
    echo "⚠️  Keeping healthy standby container (app-standby) running on 127.0.0.1:${STANDBY_PORT} to continue serving failover traffic."
    echo "🛠️  Manual recovery commands:"
    echo "   1. Inspect primary failure logs:"
    echo "      docker compose ${base_args_display} logs --tail=50 app"
    echo "   2. Restore primary 'app' onto a known-good image:"
    echo "      docker tag wedding-website:previous wedding-website:latest && docker compose ${base_args_display} up -d --no-deps --no-build --force-recreate app"
    echo "   3. Once primary 'app' passes http://127.0.0.1:${PORT}/api/live, /api/health, and /api/ready, retire 'app-standby':"
    echo "      docker compose ${rollout_args_display} stop app-standby && docker compose ${rollout_args_display} rm -f app-standby"
  } >&2
}

probe_http_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 -o /dev/null "${url}" 2>/dev/null
  else
    node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "${url}"
  fi
}

probe_health_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    local body=""
    body="$(curl -fsS --max-time 3 "${url}" 2>/dev/null)" || return 1
    if command -v jq >/dev/null 2>&1; then
      printf '%s' "${body}" | jq -e 'type == "object" and (if has("success") then (.success == true and (.data | type) == "object" and .data.status == "ok" and .data.database == "connected") else ((.status) == "ok" and (.database) == "connected") end)' >/dev/null 2>&1
    else
      printf '%s' "${body}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' &&
        printf '%s' "${body}" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"connected"' &&
        ! printf '%s' "${body}" | grep -Eq '"success"[[:space:]]*:[[:space:]]*false'
    fi
  else
    node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(async(r)=>{if(!r.ok)process.exit(1);const j=await r.json();const ok=j&&typeof j==='object'&&('success' in j?j.success===true&&j.data&&j.data.status==='ok'&&j.data.database==='connected':j.status==='ok'&&j.database==='connected');process.exit(ok?0:1);}).catch(()=>process.exit(1))" "${url}"
  fi
}

probe_ready_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    local body=""
    body="$(curl -fsS --max-time 3 "${url}" 2>/dev/null)" || return 1
    if command -v jq >/dev/null 2>&1; then
      printf '%s' "${body}" | jq -e 'type == "object" and (.status) == "ready" and (.database) == "connected"' >/dev/null 2>&1
    else
      printf '%s' "${body}" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' &&
        printf '%s' "${body}" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"connected"'
    fi
  else
    node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(async(r)=>{if(!r.ok)process.exit(1);const j=await r.json();process.exit(j&&j.status==='ready'&&j.database==='connected'?0:1);}).catch(()=>process.exit(1))" "${url}"
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
  local health_url="http://127.0.0.1:${target_port}/api/health"
  local ready_url="http://127.0.0.1:${target_port}/api/ready"
  local deadline=$((SECONDS + timeout_sec))

  echo "⏳ Waiting for ${label} on 127.0.0.1:${target_port}..."
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

    if probe_http_ok "${live_url}" &&
      probe_health_ok "${health_url}" &&
      probe_ready_ok "${ready_url}"; then
      echo "✅ ${label} passed /api/live, /api/health, and /api/ready probes on 127.0.0.1:${target_port}."
      return 0
    fi
    sleep "${ROLLOUT_POLL_INTERVAL}"
  done

  echo "❌ Timed out after ${timeout_sec}s waiting for ${label} probes (${live_url}, ${health_url}, ${ready_url})." >&2
  docker compose "${compose_args[@]}" logs --tail=50 "${service_name}" >&2 || true
  return 1
}

ACTIVE_SLEEP_PID=""

interruptible_sleep() {
  local duration="$1"
  sleep "${duration}" </dev/null >/dev/null 2>&1 &
  ACTIVE_SLEEP_PID=$!
  if wait "${ACTIVE_SLEEP_PID}" 2>/dev/null; then
    ACTIVE_SLEEP_PID=""
    return 0
  fi
  kill "${ACTIVE_SLEEP_PID}" 2>/dev/null || true
  wait "${ACTIVE_SLEEP_PID}" 2>/dev/null || true
  ACTIVE_SLEEP_PID=""
  return 1
}

on_exit() {
  local exit_code=$?
  trap - EXIT
  trap '' INT TERM
  set +e
  if [ -n "${ACTIVE_SLEEP_PID:-}" ]; then
    kill "${ACTIVE_SLEEP_PID}" 2>/dev/null || true
    wait "${ACTIVE_SLEEP_PID}" 2>/dev/null || true
    ACTIVE_SLEEP_PID=""
  fi

  if [ "${exit_code}" -eq 0 ]; then
    if [ "${STANDBY_ACTIVE}" = "true" ]; then
      retire_standby
    fi
    exit 0
  fi

  case "${ROLLOUT_PHASE}" in
    pre-cutover)
      if [ "${STANDBY_ACTIVE}" = "true" ]; then
        echo "⚠️  Rollout aborted before primary cutover; retiring standby slot and leaving primary 'app' running..." >&2
        retire_standby
      fi
      restore_previous_image_tag || true
      ;;
    cutover)
      echo "🚨 Primary cutover failed while standby slot 'app-standby' is serving traffic on 127.0.0.1:${STANDBY_PORT}." >&2
      if [ "${HAS_PREVIOUS_IMAGE}" = "true" ] && docker image inspect wedding-website:previous >/dev/null 2>&1; then
        echo "🔄 Attempting automatic primary rollback onto wedding-website:previous before retiring standby..." >&2
        if docker tag wedding-website:previous wedding-website:latest &&
          docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" up -d --no-deps --no-build --force-recreate app &&
          wait_for_service_probes "rolled-back primary service (app)" "app" "${PORT}" "${ROLLOUT_WAIT_SECONDS}" "${ROLLOUT_COMPOSE_ARGS[@]}"; then
          if [ "${STANDBY_DRAIN_SECONDS}" -gt 0 ] 2>/dev/null; then
            echo "⏳ Waiting ${STANDBY_DRAIN_SECONDS}s for reverse proxy failback to rolled-back primary 127.0.0.1:${PORT}..." >&2
            sleep "${STANDBY_DRAIN_SECONDS}"
          fi
          retire_standby
          echo "✅ Automatic primary rollback to wedding-website:previous succeeded on 127.0.0.1:${PORT}; 'app-standby' retired." >&2
        else
          echo "❌ Automatic primary rollback onto wedding-website:previous failed." >&2
          print_manual_recovery_commands
        fi
      else
        echo "⚠️  Rollback tag wedding-website:previous is unavailable; skipping automatic primary rollback." >&2
        print_manual_recovery_commands
      fi
      ;;
    completed)
      if [ "${STANDBY_ACTIVE}" = "true" ]; then
        retire_standby
      fi
      ;;
  esac

  exit "${exit_code}"
}
trap 'exit 130' INT
trap 'exit 143' TERM
trap on_exit EXIT

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

# 2. Snapshot rollback tag and build wedding-website:latest once via sole build owner `app`
if [ "${SKIP_IMAGE_BUILD:-false}" != "true" ]; then
  if docker image inspect wedding-website:latest >/dev/null 2>&1; then
    echo "🏷️  Tagging existing wedding-website:latest as wedding-website:previous for rollback..."
    docker tag wedding-website:latest wedding-website:previous
    HAS_PREVIOUS_IMAGE=true
  fi
  echo "🔨 Building wedding-website:latest once via service 'app'..."
  docker compose "${BASE_COMPOSE_ARGS[@]}" build app
else
  echo "⏭️  Skipping image build (SKIP_IMAGE_BUILD=true)."
  if docker image inspect wedding-website:previous >/dev/null 2>&1; then
    HAS_PREVIOUS_IMAGE=true
  fi
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
ROLLOUT_PHASE="cutover"
echo "🔄 Updating primary service 'app' on 127.0.0.1:${PORT}:3000..."
docker compose "${ROLLOUT_COMPOSE_ARGS[@]}" up -d --no-deps --no-build --force-recreate app

# 7. Verify primary `app` liveness and readiness before retiring standby
wait_for_service_probes "primary service (app)" "app" "${PORT}" "${ROLLOUT_WAIT_SECONDS}" "${ROLLOUT_COMPOSE_ARGS[@]}"
ROLLOUT_PHASE="completed"

# Allow host reverse proxy fail_timeout / fail_duration window to expire and
# drain active connections back to primary `127.0.0.1:${PORT}` before stopping standby
if [ "${STANDBY_DRAIN_SECONDS}" -gt 0 ] 2>/dev/null; then
  echo "⏳ Waiting ${STANDBY_DRAIN_SECONDS}s for reverse proxy failback to primary 127.0.0.1:${PORT}..."
  interruptible_sleep "${STANDBY_DRAIN_SECONDS}"
fi

# 8. Stop and remove standby slot
retire_standby

echo "🎉 Zero-downtime rollout complete! Primary 'app' is serving on 127.0.0.1:${PORT} and 'app-standby' has been retired."
