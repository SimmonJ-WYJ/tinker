#!/usr/bin/env node
// 解析 package.json 的 "version" 冲突并落盘。两种模式：
//
// 文本模式（git merge conflict hunk）：
//   node auto-resolve-version.mjs <unmerged-list-file>
//   <unmerged-list-file> 每行一个 unmerged 路径，由 workflow 通过
//   `git diff --name-only --diff-filter=U > /tmp/unmerged.txt` 产出。
//   决策规则（见 docs/plan）：
//     1. 排序：X.Y.Z < X.Y.Z-rc.N < X.Y.Z-rc.(N+1) < X.(Y).(Z+1)。
//        即 rc.N 视为「即将发布的下一个 patch 的候选」，比同 bare 的 release 大，
//        但仍小于下一个 patch 的 release。
//     2. 比较 (M, m, p, rcWeight) 元组，rcWeight = 0（无 rc） 或 N（-rc.N）。
//     3. 取大者：若 winner 含 rc → 写 patch+1（去掉 rc）；否则原样写。
//     4. 任一 hunk 不是纯 "version" 单行 → process.exit(2)，由 workflow 中止。
//
// 语义模式（同值碰撞，git 干净合并探测不到）：
//   node auto-resolve-version.mjs --semantic <list-file>
//   <list-file> 每行：<path>\t<oursVersion>\t<theirsVersion>\t<baseVersion>
//   （ours = PR head 版本，theirs = base 分支当前版本，base = merge-base 版本，
//   三者均为合并前采集——文本冲突路径改写过的文件因 ours != theirs 自然跳过，
//   不会被二次 bump）。判定：
//     ours == theirs != base → 双方各自 bump 到同一版本号，bump 被吞 → 写 patch+1
//     （含 rc 时 strip 后 patch+1）；其余情形跳过（文本路径已覆盖或无人改动）。
//   语义模式失败（缺字段 / 非法 semver / 文件内容与 ours 不符）只 warning 跳过、
//   不中止——维持现状即原行为。

import { readFileSync, writeFileSync } from 'node:fs';

const SEMVER_RX = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;
export const VERSION_LINE_RX = /^\s*"version"\s*:\s*"([^"]+)"\s*,?\s*$/;

// 解析为 (M, m, p, rcWeight) 元组。无 rc → rcWeight = 0。
export function parse(v) {
  const m = SEMVER_RX.exec(v);
  if (!m) throw new Error(`invalid semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 0 : Number(m[4])];
}

// 4 元素 lex 比较。
export function cmp(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// 把 winner 元组转成最终写入文件的 plain X.Y.Z。
// rcWeight > 0 → strip rc 并 patch+1（rc 是下一个 patch 的候选）。
// rcWeight = 0 → 原样写。
export function fmt([M, m, p, rc]) {
  return rc > 0 ? `${M}.${m}.${p + 1}` : `${M}.${m}.${p}`;
}

export function decide(ours, theirs) {
  const A = parse(ours);
  const B = parse(theirs);
  return cmp(A, B) >= 0 ? A : B;
}

// 把一行中的 "version": "<x>" 替换为目标版本，保留缩进与尾逗号。
export function replaceVersionInLine(line, next) {
  return line.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`);
}

// 给定 remote main 上的版本，返回本地应持有的「严格大于它」的下一个 plain 版本。
// 规则：含 rc → strip rc 后 patch+1；plain → patch+1。两种情形都落到下一个 plain
// patch（rc.N 是「当前 patch 的候选」，比同 bare release 大但小于下一个 patch release，
// 见 cmp 语义），故均为 patch+1，恒严格大于入参。
// 注意：与 fmt 语义不同 —— fmt 用于「winner 已超过对方」的场景（plain 不再 +1），
// 这里要的是「严格大于 remote」，故 plain 也必须 +1。
export function nextVersionAfter(remoteVersion) {
  const [M, m, p] = parse(remoteVersion);
  return `${M}.${m}.${p + 1}`;
}

