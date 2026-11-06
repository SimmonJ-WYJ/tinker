import { test, expect } from 'bun:test';
import {
  parse,
  cmp,
  decide,
  fmt,
  resolveFileText,
  decideSemantic,
  resolveSemanticFile,
  nextVersionAfter,
} from './auto-resolve-version.mjs';
import { decideBump } from './verify-version-bump.mjs';

// 构造单个 version 行冲突 hunk。ours/theirs 是 semver 字符串。
function mkHunk(ours, theirs, indent = '  ') {
  return [
    '<<<<<<< HEAD',
    `${indent}"version": "${ours}",`,
    '=======',
    `${indent}"version": "${theirs}",`,
    '>>>>>>> origin/main',
  ].join('\n');
}

function mkFile(hunk) {
  return ['{', '  "name": "@asci/electron",', hunk, '  "private": true', '}'].join('\n');
}

test('parse: bare semver → rcWeight=0', () => {
  expect(parse('0.1.255')).toEqual([0, 1, 255, 0]);
  expect(parse('1.2.3')).toEqual([1, 2, 3, 0]);
});

test('parse: -rc.N → rcWeight=N', () => {
  expect(parse('0.1.255-rc.1')).toEqual([0, 1, 255, 1]);
  expect(parse('0.1.255-rc.99')).toEqual([0, 1, 255, 99]);
});

test('parse rejects malformed semver', () => {
  expect(() => parse('0.1')).toThrow(/invalid semver/);
  expect(() => parse('1.0.0-beta')).toThrow(/invalid semver/);
  expect(() => parse('0.1.2"; rm -rf /')).toThrow(/invalid semver/);
  expect(() => parse('v0.1.2')).toThrow(/invalid semver/);
});

test('cmp: rc.N > bare same X.Y.Z', () => {
  // 0.1.255 < 0.1.255-rc.1 < 0.1.255-rc.2
  expect(cmp(parse('0.1.255'), parse('0.1.255-rc.1'))).toBeLessThan(0);
  expect(cmp(parse('0.1.255-rc.1'), parse('0.1.255'))).toBeGreaterThan(0);
  expect(cmp(parse('0.1.255-rc.2'), parse('0.1.255-rc.1'))).toBeGreaterThan(0);
});

test('cmp: next patch > rc.N of previous', () => {
  // 0.1.255-rc.1 < 0.1.256
  expect(cmp(parse('0.1.255-rc.1'), parse('0.1.256'))).toBeLessThan(0);
});

test('cmp: bare lex', () => {
  expect(cmp(parse('0.1.227'), parse('0.1.228'))).toBeLessThan(0);
  expect(cmp(parse('1.0.0'), parse('0.9.99'))).toBeGreaterThan(0);
});

test('fmt: rcWeight=0 → as-is', () => {
  expect(fmt([0, 1, 228, 0])).toBe('0.1.228');
  expect(fmt([1, 2, 3, 0])).toBe('1.2.3');
});

test('fmt: rcWeight>0 → strip + patch+1', () => {
  expect(fmt([0, 1, 255, 1])).toBe('0.1.256');
  expect(fmt([0, 1, 255, 99])).toBe('0.1.256');
});

test('decide + fmt: strict bigger non-rc wins as-is', () => {
  expect(fmt(decide('0.1.227', '0.1.228'))).toBe('0.1.228');
  expect(fmt(decide('0.1.228', '0.1.227'))).toBe('0.1.228');
});

test('decide + fmt: rc wins over smaller bare → strip + patch+1', () => {
  // 0.1.255-rc.1 vs 0.1.230 → rc wins → 0.1.256
  expect(fmt(decide('0.1.255-rc.1', '0.1.230'))).toBe('0.1.256');
  expect(fmt(decide('0.1.230', '0.1.255-rc.1'))).toBe('0.1.256');
});

test('decide + fmt: rc beats same bare → strip + patch+1', () => {
  // 0.1.255-rc.1 vs 0.1.255 → rc wins → 0.1.256
  expect(fmt(decide('0.1.255-rc.1', '0.1.255'))).toBe('0.1.256');
  expect(fmt(decide('0.1.255', '0.1.255-rc.1'))).toBe('0.1.256');
});

test('decide + fmt: non-rc next patch beats rc → write next patch', () => {
  // 0.1.255-rc.1 vs 0.1.256 → 0.1.256 wins (non-rc) → 0.1.256
  expect(fmt(decide('0.1.255-rc.1', '0.1.256'))).toBe('0.1.256');
});

test('decide + fmt: rc vs rc same bare → larger rc.N wins → strip + patch+1', () => {
  // 0.1.255-rc.2 vs 0.1.255-rc.1 → rc.2 wins → strip → 0.1.256
  expect(fmt(decide('0.1.255-rc.2', '0.1.255-rc.1'))).toBe('0.1.256');
});

