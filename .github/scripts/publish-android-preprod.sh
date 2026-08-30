#!/usr/bin/env bash
set -euo pipefail
test -n "$AWS_ACCESS_KEY_ID"
test -n "$AWS_SECRET_ACCESS_KEY"
test -n "$R2_ACCOUNT_ID"

apk_path="windnote-preprod-v1.0.1.apk"
checksum_path="windnote-preprod-v1.0.1.apk.sha256"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
versioned_key="android/preprod/builds/${GITHUB_SHA}/windnote.apk"
latest_key="android/preprod/latest/windnote.apk"
rollback_key="android/preprod/rollback/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}/windnote.apk"
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

rollback_latest() {
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
  else
    echo "Removing the unverified first preproduction APK."
    aws s3api delete-object \
      --endpoint-url "$endpoint" \
      --bucket "$R2_BUCKET" \
      --key "$latest_key" \
      >/dev/null
  fi
  local rollback_status=$?
  if [[ $rollback_status -ne 0 ]]; then
    echo "::error::Failed to roll back the preproduction latest object."
  fi
  return $rollback_status
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
    --metadata "sha256=$apk_sha" \
    >/dev/null; then
    object_exists "$versioned_key" || exit 1
  fi
fi

read -r versioned_size versioned_sha <<< "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$versioned_key" \
  --query '[ContentLength, Metadata.sha256]' \
  --output text)"
test "$versioned_size" = "$apk_size"
test "$versioned_sha" = "$apk_sha"

aws s3api get-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$versioned_key" \
  "$versioned_download" \
  >/dev/null
printf '%s  %s\n' "$apk_sha" "$versioned_download" | sha256sum -c -
test "$(wc -c < "$versioned_download" | tr -d '[:space:]')" = "$apk_size"

if object_exists "$latest_key"; then
  latest_existed=true
  aws s3api copy-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --copy-source "$R2_BUCKET/$latest_key" \
    --key "$rollback_key" \
    --metadata-directive COPY \
    >/dev/null
else
  object_status=$?
  if [[ $object_status -ne 1 ]]; then
    exit "$object_status"
  fi
fi

aws s3api copy-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --copy-source "$R2_BUCKET/$versioned_key" \
  --key "$latest_key" \
  --metadata-directive REPLACE \
  --content-type application/vnd.android.package-archive \
  --content-disposition 'attachment; filename="windnote-preprod.apk"' \
  --cache-control "public, max-age=300" \
  --metadata "sha256=$apk_sha" \
  >/dev/null
promoted=true

read -r latest_size latest_sha <<< "$(aws s3api head-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  --query '[ContentLength, Metadata.sha256]' \
  --output text)"
test "$latest_size" = "$apk_size"
test "$latest_sha" = "$apk_sha"

aws s3api get-object \
  --endpoint-url "$endpoint" \
  --bucket "$R2_BUCKET" \
  --key "$latest_key" \
  "$latest_download" \
  >/dev/null
printf '%s  %s\n' "$apk_sha" "$latest_download" | sha256sum -c -
test "$(wc -c < "$latest_download" | tr -d '[:space:]')" = "$apk_size"

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

trap - EXIT
if [[ "$latest_existed" == "true" ]]; then
  aws s3api delete-object \
    --endpoint-url "$endpoint" \
    --bucket "$R2_BUCKET" \
    --key "$rollback_key" \
    >/dev/null || echo "::warning::Could not remove the temporary rollback object."
fi
