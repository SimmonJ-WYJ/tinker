/**
 * no-raw-date-format — 禁止用裸 Date 做日期/时间格式化，强制走 dayjs（经 @asci/shared / @/utils/dayjs）
 *
 * 背景：全仓库日期时间统一收敛到 dayjs（详见 docs/date-time.md）。展示用格式化必须走
 * dayjs.format(...) / @/utils/dayjs 的 formatDate / formatDateTime / formatMessageTime，
 * 或相对时间走 useFormatRelativeTime；构造/算术走 @asci/shared 的 nowIso/nowMs/toIso/toMs。
 *
 * 检测策略（保守，避免误伤数值的 .toLocaleString）：只在「接收者是 new Date(...)」时报警，覆盖：
 * - new Date(...).toLocaleDateString / .toLocaleTimeString / .toLocaleString  ——展示格式化
 * - new Date(...).getFullYear / .getMonth / .getDate / .getHours / .getMinutes / .getSeconds
 *   ——手搓格式化拼串的典型信号
 * 不报警：裸 Date.now()（数值算术合法）、变量.toLocaleString()（无法确定是否 Date，且多为数值）。
 *
 * 级别：warn（不阻断 CI；数值 Date.now() 等合法用法不在检测范围）。
 * 豁免：行级 `// eslint-disable-next-line asci/no-raw-date-format -- <理由>`。
 */

const LOCALE_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'])
const COMPONENT_METHODS = new Set([
  'getFullYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'getSeconds',
])

/** 判断一个 AST 节点是否为 `new Date(...)` */
function isNewDate(node) {
  return (
    node &&
    node.type === 'NewExpression' &&
    node.callee &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'Date'
  )
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: '禁止用裸 Date 做日期/时间格式化，强制走 dayjs（详见 docs/date-time.md）',
    },
    messages: {
      locale:
        '禁止用 new Date(...).{{method}} 做日期格式化。请用 @/utils/dayjs 的 formatDate/formatDateTime/formatTime（随界面语言本地化），或 dayjs(x).format(...)；详见 docs/date-time.md。豁免：// eslint-disable-next-line asci/no-raw-date-format -- <理由>',
      component:
        '禁止用 new Date(...).{{method}} 手搓时间串。请用 dayjs(x).format(...) 或 @/utils/dayjs 的格式化 helper；详见 docs/date-time.md。豁免：// eslint-disable-next-line asci/no-raw-date-format -- <理由>',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.property.type !== 'Identifier') return
        if (!isNewDate(node.object)) return
        const method = node.property.name
        if (LOCALE_METHODS.has(method)) {
          context.report({ node, messageId: 'locale', data: { method } })
        } else if (COMPONENT_METHODS.has(method)) {
          context.report({ node, messageId: 'component', data: { method } })
        }
      },
    }
  },
}
