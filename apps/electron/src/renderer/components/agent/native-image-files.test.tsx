import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { setAppLanguage } from '@/lib/i18n'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { applyPickedImage } from './native-image-files'
import { GeneratedImage } from './GeneratedImage'
import { SentImageReference } from './SentImageReference'

const id = 'ref-' + '1'.repeat(32)
const reference = {
  imageId: id,
  localPath: `session-1/${id}.png`,
  filename: id + '.png',
  mediaType: 'image/png',
  displayName: 'fixture.jpg',
}
const originalMarker = window.__TAURI_FORMAL__
const originalApi = window.electronAPI

afterEach(() => {
  cleanup()
  window.__TAURI_FORMAL__ = originalMarker
  window.electronAPI = originalApi
})

test('取消、切换会话或随后选择的引用不会被旧的 picker 结果覆盖', async () => {
  const selected = { imageId: id, generatedImage: reference, previewSrc: 'data:image/png;base64,YQ==' }
  const commit = mock()
  let stillCurrent = true
  let finish!: () => void
  const returned = applyPickedImage(
    () => new Promise(resolve => { finish = () => resolve(selected) }),
    () => stillCurrent,
    commit,
  )
  stillCurrent = false
  finish()
  await returned
  await applyPickedImage(async () => null, () => true, commit)
  expect(commit).not.toHaveBeenCalled()
  await applyPickedImage(async () => selected, () => true, commit)
  expect(commit).toHaveBeenCalledWith(selected)
})

test('重启后用原生已发送缩略图再次选择准确的导入图片，选择本身不发送或保存', async () => {
  await setAppLanguage('en')
  const store = createStore()
  const pick = mock(async () => null)
  const save = mock(async () => true)
  window.__TAURI_FORMAL__ = { imageFiles: { pick, save }, hydrated: () => {} }
  window.electronAPI = { readAttachment: mock(async () => 'YQ==') } as unknown as Window['electronAPI']

  render(<Provider store={store}><SentImageReference reference={JSON.parse(JSON.stringify(reference))} /></Provider>)
  expect(await screen.findByAltText(reference.displayName)).toHaveAttribute('src', 'data:image/png;base64,YQ==')
  fireEvent.click(screen.getByRole('button', { name: 'Edit from this image' }))
  expect(store.get(imageEditDraftsAtom).get('session-1')).toMatchObject({
    imageId: id,
    displayName: 'fixture.jpg',
    generatedImage: { localPath: reference.localPath, filename: reference.filename },
  })
  expect(pick).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('原生结果卡和放大窗口保存同一个已提交资源，取消后仍可继续使用', async () => {
  await setAppLanguage('en')
  const save = mock(async (_path: string) => false)
  const electronSave = mock(async () => true)
  window.__TAURI_FORMAL__ = { imageFiles: { save, pick: async () => null }, hydrated: () => {} }
  window.electronAPI = { readAttachment: mock(async () => 'YQ=='), saveImageAs: electronSave } as unknown as Window['electronAPI']
  const generatedImage = { localPath: 'session-1/generated.png', filename: 'generated.png', mediaType: 'image/png' }
  render(<GeneratedImage result={JSON.stringify({ imageId: 'one', generatedImage })} sessionId="session-1" />)

  const thumbnail = await screen.findByRole('img', { name: 'generated.png' })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(thumbnail)
  fireEvent.click(screen.getByRole('button', { name: 'Save image' }))
  expect(save.mock.calls).toEqual([[generatedImage.localPath], [generatedImage.localPath]])
  expect(electronSave).not.toHaveBeenCalled()
})