test('decide + fmt: rc on older patch vs newer release', () => {
  // 0.1.227-rc.1 vs 0.1.228 → 0.1.228 wins (non-rc, higher patch) → 0.1.228
  expect(fmt(decide('0.1.227-rc.1', '0.1.228'))).toBe('0.1.228');
});

test('resolveFileText resolves a single version hunk', () => {
  const text = mkFile(mkHunk('0.1.227', '0.1.228'));
  const out = resolveFileText(text, 'apps/electron/package.json');
  expect(out).toContain('"version": "0.1.228"');
  expect(out).not.toContain('<<<<<<<');
  expect(out).not.toContain('=======');
  expect(out).not.toContain('>>>>>>>');
});

test('resolveFileText preserves indentation and trailing comma', () => {
  const text = mkFile(mkHunk('0.1.227', '0.1.228', '    '));
  const out = resolveFileText(text, 'x');
  expect(out).toContain('    "version": "0.1.228",');
});

test('resolveFileText handles rc strip + patch+1', () => {
  const text = mkFile(mkHunk('0.1.255-rc.1', '0.1.230'));
  const out = resolveFileText(text, 'x');
  expect(out).toContain('"version": "0.1.256"');
});

test('resolveFileText handles multiple version hunks across one file', () => {
  const text = [
    '{',
    mkHunk('0.1.227', '0.1.228'),
    '  "other": "x",',
    mkHunk('0.1.255-rc.1', '0.1.230'),
    '}',
  ].join('\n');
  const out = resolveFileText(text, 'x');
  expect(out).toContain('"version": "0.1.228"');
  expect(out).toContain('"version": "0.1.256"');
  expect(out).not.toContain('<<<<<<<');
});

test('resolveFileText rejects non-version conflict hunk', () => {
  const text = [
    '{',
    '<<<<<<< HEAD',
    '  "dependencies": { "foo": "1.0.0" }',
    '=======',
    '  "dependencies": { "foo": "2.0.0" }',
    '>>>>>>> origin/main',
    '}',
  ].join('\n');
  expect(() => resolveFileText(text, 'apps/electron/package.json')).toThrow(
    /not a "version" line/,
  );
});

test('resolveFileText rejects multi-line conflict hunk', () => {
  const text = [
    '{',
    '<<<<<<< HEAD',
    '  "version": "0.1.227",',
    '  "extra": "foo",',
    '=======',
    '  "version": "0.1.228",',
    '>>>>>>> origin/main',
    '}',
  ].join('\n');
  expect(() => resolveFileText(text, 'x')).toThrow(/single line/);
});

test('resolveFileText rejects malformed semver inside version line', () => {
  const text = mkFile(mkHunk('0.1', '0.1.228'));
  expect(() => resolveFileText(text, 'x')).toThrow(/invalid semver/);
});

test('resolveFileText rejects unterminated conflict marker', () => {
  const text = ['{', '<<<<<<< HEAD', '  "version": "0.1.227",', '}'].join('\n');
  expect(() => resolveFileText(text, 'x')).toThrow(/unterminated/);
});

test('resolveFileText leaves non-conflict text alone', () => {
  const text = '{\n  "name": "x",\n  "version": "0.1.0"\n}';
  expect(resolveFileText(text, 'x')).toBe(text);
});

// ---- 语义模式（同值碰撞）----

test('decideSemantic: 双方 bump 到同值 → patch+1', () => {
  expect(decideSemantic('0.1.53', '0.1.53', '0.1.52')).toBe('0.1.54');
});

test('decideSemantic: 三者全等（无人改动）→ null', () => {
  expect(decideSemantic('0.1.52', '0.1.52', '0.1.52')).toBeNull();
});

test('decideSemantic: ours != theirs → null（文本路径 / 单方改动）', () => {
  expect(decideSemantic('0.1.53', '0.1.54', '0.1.52')).toBeNull();
  expect(decideSemantic('0.1.54', '0.1.53', '0.1.52')).toBeNull();
  expect(decideSemantic('0.1.52', '0.1.53', '0.1.52')).toBeNull();
});

test('decideSemantic: rc 同值碰撞 → strip + patch+1', () => {
  expect(decideSemantic('0.1.53-rc.2', '0.1.53-rc.2', '0.1.52')).toBe('0.1.54');
});

test('decideSemantic: 非法 semver 抛错（由调用方 warning 跳过）', () => {
  expect(() => decideSemantic('0.1', '0.1', '0.1.52')).toThrow(/invalid semver/);
});

function mkPlainFile(version, indent = '  ') {
  return ['{', '  "name": "@asci/shared",', `${indent}"version": "${version}",`, '  "private": true', '}'].join(
    '\n',
  );
}

