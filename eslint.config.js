/**
 * ESLint flat config — ADR-003 B-6 落地
 *
 * 当前唯一作用：拦截 Tailwind 调色板硬编码（asci/no-tailwind-palette）。
 * 不引入 react / typescript-eslint plugin，保持最小破坏面。
 */

import tsParser from '@typescript-eslint/parser'
import noTailwindPalette from './eslint-rules/no-tailwind-palette.js'
import noRawDateFormat from './eslint-rules/no-raw-date-format.js'
import minFontSize from './eslint-rules/min-font-size.js'

const asciPlugin = {
  rules: {
    'no-tailwind-palette': noTailwindPalette,
    'no-raw-date-format': noRawDateFormat,
    'min-font-size': minFontSize,
  },
}

/**
 * 兼容已散落在代码中的 eslint-disable 注释（react-hooks / @typescript-eslint），
 * 这些规则不在本配置范围内但 disable 注释存在。注册 noop 插件 + 不启用规则避免
 * "Definition for rule 'xxx' was not found" 报错。后续如引入 react/ts 完整 lint，
 * 再换成对应官方插件。
 */
const noopRule = { create: () => ({}), meta: { schema: [] } }
const reactHooksStub = {
  rules: {
    'exhaustive-deps': noopRule,
    'rules-of-hooks': noopRule,
  },
}
const tsEslintStub = {
  rules: {
    'no-explicit-any': noopRule,
    'no-require-imports': noopRule,
    'unbound-method': noopRule,
    'no-unused-vars': noopRule,
    'consistent-type-imports': noopRule,
  },
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.cjs',
      '**/build/**',
      '**/.next/**',
      '**/resources/**',
      'docs/superpowers/**',
      'eslint-rules/**',
    ],
  },
  {
    files: ['apps/electron/src/**/*.{ts,tsx,js,jsx}', 'packages/*/src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      asci: asciPlugin,
      'react-hooks': reactHooksStub,
      '@typescript-eslint': tsEslintStub,
    },
    rules: {
      'asci/no-tailwind-palette': 'error',
      'asci/no-raw-date-format': 'warn',
      'asci/min-font-size': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
]
