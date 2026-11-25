#!/usr/bin/env bash
set -euo pipefail

DOCKERFILE_PATH="${DOCKERFILE_PATH:-Dockerfile}"
TARGET_PLATFORM="${TARGET_PLATFORM:?Missing TARGET_PLATFORM}"
MOUNT_CACHE_DIR="${MOUNT_CACHE_DIR:?Missing MOUNT_CACHE_DIR}"
DEPS_CACHE_HIT="${DEPS_CACHE_HIT:-false}"
NEXT_CACHE_HIT="${NEXT_CACHE_HIT:-false}"

BASE_IMAGE=$(awk '/^FROM / {print $2; exit}' "$DOCKERFILE_PATH")
if [ -z "$BASE_IMAGE" ]; then
  echo "::error::Unable to resolve base image from '${DOCKERFILE_PATH}'."
  exit 1
fi

EXPORT_DEPS="false"
EXPORT_NEXT="false"
if [ "$DEPS_CACHE_HIT" != "true" ]; then EXPORT_DEPS="true"; fi
if [ "$NEXT_CACHE_HIT" != "true" ]; then EXPORT_NEXT="true"; fi

if [ "$EXPORT_DEPS" != "true" ] && [ "$EXPORT_NEXT" != "true" ]; then
  exit 0
fi

EMPTY_DIR=$(mktemp -d)
OUT_DIR=$(mktemp -d)
trap 'rm -rf "$EMPTY_DIR" "$OUT_DIR"' EXIT

printf '%s\n' \
  '# syntax=docker/dockerfile:1' \
  "FROM ${BASE_IMAGE} AS exporter" \
  'ARG CACHEBUST=1' \
  'ARG EXPORT_DEPS=false' \
  'ARG EXPORT_NEXT=false' \
  'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \' \
  '    --mount=type=cache,target=/var/lib/apt,sharing=locked \' \
  '    --mount=type=cache,target=/root/.npm,sharing=locked \' \
  '    --mount=type=cache,target=/app/.next/cache,sharing=locked \' \
  '    echo "$CACHEBUST" >/dev/null && \' \
  '    mkdir -p /out /var/cache/apt /var/lib/apt /root/.npm /app/.next/cache && \' \
  '    if [ "$EXPORT_DEPS" = "true" ] && [ -n "$(find /var/cache/apt /var/lib/apt /root/.npm -type f -print -quit 2>/dev/null)" ]; then mkdir -p /out/deps && tar -cf /out/deps/mounts.tar -C / var/cache/apt var/lib/apt root/.npm; fi && \' \
  '    if [ "$EXPORT_NEXT" = "true" ] && [ -n "$(find /app/.next/cache -type f -print -quit 2>/dev/null)" ]; then mkdir -p /out/next && tar -cf /out/next/mounts.tar -C / app/.next/cache; fi' \
  'FROM scratch' \
  'COPY --from=exporter /out /' \
  | docker buildx build \
    --platform "$TARGET_PLATFORM" \
    --build-arg "CACHEBUST=$(date +%s%N)" \
    --build-arg "EXPORT_DEPS=${EXPORT_DEPS}" \
    --build-arg "EXPORT_NEXT=${EXPORT_NEXT}" \
    --output "type=local,dest=${OUT_DIR}" \
    -f - "$EMPTY_DIR"

archive_has_regular_entries() {
  local archive="$1"
  [ -s "$archive" ] && tar -tf "$archive" | awk '!/\/$/ { found=1 } END { exit !found }'
}

if archive_has_regular_entries "$OUT_DIR/deps/mounts.tar"; then
  mkdir -p "$MOUNT_CACHE_DIR/deps"
  mv -f "$OUT_DIR/deps/mounts.tar" "$MOUNT_CACHE_DIR/deps/mounts.tar"
fi

if archive_has_regular_entries "$OUT_DIR/next/mounts.tar"; then
  mkdir -p "$MOUNT_CACHE_DIR/next"
  mv -f "$OUT_DIR/next/mounts.tar" "$MOUNT_CACHE_DIR/next/mounts.tar"
fi
