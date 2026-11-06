#!/bin/bash

# ASCI Icon Generation Script
# Generates all required icon formats from icon.svg
# Requires: rsvg-convert (librsvg), magick (ImageMagick), node

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🎨 Generating ASCI icons..."

# Check required tools
if ! command -v rsvg-convert &> /dev/null; then
    echo "❌ rsvg-convert not found. Install with: brew install librsvg"
    exit 1
fi

if ! command -v magick &> /dev/null; then
    echo "❌ ImageMagick (magick) not found. Install with: brew install imagemagick"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ node not found. Install Node.js or run inside the project toolchain"
    exit 1
fi

# 1. Generate icon.png (1024x1024) from SVG
echo "📦 Generating icon.png (1024x1024)..."
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png

# icon.svg already contains the macOS-style rounded rectangle and safe area.
# Keep this source authoritative so Dock, Finder, DMG, and Windows icons share
# the same optical size.

# 2. Generate menubar/tray icons (multi-resolution for Retina displays)
echo "📦 Generating tray icons..."

# macOS 托盘图标规范：
# - 标准尺寸: 22x22pt（点）
# - @2x Retina: 44x44px
# - @3x 高分辨率: 66x66px
# 使用 "Template" 命名让 macOS 自动适配深色/浅色菜单栏
TRAY_SVG="asci-logos/icon.svg"

if [ ! -f "$TRAY_SVG" ]; then
  echo "⚠️  Tray icon SVG not found at $TRAY_SVG, skipping tray icon generation"
else
  # 生成多分辨率 Template 图标（macOS 会自动选择合适的版本）
  rsvg-convert -w 22 -h 22 "$TRAY_SVG" -o asci-logos/iconTemplate.png
  rsvg-convert -w 44 -h 44 "$TRAY_SVG" -o "asci-logos/iconTemplate@2x.png"
  rsvg-convert -w 66 -h 66 "$TRAY_SVG" -o "asci-logos/iconTemplate@3x.png"

  echo "✅ Tray icons generated:"
  echo "   - asci-logos/iconTemplate.png (22x22 @1x)"
  echo "   - asci-logos/iconTemplate@2x.png (44x44 @2x Retina)"
  echo "   - asci-logos/iconTemplate@3x.png (66x66 @3x)"
fi

# 3. Generate .icns (macOS app icon)
echo "📦 Generating icon.icns..."

# Remove legacy local iconset output from older script versions.
rm -rf icon.iconset

# Create iconset directory under /tmp.
ICONSET_DIR="/tmp/asci-icon-$$.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Generate all required sizes for macOS.
magick icon.png -background none -resize 16x16     "PNG32:$ICONSET_DIR/icon_16x16.png"
magick icon.png -background none -resize 32x32     "PNG32:$ICONSET_DIR/icon_16x16@2x.png"
magick icon.png -background none -resize 32x32     "PNG32:$ICONSET_DIR/icon_32x32.png"
magick icon.png -background none -resize 64x64     "PNG32:$ICONSET_DIR/icon_32x32@2x.png"
magick icon.png -background none -resize 128x128   "PNG32:$ICONSET_DIR/icon_128x128.png"
magick icon.png -background none -resize 256x256   "PNG32:$ICONSET_DIR/icon_128x128@2x.png"
magick icon.png -background none -resize 256x256   "PNG32:$ICONSET_DIR/icon_256x256.png"
magick icon.png -background none -resize 512x512   "PNG32:$ICONSET_DIR/icon_256x256@2x.png"
magick icon.png -background none -resize 512x512   "PNG32:$ICONSET_DIR/icon_512x512.png"
magick icon.png -background none -resize 1024x1024 "PNG32:$ICONSET_DIR/icon_512x512@2x.png"

# Write ICNS directly from PNG chunks. This avoids iconutil failures under npm/bun
# lifecycle environments while still producing a standard Mac OS X icon file.
node - "$ICONSET_DIR" "icon.icns" <<'NODE_ICNS'
const fs = require('fs')
const path = require('path')

const iconsetDir = process.argv[2]
const outputPath = process.argv[3]
const entries = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
]

const chunks = entries.map(([type, file]) => {
  const data = fs.readFileSync(path.join(iconsetDir, file))
  const chunk = Buffer.alloc(8 + data.length)
  chunk.write(type, 0, 4, 'ascii')
  chunk.writeUInt32BE(chunk.length, 4)
  data.copy(chunk, 8)
  return chunk
})

const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
const header = Buffer.alloc(8)
header.write('icns', 0, 4, 'ascii')
header.writeUInt32BE(totalLength, 4)

fs.writeFileSync(outputPath, Buffer.concat([header, ...chunks], totalLength))
NODE_ICNS

# Clean up
rm -rf "$ICONSET_DIR"

echo "✅ icon.icns generated"

# 4. Generate .ico (Windows app icon)
echo "📦 Generating icon.ico..."
magick icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
echo "✅ icon.ico generated"

echo ""
echo "✅ All icons generated successfully!"
echo ""
echo "Generated files:"
echo "  - icon.png (1024x1024) - Linux & macOS Dock"
echo "  - icon.icns - macOS app icon"
echo "  - icon.ico - Windows app icon"
echo "  - asci-logos/iconTemplate.png - macOS tray (22x22 @1x)"
echo "  - asci-logos/iconTemplate@2x.png - macOS tray (44x44 @2x Retina)"
echo "  - asci-logos/iconTemplate@3x.png - macOS tray (66x66 @3x)"
