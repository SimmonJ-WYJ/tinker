import { useState } from 'react'
const zh = {
  newTask: '新任务', projects: '项目', search: '搜索', channels: '渠道',
  stage: 'Rust 会话核心 · 持久化验证', title: '今天想完成什么？',
  note: '聊天、生图、搜索与项目尚未接入；当前只验证本机草稿。',
  placeholder: '描述你的任务…', inputLabel: '任务草稿', save: '保存草稿', restore: '读取已保存草稿', submit: '尝试发送',
  memory: '仅保存在本次运行的 Rust 内存中，退出后清除。不会调用模型。',
  connected: 'Rust 已连接', connecting: '正在连接 Rust…', saved: '草稿已保存到本机内存', restored: '已读取内存草稿',
  modelNotMigrated: '模型尚未迁移，未发送请求。你的输入已保留。', emptyInput: '请先输入任务内容。',
  inputTooLarge: '草稿超过 64 KiB，原有草稿未被替换。', stateUnavailable: '草稿状态不可用，请保留输入后重启测试版。',
  nativeRequired: '请在 Tinker Rust Lab 桌面应用中打开。', unknownError: '原生通信失败，输入仍保留，可再次保存。',
  storageUnknown: '尚未确认存储状态，请保留输入。',
  fileStorage: '草稿保存在实验版独立目录，重启后可读取。未接入模型或旧版历史。',
  savedFile: '草稿已写入实验版文件', restoredFile: '已读取文件草稿',
  recoveryNotice: '主文件异常，当前显示上一份备份（可能较旧）。恢复会保留异常原件，再启用保存。', recover: '恢复这份备份', recovered: '备份已恢复，异常原件已保留。',
  protocolMismatch: '接口版本不兼容，请保留输入并使用匹配的实验版。',
  storageUnavailable: '无法读写草稿文件，请保留输入后检查目录权限。', storageLocked: '另一实验版进程正在使用草稿，请关闭它后重启。',
  storageUnsafePath: '草稿路径异常，已停止读写。', storageCorrupt: '草稿和可用备份无法读取，未覆盖原文件。',
  storageVersionUnsupported: '草稿来自其他存储版本，已停止读写，未覆盖原文件。', storageFileTooLarge: '草稿文件超出读取限制，未覆盖原文件。',
  storageConflict: '草稿版本已变化，请先复制输入，再读取最新草稿。', storageRecoveryRequired: '请先恢复备份，再保存草稿。',
  storageUncertain: '文件替换后同步失败，保存结果尚不确定。请保留输入并重新读取。',
  notMigrated: '尚未迁移', architecture: '架构', theme: '切换深浅主题', language: 'English',
}
const en: Record<keyof typeof zh, string> = {
  newTask: 'New task', projects: 'Projects', search: 'Search', channels: 'Channels',
  stage: 'Rust session core · Persistence verification', title: 'What would you like to accomplish?',
  note: 'Chat, image generation, search and projects are not connected. Local draft verification only.',
  placeholder: 'Describe your task…', inputLabel: 'Task draft', save: 'Save draft', restore: 'Read saved draft', submit: 'Try sending',
  memory: 'Stored in Rust memory for this run only. Cleared on exit. No model calls.',
  connected: 'Rust connected', connecting: 'Connecting to Rust…', saved: 'Draft saved in local memory', restored: 'Memory draft loaded',
  modelNotMigrated: 'Model not migrated. No request sent. Your input has been preserved.', emptyInput: 'Enter a task first.',
  inputTooLarge: 'Draft exceeds 64 KiB. The previous draft was preserved.', stateUnavailable: 'Draft state unavailable. Keep your input before restarting the lab.',
  nativeRequired: 'Open this in the Tinker Rust Lab desktop app.', unknownError: 'Native connection failed. Your input is preserved; try saving again.',
  storageUnknown: 'Storage status is not confirmed. Keep your input.',
  fileStorage: 'Draft stored in the lab’s separate directory and available after restart. No model or legacy history integration.',
  savedFile: 'Draft written to the lab file', restoredFile: 'File draft loaded',
  recoveryNotice: 'Primary file is invalid. Showing the previous backup, which may be older. Recovery preserves the original before enabling saves.', recover: 'Restore this backup', recovered: 'Backup restored. The invalid original was preserved.',
  protocolMismatch: 'Incompatible interface version. Keep your input and use a matching lab build.',
  storageUnavailable: 'Cannot access the draft file. Keep your input and check directory permissions.', storageLocked: 'Another lab process is using the draft. Close it before restarting.',
  storageUnsafePath: 'Unsafe draft path. File access stopped.', storageCorrupt: 'Draft and usable backup cannot be read. Original files were preserved.',
  storageVersionUnsupported: 'Unsupported storage version. File access stopped; original files preserved.', storageFileTooLarge: 'Draft file exceeds the read limit. Original file preserved.',
  storageConflict: 'Draft revision changed. Copy your input before loading the latest draft.', storageRecoveryRequired: 'Restore the backup before saving.',
  storageUncertain: 'File replacement completed but synchronization failed. Save outcome is uncertain. Keep your input and reload.',
  notMigrated: 'Not migrated', architecture: 'Architecture', theme: 'Toggle light or dark theme', language: '中文',
}
export function useT() {
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const dictionary = language === 'zh' ? zh : en
  return { t: (key: keyof typeof zh) => dictionary[key], language, toggleLanguage: () => setLanguage(language === 'zh' ? 'en' : 'zh') }
}
export type TextKey = keyof typeof zh
