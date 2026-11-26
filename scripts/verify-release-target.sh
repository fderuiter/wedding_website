#!/usr/bin/env bash
# Verifies that a target release commit or immutable v* release tag is eligible
# for database migration or deployment across release workflows.
#
# Enforced invariants:
#   1. Fetches `+refs/heads/main:refs/remotes/origin/main` and
#      `+refs/tags/v*:refs/tags/v*` from `origin` using explicit `GH_TOKEN` /
#      `GITHUB_TOKEN` HTTP basic auth headers (compatible with
#      `persist-credentials: false`).
#   2. Resolves `--release-tag <v*>` (if supplied) from `refs/tags/<v*>` and
#      verifies `--target-sha` is a valid 40-character commit SHA in git history.
#   3. Verifies `target_sha` descends from `refs/remotes/origin/main`
#      (`git merge-base --is-ancestor`), OR (when `--require-main-ancestry` is
#      not set) matches a `refs/tags/v*` maintenance release with valid OIDC
#      build provenance signed by `<repo>/.github/workflows/publish-artifact.yml`.
#   4. Rejects unmerged branches and unmerged `v*` tags that fail `origin/main`
#      ancestry without valid `publish-artifact.yml` OIDC provenance.
#   5. Requires a completed passing `ci.yml` workflow run for `target_sha` on
#      `GITHUB_REPOSITORY` (unless `--skip-ci-check` is explicitly passed by a
#      downstream job whose upstream gate already verified `ci.yml`).
#
# Output format on stdout (pipe-delimited):
#   <target_sha>|<verification_source>|<matched_tag>|<verified_ci_run_id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET_SHA=""
RELEASE_TAG=""
IMAGE_DIGEST=""
IMAGE_URI=""
REQUIRE_MAIN_ANCESTRY="false"
SKIP_CI_CHECK="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-sha)
      TARGET_SHA="${2:-}"
      shift 2
      ;;
    --release-tag)
      RELEASE_TAG="${2:-}"
      shift 2
      ;;
    --image-digest)
      IMAGE_DIGEST="${2:-}"
      shift 2
      ;;
    --image-uri)
      IMAGE_URI="${2:-}"
      shift 2
      ;;
    --require-main-ancestry)
      REQUIRE_MAIN_ANCESTRY="true"
      shift 1
      ;;
    --skip-ci-check)
      SKIP_CI_CHECK="true"
      shift 1
      ;;
    *)
      echo "::error::Unknown option '$1' passed to verify-release-target.sh" >&2
      exit 1
      ;;
  esac
done

if [ -n "$RELEASE_TAG" ]; then
  if [[ "${RELEASE_TAG,,}" == "latest" ]]; then
    echo "::error::Unpinned 'latest' release tag is forbidden. Provide an immutable v* release tag or 40-character commit SHA." >&2
    exit 1
  fi
  if [[ ! "$RELEASE_TAG" =~ ^v[0-9][a-zA-Z0-9_.-]*$ ]]; then
    echo "::error::Invalid release tag '${RELEASE_TAG}'. Must match ^v[0-9][a-zA-Z0-9_.-]*$." >&2
    exit 1
  fi
fi

if [ -n "$TARGET_SHA" ]; then
  if [[ ! "$TARGET_SHA" =~ ^[a-fA-F0-9]{40}$ ]]; then
    echo "::error::Invalid target commit SHA '${TARGET_SHA}'. Must be a 40-character hexadecimal commit SHA." >&2
    exit 1
  fi
  TARGET_SHA=$(printf '%s' "$TARGET_SHA" | tr '[:upper:]' '[:lower:]')
fi

if [ -z "$TARGET_SHA" ] && [ -z "$RELEASE_TAG" ]; then
  echo "::error::verify-release-target.sh requires --target-sha <40-hex> and/or --release-tag <v*>." >&2
  exit 1
fi

