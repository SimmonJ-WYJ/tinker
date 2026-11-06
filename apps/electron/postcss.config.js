export default {
  plugins: {
    // 'postcss-import' 必须置首，否则 globals.css 的 @import 在 @tailwind 展开后才内联，
    // 导致 :root token 被 Tailwind preflight 覆盖。详见 ADR-003 §六。
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
}
