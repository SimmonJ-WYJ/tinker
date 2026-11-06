/**
 * library 命名空间聚合：从 library/ 子目录按段合并为一份资源
 * 引用图谱（graph）单独成段；论文笔记面板（notes）原型阶段独立成段
 * 其余基础库 UI 留在 core
 */
import core from './library/core.json'
import graph from './library/graph.json'
import notes from './library/notes.json'
import evidenceSetDetail from './library/evidenceSetDetail.json'

export const libraryEn = {
  ...core,
  ...graph,
  ...notes,
  ...evidenceSetDetail,
} as const
