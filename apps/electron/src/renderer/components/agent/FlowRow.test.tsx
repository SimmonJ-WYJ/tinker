import { describe, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { FlowRow } from './FlowRow.tsx'

describe('FlowRow', () => {
  test('可展开行使用内容宽度的轻量 summary 样式，不再把箭头推到整行最右', () => {
    render(
      <FlowRow expandable expanded={false} onToggle={() => {}}>
        <span>写入 report.md +75</span>
      </FlowRow>,
    )

    const button = screen.getByRole('button')
    const className = button.getAttribute('class') ?? ''
    expect(className).toContain('max-w-full')
    expect(className).toContain('rounded-lg')
    expect(className).toContain('bg-muted-foreground/8')
    expect(className).toContain('px-2')
    expect(className).toContain('hover:bg-muted-foreground/14')
    expect(className.split(/\s+/)).not.toContain('w-full')
  })
})
