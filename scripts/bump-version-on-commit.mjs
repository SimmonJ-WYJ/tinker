#!/usr/bin/env node
// pre-commit 版本 bump worker。对照 origin/main，凡「本分支有任何文件改过」的 workspace
// （root / apps/* / packages/*），把该 workspace 的 package.json 版本钉到 nextVersionAfter(remote)
//（= remote patch+1，纯数字、无 -rc），改写工作区文件后 `git add`，使 bump 落进本次 commit。
//
// 设计要点：
//   - bump 左移到 commit 时机 —— commit 一次成型，pre-push 不再碰版本号（替代旧 pre-push 守门）。
//   - 触发 = 该 workspace 名下有任意 tracked 文件不同于 origin/main（src 或 package.json 皆算），
//     staged / unstaged 皆算；故纯 src 改动也会自动 bump 其所属包，无需手动碰 package.json。
//   - 幂等：版本一旦严格 > remote 即 noop，重复 commit 不再 bump。
//   - 版本恒为 {N}.{N}.{N} 纯 patch（nextVersionAfter 已 strip 任何 -rc 后缀）。
//   - 决策纯函数复用 verify-version-bump.mjs 的 decideBump（已有完整单测）。
//
// workspace 归属：改动文件路径 → 所属 package.json：
//   apps/<name>/**   → apps/<name>/package.json
//   packages/<name>/** → packages/<name>/package.json
//   其余（仓库根层级文件）→ 根 package.json
//
// 退出码：恒 0 —— bump 是自动修正，绝不阻断提交。
//   写盘失败打印 ERROR 行但仍 exit 0（保守不卡提交；pre-push typecheck/test + CI version-lint 兜底）。
//   离线 / 无 origin/main → 静默跳过（exit 0）。
//   chore/release-* 分支由发版 agent 维护，版本号显式带 -rc.N，禁止 strip → 静默跳过。
//
// 用法（由 .husky/pre-commit 调用，无参数）：node scripts/bump-version-on-commit.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { VERSION_LINE_RX, replaceVersionInLine, nextVersionAfter } from './auto-resolve-version.mjs';
import { decideBump } from './verify-version-bump.mjs';

const BASE_REF = 'origin/main';

// 把改动文件路径映射到其所属 workspace 的 package.json。
//   apps/<name>/** | packages/<name>/** → 该子包 package.json
//   其余（根层级文件）→ 根 package.json
function ownerPackageJson(file) {
  const m = /^((?:apps|packages)\/[^/]+)\//.exec(file);
  return m ? `${m[1]}/package.json` : 'package.json';
}

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

// 读工作区文件当前 .version（即将提交的内容）；读不到 → null。
function versionInWorktree(path) {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
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
  // 无 origin/main（离线 / 未 fetch）→ 跳过，放行 commit。
  try {
    git(['rev-parse', '--verify', BASE_REF]);
  } catch {
    process.exit(0);
  }

  // chore/release-* 分支：发版 agent 流程，版本号是显式 -rc.N，不要被 strip 成纯 patch。
  // 由 /asci-github-release + release-playbook §8.1/§8.2 维护，遵循 R3（tag ↔ package.json.version 严格相等）。
  let branch = '';
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  } catch {
    /* 分支拿不到 → 不豁免，走常规 bump */
  }
  if (branch.startsWith('chore/release-')) process.exit(0);

  // 本分支相对 main 改过的全部文件（两点 diff：当前工作树 vs origin/main，覆盖整条分支分歧）。
  let changed = [];
  try {
    changed = git(['diff', '--name-only', BASE_REF])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    process.exit(0); // diff 失败：保守跳过，不卡提交
  }
  if (changed.length === 0) process.exit(0);

  // 收敛到「有改动的 workspace package.json」集合（去重）。
  const pkgFiles = [...new Set(changed.map(ownerPackageJson))];

  for (const f of pkgFiles) {
    const local = versionInWorktree(f);
    const remote = versionAt(BASE_REF, f);
    if (remote == null || local == null) continue; // 新包 / 无版本 → 跳过

    // 目标版本：
    //   - local 含非数字后缀（如 -rc.N）→ 强制钉到 nextVersionAfter(remote)，确保落到纯 {N}.{N}.{N}
    //     （即便 rc 值数值上已 > remote，也不允许保留非纯格式）。
    //   - 否则交给 decideBump：local 已严格 > remote → noop；未超车 → 钉到 remote patch+1。
    let to;
    if (/-/.test(local)) {
      to = nextVersionAfter(remote);
    } else {
      const d = decideBump({ local, remote });
      if (d.action === 'noop') continue;
      to = d.to;
    }
    if (to === local) continue;
    try {
      rewriteVersion(f, to);
      git(['add', '--', f]); // 让 bump 进入本次 commit
      console.log(`FIXED ${f} ${local} -> ${to}`);
    } catch (e) {
      // 写盘 / add 失败：不静默，但不阻断提交（pre-push + CI 兜底）。
      console.log(`ERROR ${f} (${e.message})`);
    }
  }

  process.exit(0);
}

main();
