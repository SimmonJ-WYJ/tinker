<a id="长文本粘贴折叠为-pasted-卡片-specpasted-text-collapse"></a>

# Collapse long pasted text into PASTED cards Spec (Pasted-Text Collapse)

> **Status**: Draft · Implementation pending
> **Related issue**: (to be added)
> **Related PR**: (to be added)
> **Domain-language source of truth**: This file (terms: PASTED card / PastedBlock node / paste-collapse threshold)
> **Scope**: `apps/electron` renderer input (`rich-text-input.tsx`), without IPC / send-protocol changes

---

<a id="1-背景与目标"></a>

## 1. Background and goal

Pasting long text (such as a full task description or paper abstract) fills the chat input and makes editing difficult. Goal: Automatically collapse pasted text **above threshold** into a “PASTED” card (first few lines + label + character count), keeping input clear; on send, **restore the full text in place**, leaving Agent input unchanged.

Match the long-paste experience of Claude.ai / ChatGPT.

<a id="2-需求已与用户确认"></a>

## 2. Requirements (confirmed with user)

| Item | Decision |
|----|------|
| Send semantics | **A**: Collapse is editing-time visual simplification only; sending restores full text at the card's original position in the message, **zero IPC / send-protocol changes** |
| Card interaction | Delete (× / Backspace) + click to expand full text (read-only); **no** full-text editing |
| Trigger threshold | `CJK character count > 50 OR English word count > 50` |
| Trigger timing | Check **only on paste**; typed text never collapses regardless of length |
| Multiple pastes | Each qualifying paste becomes an independent card node |

<a id="3-架构自定义-tiptap-节点"></a>

## 3. Architecture (custom tiptap node)

The input uses tiptap rich text (`rich-text-input.tsx`); send serialization is `editor.getHTML()` → `htmlToMarkdown()` (DOM traversal). Reuse exactly the mention-chip custom node → HTML → markdown pattern.

<a id="31-纯函数-classifypastetext可单测"></a>

### 3.1 Pure function `classifyPaste(text)` (unit-testable)

```
classifyPaste(text: string): { cjk: number; words: number; shouldCollapse: boolean }
```

- `cjk`: CJK character count. Regex covers Chinese/Japanese/Korean characters + kana + Hangul + CJK/fullwidth punctuation, counted individually.
- `words`: English word count. Strip CJK characters, then split remaining text into tokens by whitespace/punctuation and count.
- `shouldCollapse = cjk > 50 || words > 50`
- Extract local threshold constants (`PASTE_CJK_THRESHOLD = 50` / `PASTE_WORD_THRESHOLD = 50`).

<a id="32-tiptap-扩展-pastedblock"></a>

### 3.2 tiptap extension `PastedBlock`

- Atom block node, `selectable: true`, `draggable: false`, `atom: true`.
- Attributes:
  - `text: string` — Full original text (single source of truth)
  - Compute character-count badge directly from `text.length` in NodeView, without storing another attribute (single source of truth)
- `renderHTML` → `<div data-pasted-text="<encodeURIComponent(text)>">…</div>` (attribute encoding, mirroring mention's urlEncoded label).
- `parseHTML` → recognize `div[data-pasted-text]` and restore the node (consistent paste-back/history recovery).
- React NodeView card rendering:
  - Preview first N lines/characters (truncated), **PASTED** label, character count
  - Show **×** on hover → delete node
  - Click card → Radix Popover showing full original text (read-only, scrollable)
  - Copy uses i18n (see §6)

<a id="33-粘贴拦截editorpropshandlepaste"></a>

### 3.3 Paste interception (`editorProps.handlePaste`)

- Handle only `text/plain`; clipboard files retain existing `onPasteFiles` handling (files first; long-text logic does not take over).
- Read pasted plain text → `classifyPaste`:
  - If `shouldCollapse` is true → `event.preventDefault()`, insert `PastedBlock` at current selection (`text` = original).
  - Otherwise return false for default tiptap paste.
- Do not intercept while mention suggestions are active (let default behavior handle), avoiding disruption of @ / / / # flows.

<a id="34-发送序列化htmltomarkdown-增分支"></a>

### 3.4 Send serialization (add `htmlToMarkdown` branch)

- When DOM traversal encounters `el.hasAttribute('data-pasted-text')` → return `decodeURIComponent(el.getAttribute('data-pasted-text'))` (full original text).
- DOM document order means card position equals restoration position → **expand in place**. Surrounding typed text and multiple pastes retain correct order naturally.

<a id="35-空态-&#45;可发送判定"></a>

### 3.5 Empty-state / sendability checks

- Existing editor-empty detection treats `<p></p>` as empty. Count `PastedBlock` as nonempty so a lone pasted block can be sent without other text.
- Review and relax emptiness / canSubmit logic in `rich-text-input.tsx` accordingly.

<a id="4-数据流"></a>

## 4. Data flow

```
Paste text/plain
  └─ handlePaste → classifyPaste
        ├─ Below threshold → Default paste (plain text in editor)
        └─ Above threshold → Insert PastedBlock{ text }
                       └─ NodeView card (preview/label/count/×/click to expand)

Send
  └─ editor.getHTML() → htmlToMarkdown()
        └─ data-pasted-text → decodeURIComponent → Full original text (in place)
              └─ Final markdown message (identical to uncollapsed input)
```

<a id="5-边界与异常"></a>

## 5. Boundaries and exceptions

- Multiple pastes: Independent nodes, unaffected by each other.
- Cards among typed text: Document-order serialization restores text correctly in place.
- Delete: × button / Backspace after node selection (default atom behavior).
- Pasted code/markdown: Always plain text, no parsing.
- Encoding safety: `encodeURIComponent` / `decodeURIComponent` round-trip quotes, newlines, and HTML special characters in attributes without loss.

## 6. i18n

New keys (en + zh together, guarded by key-parity):

| key | en | zh |
|-----|----|----|
| `pastedBlock.label` | `PASTED` | `已粘贴` (Pasted) |
| `pastedBlock.chars` | `{{count}} chars` | `{{count}} 字` ({{count}} characters) |
| `pastedBlock.expandTitle` | `Pasted text` | `粘贴的文本` (Pasted text) |
| `pastedBlock.remove` | `Remove` | `移除` (Remove) |

Namespace: Use the input's namespace (confirm during implementation, expected `conversation` or the input's existing namespace).

<a id="7-测试"></a>

## 7. Tests

- Unit-test `classifyPaste`: Chinese boundary (50/51), English boundary, mixed Chinese/English, empty string, whitespace only, punctuation.
- Unit-test `htmlToMarkdown`: `data-pasted-text` elements → full original text (newlines/quotes/special characters), correct concatenation with surrounding text, multiple nodes.
- NodeView / handlePaste interaction: tiptap + DOM is difficult to unit-test; manually inspect in `bun run dev` (paste above/below threshold, delete, expand, multiple pastes, file paste not intercepted, card-only sendability).

<a id="8-不做yagni"></a>

## 8. Exclusions (YAGNI)

- Full-text editing inside cards (option C, removed).
- Long text as separate attachment / send-protocol changes (option B, removed).
- Unified total-character threshold (user chose separate CJK/word thresholds of 50).
- Automatic collapse of long typed text (paste only).
