Genspark Super Agent trigger-mechanism research

> Complete breakdown of keywords and trigger conditions

Core question: What user input triggers which Super Agent modality?

---

1. Four trigger-decision methods

<a id="super-agent-实际是用四种触发方式叠加判断优先级从高到低触发方式-&#45;判断依据-显式关键词触发-&#45;用户输入包含明确的形式词ppt幻灯片表格画一张图super-agent-直接路由到对应-agent这是最高优先级的判断-隐式意图推断-&#45;用户没说形式词只说目的对比-x演示-y统计-zsuper-agent-通过-llm-推断最适合的模态-中间检查点反问-&#45;意图完全模糊帮我整理一下做个东西super-agent-反问用户选择以快速选项按钮的形式呈现-主动选择快捷入口-&#45;用户在-dashboard-左侧栏直接点击-ai-slides-&#45;ai-sheets-&#45;ai-docs跳过-super-agent-的判断直接进入指定模态"></a>

Super Agent combines four trigger methods, ordered from highest to lowest priority:
Trigger method  Basis① Explicit keywords  Input includes clear format terms (“PPT,” “slides,” “table,” “draw an image,” etc.); Super Agent routes directly to the corresponding Agent. Highest priority
② Implicit intent inference  User specifies purpose (“compare X,” “demonstrate Y,” “calculate Z”) without format terms; LLM infers the most suitable modality
③ Intermediate-checkpoint clarification  Entirely ambiguous intent (“organize this,” “make something”); Super Agent asks users to choose through quick-option buttons
④ Active selection (shortcuts)  User clicks AI Slides / AI Sheets / AI Docs in the dashboard sidebar, bypassing Super Agent judgment and entering the modality directly
---

2. Explicit keyword triggers: full keyword dictionary

<a id="这是最高优先级的触发方式下面是各模态的关键词触发字典中英文双语触发的模态-&#45;中文触发词-&#45;英文触发词ai-slides-&#45;ppt-&#45;幻灯片-&#45;演示文稿-&#45;做个-deck-&#45;报告幻灯片-&#45;投影片-&#45;slide-&#45;slides-&#45;deck-&#45;presentation-&#45;powerpoint-&#45;pitch-deckai-sheets-&#45;表格-&#45;电子表格-&#45;excel-&#45;数据表-&#45;整理成表-&#45;sheet-&#45;spreadsheet-&#45;excel-&#45;table-&#45;data-table-&#45;xlsxai-docs-&#45;文档-&#45;报告-&#45;文章-&#45;写一份-&#45;word-&#45;备忘录-&#45;公文-&#45;doc-&#45;document-&#45;report-&#45;article-&#45;write-&#45;memo-&#45;word-fileai-image-&#45;画一张-&#45;图片-&#45;配图-&#45;插画-&#45;头像-&#45;封面图-&#45;image-&#45;picture-&#45;draw-&#45;paint-&#45;illustration-&#45;cover-&#45;generate-imageai-video-&#45;视频-&#45;短片-&#45;动画-&#45;拍一段-&#45;reel-&#45;抖音视频-&#45;video-&#45;clip-&#45;animation-&#45;film-&#45;instagram-reel-&#45;tiktok-videoai-developer-&#45;代码-&#45;网站-&#45;app-&#45;小游戏-&#45;写函数-&#45;部署-&#45;debug-&#45;code-&#45;website-&#45;app-&#45;game-&#45;function-&#45;build-&#45;deploy-&#45;debugai-designer-&#45;海报-&#45;传单-&#45;logo-&#45;t恤-&#45;设计-&#45;名片-&#45;包装-&#45;poster-&#45;flyer-&#45;logo-&#45;t-shirt-&#45;design-&#45;business-card-&#45;packagingai-pods-&#45;播客-&#45;音频-&#45;朗读-&#45;配音-&#45;tts-&#45;podcast-&#45;audio-&#45;tts-&#45;voice-&#45;narrationdeep-research-&#45;深度研究-&#45;调研-&#45;综述-&#45;深入分析-&#45;盘点-&#45;详细研究-&#45;research-&#45;deep-research-&#45;comprehensive-&#45;in-depth-&#45;surveycall-for-me-&#45;打电话-&#45;帮我打-&#45;预订-&#45;预约-&#45;订餐厅-&#45;询价-&#45;客服-&#45;call-&#45;phone-&#45;book-&#45;make-a-reservation-&#45;appointment-&#45;call-for-medownload-for-me-&#45;下载-&#45;抓取-&#45;帮我下-&#45;收集这些文件-&#45;保存到-drive-&#45;download-&#45;fetch-&#45;scrape-&#45;save-to-drive-&#45;collect-files"></a>

