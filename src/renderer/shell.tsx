import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { TokensPanel } from './TokensPanel'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AccessTimeIcon, AddIcon, ArrowForwardIcon, ChangeHistoryIcon, ChatBubbleOutlineOutlinedIcon, CheckIcon, CircleOutlinedIcon, CloseIcon, CropSquareIcon, DescriptionOutlinedIcon, DrawIcon, EastIcon, FrameIcon, FullscreenExitIcon, FullscreenIcon, HorizontalRuleIcon, ImageLayerIcon, Inventory2OutlinedIcon, KeyboardArrowDownIcon, LanguageIcon, MoreHorizIcon, SearchIcon, SettingsOutlinedIcon, StarBorderIcon, TitleIcon, VectorLayerIcon, ViewListIcon, ViewModuleIcon, WidgetsOutlinedIcon } from './lucideIcons'
import type { BrowserFrame, DesignNode, DesignPage, DesignTool, InspectInfo } from '../shared/types'
import { CURRENT_USER } from '../shared/comments'
import type { FramePreset } from '../shared/framePresets'
import { DesignInspector } from './DesignInspector'
import { GridPanel } from './GridPanel'
import { setGridPanel, useGridPanel } from './gridTracks'
import { ShapeCaptureOverlay } from './shapeCapture'
import { stepNumberInput } from './numberArrowKeys'
import { TabFavicon } from './tabFavicon'
import { ConnectAgentModal } from './ConnectAgentModal'
import { TabsOpenPopup } from './TabsOpenPopup'
import { UrlOmnibox } from './UrlOmnibox'
import { recordVisit } from './urlHistory'
import {
  type AgentMcpLinkStatus,
  type AgentSideBrowserSlot,
  type CodingAgentBinding,
  type CodingAgentId,
  type DockedTabRef,
  AGENT_SIDE_BROWSER_MAX,
  SIDEBAR_BROWSER_ID,
  getCodingAgentMeta
} from '../shared/codingAgents'
import {
  IconCaret,
  IconClose,
  IconCodingAgents,
  IconHome,
  IconMoon,
  IconNavChat,
  IconNavFile,
  IconNavSearch,
  IconNavTabs,
  IconNavVariables,
  IconPlus,
  IconSection,
  IconSidebarPanel,
  IconSun,
  IconTextOnPath,
  VantaMark,
  type IconProps
} from './icons'
import { fileHasThemeThumbnail, fileThumbnailUrl } from './fileThumb'

export type RailTab = 'file' | 'chat' | 'search' | 'coding-agents' | 'tabs' | 'variables'

export type ProjectFile = {
  id: string
  name: string
  editedAt?: number
  thumbnailUrl?: string
  thumbnailDarkUrl?: string
}

export type LayerItem = {
  id: string
  kind: 'frame' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'star' | 'path' | 'text' | 'comment' | 'widget' | 'browser' | 'section' | 'image'
  name: string
  selected: boolean
  textOnPath?: boolean
  /** Image layer holding live SVG (icons from Snapshot / Create SVG) — shown as a vector. */
  vector?: boolean
  depth?: number
  hidden?: boolean
  locked?: boolean
}

const SIDEBAR_SPRING = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.78 }
/** Expand/shrink chip from the sidebar edge — softer settle than the panel spring. */
const CHIP_EXPAND_SPRING = { type: 'spring' as const, stiffness: 340, damping: 30, mass: 0.92 }
/** Agent fullscreen expand — slightly heavier so the panel feels like it fills the canvas. */
const AGENT_FS_SPRING = { type: 'spring' as const, stiffness: 420, damping: 36, mass: 0.78 }
/** Rail section swaps (File ↔ Tabs ↔ …) — quick settle, follows the rail. */
const SECTION_SWITCH_SPRING = { type: 'spring' as const, stiffness: 520, damping: 40, mass: 0.72 }
/** Fast crossfade for rail sections — avoids waiting on exit + per-frame layout sync. */
const SECTION_SWITCH_QUICK = { duration: 0.14, ease: [0.22, 1, 0.36, 1] as const }
const RAIL_ORDER: RailTab[] = ['file', 'chat', 'search', 'coding-agents', 'tabs', 'variables']
const AGENT_RAIL_WIDTH = 36
const LEFT_RAIL_WIDTH = 72

function measureWorkspaceFillWidth(rightInset = 0) {
  if (typeof window === 'undefined') return 960
  const canvas = document.querySelector('.canvas') as HTMLElement | null
  if (canvas && canvas.clientWidth > 80) {
    // Overlay sits on the canvas column — use its live width so dual-pane
    // fills exactly to the right sidebar (no leftover gap).
    return Math.max(640, canvas.clientWidth)
  }
  return Math.max(640, window.innerWidth - LEFT_RAIL_WIDTH - Math.max(0, rightInset))
}

function SidebarUiToggle({
  side,
  expanded,
  onClick,
  className,
  iconSize = 16
}: {
  side: 'left' | 'right'
  expanded: boolean
  onClick: () => void
  className?: string
  iconSize?: number
}) {
  const label = expanded ? 'Minimize UI' : 'Expand UI'
  const shortcut = side === 'left' ? 'Ctrl+Shift+\\' : undefined
  return (
    <button
      type="button"
      className={className || 'sidebar-min'}
      title={shortcut ? `${label} ${shortcut}` : label}
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <IconSidebarPanel side={side} size={iconSize} />
    </button>
  )
}

const LAYER_ICONS: Record<LayerItem['kind'], typeof FrameIcon | typeof IconSection> = {
  frame: FrameIcon,
  section: IconSection as typeof FrameIcon,
  rect: CropSquareIcon,
  ellipse: CircleOutlinedIcon,
  line: HorizontalRuleIcon,
  arrow: EastIcon,
  polygon: ChangeHistoryIcon,
  star: StarBorderIcon,
  path: DrawIcon,
  text: TitleIcon,
  comment: ChatBubbleOutlineOutlinedIcon,
  widget: WidgetsOutlinedIcon,
  image: ImageLayerIcon,
  browser: LanguageIcon
}

const RAIL: Array<{ id: RailTab; label: ReactNode; icon: ComponentType<IconProps> | (() => ReactNode); wide?: boolean }> = [
  { id: 'file', label: 'File', icon: IconNavFile },
  { id: 'chat', label: 'Chat', icon: IconNavChat },
  { id: 'search', label: 'Search', icon: IconNavSearch },
  {
    id: 'coding-agents',
    label: (
      <>
        Coding
        <br />
        agents
      </>
    ),
    icon: IconCodingAgents,
    wide: true
  },
  { id: 'tabs', label: 'Tabs', icon: IconNavTabs },
  { id: 'variables', label: 'Tokens', icon: IconNavVariables }
]

