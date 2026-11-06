Genspark Super Agent 输出模态与编辑功能调研

多模态输出能力的完整拆解

Super Agent 的 10 种输出模态总览

根据 Genspark 官方介绍 + 实际产品测试 + 多个第三方评测,Super Agent 当前支持的输出模态可以归纳为 10 类。

模态  产出物形态  典型用户场景
1  AI Slides  PPT 幻灯片  商业演示、路演、汇报、培训
2  AI Sheets  电子表格  数据分析、信息抓取、研究分析师工作
3  AI Docs  富文本文档  报告、文章、邮件、模板化文档
4  AI Image  单图 / 图组  插图、封面、社交配图
5  AI Video  视频  Instagram 短片、宣传片、教程
6  AI Developer  代码 / 网站 / 原生 App / 游戏  一句话建网站、做小游戏、原型开发
7  AI Designer  海报 / 传单 / Logo / T恤 / 社交贴  品牌设计、营销素材、印刷可用文件
8  AI Pods  音频 / 播客  播客生成、有声内容、TTS
9  Deep Research  Sparkpage 研究报告  深度调研、综述、文献综合
10  Call For Me  真实电话动作  订餐厅、约预约、客服跟进

模态分类:三大类别

按照产出物的本质属性,这 10 种模态可以分为三大类:

类别  模态成员  共同特征
文档型产出物  Slides / Sheets / Docs / Sparkpage  结构化的、可编辑的、有标准格式的产出物;每个都内建编辑器
媒体型产出物  Image / Video / Audio / Design  视听类的、相对一次性的产物;编辑功能较弱,主打"再生成"
行动 + 代码  Developer / Call For Me  Developer 产物是"可运行的代码";Call For Me 是"真实世界动作"。两者都更接近"做事"而非"做文档"

各模态的输出能力与编辑功能详解

3.1 AI Slides(幻灯片)

输出能力

 自动生成 boardroomquality 演示文稿,带标题、要点、图表、配图
 自动联网调研,内容带引用源
 先生成大纲(Outline),用户批准后再逐页填充内容
 支持中、英、日、韩、西、法、德、葡等 19 种语言
 可上传 PDF/Word/Excel/PPT 作为输入,或者上传 .pptx 作为模板

编辑功能(核心)

编辑方式  具体能力
AI Edit(对话改)  用自然语言描述修改:"把第 3 页换种语气"、"加一页竞品对比"、"全部改成深色主题"。AI 直接在原页上操作
Advanced Edit(手动改)  打开一个独立编辑窗口,提供拖拽式操作:调字体、改颜色、移动元素、调版式,类似简化版的 PowerPoint。手动编辑不消耗 credits
Fact Check  一键校验:逐页生成 fact check prompt,标记哪些观点有强引用支持、哪些缺乏证据、哪些数据需要更新
整稿重写  用一句话指令重写整份 PPT:"重做一份,更适合给投资人看"、"压缩到 10 页内"
模板系统  可把当前 PPT 保存为模板;也可上传自有 .pptx 作为新模板源
导出 / 分享  导出为 PDF / PPTX / Google Slides;或生成公开链接;或在浏览器内直接演示

用户实测反馈:在创作内容上 AI Slides 是同类最强的,但精细化设计调整仍需"在 PPT 里 polish 最后 1020%"。

3.2 AI Sheets(电子表格)

输出能力

 "Excel 跑在自动驾驶模式":自动收集信息、自动构建公式、自动生成模板
 作为"研究分析师":用户说"top 20 YouTube videos on AI automation",AI 自动搜索并拉取观看数、点赞、评论、时长、标签到一张活表
 支持导入用户的现有数据集(CSV / Excel),AI 接管分析
 自动生成图表来可视化数据

编辑功能(核心)

