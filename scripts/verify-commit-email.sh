#!/usr/bin/env bash
# 本地预推送邮箱守门 —— 镜像 CI 的 OPENSCI-Labs/.github verify-commit-email.yml 规则，
# 在 push 前就拦掉非法 author/committer 邮箱，避免推上去后 CI Status 才红、再返工 rebase。
#
# 允许的邮箱形态（与 CI 严格一致）：
#   1. <任意>@opensci.io                         —— 公司域名
#   2. <id>+<user>@users.noreply.github.com      —— GitHub 个人 noreply（隐私邮箱）
#   3. 白名单 bot：dependabot[bot] / github-actions[bot]@users.noreply.github.com
#
# 用法：传入待校验的 commit 范围（如 "$base..$head"）；无参数时校验 HEAD 单个 commit。
set -euo pipefail

ALLOWED_DOMAIN="opensci.io"
GITHUB_MERGE_EMAIL="noreply@github.com"   # GitHub UI squash/merge 生成，仅 committer 可接受
ALLOWED_BOTS="dependabot[bot]@users.noreply.github.com github-actions[bot]@users.noreply.github.com"

RANGE="${1:-HEAD -1}"

# 个人 noreply：<id>+<user>@users.noreply.github.com
is_personal_noreply_email() {
  [[ "$1" =~ ^[0-9]+\+[A-Za-z0-9_.-]+@users\.noreply\.github\.com$ ]]
}

# GitHub UI 合并 commit 的 committer（noreply@github.com），仅 committer 侧接受
is_github_merge_email() {
  [ "$1" = "$GITHUB_MERGE_EMAIL" ]
}

# 白名单 bot：去掉 "<id>+" 前缀后比对
is_whitelisted_bot_email() {
  local email="$1" normalized="$1" bot
  if [[ "$email" =~ ^[0-9]+\+(.+@users\.noreply\.github\.com)$ ]]; then
    normalized="${BASH_REMATCH[1]}"
  fi
  for bot in $ALLOWED_BOTS; do
    [ "$normalized" = "$bot" ] && return 0
  done
  return 1
}

# author 侧允许：公司域 / 个人 noreply / 白名单 bot（不接受 merge email）
is_allowed_author_email() {
  local email="$1"
  [[ "$email" == *@${ALLOWED_DOMAIN} ]] && return 0
  is_personal_noreply_email "$email" && return 0
  is_whitelisted_bot_email "$email" && return 0
  return 1
}

# committer 侧在 author 规则基础上额外接受 GitHub merge email
is_allowed_committer_email() {
  is_github_merge_email "$1" && return 0
  is_allowed_author_email "$1"
}

# shellcheck disable=SC2086
COMMITS=$(git rev-list $RANGE 2>/dev/null || true)
[ -z "$COMMITS" ] && { echo "✅ 无待校验 commit。"; exit 0; }

bad=0
while read -r sha; do
  [ -z "$sha" ] && continue
  author=$(git show -s --format='%ae' "$sha")
  committer=$(git show -s --format='%ce' "$sha")
  if ! is_allowed_author_email "$author"; then
    echo "❌ Commit ${sha:0:8} author 邮箱不允许：$author"
    bad=1
  fi
  if ! is_allowed_committer_email "$committer"; then
    echo "❌ Commit ${sha:0:8} committer 邮箱不允许：$committer"
    bad=1
  fi
done <<< "$COMMITS"

if [ "$bad" -ne 0 ]; then
  echo ""
  echo "所有 commit 必须用 @${ALLOWED_DOMAIN} 公司邮箱。修复："
  echo "  1. 设置邮箱：     git config user.email \"you@${ALLOWED_DOMAIN}\""
  echo "  2. 重写已有 commit：git rebase -i <bad>^ → 标记 edit →"
  echo "                    git commit --amend --author=\"Name <you@${ALLOWED_DOMAIN}>\" --no-edit"
  echo "                    git rebase --continue"
  echo "  （GitHub 个人 noreply <id>+<user>@users.noreply.github.com 同样接受）"
  exit 1
fi

echo "✅ 全部 commit 均用合规邮箱。"