Highest-priority trigger method. Each modality's Chinese/English trigger dictionary follows (Chinese terms rendered as English translations):
Triggered modality  Chinese trigger terms (English translation)  English trigger terms AI Slides  PPT / slides / presentation / make a deck / report slides / projection slides  slide / slides / deck / presentation / PowerPoint / pitch deck
AI Sheets  table / spreadsheet / Excel / data table / organize into a table  sheet / spreadsheet / excel / table / data table / xlsx
AI Docs  document / report / article / write one / Word / memo / official document  doc / document / report / article / write / memo / Word file
AI Image  draw one / picture / accompanying image / illustration / avatar / cover image  image / picture / draw / paint / illustration / cover / generate image
AI Video  video / short film / animation / shoot a clip / Reel / Douyin video  video / clip / animation / film / Instagram reel / TikTok video
AI Developer  code / website / App / small game / write a function / deploy / debug  code / website / app / game / function / build / deploy / debug
AI Designer  poster / flyer / Logo / T-shirt / design / business card / packaging  poster / flyer / logo / T-shirt / design / business card / packaging
AI Pods  podcast / audio / read aloud / voice-over / TTS  podcast / audio / TTS / voice / narration
Deep Research  deep research / research / review / in-depth analysis / inventory / detailed research  research / deep research / comprehensive / in-depth / survey
Call For Me  call / call for me / book / appointment / restaurant reservation / price inquiry / customer service  call / phone / book / make a reservation / appointment / call for me
Download For Me  download / fetch / download for me / collect these files / save to Drive  download / fetch / scrape / save to drive / collect files
---

3. Implicit intent triggers: mapping purpose words to modalities

<a id="当用户没说形式词只说目的super-agent-会用-llm-推断最适合的输出形式这里有一套相对稳定的映射模式用户意图模式-&#45;映射的模态-&#45;判断逻辑对比-&#45;比较-&#45;列-n-个-&#45;内联表格对话流中-&#45;结构是多维度多对象适合表格表达给老板讲-&#45;给客户演示-&#45;路演-&#45;培训-&#45;ai-slidesppt-&#45;演示讲暗示需要分页可视化统计-&#45;算一下-&#45;求和-&#45;趋势-&#45;整理数据-&#45;ai-sheets电子表-&#45;统计算暗示需要单元格计算详细写一下-&#45;起草-&#45;综述-&#45;撰写-&#45;ai-docs长文档-&#45;写起草暗示长形式文档看下-x-长什么样-&#45;生成一个画面-&#45;ai-image-&#45;看画面暗示视觉表达拍一段介绍-&#45;做个宣传-&#45;ai-video-&#45;拍宣传暗示动态内容做一个-x-工具-&#45;实现一个-x-&#45;ai-developer-&#45;做实现在技术语境下暗示代码调研-&#45;盘点-&#45;深入了解-&#45;deep-research-&#45;sparkpage-&#45;调研类需要长内容-&#45;引用-&#45;结构化帮我和-x-联系-&#45;沟通-&#45;跟进-&#45;call-for-me-&#45;邮件-&#45;联系沟通暗示外部行动解释-&#45;是什么-&#45;为什么-&#45;纯对话答复结构化文字-&#45;解释类不需要文档型产出"></a>

When users specify purpose without format terms, the LLM infers the most suitable output. A relatively stable mapping follows (Chinese examples translated):
User intent pattern  Mapped modality  Logic “Compare / contrast / list N”  Inline table (conversation)  Multiple dimensions/objects suit a table
“Explain to boss / demonstrate to clients / pitch / training”  AI Slides (PPT)  Demonstrating/explaining implies paginated visuals
“Calculate statistics / calculate / sum / trends / organize data”  AI Sheets (spreadsheet)  Statistics/calculation implies cell calculations
“Write in detail / draft / review / compose”  AI Docs (long document)  Writing/drafting implies long-form documents
“See what X looks like / generate a scene”  AI Image  Seeing/scenes imply visual expression
“Shoot an introduction / make a promotion”  AI Video  Shooting/promotion implies dynamic content
“Make an X tool / implement X”  AI Developer  Making/implementing in technical contexts implies code
“Research / inventory / understand deeply”  Deep Research → Sparkpage  Research requires long content + citations + structure
“Contact / communicate / follow up with X”  Call For Me / email  Contact/communication implies external action
“Explain / what is / why”  Plain conversational reply (structured text)  Explanations do not need document artifacts
---

