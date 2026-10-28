import { BrowserWindow, WebContentsView, nativeImage, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import { BROWSER_PARTITION, DEFAULT_URL, type ChromeStatus, type InspectInfo, type PageState } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import { MESURER_SCRIPT } from './mesurerScript'
import { SNAPSHOT_SCRIPT } from './snapshotScript'
import type { SnapshotEvent, SnapshotNode } from '../shared/snapshot'
import { buildCursorAgentsUrl } from './mcpInstallLinks'
import { getPublicMcpUrl } from './mcpTunnel'

function cursorVantaMcpBannerScript(): string {
  const publicUrl = getPublicMcpUrl() || ''
  const agentsUrl = buildCursorAgentsUrl()
  return `(function(){
  if (window.__vantaMcpBanner) return;
  var host = location.hostname || '';
  if (host.indexOf('cursor.com') === -1 && host.indexOf('cursor.so') === -1) return;
  window.__vantaMcpBanner = true;
  var bar = document.createElement('div');
  bar.setAttribute('data-vanta-mcp','1');
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483646;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:#111;color:#fff;font:12px/1.35 system-ui,Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.28)';
  var isInstall = /install-mcp/i.test(location.href);
  var label = document.createElement('strong');
  label.textContent = isInstall ? 'Install Scobe MCP' : 'Scobe MCP connected';
  label.style.flex = '0 0 auto';
  var hint = document.createElement('span');
  hint.style.opacity = '0.82';
  hint.style.flex = '1 1 160px';
  hint.textContent = isInstall
    ? 'Confirm install so “vanta” appears under Connectors / MCP, then open Agents.'
    : 'Open + → MCP Servers (or Connectors) and enable “vanta”. Do not use Cursor canvas tools.';
  bar.appendChild(label);
  bar.appendChild(hint);
  if (isInstall) {
    var go = document.createElement('button');
    go.textContent = 'Open Agents';
    go.style.cssText = 'height:28px;padding:0 12px;border:0;border-radius:8px;background:#0d99ff;color:#fff;font-weight:600;cursor:pointer';
    go.onclick = function(){ location.href = ${JSON.stringify(agentsUrl)}; };
    bar.appendChild(go);
  } else if (${JSON.stringify(publicUrl)}) {
    var copy = document.createElement('button');
    copy.textContent = 'Copy MCP URL';
    copy.style.cssText = 'height:28px;padding:0 12px;border:0;border-radius:8px;background:#333;color:#fff;cursor:pointer';
    copy.onclick = function(){
      navigator.clipboard.writeText(${JSON.stringify(publicUrl)}).then(function(){ copy.textContent = 'Copied'; }).catch(function(){});
    };
    bar.appendChild(copy);
  }
  document.documentElement.appendChild(bar);
  document.documentElement.style.scrollPaddingTop = '52px';
})();`
}

export type BrowserWheelEvent = {
  deltaX: number
  deltaY: number
  deltaMode: number
  clientX: number
  clientY: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

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
  /** Temporarily attached off-screen for an agent Snapshot; layout sync must leave it alone. */
  capturing?: boolean
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
        preload: input.kind === 'sidebar' ? undefined : join(__dirname, '../preload/browser.js'),
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
        if (!page.capturing) this.detach(page)
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
        const wasAttached = page.attached
        try {
          this.win.contentView.addChildView(page.view)
          page.attached = true
        } catch {
          page.attached = true
        }
        // Detach clears CDP color-scheme emulation — restore shell theme on reattach.
        if (!wasAttached) {
          try {
            page.view.setBackgroundColor(this.theme === 'dark' ? '#2c2c2cff' : '#ffffffff')
          } catch {
            /* ignore */
          }
          void this.applyColorScheme(page.view.webContents)
        }
      }
      this.attachedOrder = shown
    }

    // Detach any attached page that was omitted from this sync (e.g. closed side browsers).
    const keep = new Set(items.map((item) => item.id))
    for (const page of this.pages.values()) {
      if (keep.has(page.id)) continue
      if (page.attached) this.detach(page)
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

  /** Snapshot the whole page (not just one element). The result arrives through the normal Snapshot poll. */
  async snapshotPage(id: string): Promise<void> {
    const page = this.require(id)
    if (this.snapshotId !== id) this.setSnapshot(id)
    await page.view.webContents.executeJavaScript(
      `${SNAPSHOT_SCRIPT}; window.__vantaSnapshot && (window.__vantaSnapshot.enable(), window.__vantaSnapshot.capturePage());`,
      true
    )
  }

  /**
   * Run the real Snapshot pipeline (DOM → layered SnapshotNode tree) without the
   * interactive click UI. Used by MCP when agents ask to bring a page region into the canvas.
   */
  async captureSnapshot(
    id: string,
    opts?: { selector?: string | string[]; x?: number; y?: number }
  ): Promise<{ tree: SnapshotNode; cssWidth: number; cssHeight: number; selector?: string }> {
    const page = this.require(id)
    const release = await this.ensureRenderable(page)
    try {
      page.view.setVisible(true)
      await this.waitIdle(page)
      return await this.withDesktopViewport(page, () => this.runSnapshotCapture(page, opts))
    } finally {
      release()
    }
  }

  /**
   * A browser scrolled off the canvas is detached, so its page is `hidden` and runs no
   * animation frames — lazily drawn content (YouTube's icons) never appears. Attach it as
   * a 1×1 view for the capture; the emulated desktop viewport still drives layout.
   */
  private async ensureRenderable(page: Page): Promise<() => void> {
    if (page.attached || !this.win) return () => {}
    const win = this.win
    page.capturing = true
    try {
      win.contentView.addChildView(page.view, 0)
      page.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      page.view.setVisible(true)
    } catch {
      page.capturing = false
      return () => {}
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    return () => {
      page.capturing = false
      if (page.attached) return
      try {
        win.contentView.removeChildView(page.view)
      } catch {
        /* ignore */
      }
      page.lastBounds = null
    }
  }

  /**
   * Canvas browsers are sized to their on-screen clip, so a zoomed-out or partly
   * hidden frame lays out as a tiny mobile page. Emulate a desktop viewport for
   * the capture so sites render their full layout (e.g. YouTube's guide).
   */
  private async withDesktopViewport<T>(page: Page, run: () => Promise<T>): Promise<T> {
    const wc = page.view.webContents
    const width = Math.max(1366, Math.round(page.viewport.width || 0))
    const height = Math.max(900, Math.round(page.viewport.height || 0))
    const prevZoom = page.lastZoom
    let attachedHere = false
    let emulated = false
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
        attachedHere = true
      }
      wc.setZoomFactor(1)
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      })
      emulated = true
      await wc.executeJavaScript(
        `(function(){var e=document.documentElement;if(e)e.style.translate='';window.dispatchEvent(new Event('resize'));})()`,
        true
      )
      await new Promise((resolve) => setTimeout(resolve, 900))
    } catch {
      /* fall back to the live viewport */
    }
    try {
      return await run()
    } finally {
      if (emulated) {
        try {
          await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
        } catch {
          /* ignore */
        }
      }
      if (attachedHere) {
        try {
          wc.debugger.detach()
        } catch {
          /* ignore */
        }
      }
      try {
        if (prevZoom != null) wc.setZoomFactor(prevZoom)
      } catch {
        /* ignore */
      }
      const clipX = page.lastClipX
      const clipY = page.lastClipY
      page.lastClipX = Number.NaN
      page.lastClipY = Number.NaN
      this.applyClipOffset(page, clipX, clipY)
    }
  }

  private async runSnapshotCapture(
    page: Page,
    opts?: { selector?: string | string[]; x?: number; y?: number }
  ): Promise<{ tree: SnapshotNode; cssWidth: number; cssHeight: number; selector?: string }> {
    const wc = page.view.webContents
    await wc.executeJavaScript(`${SNAPSHOT_SCRIPT}`, true)

    const selectors = Array.isArray(opts?.selector)
      ? opts!.selector
      : opts?.selector
        ? [opts.selector]
        : null

    type CaptureResult = {
      status?: string
      tree?: SnapshotNode
      cssWidth?: number
      cssHeight?: number
      message?: string
      selector?: string
    }

    let result: CaptureResult | null = null
    if (selectors?.length) {
      result = (await wc.executeJavaScript(
        `window.__vantaSnapshot.captureSelector(${JSON.stringify(selectors)})`,
        true
      )) as CaptureResult
    } else if (opts?.x != null && opts?.y != null) {
      result = (await wc.executeJavaScript(
        `window.__vantaSnapshot.capturePoint(${Number(opts.x)}, ${Number(opts.y)})`,
        true
      )) as CaptureResult
    } else {
      // Prefer common side-nav landmarks, then body.
      const defaults = [
        'ytd-guide-renderer',
        '#guide-content',
        'tp-yt-app-drawer#guide',
        'ytd-mini-guide-renderer',
        'ytd-app',
        '#content',
        '[role="navigation"]',
        'nav',
        'aside',
        'body'
      ]
      result = (await wc.executeJavaScript(
        `window.__vantaSnapshot.captureSelector(${JSON.stringify(defaults)}, true)`,
        true
      )) as CaptureResult
    }

    if (!result || result.status !== 'ready' || !result.tree) {
      throw new Error(result?.message || 'Snapshot capture failed')
    }

    const tree = await this.resolveSnapshotAssets(
      page,
      result.tree,
      result.cssWidth || 0,
      result.cssHeight || 0
    )
    return {
      tree,
      cssWidth: result.cssWidth || 0,
      cssHeight: result.cssHeight || 0,
      selector: result.selector
    }
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
    try {
      wc.setVisualZoomLevelLimits(1, 1)
    } catch {
      /* ignore */
    }
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
      if (page.kind === 'sidebar') {
        void wc.executeJavaScript(cursorVantaMcpBannerScript(), true).catch(() => undefined)
      }
    })
    if (page.kind === 'canvas') {
      wc.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        if (!(input.control || input.meta)) return
        const key = input.key
        if (key !== '-' && key !== '=' && key !== '+' && key !== '0' && key !== '_') return
        event.preventDefault()
        this.win?.webContents.send('vanta:canvas-zoom-key', {
          key,
          shiftKey: Boolean(input.shift)
        })
      })
      // Keep layout zoom if the page still tries to pinch-zoom.
      wc.on('zoom-changed', () => {
        if (page.lastZoom != null) {
          try {
            wc.setZoomFactor(page.lastZoom)
          } catch {
            /* ignore */
          }
        }
      })
    }
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

  pageForContents(wc: WebContents): Page | null {
    for (const page of this.pages.values()) {
      if (page.view.webContents === wc) return page
    }
    return null
  }

  forwardBrowserWheel(wc: WebContents, data: Omit<BrowserWheelEvent, 'clientX' | 'clientY'> & { clientX: number; clientY: number }): void {
    const page = this.pageForContents(wc)
    if (!page || page.kind !== 'canvas' || !this.win) return
    const bounds = page.view.getBounds()
    const event: BrowserWheelEvent = {
      ...data,
      clientX: bounds.x + data.clientX,
      clientY: bounds.y + data.clientY
    }
    this.win.webContents.send('vanta:canvas-wheel', event)
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

  /**
   * Finish a captured tree: fetch cross-origin images through the browser session
   * (no CORS), then crop anything still unreadable (icons, tainted canvases) out of
   * page screenshots — scrolling so below-the-fold crops aren't blank.
   */
  private async resolveSnapshotAssets(
    page: Page,
    tree: SnapshotNode,
    cssWidth: number,
    cssHeight: number
  ): Promise<SnapshotNode> {
    const all: SnapAsset[] = []
    const visit = (node: SnapAsset) => {
      all.push(node)
      for (const child of node.children || []) visit(child as SnapAsset)
    }
    visit(tree as SnapAsset)
    await Promise.all([
      this.fetchSnapshotImages(page, all.filter((node) => node.fetchSrc)),
      this.resolveMaskIcons(page, all.filter((node) => node.maskSrc && node.maskColor))
    ])
    const shots = all.filter(
      (node) => node.shot && node.kind === 'image' && !(node.fill?.type === 'image' && node.fill.dataUrl)
    )
    if (shots.length && cssWidth >= 1 && cssHeight >= 1) {
      try {
        await this.cropSnapshotShots(page, shots)
      } catch {
        /* screenshot unavailable; layers still paste */
      }
    }
    for (const node of all) {
      delete node.shot
      delete node.fetchSrc
      delete node.fetchBg
      delete node.maskSrc
      delete node.maskColor
      delete node.maskFit
    }
    return tree
  }

  /** CSS-mask icons (an SVG shape painted with background-color) become colored vectors. */
  private async resolveMaskIcons(page: Page, nodes: SnapAsset[]): Promise<void> {
    if (!nodes.length) return
    const ses = page.view.webContents.session
    const cache = new Map<string, Promise<string | null>>()
    let cursor = 0
    const worker = async () => {
      while (cursor < nodes.length) {
        const node = nodes[cursor++]
        const url = node.maskSrc!
        let pending = cache.get(url)
        if (!pending) {
          pending = fetchSvgText(ses, url)
          cache.set(url, pending)
        }
        const source = await pending
        if (!source || !node.maskColor) continue
        const markup = maskedSvgMarkup(source, node, node.maskColor, node.maskFit === 'meet')
        node.svg = markup
        node.kind = 'image'
        node.fill = { type: 'image', dataUrl: `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}` }
        delete node.shot
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, nodes.length) }, () => worker()))
  }

  private async fetchSnapshotImages(page: Page, nodes: SnapAsset[]): Promise<void> {
    if (!nodes.length) return
    const ses = page.view.webContents.session
    const cache = new Map<string, Promise<string | null>>()
    const load = (url: string, edge: number) => {
      let pending = cache.get(url)
      if (!pending) {
        pending = fetchImageDataUrl(ses, url, edge)
        cache.set(url, pending)
      }
      return pending
    }
    let cursor = 0
    const worker = async () => {
      while (cursor < nodes.length) {
        const node = nodes[cursor++]
        const url = node.fetchSrc
        if (!url) continue
        const edge = Math.max(node.width || 0, node.height || 0)
        const data = await load(url, edge)
        if (!data) continue
        if (!node.fetchBg) node.kind = 'image'
        node.fill = { type: 'image', dataUrl: data }
        delete node.shot
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, nodes.length) }, () => worker()))
  }

  private async cropSnapshotShots(page: Page, shots: SnapAsset[]): Promise<void> {
    const wc = page.view.webContents
    type View = { x: number; y: number; w: number; h: number }
    const readView = async (): Promise<View> =>
      (await wc.executeJavaScript(
        '({ x: window.scrollX, y: window.scrollY, w: window.innerWidth, h: window.innerHeight })',
        true
      )) as View
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const docY = (node: SnapAsset) => (node.shot!.y || 0) + (node.shot!.sy || 0)
    const placeIn = (node: SnapAsset, view: View) => {
      const shot = node.shot!
      if (shot.fixed) return { x: shot.x, y: shot.y }
      return {
        x: shot.x + (shot.sx || 0) - view.x,
        y: shot.y + (shot.sy || 0) - view.y
      }
    }
    const fits = (node: SnapAsset, view: View) => {
      const at = placeIn(node, view)
      const shot = node.shot!
      return at.x >= -1 && at.y >= -1 && at.x + shot.width <= view.w + 1 && at.y + shot.height <= view.h + 1
    }
    const crop = (image: Electron.NativeImage, node: SnapAsset, view: View): boolean => {
      const size = image.getSize()
      if (view.w < 1 || view.h < 1) return false
      const scaleX = size.width / view.w
      const scaleY = size.height / view.h
      const at = placeIn(node, view)
      const shot = node.shot!
      let x = Math.round(at.x * scaleX)
      let y = Math.round(at.y * scaleY)
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
      if (width < 1 || height < 1) return false
      node.kind = 'image'
      node.fill = { type: 'image', dataUrl: image.crop({ x, y, width, height }).toDataURL() }
      return true
    }

    // Let the page repaint without the snapshot highlight before cropping from it.
    await sleep(60)
    const start = await readView()
    const first = await wc.capturePage()
    let pending = shots.filter((node) => !(fits(node, start) && crop(first, node, start)))
    if (!pending.length) return

    const scrolling = pending.filter((node) => !node.shot!.fixed).sort((a, b) => docY(a) - docY(b))
    let moved = false
    try {
      for (let tile = 0; scrolling.length && tile < 24; tile++) {
        const lead = scrolling[0]
        const target = Math.max(0, Math.round(docY(lead) - 24))
        await wc.executeJavaScript(`window.scrollTo(${Math.round(start.x)}, ${target})`, true)
        moved = true
        await sleep(140)
        const view = await readView()
        const image = await wc.capturePage()
        for (let i = scrolling.length - 1; i >= 0; i--) {
          if (fits(scrolling[i], view) && crop(image, scrolling[i], view)) scrolling.splice(i, 1)
        }
        // Taller than the viewport or past the scroll range: take what's visible and move on.
        if (scrolling[0] === lead) {
          crop(image, lead, view)
          scrolling.shift()
        }
      }
    } finally {
      if (moved) {
        await wc
          .executeJavaScript(`window.scrollTo(${Math.round(start.x)}, ${Math.round(start.y)})`, true)
          .catch(() => undefined)
      }
    }
    pending = pending.filter((node) => !(node.fill?.type === 'image' && node.fill.dataUrl))
    for (const node of pending) crop(first, node, start)
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
        const tree = await this.resolveSnapshotAssets(page, result.tree, result.cssWidth || 0, result.cssHeight || 0)
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

type SnapAsset = SnapshotNode & {
  shot?: { x: number; y: number; width: number; height: number; sx?: number; sy?: number; fixed?: boolean }
  fetchSrc?: string
  fetchBg?: boolean
  maskSrc?: string
  maskColor?: { hex: string; opacity: number }
  maskFit?: 'meet' | 'none'
}

let maskSeq = 0

async function fetchSvgText(ses: Session, url: string): Promise<string | null> {
  try {
    let text = ''
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',')
      if (comma < 0 || !/^data:image\/svg\+xml/i.test(url)) return null
      const meta = url.slice(0, comma)
      const body = url.slice(comma + 1)
      text = /;base64/i.test(meta) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body)
    } else if (/^https?:/i.test(url)) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      try {
        const res = await ses.fetch(url, { signal: ctrl.signal })
        if (!res.ok) return null
        text = await res.text()
      } finally {
        clearTimeout(timer)
      }
    } else {
      return null
    }
    return /<svg[\s>]/i.test(text) && text.length < 400_000 ? text : null
  } catch {
    return null
  }
}