// 解析单个文件的全部 conflict hunk。返回新文件内容字符串。
// 任一 hunk 非纯 version 单行 → 抛错（调用方退出码 2）。
export function resolveFileText(text, filePath) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let sep = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (sep < 0 && lines[j].startsWith('=======')) sep = j;
      else if (lines[j].startsWith('>>>>>>>')) {
        end = j;
        break;
      }
    }
    if (sep < 0 || end < 0) {
      throw new Error(`${filePath}: unterminated conflict marker`);
    }
    const oursLines = lines.slice(i + 1, sep);
    const theirsLines = lines.slice(sep + 1, end);
    const oursContent = oursLines.filter((l) => l.trim() !== '');
    const theirsContent = theirsLines.filter((l) => l.trim() !== '');
    if (oursContent.length !== 1 || theirsContent.length !== 1) {
      throw new Error(`${filePath}: conflict hunk is not a single line`);
    }
    const oursMatch = VERSION_LINE_RX.exec(oursContent[0]);
    const theirsMatch = VERSION_LINE_RX.exec(theirsContent[0]);
    if (!oursMatch || !theirsMatch) {
      throw new Error(`${filePath}: conflict hunk is not a "version" line`);
    }
    const winner = decide(oursMatch[1], theirsMatch[1]);
    // 以 ours 侧行为模板替换，保留缩进与可能的尾逗号。
    out.push(replaceVersionInLine(oursContent[0], fmt(winner)));
    i = end + 1;
  }
  return out.join('\n');
}

// 语义判定：ours == theirs != base → 同值碰撞 → patch+1（恒 strip rc）；其余 → null。
export function decideSemantic(ours, theirs, base) {
  if (ours !== theirs) return null; // 双方不同值 → 文本冲突路径 / 单方改动，均无需处理
  if (ours === base) return null; // 三者全等 → 无人改动
  const [M, m, p] = parse(ours); // rcWeight 不参与：同值碰撞一律 patch+1 并 strip rc
  return `${M}.${m}.${p + 1}`;
}

// 语义模式的单文件改写：按合并前采集的 (ours, theirs, base) 三元组判定，
// 改写文件首个 "version" 行。无需改动 → 返回 null；需要改动 → 返回新文件内容。
// 防御：文件当前版本与 ours 不符（如被其他路径改写过）→ 抛错，由调用方 warning 跳过。
export function resolveSemanticFile(text, filePath, ours, theirs, base) {
  const next = decideSemantic(ours, theirs, base);
  if (next == null) return null;
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => VERSION_LINE_RX.test(l));
  if (idx < 0) throw new Error(`${filePath}: no "version" line found`);
  const current = VERSION_LINE_RX.exec(lines[idx])[1];
  if (current !== ours) {
    throw new Error(`${filePath}: file version "${current}" != expected ours "${ours}"`);
  }
  lines[idx] = replaceVersionInLine(lines[idx], next);
  return lines.join('\n');
}

function mainTextual(listFile) {
  const files = readFileSync(listFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (files.length === 0) {
    console.error('::error::no unmerged files to process');
    process.exit(2);
  }
  for (const file of files) {
    try {
      const raw = readFileSync(file, 'utf8');
      const resolved = resolveFileText(raw, file);
      writeFileSync(file, resolved);
      console.log(`resolved ${file}`);
    } catch (e) {
      console.error(`::error::${e.message}`);
      process.exit(2);
    }
  }
}

function mainSemantic(listFile) {
  const entries = readFileSync(listFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [file, ours, theirs, base] = entry.split('\t');
    if (!file || !ours || !theirs || !base) {
      console.error(`::warning::semantic: malformed entry skipped: ${entry}`);
      continue;
    }
    try {
      const raw = readFileSync(file, 'utf8');
      const resolved = resolveSemanticFile(raw, file, ours, theirs, base);
      if (resolved == null) continue;
      writeFileSync(file, resolved);
      console.log(`bumped ${file}`);
    } catch (e) {
      // 语义模式保守跳过：失败 = 维持现状（即原本就会发生的干净合并结果）。
      console.error(`::warning::semantic: ${e.message} (skipped)`);
    }
  }
}

function main() {
  const semantic = process.argv[2] === '--semantic';
  const listFile = semantic ? process.argv[3] : process.argv[2];
  if (!listFile) {
    console.error(
      '::error::usage: auto-resolve-version.mjs <unmerged-list-file> | --semantic <triples-list-file>',
    );
    process.exit(2);
  }
  if (semantic) mainSemantic(listFile);
  else mainTextual(listFile);
}

// 仅在直接执行时跑 main；被 test 文件 import 时不执行。
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
