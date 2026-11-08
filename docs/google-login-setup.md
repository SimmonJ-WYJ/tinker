# Google 桌面登录配置

Tinker 使用系统浏览器直接向 Google 授权，不再经过 OPENSCI 登录服务。安装包必须自带 Google Desktop 客户端配置，用户无需手动创建配置文件。尚未配置的开发环境会显示配置提示，不会模拟登录。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目，打开 Google Auth platform。
2. 配置 Branding（应用名称、支持邮箱）和 Audience。外部应用在 Testing 状态时，将实际登录邮箱加入 Test users；发布应用时按 Google 的提示完成必要验证。
3. 在 Clients 创建 OAuth client，Application type 必须选择 **Desktop app**。不要使用 Web application 客户端或添加 OPENSCI 回调。
4. 开发环境可在本机配置目录创建 `auth-google.json`：未打包开发版使用 `~/.asci-dev/`，旧正式版使用 `~/.asci/`。Tinker Candidate 打包版使用 `~/Library/Application Support/Tinker Candidate/.asci/`。如果用 ASCI_DEV 或自定义数据目录启动，以实际配置目录为准。本地覆盖优先，否则读取安装包 `Resources/auth-google.json`。

```json
{
  "clientId": "YOUR_DESKTOP_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_DESKTOP_CLIENT_SECRET_IF_PROVIDED"
}
```

`clientSecret` 为可选字段；如果下载的 Desktop client JSON 提供了 `client_secret`，请一并填写。Google 的 installed-app 文档在授权码兑换表中将其标为可选；某些客户端配置会要求它。桌面客户端不能把该值当作可信的服务器秘密，安全保护依赖 PKCE 和 state。不要把真实配置提交到 Git。

### 打包时携带配置

- 将应用客户端配置放在 `apps/electron/resources/auth-google.json`。该文件由 Git 忽略，不能提交真实配置。
- 本项目本机另存的 `local-config/auth-google.json` 仅用于保留打包材料，同样不提交。可以通过 `TINKER_GOOGLE_AUTH_CONFIG=/绝对路径/auth-google.json` 明确选择它。
- 没有显式路径时，依次尝试项目 resources 配置、macOS Tinker Candidate 的本地配置、旧 `~/.asci/auth-google.json`。显式路径无效时直接失败，不替换成别的客户端。
- 常规 electron-builder 打包入口运行 `beforePack` / `afterPack` 检查。前者验证后生成临时配置，后者检查实际 Resources 文件与准备的配置一致。缺失、损坏、不一致均使打包失败。`--prepackaged` 会跳过常规打包 hook，重新封装现有 app 时必须先对该 app 显式调用 `afterPack` 验证。
- 配置只允许 `clientId` 和可选 `clientSecret`。用户 access/refresh token、缓存个人资料和会话文件都不进入安装包。
- CI 必须通过受控本地文件或 `TINKER_GOOGLE_AUTH_CONFIG` 提供客户端配置。新克隆缺配置时会明确失败，不再生成登录不可用的安装包。
- 验收时使用没有本地 OAuth 配置的隔离目录，检查安装包配置回退与系统浏览器授权入口。真实 Google 授权和账号状态仍需人工确认。

### 登录验收

5. 启动 Tinker，点击「使用 Google 登录」。浏览器会请求 `openid email profile` 权限，并回调到临时监听的 `http://127.0.0.1:<随机端口>/callback`。若系统防火墙阻止本机 loopback，请允许本机连接。5 分钟未完成将取消，可重试。
6. 登录后关闭重启应用，确认会话恢复；退出只清本地会话。账户设置中的「断开 Google 账户」撤销 ASCI 授权，不删除 Google 账户，也不清理本地研究库。

令牌只在主进程持有，通过 Electron safeStorage 加密至 `auth-google-tokens.enc`；个人资料单独存于 `auth-google-user.json`。Google token 和 profile 同时绑定创建它们的 Desktop clientId；更改或移除配置会使旧会话失效，需要重新登录，旧 refresh token 不会发送给新 clientId。旧 OPENSCI token 和 profile 不会恢复为 Google 会话。Google token 不用于 OPENSCI journal 或服务请求。

Google OAuth 的 Testing 状态可能限制 refresh token 有效期；遇到过期或撤销后请重新登录。网络错误会显示在登录界面。若出现 redirect_uri_mismatch 或 invalid_client，确认使用 Desktop client、clientId/可选 clientSecret 来自同一客户端。真实授权验收需要有效客户端配置和允许的测试账号；自动化测试不代表已通过真实 Google 授权。

参考：[Google OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)。