/** The mask's shape filled with the element's color — the same thing CSS `mask-image` paints. */
function maskedSvgMarkup(
  source: string,
  node: SnapshotNode,
  color: { hex: string; opacity: number },
  meet: boolean
): string {
  const w = Math.max(1, Math.round(node.width || 1))
  const h = Math.max(1, Math.round(node.height || 1))
  const id = `vmask${(maskSeq++).toString(36)}${Date.now().toString(36)}`
  const href = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`
  const fit = meet ? 'xMidYMid meet' : 'none'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" style="display:block">` +
    `<defs><mask id="${id}" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
    `<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${fit}"/></mask></defs>` +
    `<rect width="${w}" height="${h}" fill="${color.hex}" fill-opacity="${color.opacity}" mask="url(#${id})"/></svg>`
  )
}

const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon'
}

/** Fetch with the tab's cookies; large JPEG/PNG are downscaled to ~2× their on-page size. */
async function fetchImageDataUrl(ses: Session, url: string, edge: number): Promise<string | null> {
  if (!/^https?:/i.test(url)) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await ses.fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    let mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!mime.startsWith('image/')) {
      const ext = (url.split(/[?#]/)[0].split('.').pop() || '').toLowerCase()
      mime = IMAGE_EXT_MIME[ext] || ''
    }
    if (!mime) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > 12 * 1024 * 1024) return null
    const maxEdge = Math.min(1600, Math.max(96, Math.round(edge * 2)))
    if ((mime === 'image/jpeg' || mime === 'image/png') && buf.length > 160 * 1024) {
      const image = nativeImage.createFromBuffer(buf)
      const size = image.getSize()
      const side = Math.max(size.width, size.height)
      if (!image.isEmpty() && side > maxEdge) {
        const scale = maxEdge / side
        const resized = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        })
        return mime === 'image/png'
          ? resized.toDataURL()
          : `data:image/jpeg;base64,${resized.toJPEG(86).toString('base64')}`
      }
    }
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
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