编辑方式  具体能力
对话式分析  "分析这份数据"、"找出价格和件数的关系"、"按主题统计";AI 直接生成结果 + 图表
加列 / 删列 / 改列  "加一列计算溢价率"、"删掉前 3 列"、"把日期列改成年月日格式"
筛选 / 排序 / 透视  "只看价格 > 100 的"、"按销量排序"、"按主题做透视表"
公式生成  自动构建 SUM / VLOOKUP / IF 等公式;支持自然语言描述"求 B 列在 C 列大于 10 时的平均值"
生成图表  "做一张柱状图显示每年发售数量"、"按主题做饼图";图表内嵌在 Sheet 中
手动单元格编辑  直接点击单元格编辑数值/文字;支持复制粘贴、拖拽填充
导出  导出为 .xlsx / .csv;可同步到 Google Sheets

3.3 AI Docs(文档)

输出能力

 自动起草专业文档:报告、备忘录、文章、合同、邮件
 数百个智能模板可选,模板会根据用户场景自适应,而非僵化套用
 支持 HTML 格式输出,可承载复合元素:富文本 + 数据卡片 + 交互式图表(ECharts) + 表格
 生成时 Agent 会主动声明输出格式和理由(如"用 HTML 因为支持交互式图表")
 每个文档自动生成独立可分享的 URL(短码形式)

编辑功能(核心)

编辑方式  具体能力
内建富文本编辑器  对标 Notion / Google Docs:文字样式(标题/正文)、字体、字号、加粗/斜体/下划线/删除线、对齐(左/中/右)、列表、缩进、行距、文字颜色、背景色、插入图片、插入链接、插入表格、插入图表
对话式改写  "把语气改正式一点"、"压缩到 500 字"、"加一段反驳的观点"、"翻译成英文"
Rich Text / Standard 模式  底部输入框带切换:Rich Text 模式产出富格式文档,Standard 模式产出纯文本
内嵌副表单元素  数据指标卡片(Metric Cards)、章节标题(H1/H2/H3)、交互式图表(ECharts)、Summary Tables、引用与方法说明
上下文感知输入框  进入文档编辑场景后,底部输入框 placeholder 变成 "Enter your doc request here...",提示语随场景变化
分享 / 导出  画布顶部独立的 [Share] 按钮(基于独立 URL);[View & Export] 下拉提供多格式导出(PDF / Word / HTML)

3.4 AI Image(图像)

输出能力

 免费使用顶级图像模型:Nano Banana Pro、GPT Image、FLUX、Seedream("always uptodate")
 单图或 2x2 网格批量生成
 支持指定风格(vaporwave、写实、动漫等)、比例、画面元素
 可作为 PPT / Docs 的内嵌素材自动使用

编辑功能(核心)

编辑方式  具体能力
Photo Genius(批量编辑)  一键专业级编辑:背景去除、色调校正、主体修饰、图像放大;支持批量处理(如 500 张商品图一次性处理)
Regenerate(重生成)  对单张图说"换个风格"、"改成竖版"、"换光线";AI 重新生成
局部修改(Inpainting)  用户框选区域,描述修改内容("把背景换成海边"、"加一只猫")
扩图(Outpainting)  把原图向外扩展,AI 补全周围画面
风格迁移  基于参考图改风格、改色调
下载 / 嵌入  PNG / JPG 下载;直接"用到 PPT"或"用到 Docs"一键内嵌

特点:相比文档型产出物,图像的"传统编辑"(像素级修改)能力较弱,Genspark 的主导思路是"再生成"而非"细调"。如果需要像素级精修,需要导出后用 Photoshop / Figma。

3.5 AI Video(视频)

输出能力

 免费使用顶级视频模型:Gemini Veo、Sora、Kling、Seedance("always uptodate")
 Scenebyscene 生成:Agent 先写脚本 → 逐场景生成图像 → 拼接为视频
 可生成 Instagramready 的短片
 一句话"做个产品介绍视频"即可触发完整流程

编辑功能(核心)

编辑方式  具体能力
Clip Genius(剪辑)  AI 自动剪辑:基于素材自动选片段、加转场、配音乐
Scene 重生成  对单个场景说"换种镜头"、"加更多动作";只重生成那一段
脚本修改  修改 scenebyscene 脚本,AI 重新生成对应场景
加字幕 / 加配音  自动加字幕,可选 TTS 配音(多种音色)
音乐 / 配乐  AI 推荐合适的背景音乐,可一键替换
导出  MP4 导出;支持 Instagram / TikTok 标准比例

