import { RuleTester } from 'eslint'
import rule from './min-font-size.js'

const ruleTester = new RuleTester()

// 说明：eslint 的 RuleTester.run 内部会调用 describe/it（绑定到 bun:test 全局），
// 因此须在顶层调用，不能再嵌套进自定义 it（否则报 "Cannot call describe() inside a test"）。
ruleTester.run('asci/min-font-size', rule, {
  valid: [
    { code: 'const c = "text-xs text-muted-foreground"' },
    { code: 'const c = "text-sm"' },
    { code: 'const c = "text-[14px]"' },
    { code: 'const c = "text-[15px] text-[26px]"' },
    { code: 'const c = "text-[0.875em] font-medium"' },
    { code: 'const c = "leading-[12px]"' },
  ],
  invalid: [
    { code: 'const c = "text-[12px]"', errors: [{ messageId: 'tooSmall' }] },
    { code: 'const c = "text-[10.5px]"', errors: [{ messageId: 'tooSmall' }] },
    { code: 'const c = "px-2 text-[8px] font-medium"', errors: [{ messageId: 'tooSmall' }] },
    { code: 'const c = `gap-1 text-[13px]`', errors: [{ messageId: 'tooSmall' }] },
  ],
})
