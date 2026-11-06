# 日期时间约定（dayjs）

> 全仓库日期 / 时间处理统一走 [dayjs](https://day.js.org/)。禁止裸 `new Date(...)` 做格式化、禁止
> `.toLocale*`、禁止手搓 `padStart` 拼时间串。由 `asci/no-raw-date-format` ESLint 规则守门（warn 级）。

---

## 1. 为什么 dayjs

- 不可变 API（`.add` / `.subtract` 返回新实例），算术清晰；
- 插件化、体积小，已注册 `utc` / `localizedFormat` / `customParseFormat`；
- locale 系统与界面语言联动（zh-cn / en），告别散落各处的 `'zh-CN'` 硬编码。

## 2. 两层入口

| 层 | 模块 | 用途 | i18n |
|----|------|------|------|
| 基础（无关界面语言） | `@asci/shared`（`packages/shared/src/utils/date-time.ts`） | 构造 / 算术 / ISO 互转；主进程与渲染进程通用 | 解耦（CLAUDE.md §7.4） |
| 展示（随界面语言） | `@/utils/dayjs`（`apps/electron/src/renderer/utils/dayjs.ts`） | 本地化格式化 helper + locale 同步 | 随 `languageAtom` |

### 2.1 基础 helper（`@asci/shared`）

```ts
import { nowIso, nowMs, toIso, toMs, dayjs } from '@asci/shared'

nowIso()        // 当前 ISO 字符串      ← 替代 new Date().toISOString()
nowMs()         // 当前毫秒时间戳        ← 替代 Date.now()（取值时）
toIso(x)        // 任意输入 → ISO 串    ← 替代 new Date(x).toISOString()
toMs(x)         // 任意输入 → 毫秒数    ← 替代 new Date(x).getTime() / Date.parse(x)
dayjs(x)        // 已配置实例，做 .format/.add/.subtract/.diff/.year() 等
```

### 2.2 展示 helper（`@/utils/dayjs`，仅渲染进程）

```ts
import { formatDate, formatDateTime, formatTime, formatMessageTime, dayjs } from '@/utils/dayjs'

formatDate(x)         // 仅日期，本地化（LL）        ← 替代 .toLocaleDateString()
formatDateTime(x)     // 日期+时间，本地化（L LT）   ← 替代 .toLocaleString()
formatTime(x)         // 时:分:秒，本地化（LTS）     ← 替代 .toLocaleTimeString()
formatMessageTime(x)  // 今年 MM/DD HH:mm，跨年 YYYY/MM/DD HH:mm
```

locale 随界面语言自动切换：`setAppLanguage()`（`renderer/lib/i18n.ts`）在每次切语言时调用
`syncDayjsLocale()`，把 dayjs 全局 locale 设为 `zh-cn` / `en`。无需在组件里手动传 locale。

### 2.3 相对时间（"3 分钟前"）

相对时间**不走** dayjs 的 relativeTime 插件，而走 i18n token 化的 hook，保证与界面文案体系一致：

```ts
import { useFormatRelativeTime } from '@/utils/format-relative-time'
const fmt = useFormatRelativeTime()
fmt(nowMs())   // 入参为毫秒时间戳；ISO 串先 toMs(iso)
```

## 3. 反模式（会被 lint warn / review 拦）

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

## 4. 例外（保留原生 Date / Date.now）

以下场景**允许**保留原生写法，不在 lint 检测范围：

- `packages/ui/`（如 `CodeBlock.tsx` 的流式计时）—— 不依赖 `@asci/shared`，且为高频计时取值，`Date.now()` 数值用法合法；
- `apps/electron/resources/**`（ASR / OCR / MCP 子进程独立打包）—— ESLint 已 ignore；为减小子进程 bundle 不引入 `@asci/shared`；
- `apps/electron/scripts/**`（构建 / dev 脚本工具）—— 构建计时，非 App 运行逻辑。

裸 `Date.now()` / `dayjs(x).valueOf()` 这类**取数值**用法本身合法，lint 不报警；规则只拦"用裸 Date 做格式化"。

## 5. 守门

- ESLint：`asci/no-raw-date-format`（warn），定义见 `eslint-rules/no-raw-date-format.js`，注册见 `eslint.config.js`；
- 豁免：`// eslint-disable-next-line asci/no-raw-date-format -- <理由>`。
