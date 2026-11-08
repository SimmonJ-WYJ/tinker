/** 登录页改版：验证双语内容与既有 Google 授权入口。 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ASCI_PRIVACY_POLICY_URL, ASCI_TERMS_OF_USE_URL } from '@asci/shared'
import { authRouteAtom, oauthPendingIdAtom } from '@/atoms/auth-atoms.ts'
import { setAppLanguage } from '@/lib/i18n.ts'
import { LoginPage } from './LoginPage.tsx'

const start = mock(async () => ({ ok: true, value: { pendingId: 'google-pending' } }))
const cancel = mock(async () => ({ ok: true, value: undefined }))
const openExternal = mock(async () => undefined)

beforeEach(async () => {
  await setAppLanguage('en')
  start.mockReset()
  start.mockResolvedValue({ ok: true, value: { pendingId: 'google-pending' } })
  cancel.mockReset()
  cancel.mockResolvedValue({ ok: true, value: undefined })
  openExternal.mockClear()
  window.electronAPI = { oauth: { start, cancel }, openExternal } as unknown as Window['electronAPI']
})

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

function mountLogin(initialOAuthPending = false) {
  const store = createStore()
  render(<Provider store={store}><LoginPage initialOAuthPending={initialOAuthPending} /></Provider>)
  return store
}

describe('LoginPage', () => {
  test('展示三步 AI coding 文案，第三步包含完整说明', () => {
    mountLogin()
    expect(screen.getByRole('heading', { name: /Your next idea.*Built with AI/s })).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Check the changes, test your code, and refine the result.')).toBeInTheDocument()
  })

  test('切换中文时同步更新品牌区、三张卡片与登录文案', async () => {
    mountLogin()
    await act(async () => { await setAppLanguage('zh') })
    await waitFor(() => expect(screen.getByText('你的下一个想法。')).toBeInTheDocument())
    expect(screen.getByText('检查改动、测试代码，让结果更进一步。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '使用 Google 登录' })).toBeInTheDocument()
  })

  test('启动 Google 授权后显示等待态，取消后恢复登录入口', async () => {
    const store = mountLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Waiting for Google authorization'))
    expect(start).toHaveBeenCalledWith({ provider: 'google' })
    expect(store.get(oauthPendingIdAtom)).toBe('google-pending')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument())
    expect(cancel).toHaveBeenCalledWith({ pendingId: 'google-pending' })
    expect(store.get(oauthPendingIdAtom)).toBeNull()
  })

  test('双语登录页只展示 Tinker 品牌', async () => {
    mountLogin()
    for (const language of ['en', 'zh'] as const) {
      await act(async () => { await setAppLanguage(language) })
      expect(screen.getByText('Tinker', { selector: 'span' })).toBeInTheDocument()
      expect(document.body).not.toHaveTextContent(/ASCI|OPENSCI/i)
    }
  })

  test('开始授权期间重复点击只发起一次请求', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof start>>) => void
    start.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    mountLogin()
    const button = screen.getByRole('button', { name: 'Sign in with Google' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(start).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ok: true, value: { pendingId: 'slow-start' } }) })
  })

  test('启动未返回时取消会取消晚到会话，清除状态后再关闭窗口', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof start>>) => void
    start.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const close = mock(() => undefined)
    const originalClose = window.close
    window.close = close
    try {
      const store = mountLogin()
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(close).not.toHaveBeenCalled()
      await act(async () => { resolve({ ok: true, value: { pendingId: 'late-pending' } }) })
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
      expect(cancel).toHaveBeenCalledWith({ pendingId: 'late-pending' })
      expect(store.get(oauthPendingIdAtom)).toBeNull()
      expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled()
    } finally { window.close = originalClose }
  })

  test('返回等待态取消后恢复登录路由', async () => {
    const store = mountLogin(true)
    store.set(authRouteAtom, 'oauth-pending')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled())
    expect(store.get(authRouteAtom)).toBe('login')
    expect(store.get(oauthPendingIdAtom)).toBeNull()
  })

  test('取消请求未返回时重复点击只取消一次', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof cancel>>) => void
    cancel.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const store = mountLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    const button = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    await act(async () => { resolve({ ok: true, value: undefined }) })
    expect(store.get(oauthPendingIdAtom)).toBeNull()
  })

  test('IPC 启动异常后恢复按钮，允许重试', async () => {
    start.mockRejectedValueOnce(new Error('IPC unavailable'))
    mountLogin()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' })) })
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(start).toHaveBeenCalledTimes(2)
  })

  test('取消 IPC 异常保留会话，允许重试取消', async () => {
    cancel.mockRejectedValueOnce(new Error('IPC unavailable'))
    const store = mountLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    expect(store.get(oauthPendingIdAtom)).toBe('google-pending')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled())
    expect(store.get(oauthPendingIdAtom)).toBeNull()
  })

  test('登录页卸载后清理晚到会话，避免写入等待状态', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof start>>) => void
    start.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const store = mountLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    cleanup()
    await act(async () => { resolve({ ok: true, value: { pendingId: 'unmounted-pending' } }) })
    expect(cancel).toHaveBeenCalledWith({ pendingId: 'unmounted-pending' })
    expect(store.get(oauthPendingIdAtom)).toBeNull()
  })

  test('法律链接继续通过主进程打开', () => {
    mountLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Terms of Use' }))
    fireEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }))
    expect(openExternal).toHaveBeenNthCalledWith(1, ASCI_TERMS_OF_USE_URL)
    expect(openExternal).toHaveBeenNthCalledWith(2, ASCI_PRIVACY_POLICY_URL)
  })
})
