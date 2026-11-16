<a id="顶部会话-tab-按-workspace-过滤-specworkspace-scoped-tabs"></a>

# Filter Top Conversation Tabs by Workspace Spec (Workspace-Scoped Tabs)

> **Status**: Implemented
> **Related issue**: #458
> **Related PR**: #623
> **Domain language source of truth**: `CONTEXT.md`

---

<a id="1-问题"></a>

## 1. Problem

The top conversation tab bar mixes projects (#458): after opening multiple conversations in project A and switching to B, A's tabs remain visible.
Startup restoration (`main.tsx` `TabStatePersistenceInitializer`) retains only the current workspace's tabs and **permanently discards** tabs from other workspaces.

Expected behavior:

1. Show only tabs belonging to the current workspace.
2. Persist each workspace's open tab set independently and restore each after restart.
3. Restore the active tab from when a workspace was last left upon returning to it.

<a id="2-方案"></a>

## 2. Approach

Keep one global `tabsAtom` (tabs across workspaces remain alive; background streaming conversations continue) and layer visibility filtering over it:

| Layer | Change |
|----|------|
| Data | Add optional `workspaceId?: string` to `TabItem`, populate all `openTab` producers; an `agentSessionsAtom` subscription backfills missing values |
| Derived | `visibleTabsAtom` filters by `currentAgentWorkspaceIdAtom`; tabs with `workspaceId == null` remain visible everywhere (review projection / legacy conversation compatibility) |
| Memory | `activeTabIdByWorkspaceAtom: Record<wsId, tabId>`; key writes by **the tab's own workspace** (activation writes tabsAtom before activeTabIdAtom, independent of order); `switchActiveSessionForWorkspace` prioritizes a memory hit after “active already belongs to new ws” and before “tabbed session” |
| Closing | `closeTab` computes neighbors within the **visible subset**, avoiding activation of hidden tabs from other workspaces; no visible neighbor → `activeTabId: null` |
| Persistence | `settings.tabState` stores all tabs (with workspaceId) + the `activeTabIdByWorkspace` map; restoration retains all tabs whose sessions still exist, backfills workspaceId from session meta as authoritative, and discards tabs belonging to deleted workspaces |

<a id="设计取舍"></a>

### Design Tradeoffs

- **Do not** swap separate per-workspace tab arrays: a global array + filtered view fulfills the same need with no changes to background workspace streaming/keep-alive behavior.
- Keep the `TabBar` branch that switches workspaces on external tab clicks as a safety net (unreachable after filtering).
- `TabContent`/`MainArea` content rendering still reads global `tabsAtom`: during workspace switches, activeTabId briefly points to the previous workspace's tab; scoped lookup would flash the “tab does not exist” fallback.

<a id="兼容性"></a>

### Compatibility

- Old `settings.json` (tabs without `workspaceId`, no `activeTabIdByWorkspace`): backfill from session meta on restoration; absent memory maps use the existing fallback chain. No migration script.
- No `packages/shared` changes (`PersistedTabSettings` exists only in `apps/electron/src/types/settings.ts`; the main process does not read `tabState`).

<a id="3-触点清单"></a>

## 3. Touchpoints

- `apps/electron/src/renderer/atoms/tab-atoms.ts` — types + pure functions + new atoms
- `apps/electron/src/renderer/components/tabs/TabBar.tsx`, `MainArea.tsx` — visible-set rendering
- `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` — workspace-switch routing + backfill subscription
- `apps/electron/src/renderer/hooks/useOpenSession.ts`, `useCreateSession.ts` — producers
- `apps/electron/src/renderer/main.tsx` — persistence restoration/writes
- `apps/electron/src/types/settings.ts` — `PersistedTabSettings`
- Secondary: `GlobalShortcuts.tsx`, `WelcomeView.tsx`, `LeftSidebar.tsx`, `ArchivedSettings.tsx`
