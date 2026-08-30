#!/usr/bin/env bash
set -euo pipefail

rollback_sha="${1:-}"
if [[ ! "$rollback_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: rollback-android-preprod.sh <40-character-main-sha>" >&2
  exit 2
fi

: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_PUBLIC_APK_URL:?R2_PUBLIC_APK_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
versioned_key="android/preprod/builds/${rollback_sha}/windnote.apk"
latest_key="android/preprod/latest/windnote.apk"
rollback_key="android/preprod/rollback/manual-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}/windnote.apk"
expected_package="com.yiboding.circleim.preprod"
identity_cutover_sha="e09582dc7583fb7b69600e231dd76eb792d122f5"
temp_dir="$(mktemp -d)"
latest_existed=false
promoted=false

object_exists() {
  local key="$1"
  local error_file="$temp_dir/head-error.txt"
  if aws s3api head-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$key" \
    >/dev/null 2>"$error_file"; then
    return 0
  fi
  if grep -Eqi '\(404\)|Not Found|NoSuchKey' "$error_file"; then
    return 1
  fi
  cat "$error_file" >&2
  return 2
}

verify_package_attestation() {
  local candidate_sha="$1"
  local package_metadata="$2"
  if [[ "$package_metadata" == "$expected_package" ]]; then
    return 0
  fi
  if [[ -n "$package_metadata" && "$package_metadata" != "None" ]]; then
    echo "::error::Rollback source package metadata is not preproduction."
    return 1
  fi

  local comparison_status
  comparison_status="$(gh api \
    "repos/${GITHUB_REPOSITORY}/compare/${identity_cutover_sha}...${candidate_sha}" \
    --jq .status)"
  if [[ "$comparison_status" != "ahead" && "$comparison_status" != "identical" ]]; then
    echo "::error::Legacy rollback metadata is accepted only for commits at or after the preproduction identity cutover."
    return 1
  fi
  echo "::warning::Accepted a legacy rollback source using its verified digest and cutover commit attestation."
}

rollback_latest() {
  local rollback_status=0
  set +e
  if [[ "$latest_existed" == "true" ]]; then
    aws s3api copy-object \
      --endpoint-url "$endpoint" \
      --bucket "$R2_BUCKET" \
      --copy-source "$R2_BUCKET/$rollback_key" \
      --key "$latest_key" \
      --metadata-directive COPY \
      >/dev/null
    rollback_status=$?
    if [[ $rollback_status -eq 0 ]]; then
      aws s3api delete-object \
        --endpoint-url "$endpoint" \
        --bucket "$R2_BUCKET" \
        --key "$rollback_key" \
        >/dev/null
      rollback_status=$?
    fi
  else
    aws s3api delete-object \
      --endpoint-url "$endpoint" \
      --bucket "$R2_BUCKET" \
      --key "$latest_key" \
      >/dev/null
    rollback_status=$?
  fi
  if [[ $rollback_status -ne 0 ]]; then
    echo "::error::Failed to restore the pre-rollback latest object."
  fi
  return "$rollback_status"
}

handle_exit() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 && "$promoted" == "true" ]]; then
    rollback_latest || true
  fi
  rm -rf "$temp_dir"
  exit "$status"
}
trap handle_exit EXIT

read -r expected_size expected_sha source_package <<< "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$versioned_key" \
  --query '[ContentLength, Metadata.sha256, Metadata.package]' \
  --output text)"
test -n "$expected_size"
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]]
verify_package_attestation "$rollback_sha" "$source_package"

source_download="$temp_dir/source.apk"
aws s3api get-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$versioned_key" \
  "$source_download" \
  >/dev/null
printf '%s  %s\n' "$expected_sha" "$source_download" | sha256sum -c -
test "$(wc -c < "$source_download" | tr -d '[:space:]')" = "$expected_size"

if object_exists "$latest_key"; then
  latest_existed=true
  read -r previous_size previous_sha <<< "$(aws s3api head-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$latest_key" \
    --query '[ContentLength, Metadata.sha256]' \
    --output text)"
  if ! aws s3api copy-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --copy-source "$R2_BUCKET/$latest_key" \
    --key "$rollback_key" \
    --metadata-directive COPY \
    >/dev/null; then
    object_exists "$rollback_key" || exit 1
  fi
  read -r backup_size backup_sha <<< "$(aws s3api head-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$rollback_key" \
    --query '[ContentLength, Metadata.sha256]' \
    --output text)"
  test "$backup_size" = "$previous_size"
  test "$backup_sha" = "$previous_sha"
else
  object_status=$?
  if [[ $object_status -ne 1 ]]; then
    exit "$object_status"
  fi
fi

promoted=true
aws s3api copy-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --copy-source "$R2_BUCKET/$versioned_key" \
  --key "$latest_key" \
  --metadata-directive REPLACE \
  --content-type application/vnd.android.package-archive \
  --content-disposition 'attachment; filename="windnote-preprod.apk"' \
  --cache-control "public, max-age=300" \
  --metadata "sha256=$expected_sha,package=$expected_package" \
  >/dev/null

read -r latest_size latest_sha latest_package <<< "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  --query '[ContentLength, Metadata.sha256, Metadata.package]' \
  --output text)"
test "$latest_size" = "$expected_size"
test "$latest_sha" = "$expected_sha"
test "$latest_package" = "$expected_package"
test "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  --query CacheControl \
  --output text)" = "public, max-age=300"
test "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  --query ContentType \
  --output text)" = "application/vnd.android.package-archive"

latest_download="$temp_dir/latest.apk"
public_download="$temp_dir/public.apk"
aws s3api get-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  "$latest_download" \
  >/dev/null
printf '%s  %s\n' "$expected_sha" "$latest_download" | sha256sum -c -
test "$(wc -c < "$latest_download" | tr -d '[:space:]')" = "$expected_size"

curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
  --dump-header "$temp_dir/public-headers.txt" \
  --output "$public_download" \
  "$R2_PUBLIC_APK_URL?rollback=$rollback_sha"
tr -d '\r' < "$temp_dir/public-headers.txt" > "$temp_dir/public-headers-lf.txt"
grep -qi '^content-type: application/vnd.android.package-archive$' \
  "$temp_dir/public-headers-lf.txt"
grep -qi "^content-length: $expected_size$" "$temp_dir/public-headers-lf.txt"
printf '%s  %s\n' "$expected_sha" "$public_download" | sha256sum -c -
test "$(wc -c < "$public_download" | tr -d '[:space:]')" = "$expected_size"

promoted=false
if [[ "$latest_existed" == "true" ]]; then
  aws s3api delete-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$rollback_key" \
    >/dev/null || echo "::warning::Could not remove the temporary rollback object."
fi

trap - EXIT
rm -rf "$temp_dir"
echo "Restored preproduction latest to $rollback_sha ($expected_sha)."
