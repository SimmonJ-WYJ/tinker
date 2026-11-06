import { Menu, shell, BrowserWindow } from 'electron'
import { t } from './lib/i18n-main'

export function createApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  /**
   * 菜单快捷键说明：
   *
   * 大部分快捷键由渲染进程的 shortcut-registry 统一管理。
   * 但 Cmd+W 需要在菜单中拦截（否则 macOS 默认关闭窗口），
   * 改为通知渲染进程关闭当前标签页。
   */

  const template: Electron.MenuItemConstructorOptions[] = [
    // 应用菜单 (仅 macOS)
    ...(isMac
      ? [
          {
            label: 'Tinker',
            submenu: [
              { role: 'about' as const, label: t('chrome.menu.app.about') },
              { type: 'separator' as const },
              { role: 'services' as const, label: t('chrome.menu.app.services') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: t('chrome.menu.app.hide') },
              { role: 'hideOthers' as const, label: t('chrome.menu.app.hideOthers') },
              { role: 'unhide' as const, label: t('chrome.menu.app.unhide') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: t('chrome.menu.app.quit') },
            ],
          },
        ]
      : []),

    // 文件菜单
    {
      label: t('chrome.menu.file.title'),
      submenu: [
        // Cmd+W / Ctrl+W：关闭当前标签页（而非关闭窗口）
        {
          label: t('chrome.menu.file.closeTab'),
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            if (win) {
              win.webContents.send('menu:close-tab')
            }
          },
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: t('chrome.menu.file.quit') }]),
      ],
    },

    // 编辑菜单
    {
      label: t('chrome.menu.edit.title'),
      submenu: [
        { role: 'undo' as const, label: t('chrome.menu.edit.undo') },
        { role: 'redo' as const, label: t('chrome.menu.edit.redo') },
        { type: 'separator' as const },
        { role: 'cut' as const, label: t('chrome.menu.edit.cut') },
        { role: 'copy' as const, label: t('chrome.menu.edit.copy') },
        { role: 'paste' as const, label: t('chrome.menu.edit.paste') },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: t('chrome.menu.edit.pasteAndMatch') },
              { role: 'delete' as const, label: t('chrome.menu.edit.delete') },
              { role: 'selectAll' as const, label: t('chrome.menu.edit.selectAll') },
            ]
          : [{ role: 'delete' as const, label: t('chrome.menu.edit.delete') }, { type: 'separator' as const }, { role: 'selectAll' as const, label: t('chrome.menu.edit.selectAll') }]),
      ],
    },

    // 视图菜单
    {
      label: t('chrome.menu.view.title'),
      submenu: [
        { role: 'reload' as const, label: t('chrome.menu.view.reload') },
        { role: 'forceReload' as const, label: t('chrome.menu.view.forceReload') },
        { role: 'toggleDevTools' as const, label: t('chrome.menu.view.toggleDevTools') },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: t('chrome.menu.view.resetZoom') },
        { role: 'zoomIn' as const, label: t('chrome.menu.view.zoomIn') },
        { role: 'zoomOut' as const, label: t('chrome.menu.view.zoomOut') },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: t('chrome.menu.view.fullscreen') },
      ],
    },

    // 窗口菜单
    {
      label: t('chrome.menu.window.title'),
      submenu: [
        { role: 'minimize' as const, label: t('chrome.menu.window.minimize') },
        { role: 'zoom' as const, label: t('chrome.menu.window.zoom') },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: t('chrome.menu.window.front') },
              { type: 'separator' as const },
              { role: 'window' as const, label: t('chrome.menu.window.window') },
            ]
          : [{ role: 'close' as const, label: t('chrome.menu.window.close') }]),
      ],
    },

    // 帮助菜单
    {
      label: t('chrome.menu.help.title'),
      role: 'help' as const,
      submenu: [
        {
          label: t('chrome.menu.help.learnMore'),
          click: async () => {
            await shell.openExternal('https://github.com/yourusername/asci')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
