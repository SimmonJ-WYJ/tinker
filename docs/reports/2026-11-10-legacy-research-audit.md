# ASCI 旧品牌与科研资产保留审计（2026-11-10）

审计对象：Tinker 分支基线 `4ca339592668581c1dc36abc9097fc9bf0aa1650`。所有下述行号均以该 commit 为准；为避免并行迁移的工作区修改改变结论，清单从 `git archive HEAD` 生成，证据从 `git show HEAD:<path>` / `git grep ... HEAD` 读取。本报告没有自行联网确认远端最新 tip，远端与基线的对应关系由主任务提供。审计只新增本报告和相邻 JSON 清单，没有修改、删除源码、旧文档或用户数据，没有运行 GUI、测试、构建、commit 或 push。

## 结论

**旧 ASCI 文档与科研能力大量保留；Tinker 的通用产品改造已经隐藏了一部分入口，并按请求选择运行时，但科研系统没有被移除。** “源码仍在”“有静态接线”“普通用户可从常规界面直接进入”“已在安装包中实测”是四个不同结论，本审计仅证明前三者中的具体接线，不宣称运行通过。

- 旧品牌不只存在于内部 ID：当前 agent 指令入口 `CLAUDE.md:10` 仍把产品定义为面向科研的 ASCI，`CONTEXT.md:1-3` 仍称 ASCI 对话流；会话工作区自动生成的指令 `apps/electron/src/main/lib/config-paths.ts:25-38` 仍明确告诉 Agent 宿主是 ASCI。
- `apps/electron/src/renderer/lib/product-surface.ts:2` 的 `RESEARCH_UI_ENABLED=false` 只收起特定 renderer 入口。它不会关闭主进程 IPC、科研数据库、论文 watcher、能力包分发或全部科研界面。
- 右侧论文页仍是默认 tab：`apps/electron/src/renderer/atoms/right-panel-tabs.ts:45-48`，同文件 `:217-222` 还将新会话的 activeId 初始化为 session-papers。标签栏在 `apps/electron/src/renderer/components/app-shell/RightPanelTabBar.tsx:264-275` 遍历 tabs，无科研开关过滤；对应内容在 `RightPanelTabContent.tsx:79-88` 挂载。因此在有当前会话且右栏打开时，论文页仍有常规静态界面入口，且默认激活。
- 运行时已做任务分流：科研意图进入 `research`；普通通用任务默认使用精简上下文。不能因为科研 prompt/MCP 仍在仓库中就断言每次普通聊天都会加载。带显式 Skill/MCP 引用的通用请求仍有额外遗留加载边界，详见下文。
- 许可、原作者归属、数据路径和协议名字应单独处理，不能按 `ASCI` 关键词全量替换或删除。

## 完整清单与计数

相邻文件 `2026-11-10-legacy-research-inventory.json` 包含 **2,911 个 tracked 文件/符号链接的完整文件名清单**，每项的检索组标记、文件名命中标记和独占归属类别。`files` 唯一文件表的零基下标就是 file ID，类别索引与 term bitmask 的解码规则见 `file_table_encoding`；按类别或标记筛选即可取得全部对应文件名。资源集合用 file ID 引用，不重复路径；未命中项也完整保留。精确调用链行号见本报告，不在 JSON 重复每一行文本命中。

- 扫描 UTF-8 文本/链接目标文字：2,770；二进制或非 UTF-8 内容排除：141（仍记录其文件名，不对图片、PDF 做 OCR）。`AGENTS.md` 是指向 `CLAUDE.md` 的 tracked 符号链接，未重复跟随计数。
- 路径或内容至少命中一组：**1,572 文件**；未命中：1,339。
- 不区分大小写的原始 `asci` 子串：948 文件；排除相邻英文字母的 ASCI token：894 文件；OPENSCI：114；中文科研词：436；英文科研词：879；科研服务名：690。这些集合有交集，不能相加。
- 54 个文件仅命中原始 `asci` 而没有 ASCI token，例如 ASCII 编码、Fascism、期刊名称中的子串；它们不应直接算作品牌残留。

下表是互斥的路径归属分类，合计 1,572。它是**匹配文件数量**，不是功能数量，也不是逐条确认应清理的文件数量。

