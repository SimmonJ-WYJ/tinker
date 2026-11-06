#!/bin/bash
# 用户确认的 Tinker A 版图标；依赖项目已有的 Bun 和 sharp。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
bun run scripts/generate-brand-icons.ts
