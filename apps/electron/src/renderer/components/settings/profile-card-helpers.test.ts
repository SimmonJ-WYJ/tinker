import { expect, test } from 'bun:test'
import { resolveProfileNameSave } from './profile-card-helpers.ts'

test('resolveProfileNameSave：空白名称不保存并回退当前名称', () => {
  expect(resolveProfileNameSave('   ', 'alex')).toEqual({
    nextName: 'alex',
    shouldSave: false,
  })
})

test('resolveProfileNameSave：有效名称 trim 后保存', () => {
  expect(resolveProfileNameSave('  Alex Chen  ', 'alex')).toEqual({
    nextName: 'Alex Chen',
    shouldSave: true,
  })
})
