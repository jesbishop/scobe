import { useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ViewModuleIcon from '@mui/icons-material/ViewModule'
import ViewListIcon from '@mui/icons-material/ViewList'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FilterNoneIcon from '@mui/icons-material/FilterNone'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
import EastIcon from '@mui/icons-material/East'
import ChangeHistoryIcon from '@mui/icons-material/ChangeHistory'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import TitleIcon from '@mui/icons-material/Title'
import DrawIcon from '@mui/icons-material/Draw'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined'
import LanguageIcon from '@mui/icons-material/Language'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import type { BrowserFrame, DesignNode, DesignPage, DesignTool, InspectInfo } from '../shared/types'
import type { FramePreset } from '../shared/framePresets'
import { DesignInspector } from './DesignInspector'
import { TabFavicon } from './tabFavicon'
import { CodingAgentsPopup } from './CodingAgentsPopup'
import { type CodingAgentBinding, type CodingAgentId } from '../shared/codingAgents'
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
  IconSun,
  IconTextOnPath,
  type IconProps
} from './icons'

export type RailTab = 'file' | 'chat' | 'search' | 'coding-agents' | 'tabs' | 'variables'

export type ProjectFile = { id: string; name: string; editedAt?: number }

export type LayerItem = {
  id: string
  kind: 'frame' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'star' | 'path' | 'text' | 'comment' | 'widget' | 'browser' | 'section' | 'image'
  name: string
  selected: boolean
  textOnPath?: boolean
  depth?: number
}

const LAYER_ICONS: Record<LayerItem['kind'], typeof FilterNoneIcon | typeof IconSection> = {
  frame: FilterNoneIcon,
  section: IconSection as typeof FilterNoneIcon,
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
  image: CropSquareIcon,
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
  { id: 'variables', label: 'Variables', icon: IconNavVariables }
]

