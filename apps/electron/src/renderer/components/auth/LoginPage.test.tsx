/** 登录页改版：验证双语内容与既有 Google 授权入口。 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { ASCI_PRIVACY_POLICY_URL, ASCI_TERMS_OF_USE_URL } from '@asci/shared'
import { oauthPendingIdAtom } from '@/atoms/auth-atoms.ts'
import { setAppLanguage } from '@/lib/i18n.ts'
import { LoginPage } from './LoginPage.tsx'

const start = mock(async () => ({ ok: true, value: { pendingId: 'google-pending' } }))
const cancel = mock(async () => ({ ok: true, value: undefined }))
const openExternal = mock(async () => undefined)

beforeEach(async () => {
  await setAppLanguage('en')
  start.mockClear()
  cancel.mockClear()
  openExternal.mockClear()
  window.electronAPI = { oauth: { start, cancel }, openExternal } as unknown as Window['electronAPI']
})

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

function mountLogin() {
  const store = createStore()
  render(<Provider store={store}><LoginPage /></Provider>)
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

  test('法律链接继续通过主进程打开', () => {
    mountLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Terms of Use' }))
    fireEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }))
    expect(openExternal).toHaveBeenNthCalledWith(1, ASCI_TERMS_OF_USE_URL)
    expect(openExternal).toHaveBeenNthCalledWith(2, ASCI_PRIVACY_POLICY_URL)
  })
})
