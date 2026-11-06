/**
 * review-html-citations 单测：只测 §7 References 结构化解析。
 *
 * <cite> hover / click 行为由 ReviewHtmlRenderer 通过 React Portal 挂载 CitationBadge
 * 实现，复用 markdown 注引那一套（已被 CitationBadge 单测覆盖）；本文件不再重复测。
 */
import { describe, expect, test } from 'bun:test'

import { parseReferencesFromHtml } from './review-html-citations.ts'

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('parseReferencesFromHtml', () => {
  test('从 <ol class="refs"> 抽出多条 References 并按 N 索引', () => {
    const root = makeRoot(`
      <section id="s7" class="references">
        <h2>§7 References</h2>
        <ol class="refs">
          <li id="ref-1" data-ref="1" data-doi="10.1364/OE.21.025418">
            Broxton, M., et al. <i>Wave optics theory and 3D deconvolution for the light field microscope</i>. Optics Express, 2013.
          </li>
          <li id="ref-3" data-ref="3">
            Stefanoiu, A. <i>Artifact-free deconvolution in light field microscopy</i>. (2019)
          </li>
        </ol>
      </section>
    `)
    const refs = parseReferencesFromHtml(root)
    expect(refs.size).toBe(2)

    const r1 = refs.get(1)!
    expect(r1.refNumber).toBe(1)
    expect(r1.title).toBe(
      'Wave optics theory and 3D deconvolution for the light field microscope',
    )
    expect(r1.authors).toBe('Broxton, M., et al')
    expect(r1.venue).toBe('Optics Express')
    expect(r1.year).toBe('2013')
    expect(r1.doi).toBe('10.1364/OE.21.025418')
    expect(r1.paperId).toBeUndefined()

    const r3 = refs.get(3)!
    expect(r3.title).toBe('Artifact-free deconvolution in light field microscopy')
    expect(r3.authors).toBe('Stefanoiu, A')
    expect(r3.year).toBe('2019')
  })

  test('跳过缺 data-ref 的 <li>，仅返回合法条目', () => {
    const root = makeRoot(`
      <ol class="refs">
        <li id="ref-1" data-ref="1">A. <i>T1</i>. 2020.</li>
        <li id="bogus">no data-ref</li>
        <li id="ref-2" data-ref="abc">parse fail data-ref</li>
        <li data-ref="0">illegal zero</li>
      </ol>
    `)
    const refs = parseReferencesFromHtml(root)
    expect([...refs.keys()]).toEqual([1])
  })

  test('支持 section.references 选择器兜底（即使 ol 没 class="refs"）', () => {
    const root = makeRoot(`
      <section class="references">
        <ol>
          <li id="ref-5" data-ref="5">X. <i>Title</i>. (2024)</li>
        </ol>
      </section>
    `)
    const refs = parseReferencesFromHtml(root)
    expect(refs.size).toBe(1)
    expect(refs.get(5)?.title).toBe('Title')
    expect(refs.get(5)?.year).toBe('2024')
  })

  test('找不到 References 块 → 返回空 Map（不抛错）', () => {
    const root = makeRoot('<p>no refs at all</p>')
    const refs = parseReferencesFromHtml(root)
    expect(refs.size).toBe(0)
  })

  test('Year 取 raw 里最后一个 4 位数（兼容 "(2019)" / ", 2024" / 句末）', () => {
    const root = makeRoot(`
      <ol class="refs">
        <li id="ref-1" data-ref="1">A. <i>T</i>. JCP, 2018; revised 2024.</li>
      </ol>
    `)
    expect(parseReferencesFromHtml(root).get(1)?.year).toBe('2024')
  })

  test('忽略空 textContent 的 <li>', () => {
    const root = makeRoot(`
      <ol class="refs">
        <li id="ref-1" data-ref="1">   </li>
      </ol>
    `)
    expect(parseReferencesFromHtml(root).size).toBe(0)
  })
})
