/**
 * settings 命名空间聚合（zh）：与 en 侧文件结构镜像
 */
import about from './settings/about.json'
import agent from './settings/agent.json'
import archived from './settings/archived.json'
import channels from './settings/channels.json'
import datacollection from './settings/datacollection.json'
import general from './settings/general.json'
import panel from './settings/panel.json'
import profile from './settings/profile.json'
import proxy from './settings/proxy.json'
import shortcuts from './settings/shortcuts.json'
import updates from './settings/updates.json'
import zotero from './settings/zotero.json'

export const settingsZh = {
  ...general,
  ...panel,
  ...profile,
  ...archived,
  ...about,
  ...channels,
  ...proxy,
  ...shortcuts,
  ...zotero,
  ...agent,
  ...datacollection,
  ...updates,
} as const