注意:视频的传统精细剪辑(逐帧调整、时间线编辑)能力比专业软件(Premiere / DaVinci)弱;Genspark 主打"快速从 0 到能用"。

3.6 AI Developer(代码 / 网站 / App)

输出能力

 一句话构建:网站、原生 App、游戏
 完整的 GitHub 集成:支持 code editing + pull requests
 可生成代码、修 bug、重构、写文档
 可集成 GitHub Copilot / Cursor / Windsurf 等工具

编辑功能(核心)

编辑方式  具体能力
内嵌代码编辑器  类 VS Code Web 的代码编辑能力:语法高亮、文件树、多标签
对话式修改  "把这个按钮改成蓝色"、"加一个登录页"、"修复这个 bug"
实时预览  画布右侧实时呈现 Web 应用 / 游戏的运行效果
沙盒运行  代码在云端沙盒中运行,无需本地环境
GitHub 同步  生成的代码可直接推送到 GitHub 仓库,作为 PR 提交
部署  生成的 Web 应用一键部署,获得公开访问 URL

3.7 AI Designer(平面设计)

输出能力

 一句话生成:海报、传单、Logo、T恤设计、社交媒体贴图
 产出印刷可用的高分辨率文件(printready)
 可基于品牌信息生成完整 VI 套件(在日本案例中替代了 50 万日元的设计公司服务)

编辑功能(核心)

编辑方式  具体能力
对话式调整  "改成更复古的风格"、"换个主色"、"加一个标语"
重生成  一键再生成多个变体
输出格式  主要是 PNG / JPG 图片;无原生可编辑矢量文件(SVG/AI/PSD)
局限:精细化控制弱  "想调单个字母的字距" → 做不到。整体重生成可以,像素级精修不行
外部工作流接力  常用做法:导出 PDF → 导入 Canva / Figma → 人工精修

3.8 AI Pods(音频 / 播客)

输出能力

 自动生成播客形态的音频内容(类似 Google NotebookLM 的 Audio Overviews)
 基于用户输入的话题或文档,生成多人对话式播客
 支持 TTS 多音色

编辑功能

 对话式调整:"改成更专业的语气"、"换个开场"
 重新生成单段
 导出 MP3 / WAV 音频文件
 可作为视频的配音素材使用

注:AI Pods 是 Genspark 较新的能力,编辑深度尚不如 Slides / Docs / Sheets 等成熟模态。

3.9 Deep Research(深度研究 / Sparkpage)

输出能力

 分析"数千个来源"产出深度研究报告
 产出物形式:Sparkpage(类维基百科条目的结构化页面)
 Sparkpage 包含:目录导航、章节折叠、引用角标、关键证据、调研路径回放
 每个 Sparkpage 都自动生成独立 URL,可对外公开分享

编辑功能

编辑方式  具体能力
对话式深挖  "深入讲一下第 3 章"、"补充对 X 公司的分析"、"换个角度"
章节级编辑  可对单个章节做改写/扩展/删除,而不影响其他章节
跨场景转换  Quick Action 一键:"把这份研究做成 PPT"、"导出为 Word"、"做成视频"
引用源管理  每条事实都有引用角标,鼠标 hover 显示来源,可点击跳转
公开分享  生成公开 URL,无需登录 Genspark 即可访问

3.10 Call For Me(电话动作)

输出能力

 使用 OpenAI Realtime API 进行真实人声电话
 双层架构:Realtime API 负责实时对话,Shadow Model 负责目标对齐
 能处理 hold music、含糊回应等复杂场景
 典型场景:订餐厅、约预约、客服跟进;在日本甚至有用户用它打"离职电话"

编辑/控制功能

控制方式  具体能力
拨号前确认  Agent 提供拨号意图、对方电话、关键要点;用户点[确认拨号]才执行
通话中实时转写  画布中实时显示双方对话(波形动画 + 转写流);用户能"看着 Agent 打电话"
中途插话  通话过程中用户可输入指令调整 Agent 行为(如"再问下能否换日期")
挂断 / 终止  用户可一键挂断
通话产物  通话结束后产出:录音 + 完整转写 + 摘要 + 完成状态(订到了/没订到等)
二次行动  Quick Action:"再打一次"、"发邮件确认"、"加入日历"