| 分类（JSON key） | 命中文件数 | 判读方式 |
|---|---:|---|
| root_product_and_agent_docs | 3 | README、CLAUDE、CONTEXT，含当前指令冲突 |
| current_reference_docs_and_qa | 28 | ADR、架构、构建、开发说明；需按当前源码校验 |
| historical_docs_and_proposals | 41 | history、0.2、milestones、feedback、proposals、disabled upstream workflows |
| design_specs_not_runtime_authority | 78 | 设计方案；状态和日期不等于实现/可达性 |
| prior_audit_and_qa_evidence | 4 | 既有报告与验证资料；不复用为本次实测证据 |
| bundled_skills_and_assets | 292 | 包括科研技能、通用技能里的科研示例 |
| bundled_capability_packs | 19 | 3 个科研能力包的全部文件 |
| bundled_mcp_and_resources | 87 | 检索 MCP、Zotero 等资源；不含被优先归入测试的条目 |
| main_runtime | 245 | 主进程服务、存储、IPC、prompt、MCP |
| preload_bridge | 7 | renderer ↔ main 接口 |
| renderer_runtime | 270 | 页面、组件、atoms、hooks 等 |
| renderer_locales | 54 | 当前与被收起页面的翻译文本 |
| shared_core_ui_packages | 83 | 共享类型、常量、Zotero 客户端、schema 等 |
| tests_fixtures | 294 | 独立测试/fixture 路径；bundled skill 自带文件按资源归属优先 |
| build_scripts_config_other | 65 | 打包、脚本、配置、其他路径 |
| licenses_attribution | 2 | 命中关键词的 LICENSE/NOTICE 类文件；其他许可仍完整保留在全量清单 |

全文和路径联合检索：`ASCI/asci`、`OPENSCI`、`科研/论文/文献/学术/综述/研究空白/证据集`、`research/scientific/scholar/academic/literature/paper(s)/citation(s)/evidence-set`、`Zotero/PubMed/arXiv/paper-search/papers-rg/litreview/lit-review/lit-search/research-gap/OpenAlex/Semantic Scholar/bioRxiv/EuropePMC/Crossref`。JSON `methodology.patterns` 是可重放的精确正则。泛词 research/paper 也会命中市场调研、业务写作、样例和科学库说明，所以语义处置必须以本报告的调用链和人工判断为准。

额外按路径盘点全部打包技能，不依赖关键词：**99 个 SKILL.md 入口、883 个技能文件**（包括通用 Office/图表等，不能全称为科研专用）；3 个能力包、19 个文件：`lit-search`、`lit-review`、`research-gap`。所有入口名与文件名见 JSON 的 `retained_asset_sets`。这补足了 biopython、scanpy 等不一定包含上述检索词的科学工具资产。

## 文档：历史保留与当前权威入口

| 资产 | 证据 | 判断 |
|---|---|---|
| 当前 Tinker README | `README.md:3,18,26,32` | 当前产品叫 Tinker；明示演进自 ASCI、保留 @asci 命名、候选数据隔离、保留原作归属，并链接历史 README |
| 当前 agent 规则 | `CLAUDE.md:10,20,45,221`；`AGENTS.md -> CLAUDE.md` | 仍面向科研 ASCI、旧仓库 issue tracker、旧目录说明；是仍生效的入口，不是仅归档 |
| 当前领域语言 | `CONTEXT.md:1-3,66-106,174-190` | 保留论文、证据集、Corpus、科研相关性服务语言；包含当前、目标和未来设计，不能把未来 Corpus 视为已上线 |
| 历史 README | `docs/history/ASCI-README.md`；`README.md:32` | 明确历史归档，应保留来源和演进记录 |
| 科研设计文档 | `docs/specs/0.4.0/research-gap-spec.md`、`docs/specs/evidence-set-research.md`、Zotero/引用跳转等 specs | 完整保留；“设计存在”不能代替运行代码核对 |
| 当前通用产品表面设计 | `docs/specs/tinker-general-product-surface.md:3,7-18,22,26` | 明确仅隐藏入口、不移除数据/后台；声明 native E2E 待完成。文档说 Rust migration paused，是当时范围说明，不阻止用户本次授权的下一步迁移 |
| 既有路线与讨论 | `docs/milestones/`、`docs/feedback/`、`docs/0.2/`、`docs/proposals/` | 历史目标、反馈、静态 demo 和提案，不能默认解释为当前产品承诺 |
| 规范与架构 | `docs/architecture.md`、`docs/agent-sdk-integration.md`、`docs/adr/` | 仍由 CLAUDE 导航使用，内容混有旧科研架构；应逐域同步，不能直接整体归档 |

JSON 将“历史/提案”按路径分类；并未认定该目录内每项决定都失效。规范是否仍有效需结合 superseding ADR 与当前源码。完整的 41 个命中历史文件、78 个 spec、28 个参考文件可从 JSON 文件表按 area_id 过滤取得，不以本表举例代替全量文件名。

