/** 从用户确认的 A 版原始资源生成平台图标，不重画或修改标志。 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import sharp from 'sharp'

const resources = resolve(import.meta.dir, '../resources')
const masters = join(resources, 'tinker-logos')
const png = (size: number): Buffer => readFileSync(join(masters, `app-icon-${size}.png`))
copyFileSync(join(masters, 'Tinker-app-icon.svg'), join(resources, 'icon.svg'))
copyFileSync(join(masters, 'app-icon-1024.png'), join(resources, 'icon.png'))

const chunks = [16, 32, 64, 128, 256, 512, 1024].map((size, index) => {
  const data = png(size)
  const header = Buffer.alloc(8)
  header.write(['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic10'][index]!, 0, 'ascii')
  header.writeUInt32BE(data.length + 8, 4)
  return Buffer.concat([header, data])
})
const body = Buffer.concat(chunks)
const header = Buffer.alloc(8)
header.write('icns', 0, 'ascii')
header.writeUInt32BE(body.length + 8, 4)
writeFileSync(join(resources, 'icon.icns'), Buffer.concat([header, body]))

const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const images = await Promise.all(sizes.map(async size => {
  if ([16, 24, 32, 48, 64, 128, 256].includes(size)) return png(size)
  return sharp(png(size === 20 ? 24 : size === 40 ? 48 : 128)).resize(size, size).png().toBuffer()
}))
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(sizes.length, 4)
let offset = 6 + sizes.length * 16
const entries = images.map((data, index) => {
  const entry = Buffer.alloc(16)
  entry[0] = sizes[index] === 256 ? 0 : sizes[index]!
  entry[1] = entry[0]!
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(data.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += data.length
  return entry
})
writeFileSync(join(resources, 'icon.ico'), Buffer.concat([icoHeader, ...entries, ...images]))

// macOS Template 只使用黑色和透明度，由系统适配浅深菜单栏。
const template = readFileSync(join(masters, 'Tinker-symbol-micro.svg'), 'utf8')
  .replace(/fill="#(?:111111|163BFF)"/g, 'fill="#000000"')
for (const scale of [1, 2, 3]) {
  const suffix = scale === 1 ? '' : `@${scale}x`
  await sharp(Buffer.from(template), { density: 72 * scale * 4 })
    .resize(22 * scale, 22 * scale).png()
    .toFile(join(resources, `asci-logos/iconTemplate${suffix}.png`))
}
console.log('Tinker A 版 ICNS / ICO / PNG 与 Template 图标已生成')
