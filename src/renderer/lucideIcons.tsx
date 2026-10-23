import type { CSSProperties, ReactElement } from 'react'
import {
  Archive,
  ArrowRight,
  ArrowUp,
  AtSign,
  Blocks,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Focus,
  Frame,
  Globe,
  Grid3x3,
  Hand,
  Hash,
  Image,
  Keyboard,
  LayoutGrid,
  List,
  ListFilter,
  Lock,
  LockOpen,
  Maximize,
  Menu,
  MessageSquare,
  Mic,
  Minimize,
  Minus,
  MousePointer2,
  PencilLine,
  PenTool,
  Pipette,
  Plus,
  Ruler,
  Scaling,
  Search,
  Settings,
  Signature,
  Smile,
  Sparkle,
  Sparkles,
  Spline,
  Square,
  Star,
  Trash2,
  Triangle,
  Type,
  Undo2,
  WandSparkles,
  X,
  type LucideIcon
} from 'lucide-react'

/** Props the app passes to icons (kept compatible with the old Material icon call sites). */
export type IconProps = {
  sx?: { fontSize?: number | string; opacity?: number }
  fontSize?: number | 'inherit' | 'small' | 'medium' | 'large'
  size?: number | string
  className?: string
  style?: CSSProperties
  strokeWidth?: number
  /** Keep stroke in px when size changes — needed for optical toolbar sizing. */
  absoluteStrokeWidth?: boolean
  'aria-hidden'?: boolean
}

export type AppIcon = (props: IconProps) => ReactElement

const NAMED_SIZES = { inherit: '1em', small: 20, medium: 24, large: 35 } as const

function make(Lucide: LucideIcon, filled = false): AppIcon {
  return function Icon({
    sx,
    fontSize,
    size,
    className,
    style,
    strokeWidth = 1.75,
    absoluteStrokeWidth = false,
    ...rest
  }: IconProps) {
    const resolved =
      size ?? sx?.fontSize ?? (typeof fontSize === 'string' ? NAMED_SIZES[fontSize] : fontSize) ?? NAMED_SIZES.medium
    return (
      <Lucide
        size={resolved}
        strokeWidth={strokeWidth}
        absoluteStrokeWidth={absoluteStrokeWidth}
        fill={filled ? 'currentColor' : 'none'}
        className={className ? `vanta-icon ${className}` : 'vanta-icon'}
        style={sx?.opacity != null ? { opacity: sx.opacity, ...style } : style}
        aria-hidden={rest['aria-hidden'] ?? true}
      />
    )
  }
}

export const AccessTimeIcon = make(Clock)
export const AddIcon = make(Plus)
export const AlternateEmailIcon = make(AtSign)
export const ArrowForwardIcon = make(ArrowRight)
export const ArrowUpwardIcon = make(ArrowUp)
export const AutoAwesomeOutlinedIcon = make(Sparkles)
export const AutoFixHighOutlinedIcon = make(WandSparkles)
export const CenterFocusStrongIcon = make(Focus)
export const ChangeHistoryIcon = make(Triangle)
export const ChatBubbleOutlineOutlinedIcon = make(MessageSquare)
export const CheckIcon = make(Check)
export const CheckRoundedIcon = make(Check)
export const CircleOutlinedIcon = make(Circle)
export const CloseIcon = make(X)
export const CloseRoundedIcon = make(X)
export const ColorizeOutlinedIcon = make(Pipette)
export const ContentCopyIcon = make(Copy)
export const ContentCopyOutlinedIcon = make(Copy)
export const CropSquareIcon = make(Square)
export const DeleteOutlinedIcon = make(Trash2)
export const DeleteOutlineIcon = make(Trash2)
export const DescriptionOutlinedIcon = make(FileText)
export const DrawIcon = make(Spline)
/** Layers panel glyphs: SVG icons are vectors, bitmaps are images. */
export const VectorLayerIcon = make(PenTool)
export const ImageLayerIcon = make(Image)
export const DriveFileRenameOutlineOutlinedIcon = make(PencilLine)
export const EastIcon = make(ArrowRight)
export const FilterListIcon = make(ListFilter)
export const FilterNoneIcon = make(Copy)
export const FrameIcon = make(Frame)
export const FullscreenExitIcon = make(Minimize)
export const FullscreenIcon = make(Maximize)
export const GestureIcon = make(Signature)
export const GridOnIcon = make(Grid3x3)
export const HorizontalRuleIcon = make(Minus)
export const ImageOutlinedIcon = make(Image)
export const Inventory2OutlinedIcon = make(Archive)
export const KeyboardArrowDownIcon = make(ChevronDown)
export const KeyboardArrowRightIcon = make(ChevronRight)
export const KeyboardOutlinedIcon = make(Keyboard)
export const LanguageIcon = make(Globe)
export const LockOpenOutlinedIcon = make(LockOpen)
export const LockOutlinedIcon = make(Lock)
export const MenuRoundedIcon = make(Menu)
export const MicNoneOutlinedIcon = make(Mic)
export const MoreHorizIcon = make(Ellipsis)
export const NearMeIcon = make(MousePointer2)
export const NearMeOutlinedIcon = make(MousePointer2)
export const OpenInNewIcon = make(ExternalLink)
export const PanToolIcon = make(Hand)
export const PhotoCameraOutlinedIcon = make(Camera)
export const RemoveIcon = make(Minus)
export const SearchIcon = make(Search)
export const SentimentSatisfiedAltIcon = make(Smile)
export const SparkleIcon = make(Sparkle)
export const SettingsOutlinedIcon = make(Settings)
export const StarBorderIcon = make(Star)
export const StopRoundedIcon = make(Square, true)
export const StraightenIcon = make(Ruler)
export const TagIcon = make(Frame)
export const TagOutlinedIcon = make(Hash)
export const TitleIcon = make(Type)
export const UndoRoundedIcon = make(Undo2)
export const ViewListIcon = make(List)
export const ViewModuleIcon = make(LayoutGrid)
export const WidgetsOutlinedIcon = make(Blocks)
export const ZoomOutMapIcon = make(Scaling)