export function FileTabs({
  files,
  activeId,
  newTabActive = false,
  onHome,
  onSelect,
  onClose,
  onNew,
  onCloseNewTab,
  onRename
}: {
  files: ProjectFile[]
  activeId: string
  newTabActive?: boolean
  onHome: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onCloseNewTab?: () => void
  onRename: (id: string, name: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const skipRename = useRef(false)

  const commitTabRename = (id: string, value: string, currentName: string) => {
    if (skipRename.current) {
      skipRename.current = false
      setEditingId(null)
      return
    }
    const next = value.trim()
    if (next && next !== currentName) onRename(id, next)
    setEditingId(null)
  }

  return (
    <header className="file-tabs">
      <button
        type="button"
        className={`file-tab home-tab${activeId === '' && !newTabActive ? ' is-home' : ''}`}
        title="Recents"
        onClick={onHome}
      >
        <IconHome size={18} />
      </button>
      <div className="file-tabs-list">
        {files.map((file) => (
          <div
            key={file.id}
            className={
              !newTabActive && file.id === activeId
                ? editingId === file.id
                  ? 'file-tab active is-editing'
                  : 'file-tab active'
                : editingId === file.id
                  ? 'file-tab is-editing'
                  : 'file-tab'
            }
            onClick={() => {
              if (editingId === file.id) return
              onSelect(file.id)
            }}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setEditingId(file.id)
            }}
          >
            <span className="file-tab-icon">
              <IconNavFile size={16} />
            </span>
            {editingId === file.id ? (
              <input
                autoFocus
                className="file-tab-name-input"
                defaultValue={file.name}
                aria-label="Rename file"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => commitTabRename(file.id, event.currentTarget.value, file.name)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                  if (event.key === 'Escape') {
                    skipRename.current = true
                    event.currentTarget.blur()
                  }
                }}
              />
            ) : (
              <span className="file-tab-name">{file.name}</span>
            )}
            <button
              type="button"
              className="file-tab-close"
              title="Close"
              onClick={(event) => {
                event.stopPropagation()
                onClose(file.id)
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
        ))}
        {newTabActive ? (
          <div className="file-tab active">
            <span className="file-tab-icon">
              <IconNavFile size={16} />
            </span>
            <span className="file-tab-name">New tab</span>
            <button
              type="button"
              className="file-tab-close"
              title="Close"
              onClick={(event) => {
                event.stopPropagation()
                onCloseNewTab?.()
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
        ) : null}
        <button type="button" className="file-tabs-new" title="New tab" onClick={onNew}>
          <IconPlus size={18} />
        </button>
      </div>
    </header>
  )
}

export function LeftSidebar({
  tab,
  onTab,
  theme,
  onToggleTheme,
  fileName,
  onRenameFile,
  browsers,
  onFocusWindow: _onFocusWindow,
  onActivateTab,
  onCloseTab,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  pages,
  activePageId,
  pageQuery,
  onPageQuery,
  onSelectPage,
  onAddPage,
  onRenamePage,
  layers,
  onSelectLayer,
  onRenameLayer,
  onOpenLayerMenu,
  onToggleLayerVisible,
  onToggleLayerLock,
  onCollapseLayersToken = 0,
  panelOpen,
  panelWidth,
  onTogglePanel,
  onResizePanel,
  rightOpen = true,
  rightWidth = 241,
  codingActive,
  codingAgentUrl,
  codingRecents,
  codingPopup,
  codingFullscreen,
  dockedTab,
  sideBrowsers,
  hideFullscreenControl = false,
  tabsPopup,
  onTabsPopup,
  onOpenTabInCanvas,
  onOpenTabToLeft,
  onCodingPopup,
  onCodingChoose,
  onCodingResume,
  onCodingFullscreen,
  onCodingAgentNavigate,
  onCodingAgentBack,
  onCodingAgentForward,
  onCodingAgentReload,
  onDockTab,
  onUndockTab,
  onDockedTabNavigate,
  onDockedTabBack,
  onDockedTabForward,
  onDockedTabReload,
  onAddAgentSideBrowser,
  onCloseSideBrowser,
  onCloseCodingAgent,
  onSideBrowserUrl,
  onSideBrowserNavigate,
  onSideBrowserBack,
  onSideBrowserForward,
  onSideBrowserReload,
  onAgentHole,
  onSideBrowserHole,
  onChromeLayout
}: {
  tab: RailTab
  onTab: (tab: RailTab) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  fileName: string
  onRenameFile: (name: string) => void
  browsers: BrowserFrame[]
  dockedTab: DockedTabRef | null
  onDockTab: (windowId: string, tabId: string) => void
  onUndockTab: () => void
  onDockedTabNavigate: (url: string) => void
  onDockedTabBack: () => void
  onDockedTabForward: () => void
  onDockedTabReload: () => void
  onFocusWindow: (id: string) => void
  onActivateTab: (windowId: string, tabId: string) => void
  onCloseTab: (windowId: string, tabId: string) => void
  chats: Array<{ id: string; title: string; prompt: string }>
  activeChatId: string
  onSelectChat: (id: string) => void
  onNewChat: () => void
  pages: DesignPage[]
  activePageId: string
  pageQuery: string
  onPageQuery: (value: string) => void
  onSelectPage: (id: string) => void
  onAddPage: () => void
  onRenamePage: (id: string, name: string) => void
  layers: LayerItem[]
  onSelectLayer: (id: string, kind: LayerItem['kind']) => void
  onRenameLayer: (id: string, name: string) => void
  onOpenLayerMenu?: (id: string, kind: LayerItem['kind'], rect: DOMRect) => void
  onToggleLayerVisible?: (id: string) => void
  onToggleLayerLock?: (id: string) => void
  onCollapseLayersToken?: number
  panelOpen: boolean
  panelWidth: number
  onTogglePanel: () => void
  onResizePanel: (width: number) => void
  rightOpen?: boolean
  rightWidth?: number
  codingActive: CodingAgentBinding | null
  codingAgentUrl: string
  codingRecents: CodingAgentBinding[]
  codingPopup: boolean
  codingFullscreen: boolean
  sideBrowsers: AgentSideBrowserSlot[]
  hideFullscreenControl?: boolean
  tabsPopup: boolean
  onTabsPopup: (open: boolean) => void
  onOpenTabInCanvas: () => void
  onOpenTabToLeft: () => void
  onCodingPopup: (open: boolean) => void
  onCodingChoose: (agentId: CodingAgentId, openUrl?: string) => void
  onCodingResume: (id: string) => void
  onCodingFullscreen: () => void
  onCodingAgentNavigate: (url: string) => void
  onCodingAgentBack: () => void
  onCodingAgentForward: () => void
  onCodingAgentReload: () => void
  onAddAgentSideBrowser: () => void
  onCloseSideBrowser: (id: string) => void
  onCloseCodingAgent: () => void
  onSideBrowserUrl: (id: string, url: string) => void
  onSideBrowserNavigate: (id: string, url: string) => void
  onSideBrowserBack: (id: string) => void
  onSideBrowserForward: (id: string) => void
  onSideBrowserReload: (id: string) => void
  onAgentHole: (el: HTMLDivElement | null) => void
  onSideBrowserHole: (id: string, el: HTMLDivElement | null) => void
  onChromeLayout?: () => void
}) {
  const [editingFileName, setEditingFileName] = useState(false)
  const skipFileRename = useRef(false)
  const codingSidebar = Boolean(codingActive && tab === 'coding-agents')
  const codingGate = tab === 'coding-agents' && !codingActive
  const dockedTabSidebar = Boolean(dockedTab && tab === 'tabs')
  const leftBrowserSidebar = codingSidebar || dockedTabSidebar
  const hasOpenTabs = browsers.some((frame) => frame.tabs.length > 0)
  const tabsPopupPending = tabsPopup && !hasOpenTabs
  const codingPopupPending = codingPopup && !codingActive
  const sideBrowserCount = sideBrowsers.length

  // Never leave the Tabs rail empty — jump back to File when the last tab is gone.
  useEffect(() => {
    if (tab !== 'tabs') return
    if (hasOpenTabs || dockedTab || tabsPopup) return
    onTab('file')
  }, [tab, hasOpenTabs, dockedTab, tabsPopup, onTab])
  const canAddSideBrowser = sideBrowserCount < AGENT_SIDE_BROWSER_MAX
  const dockedTabUrl =
    dockedTabSidebar && dockedTab
      ? browsers.find((frame) => frame.id === dockedTab.windowId)?.tabs.find((item) => item.id === dockedTab.tabId)?.url ||
        ''
      : ''
  const openTabCandidates = [
    ...browsers.flatMap((frame) =>
      frame.tabs.map((item) => ({
        id: item.id,
        windowId: frame.id,
        title: item.title,
        url: item.url,
        favicon: item.favicon
      }))
    ),
    ...(codingActive
      ? [
          {
            id: SIDEBAR_BROWSER_ID,
            windowId: SIDEBAR_BROWSER_ID,
            title: getCodingAgentMeta(codingActive.agentId).name,
            url: codingAgentUrl,
            favicon: getCodingAgentMeta(codingActive.agentId).favicon
          }
        ]
      : []),
    ...sideBrowsers.map((slot) => {
      let title = slot.url
      try {
        title = new URL(slot.url).hostname.replace(/^www\./, '') || slot.url
      } catch {
        /* keep */
      }
      return {
        id: slot.id,
        windowId: slot.id,
        title,
        url: slot.url,
        favicon: ''
      }
    })
  ]
  const reduceMotion = useReducedMotion()
  const notifyLayout = () => onChromeLayout?.()
  const prevTabRef = useRef(tab)
  const sectionDir = RAIL_ORDER.indexOf(tab) >= RAIL_ORDER.indexOf(prevTabRef.current) ? 1 : -1
  useEffect(() => {
    prevTabRef.current = tab
  }, [tab])
  const sectionKey = dockedTabSidebar
    ? `tabs-dock-${dockedTab?.tabId || 'tab'}`
    : tab === 'coding-agents' && codingActive
      ? `agent-${codingActive.id}`
      : tab
  const sectionTransition = reduceMotion ? { duration: 0.01 } : SECTION_SWITCH_QUICK
  const rightInset = codingFullscreen || !rightOpen ? 0 : rightWidth
  const [fillPanelW, setFillPanelW] = useState(() => measureWorkspaceFillWidth(rightInset))
  const openRef = useRef(panelOpen)
  const fsRef = useRef(codingFullscreen)
  const wasOpen = openRef.current
  const wasFs = fsRef.current
  const fsToggled = codingFullscreen !== wasFs
  const resizingPanel = panelOpen && wasOpen && !fsToggled && !codingFullscreen
  openRef.current = panelOpen
  fsRef.current = codingFullscreen
  const activeSpring = reduceMotion
    ? { duration: 0.01 }
    : fsToggled || codingFullscreen || sideBrowserCount > 0
      ? AGENT_FS_SPRING
      : resizingPanel
        ? { duration: 0 }
        : SIDEBAR_SPRING
  const chipSpring = reduceMotion ? { duration: 0.14 } : CHIP_EXPAND_SPRING
  const leftChipMotion = reduceMotion
    ? { initial: false as const, animate: { opacity: 1, scaleX: 1, scaleY: 1 }, exit: undefined }
    : {
        initial: { opacity: 0, scaleX: 0.28, scaleY: 0.9 },
        animate: { opacity: 1, scaleX: 1, scaleY: 1 },
        exit: { opacity: 0, scaleX: 0.28, scaleY: 0.9 }
      }

  const showPanel = panelOpen || codingFullscreen
  const showAgentRail = leftBrowserSidebar && showPanel
  const showSideBrowsers = Boolean(showAgentRail && sideBrowserCount > 0)
  const paneCount = 1 + sideBrowserCount

  useEffect(() => {
    const update = () => setFillPanelW(measureWorkspaceFillWidth(rightInset))
    update()
    window.addEventListener('resize', update)
    const canvas = document.querySelector('.canvas')
    const ro = canvas ? new ResizeObserver(update) : null
    if (canvas && ro) ro.observe(canvas)
    return () => {
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
  }, [rightInset, showSideBrowsers, codingFullscreen, panelOpen, sideBrowserCount])

  const railW = showAgentRail ? AGENT_RAIL_WIDTH : 0
  // Multi-pane fills the workspace (to the right sidebar / window edge) and splits evenly.
  const dualFillW = Math.max(railW + 640, fillPanelW)
  const dualContentW = Math.max(640, dualFillW - railW)
  const sideW = showSideBrowsers ? Math.floor(dualContentW / paneCount) : 0
  const agentContentW = showSideBrowsers
    ? dualContentW - sideW * sideBrowserCount
    : codingFullscreen
      ? Math.max(320, fillPanelW - railW)
      : panelWidth
  const targetPanelWidth = showPanel
    ? showSideBrowsers || codingFullscreen
      ? dualFillW
      : panelWidth + railW
    : 0
  // Snap multi-pane width so side browsers aren't clipped while the panel is still narrow.
  const dualPane = showSideBrowsers || codingFullscreen
  const panelTransition = reduceMotion
    ? { duration: 0.01 }
    : dualPane
      ? { type: 'spring' as const, stiffness: 520, damping: 40, mass: 0.72 }
      : activeSpring

  return (
    <aside
      className={`leftbar${leftBrowserSidebar ? ' has-coding-agent' : ''}${codingFullscreen ? ' has-agent-full' : ''}${panelOpen ? '' : ' is-panel-collapsed'}`}
    >
      <nav className="leftbar-rail">
        <div className="leftbar-rail-top">
          {RAIL.map((item) => {
            const Icon = item.icon
            const railActive =
              item.id === 'tabs'
                ? tab === 'tabs' || tabsPopupPending
                : item.id === 'coding-agents'
                  ? tab === 'coding-agents' || codingPopupPending
                  : tab === item.id && !tabsPopupPending && !codingPopupPending
            return (
              <button
                key={item.id}
                type="button"
                className={`rail-item${railActive ? ' active' : ''}${item.wide ? ' wide-label' : ''}${item.id === 'variables' ? ' rail-item-after-sep' : ''}`}
                onClick={() => {
                  if (item.id === 'coding-agents') {
                    // Gate first: MCP connect UI. Agent browser only after setup Done.
                    onTab('coding-agents')
                    onCodingPopup(false)
                    return
                  }
                  if (item.id === 'tabs') {
                    if (tab === 'tabs' && dockedTab) {
                      onUndockTab()
                      return
                    }
                    if (!hasOpenTabs) {
                      // Keep the current panel underneath — never show a blank Tabs section.
                      onTabsPopup(true)
                      return
                    }
                    onTab('tabs')
                    return
                  }
                  onTab(item.id)
                }}
              >
                <span className="rail-icon">
                  <Icon />
                </span>
                <span className="rail-label">{item.label}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="rail-theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={onToggleTheme}
        >
          <span className="rail-icon">{theme === 'dark' ? <IconSun /> : <IconMoon />}</span>
        </button>
      </nav>
      <motion.div
        className={
          showPanel
            ? `leftbar-panel${tab === 'chat' ? ' is-chat' : ''}${leftBrowserSidebar ? ' coding-agents-panel' : ''}${codingFullscreen ? ' is-agent-full' : ''}${showAgentRail ? ' has-agent-rail' : ''}`
            : `leftbar-panel is-collapsed${tab === 'chat' ? ' is-chat' : ''}${leftBrowserSidebar ? ' coding-agents-panel' : ''}${codingFullscreen ? ' is-agent-full' : ''}${showAgentRail ? ' has-agent-rail' : ''}`
        }
        initial={false}
        animate={{
          width: targetPanelWidth,
          opacity: showPanel ? 1 : 0
        }}
        transition={panelTransition}
        style={{ pointerEvents: showPanel ? 'auto' : 'none' }}
        onAnimationComplete={notifyLayout}
      >
        <motion.div
          className="leftbar-panel-inner"
          initial={false}
          style={{
            flex: codingFullscreen && !showSideBrowsers ? '1 1 auto' : '0 0 auto',
            minWidth: 0
          }}
          animate={{ width: agentContentW }}
          transition={panelTransition}
          onAnimationComplete={notifyLayout}
        >
        <AnimatePresence initial={false}>
          {tab !== 'coding-agents' && !dockedTabSidebar ? (
            <motion.div
              key="leftbar-filehead"
              className="leftbar-filehead"
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={sectionTransition}
            >
              <div className="leftbar-filename">
                {editingFileName ? (
                  <input
                    autoFocus
                    className="leftbar-filename-input"
                    defaultValue={fileName}
                    aria-label="Rename file"
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) => {
                      if (skipFileRename.current) {
                        skipFileRename.current = false
                        setEditingFileName(false)
                        return
                      }
                      const next = event.currentTarget.value.trim()
                      if (next && next !== fileName) onRenameFile(next)
                      setEditingFileName(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        skipFileRename.current = true
                        event.currentTarget.blur()
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="leftbar-filename-btn"
                    title="Double-click to rename"
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      setEditingFileName(true)
                    }}
                  >
                    <span className="leftbar-filename-text">{fileName}</span>
                    <IconCaret size={12} />
                  </button>
                )}
              </div>
              <SidebarUiToggle side="left" expanded iconSize={18} onClick={onTogglePanel} />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence mode="popLayout" initial={false} onExitComplete={notifyLayout}>
          <motion.div
            key={sectionKey}
            className="leftbar-section"
            custom={sectionDir}
            initial={reduceMotion ? false : { opacity: 0, y: sectionDir * 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: sectionDir * -4 }}
            transition={sectionTransition}
            onAnimationComplete={notifyLayout}
          >
        {tab === 'file' && (
          <div className="leftbar-body pages-layers">
            <PagesLayers
              pages={pages}
              activePageId={activePageId}
              pageQuery={pageQuery}
              onPageQuery={onPageQuery}
              onSelectPage={onSelectPage}
              onAddPage={onAddPage}
              onRenamePage={onRenamePage}
              layers={layers}
              onSelectLayer={onSelectLayer}
              onRenameLayer={onRenameLayer}
              onOpenLayerMenu={onOpenLayerMenu}
              onToggleLayerVisible={onToggleLayerVisible}
              onToggleLayerLock={onToggleLayerLock}
              collapseToken={onCollapseLayersToken}
            />
          </div>
        )}
        {tab === 'chat' && (
          <div className="leftbar-chat-list">
            <div className="chat-list-head">
              <span>Recents</span>
              <button type="button" title="New chat" onClick={onNewChat}>
                <AddIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
            <div className="chat-list">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className={chat.id === activeChatId ? 'chat-list-item is-active' : 'chat-list-item'}
                  onClick={() => onSelectChat(chat.id)}
                >
                  <span
                    className="chat-list-avatar"
                    style={{ background: CURRENT_USER.color }}
                    aria-hidden="true"
                  >
                    {CURRENT_USER.avatarUrl ? (
                      <img src={CURRENT_USER.avatarUrl} alt="" />
                    ) : (
                      CURRENT_USER.initial
                    )}
                  </span>
                  <span className="chat-list-copy">
                    <span className="chat-list-title">{chat.title}</span>
                    {chat.prompt ? <span className="chat-list-prompt">{chat.prompt}</span> : null}
                  </span>
                  <span
                    className="chat-list-more"
                    role="presentation"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizIcon sx={{ fontSize: 18 }} />
                  </span>
                </button>
              ))}
              {chats.length === 0 && <p className="panel-empty">No chats yet.</p>}
            </div>
          </div>
        )}
        {tab === 'search' && (
          <div className="leftbar-body">
            <input className="panel-search" placeholder="Search" />
            <p className="panel-note">Search across files, layers, and browsers will land here.</p>
          </div>
        )}
        {codingGate && (
          <div className="leftbar-body ca-agents-gate">
            <section className="ca-agents-gate-mcp">
              <h3 className="ca-agents-gate-label">MCP</h3>
              <button type="button" className="ca-agents-gate-connect" onClick={() => onCodingPopup(true)}>
                Connect your agent
              </button>
              <p className="ca-agents-gate-note">
                Set up Scobe MCP first. The coding agent opens fullscreen in this sidebar after you finish.
              </p>
            </section>
          </div>
        )}
        {tab === 'coding-agents' && codingActive && (
            <div className="ca-dock-enter">
              <DockedBrowserPanel
                fullscreen={codingFullscreen}
                url={codingAgentUrl}
                showAddressBar
                canvasMcpAgentId={codingActive.agentId}
                onNavigate={onCodingAgentNavigate}
                onBack={onCodingAgentBack}
                onForward={onCodingAgentForward}
                onReload={onCodingAgentReload}
                onClose={onCloseCodingAgent}
                onHole={onAgentHole}
                openTabs={openTabCandidates.filter((item) => item.id !== SIDEBAR_BROWSER_ID)}
                onSwitchTab={onActivateTab}
              />
            </div>
        )}
        {tab === 'tabs' && (hasOpenTabs || dockedTabSidebar) && (
          dockedTabSidebar ? (
            <div className="ca-dock-enter">
              <DockedBrowserPanel
                fullscreen={codingFullscreen}
                url={dockedTabUrl}
                showAddressBar
                onNavigate={onDockedTabNavigate}
                onBack={onDockedTabBack}
                onForward={onDockedTabForward}
                onReload={onDockedTabReload}
                onClose={onUndockTab}
                onHole={onAgentHole}
                openTabs={openTabCandidates.filter((item) => item.id !== dockedTab?.tabId)}
                onSwitchTab={onActivateTab}
              />
            </div>
          ) : (
            <div className="leftbar-body pages-layers">
              <div className="tree-head">
                <span>Tabs</span>
                <span className="tree-head-actions">
                  <button type="button" className="tree-search-icon" title="Search" aria-label="Search" disabled>
                    <SearchIcon sx={{ fontSize: 16 }} />
                  </button>
                  <button type="button" title="New tab" aria-label="New tab" onClick={() => onTabsPopup(true)}>
                    <AddIcon sx={{ fontSize: 18 }} />
                  </button>
                </span>
              </div>
              <div className="panel-kicker">Open tabs</div>
              {browsers.flatMap((frame) =>
                frame.tabs.map((item) => {
                  const isDocked = dockedTab?.tabId === item.id
                  return (
                    <div key={item.id} className={item.id === frame.activeTabId ? 'panel-tab is-active' : 'panel-tab'}>
                      <button
                        type="button"
                        className="panel-tab-main"
                        onClick={() => onActivateTab(frame.id, item.id)}
                      >
                        <TabFavicon tab={item} />
                        <span>{item.title || item.url || 'New tab'}</span>
                      </button>
                      <button
                        type="button"
                        className={`panel-tab-dock${isDocked ? ' is-docked' : ''}`}
                        title={isDocked ? 'Close left panel' : 'Open on left'}
                        aria-label={isDocked ? 'Close left panel' : 'Open tab on left'}
                        aria-pressed={isDocked}
                        onClick={() => {
                          if (isDocked) onUndockTab()
                          else onDockTab(frame.id, item.id)
                        }}
                      >
                        {isDocked ? <FullscreenExitIcon sx={{ fontSize: 14 }} /> : <FullscreenIcon sx={{ fontSize: 14 }} />}
                      </button>
                      <button
                        type="button"
                        className="panel-tab-close"
                        title="Close tab"
                        aria-label="Close tab"
                        onClick={() => onCloseTab(frame.id, item.id)}
                      >
                        <IconClose size={12} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          )
        )}
        {tab === 'variables' && (
          <div className="leftbar-body tokens-body">
            <TokensPanel />
          </div>
        )}
          </motion.div>
        </AnimatePresence>
        </motion.div>
        <AnimatePresence onExitComplete={notifyLayout}>
          {sideBrowsers.map((slot) =>
            showAgentRail ? (
              <motion.div
                key={slot.id}
                className="ca-side-browser-motion"
                style={{ width: sideW, flex: `0 0 ${sideW}px` }}
                initial={reduceMotion ? false : { opacity: 0, x: 36 }}
                animate={{ opacity: 1, x: 0 }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0.08 } }
                    : { opacity: 0, x: 36 }
                }
                transition={reduceMotion ? { duration: 0.01 } : AGENT_FS_SPRING}
                onUpdate={notifyLayout}
                onAnimationComplete={notifyLayout}
              >
                <AgentSideBrowser
                  url={slot.url}
                  onUrlChange={(url) => onSideBrowserUrl(slot.id, url)}
                  onNavigate={(url) => onSideBrowserNavigate(slot.id, url)}
                  onBack={() => onSideBrowserBack(slot.id)}
                  onForward={() => onSideBrowserForward(slot.id)}
                  onReload={() => onSideBrowserReload(slot.id)}
                  onClose={() => onCloseSideBrowser(slot.id)}
                  onHole={(el) => onSideBrowserHole(slot.id, el)}
                  openTabs={openTabCandidates.filter((item) => item.id !== slot.id)}
                  onSwitchTab={onActivateTab}
                />
              </motion.div>
            ) : null
          )}
        </AnimatePresence>
        {showAgentRail && (
          <DockedBrowserRail
            fullscreen={codingFullscreen}
            hideFullscreen={hideFullscreenControl || sideBrowserCount > 0}
            canAddBrowser={canAddSideBrowser}
            sideBrowserCount={sideBrowserCount}
            onFullscreen={onCodingFullscreen}
            onAddBrowser={onAddAgentSideBrowser}
            onMinimize={onTogglePanel}
          />
        )}
        {panelOpen && !codingFullscreen && !showSideBrowsers && (
          <SidebarResizer
            side="left"
            width={panelWidth}
            onResize={onResizePanel}
          />
        )}
      </motion.div>
      <AnimatePresence>
        {!panelOpen && !codingFullscreen && (
          <motion.button
            type="button"
            key="left-ui-chip"
            className="sidebar-ui-chip left"
            title="Expand UI Ctrl+Shift+\\"
            aria-label="Expand UI"
            onClick={onTogglePanel}
            initial={leftChipMotion.initial}
            animate={leftChipMotion.animate}
            exit={leftChipMotion.exit}
            transition={chipSpring}
          >
            <VantaMark size={18} />
            <span className="sidebar-ui-chip-name">{fileName}</span>
            <IconSidebarPanel side="left" size={17} />
          </motion.button>
        )}
      </AnimatePresence>
      <ConnectAgentModal
        open={codingPopup}
        initialAgentId={codingRecents[0]?.agentId || 'cursor'}
        onClose={() => onCodingPopup(false)}
        onDone={(agentId, openUrl) => {
          onCodingPopup(false)
          onCodingChoose(agentId, openUrl)
        }}
      />
      <TabsOpenPopup
        open={tabsPopup}
        onClose={() => onTabsPopup(false)}
        onOpenInCanvas={onOpenTabInCanvas}
        onOpenToLeft={onOpenTabToLeft}
      />
    </aside>
  )
}

function BrowserAddressBar({
  url,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onClose,
  openTabs = [],
  onSwitchTab
}: {
  url: string
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onClose?: () => void
  openTabs?: Array<{ id: string; windowId: string; title: string; url: string; favicon: string }>
  onSwitchTab?: (windowId: string, tabId: string) => void
}) {
  const [draft, setDraft] = useState(url)
  useEffect(() => {
    setDraft(url)
  }, [url])

  return (
    <div className="ca-side-browser-toolbar" data-chrome-overlay="">
      <button type="button" title="Back" aria-label="Back" onClick={onBack}>
        ‹
      </button>
      <button type="button" title="Forward" aria-label="Forward" onClick={onForward}>
        ›
      </button>
      <button type="button" title="Reload" aria-label="Reload" onClick={onReload}>
        ↻
      </button>
      <UrlOmnibox
        value={draft}
        onChange={setDraft}
        openTabs={openTabs}
        onSubmit={(next) => {
          recordVisit({ url: next, title: '' })
          setDraft(next)
          onNavigate(next)
        }}
        onSwitchTab={
          onSwitchTab
            ? ({ tabId, windowId }) => {
                if (windowId) onSwitchTab(windowId, tabId)
              }
            : undefined
        }
      />
      {onClose && (
        <button type="button" title="Close browser" aria-label="Close browser" onClick={onClose}>
          <IconClose size={12} />
        </button>
      )}
    </div>
  )
}

function CanvasMcpLinkStrip({ agentId }: { agentId: CodingAgentId }) {
  const [link, setLink] = useState<AgentMcpLinkStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'url' | 'prompt' | 'steps' | null>(null)

  useEffect(() => {
    let cancelled = false
    setLink(null)
    const getLink = window.vanta.getAgentMcpLink
    if (typeof getLink !== 'function') return
    void getLink(agentId)
      .then((status) => {
        if (!cancelled) setLink(status)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [agentId])

  const connected = link?.state === 'connected'
  const needsSetup = link?.state === 'needs-setup'
  const apiReady = typeof window.vanta.getAgentMcpLink === 'function'
  const cloudReady = Boolean(link?.publicUrl)
  const showSetup = Boolean(link && (needsSetup || (connected && cloudReady)))
  const label = !apiReady
    ? 'Scobe MCP · Restart app'
    : !link
      ? 'Scobe MCP'
      : busy
        ? 'Scobe MCP · Tunneling…'
        : connected
          ? 'Scobe MCP · Ready'
          : needsSetup && cloudReady
            ? 'Scobe MCP · Add in Agents'
            : needsSetup
              ? 'Scobe MCP · Setup'
              : 'Scobe MCP · Off'

  const copyText = async (text: string, kind: 'url' | 'prompt' | 'steps') => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      /* ignore */
    }
  }

  const onConnect = async () => {
    if (busy || typeof window.vanta.connectAgentMcp !== 'function') return
    setBusy(true)
    try {
      const status = await window.vanta.connectAgentMcp(agentId)
      setLink(status)
      if (status.publicUrl) await copyText(status.publicUrl, 'url')
      else if (status.setupSnippet) await copyText(status.setupSnippet, 'steps')
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  const onDisconnect = async () => {
    if (busy || typeof window.vanta.disconnectAgentMcp !== 'function') return
    setBusy(true)
    try {
      const status = await window.vanta.disconnectAgentMcp(agentId)
      setLink(status)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  const onConfirm = async () => {
    if (busy || typeof window.vanta.confirmCloudAgentMcp !== 'function') return
    setBusy(true)
    try {
      const status = await window.vanta.confirmCloudAgentMcp(agentId)
      setLink(status)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ca-mcp-link" data-chrome-overlay="">
      <div className="ca-mcp-link-strip" title={link?.detail || undefined}>
        <span
          className={`ca-mcp-link-dot${connected ? ' is-on' : needsSetup ? ' is-warn' : ''}`}
          aria-hidden
        />
        <span className="ca-mcp-link-label">{label}</span>
        <span className="ca-mcp-link-spacer" />
        {link?.state !== 'off' && link != null ? (
          <button type="button" className="ca-mcp-link-btn" disabled={busy} onClick={() => void onDisconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="ca-mcp-link-btn is-primary"
            disabled={busy || !apiReady || !link}
            onClick={() => void onConnect()}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
      {link && showSetup && (
        <div className="ca-mcp-setup">
          <p className="ca-mcp-setup-title">
            {agentId === 'cursor'
              ? 'Cursor Agents use Cursor canvas unless you add Scobe MCP'
              : 'Add Scobe MCP in this agent site'}
          </p>
          <ol className="ca-mcp-setup-steps">
            <li>
              Copy tunnel URL
              <button
                type="button"
                className="ca-mcp-link-btn"
                disabled={busy || !link.publicUrl}
                onClick={() => void copyText(link.publicUrl || '', 'url')}
              >
                {copied === 'url' ? 'Copied' : cloudReady ? 'Copy URL' : 'No tunnel'}
              </button>
            </li>
            <li>
              Agents → MCP → add HTTP <code>vanta</code> → enable it
            </li>
            <li>
              New chat, paste Scobe prompt (never Cursor canvas)
              <button
                type="button"
                className="ca-mcp-link-btn"
                disabled={busy || !link.buildPrompt}
                onClick={() => void copyText(link.buildPrompt || '', 'prompt')}
              >
                {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
              </button>
            </li>
          </ol>
          {needsSetup && cloudReady && (
            <button type="button" className="ca-mcp-link-btn is-primary" disabled={busy} onClick={() => void onConfirm()}>
              I’ve added Scobe MCP
            </button>
          )}
          {!cloudReady && link.state !== 'off' && (
            <p className="ca-mcp-setup-note">Tunnel not running — click Connect again.</p>
          )}
        </div>
      )}
    </div>
  )
}

function DockedBrowserPanel({
  fullscreen,
  onHole,
  showAddressBar = false,
  canvasMcpAgentId,
  url = '',
  onNavigate,
  onBack,
  onForward,
  onReload,
  onClose,
  openTabs = [],
  onSwitchTab
}: {
  fullscreen: boolean
  onHole: (el: HTMLDivElement | null) => void
  showAddressBar?: boolean
  /** When set, show opt-in Connect strip for this coding agent (Paper-style). */
  canvasMcpAgentId?: CodingAgentId
  url?: string
  onNavigate?: (url: string) => void
  onBack?: () => void
  onForward?: () => void
  onReload?: () => void
  onClose?: () => void
  openTabs?: Array<{ id: string; windowId: string; title: string; url: string; favicon: string }>
  onSwitchTab?: (windowId: string, tabId: string) => void
}) {
  const addressBar = Boolean(showAddressBar && onNavigate && onBack && onForward && onReload)
  return (
    <div
      className={`ca-panel ca-panel-browser${fullscreen ? ' is-full' : ''}${addressBar || onClose ? ' has-address-bar' : ''}${canvasMcpAgentId ? ' has-mcp-link' : ''}`}
    >
      {addressBar ? (
        <BrowserAddressBar
          url={url}
          onNavigate={onNavigate!}
          onBack={onBack!}
          onForward={onForward!}
          onReload={onReload!}
          onClose={onClose}
          openTabs={openTabs}
          onSwitchTab={onSwitchTab}
        />
      ) : onClose ? (
        <div className="ca-side-browser-toolbar ca-main-browser-toolbar" data-chrome-overlay="">
          <span className="ca-main-browser-toolbar-spacer" />
          <button type="button" title="Close browser" aria-label="Close browser" onClick={onClose}>
            <IconClose size={12} />
          </button>
        </div>
      ) : null}
      {canvasMcpAgentId ? <CanvasMcpLinkStrip agentId={canvasMcpAgentId} /> : null}
      <div className="ca-chrome-host live" ref={onHole} />
    </div>
  )
}

function DockedBrowserRail({
  fullscreen,
  hideFullscreen,
  canAddBrowser,
  sideBrowserCount,
  onFullscreen,
  onAddBrowser,
  onMinimize
}: {
  fullscreen: boolean
  hideFullscreen: boolean
  canAddBrowser: boolean
  sideBrowserCount: number
  onFullscreen: () => void
  onAddBrowser: () => void
  onMinimize: () => void
}) {
  return (
    <div className="ca-agent-rail" data-chrome-overlay="">
      {!hideFullscreen && (
        <button
          type="button"
          className={`ca-agent-rail-btn${fullscreen ? ' is-full' : ''}`}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          aria-pressed={fullscreen}
          onClick={onFullscreen}
        >
          {fullscreen ? <FullscreenExitIcon sx={{ fontSize: 18 }} /> : <FullscreenIcon sx={{ fontSize: 18 }} />}
        </button>
      )}
      <button
        type="button"
        className={`ca-agent-rail-btn${sideBrowserCount > 0 ? ' is-full' : ''}`}
        title={canAddBrowser ? 'Add browser' : 'Browser limit reached'}
        aria-label="Add browser"
        aria-pressed={sideBrowserCount > 0}
        disabled={!canAddBrowser}
        onClick={onAddBrowser}
      >
        <LanguageIcon sx={{ fontSize: 18 }} />
      </button>
      {!fullscreen && (
        <SidebarUiToggle
          side="left"
          expanded
          iconSize={16}
          className="ca-agent-rail-btn ca-agent-rail-min"
          onClick={onMinimize}
        />
      )}
    </div>
  )
}

function AgentSideBrowser({
  url,
  onUrlChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onClose,
  onHole,
  openTabs = [],
  onSwitchTab
}: {
  url: string
  onUrlChange: (url: string) => void
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onClose: () => void
  onHole: (el: HTMLDivElement | null) => void
  openTabs?: Array<{ id: string; windowId: string; title: string; url: string; favicon: string }>
  onSwitchTab?: (windowId: string, tabId: string) => void
}) {
  return (
    <div className="ca-side-browser">
      <BrowserAddressBar
        url={url}
        onNavigate={(next) => {
          onUrlChange(next)
          onNavigate(next)
        }}
        onBack={onBack}
        onForward={onForward}
        onReload={onReload}
        onClose={onClose}
        openTabs={openTabs}
        onSwitchTab={onSwitchTab}
      />
      <div className="ca-panel ca-panel-browser ca-side-browser-body">
        <div className="ca-chrome-host live ca-side-browser-hole" ref={onHole} />
      </div>
    </div>
  )
}

function LayerEyeOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function LayerEyeClosedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 13.5 13 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function LayerLockOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3.25" y="7.4" width="9.5" height="6.1" rx="1.5" stroke="currentColor" strokeWidth="1.25" fill="none" />
      <path
        d="M5.4 7.4V5.05c0-1.55 1.15-2.7 2.7-2.7 1.1 0 2.05.6 2.45 1.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

function LayerLockClosedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3.25" y="7.4" width="9.5" height="6.1" rx="1.5" stroke="currentColor" strokeWidth="1.25" fill="none" />
      <path
        d="M5.4 7.4V5.05c0-1.55 1.2-2.7 2.7-2.7s2.7 1.15 2.7 2.7V7.4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

function PagesLayers({
  pages,
  activePageId,
  pageQuery,
  onPageQuery,
  onSelectPage,
  onAddPage,
  onRenamePage,
  layers,
  onSelectLayer,
  onRenameLayer,
  onOpenLayerMenu,
  onToggleLayerVisible,
  onToggleLayerLock,
  collapseToken = 0
}: {
  pages: DesignPage[]
  activePageId: string
  pageQuery: string
  onPageQuery: (value: string) => void
  onSelectPage: (id: string) => void
  onAddPage: () => void
  onRenamePage: (id: string, name: string) => void
  layers: LayerItem[]
  onSelectLayer: (id: string, kind: LayerItem['kind']) => void
  onRenameLayer: (id: string, name: string) => void
  onOpenLayerMenu?: (id: string, kind: LayerItem['kind'], rect: DOMRect) => void
  onToggleLayerVisible?: (id: string) => void
  onToggleLayerLock?: (id: string) => void
  collapseToken?: number
}) {
  const [collapseDepth, setCollapseDepth] = useState(false)
  useEffect(() => {
    if (collapseToken > 0) setCollapseDepth(true)
  }, [collapseToken])
  const visiblePages = pages.filter((page) => page.name.toLowerCase().includes(pageQuery.trim().toLowerCase()))
  const visibleLayers = collapseDepth ? layers.filter((layer) => !layer.depth) : layers
  const openMenu = (layer: LayerItem, target: HTMLElement) => {
    onSelectLayer(layer.id, layer.kind)
    if (layer.kind === 'browser' || layer.kind === 'comment') return
    onOpenLayerMenu?.(layer.id, layer.kind, target.getBoundingClientRect())
  }
  const layerActions = (layer: LayerItem) => {
    if (layer.kind === 'browser' || layer.kind === 'comment') return null
    const hidden = Boolean(layer.hidden)
    const locked = Boolean(layer.locked)
    return (
      <span className="layer-row-actions">
        <button
          type="button"
          className={`layer-row-action${locked ? ' is-on' : ''}`}
          title={locked ? 'Unlock' : 'Lock'}
          aria-label={locked ? 'Unlock layer' : 'Lock layer'}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleLayerLock?.(layer.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {locked ? <LayerLockClosedIcon /> : <LayerLockOpenIcon />}
        </button>
        <button
          type="button"
          className={`layer-row-action${hidden ? ' is-on' : ''}`}
          title={hidden ? 'Show' : 'Hide'}
          aria-label={hidden ? 'Show layer' : 'Hide layer'}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleLayerVisible?.(layer.id)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {hidden ? <LayerEyeClosedIcon /> : <LayerEyeOpenIcon />}
        </button>
      </span>
    )
  }
  return (
    <>
      <div className="tree-head">
        <span>Pages</span>
        <span className="tree-head-actions">
          <button type="button" className="tree-search-icon" title="Search" aria-label="Search" disabled>
            <SearchIcon sx={{ fontSize: 16 }} />
          </button>
          <button type="button" title="New page" onClick={onAddPage}>
            <AddIcon sx={{ fontSize: 18 }} />
          </button>
        </span>
      </div>
      <div className="tree-list">
        {visiblePages.map((page) => (
          <button
            key={page.id}
            type="button"
            className={page.id === activePageId ? 'tree-row is-active' : 'tree-row'}
            onClick={() => onSelectPage(page.id)}
            onDoubleClick={() => {
              const name = window.prompt('Rename page', page.name)
              if (name?.trim()) onRenamePage(page.id, name.trim())
            }}
          >
            {page.name}
          </button>
        ))}
        {visiblePages.length === 0 && <p className="panel-empty">No pages</p>}
      </div>
      <div className="tree-head">
        <span>Layers</span>
      </div>
      <div className="tree-list">
        {layers.length === 0 && <p className="panel-empty">No layers on this page yet.</p>}
        {visibleLayers.map((layer) => {
          const rowClass = [
            'tree-row',
            'layer-row',
            layer.selected ? 'is-active' : '',
            layer.hidden ? 'is-hidden' : '',
            layer.locked ? 'is-locked' : ''
          ]
            .filter(Boolean)
            .join(' ')
          if (layer.textOnPath) {
            return (
              <div
                key={layer.id}
                role="button"
                tabIndex={0}
                className={rowClass}
                style={layer.depth ? { paddingLeft: 8 + layer.depth * 14 } : undefined}
                onClick={() => onSelectLayer(layer.id, layer.kind)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectLayer(layer.id, layer.kind)
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  openMenu(layer, event.currentTarget)
                }}
                onDoubleClick={() => {
                  const name = window.prompt('Rename', layer.name)
                  if (name?.trim()) onRenameLayer(layer.id, name.trim())
                }}
              >
                <IconTextOnPath size={16} />
                <span>{layer.name}</span>
                {layerActions(layer)}
              </div>
            )
          }
          const Icon = layer.vector ? VectorLayerIcon : LAYER_ICONS[layer.kind]
          return (
            <div
              key={layer.id}
              role="button"
              tabIndex={0}
              className={rowClass}
              style={layer.depth ? { paddingLeft: 8 + layer.depth * 14 } : undefined}
              onClick={() => onSelectLayer(layer.id, layer.kind)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectLayer(layer.id, layer.kind)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                openMenu(layer, event.currentTarget)
              }}
              onDoubleClick={() => {
                if (layer.kind === 'browser') return
                const name = window.prompt('Rename', layer.name)
                if (name?.trim()) onRenameLayer(layer.id, name.trim())
              }}
            >
              {layer.kind === 'section' ? <IconSection size={16} /> : <Icon sx={{ fontSize: 16 }} />}
              <span>{layer.name}</span>
              {layerActions(layer)}
            </div>
          )
        })}
      </div>
    </>
  )
}

function SidebarResizer({
  side,
  width,
  onResize,
  style
}: {
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
  style?: CSSProperties
}) {
  const drag = useRef({ x: 0, width: 0 })
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    drag.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - drag.current.x
    const next = side === 'left' ? drag.current.width + dx : drag.current.width - dx
    onResize(Math.min(720, Math.max(200, Math.round(next))))
  }
  return (
    <div
      className={`sidebar-resizer ${side}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    />
  )
}

export function RightSidebar({
  zoom,
  inspect,
  inspectOn,
  page,
  node,
  nodes = [],
  selectedIds = [],
  onAlign,
  onSpace,
  browser,
  tool,
  onPatchPage,
  onPatchNode,
  onPatchMany,
  onEnableAutoLayout,
  onReorderChildren,
  onPatchBrowser,
  onSpawnFrame,
  onSpawnBrowser,
  onZoom,
  onCopyLink,
  open,
  width,
  onToggle,
  onResize,
  commentsMode = false,
  commentsPanel = null,
  browserPanel = null,
  decisionsPanel = null,
  theme = 'light',
  hideExpandChip = false
}: {
  zoom: number
  inspect: InspectInfo | null
  inspectOn: boolean
  page: DesignPage
  node: DesignNode | null
  nodes?: DesignNode[]
  selectedIds?: string[]
  onAlign?: (action: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void
  onSpace?: (axis: 'x' | 'y', gap: number) => void
  browser: BrowserFrame | null
  tool?: DesignTool
  theme?: 'light' | 'dark'
  onPatchPage: (patch: Partial<DesignPage>) => void
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
  onPatchMany?: (patches: Array<{ id: string; patch: Partial<DesignNode> }>) => void
  onEnableAutoLayout?: (id: string, opts?: { mode?: 'horizontal' | 'vertical'; wrap?: boolean }) => void
  onReorderChildren?: (parentId: string, orderedChildIds: string[], parentPatch?: Partial<DesignNode>) => void
  onPatchBrowser: (id: string, patch: { x?: number; y?: number; width?: number; height?: number }) => void
  onSpawnFrame?: (preset: FramePreset) => void
  onSpawnBrowser?: (preset: FramePreset) => void
  onZoom: () => void
  onCopyLink: () => void
  open: boolean
  width: number
  onToggle: () => void
  onResize: (width: number) => void
  commentsMode?: boolean
  commentsPanel?: ReactNode
  browserPanel?: ReactNode
  /** When set (Jev mode), replaces the design inspector with the Decisions log. */
  decisionsPanel?: ReactNode
  hideExpandChip?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const gridPanel = useGridPanel()
  const gridFrame = gridPanel && node?.id === gridPanel.frameId && node.layout?.grid ? node : null
  useEffect(() => {
    if (gridPanel && !gridFrame) setGridPanel(null)
  }, [gridPanel, gridFrame])
  const openRef = useRef(open)
  const skipWidthSpring = open && openRef.current
  openRef.current = open
  const panelSpring = reduceMotion
    ? { duration: 0.01 }
    : skipWidthSpring
      ? { duration: 0 }
      : SIDEBAR_SPRING
  const chipSpring = reduceMotion ? { duration: 0.14 } : CHIP_EXPAND_SPRING
  const rightChipMotion = reduceMotion
    ? { initial: false as const, animate: { opacity: 1, scaleX: 1, scaleY: 1 }, exit: undefined }
    : {
        initial: { opacity: 0, scaleX: 0.28, scaleY: 0.9 },
        animate: { opacity: 1, scaleX: 1, scaleY: 1 },
        exit: { opacity: 0, scaleX: 0.28, scaleY: 0.9 }
      }

  if (browserPanel && open) {
    return (
      <motion.aside
        className="rightbar is-browser"
        initial={false}
        animate={{ width }}
        transition={panelSpring}
        style={{ overflow: 'hidden' }}
      >
        <SidebarResizer side="right" width={width} onResize={onResize} />
        <SidebarUiToggle side="right" expanded iconSize={18} className="chat-browser-min" onClick={onToggle} />
        {browserPanel}
      </motion.aside>
    )
  }

  return (
    <>
      <motion.aside
        className={`rightbar${open ? '' : ' is-collapsed'}`}
        initial={false}
        animate={{
          width: open ? width : 0,
          opacity: open ? 1 : 0
        }}
        transition={panelSpring}
        style={{ overflow: 'hidden', flexShrink: 0, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden={!open}
      >
        <div className="rightbar-inner" style={{ width }}>
          {open && <SidebarResizer side="right" width={width} onResize={onResize} />}
          <div className="rightbar-chrome">
            <div className="rightbar-chrome-row">
              <SidebarUiToggle side="right" expanded iconSize={18} onClick={onToggle} />
              <div className="rightbar-avatars" title="Account">
                <button type="button" className="rightbar-user">
                  <span className="avatar sm rightbar-avatar-secondary">J</span>
                  <IconCaret size={12} />
                </button>
              </div>
              <span className="rightbar-chrome-spacer" />
              <button type="button" className="rightbar-zoom" title="Reset zoom" onClick={onZoom}>
                {zoom}%
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M9.768 6.768a.5.5 0 0 1 .707.707l-2.12 2.121a.5.5 0 0 1-.708 0L5.525 7.475a.5.5 0 0 1 .708-.707l1.768 1.767z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="props" onKeyDown={stepNumberInput}>
            {commentsMode ? (
              commentsPanel
            ) : decisionsPanel ? (
              decisionsPanel
            ) : gridFrame ? (
              <GridPanel frame={gridFrame} nodes={nodes} onPatchNode={onPatchNode} onReorderChildren={onReorderChildren} />
            ) : (
              <DesignInspector
                page={page}
                node={node}
                nodes={nodes}
                selectedIds={selectedIds}
                onAlign={onAlign}
                onSpace={onSpace}
                browser={browser}
                inspect={inspect}
                inspectOn={inspectOn}
                tool={tool}
                theme={theme}
                onCopyLink={onCopyLink}
                onPatchPage={onPatchPage}
                onPatchNode={onPatchNode}
                onPatchMany={onPatchMany}
                onEnableAutoLayout={onEnableAutoLayout}
                onPatchBrowser={onPatchBrowser}
                onSpawnFrame={onSpawnFrame}
                onSpawnBrowser={onSpawnBrowser}
              />
            )}
          </div>
        </div>
      </motion.aside>
      <ShapeCaptureOverlay nodes={nodes} excludeIds={selectedIds} />
      <AnimatePresence>
        {!open && !hideExpandChip && (
          <motion.button
            type="button"
            key="right-ui-chip"
            className="sidebar-ui-chip right"
            title="Expand UI"
            aria-label="Expand UI"
            onClick={onToggle}
            initial={rightChipMotion.initial}
            animate={rightChipMotion.animate}
            exit={rightChipMotion.exit}
            transition={chipSpring}
          >
            <IconSidebarPanel side="right" size={17} />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}

type HomeNavId = 'recents' | 'files' | 'archive' | 'settings'

const HOME_RAIL_NARROW = 72
const HOME_RAIL_WIDE = 244

const HOME_NAV_PRIMARY: Array<{
  id: HomeNavId
  label: string
  icon: ComponentType<{ sx?: object }>
}> = [
  { id: 'recents', label: 'Recents', icon: AccessTimeIcon },
  { id: 'files', label: 'Files', icon: DescriptionOutlinedIcon },
  { id: 'archive', label: 'Archive', icon: Inventory2OutlinedIcon },
  { id: 'settings', label: 'Settings', icon: SettingsOutlinedIcon }
]

const HOME_FILE_OWNER = {
  name: CURRENT_USER.name,
  initial: CURRENT_USER.initial,
  color: CURRENT_USER.color,
  avatarUrl: CURRENT_USER.avatarUrl
}

const HOME_TEAMS = [
  { id: 'cce', name: 'CCE Website', plan: 'Free', color: '#e87a3a', initial: 'C' },
  {
    id: 'jesse',
    name: "Jesse Bishop's team",
    plan: 'Pro',
    color: CURRENT_USER.color,
    initial: CURRENT_USER.initial,
    active: true
  }
] as const

export function HomeScreen({
  files,
  onOpen,
  onNew,
  onCreateFromPrompt,
  theme,
  onToggleTheme
}: {
  files: ProjectFile[]
  onOpen: (id: string) => void
  onNew: () => void
  onCreateFromPrompt: (prompt: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const [nav, setNav] = useState<HomeNavId>('recents')
  const [railHover, setRailHover] = useState(false)
  const [search, setSearch] = useState('')
  const [teamOpen, setTeamOpen] = useState(false)
  const [activeTeamId, setActiveTeamId] = useState('jesse')
  const [prompt, setPrompt] = useState('')
  const [composerOpen, setComposerOpen] = useState(true)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const reduceMotion = useReducedMotion()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const promptInputRef = useRef<HTMLInputElement>(null)

  const hasSearchQuery = search.trim().length > 0
  // Stay open while hovering, team popup is open, or search has typed text.
  const expanded = railHover || teamOpen || hasSearchQuery || Boolean(reduceMotion)
  const canMake = prompt.trim().length > 0
  const activeTeam = HOME_TEAMS.find((team) => team.id === activeTeamId) || HOME_TEAMS[1]

  const sorted = [...files]
    .filter((file) => !search.trim() || file.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (b.editedAt || 0) - (a.editedAt || 0))

  const featured = sorted[0]
  const secondary = sorted.slice(1, 3)
  const rest = sorted.slice(3)

  useEffect(() => {
    if (!teamOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTeamOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [teamOpen])

  const selectNav = (id: HomeNavId) => {
    setTeamOpen(false)
    setNav(id)
  }

  const submitPrompt = () => {
    if (!canMake) return
    onCreateFromPrompt(prompt.trim())
    setPrompt('')
  }

  return (
    <div className="home">
      <div className="home-rail-slot" aria-hidden />
      <nav
        className={`home-rail${expanded ? ' is-expanded' : ' is-collapsed'}${hasSearchQuery ? ' is-searching' : ''}`}
        onPointerEnter={() => setRailHover(true)}
        onPointerLeave={() => setRailHover(false)}
        aria-label="Home"
        style={{ width: expanded ? HOME_RAIL_WIDE : HOME_RAIL_NARROW }}
      >
        <div className="home-rail-top">
          <div className="home-rail-brand">
            <span className="home-rail-brand-mark">
              <VantaMark size={22} />
            </span>
          </div>

          {expanded ? (
            <label className="home-rail-search">
              <span className="home-rail-icon">
                <SearchIcon sx={{ fontSize: 20 }} />
              </span>
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                spellCheck={false}
              />
              <button
                type="button"
                className="home-rail-search-clear"
                title="Clear search"
                onClick={() => setSearch('')}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </button>
            </label>
          ) : (
            <button type="button" className="home-rail-item home-rail-search-hit" title="Search">
              <span className="home-rail-pill" />
              <span className="home-rail-icon">
                <SearchIcon sx={{ fontSize: 20 }} />
              </span>
              <span className="home-rail-label">Search</span>
            </button>
          )}

          <div className="home-rail-list">
            {HOME_NAV_PRIMARY.map((item) => {
              const Icon = item.icon
              const active = nav === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={active ? 'home-rail-item is-on' : 'home-rail-item'}
                  onClick={() => selectNav(item.id)}
                  title={item.label}
                >
                  <span className="home-rail-pill" />
                  <span className="home-rail-icon">
                    <Icon sx={{ fontSize: 20 }} />
                  </span>
                  <span className="home-rail-label">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="home-rail-bottom">
          <button
            type="button"
            className="home-rail-item home-rail-theme"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          >
            <span className="home-rail-pill" />
            <span className="home-rail-icon">{theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}</span>
            <span className="home-rail-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button
            type="button"
            className={`home-rail-item home-rail-team${teamOpen ? ' is-on' : ''}`}
            title="Your team"
            aria-expanded={teamOpen}
            onClick={() => setTeamOpen((open) => !open)}
          >
            <span className="home-rail-pill" />
            <span className="home-rail-avatar" style={{ background: activeTeam.color }} aria-hidden>
              {activeTeam.initial}
            </span>
            <span className="home-rail-label home-rail-team-label">
              <span className="home-rail-team-name">{activeTeam.name}</span>
              <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
            </span>
          </button>
        </div>
      </nav>

      {teamOpen ? (
        <div
          className="ca-popup-backdrop home-team-backdrop"
          data-chrome-overlay=""
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setTeamOpen(false)
          }}
        >
          <div className="ca-popup-stage home-team-stage" data-chrome-overlay="">
            <div
              className="ca-popup"
              role="dialog"
              aria-modal="true"
              aria-labelledby="home-team-popup-title"
              data-chrome-overlay=""
            >
              <div className="ca-popup-title-row">
                <h2 id="home-team-popup-title">Your team</h2>
                <button
                  type="button"
                  className="ca-popup-close"
                  onClick={() => setTeamOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="ca-recent-list" aria-label="Workspaces">
                {HOME_TEAMS.map((team) => {
                  const selected = team.id === activeTeamId
                  return (
                    <button
                      key={team.id}
                      type="button"
                      className={`ca-menu-item home-team-item${selected ? ' active' : ''}`}
                      onClick={() => {
                        setActiveTeamId(team.id)
                        setTeamOpen(false)
                      }}
                    >
                      <span className="home-team-check" aria-hidden>
                        {selected ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
                      </span>
                      <span className="home-team-avatar" style={{ background: team.color }} aria-hidden>
                        {team.initial}
                      </span>
                      <span className="ca-recent-label">
                        <strong>{team.name}</strong>
                      </span>
                      <span className="home-team-plan">{team.plan}</span>
                    </button>
                  )
                })}
              </div>

              <div className="ca-menu-divider" />

              <button type="button" className="ca-menu-item">
                <span className="home-team-create-icon" aria-hidden>
                  <AddIcon sx={{ fontSize: 18 }} />
                </span>
                <span>Create new</span>
                <span className="ca-menu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="home-main">
        <div className="home-scroll">
          {composerOpen ? (
            <section className="home-composer">
              <div className="home-composer-head">
                <div className="home-composer-title">
                  <h1>Describe your idea and make it come to life</h1>
                  <span className="home-ai-badge">AI</span>
                </div>
                <button
                  type="button"
                  className="home-composer-close"
                  title="Dismiss"
                  onClick={() => setComposerOpen(false)}
                >
                  <CloseIcon sx={{ fontSize: 18 }} />
                </button>
              </div>
              <form
                className="home-composer-box"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitPrompt()
                }}
              >
                <input
                  ref={promptInputRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Build a virtual pet app with feeding and play actions."
                  spellCheck={false}
                />
                <button type="submit" className={`home-make-btn${canMake ? ' is-ready' : ''}`} disabled={!canMake}>
                  Make a file
                  <ArrowForwardIcon sx={{ fontSize: 16 }} />
                </button>
              </form>
            </section>
          ) : null}

          <div className="home-section-head">
            <h2 className="home-section-title">
              {nav === 'files' ? 'Files' : nav === 'archive' ? 'Archive' : nav === 'settings' ? 'Settings' : 'Recents'}
            </h2>
            <div className="home-layout-toggle">
              <button
                type="button"
                className={layout === 'grid' ? 'is-on' : ''}
                title="Grid"
                onClick={() => setLayout('grid')}
              >
                <ViewModuleIcon sx={{ fontSize: 18 }} />
              </button>
              <button
                type="button"
                className={layout === 'list' ? 'is-on' : ''}
                title="Show as list"
                onClick={() => setLayout('list')}
              >
                <ViewListIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          {nav === 'files' || nav === 'archive' || nav === 'settings' ? (
            <div className="home-empty">
              {nav === 'files' ? <DescriptionOutlinedIcon sx={{ fontSize: 28 }} /> : null}
              {nav === 'archive' ? <Inventory2OutlinedIcon sx={{ fontSize: 28 }} /> : null}
              {nav === 'settings' ? <SettingsOutlinedIcon sx={{ fontSize: 28 }} /> : null}
              <p>
                {nav === 'files'
                  ? 'Your files will show up here'
                  : nav === 'archive'
                    ? 'Archived files will show up here'
                    : 'Settings coming soon'}
              </p>
            </div>
          ) : sorted.length === 0 && search.trim() ? (
            <div className="home-empty">
              <p>No files match your search</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className={layout === 'list' ? 'home-labs-list' : 'home-labs-grid'}>
              <HomeLabsCard
                variant={layout === 'list' ? 'vert' : 'feature'}
                tone={0}
                seed="new"
                badge="NEW"
                title="Start a design"
                description="Create a blank file and bring your idea to life on the canvas."
                onClick={onNew}
              />
              {layout === 'grid' ? (
                <div className="home-labs-row">
                  <HomeLabsCard
                    variant="vert"
                    tone={1}
                    seed="board"
                    title="Board"
                    metaLabel="Template"
                    metaValue="Blank board"
                    onClick={onNew}
                  />
                  <HomeLabsCard
                    variant="vert"
                    tone={2}
                    seed="make"
                    title="Make with AI"
                    metaLabel="Template"
                    metaValue="Generate a file"
                    onClick={() => onCreateFromPrompt('Create an event management system with guest lists')}
                  />
                </div>
              ) : (
                <>
                  <HomeLabsCard
                    variant="vert"
                    tone={1}
                    seed="board"
                    title="Board"
                    metaLabel="Template"
                    metaValue="Blank board"
                    onClick={onNew}
                  />
                  <HomeLabsCard
                    variant="vert"
                    tone={2}
                    seed="make"
                    title="Make with AI"
                    metaLabel="Template"
                    metaValue="Generate a file"
                    onClick={() => onCreateFromPrompt('Create an event management system with guest lists')}
                  />
                </>
              )}
            </div>
          ) : layout === 'list' ? (
            <div className="home-labs-list">
              {sorted.map((file) => (
                <HomeLabsCard
                  key={file.id}
                  variant="vert"
                  tone={thumbTone(file.id)}
                  seed={file.id}
                  title={file.name}
                  metaLabel="Edited"
                  metaValue={formatEdited(file.editedAt)}
                  owner={HOME_FILE_OWNER}
                  isOpen
                  thumbnailUrl={fileThumbnailUrl(file, theme)}
                  thumbnailTheme={theme}
                  hasThemeThumb={fileHasThemeThumbnail(file, theme)}
                  onClick={() => onOpen(file.id)}
                />
              ))}
            </div>
          ) : (
            <div className="home-labs-grid">
              {featured ? (
                <HomeLabsCard
                  variant="feature"
                  tone={thumbTone(featured.id)}
                  seed={featured.id}
                  badge="RECENT"
                  title={featured.name}
                  description={`Edited ${formatEdited(featured.editedAt)}. Jump back in and keep designing.`}
                  owner={HOME_FILE_OWNER}
                  isOpen
                  thumbnailUrl={fileThumbnailUrl(featured, theme)}
                  thumbnailTheme={theme}
                  hasThemeThumb={fileHasThemeThumbnail(featured, theme)}
                  onClick={() => onOpen(featured.id)}
                />
              ) : null}

              {(secondary.length > 0 || sorted.length <= 1) && (
                <div className="home-labs-row">
                  {secondary.map((file) => (
                    <HomeLabsCard
                      key={file.id}
                      variant="vert"
                      tone={thumbTone(file.id)}
                      seed={file.id}
                      title={file.name}
                      metaLabel="Edited"
                      metaValue={formatEdited(file.editedAt)}
                      owner={HOME_FILE_OWNER}
                      isOpen
                      thumbnailUrl={fileThumbnailUrl(file, theme)}
                      thumbnailTheme={theme}
                      hasThemeThumb={fileHasThemeThumbnail(file, theme)}
                      onClick={() => onOpen(file.id)}
                    />
                  ))}
                  {secondary.length < 2 ? (
                    <HomeLabsCard
                      variant="vert"
                      tone={(secondary.length + 1) % 5}
                      seed={`new-${secondary.length}`}
                      title="New file"
                      metaLabel="Create"
                      metaValue="Start from scratch"
                      onClick={onNew}
                    />
                  ) : null}
                  {secondary.length === 0 ? (
                    <HomeLabsCard
                      variant="vert"
                      tone={3}
                      seed="ai"
                      title="Make with AI"
                      metaLabel="Create"
                      metaValue="Generate a starting point"
                      onClick={() => onCreateFromPrompt('Create a landing page with a hero and features')}
                    />
                  ) : null}
                </div>
              )}

              {rest.length > 0 ? (
                <div className="home-labs-more">
                  {rest.map((file) => (
                    <HomeLabsCard
                      key={file.id}
                      variant="vert"
                      tone={thumbTone(file.id)}
                      seed={file.id}
                      title={file.name}
                      metaLabel="Edited"
                      metaValue={formatEdited(file.editedAt)}
                      owner={HOME_FILE_OWNER}
                      isOpen
                      thumbnailUrl={fileThumbnailUrl(file, theme)}
                      thumbnailTheme={theme}
                      hasThemeThumb={fileHasThemeThumbnail(file, theme)}
                      onClick={() => onOpen(file.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HomeLabsCard({
  variant,
  tone,
  seed,
  badge,
  title,
  description,
  metaLabel,
  metaValue,
  owner,
  isOpen = false,
  thumbnailUrl,
  thumbnailTheme = 'light',
  hasThemeThumb = true,
  onClick
}: {
  variant: 'feature' | 'vert'
  tone: number
  seed: string
  badge?: string
  title: string
  description?: string
  metaLabel?: string
  metaValue?: string
  owner?: { name: string; initial: string; color: string; avatarUrl?: string }
  isOpen?: boolean
  thumbnailUrl?: string
  thumbnailTheme?: 'light' | 'dark'
  hasThemeThumb?: boolean
  onClick: () => void
}) {
  const ownerChip = owner ? (
    <span
      className="home-labs-owner"
      aria-label={owner.name}
      tabIndex={0}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="home-labs-owner-avatar" style={{ background: owner.color }} aria-hidden>
        {owner.avatarUrl ? <img src={owner.avatarUrl} alt="" /> : owner.initial}
      </span>
      <span className="home-labs-owner-name">{owner.name}</span>
    </span>
  ) : null

  return (
    <button
      type="button"
      className={`home-labs-card home-labs-card-${variant}${isOpen ? ' is-open' : ''}`}
      onClick={onClick}
    >
      <div className={`home-labs-media tone-${tone % 5}`}>
        {thumbnailUrl ? (
          <img
            className="home-labs-shot"
            key={`${thumbnailTheme}-${thumbnailUrl.slice(0, 64)}`}
            src={thumbnailUrl}
            alt=""
            draggable={false}
          />
        ) : (
          <FileThumbPreview seed={seed} name={title} />
        )}
      </div>
      <div className="home-labs-body">
        <div className="home-labs-copy">
          {badge ? <span className="home-labs-badge">{badge}</span> : null}
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
          {metaLabel || metaValue ? (
            <div className="home-labs-meta">
              {metaLabel ? <span className="home-labs-meta-label">{metaLabel}</span> : null}
              {metaValue ? <span className="home-labs-meta-value">{metaValue}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      {ownerChip}
    </button>
  )
}

function formatEdited(editedAt?: number): string {
  if (!editedAt) return 'just now'
  const delta = Math.max(0, Date.now() - editedAt)
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(editedAt).toLocaleDateString()
}

export function NewTabScreen({
  files,
  theme,
  onNewFile,
  onBrowse,
  onOpen
}: {
  files: ProjectFile[]
  theme: 'light' | 'dark'
  onNewFile: () => void
  onBrowse: () => void
  onOpen: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const sorted = [...files]
    .filter((file) => !search.trim() || file.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (b.editedAt || 0) - (a.editedAt || 0))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onNewFile()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNewFile])

  return (
    <div className="new-tab">
      <div className="new-tab-inner">
        <div className="new-tab-actions">
          <button type="button" className="new-tab-btn is-primary" onClick={onNewFile}>
            New file
            <span className="new-tab-shortcut">Ctrl + N</span>
          </button>
          <button type="button" className="new-tab-btn" onClick={onBrowse}>
            Browse all files
          </button>
        </div>

        <label className="new-tab-search">
          <SearchIcon sx={{ fontSize: 18 }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files"
            spellCheck={false}
          />
          <span className="new-tab-search-hint">Ctrl+F</span>
        </label>

        <div className="new-tab-list">
          {sorted.map((file) => {
            const thumb = fileThumbnailUrl(file, theme)
            return (
            <button
              key={file.id}
              type="button"
              className="new-tab-row"
              onClick={() => onOpen(file.id)}
            >
              <span className="new-tab-thumb">
                {thumb ? (
                  <img src={thumb} alt="" draggable={false} />
                ) : (
                  <FileThumbPreview seed={file.id} name={file.name} />
                )}
              </span>
              <span className="new-tab-row-name">{file.name}</span>
              <span className="new-tab-row-avatar" style={{ background: CURRENT_USER.color }} aria-hidden>
                {CURRENT_USER.initial}
              </span>
              <span className="new-tab-row-time">{formatEdited(file.editedAt)}</span>
            </button>
            )
          })}
          {sorted.length === 0 ? (
            <p className="new-tab-empty">{search.trim() ? 'No files match your search' : 'No recent files yet'}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function thumbTone(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * (i + 1)) % 5
  return hash
}

function FileThumbPreview({ seed, name }: { seed: string; name: string }) {
  const tone = thumbTone(seed)
  return (
    <div className="home-thumb-art" aria-hidden>
      <div className={`home-thumb-frame f-${tone}`}>
        <span />
        <span />
        <span />
      </div>
      <div className="home-thumb-label">{name.slice(0, 18)}</div>
    </div>
  )
}