if [ -n "$IMAGE_DIGEST" ] && [[ ! "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "::error::Invalid image digest '${IMAGE_DIGEST}'. Must match ^sha256:[a-f0-9]{64}$." >&2
  exit 1
fi

GIT_AUTH_ARGS=()
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
EFFECTIVE_GIT_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -n "$EFFECTIVE_GIT_TOKEN" ] && [[ "$ORIGIN_URL" =~ ^https?://[^/]+ ]]; then
  ORIGIN_SERVER="${BASH_REMATCH[0]}"
  BASIC_TOKEN=$(printf 'x-access-token:%s' "$EFFECTIVE_GIT_TOKEN" | base64 | tr -d '\r\n')
  GIT_AUTH_ARGS=(-c "http.${ORIGIN_SERVER}/.extraheader=AUTHORIZATION: basic ${BASIC_TOKEN}")
fi

if git remote get-url origin >/dev/null 2>&1; then
  if [ "$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)" = "true" ]; then
    git "${GIT_AUTH_ARGS[@]}" fetch --unshallow --no-tags origin \
      "+refs/heads/main:refs/remotes/origin/main" \
      "+refs/tags/v*:refs/tags/v*"
  else
    git "${GIT_AUTH_ARGS[@]}" fetch --no-tags origin \
      "+refs/heads/main:refs/remotes/origin/main" \
      "+refs/tags/v*:refs/tags/v*"
  fi
fi

if ! git show-ref --verify --quiet refs/remotes/origin/main; then
  echo "::error::Missing refs/remotes/origin/main reference required to verify main branch ancestry." >&2
  exit 1
fi

MATCHED_TAG=""
if [ -n "$RELEASE_TAG" ]; then
  TAG_COMMIT_SHA=$(git rev-parse --verify "refs/tags/${RELEASE_TAG}^{commit}" 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
  if [[ ! "$TAG_COMMIT_SHA" =~ ^[a-f0-9]{40}$ ]]; then
    echo "::error::Failed to resolve release tag '${RELEASE_TAG}' to a repository commit SHA." >&2
    exit 1
  fi
  if [ -n "$TARGET_SHA" ] && [ "$TARGET_SHA" != "$TAG_COMMIT_SHA" ]; then
    echo "::error::Commit mismatch: target SHA '${TARGET_SHA}' does not match release tag '${RELEASE_TAG}' (${TAG_COMMIT_SHA})." >&2
    exit 1
  fi
  TARGET_SHA="$TAG_COMMIT_SHA"
  MATCHED_TAG="$RELEASE_TAG"
fi

if ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  if git remote get-url origin >/dev/null 2>&1; then
    git "${GIT_AUTH_ARGS[@]}" fetch --no-tags origin "$TARGET_SHA" 2>/dev/null || true
  fi
fi

if ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  echo "::error::Commit '${TARGET_SHA}' does not exist in repository history." >&2
  exit 1
fi

VERIFICATION_SOURCE=""
if git merge-base --is-ancestor "$TARGET_SHA" refs/remotes/origin/main; then
  VERIFICATION_SOURCE="origin-main"
else
  if [ "$REQUIRE_MAIN_ANCESTRY" = "true" ]; then
    echo "::error::Target commit '${TARGET_SHA}' is not an ancestor of origin/main." >&2
    exit 1
  fi

  CANDIDATE_TAGS=()
  if [ -n "$RELEASE_TAG" ]; then
    CANDIDATE_TAGS+=("$RELEASE_TAG")
  else
    while IFS= read -r tag_name; do
      [ -z "$tag_name" ] && continue
      if [[ "$tag_name" =~ ^v[0-9][a-zA-Z0-9_.-]*$ ]]; then
        CANDIDATE_TAGS+=("$tag_name")
      fi
    done < <(git tag --list 'v*' --points-at "$TARGET_SHA" 2>/dev/null || true)
  fi

  if [ "${#CANDIDATE_TAGS[@]}" -eq 0 ]; then
    echo "::error::Target commit '${TARGET_SHA}' is not an ancestor of origin/main and has no v* maintenance release tag." >&2
    exit 1
  fi

  RESOLVED_REPO="${GITHUB_REPOSITORY:-}"
  RESOLVED_OWNER="${REPO_OWNER:-}"
  if [ -z "$RESOLVED_OWNER" ] && [[ "$RESOLVED_REPO" == */* ]]; then
    RESOLVED_OWNER="${RESOLVED_REPO%%/*}"
  fi
  RESOLVED_SIGNER="${SIGNER_WORKFLOW:-}"
  if [ -z "$RESOLVED_SIGNER" ] && [ -n "$RESOLVED_REPO" ]; then
    RESOLVED_SIGNER="${RESOLVED_REPO}/.github/workflows/publish-artifact.yml"
  fi
  REPO_LOWER=$(printf '%s' "$RESOLVED_REPO" | tr '[:upper:]' '[:lower:]')

  SCOPED_DOCKER_CONFIG=""
  if [ -n "$EFFECTIVE_GIT_TOKEN" ] && [ -n "${GITHUB_ACTOR_LOGIN:-}" ] && command -v docker >/dev/null 2>&1; then
    SCOPED_DOCKER_CONFIG=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/docker-config-XXXXXX")
    chmod 700 "$SCOPED_DOCKER_CONFIG"
    export DOCKER_CONFIG="$SCOPED_DOCKER_CONFIG"
    trap 'rm -rf "${SCOPED_DOCKER_CONFIG:-}"' EXIT
    printf '%s\n' "$EFFECTIVE_GIT_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR_LOGIN" --password-stdin >/dev/null 2>&1 || true
  fi

  VERIFIED_MAINTENANCE_TAG=""
  if [ -n "$RESOLVED_OWNER" ] && [ -n "$RESOLVED_SIGNER" ] && command -v gh >/dev/null 2>&1; then
    for candidate_tag in "${CANDIDATE_TAGS[@]}"; do
      ATTEST_URI="$IMAGE_URI"
      if [ -z "$ATTEST_URI" ] && [ -n "$IMAGE_DIGEST" ] && [ -n "$REPO_LOWER" ]; then
        ATTEST_URI="ghcr.io/${REPO_LOWER}@${IMAGE_DIGEST}"
      fi
      if [ -z "$ATTEST_URI" ] && [ -n "$REPO_LOWER" ]; then
        TAG_IMAGE_URI="ghcr.io/${REPO_LOWER}:${candidate_tag}"
        if command -v docker >/dev/null 2>&1; then
          RESOLVED_TAG_DIGEST=$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$TAG_IMAGE_URI" 2>/dev/null | tr -d '[:space:]' || true)
          if [[ "$RESOLVED_TAG_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
            ATTEST_URI="ghcr.io/${REPO_LOWER}@${RESOLVED_TAG_DIGEST}"
          fi
        fi
        if [ -z "$ATTEST_URI" ]; then
          ATTEST_URI="$TAG_IMAGE_URI"
        fi
      fi

      if [ -z "$ATTEST_URI" ]; then
        continue
      fi

      ATTESTATION_JSON=$(GH_TOKEN="$EFFECTIVE_GIT_TOKEN" gh attestation verify "oci://${ATTEST_URI}" \
        --owner "$RESOLVED_OWNER" \
        --signer-workflow "$RESOLVED_SIGNER" \
        --source-ref "refs/tags/${candidate_tag}" \
        --format json 2>/dev/null || true)
      if [ -z "${ATTESTATION_JSON//[[:space:]]/}" ]; then
        continue
      fi

      RAW_MANIFEST_JSON=""
      if command -v docker >/dev/null 2>&1; then
        RAW_MANIFEST_JSON=$(docker buildx imagetools inspect --raw "$ATTEST_URI" 2>/dev/null || true)
      fi

      if ! PROVENANCE_ROW=$(ATTESTATION_JSON="$ATTESTATION_JSON" RAW_MANIFEST_JSON="$RAW_MANIFEST_JSON" bash "${SCRIPT_DIR}/resolve-oci-provenance.sh" --image-label "$ATTEST_URI"); then
        echo "::error::Conflicting OCI/SLSA provenance metadata on '${ATTEST_URI}' for maintenance tag '${candidate_tag}'." >&2
        exit 1
      fi
      IFS='|' read -r ATTESTED_REVISION _ _ _ <<< "$PROVENANCE_ROW"
      if [ -n "$ATTESTED_REVISION" ] && [ "${ATTESTED_REVISION,,}" = "$TARGET_SHA" ]; then
        VERIFIED_MAINTENANCE_TAG="$candidate_tag"
        break
      fi
    done
  fi

  if [ -z "$VERIFIED_MAINTENANCE_TAG" ]; then
    echo "::error::Target commit '${TARGET_SHA}' is not an ancestor of origin/main and lacks valid OIDC provenance signed by '${RESOLVED_SIGNER:-publish-artifact.yml}'." >&2
    exit 1
  fi

  VERIFICATION_SOURCE="maintenance-tag"
  MATCHED_TAG="$VERIFIED_MAINTENANCE_TAG"
fi

VERIFIED_CI_RUN_ID=""
if [ "$SKIP_CI_CHECK" = "true" ]; then
  VERIFIED_CI_RUN_ID="skipped"
else
  if [ -z "$EFFECTIVE_GIT_TOKEN" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
    echo "::error::Missing GH_TOKEN/GITHUB_TOKEN or GITHUB_REPOSITORY required to verify passing ci.yml workflow run for '${TARGET_SHA}'." >&2
    exit 1
  fi

  API_BASE="${GITHUB_API_URL:-https://api.github.com}"
  if ! CI_RUNS_JSON=$(curl -fsSL --connect-timeout 5 --max-time 15 \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "Authorization: Bearer ${EFFECTIVE_GIT_TOKEN}" \
    "${API_BASE}/repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${TARGET_SHA}&status=completed&per_page=100"); then
    echo "::error::Failed to query ci.yml workflow runs for commit '${TARGET_SHA}' in '${GITHUB_REPOSITORY}'." >&2
    exit 1
  fi

  VERIFIED_CI_RUN_ID=$(printf '%s' "$CI_RUNS_JSON" | jq -r \
    --arg sha "$TARGET_SHA" \
    --arg repo "$GITHUB_REPOSITORY" '
    [
      .workflow_runs[]?
      | select(.status == "completed" and .conclusion == "success")
      | select((.head_sha // "" | ascii_downcase) == ($sha | ascii_downcase))
      | select((.head_repository == null) or ((.head_repository.full_name // "" | ascii_downcase) == ($repo | ascii_downcase)))
      | (.id | tostring)
    ][0] // empty
  ')

  if [ -z "$VERIFIED_CI_RUN_ID" ]; then
    echo "::error::No completed successful ci.yml workflow run found for commit '${TARGET_SHA}' in '${GITHUB_REPOSITORY}'." >&2
    exit 1
  fi
fi

printf '%s|%s|%s|%s\n' "$TARGET_SHA" "$VERIFICATION_SOURCE" "$MATCHED_TAG" "$VERIFIED_CI_RUN_ID"
