Genspark Super Agent 触发机制调研

> 关键词与触发条件的完整拆解

核心问题:用户输入什么样的内容,Super Agent 会触发哪种模态?

---

一、触发的四种判断方式

Super Agent 实际是用四种触发方式叠加判断,优先级从高到低:
触发方式  判断依据① 显式关键词触发  用户输入包含明确的形式词("PPT"、"幻灯片"、"表格"、"画一张图"...),Super Agent 直接路由到对应 Agent。这是最高优先级的判断
② 隐式意图推断  用户没说形式词,只说目的("对比 X"、"演示 Y"、"统计 Z"),Super Agent 通过 LLM 推断最适合的模态
③ 中间检查点反问  意图完全模糊("帮我整理一下"、"做个东西"),Super Agent 反问用户选择,以快速选项按钮的形式呈现
④ 主动选择(快捷入口)  用户在 dashboard 左侧栏直接点击 AI Slides / AI Sheets / AI Docs,跳过 Super Agent 的判断,直接进入指定模态
---

二、显式关键词触发:完整关键词字典

这是最高优先级的触发方式。下面是各模态的关键词触发字典(中英文双语):
触发的模态  中文触发词  英文触发词AI Slides  PPT / 幻灯片 / 演示文稿 / 做个 deck / 报告幻灯片 / 投影片  slide / slides / deck / presentation / PowerPoint / pitch deck
AI Sheets  表格 / 电子表格 / Excel / 数据表 / 整理成表  sheet / spreadsheet / excel / table / data table / xlsx
AI Docs  文档 / 报告 / 文章 / 写一份 / Word / 备忘录 / 公文  doc / document / report / article / write / memo / Word file
AI Image  画一张 / 图片 / 配图 / 插画 / 头像 / 封面图  image / picture / draw / paint / illustration / cover / generate image
AI Video  视频 / 短片 / 动画 / 拍一段 / Reel / 抖音视频  video / clip / animation / film / Instagram reel / TikTok video
AI Developer  代码 / 网站 / App / 小游戏 / 写函数 / 部署 / debug  code / website / app / game / function / build / deploy / debug
AI Designer  海报 / 传单 / Logo / T恤 / 设计 / 名片 / 包装  poster / flyer / logo / T-shirt / design / business card / packaging
AI Pods  播客 / 音频 / 朗读 / 配音 / TTS  podcast / audio / TTS / voice / narration
Deep Research  深度研究 / 调研 / 综述 / 深入分析 / 盘点 / 详细研究  research / deep research / comprehensive / in-depth / survey
Call For Me  打电话 / 帮我打 / 预订 / 预约 / 订餐厅 / 询价 / 客服  call / phone / book / make a reservation / appointment / call for me
Download For Me  下载 / 抓取 / 帮我下 / 收集这些文件 / 保存到 Drive  download / fetch / scrape / save to drive / collect files
---

三、隐式意图触发:目的词如何映射到模态

当用户没说形式词,只说目的,Super Agent 会用 LLM 推断最适合的输出形式。这里有一套相对稳定的映射模式:
用户意图模式  映射的模态  判断逻辑"对比 / 比较 / 列 N 个"  内联表格(对话流中)  结构是多维度多对象,适合表格表达
"给老板讲 / 给客户演示 / 路演 / 培训"  AI Slides(PPT)  "演示/讲"暗示需要分页可视化
"统计 / 算一下 / 求和 / 趋势 / 整理数据"  AI Sheets(电子表)  "统计/算"暗示需要单元格计算
"详细写一下 / 起草 / 综述 / 撰写"  AI Docs(长文档)  "写/起草"暗示长形式文档
"看下 X 长什么样 / 生成一个画面"  AI Image  "看/画面"暗示视觉表达
"拍一段介绍 / 做个宣传"  AI Video  "拍/宣传"暗示动态内容
"做一个 X 工具 / 实现一个 X"  AI Developer  "做/实现"在技术语境下暗示代码
"调研 / 盘点 / 深入了解"  Deep Research → Sparkpage  调研类需要长内容 + 引用 + 结构化
"帮我和 X 联系 / 沟通 / 跟进"  Call For Me / 邮件  "联系/沟通"暗示外部行动
"解释 / 是什么 / 为什么"  纯对话答复(结构化文字)  解释类不需要文档型产出
---

四、中间检查点触发:模糊意图的反问机制