特别说明:Call For Me 是"动作型"模态,不是"文档型",所以它的"编辑功能"实际上是"过程控制"。



各模态的触发机制 —— 关键词与触发条件

用户输入什么样的内容,Super Agent 会触发哪种模态?这背后是一套混合判断系统。本章基于产品实测 + 开源复刻项目(ComposioHQ/opengenspark on GitHub)证实的代码逻辑,梳理出 Super Agent 的完整触发机制。

4.1 触发机制的核心实现:LLM 输出特殊标签

根据开源复刻项目的工程师亲测代码,Super Agent 的触发机制本质上是:

"Super Agent 识别到 presentation 请求时,会以 `[SLIDES]` 标签回复。这个标签会触发 generate slides 端点,Super Agent 把主题、内容、页数、风格传过去。" —— Composio 工程师对 Genspark 触发机制的复刻验证

也就是说:Super Agent 不是直接调工具,而是先在内部回复时输出一个"路由标签"(如 `[SLIDES]` / `[SHEETS]` / `[DOCS]`),前端检测到这些标签后,再触发对应模态的生成端点。这个设计的好处是:

 LLM 的决策(走哪种模态)和具体生成解耦,LLM 不需要懂如何生成 PPT,只需要知道"这是个 PPT 请求"
 加新模态时只需要注册一个新标签 + 对应端点,Super Agent 本身不用改
 可以让 Super Agent 在同一回合里输出多个标签,实现"先做 PPT 再做 Sheet"的多步任务

触发的三种判断方式

Super Agent 实际是用三种触发方式叠加判断,优先级从高到低:

触发方式  判断依据
① 显式关键词触发  用户输入包含明确的形式词("PPT"、"幻灯片"、"表格"、"画一张图"...),Super Agent 直接路由到对应 Agent。这是最高优先级的判断
② 隐式意图推断  用户没说形式词,只说目的("对比 X"、"演示 Y"、"统计 Z"),Super Agent 通过 LLM 推断最适合的模态
③ 中间检查点反问  意图完全模糊("帮我整理一下"、"做个东西"),Super Agent 反问用户选择,以快速选项按钮的形式呈现
④ 主动选择(快捷入口)  用户在 dashboard 左侧栏直接点击 AI Slides / AI Sheets / AI Docs,跳过 Super Agent 的判断,直接进入指定模态

4.3 显式关键词触发:完整关键词字典

这是最高优先级的触发方式。下面是各模态的关键词触发字典(中英文双语):

触发的模态  中文触发词  英文触发词
AI Slides  PPT / 幻灯片 / 演示文稿 / 做个 deck / 报告幻灯片 / 投影片  slide / slides / deck / presentation / PowerPoint / pitch deck
AI Sheets  表格 / 电子表格 / Excel / 数据表 / 整理成表  sheet / spreadsheet / excel / table / data table / xlsx
AI Docs  文档 / 报告 / 文章 / 写一份 / Word / 备忘录 / 公文  doc / document / report / article / write / memo / Word file
AI Image  画一张 / 图片 / 配图 / 插画 / 头像 / 封面图  image / picture / draw / paint / illustration / cover / generate image
AI Video  视频 / 短片 / 动画 / 拍一段 / Reel / 抖音视频  video / clip / animation / film / Instagram reel / TikTok video
AI Developer  代码 / 网站 / App / 小游戏 / 写函数 / 部署 / debug  code / website / app / game / function / build / deploy / debug
AI Designer  海报 / 传单 / Logo / T恤 / 设计 / 名片 / 包装  poster / flyer / logo / Tshirt / design / business card / packaging
AI Pods  播客 / 音频 / 朗读 / 配音 / TTS  podcast / audio / TTS / voice / narration
Deep Research  深度研究 / 调研 / 综述 / 深入分析 / 盘点 / 详细研究  research / deep research / comprehensive / indepth / survey
Call For Me  打电话 / 帮我打 / 预订 / 预约 / 订餐厅 / 询价 / 客服  call / phone / book / make a reservation / appointment / call for me
Download For Me  下载 / 抓取 / 帮我下 / 收集这些文件 / 保存到 Drive  download / fetch / scrape / save to drive / collect files

