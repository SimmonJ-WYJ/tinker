import { describe, expect, test } from 'bun:test';
import {
  MENTION_DRAG_MIME,
  buildFileMentionPayload,
  parseFileMentionPayloads,
  computeRelPath,
} from './mention-drag-payload';

describe('MENTION_DRAG_MIME', () => {
  test('uses application/x-asci-workspace-file', () => {
    expect(MENTION_DRAG_MIME).toBe('application/x-asci-workspace-file');
  });
});

describe('buildFileMentionPayload', () => {
  test('produces AgentPendingMention shape', () => {
    const p = buildFileMentionPayload({ relPath: 'src/foo.md', name: 'foo.md' });
    expect(p).toEqual({ kind: 'file', id: 'src/foo.md', label: 'foo.md' });
  });
});

describe('parseFileMentionPayloads', () => {
  test('parses single mention as 1-element array', () => {
    const raw = JSON.stringify({ kind: 'file', id: 'a/b.md', label: 'b.md' });
    expect(parseFileMentionPayloads(raw)).toEqual([
      { kind: 'file', id: 'a/b.md', label: 'b.md' },
    ]);
  });
  test('parses array of mentions', () => {
    const raw = JSON.stringify([
      { kind: 'file', id: 'a.md', label: 'a.md' },
      { kind: 'file', id: 'b.md', label: 'b.md' },
    ]);
    expect(parseFileMentionPayloads(raw)).toEqual([
      { kind: 'file', id: 'a.md', label: 'a.md' },
      { kind: 'file', id: 'b.md', label: 'b.md' },
    ]);
  });
  test('skips invalid items in array, keeps valid', () => {
    const raw = JSON.stringify([
      { kind: 'file', id: 'a.md', label: 'a.md' },
      { kind: 'zotero-item', id: 'x', label: 'x' },  // wrong kind
      { kind: 'file', id: '', label: 'b.md' },        // empty id
      { kind: 'file', id: 'c.md', label: 'c.md' },
    ]);
    expect(parseFileMentionPayloads(raw)).toEqual([
      { kind: 'file', id: 'a.md', label: 'a.md' },
      { kind: 'file', id: 'c.md', label: 'c.md' },
    ]);
  });
  test('returns [] for empty string', () => {
    expect(parseFileMentionPayloads('')).toEqual([]);
  });
  test('returns [] for malformed JSON', () => {
    expect(parseFileMentionPayloads('{not json')).toEqual([]);
  });
  test('returns [] for wrong kind', () => {
    const raw = JSON.stringify({ kind: 'zotero-item', id: 'x', label: 'x' });
    expect(parseFileMentionPayloads(raw)).toEqual([]);
  });
  test('returns [] for missing id', () => {
    const raw = JSON.stringify({ kind: 'file', label: 'x' });
    expect(parseFileMentionPayloads(raw)).toEqual([]);
  });
  test('returns [] for empty id', () => {
    const raw = JSON.stringify({ kind: 'file', id: '', label: 'x' });
    expect(parseFileMentionPayloads(raw)).toEqual([]);
  });
  test('returns [] for missing label', () => {
    const raw = JSON.stringify({ kind: 'file', id: 'a' });
    expect(parseFileMentionPayloads(raw)).toEqual([]);
  });
  test('returns [] for empty label', () => {
    const raw = JSON.stringify({ kind: 'file', id: 'a', label: '' });
    expect(parseFileMentionPayloads(raw)).toEqual([]);
  });
});

describe('computeRelPath', () => {
  test('strips project root prefix (POSIX)', () => {
    expect(computeRelPath('/Users/x/proj/src/a.md', '/Users/x/proj'))
      .toBe('src/a.md');
  });
  test('strips trailing slash from root', () => {
    expect(computeRelPath('/Users/x/proj/src/a.md', '/Users/x/proj/'))
      .toBe('src/a.md');
  });
  test('normalizes Windows backslash to POSIX', () => {
    expect(computeRelPath('C:\\Users\\x\\proj\\src\\a.md', 'C:\\Users\\x\\proj'))
      .toBe('src/a.md');
  });
  test('returns null when path not under root', () => {
    expect(computeRelPath('/tmp/other.md', '/Users/x/proj')).toBeNull();
  });
  test('returns null when root is empty', () => {
    expect(computeRelPath('/Users/x/proj/a.md', '')).toBeNull();
  });
  test('returns null when path is empty', () => {
    expect(computeRelPath('', '/Users/x/proj')).toBeNull();
  });
});
