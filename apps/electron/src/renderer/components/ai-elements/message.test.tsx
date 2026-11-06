import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageResponse } from './message.tsx'
import { i18n } from '@/lib/i18n'

beforeAll(async () => {
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

function expectInlineLabelClass(className: string): void {
  expect(className).toContain('asci-inline-chip')
  expect(className).toContain('bg-muted-foreground/15')
  expect(className).toContain('px-1.5')
  expect(className).toContain('text-[14px]')
  expect(className).toContain('font-normal')
  expect(className).toContain('text-foreground/85')
  expect(className).not.toContain('align-baseline')
  expect(className).not.toContain('min-h-6')
  expect(className).not.toContain('text-sm')
  expect(className).not.toContain('text-badge')
  expect(className).not.toContain('h-9')
  expect(className).not.toContain('px-4')
  expect(className).not.toContain('py-2')
  expect(className).not.toContain('bg-primary')
}

function expectInlineIconLabelClass(className: string): void {
  expect(className).toContain('asci-inline-chip')
  expect(className).toContain('bg-muted-foreground/15')
  expect(className).toContain('px-1.5')
  expect(className).toContain('text-[14px]')
  expect(className).toContain('font-normal')
  expect(className).not.toContain('align-baseline')
  expect(className).not.toContain('min-h-5')
  expect(className).not.toContain('min-h-6')
  expect(className).not.toContain('text-[15px]')
  expect(className).not.toContain('text-badge')
  expect(className).not.toContain('h-9')
  expect(className).not.toContain('px-4')
  expect(className).not.toContain('py-2')
}

function expectInlineChipStyle(style: string): void {
  expect(style).toContain('height: 20px')
  expect(style).toContain('line-height: 20px')
  expect(style).toContain('padding: 0px 6px')
  expect(style).toContain('vertical-align: -0.16em')
}

describe('MessageResponse 标签样式', () => {
  test('普通 inline code 和带图标 chip 使用同一正文字号', () => {
    render(
      <MessageResponse>
        {'交付物 `/tmp/report.md` 已保存到 `workspace-files/`，DOI `10.1000/asci-test`。'}
      </MessageResponse>,
    )

    const fileChip = screen.getByRole('button', { name: /report\.md/ })
    expectInlineIconLabelClass(fileChip.getAttribute('class') ?? '')
    expectInlineChipStyle(fileChip.getAttribute('style') ?? '')
    expect(fileChip.getAttribute('class') ?? '').not.toContain('h-auto')
    expect(fileChip.getAttribute('class') ?? '').not.toContain('py-0.5')
    expect(fileChip.querySelector('span')?.getAttribute('class') ?? '').toContain('asci-inline-chip-text')
    expect(fileChip.querySelector('svg')?.getAttribute('class') ?? '').toContain('!size-[13px]')

    const inlineCode = screen.getByText('workspace-files/')
    expect(inlineCode.tagName).toBe('CODE')
    expectInlineLabelClass(inlineCode.getAttribute('class') ?? '')
    expectInlineChipStyle(inlineCode.getAttribute('style') ?? '')

    const doiChip = screen.getByRole('button', { name: /10\.1000\/asci-test/ })
    expectInlineIconLabelClass(doiChip.getAttribute('class') ?? '')
    expectInlineChipStyle(doiChip.getAttribute('style') ?? '')
    expect(doiChip.querySelector('span')?.getAttribute('class') ?? '').toContain('asci-inline-chip-text')
    expect(doiChip.querySelector('svg')?.getAttribute('class') ?? '').toContain('!size-[13px]')
  })

  test('中文相对文件路径也渲染为带图标文件 chip', () => {
    render(
      <MessageResponse basePath="/workspace">
        {'综述已保存至 `./肠道菌群与抑郁症_简短综述.md`。'}
      </MessageResponse>,
    )

    const fileChip = screen.getByRole('button', { name: '肠道菌群与抑郁症_简短综述.md' })
    expectInlineIconLabelClass(fileChip.getAttribute('class') ?? '')
    expectInlineChipStyle(fileChip.getAttribute('style') ?? '')
    expect(fileChip.querySelector('svg')?.getAttribute('class') ?? '').toContain('!size-[13px]')
  })
})

describe('MessageResponse 交付物表格', () => {
  test('将交付物表格渲染为 Codex 风文件卡片，尤其是 Markdown 文档', () => {
    render(
      <MessageResponse basePath="/workspace">
        {[
          '## 交付物',
          '',
          '| # | 文件 | 说明 |',
          '|---|---|---|',
          '| 1 | `肠道菌群与抑郁症_简短综述.md` | 10 篇代表性论文的简短综述 |',
        ].join('\n')}
      </MessageResponse>,
    )

    expect(screen.queryByRole('table') === null).toBe(true)
    expect(screen.getByRole('button', { name: '肠道菌群与抑郁症_简短综述.md' })).toBeInTheDocument()
    expect(screen.queryByText('文档 · MD')).toBeNull()
    expect(screen.getByText('10 篇代表性论文的简短综述')).toBeInTheDocument()
  })

  test('交付物卡片使用更轻的 Codex 风格', () => {
    const { container } = render(
      <MessageResponse basePath="/workspace">
        {[
          '## 交付物',
          '',
          '| # | 文件 | 说明 |',
          '|---|---|---|',
          '| 1 | `summary.md` | 简短综述 |',
        ].join('\n')}
      </MessageResponse>,
    )

    const card = container.querySelector('.not-prose .not-prose')
    expect(card?.getAttribute('class') ?? '').toContain('border-border/60')
    expect(card?.getAttribute('class') ?? '').toContain('bg-card/70')
    expect(card?.getAttribute('class') ?? '').toContain('shadow-none')
    expect(card?.getAttribute('class') ?? '').toContain('px-3')
    expect(card?.getAttribute('class') ?? '').toContain('py-2.5')

    const title = screen.getByRole('button', { name: 'summary.md' })
    expect(title.getAttribute('class') ?? '').toContain('font-medium')
    expect(title.getAttribute('class') ?? '').toContain('text-foreground/90')
  })

  test('交付物卡片按文件类型使用同规格图标，html 与 md 有区分', () => {
    const { container } = render(
      <MessageResponse basePath="/workspace">
        {[
          '## 交付物',
          '',
          '| # | 文件 | 说明 |',
          '|---|---|---|',
          '| 1 | `report.html` | 完整检索报告 |',
          '| 2 | `summary.md` | 简短综述 |',
        ].join('\n')}
      </MessageResponse>,
    )

    const iconEls = Array.from(container.querySelectorAll('.not-prose > div > svg'))

    // 交付物图标走统一的自绘 svg（result-card-icons），同规格 size-5、跟随 currentColor
    expect(iconEls).toHaveLength(2)
    for (const icon of iconEls) expect(icon.getAttribute('class') ?? '').toContain('size-5')

    // html → WebIcon（地球）/ md → TextFileIcon（文本行）：两者形状不同，确保按类型区分
    const htmlIcon = iconEls[0]?.innerHTML ?? ''
    const mdIcon = iconEls[1]?.innerHTML ?? ''
    expect(htmlIcon).not.toBe(mdIcon)
    // WebIcon 的地球轮廓 path 仅出现在 html 图标里
    expect(htmlIcon).toContain('M10 18.125C14.4874')
    expect(mdIcon).not.toContain('M10 18.125C14.4874')
    // TextFileIcon 的文本行 path 仅出现在 md 图标里
    expect(mdIcon).toContain('M7 7.5H12.5')
  })
})

describe('MessageResponse 标题样式', () => {
  test('对话流 Markdown 排版更轻，标题使用正文字号并补冒号', () => {
    const { container } = render(
      <MessageResponse>
        {[
          '# 交付物',
          '',
          '正文内容',
        ].join('\n')}
      </MessageResponse>,
    )

    const response = container.firstElementChild
    expect(screen.getByRole('heading', { name: '交付物：' })).toBeInTheDocument()
    expect(response?.getAttribute('class') ?? '').toContain('text-foreground/85')
    expect(response?.getAttribute('class') ?? '').toContain('text-[14px]')
    expect(response?.getAttribute('class') ?? '').toContain('prose-headings:text-[14px]')
    expect(response?.getAttribute('class') ?? '').toContain('prose-headings:font-medium')
    expect(response?.getAttribute('class') ?? '').toContain('prose-headings:leading-[1.6]')
    expect(response?.getAttribute('class') ?? '').toContain('prose-li:my-1.5')
    expect(response?.getAttribute('class') ?? '').toContain('prose-ul:my-3')
    expect(response?.getAttribute('class') ?? '').toContain('[&_li::marker]:text-foreground/70')
  })
})

describe('MessageResponse 普通表格样式', () => {
  test('章节表格使用轻卡片容器，并保护第一列标题不被窄切换行', () => {
    const { container } = render(
      <MessageResponse>
        {[
          '## 文件结构概览',
          '',
          '| 章节 | 内容 |',
          '|---|---|',
          '| 1 关联证据 | α 多样性与症状严重度、时间不稳定性生物标志物 |',
          '| 2 分子机制 | IUPHAR 代谢物综述、赖氨酸-mTOR-自噬 |',
        ].join('\n')}
      </MessageResponse>,
    )

    const table = screen.getByRole('table')
    const card = table.parentElement
    expect(card?.getAttribute('class') ?? '').toContain('rounded-xl')
    expect(card?.getAttribute('class') ?? '').toContain('border-border/60')
    expect(card?.getAttribute('class') ?? '').toContain('bg-card/70')
    const className = table.getAttribute('class') ?? ''
    expect(className).toContain('text-[14px]')
    expect(className).toContain('min-w-[42rem]')
    expect(className).toContain('[&_td:first-child]:min-w-36')
    expect(className).toContain('[&_td:first-child]:whitespace-nowrap')
    expect(container.textContent).toContain('1 关联证据')
  })
})