## 科研功能：入口与实际接线

| 功能/表面 | 当前静态状态 | 路径与门控证据 |
|---|---|---|
| Zotero 设置主导航 | 收起；旧显式入口仍可渲染 | `components/settings/SettingsPanel.tsx:60-61,80`；`SettingsDialog.tsx:43` 把恢复的旧 Zotero tab 改为 MCP，但没有删除显式 Zotero render case |
| MCP 设置中的 Zotero / paper-search | 内建两行隐藏；用户配置行保留 | `components/settings/agent/McpSection.tsx:62` 只对 isBuiltin 过滤两种名字；不是禁用服务 |
| 首次引导连接 Zotero | 自动跳过研究阶段 | `components/onboarding/SpotlightOverlay.tsx:96-108`；不等于关闭其服务 |
| @ 论文/集合/证据集入口与预取 | 根级分类收起，预取跳过 | `components/agent/at-mention-suggestion.tsx:234,274`；旧引用类型与主进程处理仍在 |
| 助手回答加入证据集 | 按 renderer 开关隐藏 | `components/agent/SDKMessageRenderer.tsx:873`；复制、反馈等通用行为仍可用 |
| 会话论文列表/筛选/批量 Zotero 导入 | **右栏常规静态入口仍保留** | `atoms/right-panel-tabs.ts:45-48` → `RightPanelTabBar.tsx:264-275` → `RightPanelTabContent.tsx:79-80` → `components/agent/SessionPapersPanel.tsx`。AppShell 仅要求有会话、conversations 视图、panelOpen (`AppShell.tsx:62`) |
| 检索结果打开论文页 | 结果触发入口仍接线 | `components/agent/tool-result-renderers/paper-search-result.tsx:56` upsert session-papers tab；不受 RESEARCH_UI_ENABLED 限制 |
| Agent 请求 Zotero 批量导入 | MCP→事件→renderer 仍接线 | `main/lib/agent-orchestrator-mcp.ts:79-93` → `renderer/hooks/useGlobalAgentListeners.ts:900-909` 激活论文 tab、开右栏、存 pending selection；不是仅保留工具定义 |
| 研究空白对照表 | MCP、事件、结果组件、右栏渲染保留 | `main/lib/agent-orchestrator-mcp.ts:109-118`；`renderer/hooks/useGlobalAgentListeners.ts:648`；`RightPanelTabContent.tsx:81-88`；`components/agent/tool-result-renderers/research-gap-result.tsx` |
| 全局 Library / Notes | 主导航不再展示；路由分支和界面仍存在 | `components/app-shell/LeftSidebar.tsx:466-490` 为新任务/项目/会话主结构；`components/tabs/MainArea.tsx:49-75` 仍按 activeView library/notes 渲染。仅证明条件路由保留，不宣称用户常规导航可达 |
| 引用图谱 | 全局 modal 与 IPC 保留 | `renderer/App.tsx:63,68` 挂 GraphModal；`main/ipc.ts:44` 注册；`preload/domains/papers.ts:342`；`components/citation-graph/useCitationGraph.ts:50-86` 发起/取消/订阅 |
| 论文、笔记、证据集、综述对象与数据库 | 主进程存储与 IPC 保留 | `main/index.ts:335-337,359-364` 初始化及历史证据集归属回填；`main/ipc.ts:41`；`main/ipc/papers.ts`、`main/lib/objects/` repositories/schema/migrations |
| Zotero PDF 解析、段落总结、向量索引 | 主进程启动路径保留；受用户开关约束 | `main/index.ts:514-521` 仅 zoteroEnabled 且有 mainWindow 时启动 parser/generator/embedding/自动 diff；子能力还有各自配置判断，不等于全都默认开启 |
| 会话论文实时监听 | 主进程仍启动 | `main/index.ts:507-508` startSessionPapersWatcher，与 renderer 开关无关 |
| 旧演示与 mock 数据 | 源码保留，不能作为生产数据功能证据 | `atoms/session-evidence-atoms.ts:2,43,116-118` 标注 mock；`components/library/evidence-set-detail/CreateSetNoteDialog.tsx`、`AddPapersToSetDialog.tsx` 仍有 mock 路径；`LeftSidebar.tsx:115` ZoteroConnectBadge 仅定义/测试引用，不能凭组件存在认定侧栏已显示 |

表中 `components/`、`atoms/`、`hooks/` 相对 `apps/electron/src/renderer/`；`main/`、`preload/` 相对 `apps/electron/src/`。

