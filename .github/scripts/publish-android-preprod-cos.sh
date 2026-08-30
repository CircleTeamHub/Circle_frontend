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
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

test -f "$apk_path"
test -f "$checksum_path"
test -x "$COSCLI_PATH"

case "$COS_PUBLIC_APK_URL" in
  https://*.myqcloud.com/*)
    echo "::error::Tencent COS default domains cannot distribute APK files; configure a custom HTTPS domain."
    exit 1
    ;;
  https://*/android/preprod/latest/windnote.apk) ;;
  *)
    echo "::error::COS_PUBLIC_APK_URL must be a credential-free custom HTTPS URL ending in /android/preprod/latest/windnote.apk."
    exit 1
    ;;
esac
if [[ "$COS_PUBLIC_APK_URL" == *"@"* || "$COS_PUBLIC_APK_URL" == *"?"* || "$COS_PUBLIC_APK_URL" == *"#"* ]]; then
  echo "::error::COS_PUBLIC_APK_URL must not contain credentials, a query, or a fragment."
  exit 1
fi

versioned_key="${COS_KEY_PREFIX}/builds/${GITHUB_SHA}/windnote.apk"
latest_key="${COS_KEY_PREFIX}/latest/windnote.apk"
rollback_key="${COS_KEY_PREFIX}/rollback/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}/windnote.apk"
apk_sha="$(awk 'NR == 1 { print $1 }' "$checksum_path")"
apk_size="$(wc -c < "$apk_path" | tr -d '[:space:]')"
versioned_download="$RUNNER_TEMP/cos-versioned.apk"
latest_download="$RUNNER_TEMP/cos-latest.apk"
previous_download="$RUNNER_TEMP/cos-previous.apk"
public_download="$RUNNER_TEMP/cos-public.apk"
latest_existed=false
rollback_armed=false
previous_sha=""
previous_size=""
previous_meta=""

