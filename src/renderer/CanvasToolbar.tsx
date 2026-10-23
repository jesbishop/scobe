import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChangeHistoryIcon, ChatBubbleOutlineOutlinedIcon, CheckIcon, CircleOutlinedIcon, CloseIcon, CropSquareIcon, EastIcon, HorizontalRuleIcon, KeyboardArrowDownIcon, LanguageIcon, NearMeIcon, PanToolIcon, StarBorderIcon, StraightenIcon, TagIcon, TitleIcon, WidgetsOutlinedIcon, ZoomOutMapIcon } from './lucideIcons'
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
  strokeColor,
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
  onCreateSvg
}: {
  tool: DesignTool
  shape: ShapeKind
  mode: SwitchMode
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
  const [menu, setMenu] = useState<'shape' | 'cursor' | 'brushes' | 'text' | 'frame' | 'shaders' | null>(null)
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerVisible, setComposerVisible] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const prevModeRef = useRef(mode)
  const reduceMotion = useReducedMotion()
  const direction = MODE_ORDER[mode] >= MODE_ORDER[prevModeRef.current] ? 1 : -1
  const ShapeIcon = SHAPES.find((item) => item.id === shape)?.Icon || CropSquareIcon
  const CursorIcon = CURSOR.find((item) => item.id === tool)?.Icon || NearMeIcon
  const TextTool = TEXT_TOOLS.find((item) => item.id === tool) || TEXT_TOOLS[0]
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
      {drawing && tool !== 'pen' && mode === 'draw' && (
        <DrawStrokeBar
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
                            className={tool === item.id ? 'is-on' : ''}
                            onClick={() => {
                              onTool(item.id)
                              setMenu(null)
                            }}
                          >
                            {tool === item.id ? <CheckIcon sx={{ fontSize: 16 }} /> : <span className="shape-check" />}
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
                      <IconFigmaPen />
                    </ToolButton>
                    <ToolButton active={tool === 'brush'} title="Brush" onClick={() => onTool('brush')}>
                      <IconFigmaBrush />
                    </ToolButton>
                    <ToolButton active={tool === 'pencil'} title="Pencil (Shift+P)" onClick={() => onTool('pencil')}>
                      <IconFigmaPencil />
                    </ToolButton>
                  </>
                ) : null}

                <div className="tool-split">
                  <ToolButton
                    active={frameActive}
                    title={tool === 'section' ? 'Section (Shift+S)' : 'Frame (F)'}
                    onClick={() => {
                      onTool(frameActive ? tool : 'frame')
                      setMenu(null)
                    }}
                  >
                    {tool === 'section' ? <IconSection size={20} /> : <TagIcon sx={{ fontSize: 20 }} />}
                  </ToolButton>
                  <button
                    type="button"
                    className={menu === 'frame' ? 'tool-caret-btn is-on' : 'tool-caret-btn'}
                    title="Frame menu"
                    onClick={() => {
                      if (!frameActive) onTool('frame')
                      setMenu((value) => (value === 'frame' ? null : 'frame'))
                    }}
                  >
                    <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                  </button>
                  <ToolbarFlyout open={menu === 'frame'} className="shape-menu" label="Frame tools">
                      {FRAME_TOOLS.map((item) => {
                        const active = tool === item.id
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

                {toolset === 'design' ? (
                  <ToolButton active={tool === 'pen'} title="Pen (P)" onClick={() => onTool('pen')}>
                    <IconFigmaPen />
                  </ToolButton>
                ) : null}

                <div className="tool-split">
                  <ToolButton
                    active={textActive}
                    title={TextTool.label}
                    onClick={() => {
                      onTool(textActive ? tool : 'text')
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
                      if (!textActive) onTool('text')
                      setMenu((value) => (value === 'text' ? null : 'text'))
                    }}
                  >
                    <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
                  </button>
                  <ToolbarFlyout open={menu === 'text'} className="shape-menu" label="Text tools">
                      {TEXT_TOOLS.map((item) => {
                        const Icon = item.Icon
                        const active = tool === item.id
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
                <ToolButton active={tool === 'widget'} title="Widgets" onClick={() => onTool('widget')}>
                  <WidgetsOutlinedIcon sx={{ fontSize: 20 }} />
                </ToolButton>
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
  color,
  weight,
  style,
  open,
  onColor,
  onWeight,
  onStyle,
  onToggle,
  onClose
}: {
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
  const styles = [{ id: 'basic' as const, name: 'Basic' }, ...STRETCH_BRUSHES]
  return (
    <div className="draw-stroke-bar">
      <label className="draw-color">
        <span style={{ background: color }} />
        <input type="color" value={color} onChange={(event) => onColor(event.target.value)} />
      </label>
      <div className="draw-weight" title="Weight">
        <SliderField
          icon={<StrokeWeightIcon />}
          value={weight}
          min={1}
          max={Math.max(200, Math.ceil(weight))}
          onChange={(next) => onWeight(Math.max(1, Math.min(400, next)))}
        />
      </div>
      <button type="button" className={open ? 'draw-style-btn is-on' : 'draw-style-btn'} onClick={onToggle}>
        <BrushPreview style={style} color={color} />
        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
      </button>
      <ToolbarFlyout open={open} className="brush-picker" label="Brushes">
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
                    <BrushPreview style={item.id} color="#111111" />
                  </span>
                </button>
              )
            })}
          </div>
      </ToolbarFlyout>
    </div>
  )
}

function BrushPreview({ style, color }: { style: BrushStyleId; color: string }) {
  const fills = brushPreviewD(style, brushById(style).id === 'basic' ? 5 : 9)
  return (
    <svg className="brush-preview" viewBox="0 0 108 28" width="92" height="24" aria-hidden="true">
      {fills.map((d, index) => (
        <path key={index} d={d} fill={color} />
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
          initial={reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 10, scale: 0.96, x: '-50%' }}
          animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
          exit={reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 6, scale: 0.98, x: '-50%' }}
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
