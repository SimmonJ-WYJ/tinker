// packages/shared/src/auth-password-policy.ts
/**
 * 密码强度策略（spec §七 7.4）。前后端共用。
 * 不依赖 zxcvbn / passwordmeter，规则极简：
 *   - 长度 ≥ 8
 *   - 至少 1 字母 + 1 数字
 */

export interface PasswordPolicyViolation {
  code: 'too-short' | 'missing-letter' | 'missing-digit'
}

export function checkPasswordPolicy(plain: string): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = []
  if (plain.length < 8) violations.push({ code: 'too-short' })
  if (!/[a-zA-Z]/.test(plain)) violations.push({ code: 'missing-letter' })
  if (!/[0-9]/.test(plain)) violations.push({ code: 'missing-digit' })
  return violations
}