当用户的输入完全模糊(只说要做某事,没说形式也没说目的),Super Agent 会主动反问用户。这是一个非常关键的设计 —— 与其赌一个错的模态,不如把选择交给用户。

典型反问场景
用户的模糊输入  Super Agent 的反问选项"帮我整理一下竞品分析"  [📊 PPT,适合演示] [📑 Word 报告,适合存档] [📈 对比表格,适合查看] [💬 直接列在这里]
"做个东西给客户"  [📊 演示 PPT] [📑 提案文档] [🎨 海报] [📹 介绍视频] [告诉我更多]
"帮我看看明天的会议"  [📑 准备议程文档] [📊 准备开场 PPT] [💬 列要点] [📞 帮我打电话确认]
反问机制的三条设计规则

- 通常 3-5 个选项,不超过 5 个,避免选择困难
- 每个选项一个 emoji + 短文案 + 一行解释("适合演示"/"适合存档"),让用户秒懂区别
- 保留"告诉我更多"或"直接列在这里"作为兜底选项,避免用户被迫做选择

---

五、主动选择:跳过路由的快捷入口

用户也可以完全跳过 Super Agent 的判断,直接选择想用的模态。这是一种"显式选择"的入口,适合用户明确知道自己要做什么的情况。

两种主动选择方式

- 从左侧导航栏点击:Dashboard 左栏列出所有 Agent(AI Slides / AI Sheets / AI Docs / AI Developer / AI Designer 等),点击直接进入该模态的专属界面
- 用直接的 URL 访问:每个 Agent 都有独立 URL(如 `genspark.ai/agents?type=slides_agent`),用户可直接跳转

从产品视角看,这两种入口的存在意义是:Super Agent 的智能路由解决"我不知道用什么"的小白场景,而主动选择入口解决"我明确知道我要什么"的熟手场景。两者并存覆盖了不同用户阶段。

---

六、一句话内触发多个模态(多标签触发)

Super Agent 的一个高级能力是:一次输入可以触发多个模态,串联成 pipeline。这是它和单一 Agent 工具的根本区别。

典型多标签触发的例子
用户输入  触发的模态序列"调研 SaaS 赛道,做成 PPT 给老板看"  `[RESEARCH]` → `[SLIDES]`
"对比 3 家酒店,然后打电话给最好那家确认有家庭房"  `[RESEARCH]` → `[SHEETS]`(对比表)→ `[CALL]`
"找 20 个 YouTube AI 视频,做成表格,然后写一篇分析"  `[RESEARCH]` → `[SHEETS]` → `[DOCS]`
"做个产品介绍视频,先写脚本,然后画封面,最后剪视频"  `[DOCS]`(脚本)→ `[IMAGE]`(封面)→ `[VIDEO]`
Super Agent 会在 Plan 阶段把整个 pipeline 显式呈现给用户,标出每一步用哪个模态,让用户在执行前看到完整路径。

---

七、关键观察与设计启示

1. 关键词触发是"快速路径",意图触发是"智能路径":用户精准说出形式词时走快速路径(直接关键词匹配,LLM 不用做语义判断);用户只说目的时才走智能路径(LLM 推断)。两层叠加既保证了响应速度,又保证了智能度。
2. 标签触发让 LLM 决策和具体生成解耦:LLM 不需要懂如何画 PPT,只需要知道"这是个 PPT 请求"。这个解耦设计让加新模态变得非常简单 —— 只需要注册一个新标签 + 一个新端点,不用动 LLM 本身。
3. 反问机制比赌一个模态更尊重用户:意图模糊时不要赌,而是把选择权抛给用户。3-5 个按钮 + 每个一行说明 = 用户秒选。这避免了"AI 替我做错了选择"的挫败感,也避免了反复改格式带来的 credit 浪费。
4. 主动选择入口是熟手用户的快捷通道:Super Agent 的智能路由是为小白设计的;熟手用户已经知道自己要什么,直接从左栏点 AI Slides 进入更快。两种入口并存覆盖了用户成熟度光谱。
5. 一句话内可触发多个模态,串联成 pipeline:这是 Super Agent 和单一 Agent 工具的本质区别。用户输入"调研后做成 PPT 给老板看",触发 `[RESEARCH]` → `[SLIDES]` 的链式调用,中间无需用户介入。
6. 触发关键词覆盖中英文双语 + 同义词扩展:Genspark 的关键词字典是经过精心设计的,覆盖了形式词、同义词、行业术语、口语表达。这让用户无论用什么习惯说法都能正确触发模态。