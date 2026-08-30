#!/usr/bin/env bash
set -euo pipefail

: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_PUBLIC_APK_URL:?R2_PUBLIC_APK_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

apk_path="${APK_PATH:-windnote-preprod-v1.0.1.apk}"
checksum_path="${CHECKSUM_PATH:-windnote-preprod-v1.0.1.apk.sha256}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
versioned_key="android/preprod/builds/${GITHUB_SHA}/windnote.apk"
latest_key="android/preprod/latest/windnote.apk"
rollback_key="android/preprod/rollback/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}/windnote.apk"
expected_package="com.yiboding.circleim.preprod"
identity_cutover_sha="e09582dc7583fb7b69600e231dd76eb792d122f5"
apk_sha="$(awk '{print $1}' "$checksum_path")"
apk_size="$(wc -c < "$apk_path" | tr -d '[:space:]')"
versioned_download="$RUNNER_TEMP/r2-versioned.apk"
latest_download="$RUNNER_TEMP/r2-latest.apk"
public_download="$RUNNER_TEMP/r2-public.apk"
latest_existed=false
promoted=false

object_exists() {
  local key="$1"
  local error_file="$RUNNER_TEMP/r2-head-error.txt"
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
    echo "::error::Versioned APK package metadata is not preproduction."
    return 1
  fi

  local comparison_status
  comparison_status="$(gh api \
    "repos/${GITHUB_REPOSITORY}/compare/${identity_cutover_sha}...${candidate_sha}" \
    --jq .status)"
  if [[ "$comparison_status" != "ahead" && "$comparison_status" != "identical" ]]; then
    echo "::error::Legacy APK metadata is accepted only for commits at or after the preproduction identity cutover."
    return 1
  fi
  echo "::warning::Accepted a legacy preproduction object using its verified digest and cutover commit attestation."
}

rollback_latest() {
  local rollback_status=0
  set +e
  if [[ "$latest_existed" == "true" ]]; then
    echo "Restoring the previous preproduction APK after failed verification."
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
      if [[ $rollback_status -ne 0 ]]; then
        echo "::error::Restored latest but could not remove the rollback object."
      fi
    fi
  else
    echo "Removing the unverified first preproduction APK."
    aws s3api delete-object \
      --endpoint-url "$endpoint" \
      --bucket "$R2_BUCKET" \
      --key "$latest_key" \
      >/dev/null
    rollback_status=$?
  fi
  if [[ $rollback_status -ne 0 ]]; then
    echo "::error::Failed to roll back the preproduction latest object."
  fi
  return "$rollback_status"
}

handle_exit() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 && "$promoted" == "true" ]]; then
    rollback_latest || true
  fi
  exit "$status"
}
trap handle_exit EXIT

if object_exists "$versioned_key"; then
  echo "Commit-addressed APK already exists; verifying it without overwriting it."
else
  object_status=$?
  if [[ $object_status -ne 1 ]]; then
    exit "$object_status"
  fi
  if ! aws s3api put-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$versioned_key" \
    --body "$apk_path" \
    --if-none-match '*' \
    --content-type application/vnd.android.package-archive \
    --content-disposition 'attachment; filename="windnote-preprod.apk"' \
    --cache-control "public, max-age=31536000, immutable" \
    --metadata "sha256=$apk_sha,package=$expected_package" \
    >/dev/null; then
    object_exists "$versioned_key" || exit 1
  fi
fi

read -r versioned_size versioned_sha versioned_package <<< "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$versioned_key" \
  --query '[ContentLength, Metadata.sha256, Metadata.package]' \
  --output text)"
test "$versioned_size" = "$apk_size"
test "$versioned_sha" = "$apk_sha"
verify_package_attestation "$GITHUB_SHA" "$versioned_package"

aws s3api get-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$versioned_key" \
  "$versioned_download" \
  >/dev/null
printf '%s  %s\n' "$apk_sha" "$versioned_download" | sha256sum -c -
test "$(wc -c < "$versioned_download" | tr -d '[:space:]')" = "$apk_size"

current_main_sha="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)"
if [[ "$current_main_sha" != "$GITHUB_SHA" ]]; then
  echo "::error::Refusing to publish stale commit $GITHUB_SHA; main is $current_main_sha."
  exit 1
fi

if object_exists "$latest_key"; then
  latest_existed=true
  if ! aws s3api copy-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --copy-source "$R2_BUCKET/$latest_key" \
    --key "$rollback_key" \
    --metadata-directive COPY \
    >/dev/null; then
    object_exists "$rollback_key" || exit 1
  fi
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
  --metadata "sha256=$apk_sha,package=$expected_package" \
  >/dev/null

read -r latest_size latest_sha latest_package <<< "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  --query '[ContentLength, Metadata.sha256, Metadata.package]' \
  --output text)"
test "$latest_size" = "$apk_size"
test "$latest_sha" = "$apk_sha"
test "$latest_package" = "$expected_package"

aws s3api get-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  "$latest_download" \
  >/dev/null
printf '%s  %s\n' "$apk_sha" "$latest_download" | sha256sum -c -
test "$(wc -c < "$latest_download" | tr -d '[:space:]')" = "$apk_size"

current_main_sha="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)"
if [[ "$current_main_sha" != "$GITHUB_SHA" ]]; then
  echo "::error::Main advanced to $current_main_sha during promotion; restoring the previous APK."
  exit 1
fi

curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
  --dump-header "$RUNNER_TEMP/r2-preprod-headers.txt" \
  --output "$public_download" \
  "$R2_PUBLIC_APK_URL?build=$GITHUB_SHA"
tr -d '\r' < "$RUNNER_TEMP/r2-preprod-headers.txt" > "$RUNNER_TEMP/r2-preprod-headers-lf.txt"
grep -qi '^content-type: application/vnd.android.package-archive$' \
  "$RUNNER_TEMP/r2-preprod-headers-lf.txt"
grep -qi "^content-length: $apk_size$" \
  "$RUNNER_TEMP/r2-preprod-headers-lf.txt"
printf '%s  %s\n' "$apk_sha" "$public_download" | sha256sum -c -
test "$(wc -c < "$public_download" | tr -d '[:space:]')" = "$apk_size"

current_main_sha="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)"
if [[ "$current_main_sha" != "$GITHUB_SHA" ]]; then
  echo "::error::Main advanced to $current_main_sha during public verification; restoring the previous APK."
  exit 1
fi

promoted=false
if [[ "$latest_existed" == "true" ]]; then
  aws s3api delete-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$rollback_key" \
    >/dev/null || echo "::warning::Could not remove the temporary rollback object."
fi
trap - EXIT