主进程 IPC 没有跟 renderer 开关一起移除：`apps/electron/src/main/ipc.ts:32-44` 无条件注册 papers、Zotero、citation-graph 域。preload 聚合器 `apps/electron/src/preload/index.ts:22-41,63-95,114-124` 仍暴露 zotero、workspacePapers、notes、evidenceSets、reviews、papers、citationGraph 和 paperSearch；具体桥接在 `preload/domains/papers.ts`、`zotero.ts`、`media.ts`，shared 通道/类型在 `packages/shared/src/types/papers-ipc.ts`、`zotero.ts`、`citation-graph.ts` 等。这里证明完整桥接层仍在，不证明每项 handler 已被本次实际调用。

## 请求运行时：科研 prompt、MCP、Agent 与技能

1. **意图选择是生产门控。** `packages/shared/src/agent/runtime-policy.ts:21-34`：中文论文/文献/综述、Zotero 或特定英文论文意图、科学引用、粘性科研续聊进入 research，启用 workspace context 与 subagents；简单寒暄进入 conversation；普通 general/coding 默认不加载 workspace context。显式 Skill/MCP 引用的 general/coding 使用 workspace context，但不启用 subagents。
2. **宿主使用该门控。** `apps/electron/src/main/lib/agent-orchestrator.ts:668-696` 传入科学引用与历史状态，只在 includeWorkspaceContext 时执行 buildMcpServers；`:1076-1084` 仅 includeSubagents 时加载能力包；`:1268-1304` 在精简 prompt 与完整 prompt / project settingSources / workspace plugin 之间选择；`:1349-1358` seed 内建 SubAgent/Skill/MCP registry。
3. **科研专用包仍分发且可按研究路径加载。** `main/index.ts:348,354,372` seed/upgrade default skills、seed capability packs；`electron-builder.yml:122-130` 将默认技能与能力包带入打包资源。`config-paths.ts:722-727` 定义生产与开发资源来源；`:711-720` 的实际升级策略是按 manifest version 覆盖。`main/index.ts:370-371` 的“已存在保留、不覆盖”注释已落后于 helper 实现，不能以该注释判断升级行为。
4. **3 个科研能力包完整保留。** `apps/electron/default-capability-packs/{lit-search,lit-review,research-gap}/manifest.json:8-13` 声明 scenario Agent，目录还保留检索、引文扩展、综述提案、reader/body-writer/fact-checker、column-proposer/cell-extractor/gap-analyzer 等子 Agent prompt；loader 在 `main/lib/capability-pack-loader.ts:147-155` 扫描注册。每包全文件清单见 JSON。
5. **科研大 prompt 仍有效用于完整上下文路径。** `main/lib/agent-prompt-builder.ts:338,349-383` 已声明 Tinker 的通用身份、科学是 specialization；同文件 `:392-408` 保留 Zotero 导入/论文分层读取规则，`:683-713` 保留检索 MUST-ROUTE 和结果持久化规则，`:805-823` 保留科研 Skill 路由/综述强制生产链。这些不是只存在于历史 Markdown。
6. **普通任务仍有加载边界可收紧。** `main/lib/agent-orchestrator-mcp.ts:65-129` 在函数被调用后注册 papers-rg、asci-zotero、litreview、researchgap、searchplan，session 类工具仅以 sessionId 存在为条件。`includeScientificServices` 在 `:207` 只传给 preparePaperSearchRuntime；`main/lib/mcp/runtime-scope.ts:7` 非科研只移除 paper-search。因此带显式 Skill/MCP 引用的 general 请求也会走 builder，仍可能得到其余研究工具和完整 prompt；默认无引用的 ordinary general 请求不会走该路径。
7. **全局 MCP 可用性与 renderer 显示不同。** `main/lib/mcp/global-config.ts:110-134` 合并用户配置与内建服务，Zotero 默认 fallback false，OCR true、ASR false；`main/lib/mcp/builtin-mcp-resolver.ts:57-82` 由 Zotero 主开关及子开关控制；`:112-113` paper-search 在 uv 存在时 enabled。最终 builder `:135-137` 仅注入 enabled 服务，再由 runtime-scope 对非科研移除 paper-search。不能把“设置行隐藏”读成“检索默认关闭”。
8. **后台科研服务仍和通用媒体能力耦合。** OCR/ASR 的 enabled 条件目前依赖 zoteroEnabled (`builtin-mcp-resolver.ts:69-82`)，ZoteroSettings 还承担媒体缓存/下载控制。后续迁移应先拆共享设置，避免移除科研入口时同时丢失通用图片/语音/PDF 能力。

