#!/usr/bin/env bash
set -euo pipefail

AUTHORIZED_REF_REGEX='^(refs/heads/main|refs/tags/v[0-9][a-zA-Z0-9_.-]*)$'

verify_subject_provenance() {
  local subject_uri="$1"
  local expected_sha="$2"
  local owner="$3"
  local signer_workflow="$4"
  local manifest_rev_hint="${5:-}"
  local prov_json=""

  if ! prov_json=$(gh attestation verify "oci://${subject_uri}" \
    --owner "$owner" \
    --signer-workflow "$signer_workflow" \
    --predicate-type "https://slsa.dev/provenance/v1" \
    --format json 2>/dev/null); then
    return 1
  fi
  if [ -z "$prov_json" ]; then
    return 1
  fi

  printf '%s' "$prov_json" | jq -e \
    --arg expected_sha "$expected_sha" \
    --arg manifest_rev "$manifest_rev_hint" \
    --arg ref_re "$AUTHORIZED_REF_REGEX" '
    def first_sha(stream):
      [stream | select(type == "string" and test("^[a-fA-F0-9]{40}$")) | ascii_downcase][0] // null;

    [
      (if type == "array" then .[] else . end)
      | (.verificationResult.signature.certificate.sourceRepositoryRef // "") as $cert_ref
      | select(($cert_ref == "") or ($cert_ref | test($ref_re)))
      | (.verificationResult.statement // .statement // .) as $stmt
      | ($stmt.predicate // .predicate // {}) as $pred
      | (first_sha(
          $pred.buildDefinition.externalParameters.inputs.commit_sha,
          $pred.buildDefinition.externalParameters.workflow.inputs.commit_sha,
          $pred.invocation.environment.inputs.commit_sha
        )) as $input_rev
      | (first_sha(
          $stmt.subject[]?.annotations["org.opencontainers.image.revision"],
          $manifest_rev
        )) as $subject_rev
      | select(($input_rev == null) or ($subject_rev == null) or ($input_rev == $subject_rev))
      | (first_sha(
          ($pred.buildDefinition.resolvedDependencies[]? | (.digest.gitCommit, .digest.sha1)),
          $pred.buildDefinition.internalParameters.github.sha,
          $pred.invocation.configSource.digest.sha1,
          ($pred.materials[]? | (.digest.gitCommit, .digest.sha1)),
          .verificationResult.signature.certificate.sourceRepositoryDigest
        )) as $oidc_rev
      | ($input_rev // $subject_rev // $oidc_rev // "")
      | select(. == ($expected_sha | ascii_downcase))
    ] | length > 0
  ' >/dev/null 2>&1
}

extract_subject_spdx_sbom() {
  local subject_uri="$1"
  local owner="$2"
  local signer_workflow="$3"
  local pred_type candidate_spdx extracted=""

  for pred_type in "https://spdx.dev/Document/v2.3" "https://spdx.dev/Document"; do
    candidate_spdx=$(gh attestation verify "oci://${subject_uri}" \
      --owner "$owner" \
      --signer-workflow "$signer_workflow" \
      --predicate-type "$pred_type" \
      --format json 2>/dev/null || true)
    if [ -z "$candidate_spdx" ]; then
      continue
    fi
    extracted=$(printf '%s' "$candidate_spdx" | jq -c \
      --arg ref_re "$AUTHORIZED_REF_REGEX" '
      [
        (if type == "array" then .[] else . end)
        | (.verificationResult.signature.certificate.sourceRepositoryRef // "") as $cert_ref
        | select(($cert_ref == "") or ($cert_ref | test($ref_re)))
        | (.verificationResult.statement.predicate // .statement.predicate // .predicate // empty)
        | select(type == "object" and (.spdxVersion | type == "string") and (.packages | type == "array"))
      ][0] // empty
    ' 2>/dev/null || true)
    if [ -n "$extracted" ]; then
      printf '%s\n' "$extracted"
      return 0
    fi
  done

  return 1
}

write_fallback_outputs() {
  local output_file="${GITHUB_OUTPUT:?Missing GITHUB_OUTPUT}"
  {
    echo "promote_existing=false"
    echo "amd64_digest="
    echo "arm64_digest="
    echo "source_index_digest="
  } >> "$output_file"
}

fallback_to_build() {
  local reason="$1"
  echo "::notice::${reason} Falling back to native multi-architecture build."
  write_fallback_outputs
  exit 0
}

cmd_inspect_preflight() {
  if [ "${EVENT_NAME:-}" != "push" ] && [ "${EVENT_NAME:-}" != "workflow_dispatch" ]; then
    echo "Event '${EVENT_NAME:-unknown}' builds fresh artifacts; skipping GHCR promotion lookup."
    write_fallback_outputs
    exit 0
  fi

  local source_revision
  source_revision=$(printf '%s' "${RESOLVED_SHA:-}" | tr '[:upper:]' '[:lower:]')
  if [[ ! "$source_revision" =~ ^[a-f0-9]{40}$ ]]; then
    echo "::error::Invalid resolved commit SHA '${RESOLVED_SHA:-}' for GHCR inspection."
    exit 1
  fi

  if [ -z "${GITHUB_REPOSITORY:-}" ]; then
    echo "::error::Missing GITHUB_REPOSITORY required to inspect GHCR artifact."
    exit 1
  fi

  # Guard workflow_dispatch runs targeting historical commits before this helper existed on main
  if command -v git >/dev/null 2>&1 && git cat-file -e "${source_revision}^{commit}" 2>/dev/null; then
    if ! git cat-file -e "${source_revision}:scripts/ghcr-release-promotion.sh" 2>/dev/null; then
      fallback_to_build "Target commit '${source_revision}' predates scripts/ghcr-release-promotion.sh."
    fi
  fi

  local repo_lower image_repo resolved_owner resolved_signer
  repo_lower=$(printf '%s' "$GITHUB_REPOSITORY" | tr '[:upper:]' '[:lower:]')
  image_repo="ghcr.io/${repo_lower}"
  resolved_owner="${REPO_OWNER:-${GITHUB_REPOSITORY%%/*}}"
  resolved_signer="${SIGNER_WORKFLOW:-${GITHUB_REPOSITORY}/.github/workflows/publish-artifact.yml}"

  if [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_ACTOR_LOGIN:-}" ] && command -v docker >/dev/null 2>&1; then
    printf '%s\n' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR_LOGIN" --password-stdin >/dev/null 2>&1 || true
  fi

  local candidate_tag_uri="${image_repo}:${source_revision}"
  local source_index_digest=""
  source_index_digest=$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$candidate_tag_uri" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ ! "$source_index_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    fallback_to_build "No existing GHCR manifest found at '${candidate_tag_uri}'."
  fi

  local source_index_uri="${image_repo}@${source_index_digest}"
  local raw_index=""
  raw_index=$(docker buildx imagetools inspect --raw "$source_index_uri" 2>/dev/null || true)
  if [[ "${raw_index#"${raw_index%%[![:space:]]*}"}" != \{* ]]; then
    fallback_to_build "Unable to inspect raw OCI index JSON for '${source_index_uri}'."
  fi

  local amd64_digest arm64_digest recorded_revision
  amd64_digest=$(printf '%s' "$raw_index" | jq -r '
    [.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest][0] // empty
  ' 2>/dev/null | tr -d '[:space:]' || true)
  arm64_digest=$(printf '%s' "$raw_index" | jq -r '
    [.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "arm64") | .digest][0] // empty
  ' 2>/dev/null | tr -d '[:space:]' || true)

  if [[ ! "$amd64_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || [[ ! "$arm64_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    fallback_to_build "Existing GHCR index '${source_index_uri}' is missing valid linux/amd64 or linux/arm64 manifest digests."
  fi

  recorded_revision=$(printf '%s' "$raw_index" | jq -r '.annotations["org.opencontainers.image.revision"] // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
  if [ "$recorded_revision" != "$source_revision" ]; then
    fallback_to_build "Existing GHCR index '${source_index_uri}' revision '${recorded_revision}' does not match '${source_revision}'."
  fi

  local arch_digest raw_arch arch_rev
  local amd64_manifest_rev=""
  local arm64_manifest_rev=""
  for arch_digest in "$amd64_digest" "$arm64_digest"; do
    if ! raw_arch=$(docker buildx imagetools inspect --raw "${image_repo}@${arch_digest}" 2>/dev/null); then
      fallback_to_build "Per-architecture manifest '${image_repo}@${arch_digest}' is not accessible in GHCR."
    fi
    arch_rev=$(printf '%s' "$raw_arch" | jq -r '.annotations["org.opencontainers.image.revision"] // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
    if [ -n "$arch_rev" ] && [ "$arch_rev" != "$source_revision" ]; then
      fallback_to_build "Per-architecture manifest '${image_repo}@${arch_digest}' revision '${arch_rev}' does not match '${source_revision}'."
    fi
    if [ "$arch_digest" = "$amd64_digest" ]; then
      amd64_manifest_rev="$arch_rev"
    else
      arm64_manifest_rev="$arch_rev"
    fi
  done

  local pair_digest pair_rev subject_uri
  for pair in "${source_index_digest}|${recorded_revision}" "${amd64_digest}|${amd64_manifest_rev}" "${arm64_digest}|${arm64_manifest_rev}"; do
    pair_digest="${pair%|*}"
    pair_rev="${pair#*|}"
    subject_uri="${image_repo}@${pair_digest}"
    if ! verify_subject_provenance "$subject_uri" "$source_revision" "$resolved_owner" "$resolved_signer" "$pair_rev"; then
      fallback_to_build "OIDC provenance attestation verification failed for '${subject_uri}'."
    fi
    if ! extract_subject_spdx_sbom "$subject_uri" "$resolved_owner" "$resolved_signer" >/dev/null; then
      fallback_to_build "OIDC SPDX SBOM attestation verification failed for '${subject_uri}'."
    fi
  done

  echo "Verified complete and attested GHCR multi-platform artifact '${source_index_uri}' (amd64: ${amd64_digest}, arm64: ${arm64_digest})."
  local output_file="${GITHUB_OUTPUT:?Missing GITHUB_OUTPUT}"
  {
    echo "promote_existing=true"
    echo "amd64_digest=${amd64_digest}"
    echo "arm64_digest=${arm64_digest}"
    echo "source_index_digest=${source_index_digest}"
  } >> "$output_file"

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### ♻️ Verified Existing Attested GHCR Artifact"
      echo "- **Source Index:** \`${source_index_uri}\`"
      echo "- **linux/amd64 Digest:** \`${amd64_digest}\`"
      echo "- **linux/arm64 Digest:** \`${arm64_digest}\`"
      echo "- **Action:** Skipping duplicate matrix builds and promoting attested digests."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

cmd_extract_promoted_sboms() {
  local handoff_dir="${OCI_HANDOFF_DIR:-/tmp/oci-handoff}"
  mkdir -p "$handoff_dir"

  local source_revision
  source_revision=$(printf '%s' "${REVISION:-${RESOLVED_SHA:-${GITHUB_SHA:-}}}" | tr '[:upper:]' '[:lower:]')
  if [[ ! "$source_revision" =~ ^[a-f0-9]{40}$ ]]; then
    echo "::error::Invalid 40-character source revision '${source_revision}' during promoted SBOM verification."
    exit 1
  fi

  local image_repo="${IMAGE_REPOSITORY:?Missing IMAGE_REPOSITORY}"
  local resolved_owner="${REPO_OWNER:-${GITHUB_REPOSITORY%%/*}}"
  local resolved_signer="${SIGNER_WORKFLOW:-${GITHUB_REPOSITORY}/.github/workflows/publish-artifact.yml}"

  local required_arch arch_digest subject_uri raw_arch arch_rev extracted_sbom
  for required_arch in amd64 arm64; do
    if [ "$required_arch" = "amd64" ]; then
      arch_digest=$(printf '%s' "${PROMOTED_AMD64_DIGEST:-}" | tr -d '[:space:]')
    else
      arch_digest=$(printf '%s' "${PROMOTED_ARM64_DIGEST:-}" | tr -d '[:space:]')
    fi
    if [[ ! "$arch_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      echo "::error::Invalid promoted digest '${arch_digest}' for architecture '${required_arch}'."
      exit 1
    fi

    subject_uri="${image_repo}@${arch_digest}"
    arch_rev=""
    if raw_arch=$(docker buildx imagetools inspect --raw "$subject_uri" 2>/dev/null); then
      arch_rev=$(printf '%s' "$raw_arch" | jq -r '.annotations["org.opencontainers.image.revision"] // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
      if [ -n "$arch_rev" ] && [ "$arch_rev" != "$source_revision" ]; then
        echo "::error::Promoted '${subject_uri}' manifest revision '${arch_rev}' does not match '${source_revision}'."
        exit 1
      fi
    fi

    if ! verify_subject_provenance "$subject_uri" "$source_revision" "$resolved_owner" "$resolved_signer" "$arch_rev"; then
      echo "::error::OIDC provenance attestation verification failed or revision mismatched '${source_revision}' for promoted '${subject_uri}'."
      exit 1
    fi

    if ! extracted_sbom=$(extract_subject_spdx_sbom "$subject_uri" "$resolved_owner" "$resolved_signer"); then
      echo "::error::Missing or invalid SPDX SBOM attestation for promoted '${subject_uri}'."
      exit 1
    fi

    printf '%s\n' "$extracted_sbom" > "${handoff_dir}/sbom-${required_arch}.spdx.json"
  done
}

cmd_mirror_promoted_digests() {
  local digests_dir="${DIGESTS_DIR:-/tmp/digests}"
  mkdir -p "$digests_dir"

  local source_revision
  source_revision=$(printf '%s' "${REVISION:-${RESOLVED_SHA:-${GITHUB_SHA:-}}}" | tr '[:upper:]' '[:lower:]')
  if [[ ! "$source_revision" =~ ^[a-f0-9]{40}$ ]]; then
    echo "::error::Missing or invalid 40-character source revision '${source_revision}' for promoted GHCR index."
    exit 1
  fi

  local image_repo="${IMAGE_REPOSITORY:?Missing IMAGE_REPOSITORY}"
  local index_digest amd64_digest arm64_digest candidate_digest
  index_digest=$(printf '%s' "${PROMOTED_INDEX_DIGEST:-}" | tr -d '[:space:]')
  amd64_digest=$(printf '%s' "${PROMOTED_AMD64_DIGEST:-}" | tr -d '[:space:]')
  arm64_digest=$(printf '%s' "${PROMOTED_ARM64_DIGEST:-}" | tr -d '[:space:]')

  for candidate_digest in "$index_digest" "$amd64_digest" "$arm64_digest"; do
    if [[ ! "$candidate_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      echo "::error::Invalid promoted OCI digest '${candidate_digest}'."
      exit 1
    fi
  done

  local source_index_uri="${image_repo}@${index_digest}"
  local raw_source_index inspected_amd64 inspected_arm64 inspected_revision
  raw_source_index=$(docker buildx imagetools inspect --raw "$source_index_uri")
  inspected_amd64=$(printf '%s' "$raw_source_index" | jq -r '[.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest][0] // empty' | tr -d '[:space:]')
  inspected_arm64=$(printf '%s' "$raw_source_index" | jq -r '[.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "arm64") | .digest][0] // empty' | tr -d '[:space:]')
  inspected_revision=$(printf '%s' "$raw_source_index" | jq -r '.annotations["org.opencontainers.image.revision"] // empty' | tr '[:upper:]' '[:lower:]')

  if [ "$inspected_amd64" != "$amd64_digest" ] || [ "$inspected_arm64" != "$arm64_digest" ]; then
    echo "::error::Promoted GHCR index '${source_index_uri}' architecture digests ('${inspected_amd64}', '${inspected_arm64}') do not match preflight digests ('${amd64_digest}', '${arm64_digest}')."
    exit 1
  fi
  if [ "$inspected_revision" != "$source_revision" ]; then
    echo "::error::Promoted GHCR index '${source_index_uri}' revision '${inspected_revision}' does not match '${source_revision}'."
    exit 1
  fi

  printf '%s\n' "$amd64_digest" > "${digests_dir}/amd64.digest"
  printf '%s\n' "$arm64_digest" > "${digests_dir}/arm64.digest"

  if [ -n "${DOCKERHUB_REPOSITORY:-}" ]; then
    local required_arch arch_digest
    for required_arch in amd64 arm64; do
      arch_digest=$(tr -d '[:space:]' < "${digests_dir}/${required_arch}.digest")
      skopeo copy --preserve-digests \
        "docker://${image_repo}@${arch_digest}" \
        "docker://docker.io/${DOCKERHUB_REPOSITORY}@${arch_digest}"
    done
  fi
}

SUBCOMMAND="${1:-}"
case "$SUBCOMMAND" in
  inspect-preflight)
    cmd_inspect_preflight
    ;;
  extract-promoted-sboms)
    cmd_extract_promoted_sboms
    ;;
  mirror-promoted-digests)
    cmd_mirror_promoted_digests
    ;;
  *)
    echo "::error::Usage: $0 {inspect-preflight|extract-promoted-sboms|mirror-promoted-digests}"
    exit 1
    ;;
esac
