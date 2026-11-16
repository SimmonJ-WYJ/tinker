<a id="账户老用户升级无缝-&#45;预期管理文案-技术方案legacy-upgrade-seamless-spec"></a>

# Account: Seamless Legacy Upgrade + Expectation-Setting Copy Technical Plan (Legacy Upgrade Seamless Spec)

> **Status**: Implemented · Awaiting review
> **Related issue**: [#425](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/425) (Epic 1 slice 1.4, U-A4/U-A6)
> **Related PR**: Not yet opened
> **Decision implemented**: Section B chooses **complete removal** rather than fixing counts; see §4.B
> **Domain language source of truth**: `docs/specs/0.3.0/0.3.0-prd.md` §1 three data categories + Epic 1
> **Input dependency**: #420 (OPENSCI end-to-end sign-in, implemented: commit `5b98caf9` / `account-oauth-arch-spec.md` §8)
> **Blockers**: None (#420 merged)

---

<a id="1-背景与问题"></a>

## 1. Background and Problem

The PRD §3 comparison contains an **architectural reversal**:

| Original north-star assumption | 0.3 PRD conclusion |
|------------------|-------------|
| Research data **isolated by account** | **One device-level local library** (aligned with Zotero); accounts identify users only; existing libraries are **usable immediately on sign-in without claiming ownership** |

Current code follows the old account-isolation/claiming assumption: implementing sign-in (#420/#531) also introduced an entire **legacy-user attribution flow**, directly conflicting with 0.3's device-level/no-claiming decision. This plan **removes** that flow, adds U-A6 expectation-setting copy, and guards U-A4 with tests.

<a id="11-两个核心发现"></a>

### 1.1 Two Core Findings

**Finding 1: Attribution is obsolete (conflicts with PRD).**
`LoginPage` shows an `UpgradeNotice` banner with a checkbox to associate local data with the account, calls `auth.attributeLocalData()` on sign-in to write `OwnerMarker{ uid, attributedFrom }` into `~/.asci/owner.json`, and retains a `ConflictWarning` dialog asking how to handle data belonging to another account. **This is precisely the claiming flow the PRD explicitly removes**: under device-level library semantics, data belonging to an account is not a valid concept (US11: switching accounts on one device shows the same library).

**Finding 2: Attribution is broken (scans incorrect storage locations).**
`auth-upgrade.ts:scanLocalData()` determines whether data exists by **counting `.json` files in `~/.asci/papers/`, `~/.asci/notes/`, `~/.asci/evidence-sets/`**. Research data actually resides in **SQLite (`~/.asci/asci.db`, 7 tables)**; those per-object JSON directories do not exist. Thus `hasLocalData` is always `false` for real users, the banner never appears, and `AccountMenu` local data counts stay empty: **completely dead logic for real users**.

> Corroboration: `ConflictWarning.tsx` is already **pure dead code** (no references outside itself; zero repository-wide grep hits).

<a id="12-为什么-u-a4-其实几乎天然成立"></a>

### 1.2 Why U-A4 Is Almost Inherent

Research data (`asci.db` + JSONL + review bodies) and system credentials (`channels.json` / `settings.json` / `mcp.json` / `proxy-settings.json` / `zotero/`) are **all device-level under `~/.asci/`, with no `uid/accountId/ownerId` schema columns; queries filter only by `workspace_id`** (see `config-paths.ts`, `migrations/001-initial.sql`). Sign-in is only a UI gate (`RouteGuard`); it does not migrate, relocate, or clear storage paths.

Thus U-A4 (upgrade + first sign-in → existing data/configuration immediately usable) requires **removing the obstructing attribution flow + tests preserving this invariant**, rather than migration work.

---

<a id="2-目标与非目标"></a>

## 2. Goals and Non-Goals

<a id="目标"></a>

### Goals
1. **U-A4**: Legacy upgrade + first OPENSCI sign-in → existing papers/notes/evidence sets immediately visible; Zotero/Provider/proxy/MCP immediately usable without reentry or **claiming**.
2. **U-A6**: Welcome page (LoginPage) / account page (ProfileSettings) explicitly state research data stays local.
3. Remove obsolete/broken attribution and its associate-data checkbox, a friction point **directly conflicting with seamlessness**.

<a id="非目标"></a>

### Non-Goals
- Cross-device sync (0.4, with **no promised schedule**).
- Same-device account data isolation (0.3 deliberately shares at device level).
- Object-level `ownerUid`, server identity mapping tables (closed-source server repo / 0.4).
- DO2 export / DO3 account deletion (Epic 4, separate issues).

---

<a id="3-️-文案口径修订必须先对齐"></a>

## 3. ⚠️ Copy Policy Revision (Align First)

Issue #425 says research data stays local in 0.3 and cross-device sync **will arrive in 0.4** (English translation). However PRD Epic 1 (2026-06-01 grill revision, synchronized in `account-oauth-arch-spec`) **withdrew the 0.4 sync promise**:

> English translation: The original promise of cross-device sync in 0.4 is **withdrawn**. 0.4 does not implement sync, and **no sync schedule is promised to users**. All Epic copy states data is local without promising a schedule.

**The PRD governs** (CLAUDE.md: PRD prevails in conflicts). User-facing copy **only says research data stays local and missing data on another device is expected; never promise “0.4” or a future delivery date**. Confirm this with the issue author at review.

---

<a id="4-技术方案"></a>

## 4. Technical Approach

Four changes: **A remove attribution** / **B fix device-library detection** / **C expectation-setting copy** / **D guard tests**.

<a id="a-拆除认领attribution流程"></a>

### A. Remove the Attribution Flow

| Action | Location |
|------|------|
| Delete components | `renderer/components/auth/UpgradeNotice.tsx`, `renderer/components/auth/ConflictWarning.tsx` (already dead code) |
| Delete i18n sections | `locales/{en,zh}/auth/upgrade.json`, `locales/{en,zh}/auth/conflict.json` |
| Update aggregators | `locales/{en,zh}/auth.ts`: remove `upgrade` / `conflict` imports and export keys |
| Delete IPC channel | `shared/types/auth-ipc.ts`: delete `ATTRIBUTE_LOCAL_DATA` (retain `SCAN_LOCAL_DATA`, see B) |
| Delete main handler | `ATTRIBUTE_LOCAL_DATA` registration at `main/ipc.ts:2784` |
| Delete preload bridge | `attributeLocalData` method + type in `preload/index.ts` (around :968 / :1899) |
| Delete service method | `auth-service.ts:attributeLocalData()` (:304-315) |
| Delete types | `shared/types/auth.ts`: `OwnerMarker` interface, `LocalDataSnapshot.attributedTo` |
| Delete owner.json reads/writes | `auth-upgrade.ts`: `readOwnerMarker` / `writeOwnerMarker` / `FILE_OWNER` / `OwnerMarker` references |
| Update sign-in page | `LoginPage.tsx`: remove `UpgradeNotice`, `attributeData` state, `attributeLocalData()` call (:37,:54-56,:69-76) |

> **owner.json cleanup**: If historical users wrote `~/.asci/owner.json` (unlikely because measured paths miss), it becomes an unread orphan with no side effects; no active deletion needed. A one-time cleanup can be considered at review, but prefer omitting it to avoid touching user directories.

<a id="b-全删设备库探测子系统最终决策"></a>

### B. Remove the Entire Device-Library Detection Subsystem (Final Decision)

> **Decision (2026-06-15)**: The original spec left count repair vs. complete removal open; **complete removal** was selected because ① the user wants dormant attribution code removed; ② counts are always empty for real users due to incorrect scanning and have never been seen, so repairing them **adds** reassurance functionality instead of cleanup; ③ removal avoids new main-process `auth → object-store` coupling. §C copy provides reassurance that data remains.

Remove the whole chain:

- Delete `SCAN_LOCAL_DATA`, `localDataSnapshotAtom`, `auth-service.scanLocalData()`, all of `auth-upgrade.ts`, and `AuthServiceDeps.userDataPath`.
- Delete `LocalDataSnapshot` itself (no consumers remain).
- Remove startup `scanLocalData()` from `useAuth.ts` (retain only `getCurrentUser` + `getSessionMeta`).
- Delete the entire local-data count block in `AccountMenu.tsx` + `menu.localData` / `menu.localDataCounts` i18n keys.

> Net effect: Lighter sign-in initialization (one fewer IPC call), zero new main-process coupling.

<a id="c-预期管理文案u-a6"></a>

### C. Expectation-Setting Copy (U-A6)

New i18n keys (synchronized en + zh through `useT('auth')`):

- Add `localDataNotice` to `auth/login.json`: Small footnote below sign-in buttons.
  - en: `"Your research data stays on this device only. Switching devices won't show it — that's expected."`
  - zh: `"你的研究数据仅存本地。换设备暂时看不到数据属于预期行为。"` (same meaning as the English notice).
- Add `dataLocality.title` + `dataLocality.body` to `auth/profile.json`: Read-only card in the account tab (`ProfileSettings`).
  - title en: `"Where your data lives"` / zh: `"你的数据存在哪里"` (same meaning).
  - body en: `"Research data (papers, notes, evidence sets) is stored locally in ~/.asci/ on this device. It is not uploaded and does not sync across devices."`
  - body zh: `"研究数据（论文、笔记、证据集）仅保存在本机 ~/.asci/，不会上传，也不跨设备同步。"` (same meaning).

Locations:
- `LoginPage.tsx`: Add `localDataNotice` below sign-in buttons (shown outside oauthPending state).
- `ProfileSettings.tsx`: Add a read-only `dataLocality` card below account information (semantic tokens, card + soft background, following `docs/design.md`).

> Follow §3 strictly: **No sync schedule**.

<a id="d-验证实际执行"></a>

### D. Validation (Actually Executed)

Because B removes attribution entirely, including `auth-upgrade.ts` and tests, the planned actual scanLocalData count tests **no longer apply**. Actual validation checks that removal preserves existing contracts:

1. `bun run typecheck`: Entire monorepo passed (including effects of shared type deletion).
2. `bun test`: Full suite **2535 pass / 0 fail** (including 80 pass across the original 9 auth test files, confirming channel/method deletion preserves sign-in).
3. `key-parity.test.ts`: Passed (en/zh aligned after removing `upgrade`/`conflict` + `menu.localData*` and adding `login.localDataNotice` + `profile.dataLocality.*`).
4. Zero grep residuals: `scanLocalData|attributeLocalData|LocalDataSnapshot|OwnerMarker|UpgradeNotice|ConflictWarning|localDataSnapshotAtom|SCAN_LOCAL_DATA|ATTRIBUTE_LOCAL_DATA|auth-upgrade` yields 0 hits in `apps/electron/src` + `packages/shared/src`.

> U-A4's device-level-storage/no-relocation invariant is already guaranteed by `config-paths.ts` (paths change only with `ASCI_DEV`, without uid segments). This layer was unchanged, so redundant path tests are unnecessary.

---

<a id="5-ipc-四联同步影响"></a>

## 5. Four-Way IPC Synchronization Impact

| Layer | Change |
|----|------|
| `shared/types/auth-ipc.ts` | Delete `ATTRIBUTE_LOCAL_DATA` + `SCAN_LOCAL_DATA` constants |
| `shared/types/auth.ts` | Delete `LocalDataSnapshot` + `OwnerMarker` |
| `main/ipc.ts` | Delete `ATTRIBUTE_LOCAL_DATA` + `SCAN_LOCAL_DATA` handlers |
| `preload/index.ts` | Delete `auth.attributeLocalData` + `auth.scanLocalData` (types + bridge + `LocalDataSnapshot` import) |
| `renderer` | Remove claiming from `LoginPage`, add `localDataNotice`; remove `AccountMenu` counts; delete `localDataSnapshotAtom` from `auth-atoms`; remove `scanLocalData` call from `useAuth` |

---

<a id="6-文件改动清单"></a>

## 6. File Change List

**Delete**
- `apps/electron/src/renderer/components/auth/UpgradeNotice.tsx`
- `apps/electron/src/renderer/components/auth/ConflictWarning.tsx`
- `apps/electron/src/renderer/locales/{en,zh}/auth/upgrade.json`
- `apps/electron/src/renderer/locales/{en,zh}/auth/conflict.json`
- `apps/electron/src/main/lib/auth-upgrade.ts`
- `apps/electron/src/main/lib/auth-upgrade.test.ts`

**Modify**
- `packages/shared/src/types/auth.ts` (delete `LocalDataSnapshot` + `OwnerMarker`)
- `packages/shared/src/types/auth-ipc.ts` (delete `ATTRIBUTE_LOCAL_DATA` + `SCAN_LOCAL_DATA`)
- `apps/electron/src/main/lib/auth-service.ts` (delete `scanLocalData`/`attributeLocalData` + `userDataPath` dep + related imports)
- `apps/electron/src/main/index.ts` (remove `userDataPath` injection into `AuthService`)
- `apps/electron/src/main/ipc.ts` (delete 2 handlers)
- `apps/electron/src/preload/index.ts` (delete bridge + types + imports)
- `apps/electron/src/renderer/atoms/auth-atoms.ts` (delete `localDataSnapshotAtom`)
- `apps/electron/src/renderer/hooks/useAuth.ts` (remove `scanLocalData` call)
- `apps/electron/src/renderer/components/auth/LoginPage.tsx` (remove claiming + add `localDataNotice`)
- `apps/electron/src/renderer/components/auth/AccountMenu.tsx` (delete local-data count block)
- `apps/electron/src/renderer/components/settings/ProfileSettings.tsx` (add `dataLocality` card)
- `apps/electron/src/renderer/locales/{en,zh}/auth.ts` (remove upgrade/conflict aggregation)
- `apps/electron/src/renderer/locales/{en,zh}/auth/login.json` (add `localDataNotice`)
- `apps/electron/src/renderer/locales/{en,zh}/auth/menu.json` (delete `localData`/`localDataCounts`)
- `apps/electron/src/renderer/locales/{en,zh}/auth/profile.json` (add `dataLocality.*`)

**Version Increments (Done)**
- `apps/electron`: `0.1.466 → 0.1.467`
- `packages/shared`: `0.1.107 → 0.1.108` (auth type/channel changes)

---

<a id="7-验收映射"></a>

## 7. Acceptance Mapping

| Acceptance | How This Plan Satisfies It |
|------|---------------|
| U-A4 (data + configuration immediately usable after sign-in, no reentry or claiming) | A removes attribution banner/checkbox/dialog → direct access after sign-in; inherently device-level storage (D tests lock path invariant + real scan counts); device-shared config inherently satisfies it |
| U-A6 (local-only copy on welcome/account pages) | C adds copy to LoginPage (`localDataNotice`) + ProfileSettings (`dataLocality` card), synchronized en/zh, **without a sync schedule** |

---

<a id="8-风险与回滚"></a>

## 8. Risks and Rollback

| Risk | Mitigation |
|------|------|
| Type/channel deletion touches #420 framework with compilation effects | Changes confined to attribution subset; full `bun run typecheck`; retaining `SCAN_LOCAL_DATA` reduces scope |
| Changing `scanLocalData` to object-store reads couples main process → object store | Only `import` existing repository list functions and take lengths, no new queries; return 0 if DB uninitialized |
| Copy policy differs from issue body | Explicit in §3; align with author at review; PRD governs |
| Orphan historical owner.json | Harmless (unread); prefer no active cleanup of user directories |

Rollback: Subtractive code + copy, one squash PR; revert the PR if needed.

---

**Spec version**: v1 · 2026-06-15 · Draft awaiting review
