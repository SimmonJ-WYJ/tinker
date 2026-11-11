/** 同一合成turn夹具直接核对原Electron投影；仅固定错误码文案由宿主transport翻译。 */
import { expect, test } from 'bun:test'
import type { DesktopTurn } from '@asci/shared'
import cases from '../../../../../../packages/shared/src/fixtures/desktop-turn-projection.json'
import { projectHistory } from './projection.ts'
for (const fixture of cases) {
  test(`native history contract matches existing projectHistory: ${fixture.name}`, () => {
    const actual = projectHistory(fixture.turns as DesktopTurn[])
    const normalized = JSON.parse(JSON.stringify(actual)) as {
      sdkMessages: Array<{ error?: { message: string } }>
    }
    for (const message of normalized.sdkMessages) {
      if (message.error) message.error.message = 'responseFailed'
    }
    expect(normalized).toEqual(fixture.expected)
  })
}
