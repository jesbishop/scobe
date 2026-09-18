import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromeHost } from './chrome'
import { addDesign, getDesign, onDesignChange, setDesign } from './designStore'
import { loadWorkspace, saveWorkspace } from './workspace'
import { loadEnv } from './env'
import { runAgent } from './agent'
import { onBuildEvent, type BuildEvent } from './buildBus'
import { startVantaMcp, stopVantaMcp, isVantaMcpRunning, VANTA_MCP_URL, VANTA_MCP_PORT } from './mcpServer'
import {
  DEFAULT_PAGE,
  DEFAULT_URL,
  DEFAULT_VIEWPORT,
  NEW_TAB_URL,
  type AgentEvent,
  type BrowserFrame,
  type BrowserTab,
  type Camera,
  type DesignNode,
  type DesignPage,
  type InspectInfo,
  type LayoutSyncItem,
  type McpStatus,
  type Workspace
} from '../shared/types'

app.setName('Vanta')

const isPrimary = app.requestSingleInstanceLock()
if (!isPrimary) {
  app.quit()
}

const frames = new Map<string, BrowserFrame>()
let camera: Camera = { x: 80, y: 80, zoom: 1 }
let pages: DesignPage[] = [{ ...DEFAULT_PAGE }]
let activePageId = DEFAULT_PAGE.id
let mainWindow: BrowserWindow | null = null
let workspaceFile = ''
let saveTimer: NodeJS.Timeout | null = null
let quitting = false
let agentRunning = false

function emptyTab(id: string, url: string): BrowserTab {
  return {
    id,
    url,
    title: '',
    favicon: '',
    canGoBack: false,
    canGoForward: false,
    loading: true
  }
}

function workspaceSnapshot(): Workspace {
  return {
    version: 2,
    camera,
    browsers: [...frames.values()].map((frame) => ({
      id: frame.id,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      activeTabId: frame.activeTabId,
      tabs: frame.tabs.map((tab) => ({ id: tab.id, url: tab.url }))
    })),
    design: getDesign(),
    pages,
    activePageId
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveWorkspace(workspaceFile, workspaceSnapshot())
  }, 400)
}

function mergeChromeState(): BrowserFrame[] {
  const live = new Map(chromeHost.list().map((item) => [item.id, item]))
  const next: BrowserFrame[] = []
  for (const frame of frames.values()) {
    const tabs = frame.tabs.map((tab) => {
      const page = live.get(tab.id)
      return page
        ? {
            ...tab,
            url: page.url || tab.url,
            title: page.title || tab.title,
            favicon: page.favicon || tab.favicon,
            canGoBack: page.canGoBack,
            canGoForward: page.canGoForward,
            loading: page.loading
          }
        : tab
    })
    const merged: BrowserFrame = { ...frame, tabs }
    frames.set(frame.id, merged)
    next.push(merged)
  }
  return next
}

function broadcastFrames(): void {
  mainWindow?.webContents.send('vanta:browsers', mergeChromeState())
}

function requireFrame(id: string): BrowserFrame {
  const frame = frames.get(id)
  if (!frame) throw new Error('Window is not available')
  return frame
}

async function createPage(frame: BrowserFrame, tab: BrowserTab): Promise<void> {
  await chromeHost.createCanvasBrowser({
    id: tab.id,
    windowId: frame.id,
    url: tab.url,
    viewport: { width: frame.width, height: frame.height },
    bounds: { x: 48, y: 88, width: Math.min(960, frame.width), height: Math.min(640, frame.height) }
  })
}

async function createBrowser(input?: {
  id?: string
  url?: string
  x?: number
  y?: number
  width?: number
  height?: number
  activeTabId?: string
  tabs?: Array<{ id: string; url: string }>
}): Promise<BrowserFrame> {
  if (!mainWindow) throw new Error('Window is not ready')
  const id = input?.id || randomUUID()
  const tabs = (input?.tabs?.length ? input.tabs : [{ id: input?.activeTabId || randomUUID(), url: input?.url || DEFAULT_URL }]).map(
    (tab) => emptyTab(tab.id, tab.url)
  )
  const frame: BrowserFrame = {
    id,
    x: input?.x ?? 80,
    y: input?.y ?? 80,
    width: input?.width ?? DEFAULT_VIEWPORT.width,
    height: input?.height ?? DEFAULT_VIEWPORT.height,
    activeTabId: input?.activeTabId || tabs[0].id,
    tabs
  }
  frames.set(id, frame)
  for (const tab of tabs) {
    try {
      await createPage(frame, tab)
    } catch (error) {
      console.error('[window] create tab failed', error)
    }
  }
  broadcastFrames()
  scheduleSave()
  mainWindow.webContents.send('vanta:need-layout')
  return frame
}