隐式意图触发:目的词如何映射到模态

当用户没说形式词,只说目的,Super Agent 会用 LLM 推断最适合的输出形式。这里有一套相对稳定的映射模式:

用户意图模式  映射的模态  判断逻辑
"对比 / 比较 / 列 N 个"  内联表格(对话流中)  结构是多维度多对象,适合表格表达
"给老板讲 / 给客户演示 / 路演 / 培训"  AI Slides(PPT)  "演示/讲"暗示需要分页可视化
"统计 / 算一下 / 求和 / 趋势 / 整理数据"  AI Sheets(电子表)  "统计/算"暗示需要单元格计算
"详细写一下 / 起草 / 综述 / 撰写"  AI Docs(长文档)  "写/起草"暗示长形式文档
"看下 X 长什么样 / 生成一个画面"  AI Image  "看/画面"暗示视觉表达
"拍一段介绍 / 做个宣传"  AI Video  "拍/宣传"暗示动态内容
"做一个 X 工具 / 实现一个 X"  AI Developer  "做/实现"在技术语境下暗示代码
"调研 / 盘点 / 深入了解"  Deep Research → Sparkpage  调研类需要长内容 + 引用 + 结构化
"帮我和 X 联系 / 沟通 / 跟进"  Call For Me / 邮件  "联系/沟通"暗示外部行动
"解释 / 是什么 / 为什么"  纯对话答复(结构化文字)  解释类不需要文档型产出

4.5 中间检查点触发:模糊意图的反问机制

当用户的输入完全模糊(只说要做某事,没说形式也没说目的),Super Agent 会主动反问用户。这是一个非常关键的设计 —— 与其赌一个错的模态,不如把选择交给用户。

典型反问场景

用户的模糊输入  Super Agent 的反问选项
"帮我整理一下竞品分析"  [📊 PPT,适合演示] [📑 Word 报告,适合存档] [📈 对比表格,适合查看] [💬 直接列在这里]
"做个东西给客户"  [📊 演示 PPT] [📑 提案文档] [🎨 海报] [📹 介绍视频] 
"帮我看看明天的会议"  [📑 准备议程文档] [📊 准备开场 PPT] [💬 列要点] [📞 帮我打电话确认]

Super Agent 在反问时遵循三条规则:

 通常 35 个选项,不超过 5 个,避免选择困难
 每个选项一个 emoji + 短文案 + 一行解释("适合演示"/"适合存档"),让用户秒懂区别
 保留"告诉我更多"或"直接列在这里"作为兜底选项,避免用户被迫做选择

4.6 主动选择:跳过路由的快捷入口

用户也可以完全跳过 Super Agent 的判断,直接选择想用的模态。这是一种"显式选择"的入口,适合用户明确知道自己要做什么的情况。

两种主动选择方式:

 从左侧导航栏点击:Dashboard 左栏列出所有 Agent(AI Slides / AI Sheets / AI Docs / AI Developer / AI Designer 等),点击直接进入该模态的专属界面
 用直接的 URL 访问:每个 Agent 都有独立 URL(如 `genspark.ai/agents?type=slides_agent`),用户可直接跳转

从产品视角看,这两种入口的存在意义是:Super Agent 的智能路由解决"我不知道用什么"的小白场景,而主动选择入口解决"我明确知道我要什么"的熟手场景。两者并存覆盖了不同用户阶段。

4.7 一句话内触发多个模态(多标签触发)

Super Agent 的一个高级能力是:一次输入可以触发多个模态,串联成 pipeline。这是它和单一 Agent 工具的根本区别。

典型多标签触发的例子

用户输入  触发的模态序列
"调研 SaaS 赛道,做成 PPT 给老板看"  `[RESEARCH]` → `[SLIDES]`
"对比 3 家酒店,然后打电话给最好那家确认有家庭房"  `[RESEARCH]` → `[SHEETS]`(对比表)→ `[CALL]`
"找 20 个 YouTube AI 视频,做成表格,然后写一篇分析"  `[RESEARCH]` → `[SHEETS]` → `[DOCS]`
"做个产品介绍视频,先写脚本,然后画封面,最后剪视频"  `[DOCS]`(脚本)→ `[IMAGE]`(封面)→ `[VIDEO]`

