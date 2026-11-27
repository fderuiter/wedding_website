#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

validate_relpath() {
  local rel="$1"
  if [ -z "$rel" ]; then
    echo "::error::Checksum manifest entry path cannot be empty." >&2
    return 1
  fi
  if [[ "$rel" == /* ]] || [[ "$rel" == "." ]] || [[ "$rel" == ".." ]] ||
     [[ "$rel" == *"../"* ]] || [[ "$rel" == *"/.." ]] || [[ "$rel" == *"//"* ]] ||
     [[ "$rel" == *$'\r'* ]] || [[ "$rel" == *$'\n'* ]]; then
    echo "::error::Unsafe or non-normalized relative path '${rel}' in checksum manifest." >&2
    return 1
  fi
  return 0
}

resolve_abs_dir() {
  local dir="$1"
  if [ -z "$dir" ] || [ -L "$dir" ] || [ ! -d "$dir" ]; then
    echo "::error::Target directory '${dir}' is missing or is a symbolic link." >&2
    return 1
  fi
  (cd "$dir" && pwd -P)
}

resolve_abs_file_target() {
  local file_path="$1"
  local parent_dir base_name abs_parent
  parent_dir=$(dirname -- "$file_path")
  base_name=$(basename -- "$file_path")
  if [ -z "$base_name" ] || [ "$base_name" = "." ] || [ "$base_name" = ".." ]; then
    echo "::error::Invalid manifest file path '${file_path}'." >&2
    return 1
  fi
  mkdir -p -- "$parent_dir"
  abs_parent=$(resolve_abs_dir "$parent_dir") || return 1
  printf '%s/%s\n' "$abs_parent" "$base_name"
}

assert_no_symlinks_in_tree() {
  local abs_dir="$1"
  local found_link=""
  found_link=$(find "$abs_dir" -type l -print -quit 2>/dev/null || true)
  if [ -n "$found_link" ]; then
    echo "::error::Symbolic link '${found_link}' is forbidden inside integrity-verified directory '${abs_dir}'." >&2
    return 1
  fi
  return 0
}

cmd_verify_spdx() {
  if [ "$#" -lt 1 ]; then
    echo "::error::Usage: $0 verify-spdx <spdx-file> [<spdx-file>...]" >&2
    exit 1
  fi

  local spdx_file
  for spdx_file in "$@"; do
    if [ -L "$spdx_file" ] || [ ! -f "$spdx_file" ] || [ ! -s "$spdx_file" ]; then
      echo "::error::Missing, empty, or symlinked SPDX JSON SBOM '${spdx_file}'." >&2
      exit 1
    fi
    if ! jq -e '
      type == "object" and
      (.spdxVersion | type == "string" and length > 0) and
      (.packages | type == "array" and length > 0)
    ' "$spdx_file" >/dev/null 2>&1; then
      echo "::error::Invalid SPDX JSON SBOM '${spdx_file}': must declare a non-empty .spdxVersion string and a non-empty .packages array." >&2
      exit 1
    fi
  done
}

cmd_generate_sums() {
  local dir=""
  local output=""
  local files=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir)
        dir="${2:-}"
        shift 2
        ;;
      --output)
        output="${2:-}"
        shift 2
        ;;
      --)
        shift
        while [ "$#" -gt 0 ]; do
          files+=("$1")
          shift
        done
        ;;
      -*)
        echo "::error::Unknown option '$1' for generate-sums." >&2
        exit 1
        ;;
      *)
        files+=("$1")
        shift
        ;;
    esac
  done

  if [ -z "$dir" ] || [ -z "$output" ] || [ "${#files[@]}" -eq 0 ]; then
    echo "::error::Usage: $0 generate-sums --dir <dir> --output <manifest> <relfile> [<relfile>...]" >&2
    exit 1
  fi

  local abs_dir abs_output tmp_manifest rel target
  abs_dir=$(resolve_abs_dir "$dir")
  abs_output=$(resolve_abs_file_target "$output")
  if [ -L "$abs_output" ]; then
    echo "::error::Refusing to write checksum manifest through symlink '${abs_output}'." >&2
    exit 1
  fi

  local sorted_files=()
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    sorted_files+=("$rel")
  done < <(printf '%s\n' "${files[@]}" | LC_ALL=C sort -u)

  if [ "${#sorted_files[@]}" -ne "${#files[@]}" ]; then
    echo "::error::Duplicate or empty relative file paths passed to generate-sums." >&2
    exit 1
  fi

  for rel in "${sorted_files[@]}"; do
    validate_relpath "$rel"
    target="${abs_dir}/${rel}"
    if [ -L "$target" ] || [ ! -f "$target" ]; then
      echo "::error::Missing or symlinked target file '${target}' for SHA-256 manifest generation." >&2
      exit 1
    fi
  done

  tmp_manifest=$(mktemp "${abs_output}.tmp.XXXXXX")
  trap 'rm -f -- "${tmp_manifest:-}"' EXIT

  (
    cd "$abs_dir"
    sha256sum -- "${sorted_files[@]}"
  ) > "$tmp_manifest"

  if [ ! -s "$tmp_manifest" ]; then
    echo "::error::Generated empty SHA-256 manifest for '${abs_dir}'." >&2
    exit 1
  fi

  chmod 0644 "$tmp_manifest"
  mv -f -- "$tmp_manifest" "$abs_output"
  trap - EXIT
}

cmd_verify_sums() {
  local dir=""
  local manifest=""
  local expected_files=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir)
        dir="${2:-}"
        shift 2
        ;;
      --manifest)
        manifest="${2:-}"
        shift 2
        ;;
      --)
        shift
        while [ "$#" -gt 0 ]; do
          expected_files+=("$1")
          shift
        done
        ;;
      -*)
        echo "::error::Unknown option '$1' for verify-sums." >&2
        exit 1
        ;;
      *)
        expected_files+=("$1")
        shift
        ;;
    esac
  done

  if [ -z "$dir" ] || [ -z "$manifest" ]; then
    echo "::error::Usage: $0 verify-sums --dir <dir> --manifest <manifest> [<expected-relfile>...]" >&2
    exit 1
  fi

  local abs_dir abs_manifest parent_dir base_name
  abs_dir=$(resolve_abs_dir "$dir")
  if [ -L "$manifest" ] || [ ! -f "$manifest" ] || [ ! -s "$manifest" ]; then
    echo "::error::Missing, empty, or symlinked SHA-256 manifest '${manifest}'." >&2
    exit 1
  fi
  parent_dir=$(dirname -- "$manifest")
  base_name=$(basename -- "$manifest")
  abs_manifest="$(resolve_abs_dir "$parent_dir")/${base_name}"

  local line rel target line_count=0
  local manifest_paths=()
  while IFS= read -r line || [ -n "$line" ]; do
    line_count=$((line_count + 1))
    if [[ "$line" == *$'\r'* ]] || [[ ! "$line" =~ ^[a-f0-9]{64}\ \ (.+)$ ]]; then
      echo "::error::Malformed SHA-256 manifest line ${line_count} in '${manifest}'." >&2
      exit 1
    fi
    rel="${BASH_REMATCH[1]}"
    validate_relpath "$rel"
    target="${abs_dir}/${rel}"
    if [ -L "$target" ]; then
      echo "::error::Symbolic link target '${target}' is forbidden in SHA-256 verification." >&2
      exit 1
    fi
    manifest_paths+=("$rel")
  done < "$abs_manifest"

  if [ "$line_count" -eq 0 ]; then
    echo "::error::SHA-256 manifest '${manifest}' contains zero entries." >&2
    exit 1
  fi

  local unique_count
  unique_count=$(printf '%s\n' "${manifest_paths[@]}" | LC_ALL=C sort -u | wc -l | tr -d '[:space:]')
  if [ "$unique_count" -ne "${#manifest_paths[@]}" ]; then
    echo "::error::Duplicate file paths detected in SHA-256 manifest '${manifest}'." >&2
    exit 1
  fi

  if [ "${#expected_files[@]}" -gt 0 ]; then
    local expected_sorted actual_sorted
    expected_sorted=$(printf '%s\n' "${expected_files[@]}" | LC_ALL=C sort -u)
    actual_sorted=$(printf '%s\n' "${manifest_paths[@]}" | LC_ALL=C sort -u)
    if [ "$expected_sorted" != "$actual_sorted" ]; then
      echo "::error::SHA-256 manifest '${manifest}' entries do not match expected file set." >&2
      exit 1
    fi
  fi

  if ! (cd "$abs_dir" && sha256sum --check --strict "$abs_manifest" >/dev/null); then
    echo "::error::SHA-256 checksum verification failed for '${manifest}' in '${abs_dir}'." >&2
    exit 1
  fi
}

cmd_generate_tree_sums() {
  local dir="${1:-}"
  local output="${2:-}"
  if [ -z "$dir" ]; then
    echo "::error::Usage: $0 generate-tree-sums <dir> [<manifest>]" >&2
    exit 1
  fi

  local abs_dir abs_output manifest_rel=""
  abs_dir=$(resolve_abs_dir "$dir")
  assert_no_symlinks_in_tree "$abs_dir"

  if [ -z "$output" ]; then
    output="${abs_dir}/SHA256SUMS"
  fi
  abs_output=$(resolve_abs_file_target "$output")
  if [ -L "$abs_output" ]; then
    echo "::error::Refusing to write tree SHA-256 manifest through symlink '${abs_output}'." >&2
    exit 1
  fi
  if [[ "$abs_output" == "${abs_dir}/"* ]]; then
    manifest_rel="${abs_output#"${abs_dir}/"}"
  fi

  local tree_files=()
  local entry rel
  while IFS= read -r -d '' entry; do
    rel="${entry#./}"
    if [ -n "$manifest_rel" ] && [ "$rel" = "$manifest_rel" ]; then
      continue
    fi
    validate_relpath "$rel"
    tree_files+=("$rel")
  done < <(cd "$abs_dir" && find . -type f -print0 | LC_ALL=C sort -z)

  if [ "${#tree_files[@]}" -eq 0 ]; then
    echo "::error::Directory '${abs_dir}' contains zero regular files to checksum." >&2
    exit 1
  fi

  local tmp_manifest
  tmp_manifest=$(mktemp "${abs_output}.tmp.XXXXXX")
  trap 'rm -f -- "${tmp_manifest:-}"' EXIT

  (
    cd "$abs_dir"
    printf '%s\0' "${tree_files[@]}" | xargs -0 sha256sum --
  ) > "$tmp_manifest"

  if [ ! -s "$tmp_manifest" ]; then
    echo "::error::Generated empty tree SHA-256 manifest for '${abs_dir}'." >&2
    exit 1
  fi

  chmod 0644 "$tmp_manifest"
  mv -f -- "$tmp_manifest" "$abs_output"
  trap - EXIT
}

cmd_verify_tree_sums() {
  local dir="${1:-}"
  local manifest="${2:-}"
  if [ -z "$dir" ]; then
    echo "::error::Usage: $0 verify-tree-sums <dir> [<manifest>]" >&2
    exit 1
  fi

  local abs_dir abs_manifest parent_dir base_name manifest_rel=""
  abs_dir=$(resolve_abs_dir "$dir")
  assert_no_symlinks_in_tree "$abs_dir"

  if [ -z "$manifest" ]; then
    manifest="${abs_dir}/SHA256SUMS"
  fi
  if [ -L "$manifest" ] || [ ! -f "$manifest" ] || [ ! -s "$manifest" ]; then
    echo "::error::Missing, empty, or symlinked tree SHA-256 manifest '${manifest}'." >&2
    exit 1
  fi
  parent_dir=$(dirname -- "$manifest")
  base_name=$(basename -- "$manifest")
  abs_manifest="$(resolve_abs_dir "$parent_dir")/${base_name}"
  if [[ "$abs_manifest" == "${abs_dir}/"* ]]; then
    manifest_rel="${abs_manifest#"${abs_dir}/"}"
  fi

  cmd_verify_sums --dir "$abs_dir" --manifest "$abs_manifest"

  local actual_files=()
  local entry rel
  while IFS= read -r -d '' entry; do
    rel="${entry#./}"
    if [ -n "$manifest_rel" ] && [ "$rel" = "$manifest_rel" ]; then
      continue
    fi
    validate_relpath "$rel"
    actual_files+=("$rel")
  done < <(cd "$abs_dir" && find . -type f -print0 | LC_ALL=C sort -z)

  local actual_sorted manifest_sorted
  actual_sorted=$(printf '%s\n' "${actual_files[@]}" | LC_ALL=C sort -u)
  manifest_sorted=$(sed 's/^[a-f0-9]\{64\}  //' "$abs_manifest" | LC_ALL=C sort -u)

  if [ "$actual_sorted" != "$manifest_sorted" ]; then
    echo "::error::Directory '${abs_dir}' contains unindexed or mismatched files relative to '${abs_manifest}'." >&2
    exit 1
  fi
}

cmd_extract_changelog_notes() {
  local changelog_file="${1:-}"
  local raw_version="${2:-}"
  local output_file="${3:-}"

  if [ -z "$changelog_file" ] || [ -z "$raw_version" ] || [ -z "$output_file" ]; then
    echo "::error::Usage: $0 extract-changelog-notes <changelog-file> <tag-or-version> <output-file>" >&2
    exit 1
  fi
  if [ -L "$changelog_file" ] || [ ! -f "$changelog_file" ]; then
    echo "::error::Missing or symlinked changelog file '${changelog_file}'." >&2
    exit 1
  fi

  local normalized_version="${raw_version#v}"
  if [[ ! "$normalized_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
    echo "::error::Invalid SemVer release version '${raw_version}' for changelog extraction." >&2
    exit 1
  fi

  local abs_output extracted=""
  abs_output=$(resolve_abs_file_target "$output_file")
  if [ -L "$abs_output" ]; then
    echo "::error::Refusing to write release notes through symlink '${abs_output}'." >&2
    exit 1
  fi

  extract_section_by_heading() {
    local target_heading="$1"
    awk -v target="$target_heading" '
      BEGIN { capture = 0 }
      /^## \[/ {
        if (capture == 1) {
          exit
        }
        line = $0
        sub(/^## \[/, "", line)
        sub(/\].*$/, "", line)
        if (line == target) {
          capture = 1
          next
        }
      }
      capture == 1 {
        print
      }
    ' "$changelog_file" | sed -e '/^---[[:space:]]*$/d'
  }

  extracted=$(extract_section_by_heading "$normalized_version")
  if [ -z "$(printf '%s' "$extracted" | tr -d '[:space:]')" ]; then
    extracted=$(extract_section_by_heading "Unreleased")
  fi

  if [ -z "$(printf '%s' "$extracted" | tr -d '[:space:]')" ]; then
    echo "::error::No release notes found for '[${normalized_version}]' or '[Unreleased]' in '${changelog_file}'." >&2
    exit 1
  fi

  if ! printf '%s\n' "$extracted" | grep -q 'Adopter Action Required'; then
    echo "::error::Extracted release notes from '${changelog_file}' are missing the required 'Adopter Action Required' callout." >&2
    exit 1
  fi

  printf '%s\n' "$extracted" > "$abs_output"
  chmod 0644 "$abs_output"
}

SUBCOMMAND="${1:-}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$SUBCOMMAND" in
  verify-spdx)
    cmd_verify_spdx "$@"
    ;;
  generate-sums)
    cmd_generate_sums "$@"
    ;;
  verify-sums)
    cmd_verify_sums "$@"
    ;;
  generate-tree-sums)
    cmd_generate_tree_sums "$@"
    ;;
  verify-tree-sums)
    cmd_verify_tree_sums "$@"
    ;;
  extract-changelog-notes)
    cmd_extract_changelog_notes "$@"
    ;;
  *)
    echo "::error::Usage: $0 {verify-spdx|generate-sums|verify-sums|generate-tree-sums|verify-tree-sums|extract-changelog-notes} [args...]" >&2
    exit 1
    ;;
esac
