#!/usr/bin/env bash

set -euo pipefail

apk_path="${1:?APK path is required}"
checksum_path="${2:?checksum path is required}"

: "${COSCLI_PATH:?COSCLI_PATH is required}"
: "${COS_SECRET_ID:?COS_SECRET_ID is required}"
: "${COS_SECRET_KEY:?COS_SECRET_KEY is required}"
: "${COS_BUCKET:?COS_BUCKET is required}"
: "${COS_ENDPOINT:?COS_ENDPOINT is required}"
: "${COS_KEY_PREFIX:?COS_KEY_PREFIX is required}"
: "${COS_PUBLIC_APK_URL:?COS_PUBLIC_APK_URL is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

test -f "$apk_path"
test -f "$checksum_path"
test -x "$COSCLI_PATH"

versioned_key="${COS_KEY_PREFIX}/builds/${GITHUB_SHA}/windnote.apk"
latest_key="${COS_KEY_PREFIX}/latest/windnote.apk"
rollback_key="${COS_KEY_PREFIX}/rollback/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}/windnote.apk"
apk_sha="$(awk 'NR == 1 { print $1 }' "$checksum_path")"
apk_size="$(wc -c < "$apk_path" | tr -d '[:space:]')"
versioned_download="$RUNNER_TEMP/cos-versioned.apk"
latest_download="$RUNNER_TEMP/cos-latest.apk"
public_download="$RUNNER_TEMP/cos-public.apk"
latest_existed=false
promoted=false

if [[ ! "$apk_sha" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "::error::Invalid APK SHA256 in checksum file."
  exit 1
fi
test "$apk_size" -gt 0

versioned_meta="Content-Type:application/vnd.android.package-archive#Content-Disposition:attachment; filename=windnote-preprod.apk#Cache-Control:public, max-age=31536000, immutable#x-cos-meta-sha256:$apk_sha"
latest_meta="Content-Type:application/vnd.android.package-archive#Content-Disposition:attachment; filename=windnote-preprod.apk#Cache-Control:public, max-age=300#x-cos-meta-sha256:$apk_sha"

cos() {
  "$COSCLI_PATH" "$@" \
    --endpoint "$COS_ENDPOINT" \
    --secret-id "$COS_SECRET_ID" \
    --secret-key "$COS_SECRET_KEY" \
    --init-skip=true \
    --disable-log
}

object_exists() {
  local key="$1"
  local signed_url
  local http_status
  signed_url="$(cos signurl "cos://$COS_BUCKET/$key" --time 300 --simple-output)"
  http_status="$(curl --silent --show-error --location --retry 3 --retry-all-errors \
    --range 0-0 \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$signed_url" || true)"
  case "$http_status" in
    200|206) return 0 ;;
    404) return 1 ;;
    *)
      echo "::error::Tencent COS returned HTTP $http_status while checking $key."
      return 2
      ;;
  esac
}

verify_object() {
  local key="$1"
  local destination="$2"
  local label="$3"
  rm -f "$destination"
  cos cp "cos://$COS_BUCKET/$key" "$destination" \
    --process-log=false \
    --fail-output=false
  printf '%s  %s\n' "$apk_sha" "$destination" | sha256sum -c -
  test "$(wc -c < "$destination" | tr -d '[:space:]')" = "$apk_size"
  echo "Verified $label bytes from Tencent COS."
}

remove_object() {
  local key="$1"
  cos rm "cos://$COS_BUCKET/$key" --force
}

rollback_latest() {
  set +e
  local rollback_status
  if [[ "$latest_existed" == "true" ]]; then
    echo "Restoring the previous preproduction APK after failed verification."
    cos cp "cos://$COS_BUCKET/$rollback_key" "cos://$COS_BUCKET/$latest_key" \
      --acl public-read \
      --process-log=false \
      --fail-output=false
    rollback_status=$?
  else
    echo "Removing the unverified first preproduction APK."
    remove_object "$latest_key"
    rollback_status=$?
  fi
  if [[ $rollback_status -ne 0 ]]; then
    echo "::error::Failed to roll back the Tencent COS preproduction latest object."
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
  if ! cos cp "$apk_path" "cos://$COS_BUCKET/$versioned_key" \
    --acl private \
    --forbid-overwrite=true \
    --meta "$versioned_meta" \
    --process-log=false \
    --fail-output=false; then
    object_exists "$versioned_key" || exit 1
  fi
fi

verify_object "$versioned_key" "$versioned_download" "commit-addressed APK"

if object_exists "$latest_key"; then
  latest_existed=true
  cos cp "cos://$COS_BUCKET/$latest_key" "cos://$COS_BUCKET/$rollback_key" \
    --acl private \
    --forbid-overwrite=true \
    --process-log=false \
    --fail-output=false
else
  object_status=$?
  if [[ $object_status -ne 1 ]]; then
    exit "$object_status"
  fi
fi

cos cp "cos://$COS_BUCKET/$versioned_key" "cos://$COS_BUCKET/$latest_key" \
  --acl public-read \
  --meta "$latest_meta" \
  --process-log=false \
  --fail-output=false
promoted=true

verify_object "$latest_key" "$latest_download" "stable APK"

curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
  --dump-header "$RUNNER_TEMP/cos-preprod-headers.txt" \
  --output "$public_download" \
  "$COS_PUBLIC_APK_URL?build=$GITHUB_SHA"
tr -d '\r' < "$RUNNER_TEMP/cos-preprod-headers.txt" > "$RUNNER_TEMP/cos-preprod-headers-lf.txt"
grep -qi '^content-type: application/vnd.android.package-archive$' \
  "$RUNNER_TEMP/cos-preprod-headers-lf.txt"
grep -qi "^content-length: $apk_size$" \
  "$RUNNER_TEMP/cos-preprod-headers-lf.txt"
printf '%s  %s\n' "$apk_sha" "$public_download" | sha256sum -c -
test "$(wc -c < "$public_download" | tr -d '[:space:]')" = "$apk_size"

trap - EXIT
if [[ "$latest_existed" == "true" ]]; then
  remove_object "$rollback_key" || \
    echo "::warning::Could not remove the temporary Tencent COS rollback object."
fi