if [[ ! "$apk_sha" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "::error::Invalid APK SHA256 in checksum file."
  exit 1
fi
test "$apk_size" -gt 0

metadata_for() {
  local sha="$1"
  local cache_control="$2"
  printf '%s' "Content-Type:application/vnd.android.package-archive#Content-Disposition:attachment; filename=windnote-preprod.apk#Cache-Control:${cache_control}#x-cos-meta-sha256:${sha}"
}

versioned_meta="$(metadata_for "$apk_sha" 'public, max-age=31536000, immutable')"
latest_meta="$(metadata_for "$apk_sha" 'public, max-age=300')"

cos() {
  "$COSCLI_PATH" "$@" \
    --endpoint "$COS_ENDPOINT" \
    --secret-id "$COS_SECRET_ID" \
    --secret-key "$COS_SECRET_KEY" \
    --init-skip=true \
    --bucket-type COS \
    --disable-log
}

assert_current_main() {
  local current_main_sha
  current_main_sha="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha)"
  if [[ "$current_main_sha" != "$GITHUB_SHA" ]]; then
    echo "::error::Refusing to publish stale $GITHUB_SHA; current main is $current_main_sha."
    return 1
  fi
}

object_exists() {
  local key="$1"
  local signed_url
  local http_status
  signed_url="$(cos signurl "cos://$COS_BUCKET/$key" --time 300 --simple-output)"
  http_status="$(curl --silent --show-error --location --retry 3 --retry-all-errors \
    --connect-timeout 10 --max-time 60 \
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
  local expected_sha="$3"
  local expected_size="$4"
  local label="$5"
  rm -f "$destination"
  cos cp "cos://$COS_BUCKET/$key" "$destination" \
    --process-log=false \
    --fail-output=false || return 1
  printf '%s  %s\n' "$expected_sha" "$destination" | sha256sum -c - || return 1
  test "$(wc -c < "$destination" | tr -d '[:space:]')" = "$expected_size" || return 1
  echo "Verified $label bytes from Tencent COS."
}

verify_public() {
  local expected_sha="$1"
  local expected_size="$2"
  local nonce="$3"
  local headers="$RUNNER_TEMP/cos-public-headers-${nonce}.txt"
  local headers_lf="$RUNNER_TEMP/cos-public-headers-${nonce}-lf.txt"
  rm -f "$public_download" "$headers" "$headers_lf"
  curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
    --connect-timeout 10 --max-time 300 \
    --dump-header "$headers" \
    --output "$public_download" \
    "$COS_PUBLIC_APK_URL?verification=$nonce" || return 1
  tr -d '\r' < "$headers" > "$headers_lf" || return 1
  grep -qi '^content-type: application/vnd.android.package-archive$' "$headers_lf" || return 1
  grep -qi '^content-disposition: attachment; filename=windnote-preprod.apk$' "$headers_lf" || return 1
  grep -qi '^cache-control: public, max-age=300$' "$headers_lf" || return 1
  grep -qi "^content-length: $expected_size$" "$headers_lf" || return 1
  printf '%s  %s\n' "$expected_sha" "$public_download" | sha256sum -c - || return 1
  test "$(wc -c < "$public_download" | tr -d '[:space:]')" = "$expected_size" || return 1
}

remove_object() {
  local key="$1"
  cos rm "cos://$COS_BUCKET/$key" --force
}

rollback_latest() {
  set +e
  local rollback_status=0
  if [[ "$latest_existed" == "true" ]]; then
    echo "Restoring the previous preproduction APK after failed verification."
    cos cp "$previous_download" "cos://$COS_BUCKET/$latest_key" \
      --acl public-read \
      --meta "$previous_meta" \
      --process-log=false \
      --fail-output=false
    rollback_status=$?
    if [[ $rollback_status -eq 0 ]]; then
      verify_object "$latest_key" "$latest_download" "$previous_sha" "$previous_size" "restored stable APK"
      rollback_status=$?
    fi
    if [[ $rollback_status -eq 0 ]]; then
      verify_public "$previous_sha" "$previous_size" "rollback-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
      rollback_status=$?
    fi
    if [[ $rollback_status -eq 0 ]]; then
      remove_object "$rollback_key"
      rollback_status=$?
    fi
  else
    echo "Removing the unverified first preproduction APK."
    remove_object "$latest_key"
    rollback_status=$?
  fi
  if [[ $rollback_status -ne 0 ]]; then
    echo "::error::Failed to fully verify the Tencent COS preproduction rollback; keeping the private recovery object when available."
  fi
  return "$rollback_status"
}

handle_exit() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 && "$rollback_armed" == "true" ]]; then
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

verify_object "$versioned_key" "$versioned_download" "$apk_sha" "$apk_size" "commit-addressed APK"
assert_current_main

if object_exists "$latest_key"; then
  latest_existed=true
  cos cp "cos://$COS_BUCKET/$latest_key" "$previous_download" \
    --process-log=false \
    --fail-output=false
  previous_sha="$(sha256sum "$previous_download" | awk '{ print $1 }')"
  previous_size="$(wc -c < "$previous_download" | tr -d '[:space:]')"
  previous_meta="$(metadata_for "$previous_sha" 'public, max-age=300')"
  cos cp "$previous_download" "cos://$COS_BUCKET/$rollback_key" \
    --acl private \
    --forbid-overwrite=true \
    --meta "$previous_meta" \
    --process-log=false \
    --fail-output=false
  verify_object "$rollback_key" "$latest_download" "$previous_sha" "$previous_size" "rollback APK"
else
  object_status=$?
  if [[ $object_status -ne 1 ]]; then
    exit "$object_status"
  fi
fi

# The remote copy may commit even if COSCLI loses the response. Arm rollback
# before mutating latest so every ambiguous outcome restores the prior state.
rollback_armed=true
cos cp "cos://$COS_BUCKET/$versioned_key" "cos://$COS_BUCKET/$latest_key" \
  --acl public-read \
  --meta "$latest_meta" \
  --process-log=false \
  --fail-output=false

verify_object "$latest_key" "$latest_download" "$apk_sha" "$apk_size" "stable APK"
verify_public "$apk_sha" "$apk_size" "build-${GITHUB_SHA}"
assert_current_main

rollback_armed=false
trap - EXIT
if [[ "$latest_existed" == "true" ]]; then
  remove_object "$rollback_key" || \
    echo "::warning::Could not remove the temporary Tencent COS rollback object."
fi