test('resolveSemanticFile: 同值碰撞 → 改写为 patch+1，保留缩进与尾逗号', () => {
  const out = resolveSemanticFile(
    mkPlainFile('0.1.53', '    '),
    'packages/shared/package.json',
    '0.1.53',
    '0.1.53',
    '0.1.52',
  );
  expect(out).toContain('    "version": "0.1.54",');
});

test('resolveSemanticFile: 无需改动 → null', () => {
  expect(resolveSemanticFile(mkPlainFile('0.1.53'), 'x', '0.1.53', '0.1.54', '0.1.52')).toBeNull();
  expect(resolveSemanticFile(mkPlainFile('0.1.52'), 'x', '0.1.52', '0.1.52', '0.1.52')).toBeNull();
});

test('resolveSemanticFile: 文件版本与 ours 不符（如已被文本路径改写）→ 抛错跳过', () => {
  // ours==theirs 判定命中，但文件内容已是其他值 → 防御性拒绝
  expect(() => resolveSemanticFile(mkPlainFile('0.2.12'), 'x', '0.1.53', '0.1.53', '0.1.52')).toThrow(
    /!= expected ours/,
  );
});

test('resolveSemanticFile: 无 version 行 → 抛错', () => {
  const text = '{\n  "name": "x"\n}';
  expect(() => resolveSemanticFile(text, 'x', '0.1.53', '0.1.53', '0.1.52')).toThrow(
    /no "version" line/,
  );
});

// ---- nextVersionAfter：严格大于 remote 的下一个 plain 版本 ----

test('nextVersionAfter: plain → patch+1', () => {
  expect(nextVersionAfter('0.1.110')).toBe('0.1.111');
  expect(nextVersionAfter('1.2.3')).toBe('1.2.4');
});

test('nextVersionAfter: rc → strip 后 patch+1', () => {
  expect(nextVersionAfter('0.1.110-rc.3')).toBe('0.1.111');
  expect(nextVersionAfter('0.1.110-rc.99')).toBe('0.1.111');
});

test('nextVersionAfter: 非法 semver 抛错', () => {
  expect(() => nextVersionAfter('0.1')).toThrow(/invalid semver/);
});

test('nextVersionAfter: 结果恒严格大于入参', () => {
  for (const v of ['0.0.0', '0.1.110', '0.1.110-rc.1', '9.9.9', '1.2.3-rc.7']) {
    expect(cmp(parse(nextVersionAfter(v)), parse(v))).toBeGreaterThan(0);
  }
});

// ---- decideBump：pre-push 守门决策 ----

// noop 用例：dirty 一律传 true，证明 noop 不会被 dirty 翻转成 fix。
test('decideBump: 新包（remote 缺失）→ noop', () => {
  expect(decideBump({ local: '0.1.1', remote: null, dirty: true })).toEqual({ action: 'noop' });
});

test('decideBump: local 严格大于 remote → noop', () => {
  expect(decideBump({ local: '0.1.469', remote: '0.1.468', dirty: true })).toEqual({
    action: 'noop',
  });
});

test('decideBump: 非法 semver → noop（保守，CI 兜底）', () => {
  expect(decideBump({ local: 'garbage', remote: '0.1.468', dirty: true })).toEqual({
    action: 'noop',
  });
});

// fix 用例：dirty 透传，干净→10 / 脏→11 由 worker 据此分流。
test('decideBump: local == remote + 干净 → fix(dirty:false)', () => {
  expect(decideBump({ local: '0.1.468', remote: '0.1.468', dirty: false })).toEqual({
    action: 'fix',
    to: '0.1.469',
    dirty: false,
  });
});

test('decideBump: local == remote + 脏 → fix(dirty:true)', () => {
  expect(decideBump({ local: '0.1.468', remote: '0.1.468', dirty: true })).toEqual({
    action: 'fix',
    to: '0.1.469',
    dirty: true,
  });
});

test('decideBump: local < remote（main 已超车）+ 脏 → fix 到 remote+1', () => {
  expect(decideBump({ local: '0.1.460', remote: '0.1.470', dirty: true })).toEqual({
    action: 'fix',
    to: '0.1.471',
    dirty: true,
  });
});

test('decideBump: remote 含 rc + 脏 → fix strip 后 patch+1', () => {
  expect(decideBump({ local: '0.1.468', remote: '0.1.468-rc.2', dirty: true })).toEqual({
    action: 'fix',
    to: '0.1.469',
    dirty: true,
  });
});

test('decideBump: dirty 省略 → fix(dirty:false)（!! 归一化）', () => {
  expect(decideBump({ local: '0.1.468', remote: '0.1.468' })).toEqual({
    action: 'fix',
    to: '0.1.469',
    dirty: false,
  });
});
