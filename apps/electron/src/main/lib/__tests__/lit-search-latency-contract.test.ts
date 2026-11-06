/**
 * lit-search 离线契约测试：把快路径不变式固化下来，防止后续改动悄悄回退。
 *
 * 全部为静态文件读取 + 正则断言，无网络、无 loader、跑 < 100ms。
 *
 * 配合 default-capability-packs-load.test.ts（端到端 loader）形成双层守门：
 *  - loader 测试：保证 manifest 结构合法 + prompt 模板能展开
 *  - 本测试：保证 prompt 文本内容含 / 不含特定关键词
 *
 * ⚠️ Stage 3（检索收敛）后的护栏迁移：原本由 searcher.md prompt 自律执行的
 * 「查询塑形 / 源黑名单 / ≤20 预算 / 早停」已下沉为确定性代码，本测试相应改为
 * 钉「searcher 只发一次 retrieve」。被迁移的护栏由下列测试在新位置接管，未丢失：
 *  - 按源塑形 / arxiv 不盲发 / 对象锚 / 矩阵天然有界
 *      → paper-search-mcp `test_query_matrix.py`
 *  - 死源黑名单（dblp / google_scholar / zenodo / base / citeseerx 禁用）
 *      → paper-search-mcp `connectors/test_registry_blacklist.py`（registry 层强制）
 *  - 「默认 PLAN 不引入坏源」的 planner 侧不变式 → 下方 "Scenario prompt" 段（未改）
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PACK_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'default-capability-packs',
  'lit-search',
)
const SCENARIO = readFileSync(join(PACK_DIR, 'scenario', 'system-prompt.md'), 'utf-8')
const SEARCHER = readFileSync(join(PACK_DIR, 'sub-agents', 'searcher.md'), 'utf-8')
const MANIFEST = JSON.parse(readFileSync(join(PACK_DIR, 'manifest.json'), 'utf-8'))

function toolsOf(name: string): string[] {
  const a = (MANIFEST.subAgents as Array<{ name: string; tools: string[] }>).find(
    (x) => x.name === name,
  )
  expect(a).toBeDefined()
  return a!.tools
}

describe('lit-search latency contract', () => {
  describe('Manifest', () => {
    it('skillRefs 仅含按需的 lit-search-report（检索热路径不引用 Skill）', () => {
      // lit-search-report 是「按需 / 大检索自动」产检索报告的 terminal_skill，
      // 只在用户触发时调，不进 TTFT/检索热路径；scenario prompt 守门它默认不自动挂（见下条）。
      expect(MANIFEST.skillRefs).toEqual(['lit-search-report'])
    })
    it('检索报告 skill 不进 TTFT/检索热路径：自动触发仅 general-query 且结果≥阈值（条件化 terminal_skill）', () => {
      expect(SCENARIO).toContain('lit-search-report')
      // 阈值以可读常量表达
      expect(SCENARIO).toContain('AUTO_REPORT_MIN_RESULTS')
      // 条件化挂载（结果数已知后由主 Agent 评估），而非规划轮/热路径无条件触发
      expect(SCENARIO).toContain('conditional `terminal_skill`')
      // exact-lookup / citation-tracing 永不自动产报告
      expect(SCENARIO).toMatch(/Never auto-attach for .*exact-lookup/i)
    })
    it('检索方案确认：scenario 在 PLAN 声明 confirm 指令，不自调 present_search_plan（避免吞掉 PLAN）', () => {
      // present_search_plan 是 in-process SDK MCP，scenario 子 agent 触达不到；若让它自调，
      // 确认后最终输出会变成散文、吞掉 ## SEARCH PLAN，导致 master 无法派活 + 报告不生成。
      // 故规划轮只 emit PLAN（含 confirm 字段），由 master 调确认工具。
      expect(SCENARIO).toContain('"confirm"')
      expect(SCENARIO).toContain('mcp__searchplan__present_search_plan')
      // 明确告知 scenario 不要自己调该工具
      expect(SCENARIO).toMatch(/do NOT call that tool/i)
      // exact-lookup 省略 confirm（无策略可调）
      expect(SCENARIO).toMatch(/omit.*confirm|exact-lookup.*omit/i)
    })
    it('scenarioAgent 工具集收为单一占位工具，不继承全套 MCP 工具说明（#669）', () => {
      // planner 全程不调工具（PLAN 声明 confirm，由 master 呈现 present_search_plan）。tools 缺省会被
      // SDK 当成"继承父级全集"→ 白读 ~3.8 万 token 的工具说明。SDK 只承诺"省略=全集"、对 `[]` 不作
      // 保证（实测 `[]` 也被当成全集），故须给一个【非空占位小工具】收窄。⚠️ 不要改回 `[]` / 删掉本字段。
      const tools = (MANIFEST.scenarioAgent as { tools?: string[] }).tools
      expect(tools).toEqual(['Glob'])
      // 红线：planner 不得再派子 Agent（无 Task / Agent），也不得自调 present_search_plan / 检索工具。
      expect(tools).not.toContain('Task')
      expect(tools).not.toContain('Agent')
      expect(tools).not.toContain('mcp__searchplan__present_search_plan')
      expect(tools!.some((t) => t.startsWith('mcp__paper-search__'))).toBe(false)
    })
    it('mcpRefs 仅含 paper-search', () => {
      expect(MANIFEST.mcpRefs).toEqual(['paper-search'])
    })
    it('subAgents 含 searcher / citation-explorer；scorer 已下沉为 score_window 工具（#745），不再是子 Agent', () => {
      const names = (MANIFEST.subAgents as Array<{ name: string }>).map((a) => a.name)
      expect(names).toContain('searcher')
      expect(names).toContain('citation-explorer')
      // #745：scorer 子 Agent 下沉为服务端 score_window 工具，判分派发不再依赖主 Agent 指令遵循
      expect(names).not.toContain('scorer')
      // v1 legacy relevance-scorer 早已整支删除（#747），不再注册
      expect(names).not.toContain('relevance-scorer')
    })
    it('searcher 主路径为确定性 retrieve 工具（Stage 3）', () => {
      // 收敛后：searcher 不再持有 6 个 search_* 入口，只调一次 retrieve。
      // 查询塑形/源选择/预算全在 retrieve 代码里（test_query_matrix.py 守）。
      expect(toolsOf('searcher')).toContain('mcp__paper-search__retrieve')
    })
    it('searcher 白名单恰为 [retrieve]，无死工具 / 无多余 Bash（#579 / #747）', () => {
      // 旧设计保留 search_papers/process_search_results 作 retrieve 报错时的逃生通道，
      // 但 search_papers 在 MCP server 端未注册 @mcp.tool（mcp_server.py:166-169），
      // 降级即调一个不存在的工具 → tool not found → 「降级即死」。
      // 现行：retrieve 报错直接明报并结束，无 agent 侧降级路径（失败源重试 + failed_sources 已在服务端覆盖）。
      // #747：searcher 的活就是「调一次 retrieve」，Bash 是纯多余授权 → 移除，物理杜绝手搓 python 绕过流水线。
      expect(toolsOf('searcher')).toEqual(['mcp__paper-search__retrieve'])
      expect(toolsOf('searcher')).not.toContain('Bash')
    })
  })

  describe('Scenario prompt — default sources（planner 侧不变式，未随 Stage 3 改动）', () => {
    it('canonical good brief sources 为 ["openalex", "crossref"]', () => {
      expect(SCENARIO).toMatch(/sources:\s*\["openalex",\s*"crossref"\]/)
    })
    it('PLAN 模板 sources 字段同步为 ["openalex", "crossref"]', () => {
      expect(SCENARIO).toMatch(/"sources":\s*\["openalex",\s*"crossref"\]/)
    })
    it('default 默认不含 arxiv', () => {
      const briefMatch = SCENARIO.match(/sources:\s*\[(.+?)\]/)
      expect(briefMatch).not.toBeNull()
      expect(briefMatch![1]).not.toMatch(/arxiv/i)
    })
    it('semantic 选源 gated 于运行时可用性块（planner 不再依赖看不到的环境变量名）', () => {
      // 旧契约写死 env var 名 `SEMANTIC_SCHOLAR_API_KEY`，但 planner 是 LLM、看不到主进程环境变量，
      // 导致它永远走 fast-path、semantic 从不被选。新契约把"key 配没配"改由 loader 注入的
      // "Optional paper-source availability" 运行时块告知 planner（见 capability-pack-loader）。
      expect(SCENARIO).toMatch(/Optional paper-source availability/)
      expect(SCENARIO).toMatch(/key-gated/)
      // 配置时纳入 / 未配置时移出 sources 的双分支仍在文档化
      expect(SCENARIO).toMatch(/CONFIGURED/)
      expect(SCENARIO).toMatch(/leave `semantic` out of `sources`/)
    })
    it('禁用源黑名单文档化（dblp / google_scholar / zenodo / base / citeseerx）', () => {
      expect(SCENARIO).toMatch(/Never include[^\n]*dblp/i)
      expect(SCENARIO).toMatch(/google_scholar/)
      expect(SCENARIO).toMatch(/zenodo/)
      expect(SCENARIO).toMatch(/base/)
      expect(SCENARIO).toMatch(/citeseerx/)
    })
  })

  describe('Searcher prompt — 收敛为单次 retrieve 调用（Stage 3）', () => {
    it('调用 mcp__paper-search__retrieve', () => {
      expect(SEARCHER).toMatch(/mcp__paper-search__retrieve/)
    })
    it('明确「恰好一次」retrieve 调用', () => {
      expect(SEARCHER).toMatch(/[Ee]xactly one\s+`?retrieve`?\s+call/)
    })
    it('禁止自行拼查询矩阵 / 枚举 keyword×source', () => {
      expect(SEARCHER).toMatch(/Do NOT compose query matrices/i)
    })
    it('声明查询塑形在 retrieve 服务端（不在 searcher 自律）', () => {
      expect(SEARCHER).toMatch(/server-side/i)
      expect(SEARCHER).toMatch(/query shaping/i)
    })
    it('不再写长篇 hits-per-source 报告（只回一行计数）', () => {
      expect(SEARCHER).toMatch(/Do NOT write a long .*report/i)
    })
    it('retrieve 报错走「明报并结束」，不引用 legacy atomic 逃生工具（#579）', () => {
      expect(SEARCHER).not.toContain('search_papers')
      expect(SEARCHER).not.toContain('search_arxiv')
      expect(SEARCHER).not.toContain('process_search_results')
    })
  })

  describe('score_window 下沉（#745）— scorer 子 Agent 删除 + scenario scoring 字段 + 派活协议', () => {
    const PROMPT_BUILDER = readFileSync(
      join(__dirname, '..', 'agent-prompt-builder.ts'),
      'utf-8',
    )
    it('scorer 子 Agent prompt 已删除（sub-agents/scorer.md 不存在）', () => {
      // #745：判分下沉为服务端 score_window 工具，scorer 子 Agent 整支删除。
      expect(existsSync(join(PACK_DIR, 'sub-agents', 'scorer.md'))).toBe(false)
    })
    it('scenario PLAN 不再 emit scorer 子 Agent 步骤 / 并行 scorer 分片', () => {
      expect(SCENARIO).not.toMatch(/"subagent_type":\s*"scorer"/)
      expect(SCENARIO).not.toMatch(/parallel `scorer` shards/)
      expect(SCENARIO).not.toMatch(/Parallel scorer shards/)
    })
    it('scenario PLAN 用 top-level scoring 字段声明 score_window（general-query / citation-tracing）', () => {
      expect(SCENARIO).toMatch(/"scoring":/)
      expect(SCENARIO).toMatch(/mcp__paper-search__score_window/)
      // 判分锚点 research_question 仍是必填项（下沉后语义不变）
      expect(SCENARIO).toMatch(/research_question/)
    })
    it('主 Agent 派活协议处理 scoring 字段：召回后、terminal 前调一次 score_window（不派 scorer 子 Agent）', () => {
      // 注：源码模板字面量里反引号转义为 \`，断言避开裸反引号
      expect(PROMPT_BUILDER).toMatch(/Scoring \(/)
      expect(PROMPT_BUILDER).toMatch(/score_window/)
      expect(PROMPT_BUILDER).toMatch(/exactly once/i)
      // 不再派 scorer 子 Agent / 不再自己切分片
      expect(PROMPT_BUILDER).toMatch(/not.*dispatch.*sub-agents?|not.*split shards/i)
    })
    it('parallel-group 机制仍保留（lit-review 等其它场景仍用 parallel:true）', () => {
      expect(PROMPT_BUILDER).toMatch(/[Pp]arallel group/)
      expect(PROMPT_BUILDER).toMatch(/wait for every tool_result in the group/i)
    })
  })
})
