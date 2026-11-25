/**
 * settings 命名空间聚合：从 settings/ 子目录按段合并为一份资源
 * 每个段一个 JSON 文件，便于按模块维护；合并后供 i18next defaultResources 与
 * i18n-types.d.ts 类型增强使用
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
import projectBackups from './settings/project-backups.json'
import sessionImport from './settings/session-import.json'
import shortcuts from './settings/shortcuts.json'
import updates from './settings/updates.json'
import zotero from './settings/zotero.json'

export const settingsEn = {
  ...general,
  ...panel,
  ...profile,
  ...archived,
  ...about,
  ...channels,
  ...proxy,
  ...sessionImport,
  ...projectBackups,
  ...shortcuts,
  ...zotero,
  ...agent,
  ...datacollection,
  ...updates,
} as const
