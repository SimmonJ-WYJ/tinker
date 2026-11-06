import { afterEach, expect, test, mock } from 'bun:test'
import { cleanup, render, renderHook, act, fireEvent, screen } from '@testing-library/react'
import { Provider } from 'jotai'
import { TaskModeSelector, useTaskMode } from './TaskModeSelector'
afterEach(cleanup)
test('双模式切换只触发所选模式，执行中不能切换', () => {
 const change = mock(() => {})
 const { rerender } = render(<TaskModeSelector value="coding" onChange={change} />)
 const search = screen.getByRole('button', { name: 'Agent' })
 expect(screen.getByRole('button', { name: 'Coding' })).toHaveAttribute('aria-pressed', 'true')
 fireEvent.click(search); expect(change).toHaveBeenCalledWith('search')
 rerender(<TaskModeSelector value="search" onChange={change} disabled />)
 expect(search).toHaveAttribute('aria-pressed', 'true')
 expect(search).toBeDisabled()
})

test('新会话默认搜索，切换只影响当前会话', () => {
 const { result, rerender } = renderHook(({ id }) => useTaskMode(id), { initialProps: { id: 'first' }, wrapper: Provider })
 expect(result.current[0]).toBe('search')
 act(() => result.current[1]('coding'))
 expect(result.current[0]).toBe('coding')
 rerender({ id: 'second' })
 expect(result.current[0]).toBe('search')
 rerender({ id: 'first' })
 expect(result.current[0]).toBe('coding')
})

test('未选中模式只保留图标，滑块跟随选中侧', () => {
 const { container, rerender } = render(<TaskModeSelector value="search" onChange={() => {}} />)
 expect(container.querySelector('[data-mode="search"] .task-mode-selector__label')).toHaveAttribute('aria-hidden', 'false')
 expect(container.querySelector('[data-mode="coding"] .task-mode-selector__label')).toHaveAttribute('aria-hidden', 'true')
 expect(container.querySelector('.task-mode-selector')).toHaveAttribute('data-selected', 'search')
 rerender(<TaskModeSelector value="coding" onChange={() => {}} />)
 expect(container.querySelector('.task-mode-selector')).toHaveAttribute('data-selected', 'coding')
 expect(container.querySelector('[data-mode="search"] .task-mode-selector__label')).toHaveAttribute('aria-hidden', 'true')
 expect(container.querySelector('.task-mode-selector__thumb')).not.toBeNull()
})

test('首次发送锁定后不能更改，其他草稿仍可选择', async () => {
 const { createStore } = await import('jotai')
 const { lockTaskModeAtom, taskModesAtom } = await import('./TaskModeSelector')
 const store = createStore()
 const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>
 const { result, rerender } = renderHook(({ id }) => useTaskMode(id), { initialProps: { id: 'locked-test' }, wrapper })
 act(() => result.current[1]('coding'))
 act(() => store.set(lockTaskModeAtom, 'locked-test'))
 act(() => result.current[1]('search'))
 expect(result.current[0]).toBe('coding')
 expect(store.get(taskModesAtom)['locked-test']).toBe('coding')
 rerender({ id: 'draft-test' })
 act(() => result.current[1]('coding'))
 expect(result.current[0]).toBe('coding')
})

test('已锁定模式隐藏标签和切换按钮', () => {
 render(<TaskModeSelector value="coding" locked onChange={() => { throw Error('cannot switch') }} />)
 expect(screen.queryByRole('button')).toBeNull()
 expect(screen.queryByText('Coding')).toBeNull()
})
