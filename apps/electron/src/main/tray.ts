import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { t } from './lib/i18n-main'
import { showAndFocusMainWindow } from './index'

let tray: Tray | null = null

/**
 * 获取托盘图标路径
 * 所有平台统一使用 Template 图标
 */
function getTrayIconPath(): string {
  // resources 在 build:resources 阶段被复制到 dist/ 下，与 main.cjs 同级
  const resourcesDir = join(__dirname, 'resources/asci-logos')
  return join(resourcesDir, 'iconTemplate.png')
}

/**
 * 创建系统托盘图标和菜单
 */
export function createTray(): Tray | null {
  const iconPath = getTrayIconPath()

  if (!existsSync(iconPath)) {
    console.warn('Tray icon not found at:', iconPath)
    return null
  }

  try {
    const image = nativeImage.createFromPath(iconPath)

    // macOS: 标记为 Template 图像
    // Template 图像必须是单色的，使用 alpha 通道定义形状
    // 系统会自动根据菜单栏主题填充颜色
    if (process.platform === 'darwin') {
      image.setTemplateImage(true)
    }

    tray = new Tray(image)

    // 设置 tooltip
    tray.setToolTip('Tinker')

    // 创建右键菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: t('chrome.tray.show'),
        click: () => showAndFocusMainWindow()
      },
      {
        type: 'separator'
      },
      {
        label: t('chrome.tray.quit'),
        click: () => {
          app.quit()
        }
      }
    ])

    tray.setContextMenu(contextMenu)

    // 点击行为：始终弹出菜单（与右键一致）
    tray.on('click', () => {
      tray?.popUpContextMenu()
    })

    console.log('System tray created')
    return tray
  } catch (error) {
    console.error('Failed to create system tray:', error)
    return null
  }
}

/** 重新生成托盘右键菜单（供语言切换后同步标签使用） */
export function rebuildTrayMenu(): void {
  if (!tray) return
  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('chrome.tray.show'),
      click: () => showAndFocusMainWindow(),
    },
    { type: 'separator' },
    {
      label: t('chrome.tray.quit'),
      click: () => { app.quit() },
    },
  ])
  tray.setContextMenu(contextMenu)
}

/**
 * 销毁系统托盘
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/**
 * 获取当前托盘实例
 */
export function getTray(): Tray | null {
  return tray
}