export function FileTabs({
  files,
  activeId,
  onHome,
  onSelect,
  onClose,
  onNew,
  onRename
}: {
  files: ProjectFile[]
  activeId: string
  onHome: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string) => void
}) {
  return (
    <header className="file-tabs">
      <button type="button" className="file-tab home-tab" title="Recents" onClick={onHome}>
        <IconHome size={18} />
      </button>
      <div className="file-tabs-list">
        {files.map((file) => (
          <div
            key={file.id}
            className={file.id === activeId ? 'file-tab active' : 'file-tab'}
            onClick={() => onSelect(file.id)}
            onDoubleClick={() => {
              const name = window.prompt('Rename file', file.name)
              if (name?.trim()) onRename(file.id, name.trim())
            }}
          >
            <span className="file-tab-icon">
              <IconNavFile size={16} />
            </span>
            <span className="file-tab-name">{file.name}</span>
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
        <button type="button" className="file-tabs-new" title="New file" onClick={onNew}>
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
  browsers,
  onAddBrowser,
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
  panelOpen,
  panelWidth,
  onTogglePanel,
  onResizePanel,
  codingActive,
  codingRecents,
  codingPopup,
  codingFullscreen,
  onCodingPopup,
  onCodingChoose,
  onCodingResume,
  onCodingFullscreen,
  onAgentHole
}: {
  tab: RailTab
  onTab: (tab: RailTab) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  fileName: string
  browsers: BrowserFrame[]
  onAddBrowser: () => void
  onFocusWindow: (id: string) => void
  onActivateTab: (windowId: string, tabId: string) => void
  onCloseTab: (windowId: string, tabId: string) => void
  chats: Array<{ id: string; title: string }>
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
  panelOpen: boolean
  panelWidth: number
  onTogglePanel: () => void
  onResizePanel: (width: number) => void
  codingActive: CodingAgentBinding | null
  codingRecents: CodingAgentBinding[]
  codingPopup: boolean
  codingFullscreen: boolean
  onCodingPopup: (open: boolean) => void
  onCodingChoose: (agentId: CodingAgentId) => void
  onCodingResume: (id: string) => void
  onCodingFullscreen: () => void
  onAgentHole: (el: HTMLDivElement | null) => void
}) {
  const [fsHint, setFsHint] = useState(false)
  const fsHintTimer = useRef<number | null>(null)
  const codingSidebar = Boolean(codingActive && tab === 'coding-agents')

  const showFsHint = () => {
    if (!codingSidebar) return
    if (fsHintTimer.current != null) {
      window.clearTimeout(fsHintTimer.current)
      fsHintTimer.current = null
    }
    setFsHint(true)
  }

  const hideFsHint = () => {
    if (fsHintTimer.current != null) window.clearTimeout(fsHintTimer.current)
    fsHintTimer.current = window.setTimeout(() => {
      fsHintTimer.current = null
      setFsHint(false)
    }, 220)
  }

  return (
    <aside
      className={`leftbar${codingSidebar ? ' has-coding-agent' : ''}${codingFullscreen ? ' has-agent-full' : ''}${fsHint ? ' show-fs-hint' : ''}`}
      onMouseEnter={showFsHint}
      onMouseLeave={hideFsHint}
    >
      <nav className="leftbar-rail">
        <div className="leftbar-rail-top">
          {RAIL.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={`rail-item${tab === item.id ? ' active' : ''}${item.wide ? ' wide-label' : ''}${item.id === 'variables' ? ' rail-item-after-sep' : ''}`}
                onClick={() => {
                  if (item.id === 'coding-agents') {
                    onTab('coding-agents')
                    if (!codingActive || tab === 'coding-agents') onCodingPopup(true)
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
      <div
        className={
          panelOpen
            ? `leftbar-panel${tab === 'coding-agents' ? ' coding-agents-panel' : ''}${codingFullscreen ? ' is-agent-full' : ''}`
            : `leftbar-panel is-collapsed${tab === 'coding-agents' ? ' coding-agents-panel' : ''}${codingFullscreen ? ' is-agent-full' : ''}`
        }
        style={{ width: panelOpen ? panelWidth : 0 }}
      >
        {tab !== 'coding-agents' && (
          <div className="leftbar-filehead">
            <div className="leftbar-filemeta">
              <div className="leftbar-filename">
                <span className="leftbar-filename-text">{fileName}</span>
                <IconCaret size={12} />
              </div>
              <div className="leftbar-fileloc">Drafts</div>
            </div>
            <button type="button" className="sidebar-min" title="Hide sidebar" onClick={onTogglePanel}>
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
            </button>
          </div>
        )}
        {tab === 'file' && (
          <div className="leftbar-body pages-layers">
            <button type="button" className="panel-primary" onClick={onAddBrowser}>
              Add browser
            </button>
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
            />
          </div>
        )}
        {tab === 'chat' && (
          <div className="leftbar-chat-list">
            <div className="chat-list-head">
              <span>Chats</span>
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
                  {chat.title}
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
        {tab === 'coding-agents' && (
          codingActive ? (
            <CodingAgentPanel
              fullscreen={codingFullscreen}
              onFullscreen={onCodingFullscreen}
              onHole={onAgentHole}
            />
          ) : (
            <div className="leftbar-body">
              <div className="panel-kicker">Coding agents</div>
              <p className="panel-empty">Pick Claude Code, Cursor, Codex, or v0. Their real site opens here in the sidebar.</p>
              <button type="button" className="panel-primary" onClick={() => onCodingPopup(true)}>
                Open coding agent
              </button>
            </div>
          )
        )}
        {tab === 'tabs' && (
          <div className="leftbar-body">
            <div className="panel-kicker">Open tabs</div>
            {browsers.flatMap((frame) =>
              frame.tabs.map((item) => (
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
                    className="panel-tab-close"
                    title="Close tab"
                    onClick={() => onCloseTab(frame.id, item.id)}
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              ))
            )}
            {browsers.length === 0 && <p className="panel-empty">No browser tabs yet.</p>}
          </div>
        )}
        {tab === 'variables' && (
          <div className="leftbar-body">
            <div className="panel-kicker">Color</div>
            <div className="var-row">
              <span className="swatch" style={{ background: '#EEEEEE' }} />
              <span>Canvas</span>
              <span className="muted">#EEEEEE</span>
            </div>
            <div className="var-row">
              <span className="swatch" style={{ background: '#0D99FF' }} />
              <span>Accent</span>
              <span className="muted">#0D99FF</span>
            </div>
            <p className="panel-note">Design tokens and variables will be editable here.</p>
          </div>
        )}
      </div>
      {panelOpen && <SidebarResizer side="left" width={panelWidth} onResize={onResizePanel} />}
      {!panelOpen && (
        <button type="button" className="sidebar-expand left" title="Show sidebar" onClick={onTogglePanel}>
          <ChevronRightIcon sx={{ fontSize: 18 }} />
        </button>
      )}
      <CodingAgentsPopup
        open={codingPopup}
        recents={codingRecents}
        activeId={codingActive?.id || null}
        onClose={() => onCodingPopup(false)}
        onResume={onCodingResume}
        onChoose={onCodingChoose}
      />
    </aside>
  )
}

function CodingAgentPanel({
  fullscreen,
  onFullscreen,
  onHole
}: {
  fullscreen: boolean
  onFullscreen: () => void
  onHole: (el: HTMLDivElement | null) => void
}) {
  return (
    <div className={`ca-panel ca-panel-browser${fullscreen ? ' is-full' : ''}`}>
      <div className="ca-chrome-host live" ref={onHole} />
      <button
        type="button"
        className="ca-fs-popup"
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
        onClick={onFullscreen}
      >
        {fullscreen ? <FullscreenExitIcon sx={{ fontSize: 18 }} /> : <FullscreenIcon sx={{ fontSize: 18 }} />}
        <span>{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
      </button>
    </div>
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
  onRenameLayer
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
}) {
  const visiblePages = pages.filter((page) => page.name.toLowerCase().includes(pageQuery.trim().toLowerCase()))
  return (
    <>
      <div className="tree-head">
        <span>Pages</span>
        <span className="tree-head-actions">
          <label className="tree-search">
            <SearchIcon sx={{ fontSize: 16 }} />
            <input value={pageQuery} placeholder="Search" onChange={(event) => onPageQuery(event.target.value)} />
          </label>
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
        {layers.map((layer) => {
          if (layer.textOnPath) {
            return (
              <button
                key={layer.id}
                type="button"
                className={layer.selected ? 'tree-row layer-row is-active' : 'tree-row layer-row'}
                style={layer.depth ? { paddingLeft: 8 + layer.depth * 14 } : undefined}
                onClick={() => onSelectLayer(layer.id, layer.kind)}
                onDoubleClick={() => {
                  const name = window.prompt('Rename', layer.name)
                  if (name?.trim()) onRenameLayer(layer.id, name.trim())
                }}
              >
                <IconTextOnPath size={16} />
                <span>{layer.name}</span>
              </button>
            )
          }
          const Icon = LAYER_ICONS[layer.kind]
          return (
            <button
              key={layer.id}
              type="button"
              className={layer.selected ? 'tree-row layer-row is-active' : 'tree-row layer-row'}
              style={layer.depth ? { paddingLeft: 8 + layer.depth * 14 } : undefined}
              onClick={() => onSelectLayer(layer.id, layer.kind)}
              onDoubleClick={() => {
                if (layer.kind === 'browser') return
                const name = window.prompt('Rename', layer.name)
                if (name?.trim()) onRenameLayer(layer.id, name.trim())
              }}
            >
              {layer.kind === 'section' ? <IconSection size={16} /> : <Icon sx={{ fontSize: 16 }} />}
              <span>{layer.name}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function SidebarResizer({
  side,
  width,
  onResize
}: {
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
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
  return <div className={`sidebar-resizer ${side}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} />
}

export function RightSidebar({
  zoom,
  inspect,
  inspectOn,
  page,
  node,
  browser,
  tool,
  onPatchPage,
  onPatchNode,
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
  browserPanel = null
}: {
  zoom: number
  inspect: InspectInfo | null
  inspectOn: boolean
  page: DesignPage
  node: DesignNode | null
  browser: BrowserFrame | null
  tool?: DesignTool
  onPatchPage: (patch: Partial<DesignPage>) => void
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
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
}) {
  if (!open) {
    return (
      <button type="button" className="sidebar-expand right" title="Show sidebar" onClick={onToggle}>
        <ChevronLeftIcon sx={{ fontSize: 18 }} />
      </button>
    )
  }
  if (browserPanel) {
    return (
      <aside className="rightbar is-browser" style={{ width }}>
        {open && <SidebarResizer side="right" width={width} onResize={onResize} />}
        <button type="button" className="chat-browser-min" title="Hide sidebar" onClick={onToggle}>
          <ChevronRightIcon sx={{ fontSize: 18 }} />
        </button>
        {browserPanel}
      </aside>
    )
  }
  return (
    <aside className="rightbar" style={{ width }}>
      {open && <SidebarResizer side="right" width={width} onResize={onResize} />}
      <div className="rightbar-chrome">
        <div className="rightbar-chrome-row">
          <button type="button" className="sidebar-min" title="Hide sidebar" onClick={onToggle}>
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </button>
          <button type="button" className="rightbar-user" title="Account">
            <span className="avatar sm rightbar-avatar">J</span>
            <IconCaret size={12} />
          </button>
          <button type="button" className="rightbar-zoom" title="Reset zoom" onClick={onZoom}>
            {zoom}%
          </button>
        </div>
        <button type="button" className="rightbar-copy-link" onClick={onCopyLink}>
          <span>Copy link</span>
          <kbd>Ctrl + L</kbd>
        </button>
      </div>
      <div className="props">
        {commentsMode ? (
          commentsPanel
        ) : (
          <DesignInspector
            page={page}
            node={node}
            browser={browser}
            inspect={inspect}
            inspectOn={inspectOn}
            tool={tool}
            onPatchPage={onPatchPage}
            onPatchNode={onPatchNode}
            onPatchBrowser={onPatchBrowser}
            onSpawnFrame={onSpawnFrame}
            onSpawnBrowser={onSpawnBrowser}
          />
        )}
      </div>
    </aside>
  )
}

export function HomeScreen({
  files,
  onOpen,
  onNew,
  onCreateFromPrompt
}: {
  files: ProjectFile[]
  onOpen: (id: string) => void
  onNew: () => void
  onCreateFromPrompt: (prompt: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [composerOpen, setComposerOpen] = useState(true)
  const [tab, setTab] = useState<'recent' | 'shared-files' | 'shared-folders'>('recent')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const canMake = prompt.trim().length > 0
  const sorted = [...files].sort((a, b) => (b.editedAt || 0) - (a.editedAt || 0))

  return (
    <div className="home">
      <div className="home-scroll">
        {composerOpen && (
          <section className="home-composer">
            <div className="home-composer-head">
              <div className="home-composer-title">
                <h1>Describe your idea and make it come to life</h1>
                <span className="home-ai-badge">AI</span>
              </div>
              <button type="button" className="home-composer-close" title="Dismiss" onClick={() => setComposerOpen(false)}>
                <CloseIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
            <form
              className="home-composer-box"
              onSubmit={(event) => {
                event.preventDefault()
                if (!canMake) return
                onCreateFromPrompt(prompt.trim())
                setPrompt('')
              }}
            >
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Build a mind mapping tool with branching nodes and customization…"
              />
              <button type="submit" className={`home-make-btn${canMake ? ' is-ready' : ''}`} disabled={!canMake}>
                Make a file
                <ArrowForwardIcon sx={{ fontSize: 16 }} />
              </button>
            </form>
          </section>
        )}

        <div className="home-toolbar">
          <div className="home-tabs">
            {(
              [
                { id: 'recent', label: 'Recently viewed' },
                { id: 'shared-files', label: 'Shared files' },
                { id: 'shared-folders', label: 'Shared folders' }
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? 'is-on' : ''}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="home-filters">
            <button type="button" className="home-filter-chip">
              All files
              <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
            </button>
            <div className="home-layout-toggle">
              <button type="button" className={layout === 'grid' ? 'is-on' : ''} title="Grid" onClick={() => setLayout('grid')}>
                <ViewModuleIcon sx={{ fontSize: 18 }} />
              </button>
              <button type="button" className={layout === 'list' ? 'is-on' : ''} title="List" onClick={() => setLayout('list')}>
                <ViewListIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
            <button type="button" className="home-new-file" onClick={onNew}>
              <AddIcon sx={{ fontSize: 18 }} />
              New file
            </button>
          </div>
        </div>

        {tab === 'shared-folders' ? (
          <div className="home-empty">
            <FolderOutlinedIcon sx={{ fontSize: 28 }} />
            <p>No shared folders yet</p>
          </div>
        ) : tab === 'shared-files' && sorted.length === 0 ? (
          <div className="home-empty">
            <p>No shared files yet</p>
          </div>
        ) : (
          <div className={layout === 'grid' ? 'home-grid' : 'home-list'}>
            {sorted.map((file) => (
              <button key={file.id} type="button" className="home-file-card" onClick={() => onOpen(file.id)}>
                <div className={`home-file-thumb tone-${thumbTone(file.id)}`}>
                  <FileThumbPreview seed={file.id} name={file.name} />
                </div>
                <div className="home-file-meta">
                  <span className="home-file-icon" aria-hidden>
                    <IconNavFile size={14} />
                  </span>
                  <div className="home-file-copy">
                    <strong>{file.name}</strong>
                    <em>Edited {formatEdited(file.editedAt)}</em>
                  </div>
                  <span className="home-file-avatar" title="You">
                    J
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
