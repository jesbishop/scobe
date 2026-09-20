import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import { BROWSER_PARTITION, DEFAULT_URL, type ChromeStatus, type InspectInfo, type PageState } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import { MESURER_SCRIPT } from './mesurerScript'
import { SNAPSHOT_SCRIPT } from './snapshotScript'
import type { SnapshotEvent, SnapshotNode } from '../shared/snapshot'

type MouseInput = {
  type: 'mouseMove' | 'mouseDown' | 'mouseUp'
  x: number
  y: number
  button?: 'left'
  clickCount?: number
}

type Rect = { x: number; y: number; width: number; height: number }

type Page = {
  id: string
  windowId: string
  view: WebContentsView
  url: string
  title: string
  favicon: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  viewport: { width: number; height: number }
  lastShot: { width: number; height: number } | null
  attached: boolean
  lastBounds: Rect | null
  lastZoom: number | null
  lastClipX: number
  lastClipY: number
  kind: 'canvas' | 'sidebar'
}

function navFlags(wc: WebContents): { canGoBack: boolean; canGoForward: boolean } {
  try {
    const history = wc.navigationHistory
    if (history) {
      return {
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward()
      }
    }
  } catch {
    /* older electron */
  }
  return {
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward()
  }
}

export class BrowserHost {
  private win: BrowserWindow | null = null
  private pages = new Map<string, Page>()
  private inspectId: string | null = null
  private inspectTimer: NodeJS.Timeout | null = null
  private snapshotId: string | null = null
  private snapshotTimer: NodeJS.Timeout | null = null
  private mesurerMode: { inspect: boolean; xray: boolean } = { inspect: true, xray: false }
  private ignoreMouse = false
  private attachedOrder: string[] = []
  private theme: 'light' | 'dark' = 'light'
  private listeners = new Set<() => void>()
  private inspectListeners = new Set<(info: InspectInfo | null) => void>()
  private snapshotListeners = new Set<(event: SnapshotEvent) => void>()
  private status: ChromeStatus = { state: 'starting' }

  attach(win: BrowserWindow): void {
    this.win = win
    this.status = { state: 'ready' }
    win.on('closed', () => {
      this.win = null
      this.pages.clear()
    })
  }

