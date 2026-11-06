# ASCI 登录页 Figma 实现

状态：已实现；完成页面级验证
关联 issue / PR：无（本地修改）
领域事实源：docs/design.md、docs/i18n.md、现有 Google OAuth 入口
设计稿：https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/ASCI?node-id=22-2

## 设计与范围

- 在 ASCI-MacOS 当前工作区修改 LoginPage，保留已有 Google OAuth 开发成果。
- 桌面端复现黑白双栏：左侧浅灰品牌区、AI Coding 标题、三张同规格白色卡片；右侧欢迎、登录、取消、本地数据提示与条款。
- 复用正式 AsciIcon 与现有 GoogleIcon；按钮登录 Google，因此使用匹配的 Google 标识。
- 复用 Button、TitlebarDragRegion、语义颜色 token，遵守系统无衬线字体规范；不新增依赖、不改全局主题。
- 所有新增文案同步 en/zh；小窗口纵向布局并允许滚动，暗色使用现有语义 token 自适应。
- 保留 OAuth start/cancel、pending、错误提示、关闭窗口与法律链接行为。

## 实施计划

- [x] 添加登录交互回归测试，覆盖 Google 启动、pending 取消、法律链接、双语卡片。
- [x] 更新 en/zh login.json；组合现有组件实现页面与局部响应式样式。
- [x] 运行登录测试、双语 key 校验、全仓 typecheck 和测试、renderer build；既存错误单独记录。
- [x] 渲染 1440×960 目标画面，检查窄窗、暗色、英文与中文，以及 pending/错误状态。

## 行为验收

1. 未登录时可见三张完整卡片，第三张与前两张同规格并含副标题。
2. 点击 Google 登录仅触发现有 Google provider，并进入等待态；取消恢复登录按钮。
3. 授权失败仍可重试；法律链接通过 electronAPI.openExternal 打开。
4. 英文和中文均无 raw key；窗口缩小时按钮可达、页面无横向溢出。

## 验证记录

- 类型检查：全 monorepo 通过；renderer 生产构建通过。
- 登录页与 i18n key 校验：16 项通过；Google OAuth / bridge 回环相关测试在允许本地监听时 14 项通过。
- ESLint：登录组件及测试通过。按用户已确认稿件保留辅助文案 10–12px，文件级列明最小字号规则例外；不修改全局字号设置。
- 浏览器直接挂载实际 LoginPage（临时测试入口，验收后删除）：1440×960 与 Figma 对比，核对正式 ASCI 标志及 Google 登录标志、56px 按钮、24px 登录图标、三张 608×108 白卡与完整副标题；390px / 1024px 窗口无横向溢出；en/zh、暗色、等待/取消、授权失败重试、法律链接均通过，无页面 JS 异常。
- 全仓测试：2987 通过、3 失败。未修改的 Tooltip / floating-surface 圆角断言失败 2 项，内置能力包加载 beforeEach/afterEach 超时 1 项；本次不改动这些组件。
- 未执行真实 Google 账户授权，未替换已安装客户端。
