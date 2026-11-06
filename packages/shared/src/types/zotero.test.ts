import { test, expect } from 'bun:test'
import { ZOTERO_IPC_CHANNELS, type ZoteroPingStatus } from './zotero.ts'

test('ZOTERO_IPC_CHANNELS 包含全部 34 个通道名', () => {
  expect(Object.keys(ZOTERO_IPC_CHANNELS).sort()).toEqual([
    'ARTICLE_CONFIG_GET',
    'ARTICLE_CONFIG_SET',
    'ARTICLE_REGENERATE_ALL',
    'ARTICLE_RETRY_ALL',
    'ARTICLE_STATUS_CHANGED',
    'ARTICLE_STATUS_SUMMARY',
    'BROWSE_INSTALL_PATH',
    'DETECT_INSTALL',
    'EMBED_CONFIG_GET',
    'EMBED_CONFIG_SET',
    'EMBED_MODEL_DOWNLOAD',
    'EMBED_MODEL_STATUS',
    'EMBED_MODEL_STATUS_CHANGED',
    'EMBED_REBUILD_ALL',
    'EMBED_STATUS_CHANGED',
    'EMBED_STATUS_SUMMARY',
    'GET_DATA_DIR',
    'GET_INSTALL_PATH',
    'LAUNCH_APP',
    'LIB_GET_ATTACHMENT_PATH',
    'LIB_GET_COLLECTION_ITEMS',
    'LIB_GET_ITEM',
    'LIB_GET_SELECTED_TARGET',
    'LIB_LIST_COLLECTIONS',
    'LIB_LIST_COLLECTION_TARGETS',
    'LIB_READ_PDF_BASE64',
    'LIB_SEARCH_ITEMS',
    'PDF_DIFF_NOW',
    'PDF_PARSE_STATUS',
    'PDF_STRUCTURED_TXT_GENERATE_ALL',
    'PING',
    'SET_DATA_DIR',
    'SET_ENABLED',
    'SET_INSTALL_PATH',
    'VALIDATE_INSTALL_PATH',
  ])
})

test('通道值带 zotero: 前缀', () => {
  for (const value of Object.values(ZOTERO_IPC_CHANNELS)) {
    expect(value).toMatch(/^zotero:/)
  }
})

test('ZoteroPingStatus 类型接受预期字段', () => {
  const status: ZoteroPingStatus = { running: true, remoteEnabled: true }
  expect(status.running).toBe(true)
  expect(status.remoteEnabled).toBe(true)
})