  getStatus(): ChromeStatus {
    return this.status
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onInspect(listener: (info: InspectInfo | null) => void): () => void {
    this.inspectListeners.add(listener)
    return () => this.inspectListeners.delete(listener)
  }

  onSnapshot(listener: (event: SnapshotEvent) => void): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  list(): PageState[] {
    return [...this.pages.values()]
      .filter((page) => page.kind !== 'sidebar')
      .map((page) => ({
        id: page.id,
        windowId: page.windowId,
        url: page.url,
        title: page.title,
        favicon: page.favicon,
        width: page.viewport.width,
        height: page.viewport.height,
        canGoBack: page.canGoBack,
        canGoForward: page.canGoForward,
        loading: page.loading
      }))
  }

  async createCanvasBrowser(input: {
    id: string
    windowId: string
    url?: string
    bounds: { x: number; y: number; width: number; height: number }
    viewport: { width: number; height: number }
    kind?: 'canvas' | 'sidebar'
  }): Promise<void> {
    if (!this.win) throw new Error('Window is not ready')
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    view.setBackgroundColor(this.theme === 'dark' ? '#2c2c2cff' : '#ffffffff')
    const wc = view.webContents
    const page: Page = {
      id: input.id,
      windowId: input.windowId,
      view,
      url: normalizeUrl(input.url || DEFAULT_URL),
      title: '',
      favicon: '',
      canGoBack: false,
      canGoForward: false,
      loading: true,
      viewport: { ...input.viewport },
      lastShot: null,
      attached: false,
      lastBounds: null,
      lastZoom: null,
      lastClipX: 0,
      lastClipY: 0,
      kind: input.kind || 'canvas'
    }
    this.pages.set(input.id, page)
    this.bind(page)
    wc.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
          partition: BROWSER_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      }
    }))
    await wc.loadURL(page.url)
    if (page.kind !== 'sidebar') this.emit()
  }

  async openSidebarBrowser(id: string, url: string): Promise<void> {
    const existing = this.pages.get(id)
    const next = normalizeUrl(url)
    if (existing) {
      if (existing.url !== next) await this.navigate(id, next)
      return
    }
    await this.createCanvasBrowser({
      id,
      windowId: id,
      url: next,
      bounds: { x: 0, y: 0, width: 400, height: 720 },
      viewport: { width: 400, height: 720 },
      kind: 'sidebar'
    })
  }

  async closeBrowser(id: string): Promise<void> {
    const page = this.pages.get(id)
    if (!page || !this.win) return
    if (this.inspectId === id) this.setInspect(null)
    if (this.snapshotId === id) this.setSnapshot(null)
    this.detach(page)
    try {
      page.view.webContents.close()
    } catch {
      /* ignore */
    }
    this.pages.delete(id)
    this.emit()
  }

  async navigate(id: string, url: string): Promise<void> {
    const page = this.require(id)
    await page.view.webContents.loadURL(normalizeUrl(url))
  }

  async back(id: string): Promise<void> {
    const page = this.require(id)
    if (page.canGoBack) page.view.webContents.goBack()
  }

  async forward(id: string): Promise<void> {
    const page = this.require(id)
    if (page.canGoForward) page.view.webContents.goForward()
  }

  async reload(id: string): Promise<void> {
    this.require(id).view.webContents.reload()
  }

  async focus(id: string): Promise<void> {
    const page = this.pages.get(id)
    if (!page || !this.win || !page.attached) return
    this.win.contentView.addChildView(page.view)
    this.attachedOrder = this.attachedOrder.filter((item) => item !== page.id)
    this.attachedOrder.push(page.id)
    page.view.webContents.focus()
  }

  async setClickThrough(enabled: boolean): Promise<void> {
    this.ignoreMouse = enabled
    for (const page of this.pages.values()) {
      if (page.kind === 'sidebar') continue
      try {
        page.view.setVisible(!enabled && page.attached)
      } catch {
        /* ignore */
      }
    }
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme
    const color = theme === 'dark' ? '#2c2c2cff' : '#ffffffff'
    for (const page of this.pages.values()) {
      try {
        page.view.setBackgroundColor(color)
      } catch {
        /* ignore */
      }
      void this.applyColorScheme(page.view.webContents)
    }
  }

  async syncLayout(
    items: Array<{
      id: string
      bounds: Rect
      clip: Rect
      viewport: { width: number; height: number }
      visible: boolean
      z: number
    }>
  ): Promise<void> {
    if (!this.win) return
    const ordered = [...items].sort((a, b) => a.z - b.z)
    const shown: string[] = []
    for (const item of ordered) {
      const page = this.pages.get(item.id)
      if (!page) continue
      const hole = item.bounds
      const clip = item.clip
      const ignore = this.ignoreMouse && page.kind !== 'sidebar'
      const show =
        item.visible &&
        clip.width > 2 &&
        clip.height > 2 &&
        hole.width > 2 &&
        hole.height > 2 &&
        !ignore
      if (!show) {
        this.detach(page)
        continue
      }
      shown.push(page.id)
      const bounds = {
        x: Math.round(clip.x),
        y: Math.round(clip.y),
        width: Math.max(1, Math.round(clip.width)),
        height: Math.max(1, Math.round(clip.height))
      }
      const zoom = Math.min(5, Math.max(0.25, hole.width / Math.max(1, item.viewport.width)))
      const clipX = Math.round((clip.x - hole.x) / zoom)
      const clipY = Math.round((clip.y - hole.y) / zoom)
      page.viewport = { ...item.viewport }
      const moved =
        !page.lastBounds ||
        page.lastBounds.x !== bounds.x ||
        page.lastBounds.y !== bounds.y ||
        page.lastBounds.width !== bounds.width ||
        page.lastBounds.height !== bounds.height
      if (moved) {
        page.view.setBounds(bounds)
        page.lastBounds = bounds
      }
      if (page.lastZoom === null || Math.abs(page.lastZoom - zoom) >= 0.002) {
        try {
          page.view.webContents.setZoomFactor(zoom)
          page.lastZoom = zoom
        } catch {
          /* loading */
        }
      }
      if (page.kind !== 'sidebar') this.applyClipOffset(page, clipX, clipY)
      try {
        page.view.setVisible(true)
      } catch {
        /* ignore */
      }
    }
    const orderChanged =
      shown.length !== this.attachedOrder.length ||
      shown.some((id, index) => this.attachedOrder[index] !== id) ||
      shown.some((id) => !this.pages.get(id)?.attached)
    if (orderChanged) {
      for (const id of shown) {
        const page = this.pages.get(id)
        if (!page || !this.win) continue
        try {
          this.win.contentView.addChildView(page.view)
          page.attached = true
        } catch {
          page.attached = true
        }
      }
      this.attachedOrder = shown
    }
  }

  setInspect(id: string | null): void {
    this.setMesurer(id, id ? { inspect: true, xray: false } : null)
  }

  setMesurer(id: string | null, mode: { inspect?: boolean; xray?: boolean } | null): void {
    if (this.inspectTimer) {
      clearInterval(this.inspectTimer)
      this.inspectTimer = null
    }
    if (this.inspectId && this.inspectId !== id) {
      const previous = this.pages.get(this.inspectId)
      void previous?.view.webContents
        .executeJavaScript(
          'window.__vantaMesurer && window.__vantaMesurer.disable(); window.__vantaInspect && window.__vantaInspect.disable()',
          true
        )
        .catch(() => undefined)
    }
    this.inspectId = id
    if (!id || !mode) {
      this.emitInspect(null)
      return
    }
    this.mesurerMode = { inspect: Boolean(mode.inspect), xray: Boolean(mode.xray) }
    const page = this.pages.get(id)
    if (!page) return
    const payload = JSON.stringify(this.mesurerMode)
    void page.view.webContents
      .executeJavaScript(`${MESURER_SCRIPT}; window.__vantaMesurer && window.__vantaMesurer.enable(${payload});`, true)
      .catch(() => undefined)
    this.inspectTimer = setInterval(() => {
      void this.pollInspect()
    }, 120)
  }

  setSnapshot(id: string | null): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer)
      this.snapshotTimer = null
    }
    const previous = this.snapshotId
    if (previous && previous !== id) {
      const page = this.pages.get(previous)
      void page?.view.webContents
        .executeJavaScript('window.__vantaSnapshot && window.__vantaSnapshot.disable()', true)
        .catch(() => undefined)
    }
    this.snapshotId = id
    if (!id) return
    const page = this.pages.get(id)
    if (!page) return
    void page.view.webContents
      .executeJavaScript(`${SNAPSHOT_SCRIPT}; window.__vantaSnapshot && window.__vantaSnapshot.enable();`, true)
      .catch(() => undefined)
    this.snapshotTimer = setInterval(() => {
      void this.pollSnapshot()
    }, 140)
  }

  async screenshot(id: string, opts?: { skipIdle?: boolean }): Promise<{ width: number; height: number; dataUrl: string }> {
    const page = this.require(id)
    if (!opts?.skipIdle) await this.waitIdle(page)
    try {
      page.view.setVisible(true)
    } catch {
      /* ignore */
    }
    const image = await page.view.webContents.capturePage()
    const size = image.getSize()
    if (size.width < 1 || size.height < 1) throw new Error('Screenshot was empty')
    page.lastShot = { width: size.width, height: size.height }
    return { width: size.width, height: size.height, dataUrl: image.toDataURL() }
  }

  async click(id: string, x: number, y: number): Promise<void> {
    const page = this.require(id)
    const wc = page.view.webContents
    const { x: px, y: py } = this.toViewPoint(page, x, y)
    wc.focus()
    this.mouse(wc, { type: 'mouseMove', x: px, y: py })
    this.mouse(wc, { type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 })
    this.mouse(wc, { type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 })
  }

  async typeText(id: string, text: string): Promise<void> {
    const wc = this.require(id).view.webContents
    wc.focus()
    wc.insertText(text)
  }

  async pressKey(id: string, key: string): Promise<void> {
    const wc = this.require(id).view.webContents
    wc.focus()
    const keyCode = keyCodeFor(key)
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'char', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
  }

  async scroll(id: string, deltaY: number): Promise<void> {
    const wc = this.require(id).view.webContents
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: 40,
      y: 40,
      deltaX: 0,
      deltaY: Math.round(deltaY),
      canScroll: true
    })
  }

  async hideAll(): Promise<void> {
    for (const page of this.pages.values()) this.detach(page)
  }

  async showCanvas(): Promise<void> {
    /* layout sync restores bounds */
  }

  async shutdown(): Promise<void> {
    this.setInspect(null)
    this.setSnapshot(null)
    for (const id of [...this.pages.keys()]) await this.closeBrowser(id)
  }

  contentsOf(id: string): WebContents {
    return this.require(id).view.webContents
  }

  private require(id: string): Page {
    const page = this.pages.get(id)
    if (!page) throw new Error('Browser is not available')
    return page
  }

  private bind(page: Page): void {
    const wc = page.view.webContents
    const refresh = () => {
      const flags = navFlags(wc)
      page.url = wc.getURL() || page.url
      page.title = wc.getTitle() || page.title
      page.canGoBack = flags.canGoBack
      page.canGoForward = flags.canGoForward
      page.loading = wc.isLoading()
      this.emit()
    }
    wc.on('did-start-loading', refresh)
    wc.on('did-stop-loading', refresh)
    wc.on('did-navigate', refresh)
    wc.on('did-navigate-in-page', refresh)
    wc.on('page-title-updated', refresh)
    wc.on('page-favicon-updated', (_event, favicons) => {
      page.favicon = favicons.find(Boolean) || ''
      refresh()
    })
    wc.on('did-finish-load', () => {
      refresh()
      void this.applyColorScheme(wc)
    })
    wc.on('dom-ready', () => {
      void this.applyColorScheme(wc)
      const x = Number.isFinite(page.lastClipX) ? page.lastClipX : 0
      const y = Number.isFinite(page.lastClipY) ? page.lastClipY : 0
      page.lastClipX = Number.NaN
      this.applyClipOffset(page, x, y)
      if (this.snapshotId === page.id) {
        void wc
          .executeJavaScript(`${SNAPSHOT_SCRIPT}; window.__vantaSnapshot && window.__vantaSnapshot.enable();`, true)
          .catch(() => undefined)
      } else if (this.inspectId === page.id) {
        const payload = JSON.stringify(this.mesurerMode)
        void wc
          .executeJavaScript(`${MESURER_SCRIPT}; window.__vantaMesurer && window.__vantaMesurer.enable(${payload});`, true)
          .catch(() => undefined)
      }
    })
  }

  private async applyColorScheme(wc: WebContents): Promise<void> {
    if (wc.isDestroyed()) return
    const scheme = this.theme === 'dark' ? 'dark' : 'light'
    const withScheme = wc as WebContents & {
      setColorScheme?: (value: 'system' | 'light' | 'dark') => void
    }
    if (typeof withScheme.setColorScheme === 'function') {
      try {
        withScheme.setColorScheme(scheme)
        return
      } catch {
        /* fall through to CDP */
      }
    }

    const owned = (wc as WebContents & { __vantaThemeDebugger?: boolean }).__vantaThemeDebugger
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
        ;(wc as WebContents & { __vantaThemeDebugger?: boolean }).__vantaThemeDebugger = true
      }
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }]
      })
      await wc.debugger.sendCommand('Emulation.setAutoDarkModeOverride', {
        enabled: this.theme === 'dark'
      })
      // Emulation clears on detach, so stay attached in dark mode only.
      if (this.theme === 'light' && ((wc as WebContents & { __vantaThemeDebugger?: boolean }).__vantaThemeDebugger || owned)) {
        wc.debugger.detach()
        ;(wc as WebContents & { __vantaThemeDebugger?: boolean }).__vantaThemeDebugger = false
      }
    } catch {
      /* page closed or CDP unavailable */
    }
  }

  private detach(page: Page): void {
    if (!this.win) return
    try {
      this.win.contentView.removeChildView(page.view)
    } catch {
      /* ignore */
    }
    page.attached = false
    page.lastBounds = null
    this.attachedOrder = this.attachedOrder.filter((id) => id !== page.id)
    try {
      page.view.setVisible(false)
    } catch {
      /* ignore */
    }
  }

  private applyClipOffset(page: Page, x: number, y: number): void {
    const nextX = Number.isFinite(x) ? x : 0
    const nextY = Number.isFinite(y) ? y : 0
    if (page.lastClipX === nextX && page.lastClipY === nextY) return
    page.lastClipX = nextX
    page.lastClipY = nextY
    const value = nextX || nextY ? `'${-nextX}px ${-nextY}px'` : "''"
    void page.view.webContents
      .executeJavaScript(
        `(function(){var e=document.documentElement;if(e)e.style.translate=${value};})()`,
        true
      )
      .catch(() => undefined)
  }

  private async pollInspect(): Promise<void> {
    if (!this.inspectId) return
    const page = this.pages.get(this.inspectId)
    if (!page) return
    try {
      const result = (await page.view.webContents.executeJavaScript(
        'window.__vantaMesurer ? window.__vantaMesurer.consume() : (window.__vantaInspect ? window.__vantaInspect.consume() : null)',
        true
      )) as { clicked?: boolean; pinned?: boolean; info?: Omit<InspectInfo, 'browserId' | 'pinned'> } | null
      if (result?.info) {
        this.emitInspect({
          ...result.info,
          browserId: page.id,
          pinned: Boolean(result.pinned || result.clicked)
        })
      }
    } catch {
      /* page navigating */
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private emitInspect(info: InspectInfo | null): void {
    for (const listener of this.inspectListeners) listener(info)
  }

  private emitSnapshot(event: SnapshotEvent): void {
    for (const listener of this.snapshotListeners) listener(event)
  }

  /** When an <img>/svg can't be read (CORS), crop it out of a page screenshot. */
  private async backfillSnapshotImages(
    page: Page,
    tree: SnapshotNode,
    cssWidth: number,
    cssHeight: number
  ): Promise<SnapshotNode> {
    const shots: Array<SnapshotNode & { shot?: { x: number; y: number; width: number; height: number } }> = []
    const visit = (node: SnapshotNode & { shot?: { x: number; y: number; width: number; height: number } }) => {
      if (node.shot && node.kind === 'image' && !(node.fill?.type === 'image' && node.fill.dataUrl)) shots.push(node)
      for (const child of node.children || []) visit(child)
    }
    visit(tree)
    if (!shots.length || cssWidth < 1 || cssHeight < 1) {
      stripShots(tree)
      return tree
    }
    try {
      const image = await page.view.webContents.capturePage()
      const size = image.getSize()
      const scaleX = size.width / cssWidth
      const scaleY = size.height / cssHeight
      for (const node of shots) {
        const shot = node.shot
        if (!shot) continue
        let x = Math.round(shot.x * scaleX)
        let y = Math.round(shot.y * scaleY)
        let width = Math.round(shot.width * scaleX)
        let height = Math.round(shot.height * scaleY)
        if (x < 0) {
          width += x
          x = 0
        }
        if (y < 0) {
          height += y
          y = 0
        }
        if (x + width > size.width) width = size.width - x
        if (y + height > size.height) height = size.height - y
        if (width < 1 || height < 1) continue
        const cropped = image.crop({ x, y, width, height })
        node.kind = 'image'
        node.fill = { type: 'image', dataUrl: cropped.toDataURL() }
      }
    } catch {
      /* screenshot unavailable; layers still paste */
    }
    stripShots(tree)
    return tree
  }

  private async pollSnapshot(): Promise<void> {
    const id = this.snapshotId
    if (!id) return
    const page = this.pages.get(id)
    if (!page) return
    try {
      const result = (await page.view.webContents.executeJavaScript(
        'window.__vantaSnapshot ? window.__vantaSnapshot.consume() : null',
        true
      )) as {
        status?: string
        tree?: SnapshotNode
        cssWidth?: number
        cssHeight?: number
        message?: string
      } | null
      if (!result?.status || result.status === 'pending') return
      if (result.status === 'ready' && result.tree) {
        const tree = await this.backfillSnapshotImages(page, result.tree, result.cssWidth || 0, result.cssHeight || 0)
        this.emitSnapshot({ tabId: id, tree })
        this.setSnapshot(null)
        return
      }
      if (result.status === 'cancel') {
        this.emitSnapshot({ tabId: id, cancelled: true })
        this.setSnapshot(null)
        return
      }
      if (result.status === 'error') {
        this.emitSnapshot({ tabId: id, error: result.message || 'Snapshot failed' })
        this.setSnapshot(null)
      }
    } catch {
      /* page navigating */
    }
  }

  private toViewPoint(page: Page, x: number, y: number): { x: number; y: number } {
    const bounds = page.view.getBounds()
    const shot = page.lastShot
    if (!shot || shot.width < 1 || shot.height < 1) {
      return { x: Math.round(x), y: Math.round(y) }
    }
    return {
      x: Math.round(x * (bounds.width / shot.width)),
      y: Math.round(y * (bounds.height / shot.height))
    }
  }

  private mouse(wc: WebContents, event: MouseInput): void {
    wc.sendInputEvent(event)
  }

  private async waitIdle(page: Page, timeoutMs = 8000): Promise<void> {
    const started = Date.now()
    while (page.loading && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    await new Promise((resolve) => setTimeout(resolve, 160))
  }
}

function stripShots(node: SnapshotNode & { shot?: unknown }): void {
  delete (node as { shot?: unknown }).shot
  for (const child of node.children || []) stripShots(child)
}

function keyCodeFor(key: string): string {
  const value = key.trim().toLowerCase()
  if (value === 'enter' || value === 'return') return 'Return'
  if (value === 'tab') return 'Tab'
  if (value === 'escape' || value === 'esc') return 'Escape'
  if (value === 'backspace') return 'Backspace'
  if (value === 'delete') return 'Delete'
  if (value === 'space') return 'Space'
  if (value === 'arrowup') return 'Up'
  if (value === 'arrowdown') return 'Down'
  if (value === 'arrowleft') return 'Left'
  if (value === 'arrowright') return 'Right'
  if (value.length === 1) return value.toUpperCase()
  return key
}

export const chromeHost = new BrowserHost()
