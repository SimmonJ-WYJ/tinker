import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ImageRenderer from './ImageRenderer.tsx'

// 合成的 1×1 PNG，不读取用户文件。
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const originalAPI = window.electronAPI
let fixtureDir: string
let blobs: Blob[]
let createUrl: ReturnType<typeof spyOn<typeof URL, 'createObjectURL'>>
let revokeUrl: ReturnType<typeof spyOn<typeof URL, 'revokeObjectURL'>>

beforeEach(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'asci-image-preview-'))
  blobs = []
  createUrl = spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return `blob:synthetic-image-${blobs.length}`
  })
  revokeUrl = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  createUrl.mockRestore()
  revokeUrl.mockRestore()
  window.electronAPI = originalAPI
  await rm(fixtureDir, { recursive: true, force: true })
})

function setReader(reader: (path: string) => Promise<string>): void {
  window.electronAPI = { previewReadBinary: reader } as unknown as Window['electronAPI']
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('ImageRenderer 本地图片预览', () => {
  it('完整保留合成文件的中文、空格、?、#、% 路径，通过二进制桥接显示原始 PNG', async () => {
    const path = join(fixtureDir, '测试 image?draft#100%.PNG')
    await writeFile(path, Buffer.from(PNG_BASE64, 'base64'))
    // 旧实现确实将文件名中的 ? 变成 query，丢失后半段路径。
    const oldUrl = `file://${encodeURI(path).replace(/#/g, '%23')}`
    expect(fileURLToPath(oldUrl)).not.toBe(path)

    const read = mock(async (filePath: string) => (await readFile(filePath)).toString('base64'))
    setReader(read)
    const onError = mock(() => {})
    render(<ImageRenderer path={path} size={68} onError={onError} />)

    await waitFor(() => expect(read).toHaveBeenCalledWith(path))
    const image = await screen.findByRole('img', { name: '测试 image?draft#100%.PNG' })
    expect(image.getAttribute('src')).toBe('blob:synthetic-image-1')
    expect(image.className).toContain('object-contain')
    expect(blobs[0]?.type).toBe('image/png')
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(new Uint8Array(Buffer.from(PNG_BASE64, 'base64')))
    expect(onError).not.toHaveBeenCalled()
  })

  it('单击图片打开现有 lightbox，并从已读 Blob 下载原文件名', async () => {
    setReader(async () => PNG_BASE64)
    render(<ImageRenderer path={join(fixtureDir, 'plot.png')} size={68} onError={() => {}} />)
    const image = await screen.findByRole('img', { name: 'plot.png' })
    fireEvent.load(image)
    fireEvent.click(screen.getByRole('button', { name: 'Image preview' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('img', { name: 'plot.png' }).getAttribute('src')).toBe('blob:synthetic-image-1')
    const download = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('plot.png')
      expect(this.getAttribute('href')).toBe('blob:synthetic-image-1')
    })
    try {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save image' }))
      expect(download).toHaveBeenCalledTimes(1)
    } finally {
      download.mockRestore()
    }
  })

  it('缺失文件读取失败时上报本地化错误，避免暴露原始文件系统错误', async () => {
    setReader(async (path) => (await readFile(path)).toString('base64'))
    const onError = mock(() => {})
    render(<ImageRenderer path={join(fixtureDir, 'missing.png')} size={0} onError={onError} />)
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith(new Error('Failed to load image'))
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('图片解码失败时上报错误并释放 Blob URL', async () => {
    setReader(async () => btoa('not an image'))
    const onError = mock(() => {})
    render(<ImageRenderer path={join(fixtureDir, 'broken.png')} size={12} onError={onError} />)
    const image = await screen.findByRole('img')
    fireEvent.error(image)
    expect(onError).toHaveBeenCalledWith(new Error('Failed to load image'))
    expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-image-1')
    expect(screen.queryByRole('button', { name: 'Image preview' })).toBeNull()
  })

  it('切换文件后忽略旧读取结果，仅释放已创建的 URL', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    setReader((path) => path.endsWith('first.png') ? first.promise : second.promise)
    const onError = mock(() => {})
    const { rerender, unmount } = render(<ImageRenderer path="/tmp/first.png" size={68} onError={onError} />)
    rerender(<ImageRenderer path="/tmp/second.png" size={68} onError={onError} />)
    await act(async () => second.resolve(PNG_BASE64))
    expect((await screen.findByRole('img')).getAttribute('alt')).toBe('second.png')
    await act(async () => first.resolve(PNG_BASE64))
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('img')).getAttribute('alt')).toBe('second.png')
    unmount()
    expect(revokeUrl).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('切换已加载图片时立即撤销旧 URL，并忽略已卸载读取的错误', async () => {
    const pending = deferred<string>()
    setReader((path) => path.endsWith('first.png') ? Promise.resolve(PNG_BASE64) : pending.promise)
    const onError = mock(() => {})
    const { rerender, unmount } = render(<ImageRenderer path="/tmp/first.png" size={68} onError={onError} />)
    await screen.findByRole('img')
    rerender(<ImageRenderer path="/tmp/second.png" size={68} onError={onError} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-image-1')
    unmount()
    await act(async () => pending.reject(new Error('ENOENT')))
    expect(onError).not.toHaveBeenCalled()
    expect(revokeUrl).toHaveBeenCalledTimes(1)
  })
})
