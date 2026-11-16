<a id="日期时间约定dayjs"></a>

# Date and Time Conventions (dayjs)

> All repository date/time handling uses [dayjs](https://day.js.org/). Do not use bare `new Date(...)` for formatting,
> `.toLocale*`, or hand-built time strings with `padStart`. Enforced by the `asci/no-raw-date-format` ESLint rule (warn level).

---

<a id="1-为什么-dayjs"></a>

## 1. Why dayjs

- Immutable API (`.add` / `.subtract` return new instances), with clear arithmetic;
- Small, plugin-based library with `utc` / `localizedFormat` / `customParseFormat` registered;
- Locale follows interface language (zh-cn / en), eliminating scattered hardcoded `'zh-CN'` values.

<a id="2-两层入口"></a>

## 2. Two Entry Layers

| Layer | Module | Purpose | i18n |
|----|------|------|------|
| Foundation (independent of interface language) | `@asci/shared` (`packages/shared/src/utils/date-time.ts`) | Construction / arithmetic / ISO conversion; shared by main and renderer | Decoupled (CLAUDE.md §7.4) |
| Display (follows interface language) | `@/utils/dayjs` (`apps/electron/src/renderer/utils/dayjs.ts`) | Localized formatting helpers + locale synchronization | Follows `languageAtom` |

<a id="21-基础-helperascishared"></a>

### 2.1 Foundation Helpers (`@asci/shared`)

The original code comments describe current ISO strings, current millisecond timestamps, conversion of arbitrary input to ISO/milliseconds, and the configured dayjs instance for formatting and arithmetic; replacement expressions are preserved.

```ts
import { nowIso, nowMs, toIso, toMs, dayjs } from '@asci/shared'

nowIso()        // 当前 ISO 字符串      ← 替代 new Date().toISOString()
nowMs()         // 当前毫秒时间戳        ← 替代 Date.now()（取值时）
toIso(x)        // 任意输入 → ISO 串    ← 替代 new Date(x).toISOString()
toMs(x)         // 任意输入 → 毫秒数    ← 替代 new Date(x).getTime() / Date.parse(x)
dayjs(x)        // 已配置实例，做 .format/.add/.subtract/.diff/.year() 等
```

<a id="22-展示-helperutilsdayjs仅渲染进程"></a>

### 2.2 Display Helpers (`@/utils/dayjs`, Renderer Only)

Original comments describe localized date (LL), date/time (L LT), time with seconds (LTS), and message time (MM/DD HH:mm within this year, YYYY/MM/DD HH:mm across years).

```ts
import { formatDate, formatDateTime, formatTime, formatMessageTime, dayjs } from '@/utils/dayjs'

formatDate(x)         // 仅日期，本地化（LL）        ← 替代 .toLocaleDateString()
formatDateTime(x)     // 日期+时间，本地化（L LT）   ← 替代 .toLocaleString()
formatTime(x)         // 时:分:秒，本地化（LTS）     ← 替代 .toLocaleTimeString()
formatMessageTime(x)  // 今年 MM/DD HH:mm，跨年 YYYY/MM/DD HH:mm
```

Locale automatically follows interface language: `setAppLanguage()` (`renderer/lib/i18n.ts`) calls `syncDayjsLocale()` whenever language changes, setting dayjs global locale to `zh-cn` / `en`. Components need not pass locale manually.

<a id="23-相对时间3-分钟前"></a>

### 2.3 Relative Time (“3 Minutes Ago”)

Relative time **does not use** dayjs's relativeTime plugin; it uses an i18n-token-based hook to remain consistent with interface copy. The original comment specifies millisecond timestamp input; convert ISO strings with toMs(iso).

```ts
import { useFormatRelativeTime } from '@/utils/format-relative-time'
const fmt = useFormatRelativeTime()
fmt(nowMs())   // 入参为毫秒时间戳；ISO 串先 toMs(iso)
```

<a id="3-反模式会被-lint-warn-&#45;review-拦"></a>

## 3. Antipatterns (Flagged by Lint Warnings / Review)

The original comments mark bare Date formatting and manually assembled strings as invalid, and foundation helpers as the valid alternative for construction/value extraction.

```ts
// ❌ 裸 Date 格式化
new Date(ts).toLocaleString()
new Date().toLocaleDateString('zh-CN', { ... })
`${d.getFullYear()}/${d.getMonth() + 1}`   // 手搓拼串

// ✅
formatDateTime(ts)
formatDate(x)
dayjs(d).format('YYYY/MM')
```

```ts
// ❌ 裸构造 / 取值
const iso = new Date().toISOString()
const ms = Date.parse(x)

// ✅
const iso = nowIso()
const ms = toMs(x)
```

<a id="4-例外保留原生-date-&#45;datenow"></a>

## 4. Exceptions (Retain Native Date / Date.now)

The following **may** retain native usage and are outside lint coverage:

- `packages/ui/` (such as streaming timing in `CodeBlock.tsx`): no `@asci/shared` dependency, and high-frequency timing values; numeric `Date.now()` usage is valid;
- `apps/electron/resources/**` (separately bundled ASR / OCR / MCP subprocesses): already ignored by ESLint; exclude `@asci/shared` to keep subprocess bundles small;
- `apps/electron/scripts/**` (build / dev script tools): build timing, rather than application runtime logic.

Bare `Date.now()` / `dayjs(x).valueOf()` **numeric value extraction** is valid and produces no lint warning; the rule blocks only formatting through bare Date.

<a id="5-守门"></a>

## 5. Enforcement

- ESLint: `asci/no-raw-date-format` (warn), defined in `eslint-rules/no-raw-date-format.js`, registered in `eslint.config.js`;
- Exemption: `// eslint-disable-next-line asci/no-raw-date-format -- <理由>` (the placeholder means the reason).
