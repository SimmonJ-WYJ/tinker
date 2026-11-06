# 0.4 P2 需求探索：科研场景证据集 / 笔记模型（带引用）

> **性质**：0.4 P2「证据集 → 研究主题容器」重定义的需求探索附件，回填 [ADR-007](../../adr/ADR-007-evidence-set-topic-container.md) 三个待定项。
> **来源**：deep-research 多源 fan-out + 三向对抗验证（2026-06-01）。25 条 claim 验证 → 20 confirmed / 5 killed。
> **关联**：[0.4.0 PRD](./0.4.0-prd.md) Epic P2 · [CONTEXT.md 证据集与笔记领域](../../../CONTEXT.md)

---

## 执行摘要

主流科研笔记法（Zettelkasten）与 PKM 工具（Zotero/Obsidian/Logseq/Roam/Readwise）的实证一致指向三条对「研究主题容器(1:N)」有直接决策力的结论：

1. **自由笔记应成立**——Zettelkasten 把"永久笔记/Zettel"作为一等公民，可凭空成立而无需锚定任何来源（方法明确允许跳过 fleeting/literature 直接写 Zettel），与"证据锚定笔记"并列为两种合法笔记。
2. **笔记与证据应并列(co-member)而非从属**——文献综述骨架是"主题"而非单条来源；笔记通过"引用/链接"标注来源（note 引用 source），而非把 source 装进 note，二者是 peer。
3. **多容器应走"扁平 + 标签/链接 + 多归属"而非刚性嵌套文件夹**——Luhmann 拒绝预设主题分类、走 bottom-up，一条笔记可经链接同时归属多个上下文（semilattice）。

---

## 对 ADR-007 三个待定项的明确建议

### (a) 自由笔记是否应成立？→ **应成立**（高置信）

Zettelkasten 永久笔记/Zettel 自含、永不丢弃、是"发展论证而非收集材料"的层；Ahrens 明确"thoughts fully formed 时可跳过 fleeting/literature 直接写 Zettel"；自我思考产出的永久笔记无需从文献笔记链接而来。