async function createTab(windowId: string, url?: string): Promise<BrowserFrame> {
  const frame = requireFrame(windowId)
  const tab = emptyTab(randomUUID(), url || NEW_TAB_URL)
  frame.tabs = [...frame.tabs, tab]
  frame.activeTabId = tab.id
  frames.set(windowId, frame)
  await createPage(frame, tab)
  broadcastFrames()
  scheduleSave()
  mainWindow?.webContents.send('vanta:need-layout')
  return frame
}

async function activateTab(windowId: string, tabId: string): Promise<void> {
  const frame = requireFrame(windowId)
  if (!frame.tabs.some((tab) => tab.id === tabId)) return
  frame.activeTabId = tabId
  frames.set(windowId, frame)
  await chromeHost.focus(tabId)
  broadcastFrames()
  scheduleSave()
  mainWindow?.webContents.send('vanta:need-layout')
}

async function closeTab(windowId: string, tabId: string): Promise<void> {
  const frame = frames.get(windowId)
  if (!frame) return
  if (frame.tabs.length <= 1) {
    await closeWindow(windowId)
    return
  }
  frame.tabs = frame.tabs.filter((tab) => tab.id !== tabId)
  if (frame.activeTabId === tabId) {
    frame.activeTabId = frame.tabs[frame.tabs.length - 1].id
  }
  frames.set(windowId, frame)
  await chromeHost.closeBrowser(tabId)
  await chromeHost.focus(frame.activeTabId)
  broadcastFrames()
  scheduleSave()
  mainWindow?.webContents.send('vanta:need-layout')
}

async function closeWindow(id: string): Promise<void> {
  const frame = frames.get(id)
  if (!frame) return
  frames.delete(id)
  for (const tab of frame.tabs) {
    await chromeHost.closeBrowser(tab.id)
  }
  broadcastFrames()
  scheduleSave()
}

