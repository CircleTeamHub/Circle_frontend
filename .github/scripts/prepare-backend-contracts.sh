#!/usr/bin/env bash
# 把后端 circle_be 放到前端仓库的同级目录，并断言跨仓契约测试依赖的后端源码都在。
#
# test/ 下的跨仓契约测试按 `<前端根>/../circle_be` 读后端源码：找不到时大多静默
# skip，写死读取的则直接 ENOENT。ci.yml 用 actions/checkout 把两个仓库并排放进
# 工作区；安卓工作流的前端就在工作区根目录，而 actions/checkout 不能检出到工作区
# 之外，所以这里浅克隆（circle_be 是公开仓库，不需要凭证）。
#
# 后端分支与 ci.yml 的成对规则一致：BACKEND_REF_CANDIDATE（工作流里传
# github.ref_name）在后端也有同名分支时用它，否则用 main。
# BACKEND_CONTRACTS_DIR 覆盖后端目录，只给本脚本自己的测试用。
set -euo pipefail

readonly BACKEND_REPOSITORY_URL="https://github.com/CircleTeamHub/circle_be.git"

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_dir="${BACKEND_CONTRACTS_DIR:-$(dirname "$frontend_root")/circle_be}"

resolve_ref() {
  local candidate="${BACKEND_REF_CANDIDATE:-}"
  if [[ "$candidate" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$candidate" != main ]] &&
    git ls-remote --exit-code --heads "$BACKEND_REPOSITORY_URL" "$candidate" >/dev/null 2>&1; then
    printf '%s\n' "$candidate"
  else
    printf 'main\n'
  fi
}

if [ ! -d "$backend_dir" ]; then
  ref="$(resolve_ref)"
  git clone --quiet --depth 1 --branch "$ref" "$BACKEND_REPOSITORY_URL" "$backend_dir"
  echo "Checked out circle_be@$ref ($(git -C "$backend_dir" rev-parse --short HEAD))"
fi

missing=0

require_file() {
  if [ ! -f "$backend_dir/$1" ]; then
    echo "::error::circle_be/$1 not found — the contract test pinning it would silently skip or fail with ENOENT"
    missing=1
  fi
}

# 有的契约测试不只看文件在不在，还看生产者符号在不在：后端把那个方法删了或改名，
# 测试同样会退化成 skip。
require_symbol() {
  if ! grep -q "$2" "$backend_dir/$1" 2>/dev/null; then
    echo "::error::circle_be/$1 no longer defines $2 — the contract test pinning it would silently skip"
    missing=1
  fi
}

# 必须是 ci.yml「Assert backend contract sources are present」清单的超集
# （test/workflow-backend-contracts.test.js 守着）。
require_file src/chat/chat.constants.ts
require_file src/chat/chat.types.ts
require_file src/common/app-error-codes.ts
require_file src/realtime/realtime.service.ts
require_symbol src/realtime/realtime.service.ts broadcastMomentsFeedUpdated

[ "$missing" -eq 0 ] || exit 1
echo "OK: backend contract sources present"
