import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import NearMeIcon from '@mui/icons-material/NearMe'
import PanToolIcon from '@mui/icons-material/PanTool'
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap'
import LanguageIcon from '@mui/icons-material/Language'
import TagIcon from '@mui/icons-material/Tag'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
import EastIcon from '@mui/icons-material/East'
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined'
import ChangeHistoryIcon from '@mui/icons-material/ChangeHistory'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import TitleIcon from '@mui/icons-material/Title'
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import StraightenIcon from '@mui/icons-material/Straighten'
import WidgetsOutlinedIcon from '@mui/icons-material/WidgetsOutlined'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import type { BrushStyleId, DesignTool, ShapeKind, SwitchMode } from '../shared/types'
import { brushById, brushPreviewD, STRETCH_BRUSHES } from './drawBrushes'
import { IconFigmaBrush, IconFigmaPen, IconFigmaPencil, IconSection, IconTextOnPath } from './icons'
import { ChatComposer } from './ChatView'
import { ModeSwitch } from './ModeSwitch'

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
  { id: 'text-on-path', label: 'Text on path', shortcut: '', Icon: IconTextOnPath }
]

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
  onComposerSend
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
}) {
  const [menu, setMenu] = useState<'shape' | 'cursor' | 'brushes' | 'text' | 'frame' | null>(null)
  const [composerFocused, setComposerFocused] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const ShapeIcon = SHAPES.find((item) => item.id === shape)?.Icon || CropSquareIcon
  const CursorIcon = CURSOR.find((item) => item.id === tool)?.Icon || NearMeIcon
  const TextTool = TEXT_TOOLS.find((item) => item.id === tool) || TEXT_TOOLS[0]
  const textActive = tool === 'text' || tool === 'text-on-path'
  const frameActive = tool === 'frame' || tool === 'section'
  const cursorActive = tool === 'pointer' || tool === 'hand' || tool === 'scale'
  const drawing = tool === 'pen' || tool === 'pencil' || tool === 'brush'
  const toolset = mode === 'draw' ? 'draw' : 'design'
  const composerOpen = true

  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  useEffect(() => {
    setMenu(null)
  }, [mode])

  return (
    <div ref={root} className="canvas-toolbar-stack" onPointerDown={(event) => event.stopPropagation()}>
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
      <motion.div
        className={`canvas-toolbar-shell${composerOpen ? ' is-composer-open' : ''}`}
        layout
        transition={{ type: 'spring', stiffness: 460, damping: 38, mass: 0.65 }}
      >
        <div className="canvas-toolbar">
          <div className="canvas-toolbar-tools">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={toolset}
                className="canvas-toolbar-group"
                initial={{ opacity: 0, x: toolset === 'draw' ? 14 : -14, filter: 'blur(6px)' }}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, x: toolset === 'draw' ? -14 : 14, filter: 'blur(6px)' }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
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
                  {menu === 'cursor' && (
                    <div className="shape-menu">
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
                    </div>
                  )}
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
                  {menu === 'frame' && (
                    <div className="shape-menu">
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
                    </div>
                  )}
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
                  {menu === 'shape' && (
                    <div className="shape-menu">
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
                    </div>
                  )}
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
                  {menu === 'text' && (
                    <div className="shape-menu">
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
                            {item.id === 'text-on-path' ? <Icon /> : <Icon sx={{ fontSize: 18 }} />}
                            <span>{item.label}</span>
                            {item.shortcut ? <em>{item.shortcut}</em> : null}
                          </button>
                        )
                      })}
                    </div>
                  )}
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
              </motion.div>
            </AnimatePresence>
          </div>
          <ModeSwitch mode={mode} onMode={onMode} />
        </div>
        <motion.div
          className="toolbar-composer"
          layout
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          onFocusCapture={() => setComposerFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setComposerFocused(false)
            }
          }}
        >
          <div className="toolbar-composer-inner">
            <ChatComposer
              value={composerValue}
              onChange={onComposerChange}
              onSend={onComposerSend}
              busy={composerBusy}
              compact
              autoFocus={composerFocused}
              placeholder="Plan, search, build anything"
            />
          </div>
        </motion.div>
      </motion.div>
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
      <input
        className="draw-weight-num"
        type="number"
        min={1}
        max={400}
        value={Math.round(weight)}
        onChange={(event) => onWeight(Math.max(1, Number(event.target.value) || 1))}
      />
      <input
        className="draw-weight-range"
        type="range"
        min={1}
        max={200}
        value={Math.min(200, weight)}
        onChange={(event) => onWeight(Number(event.target.value))}
      />
      <button type="button" className={open ? 'draw-style-btn is-on' : 'draw-style-btn'} onClick={onToggle}>
        <BrushPreview style={style} color={color} />
        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
      </button>
      {open && (
        <div className="brush-picker">
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
        </div>
      )}
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
