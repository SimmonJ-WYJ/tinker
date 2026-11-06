# ADR-005：OPENSCI 作为 ASCI 唯一身份提供方

| 字段 | 内容 |
|------|------|
| **状态** | Proposed（grill-with-docs 会话裁决 2026-06-01，待产研 Lead 正式签字）|
| **决策日期** | 2026-06-01 |
| **拍板人** | （待填，建议产研 Lead）|
| **关联** | [0.3.0 PRD](../specs/0.3.0/0.3.0-prd.md) Epic 1 / §3 · 0.3 north-star §一 / §十.2 · [ADR-002](./ADR-002-server-stack.md) ③认证策略 |

---

## 一、背景

0.3 引入用户账户体系以支持公开发布（身份、行为遥测归属、未来跨设备同步）。0.3 north-star §一原计划**自建 ASCI 独立账户体系**（Email + 密码注册/重置、Google/ORCID OAuth 直接接入），§一.2 将 `linkedOpenSciId` 仅作"预留位"，§十.2 明确"**不做 OPENSCI OAuth 绑定（仅预留字段）**"。

0.3 启动前的产研复盘改变了这一方向：ASCI 隶属 OPENSCI 生态，应统一身份，不另起一套账户。

## 二、决策

**ASCI 不自建账户体系，委托 OPENSCI 作为唯一登录入口（OAuth/OIDC）。**

- 登录唯一入口 = OPENSCI；Email/Google/ORCID 等具体登录方式由 OPENSCI 提供。
- ASCI 服务端仅持有**用户映射表**（OPENSCI uid → ASCI user），用途限于身份与行为遥测归属，**不存储 profile**。
- 用户 profile（昵称/头像/机构/学科）**实时读 OPENSCI，只读展示**。
- ASCI 本地仅加密缓存 OPENSCI 颁发的 token（safeStorage，刷新轮转）。
- 强制登录。

## 三、理由与取舍（委托 vs 自建）

| | 委托 OPENSCI（选中） | 自建账户（否决） |
|---|---|---|
| 生态身份 | ✅ 统一 OPENSCI 身份 | ❌ 又一套孤立账户 |
| Lead-time | ✅ ASCI 免自申 Google/ORCID OAuth client、免建注册/密码/邮件验证链路 | ❌ OAuth verification + 邮件域认证 2-4 周 lead-time |
| 安全面 | ✅ 不持密码/凭据，账户攻击面收敛到 OPENSCI | ❌ ASCI 自担密码存储/重置/防护 |
| 控制力 | ❌ 登录方式与可用性受 OPENSCI 约束 | ✅ 完全自控 |
| 依赖风险 | ❌ 强依赖 OPENSCI SSO 就绪（0.3 期间并行建设，中等风险）| ✅ 无外部强依赖 |

净评估：在 ASCI 隶属 OPENSCI 生态的前提下，委托带来的"统一身份 + lead-time + 安全面收敛"显著优于自建，代价是引入对 OPENSCI SSO 就绪的强依赖（通过接口契约尽早冻结 + 降级路径缓解）。

## 四、与既有规划的反转

本决策**反转** north-star §一（"自建账户体系"）与 §十.2（"不做 OPENSCI OAuth 绑定"）。OPENSCI 从"预留绑定位"升为"唯一身份源"。

## 五、后果

- north-star §一 U1/U2/U3（注册 / 邮箱验证 / 多 OAuth 绑定）**归 OPENSCI**，ASCI 不实现；U4/U5（token 本地加密 / 刷新轮转）ASCI 保留。
- §二认证服务从"自建认证"变为"OPENSCI SSO 对接 + 用户映射 + 行为归属"。
- §五-A 中 ORCID/Google OAuth client 申请的 lead-time **转移到 OPENSCI**；ASCI 侧新增"**OPENSCI SSO OAuth/OIDC 接口契约冻结 + 就绪时点**"作为发布前置依赖。
- ADR-002 ③认证策略需据此收敛（认证对接 OPENSCI，而非自写/Auth0/Clerk）。
- **风险**：OPENSCI SSO 在 0.3 期间并行建设，延误会阻塞账户 epic；缓解 = 接口契约尽早冻结，降级路径（临时 placeholder 登录 / 账户推 0.4）由产研 Lead 决策。
