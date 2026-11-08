#!/usr/bin/env bash
# Skia 的 postinstall 从 GitHub Releases 下载预编译包,遇到 5xx 不重试。
# npm ci 时用 SKIP_SKIA_DOWNLOAD 跳过它,需要这些文件的任务在这里带重试单独下载。
set -uo pipefail

script="node_modules/@shopify/react-native-skia/scripts/install-skia.mjs"
max_attempts="${SKIA_INSTALL_ATTEMPTS:-5}"
base_delay="${SKIA_INSTALL_RETRY_DELAY_SECONDS:-30}"

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if env -u SKIP_SKIA_DOWNLOAD node "$script"; then
    exit 0
  fi
  if ((attempt < max_attempts)); then
    delay=$((base_delay * attempt))
    echo "Skia download failed (attempt ${attempt}/${max_attempts}), retrying in ${delay}s"
    sleep "$delay"
  fi
done

echo "::error::Skia binaries could not be downloaded after ${max_attempts} attempts"
exit 1
