/**
 * min-font-size — 强制应用 UI 字号下限 14px（spec: min-font-size-14px）
 *
 * 拦截 className 里的 arbitrary `text-[Npx]` 且 N < 14（含小数，如 text-[10.5px]）。
 * 不拦 `text-xs`（已由 tailwind.config 钳为 14px）、相对单位（em/rem）、≥14px。
 *
 * 检测策略：扫所有字符串字面量 + 模板字面量片段（仿 no-tailwind-palette）。
 * 豁免：行级 `// eslint-disable-next-line asci/min-font-size -- <理由（渲染内容/代码块）>`。
 */

// 锚定前缀 (^|空白|:|引号)，匹配 text-[<数字>px]，捕获数字
const TEXT_PX_REGEX = /(?:^|[\s:'"`])text-\[(\d+(?:\.\d+)?)px\]/g
const MIN_PX = 14

function checkString(context, node, value) {
  if (typeof value !== 'string' || value.length === 0) return
  TEXT_PX_REGEX.lastIndex = 0
  let match
  while ((match = TEXT_PX_REGEX.exec(value)) !== null) {
    const px = Number.parseFloat(match[1])
    if (px < MIN_PX) {
      context.report({
        node,
        messageId: 'tooSmall',
        data: { match: `text-[${match[1]}px]` },
      })
    }
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: '强制应用 UI 字号下限 14px：禁止 arbitrary text-[<14px]',
    },
    messages: {
      tooSmall:
        '字号低于 14px 下限 "{{match}}"。应用 UI 最小 14px，请改用 text-sm（14px）或更大；' +
        '若为代码块/渲染内容例外，用 // eslint-disable-next-line asci/min-font-size -- <理由> 豁免；详见 docs/specs/min-font-size-14px-spec.md',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string') checkString(context, node, node.value)
      },
      TemplateElement(node) {
        if (node.value && typeof node.value.raw === 'string') {
          checkString(context, node, node.value.raw)
        }
      },
    }
  },
}
