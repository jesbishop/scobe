import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentEvent,
  BrowserFrame,
  BuildUiEvent,
  Camera,
  ChromeStatus,
  DesignNode,
  DesignPage,
  InspectInfo,
  LayoutSyncItem,
  McpStatus,
  Workspace
} from '../shared/types'
import type { AgentMcpLinkStatus, CodingAgentId } from '../shared/codingAgents'
import type { SnapshotEvent } from '../shared/snapshot'
import type { JevQuestions, JevResponse, JevStatus, TranscriberStatus } from '../shared/jev'
import type { QuiverGenerateInput, QuiverStatus, QuiverStreamEvent, QuiverVectorizeInput } from '../shared/quiver'

const api = {
  getStatus: (): Promise<ChromeStatus> => ipcRenderer.invoke('vanta:getStatus'),
  getWorkspace: (): Promise<Workspace> => ipcRenderer.invoke('vanta:getWorkspace'),
  getBrowsers: (): Promise<BrowserFrame[]> => ipcRenderer.invoke('vanta:getBrowsers'),
  createBrowser: (input?: {
    url?: string
    x?: number
    y?: number
    width?: number
    height?: number
  }): Promise<BrowserFrame> => ipcRenderer.invoke('vanta:createBrowser', input),
  createTab: (windowId: string, url?: string): Promise<BrowserFrame> =>
    ipcRenderer.invoke('vanta:createTab', windowId, url),
  activateTab: (windowId: string, tabId: string): Promise<void> =>
    ipcRenderer.invoke('vanta:activateTab', windowId, tabId),
  closeTab: (windowId: string, tabId: string): Promise<void> => ipcRenderer.invoke('vanta:closeTab', windowId, tabId),
  closeBrowser: (id: string): Promise<void> => ipcRenderer.invoke('vanta:closeBrowser', id),
  navigate: (id: string, url: string): Promise<void> => ipcRenderer.invoke('vanta:navigate', id, url),
  back: (id: string): Promise<void> => ipcRenderer.invoke('vanta:back', id),
  forward: (id: string): Promise<void> => ipcRenderer.invoke('vanta:forward', id),
  reload: (id: string): Promise<void> => ipcRenderer.invoke('vanta:reload', id),
  focus: (id: string): Promise<void> => ipcRenderer.invoke('vanta:focus', id),
  focusShell: (): Promise<void> => ipcRenderer.invoke('vanta:focusShell'),
  setCamera: (camera: Camera): Promise<void> => ipcRenderer.invoke('vanta:setCamera', camera),
  updateFrame: (patch: Partial<BrowserFrame> & { id: string }): Promise<void> =>
    ipcRenderer.invoke('vanta:updateFrame', patch),
  setClickThrough: (enabled: boolean): Promise<void> => ipcRenderer.invoke('vanta:setClickThrough', enabled),
  setTheme: (theme: 'light' | 'dark'): Promise<void> => ipcRenderer.invoke('vanta:setTheme', theme),
  openSidebarBrowser: (id: string, url: string): Promise<void> =>
    ipcRenderer.invoke('vanta:openSidebarBrowser', id, url),
  syncLayout: (items: LayoutSyncItem[]): Promise<void> => ipcRenderer.invoke('vanta:syncLayout', items),
  setInspect: (id: string | null): Promise<void> => ipcRenderer.invoke('vanta:setInspect', id),
  setMesurer: (
    id: string | null,
    mode: { inspect?: boolean; xray?: boolean } | null
  ): Promise<void> => ipcRenderer.invoke('vanta:setMesurer', id, mode),
  setSnapshot: (id: string | null): Promise<void> => ipcRenderer.invoke('vanta:setSnapshot', id),
  getDesign: (): Promise<DesignNode[]> => ipcRenderer.invoke('vanta:getDesign'),
  setDesign: (nodes: DesignNode[]): Promise<DesignNode[]> => ipcRenderer.invoke('vanta:setDesign', nodes),
  addDesign: (node: DesignNode): Promise<DesignNode[]> => ipcRenderer.invoke('vanta:addDesign', node),
  screenshotBrowser: (tabOrWindowId: string): Promise<{ width: number; height: number; dataUrl: string }> =>
    ipcRenderer.invoke('vanta:screenshotBrowser', tabOrWindowId),
  setPages: (pages: DesignPage[], activePageId: string): Promise<void> =>
    ipcRenderer.invoke('vanta:setPages', pages, activePageId),
  runAgent: (messages: Array<{ role: 'user' | 'assistant'; text: string }>): Promise<void> =>
    ipcRenderer.invoke('vanta:runAgent', messages),
  getMcpStatus: (): Promise<McpStatus> => ipcRenderer.invoke('vanta:getMcpStatus'),
  getAgentMcpLink: (agentId: CodingAgentId): Promise<AgentMcpLinkStatus> =>
    ipcRenderer.invoke('vanta:getAgentMcpLink', agentId),
  connectAgentMcp: (agentId: CodingAgentId): Promise<AgentMcpLinkStatus> =>
    ipcRenderer.invoke('vanta:connectAgentMcp', agentId),
  disconnectAgentMcp: (agentId: CodingAgentId): Promise<AgentMcpLinkStatus> =>
    ipcRenderer.invoke('vanta:disconnectAgentMcp', agentId),
  confirmCloudAgentMcp: (agentId: CodingAgentId): Promise<AgentMcpLinkStatus> =>
    ipcRenderer.invoke('vanta:confirmCloudAgentMcp', agentId),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('vanta:openExternal', url),
  jevStatus: (): Promise<JevStatus> => ipcRenderer.invoke('vanta:jevStatus'),
  jevSetKey: (key: string): Promise<JevStatus> => ipcRenderer.invoke('vanta:jevSetKey', key),
  jevAsk: (state: string, questions: JevQuestions): Promise<JevResponse> =>
    ipcRenderer.invoke('vanta:jevAsk', state, questions),
  quiverStatus: (): Promise<QuiverStatus> => ipcRenderer.invoke('vanta:quiverStatus'),
  quiverSetKey: (key: string): Promise<QuiverStatus> => ipcRenderer.invoke('vanta:quiverSetKey', key),
  quiverGenerateSvg: (
    input: QuiverGenerateInput
  ): Promise<{ ok: true; svg: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('vanta:quiverGenerateSvg', input),
  quiverVectorizeSvg: (
    input: QuiverVectorizeInput
  ): Promise<{ ok: true; svg: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('vanta:quiverVectorizeSvg', input),
  quiverAbort: (): void => {
    ipcRenderer.send('vanta:quiverAbort')
  },
  onQuiver: (handler: (event: QuiverStreamEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: QuiverStreamEvent) => handler(payload)
    ipcRenderer.on('vanta:quiver', listener)
    return () => ipcRenderer.off('vanta:quiver', listener)
  },
  transcriberStatus: (): Promise<TranscriberStatus> => ipcRenderer.invoke('vanta:transcriberStatus'),
  warmTranscriber: (): Promise<TranscriberStatus> => ipcRenderer.invoke('vanta:warmTranscriber'),
  transcribe: (audio: Float32Array): Promise<string> => ipcRenderer.invoke('vanta:transcribe', audio),
  onTranscriber: (handler: (status: TranscriberStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: TranscriberStatus) => handler(status)
    ipcRenderer.on('vanta:transcriber', listener)
    return () => ipcRenderer.off('vanta:transcriber', listener)
  },
  removeBackgroundStatus: (): Promise<{ state: 'idle' | 'loading' | 'ready' | 'error'; error?: string }> =>
    ipcRenderer.invoke('vanta:removeBackgroundStatus'),
  warmRemoveBackground: (): Promise<{ state: 'idle' | 'loading' | 'ready' | 'error'; error?: string }> =>
    ipcRenderer.invoke('vanta:warmRemoveBackground'),
  removeBackground: (
    imageDataUrl: string
  ): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> =>
    ipcRenderer.invoke('vanta:removeBackground', imageDataUrl),
  onRemoveBackgroundProgress: (handler: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, message: string) => handler(message)
    ipcRenderer.on('vanta:removeBackgroundProgress', listener)
    return () => ipcRenderer.off('vanta:removeBackgroundProgress', listener)
  },
  onRemoveBackgroundStatus: (
    handler: (status: { state: 'idle' | 'loading' | 'ready' | 'error'; error?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      status: { state: 'idle' | 'loading' | 'ready' | 'error'; error?: string }
    ) => handler(status)
    ipcRenderer.on('vanta:removeBackgroundStatus', listener)
    return () => ipcRenderer.off('vanta:removeBackgroundStatus', listener)
  },
  onBrowsers: (handler: (browsers: BrowserFrame[]) => void): (() => void) => {
    const listener = (_event: unknown, browsers: BrowserFrame[]) => handler(browsers)
    ipcRenderer.on('vanta:browsers', listener)
    return () => ipcRenderer.off('vanta:browsers', listener)
  },
  onStatus: (handler: (status: ChromeStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: ChromeStatus) => handler(status)
    ipcRenderer.on('vanta:status', listener)
    return () => ipcRenderer.off('vanta:status', listener)
  },
  onNeedLayout: (handler: () => void): (() => void) => {
    const listener = () => handler()
    ipcRenderer.on('vanta:need-layout', listener)
    return () => ipcRenderer.off('vanta:need-layout', listener)
  },
  onWorkspace: (handler: (workspace: Workspace) => void): (() => void) => {
    const listener = (_event: unknown, workspace: Workspace) => handler(workspace)
    ipcRenderer.on('vanta:workspace', listener)
    return () => ipcRenderer.off('vanta:workspace', listener)
  },
  onInspect: (handler: (info: InspectInfo | null) => void): (() => void) => {
    const listener = (_event: unknown, info: InspectInfo | null) => handler(info)
    ipcRenderer.on('vanta:inspect', listener)
    return () => ipcRenderer.off('vanta:inspect', listener)
  },
  onSnapshot: (handler: (event: SnapshotEvent) => void): (() => void) => {
    const listener = (_event: unknown, event: SnapshotEvent) => handler(event)
    ipcRenderer.on('vanta:snapshot', listener)
    return () => ipcRenderer.off('vanta:snapshot', listener)
  },
  onAgent: (handler: (event: AgentEvent) => void): (() => void) => {
    const listener = (_event: unknown, event: AgentEvent) => handler(event)
    ipcRenderer.on('vanta:agent', listener)
    return () => ipcRenderer.off('vanta:agent', listener)
  },
  onDesign: (handler: (nodes: DesignNode[]) => void): (() => void) => {
    const listener = (_event: unknown, nodes: DesignNode[]) => handler(nodes)
    ipcRenderer.on('vanta:design', listener)
    return () => ipcRenderer.off('vanta:design', listener)
  },
  onBuild: (handler: (event: BuildUiEvent) => void): (() => void) => {
    const listener = (_event: unknown, event: BuildUiEvent) => handler(event)
    ipcRenderer.on('vanta:build', listener)
    return () => ipcRenderer.off('vanta:build', listener)
  },
  onCanvasWheel: (
    handler: (event: {
      deltaX: number
      deltaY: number
      deltaMode: number
      clientX: number
      clientY: number
      ctrlKey: boolean
      metaKey: boolean
      shiftKey: boolean
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: {
        deltaX: number
        deltaY: number
        deltaMode: number
        clientX: number
        clientY: number
        ctrlKey: boolean
        metaKey: boolean
        shiftKey: boolean
      }
    ) => handler(payload)
    ipcRenderer.on('vanta:canvas-wheel', listener)
    return () => ipcRenderer.off('vanta:canvas-wheel', listener)
  },
  onCanvasZoomKey: (handler: (event: { key: string; shiftKey: boolean }) => void): (() => void) => {
    const listener = (_event: unknown, payload: { key: string; shiftKey: boolean }) => handler(payload)
    ipcRenderer.on('vanta:canvas-zoom-key', listener)
    return () => ipcRenderer.off('vanta:canvas-zoom-key', listener)
  }
}

contextBridge.exposeInMainWorld('vanta', api)

export type VantaApi = typeof api
