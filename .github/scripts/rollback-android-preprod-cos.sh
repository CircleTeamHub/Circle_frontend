#!/usr/bin/env bash

set -euo pipefail

rollback_sha="${1:-}"
if [[ ! "$rollback_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: rollback-android-preprod-cos.sh <40-character-main-sha>" >&2
  exit 2
fi

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

expected_package="com.yiboding.circleim.preprod"
identity_cutover_sha="e09582dc7583fb7b69600e231dd76eb792d122f5"
versioned_key="${COS_KEY_PREFIX}/builds/${rollback_sha}/windnote.apk"
latest_key="${COS_KEY_PREFIX}/latest/windnote.apk"
rollback_key="${COS_KEY_PREFIX}/rollback/manual-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}/windnote.apk"
temp_dir="$(mktemp -d)"
source_download="$temp_dir/source.apk"
latest_download="$temp_dir/latest.apk"
previous_download="$temp_dir/previous.apk"
public_download="$temp_dir/public.apk"
latest_existed=false
rollback_armed=false
previous_sha=""
previous_size=""
previous_meta=""

metadata_for() {
  local sha="$1"
  local cache_control="$2"
  printf '%s' "Content-Type:application/vnd.android.package-archive#Content-Disposition:attachment; filename=windnote-preprod.apk#Cache-Control:${cache_control}#x-cos-meta-sha256:${sha}#x-cos-meta-package:${expected_package}"
}

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
    echo "::error::Refusing to roll back from stale workflow commit $GITHUB_SHA; current main is $current_main_sha."
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
  rm -f "$destination"
  cos cp "cos://$COS_BUCKET/$key" "$destination" \
    --process-log=false \
    --fail-output=false
  printf '%s  %s\n' "$expected_sha" "$destination" | sha256sum -c -
  test "$(wc -c < "$destination" | tr -d '[:space:]')" = "$expected_size"
}

verify_object_headers() {
  local key="$1"
  local expected_sha="$2"
  local expected_size="$3"
  local expected_cache_control="$4"
  local label="$5"
  local signed_url
  local headers="$temp_dir/${label}-headers.txt"
  local headers_lf="$temp_dir/${label}-headers-lf.txt"
  signed_url="$(cos signurl "cos://$COS_BUCKET/$key" --time 300 --simple-output)"
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    --connect-timeout 10 --max-time 60 \
    --head \
    --dump-header "$headers" \
    --output /dev/null \
    "$signed_url"
  tr -d '\r' < "$headers" > "$headers_lf"
  grep -qi '^content-type: application/vnd.android.package-archive$' "$headers_lf"
  grep -qi '^content-disposition: attachment; filename=windnote-preprod.apk$' "$headers_lf"
  grep -qi "^cache-control: ${expected_cache_control}$" "$headers_lf"
  grep -qi "^content-length: ${expected_size}$" "$headers_lf"
  grep -qi "^x-cos-meta-sha256: ${expected_sha}$" "$headers_lf"
  grep -qi "^x-cos-meta-package: ${expected_package}$" "$headers_lf"
}

verify_public() {
  local expected_sha="$1"
  local expected_size="$2"
  local nonce="$3"
  local headers="$temp_dir/public-${nonce}-headers.txt"
  local headers_lf="$temp_dir/public-${nonce}-headers-lf.txt"
  rm -f "$public_download" "$headers" "$headers_lf"
  curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
    --connect-timeout 10 --max-time 300 \
    --dump-header "$headers" \
    --output "$public_download" \
    "$COS_PUBLIC_APK_URL?rollback=$nonce"
  tr -d '\r' < "$headers" > "$headers_lf"
  grep -qi '^content-type: application/vnd.android.package-archive$' "$headers_lf"
  grep -qi '^content-disposition: attachment; filename=windnote-preprod.apk$' "$headers_lf"
  grep -qi '^cache-control: public, max-age=300$' "$headers_lf"
  grep -qi "^content-length: $expected_size$" "$headers_lf"
  printf '%s  %s\n' "$expected_sha" "$public_download" | sha256sum -c -
  test "$(wc -c < "$public_download" | tr -d '[:space:]')" = "$expected_size"
}

remove_object() {
  local key="$1"
  cos rm "cos://$COS_BUCKET/$key" --force
}

rollback_latest() {
  local rollback_status=0
  set +e
  if [[ "$latest_existed" == "true" ]]; then
    cos cp "$previous_download" "cos://$COS_BUCKET/$latest_key" \
      --acl public-read \
      --meta "$previous_meta" \
      --process-log=false \
      --fail-output=false
    rollback_status=$?
    if [[ $rollback_status -eq 0 ]]; then
      verify_object "$latest_key" "$latest_download" "$previous_sha" "$previous_size"
      rollback_status=$?
    fi
    if [[ $rollback_status -eq 0 ]]; then
      verify_object_headers "$latest_key" "$previous_sha" "$previous_size" 'public, max-age=300' restored
      rollback_status=$?
    fi
    if [[ $rollback_status -eq 0 ]]; then
      verify_public "$previous_sha" "$previous_size" "restore-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
      rollback_status=$?
    fi
    if [[ $rollback_status -eq 0 ]]; then
      remove_object "$rollback_key"
      rollback_status=$?
    fi
  else
    remove_object "$latest_key"
    rollback_status=$?
  fi
  if [[ $rollback_status -ne 0 ]]; then
    echo "::error::Failed to restore the pre-rollback Tencent COS object; keeping the private recovery object when available."
  fi
  return "$rollback_status"
}

handle_exit() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 && "$rollback_armed" == "true" ]]; then
    rollback_latest || true
  fi
  rm -rf "$temp_dir"
  exit "$status"
}
trap handle_exit EXIT

