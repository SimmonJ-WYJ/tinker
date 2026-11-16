<a id="google-桌面登录配置"></a>

# Google Desktop Login Configuration

Tinker authorizes directly with Google through the system browser, without the OPENSCI login service. The installer must include Google Desktop client configuration; users need not create configuration files manually. Unconfigured development environments display a configuration prompt and do not simulate login.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/) and open Google Auth platform.
2. Configure Branding (application name, support email) and Audience. For external applications in Testing status, add the actual login email to Test users; when publishing, complete necessary verification as prompted by Google.
3. Create an OAuth client in Clients; Application type must be **Desktop app**. Do not use a Web application client or add an OPENSCI callback.
4. Development environments can create `auth-google.json` in the local configuration directory: unpackaged development builds use `~/.asci-dev/`, and old production versions use `~/.asci/`. Packaged Tinker Candidate uses `~/Library/Application Support/Tinker Candidate/.asci/`. When starting with ASCI_DEV or a custom data directory, use the actual configuration directory. Local overrides take priority; otherwise read the installer's `Resources/auth-google.json`.

```json
{
  "clientId": "YOUR_DESKTOP_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_DESKTOP_CLIENT_SECRET_IF_PROVIDED"
}
```

`clientSecret` is optional; if the downloaded Desktop client JSON supplies `client_secret`, include it. Google's installed-app documentation marks it optional in the authorization-code exchange table; some client configurations require it. Desktop clients cannot treat this value as a trusted server secret; security relies on PKCE and state. Do not commit real configuration to Git.

<a id="打包时携带配置"></a>

### Bundling Configuration

- Place application client configuration in `apps/electron/resources/auth-google.json`. Git ignores this file; do not commit real configuration.
- The project's local `local-config/auth-google.json` only retains packaging material and is likewise not committed. Select it explicitly using `TINKER_GOOGLE_AUTH_CONFIG=/绝对路径/auth-google.json` (the path placeholder means an absolute path).
- Without an explicit path, try the project resources configuration, macOS Tinker Candidate's local configuration, then old `~/.asci/auth-google.json`. An invalid explicit path fails directly rather than substituting another client.
- Normal electron-builder packaging runs `beforePack` / `afterPack` checks. The former validates and creates temporary configuration; the latter verifies that the actual Resources file matches the prepared configuration. Missing, corrupt, or inconsistent configuration fails packaging. `--prepackaged` skips normal packaging hooks; explicitly call `afterPack` validation on an existing app before repackaging it.
- Configuration permits only `clientId` and optional `clientSecret`. User access/refresh tokens, cached personal profiles, and session files are excluded from installers.
- CI must provide client configuration through a controlled local file or `TINKER_GOOGLE_AUTH_CONFIG`. A fresh clone without configuration fails explicitly rather than generating an installer with unusable login.
- For acceptance, use an isolated directory without local OAuth configuration to check installer configuration fallback and system-browser authorization entry. Real Google authorization and account status still require manual confirmation.

<a id="登录验收"></a>

### Login Acceptance

5. Start Tinker and click “Sign in with Google.” The browser requests `openid email profile` permissions and redirects to a temporarily listening `http://127.0.0.1:<随机端口>/callback` (the placeholder means a random port). If the system firewall blocks local loopback, allow local connections. Authorization cancels after 5 minutes without completion and can be retried.
6. After login, close and restart the application to confirm session restoration; signing out clears only the local session. “Disconnect Google account” in account settings revokes ASCI authorization without deleting the Google account or clearing the local research library.

Tokens are held only in the main process and encrypted through Electron safeStorage into `auth-google-tokens.enc`; personal profiles are stored separately in `auth-google-user.json`. Google tokens and profiles are bound to the Desktop clientId that created them; changing or removing configuration invalidates old sessions and requires login again. Old refresh tokens are never sent to a new clientId. Old OPENSCI tokens and profiles are not restored as Google sessions. Google tokens are not used for OPENSCI journal or service requests.

Google OAuth Testing status may limit refresh-token validity; sign in again after expiration or revocation. Network errors appear on the login screen. For redirect_uri_mismatch or invalid_client, confirm that this is a Desktop client and that clientId/optional clientSecret come from the same client. Real authorization acceptance requires valid client configuration and an allowed test account; automated tests do not establish successful real Google authorization.

Reference: [Google OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app).
