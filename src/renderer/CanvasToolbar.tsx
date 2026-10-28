import { paintPreviewCss, type Paint } from '../shared/paint'
import { createPortal } from 'react-dom'
import { FillPicker } from './FillPicker'
import { Undo2, Redo2 } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { VectorLayerIcon, SearchIcon, ImageLayerIcon, SettingsOutlinedIcon, ViewListIcon, DrawIcon, ChangeHistoryIcon, ChatBubbleOutlineOutlinedIcon, CheckIcon, CircleOutlinedIcon, CloseIcon, CropSquareIcon, EastIcon, HorizontalRuleIcon, KeyboardArrowDownIcon, LanguageIcon, NearMeIcon, PanToolIcon, StarBorderIcon, StraightenIcon, TagIcon, TitleIcon, WidgetsOutlinedIcon, ZoomOutMapIcon } from './lucideIcons'
import type { BrushStyleId, DesignTool, ShapeKind, SwitchMode } from '../shared/types'
import { brushById, brushPreviewD, STRETCH_BRUSHES } from './drawBrushes'
import { IconFigmaBrush, IconFigmaPen, IconFigmaPencil, IconCreateSvg, IconPaperShaders, IconSection, IconTextOnPath } from './icons'
import { ChatComposer, type JevComposerProps } from './ChatView'
import { ChatSuggestionGlyph, ChatSuggestionPopup, CHAT_SUGGESTIONS } from './ChatSuggestionPopup'
import { ModeSwitch } from './ModeSwitch'
import { SliderField, StrokeWeightIcon } from './InspectorFields'
import { setDocumentShaderKinds, ShaderFillsPopup } from './ShaderFillsPopup'
import type { ShaderKind } from '../shared/paint'

const CURSOR: Array<{ id: 'pointer' | 'hand' | 'scale'; label: string; shortcut: string; Icon: typeof NearMeIcon }> = [
  { id: 'pointer', label: 'Move', shortcut: 'V', Icon: NearMeIcon },
  { id: 'hand', label: 'Hand', shortcut: 'H', Icon: PanToolIcon },
  { id: 'scale', label: 'Scale', shortcut: 'K', Icon: ZoomOutMapIcon }
]

const FRAME_TOOLS: Array<{ id: 'frame' | 'section'; label: string; shortcut: string }> = [
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'section', label: 'Section', shortcut: '⇧S' }
]

const SHAPES: Array<{ id: ShapeKind; label: string; shortcut: string; Icon: typeof CropSquareIcon }> = [
  { id: 'rect', label: 'Rectangle', shortcut: 'R', Icon: CropSquareIcon },
  { id: 'line', label: 'Line', shortcut: 'L', Icon: HorizontalRuleIcon },
  { id: 'arrow', label: 'Arrow', shortcut: '⇧L', Icon: EastIcon },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', Icon: CircleOutlinedIcon },
  { id: 'polygon', label: 'Polygon', shortcut: '', Icon: ChangeHistoryIcon },
  { id: 'star', label: 'Star', shortcut: '', Icon: StarBorderIcon }
]

const TEXT_TOOLS: Array<{
  id: 'text' | 'text-on-path'
  label: string
  shortcut: string
  Icon: typeof TitleIcon | typeof IconTextOnPath
}> = [
  { id: 'text', label: 'Text', shortcut: 'T', Icon: TitleIcon },
  { id: 'text-on-path', label: 'Text on path', shortcut: '⇧T', Icon: IconTextOnPath }
]

const MODE_ORDER: Record<SwitchMode, number> = { draw: 0, design: 1, chat: 2 }

const TOOLSET_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }
const COMPOSER_TRANSITION = { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const }

const toolsetVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: 14 * direction
  }),
  center: {
    opacity: 1,
    x: 0
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: -14 * direction
  })
}

