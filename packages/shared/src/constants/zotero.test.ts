/**
 * 守住 Zotero 常量的模板拼接结果 —— 派生 URL 一旦被误改（端口/路径漂移）立即报警。
 */
import { describe, expect, test } from 'bun:test'
import {
  ZOTERO_CONNECTOR_PING_URL,
  ZOTERO_CONNECTOR_PORT,
  ZOTERO_LOCAL_API_BASE,
} from './zotero.ts'

describe('zotero constants', () => {
  test('端口为 connector 协议固定值 23119', () => {
    expect(ZOTERO_CONNECTOR_PORT).toBe(23119)
  })

  test('派生 URL 拼接正确', () => {
    expect(ZOTERO_LOCAL_API_BASE).toBe('http://localhost:23119/api')
    expect(ZOTERO_CONNECTOR_PING_URL).toBe('http://localhost:23119/connector/ping')
  })
})
