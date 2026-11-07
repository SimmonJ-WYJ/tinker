/** 校验三处真实轮廓间隙，并防止 SVG、React 与平台资产重新分叉。 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { TinkerLogo } from '../src/renderer/components/auth/TinkerLogo.tsx'

const resources = resolve(import.meta.dir, '../resources')
const masters = join(resources, 'tinker-logos')
const read = (name: string): string => readFileSync(join(masters, name), 'utf8')
interface Point { x: number; y: number }
interface Contour { d: string; transform: string }

function contours(svg: string): Contour[] {
  return [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
    d: /\bd="([^"]*)"/.exec(tag)?.[1] ?? '',
    transform: /\btransform="([^"]*)"/.exec(tag)?.[1] ?? '',
  }))
}

function sample({ d, transform }: Contour): Point[] {
  const tokens = d.match(/[MLQHVZ]|-?\d*\.?\d+/g) ?? []
  const points: Point[] = []
  let index = 0
  let current: Point = { x: 0, y: 0 }
  let start = current
  const next = (): number => Number(tokens[index++])
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === 'M') {
      current = { x: next(), y: next() }; start = current; continue
    }
    let control: Point | undefined
    let end: Point
    if (command === 'Q') {
      control = { x: next(), y: next() }; end = { x: next(), y: next() }
    } else if (command === 'L') end = { x: next(), y: next() }
    else if (command === 'H') end = { x: next(), y: current.y }
    else if (command === 'V') end = { x: current.x, y: next() }
    else if (command === 'Z') end = start
    else throw new Error(`未支持的 SVG 路径命令：${command}`)
    for (let step = 0; step <= 160; step++) {
      const t = step / 160
      const u = 1 - t
      points.push(control
        ? { x: u*u*current.x + 2*u*t*control.x + t*t*end.x, y: u*u*current.y + 2*u*t*control.y + t*t*end.y }
        : { x: u*current.x + t*end.x, y: u*current.y + t*end.y })
    }
    current = end
  }
  const operations = [...transform.matchAll(/(translate|scale)\(([^)]*)\)/g)].reverse()
  return points.map(point => {
    let { x, y } = point
    for (const [, operation, args] of operations) {
      const values = args!.trim().split(/[ ,]+/).map(Number)
      if (operation === 'translate') { x += values[0]!; y += values[1] ?? 0 }
      else { x *= values[0]!; y *= values[1] ?? values[0]! }
    }
    return { x, y }
  })
}

function gap(a: Point[], b: Point[]): number {
  let distanceSquared = Infinity
  for (const p of a) for (const q of b) {
    distanceSquared = Math.min(distanceSquared, (p.x-q.x)**2 + (p.y-q.y)**2)
  }
  return Math.sqrt(distanceSquared)
}

describe('Tinker 三处等距接缝', () => {
  for (const [file, expected] of [['Tinker-symbol-color.svg', 18], ['Tinker-symbol-micro.svg', 26]] as const) {
    test(`${file} 三对轮廓最小距离一致`, () => {
      const [upper, lower, accent] = contours(read(file)).map(sample)
      for (const [a, b] of [[upper, accent], [upper, lower], [accent, lower]]) {
        expect(Math.abs(gap(a!, b!) - expected)).toBeLessThan(0.02)
      }
    })
  }

  for (const kind of ['symbol', 'horizontal'] as const) {
    test(`React ${kind} 路径和变换与正式 SVG 同步`, () => {
      const rendered = renderToStaticMarkup(React.createElement(TinkerLogo, { kind }))
      expect(contours(rendered)).toEqual(contours(read(`Tinker-${kind}-color.svg`)))
    })
  }

  test('所有 PNG 尺寸来自正确的普通版或 Micro SVG', async () => {
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      const source = size <= 24 ? 'Tinker-app-icon-micro.svg' : 'Tinker-app-icon.svg'
      const expected = await sharp(join(masters, source), { density: 288 }).resize(size, size).png().toBuffer()
      expect(readFileSync(join(masters, `app-icon-${size}.png`))).toEqual(expected)
    }
  })

  test('Electron、Rust、原型和菜单栏兼容源同步', () => {
    const apps = resolve(resources, '../..')
    for (const app of ['tinker-rust', 'tauri-prototype']) {
      for (const name of ['icon.png', 'icon.icns']) {
        expect(readFileSync(join(apps, app, 'src-tauri/icons', name))).toEqual(readFileSync(join(resources, name)))
      }
    }
    for (const name of ['Tinker-symbol-color.svg', 'Tinker-symbol-white.svg', 'Tinker-horizontal-color.svg', 'Tinker-horizontal-white.svg']) {
      expect(readFileSync(join(apps, 'tinker-rust/public', name), 'utf8')).toBe(read(name))
    }
    expect(readFileSync(join(resources, 'asci-logos/icon.svg'), 'utf8')).toBe(read('Tinker-symbol-black.svg'))
  })
})