export function CanvasToolbar({
  tool,
  shape,
  mode,
  strokeColor, instrumentColors, drawingPaint, onDrawingPaint,
  strokeWeight,
  brushStyle,
  composerValue,
  composerBusy,
  onTool,
  onShape,
  onMode,
  onStrokeColor,
  onStrokeWeight,
  onBrushStyle,
  onComposerChange,
  onComposerSend,
  onSuggestion,
  showComposer = true,
  onChromeChange,
  inFileShaders,
  onSelectShader,
  jevComposer,
  composerExtra,
  createSvgActive = false,
  onCreateSvg, onUndo, onRedo, canUndo = false, canRedo = false
}: {
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  tool: DesignTool
  shape: ShapeKind
  mode: SwitchMode
  drawingPaint?: Paint
  onDrawingPaint?: (paint: Paint) => void
  instrumentColors?: { pen: string; pencil: string; brush: string }
  strokeColor: string
  strokeWeight: number
  brushStyle: BrushStyleId
  composerValue: string
  composerBusy: boolean
  onTool: (tool: DesignTool) => void
  onShape: (shape: ShapeKind) => void
  onMode: (mode: SwitchMode) => void
  onStrokeColor: (color: string) => void
  onStrokeWeight: (weight: number) => void
  onBrushStyle: (style: BrushStyleId) => void
  onComposerChange: (value: string) => void
  onComposerSend: () => void
  onSuggestion?: (text: string) => void
  showComposer?: boolean
  onChromeChange?: () => void
  inFileShaders?: ShaderKind[]
  onSelectShader?: (kind: ShaderKind) => void
  jevComposer?: JevComposerProps
  composerExtra?: ReactNode
  createSvgActive?: boolean
  onCreateSvg?: () => void
}) {
  const [menu, setMenu] = useState<'shape' | 'cursor' | 'brushes' | 'text' | 'frame' | 'shaders' | 'widgets' | null>(null)
  useLayoutEffect(() => {
    const host = root.current
    if (!host) return
    let frame = 0
    const position = () => {
      const toolbar = host.querySelector('.canvas-toolbar')
      if (!toolbar) return
      const bounds = toolbar.getBoundingClientRect()
      for (const popup of host.querySelectorAll<HTMLElement>('.shape-menu, .brush-picker, .shader-fills-popup:not(.is-beside), .chat-suggestion-popup, .widgets-popup')) {
        popup.style.maxWidth = Math.max(0, bounds.width) + 'px'
        popup.style.boxSizing = 'border-box'
        const rect = popup.getBoundingClientRect()
        const previous = Number(popup.dataset.toolbarShift || 0)
        const correction = rect.left < bounds.left ? bounds.left - rect.left : rect.right > bounds.right ? bounds.right - rect.right : 0
        if (Math.abs(correction) > 0.25) {
          const shift = previous + correction
          popup.dataset.toolbarShift = String(shift)
          popup.style.marginLeft = shift + 'px'
        }
      }
    }
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position) }
    const observer = new MutationObserver(update)
    observer.observe(host, { childList: true, subtree: true })
    const resize = new ResizeObserver(update)
    resize.observe(host)
    window.addEventListener('resize', update)
    position()
    // Recheck after entrance motion reaches its final dimensions.
    const timer = window.setTimeout(position, 250)
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); window.removeEventListener('resize', update) }
  }, [menu])
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerVisible, setComposerVisible] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const prevModeRef = useRef(mode)
  const reduceMotion = useReducedMotion()
  const direction = MODE_ORDER[mode] >= MODE_ORDER[prevModeRef.current] ? 1 : -1
  const [lastCursor, setLastCursor] = useState<DesignTool>('pointer')
  const [lastFrame, setLastFrame] = useState<DesignTool>('frame')
  const [lastText, setLastText] = useState<DesignTool>('text')
  const selectedCursor = CURSOR.some(item => item.id === tool) ? tool : lastCursor
  const selectedFrame = FRAME_TOOLS.some(item => item.id === tool) ? tool : lastFrame
  const selectedText = TEXT_TOOLS.some(item => item.id === tool) ? tool : lastText
  useEffect(() => {
    if (CURSOR.some(item => item.id === tool)) setLastCursor(tool)
    if (FRAME_TOOLS.some(item => item.id === tool)) setLastFrame(tool)
    if (TEXT_TOOLS.some(item => item.id === tool)) setLastText(tool)
  }, [tool])
  const ShapeIcon = SHAPES.find((item) => item.id === shape)?.Icon || CropSquareIcon
  const CursorIcon = CURSOR.find((item) => item.id === selectedCursor)?.Icon || NearMeIcon
  const TextTool = TEXT_TOOLS.find((item) => item.id === selectedText) || TEXT_TOOLS[0]
  const textActive = tool === 'text' || tool === 'text-on-path'
  const frameActive = tool === 'frame' || tool === 'section'
  const cursorActive = tool === 'pointer' || tool === 'hand' || tool === 'scale'
  const drawing = tool === 'pen' || tool === 'pencil' || tool === 'brush'
  const toolset = mode === 'draw' ? 'draw' : mode === 'chat' ? 'chat' : 'design'
  const hasComposerExtra = Boolean(composerExtra)
  const composerOpen = showComposer && (composerVisible || hasComposerExtra)

  useEffect(() => {
    prevModeRef.current = mode
  }, [mode])

  useEffect(() => {
    setDocumentShaderKinds(inFileShaders || [])
  }, [inFileShaders])

  useEffect(() => {
    onChromeChange?.()
    const frame = requestAnimationFrame(() => onChromeChange?.())
    return () => cancelAnimationFrame(frame)
  }, [menu, chatMenuOpen, drawing, toolset, showComposer, composerVisible, hasComposerExtra, onChromeChange])

  useEffect(() => {
    if (!menu && !chatMenuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setMenu(null)
        setChatMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu, chatMenuOpen])

  useEffect(() => {
    setMenu(null)
    setChatMenuOpen(false)
  }, [mode])

  useEffect(() => {
    if (hasComposerExtra) setComposerVisible(true)
  }, [hasComposerExtra])

  return (
    <div ref={root} className="canvas-toolbar-inner" onPointerDown={(event) => event.stopPropagation()}>
      {drawing && mode === 'draw' && (
        <DrawStrokeBar
          showStyles={tool !== 'pen'}
          paint={drawingPaint} onPaint={onDrawingPaint}
          color={strokeColor}
          weight={strokeWeight}
          style={brushStyle}
          open={menu === 'brushes'}
          onColor={onStrokeColor}
          onWeight={onStrokeWeight}
          onStyle={onBrushStyle}
          onToggle={() => setMenu((value) => (value === 'brushes' ? null : 'brushes'))}
          onClose={() => setMenu(null)}
        />
      )}
      <div className={`canvas-toolbar-shell${composerOpen ? ' is-composer-open' : ''}`}>
        <div className={`canvas-toolbar${mode === 'chat' ? ' is-chat-only' : ''}`}>
          <div className="canvas-toolbar-tools">
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={toolset}
                className={mode === 'chat' ? 'canvas-toolbar-suggestions' : 'canvas-toolbar-group'}
                custom={direction}
                variants={toolsetVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={TOOLSET_TRANSITION}
              >
                {mode === 'chat' ? (
                  <>
                    {CHAT_SUGGESTIONS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="chat-suggestion-pill"
                        onClick={() => {
                          setChatMenuOpen(false)
                          onSuggestion?.(item.prompt)
                        }}
                      >
                        <ChatSuggestionGlyph item={item} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                    <div className={`chat-suggestion-menu${chatMenuOpen ? ' is-open' : ''}`}>
                      <button
                        type="button"
                        className={`chat-suggestion-caret${chatMenuOpen ? ' is-on' : ''}`}
                        title="More suggestions"
                        aria-label="Open suggestions menu"
                        aria-expanded={chatMenuOpen}
                        onClick={() => {
                          setMenu(null)
                          setChatMenuOpen((value) => !value)
                        }}
                      >
                        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                      </button>
                      <ChatSuggestionPopup
                        open={chatMenuOpen}
                        onClose={() => setChatMenuOpen(false)}
                        onSelect={(prompt) => onSuggestion?.(prompt)}
                      />
                    </div>
                    {onCreateSvg ? (
                      <ToolButton
                        active={createSvgActive}
                        title="Create SVG"
                        onClick={() => {
                          setChatMenuOpen(false)
                          onCreateSvg()
                        }}
                      >
                        <IconCreateSvg size={20} />
                      </ToolButton>
                    ) : null}
                  </>
                ) : (
                  <>
                <div className="tool-split">
                  <ToolButton
                    active={cursorActive}
                    title={CURSOR.find((item) => item.id === tool)?.label || 'Move'}
                    onClick={() => {
                      onTool(cursorActive ? tool : 'pointer')
                      setMenu(null)
                    }}
                  >
                    <CursorIcon sx={{ fontSize: 20 }} />
                  </ToolButton>
                  <button
                    type="button"
                    className={menu === 'cursor' ? 'tool-caret-btn is-on' : 'tool-caret-btn'}
                    title="Move menu"
                    onClick={() => setMenu((value) => (value === 'cursor' ? null : 'cursor'))}
                  >
                    <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                  </button>
                  <ToolbarFlyout open={menu === 'cursor'} className="shape-menu" label="Move tools">
                      {CURSOR.map((item) => {
                        const Icon = item.Icon
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={selectedCursor === item.id ? 'is-on' : ''}
                            onClick={() => {
                              onTool(item.id)
                              setMenu(null)
                            }}
                          >
                            {selectedCursor === item.id ? <CheckIcon sx={{ fontSize: 16 }} /> : <span className="shape-check" />}
                            <Icon sx={{ fontSize: 18 }} />
                            <span>{item.label}</span>
                            <em>{item.shortcut}</em>
                          </button>
                        )
                      })}
                    </ToolbarFlyout>
                </div>

                {toolset === 'draw' ? (
                  <>
                    <ToolButton active={tool === 'pen'} title="Pen (P)" onClick={() => onTool('pen')}>
                      <IconFigmaPen inkColor={instrumentColors?.pen || '#000000'} />
                    </ToolButton>
                    <ToolButton active={tool === 'brush'} title="Brush" onClick={() => onTool('brush')}>
                      <IconFigmaBrush inkColor={instrumentColors?.brush || '#000000'} />
                    </ToolButton>
                    <ToolButton active={tool === 'pencil'} title="Pencil (Shift+P)" onClick={() => onTool('pencil')}>
                      <IconFigmaPencil inkColor={instrumentColors?.pencil || '#000000'} />
                    </ToolButton>
                  </>
                ) : null}

                <div className="tool-split">
                  <ToolButton
                    active={frameActive}
                    title={selectedFrame === 'section' ? 'Section (Shift+S)' : 'Frame (F)'}
                    onClick={() => {
                      onTool(selectedFrame)
                      setMenu(null)
                    }}
                  >
                    {selectedFrame === 'section' ? <IconSection size={20} /> : <TagIcon sx={{ fontSize: 20 }} />}
                  </ToolButton>
                  <button
                    type="button"
                    className={menu === 'frame' ? 'tool-caret-btn is-on' : 'tool-caret-btn'}
                    title="Frame menu"
                    onClick={() => {
                      setMenu((value) => (value === 'frame' ? null : 'frame'))
                    }}
                  >
                    <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                  </button>
                  <ToolbarFlyout open={menu === 'frame'} className="shape-menu" label="Frame tools">
                      {FRAME_TOOLS.map((item) => {
                        const active = selectedFrame === item.id
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={active ? 'is-on' : ''}
                            onClick={() => {
                              onTool(item.id)
                              setMenu(null)
                            }}
                          >
                            {active ? <CheckIcon sx={{ fontSize: 16 }} /> : <span className="shape-check" />}
                            {item.id === 'section' ? <IconSection size={18} /> : <TagIcon sx={{ fontSize: 18 }} />}
                            <span>{item.label}</span>
                            <em>{item.shortcut}</em>
                          </button>
                        )
                      })}
                    </ToolbarFlyout>
                </div>

                {toolset === 'design' ? (
                  <ToolButton active={tool === 'browser'} title="Browser" onClick={() => onTool('browser')}>
                    <LanguageIcon sx={{ fontSize: 20 }} />
                  </ToolButton>
                ) : null}

                <div className="tool-split">
                  <ToolButton
                    active={tool === 'shape'}
                    title="Shape"
                    onClick={() => {
                      onTool('shape')
                      setMenu(null)
                    }}
                  >
                    <ShapeIcon sx={{ fontSize: 20 }} />
                  </ToolButton>
                  <button
                    type="button"
                    className={menu === 'shape' ? 'tool-caret-btn is-on' : 'tool-caret-btn'}
                    title="Shape menu"
                    onClick={() => {
                      onTool('shape')
                      setMenu((value) => (value === 'shape' ? null : 'shape'))
                    }}
                  >
                    <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                  </button>
                  <ToolbarFlyout open={menu === 'shape'} className="shape-menu" label="Shapes">
                      {SHAPES.map((item) => {
                        const Icon = item.Icon
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={shape === item.id ? 'is-on' : ''}
                            onClick={() => {
                              onShape(item.id)
                              onTool('shape')
                              setMenu(null)
                            }}
                          >
                            {shape === item.id ? <CheckIcon sx={{ fontSize: 16 }} /> : <span className="shape-check" />}
                            <Icon sx={{ fontSize: 18 }} />
                            <span>{item.label}</span>
                            {item.shortcut ? <em>{item.shortcut}</em> : null}
                          </button>
                        )
                      })}
                    </ToolbarFlyout>
                </div>



                <div className="tool-split">
                  <ToolButton
                    active={textActive}
                    title={TextTool.label}
                    onClick={() => {
                      onTool(selectedText)
                      setMenu(null)
                    }}
                  >
                    {TextTool.id === 'text-on-path' ? <IconTextOnPath /> : <TitleIcon sx={{ fontSize: 20 }} />}
                  </ToolButton>
                  <button
                    type="button"
                    className={menu === 'text' ? 'tool-caret-btn is-on' : 'tool-caret-btn'}
                    title="Text menu"
                    onClick={() => {
                      setMenu((value) => (value === 'text' ? null : 'text'))
                    }}
                  >
                    <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                  </button>
                  <ToolbarFlyout open={menu === 'text'} className="shape-menu" label="Text tools">
                      {TEXT_TOOLS.map((item) => {
                        const Icon = item.Icon
                        const active = selectedText === item.id
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={active ? 'is-on' : ''}
                            onClick={() => {
                              onTool(item.id)
                              setMenu(null)
                            }}
                          >
                            {active ? <CheckIcon sx={{ fontSize: 16 }} /> : <span className="shape-check" />}
                            <Icon size={18} />
                            <span>{item.label}</span>
                            {item.shortcut ? <em>{item.shortcut}</em> : null}
                          </button>
                        )
                      })}
                    </ToolbarFlyout>
                </div>

                <ToolButton active={tool === 'comment'} title="Comments" onClick={() => onTool('comment')}>
                  <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 20 }} />
                </ToolButton>
                {toolset === 'design' ? (
                  <ToolButton active={tool === 'measure'} title="Measure" onClick={() => onTool('measure')}>
                    <StraightenIcon sx={{ fontSize: 20 }} />
                  </ToolButton>
                ) : null}
                <div className="tool-split">
                  <ToolButton active={menu === 'widgets'} title="Widgets" onClick={() => setMenu(value => value === 'widgets' ? null : 'widgets')}>
                    <WidgetsOutlinedIcon sx={{ fontSize: 20 }} />
                  </ToolButton>
                  <ToolbarFlyout open={menu === 'widgets'} className="widgets-popup" label="Widgets">
                    <WidgetsMenu />
                  </ToolbarFlyout>
                </div>
                {onCreateSvg ? (
                  <ToolButton
                    active={createSvgActive}
                    title="Create SVG"
                    onClick={() => {
                      setMenu(null)
                      onCreateSvg()
                    }}
                  >
                    <IconCreateSvg size={20} />
                  </ToolButton>
                ) : null}
                {toolset === 'design' ? (
                  <div className="tool-split shader-tool-split">
                    <ToolButton
                      active={menu === 'shaders'}
                      title="Shader fills"
                      onClick={() => setMenu((value) => (value === 'shaders' ? null : 'shaders'))}
                    >
                      <IconPaperShaders size={20} />
                    </ToolButton>
                    <ShaderFillsPopup
                      open={menu === 'shaders'}
                      selectedKind={null}
                      inFileKinds={inFileShaders || []}
                      onClose={() => setMenu(null)}
                      onSelect={(kind) => {
                        onSelectShader?.(kind)
                        setMenu(null)
                      }}
                    />
                  </div>
                ) : null}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="canvas-toolbar-end">
            {showComposer ? (
              <button
                type="button"
                className={`composer-toggle${composerOpen ? ' is-on' : ''}`}
                title={
                  hasComposerExtra ? 'Composer stays open for Create SVG' : composerOpen ? 'Hide composer' : 'Show composer'
                }
                aria-label={composerOpen ? 'Hide composer' : 'Show composer'}
                aria-pressed={composerOpen}
                disabled={hasComposerExtra}
                onClick={() => {
                  setMenu(null)
                  setChatMenuOpen(false)
                  setComposerVisible((value) => !value)
                }}
              >
                <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
              </button>
            ) : null}
            <button type="button" className="canvas-history-btn" title="Undo (Ctrl/⌘ Z)" aria-label="Undo canvas change" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button>
            <button type="button" className="canvas-history-btn" title="Redo (Ctrl/⌘ Shift Z)" aria-label="Redo canvas change" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>
            <ModeSwitch mode={mode} onMode={onMode} />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {composerOpen ? (
            <motion.div
              key="toolbar-composer"
              className="toolbar-composer-motion"
              initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={COMPOSER_TRANSITION}
              onUpdate={() => onChromeChange?.()}
            >
              <div
                className="toolbar-composer"
                onFocusCapture={() => setComposerFocused(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setComposerFocused(false)
                  }
                }}
              >
                <div className="toolbar-composer-inner">
                  {composerExtra}
                  {!composerExtra ? (
                    <ChatComposer
                      value={composerValue}
                      onChange={onComposerChange}
                      onSend={onComposerSend}
                      busy={composerBusy}
                      compact
                      autoFocus={composerFocused}
                      placeholder="Send follow-up"
                      jev={jevComposer}
                    />
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DrawStrokeBar({
  color, paint, onPaint, showStyles = true,
  weight,
  style,
  open,
  onColor,
  onWeight,
  onStyle,
  onToggle,
  onClose
}: {
  paint?: Paint
  onPaint?: (paint: Paint) => void
  showStyles?: boolean
  color: string
  weight: number
  style: BrushStyleId
  open: boolean
  onColor: (color: string) => void
  onWeight: (weight: number) => void
  onStyle: (style: BrushStyleId) => void
  onToggle: () => void
  onClose: () => void
}) {
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null)
  const colorButton = useRef<HTMLButtonElement>(null)
  const styles = [{ id: 'basic' as const, name: 'Basic' }, ...STRETCH_BRUSHES]
  return (
    <div className="draw-stroke-bar">
      <button type="button" ref={colorButton} className="draw-color" title="Drawing color" aria-label="Drawing color" aria-expanded={Boolean(colorAnchor)} onMouseDown={event => event.stopPropagation()} onClick={() => setColorAnchor(value => value ? null : colorButton.current!.getBoundingClientRect())}><span style={{ background: paint ? paintPreviewCss(paint) : color }} /></button>
      {colorAnchor && createPortal(<FillPicker above strokeMode opaque canvasHandles={false} anchor={colorAnchor} paint={paint || { type:'solid', color, opacity:1 }} onChange={next => { if (onPaint) onPaint(next); else if (next.type === 'solid') onColor(next.color) }} onClose={() => setColorAnchor(null)} />, document.body)}
      <div className="draw-weight" title="Weight">
        <SliderField
          icon={<StrokeWeightIcon />}
          value={weight}
          min={1}
          max={Math.max(200, Math.ceil(weight))}
          onChange={(next) => onWeight(Math.max(1, Math.min(400, next)))}
        />
      </div>
      <button style={!showStyles ? { display: 'none' } : undefined} type="button" className={open ? 'draw-style-btn is-on' : 'draw-style-btn'} onClick={onToggle}>
        <BrushPreview style={style} color={color} paint={paint} />
        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
      </button>
      <ToolbarFlyout open={showStyles && open} className="brush-picker" label="Brushes">
          <div className="brush-picker-head">
            <strong>Brushes</strong>
            <button type="button" onClick={onClose} title="Close">
              <CloseIcon sx={{ fontSize: 16 }} />
            </button>
          </div>
          <div className="brush-picker-label">Stretch brushes</div>
          <div className="brush-picker-list">
            {styles.map((item) => {
              const active = style === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={active ? 'is-on' : ''}
                  onClick={() => {
                    onStyle(item.id)
                    onClose()
                  }}
                >
                  {active ? <CheckIcon sx={{ fontSize: 16 }} /> : <span className="shape-check" />}
                  <span className="brush-picker-copy">
                    <em>{item.name}</em>
                    <BrushPreview style={item.id} color={color} paint={paint} />
                  </span>
                </button>
              )
            })}
          </div>
      </ToolbarFlyout>
    </div>
  )
}

function BrushPreview({ style, color, paint }: { style: BrushStyleId; color: string; paint?: Paint }) {
  const gradientId = useId().replace(/:/g, '')
  const gradient = paint?.type === 'gradient' ? paint : null
  const fills = brushPreviewD(style, brushById(style).id === 'basic' ? 5 : 9)
  return (
    <svg className="brush-preview" viewBox="0 0 108 28" width="92" height="24" aria-hidden="true">
      {gradient && <defs><linearGradient id={gradientId}>{gradient.stops.map(stop => <stop key={stop.id} offset={stop.position} stopColor={stop.color} stopOpacity={stop.opacity * gradient.opacity} />)}</linearGradient></defs>}
      {fills.map((d, index) => (
        <path key={index} d={d} fill={gradient ? 'url(#' + gradientId + ')' : color} />
      ))}
    </svg>
  )
}

function ToolbarFlyout({
  open,
  className,
  label,
  children
}: {
  open: boolean
  className: string
  label: string
  children: ReactNode
}) {
  const reduceMotion = useReducedMotion()
  const spring = reduceMotion
    ? { duration: 0.1 }
    : { type: 'spring' as const, stiffness: 480, damping: 34, mass: 0.7 }
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={className}
          data-chrome-overlay=""
          role="menu"
          aria-label={label}
          initial={reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 4, scale: 0.99, x: '-50%' }}
          animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
          exit={reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 3, scale: 0.995, x: '-50%' }}
          transition={spring}
          style={{ transformOrigin: 'bottom center' }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function ToolButton({
  active,
  title,
  onClick,
  children
}: {
  active: boolean
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={active ? 'is-on' : ''} title={title} onClick={onClick}>
      {children}
    </button>
  )
}

const WIDGET_GROUPS = [
  { title: 'Design helpers', items: ['Rename layers', 'Make an image'] },
  { title: 'Image editing', items: ['Edit image with prompt', 'Remove background', 'Boost resolution'] },
  { title: 'Design tools', items: ['Replace content', 'Add interactions'] },
  { title: 'Riffing and writing', items: ['Rewrite this…', 'Shorten', 'Translate to…'] }
]
const WIDGET_RECENTS_KEY = 'scobe:widget-recents:v1'
const WIDGET_NAMES = new Set(WIDGET_GROUPS.flatMap(group => group.items))
function readWidgetRecents(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(WIDGET_RECENTS_KEY) || '[]')
    return Array.isArray(saved) ? [...new Set(saved.filter((item): item is string => typeof item === 'string' && WIDGET_NAMES.has(item)))].slice(0, 3) : []
  } catch { return [] }
}
function WidgetGlyph({ name }: { name: string }) {
  const Icon = name === 'Rename layers' ? ViewListIcon
    : name.includes('image') || name === 'Remove background' ? ImageLayerIcon
    : name === 'Translate to…' ? LanguageIcon
    : name === 'Add interactions' ? EastIcon
    : name === 'Replace content' ? SettingsOutlinedIcon
    : name === 'Boost resolution' ? ZoomOutMapIcon : DrawIcon
  return <Icon sx={{ fontSize: 16 }} />
}
function WidgetsMenu() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('All')
  const [notice, setNotice] = useState('')
  const [recents, setRecents] = useState(readWidgetRecents)
  const groups = recents.length ? [{ title: 'Recents', items: recents }, ...WIDGET_GROUPS] : WIDGET_GROUPS
  const choose = (item: string) => {
    const next = [item, ...recents.filter(recent => recent !== item)].slice(0, 3)
    setRecents(next)
    try { localStorage.setItem(WIDGET_RECENTS_KEY, JSON.stringify(next)) } catch { /* Session history remains available. */ }
    setNotice(item + ' is coming soon.')
  }
  return <>
    <div className="widgets-search"><SearchIcon sx={{ fontSize: 16 }} /><input aria-label="Search widgets" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} /><ImageLayerIcon sx={{ fontSize: 16 }} /></div>
    <div className="widgets-tabs" role="tablist" aria-label="Widget categories">{['All', 'Assets', 'Plugins & widgets'].map(item => <button type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'is-on' : ''} key={item} onClick={() => { setTab(item); setNotice('') }}>{item}</button>)}</div>
    <div className="widgets-list">{tab === 'Assets' ? <p className="widgets-empty">Your assets will appear here.</p> : groups.map(group => {
      const items = group.items.filter(item => item.toLowerCase().includes(query.toLowerCase()))
      return items.length ? <section key={group.title}><h3>{group.title}</h3>{items.map(item => <button type="button" key={item} onClick={() => choose(item)}><span className="widgets-glyph" aria-hidden><WidgetGlyph name={item} /></span><span>{item}</span><em>AI</em></button>)}</section> : null
    })}{tab !== 'Assets' && !groups.some(group => group.items.some(item => item.toLowerCase().includes(query.toLowerCase()))) && <p className="widgets-empty">No matching widgets.</p>}</div>
    {notice && <div className="widgets-notice" role="status">{notice}</div>}
  </>
}
