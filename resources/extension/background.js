/* global VANTA */
importScripts('config.js')

const createdWindows = new Set()
const historyByTab = new Map()

let socket = null
let attempts = 0

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function rememberHistory(tabId, url, replace) {
  if (!url || url.startsWith('chrome://')) return
  const current = historyByTab.get(tabId) || { entries: [], index: -1 }
  if (replace && current.index >= 0) {
    current.entries[current.index] = url
  } else if (current.entries[current.index] !== url) {
    current.entries = current.entries.slice(0, current.index + 1)
    current.entries.push(url)
    current.index = current.entries.length - 1
  }
  historyByTab.set(tabId, current)
}

function historyState(tabId) {
  const current = historyByTab.get(tabId)
  if (!current) return { canGoBack: false, canGoForward: false }
  return {
    canGoBack: current.index > 0,
    canGoForward: current.index < current.entries.length - 1
  }
}

async function tabInfo(windowId) {
  const tabs = await chrome.tabs.query({ windowId, active: true })
  const tab = tabs[0]
  if (!tab) return null
  return {
    windowId,
    tabId: tab.id,
    url: tab.url || tab.pendingUrl || '',
    title: tab.title || '',
    loading: Boolean(tab.status === 'loading'),
    ...historyState(tab.id)
  }
}

async function emitWindow(windowId) {
  const info = await tabInfo(windowId)
  if (info) send({ type: 'event', event: 'updated', ...info })
}

const handlers = {
  async create(params) {
    const window = await chrome.windows.create({
      url: params.url,
      type: 'popup',
      focused: false,
      width: Math.max(400, Math.round(params.width || 1280)),
      height: Math.max(300, Math.round(params.height || 800)),
      left: Math.round(params.left || 80),
      top: Math.round(params.top || 80)
    })
    createdWindows.add(window.id)
    const tab = window.tabs && window.tabs[0]
    if (tab?.id && tab.url) rememberHistory(tab.id, tab.url, true)
    return {
      windowId: window.id,
      tabId: tab ? tab.id : null,
      left: window.left,
      top: window.top,
      width: window.width,
      height: window.height
    }
  },
  async navigate(params) {
    await chrome.tabs.update(params.tabId, { url: params.url })
    return {}
  },
  async back(params) {
    const current = historyByTab.get(params.tabId)
    if (!current || current.index <= 0) return {}
    await chrome.tabs.goBack(params.tabId)
    return {}
  },
  async forward(params) {
    const current = historyByTab.get(params.tabId)
    if (!current || current.index >= current.entries.length - 1) return {}
    await chrome.tabs.goForward(params.tabId)
    return {}
  },
  async reload(params) {
    await chrome.tabs.reload(params.tabId)
    return {}
  },
  async close(params) {
    createdWindows.delete(params.windowId)
    try {
      await chrome.windows.remove(params.windowId)
    } catch {
      /* already closed */
    }
    return {}
  },
  async zoom(params) {
    await chrome.tabs.setZoom(params.tabId, Math.min(5, Math.max(0.25, params.factor)))
    return {}
  }
}

function connect() {
  const url = `ws://127.0.0.1:${self.VANTA.port}?token=${encodeURIComponent(self.VANTA.token)}`
  socket = new WebSocket(url)
  socket.onopen = () => {
    attempts = 0
    send({ type: 'hello' })
  }
  socket.onclose = () => {
    socket = null
    attempts += 1
    setTimeout(connect, Math.min(4000, 250 * attempts))
  }
  socket.onerror = () => {
    try {
      socket.close()
    } catch {
      /* ignore */
    }
  }
  socket.onmessage = async (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (!message || !message.id || !message.type) return
    const handler = handlers[message.type]
    if (!handler) {
      send({ id: message.id, type: 'error', message: `unknown command ${message.type}` })
      return
    }
    try {
      const payload = await handler(message)
      send({ id: message.id, type: 'ok', payload })
    } catch (error) {
      send({ id: message.id, type: 'error', message: String(error && error.message ? error.message : error) })
    }
  }
}

chrome.windows.onCreated.addListener(async (window) => {
  if (createdWindows.has(window.id)) return
  send({
    type: 'event',
    event: 'popup',
    windowId: window.id,
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height
  })
})

chrome.windows.onRemoved.addListener((windowId) => {
  createdWindows.delete(windowId)
  send({ type: 'event', event: 'closed', windowId })
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.windowId == null || !createdWindows.has(tab.windowId)) return
  if (changeInfo.url) rememberHistory(tabId, changeInfo.url, true)
  if (tab.url && changeInfo.status === 'complete') rememberHistory(tabId, tab.url, true)
  await emitWindow(tab.windowId)
})

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return
  rememberHistory(details.tabId, details.url, details.transitionType === 'reload')
})

connect()