async function restoreWorkspace(): Promise<void> {
  const saved = await loadWorkspace(workspaceFile)
  if (!saved) return
  camera = saved.camera
  pages = saved.pages?.length ? saved.pages : [{ ...DEFAULT_PAGE }]
  activePageId = saved.activePageId || pages[0].id
  setDesign(saved.design || [])
  mainWindow?.webContents.send('vanta:workspace', saved)
  for (const browser of saved.browsers) {
    try {
      await createBrowser(browser)
    } catch (error) {
      console.error('[workspace] restore browser failed', error)
    }
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Vanta',
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: '#e8e8e8',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#e8e8e8',
      symbolColor: '#1a1a1a',
      height: 44
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('move', () => win.webContents.send('vanta:need-layout'))
  win.on('resize', () => win.webContents.send('vanta:need-layout'))
  win.on('minimize', () => {
    void chromeHost.hideAll()
  })
  win.on('restore', () => {
    win.webContents.send('vanta:need-layout')
  })
  win.on('show', () => win.webContents.send('vanta:need-layout'))
  win.on('hide', () => {
    void chromeHost.hideAll()
  })
  return win
}

function tabOf(id: string): { frame: BrowserFrame; tab: BrowserTab } | null {
  for (const frame of frames.values()) {
    const tab = frame.tabs.find((item) => item.id === id)
    if (tab) return { frame, tab }
  }
  return null
}

function registerIpc(): void {
  ipcMain.handle('vanta:getStatus', () => chromeHost.getStatus())
  ipcMain.handle('vanta:getWorkspace', () => workspaceSnapshot())
  ipcMain.handle('vanta:getBrowsers', () => mergeChromeState())
  ipcMain.handle('vanta:createBrowser', async (_event, input?: { url?: string; x?: number; y?: number; width?: number; height?: number }) => {
    return createBrowser(input)
  })
  ipcMain.handle('vanta:createTab', async (_event, windowId: string, url?: string) => createTab(windowId, url))
  ipcMain.handle('vanta:activateTab', async (_event, windowId: string, tabId: string) => activateTab(windowId, tabId))
  ipcMain.handle('vanta:closeTab', async (_event, windowId: string, tabId: string) => closeTab(windowId, tabId))
  ipcMain.handle('vanta:closeBrowser', async (_event, id: string) => closeWindow(id))
  ipcMain.handle('vanta:navigate', async (_event, id: string, url: string) => {
    const found = tabOf(id)
    if (found) {
      found.tab.url = url
      frames.set(found.frame.id, found.frame)
    }
    await chromeHost.navigate(id, url)
    scheduleSave()
  })
  ipcMain.handle('vanta:back', async (_event, id: string) => chromeHost.back(id))
  ipcMain.handle('vanta:forward', async (_event, id: string) => chromeHost.forward(id))
  ipcMain.handle('vanta:reload', async (_event, id: string) => chromeHost.reload(id))
  ipcMain.handle('vanta:focus', async (_event, id: string) => chromeHost.focus(id))
  ipcMain.handle('vanta:focusShell', () => {
    mainWindow?.webContents.focus()
  })
  ipcMain.handle('vanta:setCamera', (_event, next: Camera) => {
    camera = next
    scheduleSave()
  })
  ipcMain.handle('vanta:getDesign', () => getDesign())
  ipcMain.handle('vanta:setDesign', (_event, next: DesignNode[]) => {
    setDesign(Array.isArray(next) ? next : [])
    scheduleSave()
    return getDesign()
  })
  ipcMain.handle('vanta:addDesign', (_event, node: DesignNode) => {
    addDesign(node)
    scheduleSave()
    return getDesign()
  })
  ipcMain.handle('vanta:screenshotBrowser', async (_event, tabOrWindowId: string) => {
    const id = String(tabOrWindowId || '')
    const resolveTabId = (): string | null => {
      if (!id) return null
      if (chromeHost.list().some((page) => page.id === id)) return id
      const byWindow = frames.get(id)
      if (byWindow?.activeTabId) return byWindow.activeTabId
      for (const frame of frames.values()) {
        if (frame.tabs.some((tab) => tab.id === id)) return id
        if (frame.id === id && frame.activeTabId) return frame.activeTabId
      }
      return null
    }
    const tabId = resolveTabId()
    if (!tabId) throw new Error(`Browser tab not found: ${id || '(empty)'}`)
    return chromeHost.screenshot(tabId, { skipIdle: true })
  })
  ipcMain.handle('vanta:setPages', (_event, next: DesignPage[], nextActive: string) => {
    pages = Array.isArray(next) && next.length ? next : [{ ...DEFAULT_PAGE }]
    activePageId = pages.some((page) => page.id === nextActive) ? nextActive : pages[0].id
    scheduleSave()
  })
  ipcMain.handle('vanta:updateFrame', (_event, patch: Partial<BrowserFrame> & { id: string }) => {
    const current = frames.get(patch.id)
    if (!current) return
    frames.set(patch.id, { ...current, ...patch, tabs: patch.tabs || current.tabs })
    scheduleSave()
  })
  ipcMain.handle('vanta:setClickThrough', async (_event, enabled: boolean) => {
    await chromeHost.setClickThrough(enabled)
  })
  ipcMain.handle('vanta:setTheme', (_event, theme: 'light' | 'dark') => {
    const dark = theme === 'dark'
    nativeTheme.themeSource = dark ? 'dark' : 'light'
    chromeHost.setTheme(theme)
    if (!mainWindow) return
    try {
      mainWindow.setBackgroundColor(dark ? '#1a1a1a' : '#e8e8e8')
      mainWindow.setTitleBarOverlay({
        color: dark ? '#1a1a1a' : '#e8e8e8',
        symbolColor: dark ? '#f0f0f0' : '#1a1a1a',
        height: 44
      })
    } catch {
      /* unsupported */
    }
  })
  ipcMain.handle('vanta:openSidebarBrowser', async (_event, id: string, url: string) => {
    await chromeHost.openSidebarBrowser(id, url)
    mainWindow?.webContents.send('vanta:need-layout')
  })
  ipcMain.handle('vanta:syncLayout', async (_event, items: LayoutSyncItem[]) => {
    await chromeHost.syncLayout(
      items.map((item) => ({
        id: item.id,
        bounds: item.hole,
        clip: item.clip || item.hole,
        viewport: item.viewport,
        visible: item.visible,
        z: item.z
      }))
    )
  })
  ipcMain.handle('vanta:setInspect', (_event, id: string | null) => {
    chromeHost.setInspect(id)
  })
  ipcMain.handle(
    'vanta:setMesurer',
    (_event, id: string | null, mode: { inspect?: boolean; xray?: boolean } | null) => {
      chromeHost.setMesurer(id, mode)
    }
  )
  ipcMain.handle('vanta:runAgent', async (_event, messages: Array<{ role: 'user' | 'assistant'; text: string }>) => {
    if (agentRunning) throw new Error('Agent is already running')
    agentRunning = true
    const emit = (event: AgentEvent) => mainWindow?.webContents.send('vanta:agent', event)
    try {
      await runAgent(
        messages,
        emit,
        async (url) => {
          const frame = await createBrowser({ url })
          return frame.activeTabId
        },
        (browserId) => {
          for (const frame of frames.values()) {
            if (frame.id === browserId || frame.activeTabId === browserId || frame.tabs.some((tab) => tab.id === browserId)) {
              const tab =
                frame.tabs.find((item) => item.id === browserId) ||
                frame.tabs.find((item) => item.id === frame.activeTabId)
              return {
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: frame.height,
                title: tab?.title
              }
            }
          }
          return null
        }
      )
    } finally {
      agentRunning = false
    }
  })
  ipcMain.handle('vanta:getMcpStatus', (): McpStatus => ({
    running: isVantaMcpRunning(),
    url: VANTA_MCP_URL,
    port: VANTA_MCP_PORT
  }))
}

app.whenReady().then(async () => {
  if (!isPrimary) return
  loadEnv()
  workspaceFile = join(app.getPath('userData'), 'workspace.json')
  registerIpc()
  mainWindow = createWindow()
  chromeHost.attach(mainWindow)
  chromeHost.onChange(() => {
    broadcastFrames()
    scheduleSave()
  })
  chromeHost.onInspect((info: InspectInfo | null) => {
    mainWindow?.webContents.send('vanta:inspect', info)
  })
  onDesignChange((nodes) => {
    mainWindow?.webContents.send('vanta:design', nodes)
    scheduleSave()
  })
  onBuildEvent((event: BuildEvent) => {
    mainWindow?.webContents.send('vanta:build', event)
  })
  mainWindow.webContents.send('vanta:status', chromeHost.getStatus())
  await restoreWorkspace()
  try {
    await startVantaMcp({
      openBrowser: async (url) => {
        const frame = await createBrowser({ url })
        return frame.activeTabId
      },
      listBrowsers: () => mergeChromeState(),
      resolveBrowserGeometry: (browserId) => {
        for (const frame of frames.values()) {
          if (
            frame.id === browserId ||
            frame.activeTabId === browserId ||
            frame.tabs.some((tab) => tab.id === browserId)
          ) {
            const tab =
              frame.tabs.find((item) => item.id === browserId) ||
              frame.tabs.find((item) => item.id === frame.activeTabId)
            return {
              x: frame.x,
              y: frame.y,
              width: frame.width,
              height: frame.height,
              title: tab?.title
            }
          }
        }
        return null
      }
    })
  } catch (error) {
    console.error('[vanta-mcp] failed to start', error)
  }
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void (async () => {
    try {
      await stopVantaMcp()
    } catch {
      /* ignore */
    }
    try {
      await saveWorkspace(workspaceFile, workspaceSnapshot())
    } catch {
      /* ignore */
    }
    try {
      await chromeHost.shutdown()
    } catch {
      /* ignore */
    }
    app.exit(0)
  })()
})