Super Agent 会在 Plan 阶段把整个 pipeline 显式呈现给用户,标出每一步用哪个模态,让用户在执行前看到完整路径。

```

4.9 触发机制的几个关键观察

1. 关键词触发是"快速路径",意图触发是"智能路径":用户精准说出形式词时走快速路径(直接关键词匹配,LLM 不用做语义判断);用户只说目的时才走智能路径(LLM 推断)。两层叠加既保证了响应速度,又保证了智能度。
2. 标签触发让 LLM 决策和具体生成解耦:LLM 不需要懂如何画 PPT,只需要知道"这是个 PPT 请求"。这个解耦设计让加新模态变得非常简单 —— 只需要注册一个新标签 + 一个新端点,不用动 LLM 本身。
3. 反问机制比赌一个模态更尊重用户:意图模糊时不要赌,而是把选择权抛给用户。35 个按钮 + 每个一行说明 = 用户秒选。这避免了"AI 替我做错了选择"的挫败感,也避免了反复改格式带来的 credit 浪费。
4. 主动选择入口是熟手用户的快捷通道:Super Agent 的智能路由是为小白设计的;熟手用户已经知道自己要什么,直接从左栏点 AI Slides 进入更快。两种入口并存覆盖了用户成熟度光谱。
5. 一句话内可触发多个模态,串联成 pipeline:这是 Super Agent 和单一 Agent 工具的本质区别。用户输入"调研后做成 PPT 给老板看",触发 `[RESEARCH]` → `[SLIDES]` 的链式调用,中间无需用户介入。
6. 触发关键词覆盖中英文双语 + 同义词扩展:Genspark 的关键词字典是经过精心设计的,覆盖了形式词、同义词、行业术语、口语表达。这让用户无论用什么习惯说法都能正确触发模态。



## 八、关键洞察与启示

1. Super Agent 的核心价值是"多模态产出物 = 真实交付物":用户付费不是为了"和 AI 聊天",而是为了"拿到一份能直接用的 PPT / 文档 / 视频"。Genspark 用 10 种模态把"AI 输出"升级为"AI 工作交付物",每个模态都自带可分享、可导出、可二次编辑的属性。
2. 文档型模态做深编辑,媒体型模态做再生成:Slides / Sheets / Docs 这类"会反复改"的产物,Genspark 投入做了 Office 级别的内建编辑器;Image / Video / Designer 这类"看一眼定生死"的产物,主打"换种风格再生成一遍",编辑深度故意做浅。这是一个非常清晰的差异化产品策略。
3. AI Edit + Advanced Edit 的双范式是行业标杆设计:对话式改写解决"门槛低、改大动作",手动编辑器解决"精细控制、改细节";两者分层互补,适配从小白用户到专业用户的不同需求。手动编辑不消耗 credits 还激励用户用更经济的方式完成最后 polish。
4. 每个模态都自带独立 URL,把产物变成资产:文档型产物自动分配 shortcode 形式的独立 URL,意味着每个 AI 生成物都可以独立存在、独立分享、独立索引。这一个机制就把"用完即弃的 AI 输出"变成了"用户的作品集",大幅提升留存和粘性。
5. Quick Action 是跨模态接力的关键:每个产出物结束后,Genspark 会在下方推送跨模态的 Quick Action("做成 PPT"、"导出为 Word"、"做成视频"),让用户能用同一份内容在不同模态之间无缝跳转。这是 Super Agent 形成"工作空间网络效应"的设计基础。
6. Genspark 的能力边界仍是"做到 80%90%":几乎所有第三方评测都指出:Genspark 的产出物质量"很扎实但不顶级",用户最后仍要用原生工具(PowerPoint / Photoshop / Premiere)做 10%20% 的精修。这是当前 AI 工作空间产品的共同瓶颈,也是未来产品迭代的最大空间。



> 调研基于:Genspark 官方介绍、OpenAI 案例研究、Lindy/Cybernews/HIX AI/Skywork 等第三方评测整理