if object_exists "$versioned_key"; then
  :
else
  object_status=$?
  if [[ $object_status -eq 1 ]]; then
    echo "::error::No verified Tencent COS APK exists for $rollback_sha."
  fi
  exit "$object_status"
fi

comparison_status="$(gh api \
  "repos/${GITHUB_REPOSITORY}/compare/${identity_cutover_sha}...${rollback_sha}" \
  --jq .status)"
if [[ "$comparison_status" != "ahead" && "$comparison_status" != "identical" ]]; then
  echo "::error::Rollback source is not at or after the preproduction package identity cutover."
  exit 1
fi

source_signed_url="$(cos signurl "cos://$COS_BUCKET/$versioned_key" --time 300 --simple-output)"
source_headers="$temp_dir/source-headers.txt"
curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
  --connect-timeout 10 --max-time 60 \
  --head \
  --dump-header "$source_headers" \
  --output /dev/null \
  "$source_signed_url"
source_headers_lf="$temp_dir/source-headers-lf.txt"
tr -d '\r' < "$source_headers" > "$source_headers_lf"
source_sha="$(sed -nE 's/^x-cos-meta-sha256:[[:space:]]*([[:xdigit:]]{64})[[:space:]]*$/\1/ip' "$source_headers_lf" | head -n 1 | tr '[:upper:]' '[:lower:]')"
source_size="$(sed -nE 's/^content-length:[[:space:]]*([0-9]+)[[:space:]]*$/\1/ip' "$source_headers_lf" | head -n 1)"
[[ "$source_sha" =~ ^[0-9a-f]{64}$ ]]
[[ "$source_size" =~ ^[0-9]+$ ]]
test "$source_size" -gt 0
verify_object_headers \
  "$versioned_key" \
  "$source_sha" \
  "$source_size" \
  'public, max-age=31536000, immutable' \
  source
verify_object "$versioned_key" "$source_download" "$source_sha" "$source_size"
assert_current_main

if object_exists "$latest_key"; then
  latest_existed=true
  cos cp "cos://$COS_BUCKET/$latest_key" "$previous_download" \
    --process-log=false \
    --fail-output=false
  previous_sha="$(sha256sum "$previous_download" | awk '{ print $1 }')"
  previous_size="$(wc -c < "$previous_download" | tr -d '[:space:]')"
  previous_meta="$(metadata_for "$previous_sha" 'public, max-age=300')"
  if ! cos cp "$previous_download" "cos://$COS_BUCKET/$rollback_key" \
    --acl private \
    --forbid-overwrite=true \
    --meta "$previous_meta" \
    --process-log=false \
    --fail-output=false; then
    object_exists "$rollback_key" || exit 1
  fi
  verify_object "$rollback_key" "$latest_download" "$previous_sha" "$previous_size"
else
  object_status=$?
  if [[ $object_status -ne 1 ]]; then
    exit "$object_status"
  fi
fi

latest_meta="$(metadata_for "$source_sha" 'public, max-age=300')"
rollback_armed=true
cos cp "$source_download" "cos://$COS_BUCKET/$latest_key" \
  --acl public-read \
  --meta "$latest_meta" \
  --process-log=false \
  --fail-output=false

assert_current_main
verify_object "$latest_key" "$latest_download" "$source_sha" "$source_size"
verify_object_headers "$latest_key" "$source_sha" "$source_size" 'public, max-age=300' latest
verify_public "$source_sha" "$source_size" "$rollback_sha"
assert_current_main

rollback_armed=false
trap - EXIT
if [[ "$latest_existed" == "true" ]]; then
  remove_object "$rollback_key" || \
    echo "::warning::Could not remove the temporary Tencent COS rollback object."
fi
rm -rf "$temp_dir"
echo "Restored Tencent COS preproduction latest to $rollback_sha ($source_sha)."
