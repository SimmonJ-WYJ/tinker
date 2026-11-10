import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'jotai'
import { McpSection } from './McpSection'

afterEach(cleanup)
test('MCP settings expose independent OCR/ASR controls, preserve custom servers and never download on mount', async () => {
 const previous = window.electronAPI
 const patches: unknown[] = []
 let downloads = 0
 let capabilityReads = 0
 const settings = { zoteroEnabled: false, zoteroOcrEnabled: true, zoteroAsrEnabled: false }
 window.electronAPI = {
   getGlobalMcpConfig: async () => ({ servers: { custom: { type: 'stdio', command: 'local-fake', enabled: true } } }),
   getWorkspaceCapabilities: async () => { capabilityReads++; return { mcpServers: [{ name: 'ocr', type: 'stdio', enabled: settings.zoteroOcrEnabled, isBuiltin: true }, { name: 'asr', type: 'stdio', enabled: settings.zoteroAsrEnabled, isBuiltin: true }], skills: [] } },
   onMcpGlobalChanged: () => () => {},
   getSettings: async () => settings,
   updateSettings: async (patch: object) => { patches.push(patch); Object.assign(settings, patch); return settings },
   mediaCache: { stats: async () => ({ entryCount: 0, totalBytes: 0 }) },
   asrWeights: { getStatus: async () => ({ state: 'ready' }), download: async () => { downloads++; return { state: 'ready' } } },
 } as unknown as typeof window.electronAPI
 try {
   let view: ReturnType<typeof render>
   await act(async () => { view = render(<Provider><McpSection workspaceSlug="synthetic" capabilitiesVersion={0} /></Provider>) })
   expect(downloads).toBe(0)
   expect(screen.getAllByRole('switch')).toHaveLength(3)
   await act(async () => { fireEvent.click(screen.getAllByRole('switch')[0]!) })
   expect(patches).toEqual([{ zoteroOcrEnabled: false }])
   expect(settings.zoteroEnabled).toBe(false)
   await act(async () => { fireEvent.click(screen.getAllByRole('switch')[1]!) })
   expect(patches[1]).toEqual({ zoteroAsrEnabled: true })
   expect(downloads).toBe(0)
   expect(capabilityReads).toBeGreaterThan(1)
   expect(screen.getByText('custom')).toBeTruthy()
   settings.zoteroOcrEnabled = true
   await act(async () => { view.rerender(<Provider><McpSection workspaceSlug="synthetic" capabilitiesVersion={1} /></Provider>) })
   expect(screen.getAllByRole('switch')[0]!.getAttribute('data-state')).toBe('checked')
 } finally { window.electronAPI = previous }
})
