/**
 * locale 值非空守门
 *
 * 防止 locale 值被清成空串：`lib/i18n.ts` 配置 `returnEmptyString: false`，
 * i18next 会把空串值当作缺失并静默返回 key 字符串本身（truthy），
 * 从而击穿组件层的 `{description && …}` 类守卫，raw key 直接上屏（见 issue #613）。
 *
 * key-parity 只比键集合、zh-punctuation 只查标点，二者对"空串值"均盲，
 * 故单独断言：所有命名空间下的 leaf 字符串值都不得为空（含纯空白）。
 */

import { test, expect } from 'bun:test'
import { defaultResources, I18N_NAMESPACES } from './index.ts'
import { collectStringLeaves } from './test-helpers.ts'

for (const lang of ['en', 'zh'] as const) {
  for (const ns of I18N_NAMESPACES) {
    test(`locale 值非空: ${lang} 命名空间 "${ns}" 无空串值`, () => {
      const emptyKeys = collectStringLeaves(defaultResources[lang][ns])
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)
        .sort()

      expect(
        emptyKeys,
        `${lang}/${ns} 存在空串值（returnEmptyString: false 下会渲染成 raw key）：${JSON.stringify(emptyKeys)}；` +
          `若该位置确实不需要文案，请让组件不传该 prop 并删除 en/zh 两侧 key`,
      ).toEqual([])
    })
  }
}
