#!/bin/sh
set -eu
# 主进程和前端必须使用相同的免登录构建参数。
cd "$(dirname "$0")/.."
export ASCI_SKIP_LOGIN=1
bun run build
printf '%s\n' '{"loginRequired":false,"profileBundled":false}' > dist/release-mode.json
