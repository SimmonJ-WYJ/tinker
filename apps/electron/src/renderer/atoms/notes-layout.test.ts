import { describe, expect, test } from 'bun:test'

import {
  clampWidth,
  NOTES_LIST_MIN,
  NOTES_LIST_MAX,
  NOTES_DETAIL_MIN,
  NOTES_DETAIL_MAX,
} from './notes-layout.ts'

describe('clampWidth', () => {
  test('returns value unchanged within range', () => {
    expect(clampWidth(420, NOTES_LIST_MIN, NOTES_LIST_MAX)).toBe(420)
  })

  test('clamps below min up to min', () => {
    expect(clampWidth(100, NOTES_LIST_MIN, NOTES_LIST_MAX)).toBe(NOTES_LIST_MIN)
  })

  test('clamps above max down to max', () => {
    expect(clampWidth(9999, NOTES_DETAIL_MIN, NOTES_DETAIL_MAX)).toBe(NOTES_DETAIL_MAX)
  })

  test('returns min boundary exactly', () => {
    expect(clampWidth(NOTES_DETAIL_MIN, NOTES_DETAIL_MIN, NOTES_DETAIL_MAX)).toBe(NOTES_DETAIL_MIN)
  })

  test('falls back to min for non-finite (corrupt localStorage)', () => {
    expect(clampWidth(NaN, NOTES_LIST_MIN, NOTES_LIST_MAX)).toBe(NOTES_LIST_MIN)
    expect(clampWidth(Infinity, NOTES_LIST_MIN, NOTES_LIST_MAX)).toBe(NOTES_LIST_MIN)
  })
})