**ASCI 落地修正**：自由笔记应是**耐久的一等公民**，但**不必照搬正统 Zettelkasten 的两条规范**——① fleeting 的"用后即删/转写"；② 永久笔记"强制链接进网络"。链接对 ASCI 应是可选最佳实践而非硬约束。
来源：[zettelkasten.de](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/) · [scrintal/Ahrens](https://scrintal.com/guides/how-to-take-smart-notes) · [ctnet](https://www.ctnet.co.uk/how-to-create-a-zettelkasten-in-logseq/)

### (b) 笔记 vs 证据：从属还是并列？→ **并列(co-member)**（高置信）

笔记通过"链接到引用笔记"标注来源（note→source 是**引用/citation 关系**，两实体一方引用另一方），而非 containment（note 嵌套于 source 下）。综述按主题聚合多源，主题容器 > 单篇。

**ASCI 落地**：主题容器里**笔记与证据都是并列成员**，由引用/链接关联，而不是"笔记下挂证据"。
来源：[wilde-at-heart](https://wilde-at-heart.garden/pages/how-i-use-the-logseq-readwise-plugin-in-my-zettelkasten/) · [GMU 写作中心](https://writingcenter.gmu.edu/writing-resources/research-based-writing/organizing-literature-reviews-the-basics) · [atlasworkspace](https://www.atlasworkspace.ai/blog/pkm-apps-for-researchers)

### (c) 多容器组织方式？→ **扁平 + 标签/双向链接 + 多归属**（高置信）

Luhmann"It is not important where you place a new note as long as you can link to it""we decide against the order and categorization by topics and subtopics"；semilattice 允许"a single note can be referenced from multiple Structure Notes"。Logseq 无文件夹、用 tag 区分笔记类型即为佐证。

**ASCI 落地**：研究主题建模为"涌现式容器"，扁平 + 标签/链接组织，**不要刚性嵌套文件夹**。
来源：[sloww/Luhmann](https://www.sloww.co/zettelkasten/) · [zettelkasten.de](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/)

---

## ⚠️ 关键待决：1:N vs M:N（多归属）

研究证据**强烈支持多归属（M:N）**——一条笔记/证据可同属多个主题容器（Luhmann semilattice / 多 Structure Note 引用 / Logseq Linked References）。但 P2 当前定的是严格 **1:N**。

**需 PM 确认**：这是"有意收敛为 1:N"还是"待放开为 M:N"？M:N 更贴合科研直觉，但数据模型与 UI 复杂度更高。

---

## Caveats（证据强度与时效）

- 核心方法学论断溯及 Ahrens《How to Take Smart Notes》(2017) 与 Luhmann 1981 原文，经 zettelkasten.de + 多所大学写作中心交叉佐证，时效稳定，高置信。
- 部分单条引文来自博客/SaaS 文（scrintal/atlasworkspace/medium），单独证据偏弱，但均被更权威源三向佐证。
- "笔记与证据并列"是把 Zettelkasten 的"note 引用 source"机制**映射**为 ASCI 数据模型的**设计借鉴**，非外部对 ASCI 的硬性规范。
- 被否的流行说法（5 条 killed）：①"综述纯主题 vs 单源"的绝对化版本（实际 chronological/methodological 也合法，但都按高阶分组）；②"四类型含 reference note"扁平表述；③"fleeting 完全无独立价值"（fleeting 的留存与理解价值有效）。

---

## 其他 Open Questions（供 P2 设计细化）

1. **1:N vs M:N 多归属**（见上，最高优先，需 PM 裁决）。
2. Ahrens 的"project note"（在 Zettelkasten 之外、项目结束可弃）是否对应 ASCI 独立于主题容器的"写作/综述工作区"？自由笔记层与 project 层如何分工？
3. 引用粒度：是否需 **block 级**（段落/高亮级，如 Roam/Logseq）引用，还是文档/笔记级即可满足"标注→解读→综述"链条？影响标注数据结构。
4. 是否提供可选的**轻量层级**（Logseq namespace 式页名约定）作为对文件夹心智熟悉用户的渐进上手路径，而底层仍扁平多归属？

---

## 参考来源（19 源，按角度）

- **竞品模型**：[Obsidian 论坛 folders-vs-tags](https://forum.obsidian.md/t/folders-vs-linking-vs-tags-the-definitive-guide-extremely-short-read-this/78468) · [Bob Doto permanent note](https://writing.bobdoto.computer/what-is-a-permanent-note-correcting-some-common-misunderstandings/) · [atlasworkspace PKM](https://www.atlasworkspace.ai/blog/pkm-apps-for-researchers)
- **块引用/从属**：[wilde-at-heart Logseq+Readwise](https://wilde-at-heart.garden/pages/how-i-use-the-logseq-readwise-plugin-in-my-zettelkasten/) · [ctnet Logseq Zettelkasten](https://www.ctnet.co.uk/how-to-create-a-zettelkasten-in-logseq/)
- **自由笔记定位**：[zettelkasten.de Ahrens](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/) · [scrintal](https://scrintal.com/guides/how-to-take-smart-notes)
- **主题聚合工作流**：[sloww Zettelkasten](https://www.sloww.co/zettelkasten/) · [GMU 写作中心](https://writingcenter.gmu.edu/writing-resources/research-based-writing/organizing-literature-reviews-the-basics)
- **反例/陷阱**：[karl-voit 避免复杂文件夹](https://karl-voit.at/2020/01/25/avoid-complex-folder-hierarchies/) · [zettelkasten.de backlinks-are-bad](https://zettelkasten.de/posts/backlinks-are-bad-links/) · [nayuki tags-not-hierarchies](https://www.nayuki.io/page/designing-better-file-organization-around-tags-not-hierarchies)
