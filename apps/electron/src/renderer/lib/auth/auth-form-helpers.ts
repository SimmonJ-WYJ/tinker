// apps/electron/src/renderer/lib/auth/auth-form-helpers.ts
import type { AuthError, AuthErrorCode } from '@asci/shared'
import { checkPasswordPolicy } from '@asci/shared'

export interface FormError {
  field: 'email' | 'password' | 'confirmPassword' | 'nickname'
  code: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRegisterForm(input: {
  email: string
  password: string
  confirmPassword: string
  nickname?: string
}): FormError[] {
  const errs: FormError[] = []
  if (!input.email) errs.push({ field: 'email', code: 'required' })
  else if (!EMAIL_RE.test(input.email)) errs.push({ field: 'email', code: 'invalid-format' })

  if (!input.password) errs.push({ field: 'password', code: 'required' })
  else {
    const violations = checkPasswordPolicy(input.password)
    const firstViolation = violations[0]
    if (firstViolation !== undefined) {
      errs.push({ field: 'password', code: firstViolation.code })
    }
  }

  if (input.password !== input.confirmPassword) {
    errs.push({ field: 'confirmPassword', code: 'mismatch' })
  }

  return errs
}

export function validateLoginForm(input: { email: string; password: string }): FormError[] {
  const errs: FormError[] = []
  if (!input.email) errs.push({ field: 'email', code: 'required' })
  if (!input.password) errs.push({ field: 'password', code: 'required' })
  return errs
}

const ERROR_CODES: ReadonlySet<AuthErrorCode> = new Set([
  'invalid-credentials',
  'email-not-verified',
  'email-already-exists',
  'weak-password',
  'invalid-token',
  'token-expired',
  'rate-limited',
  'network-error',
  'oauth-cancelled',
  'oauth-state-mismatch',
  'oauth-provider-error',
  'oauth-config-missing',
  'unknown',
])

export function parseAuthError(error: AuthError): string {
  const code = ERROR_CODES.has(error.code) ? error.code : 'unknown'
  return `auth:errors.${code}`
}
