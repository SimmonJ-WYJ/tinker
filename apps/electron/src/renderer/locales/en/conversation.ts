/**
 * conversation 命名空间聚合：从 conversation/ 子目录按段合并为一份资源
 * 每段一个 JSON 文件，便于按模块维护；合并后供 i18next defaultResources 与
 * i18n-types.d.ts 类型增强使用
 */
import agent from './conversation/agent.json'
import atMention from './conversation/atMention.json'
import input from './conversation/input.json'
import panels from './conversation/panels.json'
import permission from './conversation/permission.json'
import researchGap from './conversation/research-gap.json'
import tool from './conversation/tool.json'

export const conversationEn = {
  ...input,
  ...panels,
  ...permission,
  ...researchGap,
  ...atMention,
  ...tool,
  ...agent,
} as const
