#!/usr/bin/env bash
# Resolves the canonical 40-character git commit revision for an attested OCI
# container artifact AFTER `gh attestation verify` has succeeded.
#
# Priority order (prevents `workflow_run` head-drift mismatches when `main`
# advances from C1 to C2 before `publish-artifact.yml` finishes signing C1):
#   1. OCI index / config / manifest `org.opencontainers.image.revision`
#   2. Attested SLSA subject `org.opencontainers.image.revision` annotation
#   3. SLSA `predicate.buildDefinition.externalParameters.inputs.commit_sha`
#   4. OIDC / SLSA workflow context digests (`resolvedDependencies`,
#      `internalParameters.github.sha`, `configSource.digest.sha1`, `materials`,
#      `certificate.sourceRepositoryDigest`)
#
# Fails closed (exit 2) when OCI `org.opencontainers.image.revision` conflicts
# with SLSA `inputs.commit_sha` (or emits a warning and skips when
# `--conflict-mode warn` is passed).
#
# Output format on stdout (pipe-delimited so empty fields never collapse):
#   <resolved_revision>|<index_revision>|<slsa_revision>|<revision_source>

set -euo pipefail

CONFLICT_MODE="error"
IMAGE_LABEL="oci-artifact"
INSPECT_IMAGE_URI=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --conflict-mode)
      CONFLICT_MODE="${2:-error}"
      shift 2
      ;;
    --image-label)
      IMAGE_LABEL="${2:-oci-artifact}"
      shift 2
      ;;
    --inspect-image)
      INSPECT_IMAGE_URI="${2:-}"
      shift 2
      ;;
    *)
      echo "::error::Unknown option '$1' passed to resolve-oci-provenance.sh" >&2
      exit 1
      ;;
  esac
done

ATTESTATION_PAYLOAD="${ATTESTATION_JSON:-}"
if [ -z "$ATTESTATION_PAYLOAD" ] && [ ! -t 0 ]; then
  ATTESTATION_PAYLOAD=$(cat)
fi

if [ -z "${ATTESTATION_PAYLOAD//[[:space:]]/}" ]; then
  printf '|||none\n'
  exit 0
fi

MANIFEST_PAYLOAD="${RAW_MANIFEST_JSON:-}"
if [ -z "$MANIFEST_PAYLOAD" ] && [ -n "$INSPECT_IMAGE_URI" ] && command -v docker >/dev/null 2>&1; then
  MANIFEST_PAYLOAD=$(docker buildx imagetools inspect --raw "$INSPECT_IMAGE_URI" 2>/dev/null || true)
fi

INDEX_REVISION=""
if [[ "${MANIFEST_PAYLOAD#"${MANIFEST_PAYLOAD%%[![:space:]]*}"}" == \{* ]]; then
  INDEX_REVISION=$(printf '%s' "$MANIFEST_PAYLOAD" | jq -r '
    (
      .annotations["org.opencontainers.image.revision"]
      // .config.Labels["org.opencontainers.image.revision"]
      // ([.manifests[]?.annotations["org.opencontainers.image.revision"] | select(type == "string" and test("^[a-fA-F0-9]{40}$"))][0])
      // empty
    )
  ' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
  if [[ ! "$INDEX_REVISION" =~ ^[a-f0-9]{40}$ ]]; then
    INDEX_REVISION=""
  fi
fi

SLSA_INPUT_REVISION=$(printf '%s' "$ATTESTATION_PAYLOAD" | jq -r '
  [
    (if type == "array" then .[] else . end)
    | (.verificationResult.statement.predicate // .statement.predicate // .predicate // empty)
    | .buildDefinition.externalParameters.inputs.commit_sha
    | select(type == "string" and test("^[a-fA-F0-9]{40}$"))
  ][0] // empty
' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
if [[ ! "$SLSA_INPUT_REVISION" =~ ^[a-f0-9]{40}$ ]]; then
  SLSA_INPUT_REVISION=""
fi

if [ -n "$INDEX_REVISION" ] && [ -n "$SLSA_INPUT_REVISION" ] && [ "$INDEX_REVISION" != "$SLSA_INPUT_REVISION" ]; then
  if [ "$CONFLICT_MODE" = "warn" ]; then
    echo "::warning::Attested OCI index revision '${INDEX_REVISION}' conflicts with SLSA input commit_sha '${SLSA_INPUT_REVISION}' on serving image '${IMAGE_LABEL}'; skipping conflicting revision tag." >&2
    printf '|%s|%s|conflict\n' "$INDEX_REVISION" "$SLSA_INPUT_REVISION"
    exit 0
  fi
  echo "::error::Attested OCI index revision '${INDEX_REVISION}' conflicts with SLSA input commit_sha '${SLSA_INPUT_REVISION}' for '${IMAGE_LABEL}'." >&2
  exit 2
fi

SLSA_REVISION=$(printf '%s' "$ATTESTATION_PAYLOAD" | jq -r '
  [
    (if type == "array" then .[] else . end)
    | (
        .verificationResult.statement.subject[]?.annotations["org.opencontainers.image.revision"],
        .statement.subject[]?.annotations["org.opencontainers.image.revision"],
        ((.verificationResult.statement.predicate // .statement.predicate // .predicate // empty) | .buildDefinition.externalParameters.inputs.commit_sha),
        .verificationResult.signature.certificate.sourceRepositoryDigest,
        ((.verificationResult.statement.predicate // .statement.predicate // .predicate // empty) | (
          (.buildDefinition.resolvedDependencies[]? | (.digest.gitCommit, .digest.sha1)),
          .buildDefinition.internalParameters.github.sha,
          .invocation.configSource.digest.sha1,
          (.materials[]? | (.digest.gitCommit, .digest.sha1))
        ))
      )
    | select(type == "string" and test("^[a-fA-F0-9]{40}$"))
  ][0] // empty
' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
if [[ ! "$SLSA_REVISION" =~ ^[a-f0-9]{40}$ ]]; then
  SLSA_REVISION=""
fi

RESOLVED_REVISION="${INDEX_REVISION:-${SLSA_REVISION}}"
REVISION_SOURCE="none"
if [ -n "$INDEX_REVISION" ]; then
  REVISION_SOURCE="oci-revision-label"
elif [ -n "$SLSA_REVISION" ]; then
  REVISION_SOURCE="slsa-provenance"
fi

printf '%s|%s|%s|%s\n' "$RESOLVED_REVISION" "$INDEX_REVISION" "$SLSA_REVISION" "$REVISION_SOURCE"
