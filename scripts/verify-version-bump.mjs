#!/usr/bin/env node
// 版本守门 worker（CLI 历史上由 pre-push 调用）。对照 remote main，凡本分支改过的 workspace
// package.json，若本地版本未严格大于 main 上的版本，就把工作区文件改写成 nextVersionAfter(remote)。
//
// 现状：版本 bump 已左移到 pre-commit（scripts/bump-version-on-commit.mjs），后者复用本文件
// 导出的纯决策函数 decideBump。下方 main() CLI 不再被任何 hook 调用，保留供手动核对 / 测试。
//
// 角色：只做 git 读 + 决策 + 改写 worktree 文件；不碰 index / 不 commit ——
// 提交与否（按工作区脏/干净分流）由调用方在有 ref 上下文处掌控。
//
// 用法：node scripts/verify-version-bump.mjs <baseRef> <localSha>
//   baseRef  = origin/main（hook 已 fetch）
//   localSha = git 即将推送的本地 sha
//
// 分流维度 = 受影响 package.json 的工作区脏/干净（per-file `git status --porcelain`）：
//   干净（已提交）→ 改写后由 hook 新建 chore commit（exit 10）。
//   脏（有未提交改动）→ 改写后只留工作区、hook 不 add/不 commit，让用户折进自己的 commit（exit 11）。
// 注意：版本恒被改写为 nextVersionAfter(remote)（严格大于 remote main），即便工作区已被用户手改过——
//   FIXED 行暴露 from->to，hook 文案再点明用户值已被替换。
//
// 退出码协议（供 hook 消费）：
//   0  无事可做（无改动包，或全部已严格大于 remote）→ 放行。
//   10 已改写工作区（至少一个文件），且受影响文件全部干净 → hook 新建 chore commit。
//   11 已改写工作区，且至少一个受影响文件脏 → hook 不 add/不 commit（保守：任一文件正在编辑就不自动 commit）。
//      10/11 两态 stdout 均每改一文件打一行：FIXED <path> <from> -> <to>
//   2  异常（非法用法 / 改写落盘失败等）。

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse, cmp, VERSION_LINE_RX, nextVersionAfter, replaceVersionInLine } from './auto-resolve-version.mjs';

// 仅这些路径算 workspace package.json（根 + apps/* + packages/*）。
const PKG_RX = /^(package\.json|(apps|packages)\/[^/]+\/package\.json)$/;

// 跑 git；失败抛错（调用方按需吞）。
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

// 读某 ref 下某文件的 .version；文件不存在 / 无 version → null。
function versionAt(ref, path) {
  let raw;
  try {
    raw = git(['show', `${ref}:${path}`]);
  } catch {
    return null; // ref 下无此文件（如 main 上新包还不存在）
  }
  try {
    const v = JSON.parse(raw).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

// 该路径是否有未提交改动（staged 或 unstaged）。git 失败保守按「干净」处理（不阻断 push）。
function isPathDirty(path) {
  try {
    return git(['status', '--porcelain', '--', path]).trim() !== '';
  } catch {
    return false;
  }
}

// 纯决策函数（可单测，不碰 git / fs）：
//   local  = 待推 commit 里的版本
//   remote = origin/main 里的版本（null = 新包，main 上不存在）
//   dirty  = 受影响 package.json 工作区是否脏（决定 hook 提交与否，透传不参与是否 fix 的判断）
// 返回 { action: 'noop' } 或 { action: 'fix', to, dirty }。
export function decideBump({ local, remote, dirty }) {
  if (remote == null) return { action: 'noop' }; // 新包：main 上无可比对象
  if (local == null) return { action: 'noop' }; // 待推 commit 无版本，跳过
  let localT;
  let remoteT;
  try {
    localT = parse(local);
    remoteT = parse(remote);
  } catch {
    return { action: 'noop' }; // 非法 semver → 保守跳过，CI version-lint 兜底
  }
  if (cmp(localT, remoteT) > 0) return { action: 'noop' }; // 已严格大于 remote
  return { action: 'fix', to: nextVersionAfter(remote), dirty: !!dirty };
}

// 改写工作区文件首个 version 行为 to，保留缩进 / 尾逗号。
function rewriteVersion(path, to) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const idx = lines.findIndex((l) => VERSION_LINE_RX.test(l));
  if (idx < 0) throw new Error(`${path}: no "version" line`);
  lines[idx] = replaceVersionInLine(lines[idx], to);
  writeFileSync(path, lines.join('\n'));
}

function main() {
  const baseRef = process.argv[2];
  const localSha = process.argv[3];
  if (!baseRef || !localSha) {
    console.error('::error::usage: verify-version-bump.mjs <baseRef> <localSha>');
    process.exit(2);
  }

  // 本分支相对 main 改过的文件（三点 diff：取我方自 merge-base 以来的改动）。
  let changed = [];
  try {
    changed = git(['diff', '--name-only', `${baseRef}...${localSha}`])
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => PKG_RX.test(l));
  } catch (e) {
    console.error(`::warning::diff failed (${e.message}); skipping version check`);
    process.exit(0);
  }
  if (changed.length === 0) process.exit(0);

  let anyFixed = false;
  let anyDirty = false;
  let errored = false;
  for (const f of changed) {
    const local = versionAt(localSha, f);
    const remote = versionAt(baseRef, f);
    const dirty = isPathDirty(f);
    const d = decideBump({ local, remote, dirty });
    if (d.action === 'noop') continue;
    // fix：改写工作区版本行。脏文件汇总到 anyDirty → hook 整体走 11（不自动 commit）。
    try {
      rewriteVersion(f, d.to);
      console.log(`FIXED ${f} ${local} -> ${d.to}`);
      anyFixed = true;
      anyDirty = anyDirty || d.dirty;
    } catch (e) {
      // 落盘失败：文件可能半改，不静默跳过，整体走错误码 2 让用户介入。
      console.log(`ERROR ${f} (${e.message})`);
      errored = true;
    }
  }

  if (errored) process.exit(2);
  if (anyFixed) process.exit(anyDirty ? 11 : 10);
  process.exit(0);
}

// 仅直接执行时跑 main；被 test import 时不执行。
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
