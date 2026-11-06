# 长文本粘贴折叠为 PASTED 卡片 Spec（Pasted-Text Collapse）

> **状态**：草稿 · 待实现
> **关联 issue**：（待补）
> **关联 PR**：（待补）
> **领域语言事实源**：本文件（术语：PASTED 卡片 / PastedBlock 节点 / 粘贴折叠阈值）
> **影响范围**：`apps/electron` 渲染进程输入框（`rich-text-input.tsx`），不触及 IPC / 发送协议

---

## 1. 背景与目标

用户在对话输入框粘贴长文本（如整段任务描述、论文摘要）时，输入框被一大坨文字占满，编辑体验差。目标：粘贴**超阈值**的长文本时，自动折叠成一张「PASTED」卡片（前几行预览 + 标签 + 字数），让输入框保持简洁清晰；发送时卡片在**原位还原**为完整文本，Agent 收到的内容不变。

对标 Claude.ai / ChatGPT 的长粘贴体验。

## 2. 需求（已与用户确认）

| 项 | 决策 |
|----|------|
| 发送语义 | **A**：折叠仅为编辑期视觉简化；发送时卡片在原位还原成完整文本拼入消息，**IPC / 发送协议零改动** |
| 卡片交互 | 删除（× / Backspace）+ 点击展开看全文（只读）；**不支持**编辑全文 |
| 触发阈值 | `CJK 字符数 > 50 || 英文单词数 > 50` |
| 触发时机 | **仅粘贴时**判定；手动打字再长也不折叠 |
| 多段粘贴 | 每段合格粘贴各自成一个卡片节点 |

## 3. 架构（自定义 tiptap 节点）

输入框是 tiptap 富文本（`rich-text-input.tsx`），发送序列化路径为 `editor.getHTML()` → `htmlToMarkdown()`（DOM 遍历）。本方案复用与 mention chip 完全相同的「自定义节点 → HTML → markdown」模式。

### 3.1 纯函数 `classifyPaste(text)`（可单测）

```
classifyPaste(text: string): { cjk: number; words: number; shouldCollapse: boolean }
```

- `cjk`：CJK 字符数。正则覆盖中日韩文字 + 假名 + 谚文 + CJK/全角标点，逐字计数。
- `words`：英文单词数。先剥离 CJK 字符，再按空白/标点把剩余切成 token 计数。
- `shouldCollapse = cjk > 50 || words > 50`
- 阈值常量提取到本地常量（`PASTE_CJK_THRESHOLD = 50` / `PASTE_WORD_THRESHOLD = 50`）。

### 3.2 tiptap 扩展 `PastedBlock`

- atom、块级节点，`selectable: true`、`draggable: false`、`atom: true`。
- 属性：
  - `text: string` —— 完整原文（唯一事实源）
  - 字数角标在 NodeView 内由 `text.length` 直接计算，不另存属性（单一事实源）
- `renderHTML` → `<div data-pasted-text="<encodeURIComponent(text)>">…</div>`（属性编码，镜像 mention 的 urlEncoded label 做法）。
- `parseHTML` → 识别 `div[data-pasted-text]` 还原节点（保证粘贴回填/历史恢复一致）。
- React NodeView 渲染卡片：
  - 前 N 行/字预览（截断）、**PASTED** 标签、字数
  - hover 出 **×** 按钮 → 删除该节点
  - 点击卡片 → Radix Popover 展示完整原文（只读，可滚动）
  - 文案走 i18n（见 §6）

### 3.3 粘贴拦截（`editorProps.handlePaste`）

- 仅处理 `text/plain`；剪贴板含文件时仍走现有 `onPasteFiles`（文件优先，长文本逻辑不接管）。
- 读取粘贴纯文本 → `classifyPaste`：
  - `shouldCollapse` 为真 → `event.preventDefault()`，在当前选区插入 `PastedBlock`（`text` = 原文）。
  - 否则返回 false，走 tiptap 默认粘贴。
- mention suggestion 弹窗激活时不接管（让默认行为处理），避免干扰 @ / / / # 流程。

### 3.4 发送序列化（`htmlToMarkdown` 增分支）

- DOM 遍历遇到 `el.hasAttribute('data-pasted-text')` 的元素 → 返回 `decodeURIComponent(el.getAttribute('data-pasted-text'))`（完整原文）。
- 因 DOM 按文档顺序遍历，卡片在正文中的位置即还原位置 → **原位展开**。前后打字内容与多段粘贴顺序天然正确。

### 3.5 空态 / 可发送判定

- 现有「编辑器为空」判定以 `<p></p>` 为空。需让 `PastedBlock` 计入非空，使「仅粘贴一段、无其它文字」也能发送。
- 复核 `rich-text-input.tsx` 中 emptiness / canSubmit 逻辑并相应放宽。

## 4. 数据流

```
粘贴 text/plain
  └─ handlePaste → classifyPaste
        ├─ 未超阈值 → 默认粘贴（纯文本进编辑器）
        └─ 超阈值 → 插入 PastedBlock{ text } 节点
                       └─ NodeView 渲染卡片（预览/标签/字数/×/点击展开）

发送
  └─ editor.getHTML() → htmlToMarkdown()
        └─ 遇 data-pasted-text → decodeURIComponent → 完整原文（原位）
              └─ 拼成最终 markdown 消息（与无折叠时完全一致）
```

## 5. 边界与异常

- 多段粘贴：各自独立节点，互不影响。
- 卡片中间夹在打字文本里：序列化按文档顺序，原位还原正确。
- 删除：× 按钮 / 选中节点后 Backspace（atom 节点默认行为）。
- 粘贴代码/markdown：一律按纯文本处理，不解析。
- 编码安全：`encodeURIComponent` / `decodeURIComponent` 保证含引号、换行、HTML 特殊字符的原文在属性中往返无损。

## 6. i18n

新增 key（en + zh 同步，key-parity 守门）：

| key | en | zh |
|-----|----|----|
| `pastedBlock.label` | `PASTED` | `已粘贴` |
| `pastedBlock.chars` | `{{count}} chars` | `{{count}} 字` |
| `pastedBlock.expandTitle` | `Pasted text` | `粘贴的文本` |
| `pastedBlock.remove` | `Remove` | `移除` |

命名空间：归入输入框所属 ns（实现时确认，预计 `conversation` 或输入框现用 ns）。

## 7. 测试

- 单测 `classifyPaste`：纯中文边界（50/51）、纯英文边界、中英混排、空串、纯空白、含标点。
- 单测 `htmlToMarkdown`：含 `data-pasted-text` 元素 → 还原完整原文（含换行/引号/特殊字符）、与前后文本拼接顺序正确、多节点。
- NodeView / handlePaste 交互：tiptap + DOM 难以单测，在 `bun run dev` 手动走查（粘贴超/不超阈值、删除、展开、多段、含文件粘贴不被接管、仅卡片可发送）。

## 8. 不做（YAGNI）

- 卡片内编辑全文（方案 C，已砍）。
- 长文本作为独立附件 / 改发送协议（方案 B，已砍）。
- 按总字符数统一阈值（用户选了 CJK/词分别 50）。
- 自动折叠手动打字的超长文本（仅粘贴触发）。