## ASCI 名字的语义处置

| 类别 | 明确例子与证据 | 建议 |
|---|---|---|
| 仍生效的旧产品/Agent 身份 | `CLAUDE.md:10`、`CONTEXT.md:1-3`、`main/lib/config-paths.ts:25-38`；该工作区 marker 实际在 `:973,1020` 写出 | 单独规划文档/身份同步；需遵守 CLAUDE 对修改 README/CLAUDE 的明确规则，不由审计顺手改动 |
| 仍面向用户的科研措辞 | `renderer/locales/en/auth/profile.json:18,21,26` 和 zh `:18`；`components/settings/ProfileSettings.tsx:241` 使用 deleteAccountDescription | 账户页仍说研究数据/本地科研库，应中英同步审查；不把翻译文件所有未被使用的 key 当可达 UI |
| 用户可见的兼容路径提示 | `renderer/locales/{en,zh}/auth/{conflict,errors,menu}.json` | 保留真实路径兼容语义；候选隔离环境中是否应展示计算后的路径需另验，不能只换品牌字样 |
| 内部兼容契约 | `@asci/*`、ASCI_* env、MCP asci-*、`asci.db`、`~/.asci(-dev)`、`asci://` (`main/lib/auth-deeplink-parser.ts:18`)、appId (`electron-builder.yml:4`) | 当前保留有理由；重命名要有 schema/存储/OAuth/打包兼容方案，不能文本批量替换 |
| 实际外链/服务依赖 | LoginPage `:209,216` 和 AboutSettings `:481-482` 使用 ASCI 政策常量；`packages/shared/src/constants/legal.ts:12-15` 指向 OPENSCI ASCI 政策路径；`constants/github-repo.ts:13` 仍指原仓库名 | 这是实接线，不只是常量名。审计没有访问外链或验证服务归属/内容，变更需明确产品目标 |
| 归属、许可与来源 | `NOTICE:1-5,8-16`、`README.md:32`、`LICENSE` 及 bundled skill LICENSE.txt | 保留；不要误报为待删除品牌残留 |
| 品牌资产与打包注释 | `electron-builder.yml:132-134` 打包 resources/asci-logos；`:163-169` 仍有 ASCI 应用/路径注释 | 文件名/资源确实保留；未目视二进制图标，不能宣称视觉已全部换成 Tinker 或全部显示旧图标 |
| 独立旧 Tauri 原型 | `apps/tauri-prototype/src/main.tsx:14`、`index.html:1`、`src-tauri/tauri.conf.json:3,5` | 仍显示 ASCI 技术验证原型，并保留旧 productName/identifier。它是独立 workspace，页面明确未接入聊天、登录、模型和项目数据；不能与正式 Electron 或本轮 `apps/tinker-rust` 的迁移能力混为一谈 |

## 后续技术迁移边界

本审计不执行移除科研代码。下一步迁移应以可回归边界推进：

1. 先将普通会话上下文与科研上下文的选择契约固定，保留旧会话历史与权限语义；Rust 侧迁移围绕普通 conversation profile，避免顺带改 SQLite、科研索引或用户渠道格式。
2. 单独梳理显式 Skill/MCP 的 general 路径，决定是否继续注入全部研究工具/完整 prompt；形成具体验收案例后再收紧。
3. 明确右侧论文默认 tab、账户科研文案、显式 library/notes 路由是否要继续保留。当前“隐藏科研”的策略覆盖不完整，但这是产品范围决定，不是本审计的删除授权。
4. 将 OCR/ASR/PDF 与 Zotero 设置依赖拆开后，再讨论研究模块按需加载或独立能力包。保留可读取历史数据的兼容层。
5. 文档同步区分当前规则、历史证据和作者归属；用户本次未授权改 README/CLAUDE，本报告只指出冲突。迁移实现应有独立 spec/report 和适当验证，不以此只读审计当作测试通过证据。

## 覆盖限制

“完整”指基线 tracked tree 的文件名及指定词组扫描完整，不代表自然语言语义、所有传递依赖或可运行功能已经穷尽验证。未扫描未跟踪/忽略文件、真实 ~/.asci 配置和会话、历史删除文件、远端分支、二进制内容；未读取真实用户凭据配置或输出实际令牌。没有调用网络、GUI、构建或业务测试，故无法保证 Scholar/PubMed/arXiv 等远端源、Zotero 本机连接、native 安装包、OAuth 或科研链路本轮可运行。路径和调用链证明保留与接线，运行验证留给后续明确范围的验收。
