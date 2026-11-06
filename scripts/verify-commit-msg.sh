#!/usr/bin/env bash
# 本地 commit-msg 守门 —— 强校验 Conventional Commits 格式（镜像 ADR-000 §3.2）。
# 在 git commit 落盘前拦掉不合规的 message，把规范从「人盯」升级到「机器拦截」，
# 避免 PR review 阶段才被人工打回再 amend。
#
# 真相源：docs/adr/ADR-000-common-convention.md §3.2
#   格式：<type>(<scope>): <subject>，scope 可选，<type> 取自下方白名单
#
# 用法：传入 commit message 文件路径（git 在 commit-msg hook 透传为 $1，
#       即 .git/COMMIT_EDITMSG）；无参数时退化校验该默认文件。
set -euo pipefail

MSG_FILE="${1:-.git/COMMIT_EDITMSG}"

# ADR-000 §3.2 的 type 白名单（前 7 项是 repo 实际高频集合，按 git log）
TYPES="feat|fix|chore|refactor|docs|ci|revert|test|perf|style"

# Conventional Commits 主体正则：
#   ^(<type>)        —— 白名单 type
#   (\([^)]+\))?     —— 可选 scope
#   !?               —— 可选 breaking change 标记（如 feat!:）
#   :\               —— 冒号 + 空格
#   .+               —— 非空 subject
PATTERN="^(${TYPES})(\([^)]+\))?!?: .+"

if [ ! -f "$MSG_FILE" ]; then
  echo "❌ 找不到 commit message 文件：$MSG_FILE"
  exit 1
fi

# 取首行有效内容作为 subject：跳过 git 注释行（# 开头）与空行
subject=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    \#*) continue ;;   # git 注释行
    "")  continue ;;   # 空行
    *)   subject="$line"; break ;;
  esac
done < "$MSG_FILE"

if [ -z "$subject" ]; then
  echo "❌ commit message 为空。"
  exit 1
fi

# 豁免 git 自动生成的特殊 message（不强制 Conventional Commits 格式）：
#   - merge commit（git merge 默认）
#   - revert 默认 message（注意：手写 revert(scope): 仍走白名单 type 校验）
#   - rebase autosquash 的 fixup! / squash!（最终会被压回目标 commit）
case "$subject" in
  "Merge "*)   echo "✅ merge commit，跳过格式校验。"; exit 0 ;;
  "Revert \""*) echo "✅ revert commit，跳过格式校验。"; exit 0 ;;
  "fixup! "*)  echo "✅ autosquash fixup，跳过格式校验。"; exit 0 ;;
  "squash! "*) echo "✅ autosquash squash，跳过格式校验。"; exit 0 ;;
esac

if [[ "$subject" =~ $PATTERN ]]; then
  echo "✅ commit message 符合 Conventional Commits。"
  exit 0
fi

echo "❌ commit message 不符合 Conventional Commits 规范（ADR-000 §3.2）。"
echo ""
echo "   收到：$subject"
echo ""
echo "   要求格式：<type>(<scope>): <subject>"
echo "   允许 type：${TYPES//|/ / }"
echo "   scope 可选；breaking change 可加 ! （如 feat!:）"
echo ""
echo "   ✅ 正确示例："
echo "      feat(lit-search): 全源捕获 venue"
echo "      fix: 修复登录态丢失"
echo "      feat!: 重命名 IPC 通道"
echo "   ❌ 错误示例："
echo "      update readme        （缺 type）"
echo "      Feature: xxx         （type 非小写白名单）"
exit 1
