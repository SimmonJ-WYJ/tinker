# Google 桌面登录配置

ASCI 使用系统浏览器直接向 Google 授权，不再经过 OPENSCI 登录服务。尚未配置 OAuth 时，登录按钮会显示配置提示，不会模拟登录。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目，打开 Google Auth platform。
2. 配置 Branding（应用名称、支持邮箱）和 Audience。外部应用在 Testing 状态时，将实际登录邮箱加入 Test users；发布应用时按 Google 的提示完成必要验证。
3. 在 Clients 创建 OAuth client，Application type 必须选择 **Desktop app**。不要使用 Web application 客户端或添加 OPENSCI 回调。
4. 在本机配置目录创建 `auth-google.json`：未打包开发版使用 `~/.asci-dev/`，正式版使用 `~/.asci/`。如果用 ASCI_DEV 或自定义数据目录启动，以实际配置目录为准。

```json
{
  "clientId": "YOUR_DESKTOP_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_DESKTOP_CLIENT_SECRET_IF_PROVIDED"
}
```

`clientSecret` 为可选字段；如果下载的 Desktop client JSON 提供了 `client_secret`，请一并填写。Google 的 installed-app 文档在授权码兑换表中将其标为可选；某些客户端配置会要求它。桌面客户端不能把该值当作可信的服务器秘密，安全保护依赖 PKCE 和 state。不要把真实配置提交到 Git。

5. 启动 ASCI，点击「使用 Google 登录」。浏览器会请求 `openid email profile` 权限，并回调到临时监听的 `http://127.0.0.1:<随机端口>/callback`。若系统防火墙阻止本机 loopback，请允许本机连接。5 分钟未完成将取消，可重试。
6. 登录后关闭重启应用，确认会话恢复；退出只清本地会话。账户设置中的「断开 Google 账户」撤销 ASCI 授权，不删除 Google 账户，也不清理本地研究库。

令牌只在主进程持有，通过 Electron safeStorage 加密至 `auth-google-tokens.enc`；个人资料单独存于 `auth-google-user.json`。Google token 和 profile 同时绑定创建它们的 Desktop clientId；更改或移除配置会使旧会话失效，需要重新登录，旧 refresh token 不会发送给新 clientId。旧 OPENSCI token 和 profile 不会恢复为 Google 会话。Google token 不用于 OPENSCI journal 或服务请求。

Google OAuth 的 Testing 状态可能限制 refresh token 有效期；遇到过期或撤销后请重新登录。网络错误会显示在登录界面。若出现 redirect_uri_mismatch 或 invalid_client，确认使用 Desktop client、clientId/可选 clientSecret 来自同一客户端。真实授权验收需要有效客户端配置和允许的测试账号；自动化测试不代表已通过真实 Google 授权。

参考：[Google OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)。
