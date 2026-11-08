// apps/electron/src/renderer/components/auth/LoginPage.tsx
/** Google 系统浏览器授权入口；研究数据仅保留在本机。 */
/* eslint-disable asci/min-font-size -- 按用户确认的 Figma 登录稿保留辅助文案的 10–12px 层级，正文与主操作仍为 15px 及以上。 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ASCI_PRIVACY_POLICY_URL, ASCI_TERMS_OF_USE_URL } from '@asci/shared'
import { useT } from '@/hooks/useT.ts'
import { Trans } from '@/components/common/Trans.tsx'
import { Button } from '@/components/ui/button.tsx'
import { authRouteAtom, oauthPendingIdAtom } from '@/atoms/auth-atoms.ts'
import { parseAuthError } from '@/lib/auth/auth-form-helpers.ts'
import { TitlebarDragRegion } from '@/components/app-shell/TitlebarDragRegion.tsx'
import { GoogleIcon } from './GoogleIcon.tsx'
import { TinkerLogo } from './TinkerLogo.tsx'
import './LoginPage.css'

export interface LoginPageProps {
  initialOAuthPending?: boolean
}

export function LoginPage(props: LoginPageProps): React.ReactElement {
  const { t } = useT('auth')
  const pendingId = useAtomValue(oauthPendingIdAtom)
  const setPendingId = useSetAtom(oauthPendingIdAtom)

  const setAuthRoute = useSetAtom(authRouteAtom)
  const [submitting, setSubmitting] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [initialOAuthPending, setInitialOAuthPending] = React.useState(props.initialOAuthPending === true)
  const startRequest = React.useRef<ReturnType<typeof window.electronAPI.oauth.start> | null>(null)
  const cancelRequested = React.useRef(false)
  const cancelInFlight = React.useRef(false)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const oauthPending = pendingId !== null || initialOAuthPending

  const startGoogleOAuth = async (): Promise<void> => {
    if (startRequest.current || cancelInFlight.current || oauthPending) return
    cancelRequested.current = false
    setSubmitting(true)
    try {
      const request = window.electronAPI.oauth.start({ provider: 'google' })
      startRequest.current = request
      const r = await request
      if (!mounted.current) {
        if (r.ok) await window.electronAPI.oauth.cancel({ pendingId: r.value.pendingId })
        return
      }
      // 取消操作负责清理晚到的会话，避免重新进入等待态。
      if (cancelRequested.current) return
      if (!r.ok) {
        const key = parseAuthError(r.error).replace('auth:', '') as 'errors.unknown'
        toast.error(t(key))
        return
      }
      setPendingId(r.value.pendingId)
    } catch {
      if (mounted.current && !cancelRequested.current) toast.error(t('errors.network-error'))
    } finally {
      startRequest.current = null
      if (mounted.current) setSubmitting(false)
    }
  }

  const openExternal = (url: string): void => {
    window.electronAPI.openExternal(url).catch(console.error)
  }

  const cancelOAuth = async (closeWindow = false): Promise<void> => {
    if (cancelInFlight.current) return
    cancelInFlight.current = true
    cancelRequested.current = true
    setCancelling(true)
    let id = pendingId
    try {
      const r = await startRequest.current
      if (r?.ok) id = r.value.pendingId
      if (id !== null) {
        const result = await window.electronAPI.oauth.cancel({ pendingId: id })
        if (!result.ok) {
          if (mounted.current) {
            setPendingId(id)
            const key = parseAuthError(result.error).replace('auth:', '') as 'errors.unknown'
            toast.error(t(key))
          }
          return
        }
      }
      if (mounted.current) {
        setPendingId(null)
        setInitialOAuthPending(false)
        setAuthRoute('login')
        if (closeWindow) window.close()
      }
    } catch {
      if (mounted.current) {
        if (id !== null) setPendingId(id)
        toast.error(t('errors.network-error'))
      }
    } finally {
      cancelInFlight.current = false
      if (mounted.current) setCancelling(false)
    }
  }

  return (
    <main className="login-page fixed inset-0 overflow-y-auto bg-background text-foreground">
      <TitlebarDragRegion />
      <div className="login-page__layout">
        <section className="login-page__story rounded-[20px] bg-muted" aria-labelledby="login-story-title">
          <header className="login-page__brand-row">
            <div className="flex items-center gap-3 text-foreground">
              <TinkerLogo kind="horizontal" className="w-[152px] h-auto shrink-0" />
            </div>
            <p className="text-[12px] leading-[1.45] text-foreground/60">{t('login.workspaceTagline')}</p>
          </header>

          <div className="login-page__intro">
            <p className="text-[11px] font-semibold leading-4 text-foreground/60">{t('login.eyebrow')}</p>
            <h2 id="login-story-title" className="login-page__headline font-medium">
              <span className="block">{t('login.headlineFirst')}</span>
              <span className="block">{t('login.headlineSecond')}</span>
            </h2>
            <p className="login-page__description whitespace-pre-line text-[15px] leading-[1.45] text-foreground/60">
              {t('login.description')}
            </p>
          </div>

          <ol className="login-page__steps">
            {(['describe', 'build', 'refine'] as const).map((step) => (
              <li key={step} className="login-page__step rounded-xl bg-card text-card-foreground">
                <p className="text-[10px] font-medium leading-[1.45] text-foreground/60">{t(`login.steps.${step}.label`)}</p>
                <h3 className="login-page__step-title text-[21px] font-medium leading-[1.45]">{t(`login.steps.${step}.title`)}</h3>
                <p className="login-page__step-description text-[11px] leading-[1.45] text-foreground/60">{t(`login.steps.${step}.description`)}</p>
              </li>
            ))}
          </ol>

          <footer className="login-page__story-footer flex items-center justify-between gap-4">
            <p className="text-[12px] leading-[1.45] text-foreground/60">{t('login.footer')}</p>
            <span className="text-[11px] font-semibold">{t('login.brand')}</span>
          </footer>
        </section>

        <section className="login-page__sign-in" aria-labelledby="login-title">
          <div className="login-page__form">
            <h1 id="login-title" className="login-page__welcome font-semibold leading-[1.45]">{t('login.title')}</h1>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-[1.45] text-foreground/60">{t('login.subtitle')}</p>

            <div className="login-page__actions">
              {oauthPending ? (
                <>
                  <div role="status" className="login-page__pending flex items-center gap-3 text-sm text-foreground/70">
                    <Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    <p>{t('login.oauthPending')}</p>
                  </div>
                  <Button variant="subtle" className="login-page__cancel w-full" onClick={() => void cancelOAuth()} disabled={cancelling}>
                    {t('login.oauthCancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="default"
                    className="login-page__submit w-full gap-3 rounded-[10px] text-[15px] font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={() => void startGoogleOAuth()}
                    disabled={submitting || cancelling}
                    aria-busy={submitting}
                  >
                    {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <GoogleIcon />}
                    {t('login.withGoogle')}
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    className="login-page__cancel w-full"
                    onClick={() => void cancelOAuth(true)}
                    disabled={cancelling}
                  >
                    {t('login.cancel')}
                  </Button>
                </>
              )}
            </div>

            <div className="login-page__privacy border-t border-border">
              <div className="rounded-[10px] bg-muted p-5">
                <h2 className="text-[12px] font-medium leading-[1.45]">{t('login.localDataTitle')}</h2>
                <p className="mt-2 whitespace-pre-line text-[11px] leading-[1.45] text-foreground/60">{t('login.localDataNotice')}</p>
              </div>
              <p className="mt-4 whitespace-pre-line text-[11px] leading-[1.9] text-foreground/60">
                <Trans
                  ns="auth"
                  i18nKey="login.legalConsent"
                  components={{
                    terms: (
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        onClick={() => openExternal(ASCI_TERMS_OF_USE_URL)}
                      />
                    ),
                    privacy: (
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        onClick={() => openExternal(ASCI_PRIVACY_POLICY_URL)}
                      />
                    ),
                  }}
                />
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
