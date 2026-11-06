/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        dialog: {
          DEFAULT: 'hsl(var(--dialog))',
          foreground: 'hsl(var(--dialog-foreground))',
        },
        tooltip: {
          DEFAULT: 'hsl(var(--tooltip) / <alpha-value>)',
          foreground: 'hsl(var(--tooltip-foreground) / <alpha-value>)',
          muted: 'hsl(var(--tooltip-muted) / <alpha-value>)',
        },
        'content-area': 'hsl(var(--content-area) / <alpha-value>)',
        // ADR-003 B-2：diff / 搜索命中专用 token，B-3 (#293) 起替换 tool-result-renderers 的硬编码 palette
        'diff-add': {
          DEFAULT: 'hsl(var(--diff-add-bg))',
          bg: 'hsl(var(--diff-add-bg))',
          fg: 'hsl(var(--diff-add-fg))',
          text: 'hsl(var(--diff-add-text))',
        },
        'diff-del': {
          DEFAULT: 'hsl(var(--diff-del-bg))',
          bg: 'hsl(var(--diff-del-bg))',
          fg: 'hsl(var(--diff-del-fg))',
          text: 'hsl(var(--diff-del-text))',
        },
        'search-hit': {
          DEFAULT: 'hsl(var(--search-hit-bg))',
          bg: 'hsl(var(--search-hit-bg))',
          fg: 'hsl(var(--search-hit-fg))',
        },
        // ADR-003 follow-up #306：Choice UI 危险等级语义 token，替换原 emerald-500/40 / amber-500-600/70
        'choice-safe-border': 'hsl(var(--choice-safe-border))',
        'choice-dangerous-border': 'hsl(var(--choice-dangerous-border))',
        'choice-dangerous-fg': 'hsl(var(--choice-dangerous-fg))',
        'choice-dangerous-prefix': 'hsl(var(--choice-dangerous-prefix))',
        // ADR-003 B-5 #295：相关度梯度 token（RelevanceBadge / SessionPapersStatsBar RELEVANCE_COLORS）
        'relevance-0': 'hsl(var(--relevance-0))',
        'relevance-1': 'hsl(var(--relevance-1))',
        'relevance-2': 'hsl(var(--relevance-2))',
        'relevance-3': 'hsl(var(--relevance-3))',
        'relevance-4': 'hsl(var(--relevance-4))',
        // ADR-003 follow-up #307：tool-result-renderer 代码/终端容器语义 token，替换原 zinc-100/200/300/500/800/900/950
        'code-container': {
          bg: 'hsl(var(--code-container-bg))',
          fg: 'hsl(var(--code-container-fg))',
          muted: 'hsl(var(--code-container-muted))',
          emphasis: 'hsl(var(--code-container-emphasis))',
          text: 'hsl(var(--code-container-text))',
          subheader: 'hsl(var(--code-container-subheader))',
          'row-hover': 'hsl(var(--code-container-row-hover))',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        serif: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      // 14px 下限钳制（spec: min-font-size-14px）：text-xs 由默认 12px 抬到 14px。
      // 仅覆盖 xs，其余字阶（sm/base/...）不变；text-xs 与 text-sm 同尺寸，主次靠字重/颜色区分。
      // text-badge：badge/chip/tag 专属 12px 例外（装饰性标签，spec 明确豁免下限）；
      // 命名工具类不触发 asci/min-font-size（规则只拦 arbitrary text-[<14px]），免散落 eslint-disable。
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        badge: ['0.75rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        'slide-in-from-top': {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-out-to-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'in': 'slide-in-from-top 0.3s ease-out',
        'out': 'slide-out-to-right 0.2s ease-in',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
}