4. Intermediate-checkpoint triggers: clarifying ambiguous intent

When input is entirely ambiguous (an action with neither form nor purpose), Super Agent proactively asks. This key design gives users the choice instead of risking an incorrect modality.

Typical clarification scenarios (English translations)
Ambiguous input  Super Agent options “Organize the competitor analysis”  [📊 PPT, for presenting] [📑 Word report, for archiving] [📈 Comparison table, for viewing] [💬 List it here]
“Make something for clients”  [📊 Presentation PPT] [📑 Proposal document] [🎨 Poster] [📹 Introduction video] [Tell me more]
“Help with tomorrow's meeting”  [📑 Prepare agenda document] [📊 Prepare opening PPT] [💬 List key points] [📞 Call to confirm]
Three clarification design rules

- Usually 3-5 options, at most 5, to avoid choice overload
- Each option has one emoji + short label + one explanatory line (“for presenting”/“for archiving”), making differences immediately clear
- Retain “Tell me more” or “List it here” as fallback, avoiding forced choices

---

5. Active selection: shortcuts bypassing routing

Users can bypass Super Agent judgment entirely and select the desired modality directly. This explicit-selection entry suits users who know what they want.

Two active-selection methods

- Click left navigation: Dashboard sidebar lists all Agents (AI Slides / AI Sheets / AI Docs / AI Developer / AI Designer, etc.); clicking opens a modality-specific interface directly
- Visit a direct URL: Each Agent has an independent URL (e.g. `genspark.ai/agents?type=slides_agent`) for direct navigation

Product purpose: Super Agent intelligent routing serves newcomers unsure what to use; active selection serves experienced users who know what they want. Both coexist for different user stages.

---

6. Multiple modalities from one sentence (multiple-tag triggers)

An advanced Super Agent capability is triggering multiple modalities from one input, chained as a pipeline. This fundamentally distinguishes it from single-Agent tools.

Typical multiple-tag examples (English translations)
Input  Triggered modality sequence “Research SaaS and make a PPT for my boss”  `[RESEARCH]` → `[SLIDES]`
“Compare 3 hotels, then call the best one to confirm family rooms”  `[RESEARCH]` → `[SHEETS]` (comparison table) → `[CALL]`
“Find 20 YouTube AI videos, make a table, then write an analysis”  `[RESEARCH]` → `[SHEETS]` → `[DOCS]`
“Make a product introduction video: write a script, draw a cover, then edit the video”  `[DOCS]` (script) → `[IMAGE]` (cover) → `[VIDEO]`
During Plan, Super Agent explicitly shows the full pipeline and each step's modality so users see the complete path before execution.

---

7. Key observations and design implications

1. Keywords form a fast path; intent forms an intelligent path: Exact format terms use direct keyword matching without LLM semantic judgment; purpose-only input uses LLM inference. Combining both provides speed and intelligence.
2. Tags decouple LLM decisions from generation: The LLM need only recognize a PPT request, not know how to draw slides. New modalities require only a new tag + endpoint, without changing the LLM itself.
3. Clarification respects users more than guessing: For ambiguous intent, give users 3-5 buttons with one explanatory line each for immediate selection. Avoids frustration from wrong AI choices and wasted credits repeatedly changing format.
4. Active selection is the experienced-user shortcut: Intelligent routing serves newcomers; experienced users knowing their goal enter AI Slides faster from the sidebar. Both entry types cover the user-maturity spectrum.
5. One sentence can trigger a modality pipeline: This fundamentally differs from single-Agent tools. “Research and make a PPT for my boss” triggers `[RESEARCH]` → `[SLIDES]` with no intermediate user intervention.
6. Trigger keywords cover Chinese/English and synonyms: Genspark's carefully designed dictionary includes format terms, synonyms, industry terminology, and colloquial expressions, letting users trigger the correct modality in their usual wording.