# Tauri SDK历史只读接线实施计划

状态：用户在合并PR #7后授权下一阶段。基线main fdf92f3bb758d04c6f469fe8915d62e41a15f36b。领域事实源：Electron appendSDKMessages/getAgentSessionSDKMessages、共享SDKMessage类型及上一阶段只读分页器。

## 范围和契约

保留旧read_history接口与全部草稿命令，复用行/页预算扩展新read_sdk_history。原始SDK与legacy可混排，原始JSON字段完整保留，不丢工具块、图片引用、父run、uuid或未知未来消息。只提取text块作安全文本展示，不执行工具或渲染原始HTML。

返回SDKHistoryPage：camelCase JSON `{protocolVersion:1,entries:[{lineNumber,kind,text,uuid,raw}],nextBeforeLine,incompleteTail}`。uuid为string或null，raw为完整JSON对象。源行游标、单行1MiB、页最多256条及8MiB源行预算沿用。默认64条。SDK user/assistant校验message与content基本形状，未来类型保留opaque。旧AgentMessage继续严格验证。

新增真实Tauri命令read_session_history(sessionId,beforeLine?,limit?)，固定读取Rust Lab app_local_data_dir()/history-v1/<id>.jsonl，前端不能传路径。ID受限ASCII 1..64，拒绝符号链接/目录/越界路径，不创建或写入历史目录/文件。只读工作在spawn_blocking，独立非等待门控，避免阻塞UI或多重解码。错误返回固定码，不含原日志/绝对路径。

实验React界面提供独立的折叠历史阅读区、会话ID、读取/较早/最新页和尾行提示，中英文走现有useT字典。一次只保留一页，失败保留当前页，选择变化或竞态不串会话。所有展示均安全文本，不接图片文件读取或模型执行。

生产不会自动扫描或导入Electron数据。验收只用源代码结构构造的合成SDK夹具和独立QA目录，真实历史需要后续用户授权导出副本。当前API接线可用不代表原应用历史已迁移。

## 用户补充的生产不变约束

用户要求“你这次改完确保界面和功能还有UI没有任何变化吧？”本阶段生产Electron、shared/core/ui及现有依赖锁文件必须与基线完全一致。新增阅读区仅属于隔离Rust Lab/QA，不能带入生产入口、布局、样式或交互。安装版不更新；以源码范围核验、既有功能回归和实机证据区分，不能保证未测全流程。

## 任务

1. SDK解析：新增先失败测试和TS共享fixture，重用有界扫描器，保留原简化读取器与基准工具兼容。
2. Tauri接线：只读历史服务、固定错误码、独立命令模块与注册，隔离临时文件测试，Tauri真实Invoke处理链通过mock runtime测试。
3. 前端阅读：严格响应解码、分页和错误/竞态测试，双语只读界面，不改草稿行为。
4. 验收与回滚：fmt/test/clippy、前端typecheck/build、全仓test/Electron build。尽量在独立identifier的本地QA应用验证原生bridge，只放合成文件，不启动或写入现行Tinker。北京时间02:00（UTC18:00）停止启动新增实现/长操作。
5. 审查与Draft PR：保护原89个未提交文件的当前指纹，不包含真实日志、密钥或构建产物。验证无冲突后正常钩子提交和推送独立分支，Draft、不合并、不安装，核验远端SHA与CI。

## 回滚

现行安装和Electron不变。移除新增历史command注册、独立state与前端panel可回到原草稿Rust Lab；恢复旧read_history接口无需改数据。历史仅读，文件无回写/修复/迁移。回退本PR不会删除独立历史副本。源码只读边界不是防御同一系统用户主动并发替换文件的完整沙箱。
