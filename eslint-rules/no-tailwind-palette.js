/**
 * no-tailwind-palette — 禁止 Tailwind 调色板硬编码 className，强制使用 design.md 定义的语义 token
 *
 * ADR-003 §六 共同后果：业务代码必须用 --success / --warning / --info / --destructive
 * 等语义 token，不得直接写 bg-red-500 / text-blue-600 / border-emerald-400 等调色板色。
 *
 * 检测策略：扫所有字符串字面量 + 模板字面量片段。锚定前缀 (^|\s|:|') 与 Tailwind 属性前缀
 * （bg/text/border/ring/fill/stroke/outline/divide/shadow/placeholder/from/to/via/caret/
 * accent/decoration），后接 22 种调色板色 + 数字阶。覆盖 hover:/dark:/group-hover: 等 variant 前缀。
 *
 * 豁免：行级 `// eslint-disable-next-line asci/no-tailwind-palette -- 说明`；
 * 或 block 级 `/* eslint-disable asci/no-tailwind-palette *​/` ... `/* eslint-enable ... *​/`。
 */

const PALETTE_REGEX = /(?:^|[\s:'"`])(bg|text|border|ring|fill|stroke|outline|divide|shadow|placeholder|from|to|via|caret|accent|decoration)-(red|blue|green|gray|yellow|slate|zinc|amber|orange|emerald|cyan|sky|indigo|violet|purple|pink|rose|neutral|stone|teal|lime|fuchsia)-\d+/

function checkString(context, node, value) {
  if (typeof value !== 'string' || value.length === 0) return
  const match = value.match(PALETTE_REGEX)
  if (match) {
    const hit = match[0].replace(/^[\s:'"`]/, '').trim()
    context.report({
      node,
      messageId: 'palette',
      data: { match: hit },
    })
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        '禁止 Tailwind 调色板硬编码 className，强制使用 ADR-003 / docs/design.md 定义的语义 token',
    },
    messages: {
      palette:
        '禁止 Tailwind 调色板硬编码 "{{match}}"。请用语义 token（bg-success / text-warning / bg-info / text-destructive 等）；brand 色用 // eslint-disable-next-line asci/no-tailwind-palette -- <理由> 豁免；详见 docs/design.md',
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
