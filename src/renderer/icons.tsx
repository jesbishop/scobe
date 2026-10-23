import type { CSSProperties, ReactNode, SVGProps } from 'react'
import logoMarkUrl from './assets/vanta-mark.png'
import logoWordmarkUrl from './assets/vanta-logo.png'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({
  size = 16,
  viewBox,
  children,
  ...props
}: IconProps & { viewBox: string; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="8 8 16 16" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.5 15.5V10.5H16.5V15.5H21.5V16.5H16.5V21.5H15.5V16.5H10.5V15.5H15.5Z"
        fill="currentColor"
      />
    </Icon>
  )
}

export function IconClose({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="8 8 16 16" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 15.293L20.6465 10.6465L21.3536 11.3536L16.7071 16.0001L21.3536 20.6465L20.6465 21.3536L16 16.7072L11.3536 21.3536L10.6465 20.6465L15.2929 16.0001L10.6465 11.3537L11.3536 10.6466L16 15.293Z"
        fill="currentColor"
      />
    </Icon>
  )
}

export function IconHome({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M4.5 11.2 12 5.2l7.5 6V20a1 1 0 0 1-1 1h-4.2v-5.3h-4.6V21H5.5a1 1 0 0 1-1-1v-8.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

export function IconNavFile({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="6.5 6.75 19 18.5" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 8.5H10.5H17.5H17.7071L17.8536 8.64645L21.8536 12.6464L22 12.7929V13V23V23.5H21.5H10.5H10V23V9V8.5ZM11 9.5V22.5H21V13.5H17.5H17V13V9.5H11ZM18 10.2071L20.2929 12.5H18V10.2071Z"
        fill="currentColor"
      />
    </Icon>
  )
}

export function IconNavChat({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M12 4.2c.34 4.7 2.93 7.28 7.63 7.62-4.7.34-7.29 2.93-7.63 7.63-.34-4.7-2.93-7.29-7.63-7.63 4.7-.34 7.29-2.93 7.63-7.62Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

export function IconNavSearch({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="8 8 16 16" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M19.1034 15.0517C19.1034 17.0133 17.5133 18.6034 15.5517 18.6034C13.5902 18.6034 12 17.0133 12 15.0517C12 13.0902 13.5902 11.5 15.5517 11.5C17.5133 11.5 19.1034 13.0902 19.1034 15.0517ZM18.3972 18.6046C17.6179 19.2296 16.6285 19.6034 15.5517 19.6034C13.0379 19.6034 11 17.5656 11 15.0517C11 12.5379 13.0379 10.5 15.5517 10.5C18.0656 10.5 20.1034 12.5379 20.1034 15.0517C20.1034 16.1286 19.7295 17.1181 19.1044 17.8975L22.3535 21.1467L21.6464 21.8538L18.3972 18.6046Z"
        fill="currentColor"
      />
    </Icon>
  )
}

export function IconNavTabs({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 16 16" {...props}>
      <circle cx="8" cy="8" r="5.1" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="8" cy="8" rx="2.05" ry="5.1" stroke="currentColor" strokeWidth="1" />
      <path d="M2.9 8h10.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </Icon>
  )
}

export function IconNavVariables({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M12 3.8 20.2 12 12 20.2 3.8 12 12 3.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </Icon>
  )
}

export function IconCodingAgents() {
  return (
    <span className="rail-favicons" aria-hidden="true">
      <img
        className="rail-favicon"
        src="https://www.google.com/s2/favicons?domain=claude.ai&sz=128"
        alt=""
        onError={(event) => {
          event.currentTarget.src = 'https://www.google.com/s2/favicons?domain=anthropic.com&sz=128'
        }}
      />
      <img
        className="rail-favicon"
        src="https://www.cursor.com/apple-touch-icon.png"
        alt=""
        onError={(event) => {
          event.currentTarget.src = 'https://www.google.com/s2/favicons?domain=cursor.com&sz=128'
        }}
      />
      <img
        className="rail-favicon"
        src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=128"
        alt=""
        onError={(event) => {
          event.currentTarget.src = 'https://chatgpt.com/favicon.ico'
        }}
      />
      <img
        className="rail-favicon"
        src="https://v0.app/apple-icon.png"
        alt=""
        onError={(event) => {
          event.currentTarget.src = 'https://www.google.com/s2/favicons?domain=v0.dev&sz=128'
        }}
      />
    </span>
  )
}

export function IconHistory({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8.2V12l2.4 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  )
}

export function IconMoon({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

export function IconSun({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 16 16" {...props}>
      <circle cx="8" cy="8" r="2.6" fill="currentColor" />
      <path
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        d="M8 2.4v1.3M8 12.3v1.3M2.4 8h1.3M12.3 8h1.3M4.1 4.1l.9.9M11 11l.9.9M11.9 4.1l-.9.9M5 11l-.9.9"
      />
    </Icon>
  )
}

export function IconCaret({ size = 12, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 12 12" {...props}>
      <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  )
}

export function IconDesktop({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <rect x="3.5" y="5" width="17" height="11.5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 20h8M12 16.5V20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  )
}

export function IconTablet({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <rect x="6" y="3.5" width="12" height="17" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="17.6" r="0.8" fill="currentColor" />
    </Icon>
  )
}

export function IconPhone({ size = 18, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <rect x="7.5" y="3" width="9" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 5.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  )
}

export function IconSparkle({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M12 3.2c.22 3.1 1.9 4.78 5 5-3.1.22-4.78 1.9-5 5-.22-3.1-1.9-4.78-5-5 3.1-.22 4.78-1.9 5-5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

export function IconCode({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path d="M9 8 5 12l4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  )
}

export function IconMenu({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" />
    </Icon>
  )
}

/** Figma Draw toolbar: fountain-pen nib. */
export function IconFigmaPen({ size = 22, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M12 2.75 16.55 8.2c1.2 1.42 1.38 3.4.45 4.98L12 21.35 6.99 13.18c-.93-1.58-.75-3.56.46-4.98L12 2.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 11.2v9.9" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <circle cx="12" cy="10.05" r="1.12" fill="currentColor" />
    </Icon>
  )
}

/** Figma Draw toolbar: upright marker / ink brush. */
export function IconFigmaBrush({ size = 22, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <rect x="8.05" y="2.85" width="7.9" height="6.55" rx="2.55" fill="currentColor" />
      <path
        d="M10.15 3.55v5.15M12 3.35v5.5M13.85 3.55v5.15"
        stroke="var(--panel, #fff)"
        strokeWidth="1.05"
        strokeLinecap="round"
      />
      <path
        d="M8.45 9.15h7.1v10.2c0 1.05-.85 1.85-1.9 1.85h-3.3c-1.05 0-1.9-.8-1.9-1.85V9.15Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

/** Figma Draw toolbar: upright pencil. */
export function IconFigmaPencil({ size = 22, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path d="M12 2.7 15.15 7.85H8.85L12 2.7Z" fill="currentColor" />
      <path
        d="M8.85 7.85h6.3v11.35c0 .85-.7 1.5-1.55 1.5h-3.2c-.85 0-1.55-.65-1.55-1.5V7.85Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

/** Figma-style text-on-path tool: T sitting on a curve. */
export function IconTextOnPath({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M4.2 16.2c2.4-4.8 5.1-7.2 7.8-7.2s5.4 2.4 7.8 7.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M7.5 4h9M12 4v9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

/** VANTA wordmark — uses currentColor (black in light mode, white in dark). */
export function VantaLogo({
  height = 28,
  className,
  style
}: {
  height?: number
  className?: string
  style?: CSSProperties
}) {
  const width = Math.round((height * 898) / 194)
  const maskStyle: CSSProperties = {
    width,
    height,
    display: 'inline-block',
    flex: 'none',
    backgroundColor: 'currentColor',
    WebkitMaskImage: `url(${logoWordmarkUrl})`,
    maskImage: `url(${logoWordmarkUrl})`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    ...style
  }
  return <span role="img" aria-label="Vanta" className={className} style={maskStyle} />
}

/** Favicon mark: V only (inherits currentColor). */
export function VantaMark({
  size = 24,
  className,
  style
}: {
  size?: number
  className?: string
  style?: CSSProperties
}) {
  const maskStyle: CSSProperties = {
    width: size,
    height: size,
    display: 'inline-block',
    flex: 'none',
    backgroundColor: 'currentColor',
    WebkitMaskImage: `url(${logoMarkUrl})`,
    maskImage: `url(${logoMarkUrl})`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    ...style
  }
  return <span aria-hidden="true" className={className} style={maskStyle} />
}

/** Figma-style sidebar / Minimize UI icon (panel with a thick edge bar). */
export function IconSidebarPanel({
  size = 16,
  side = 'left',
  ...props
}: IconProps & { side?: 'left' | 'right' }) {
  return (
    <Icon size={size} viewBox="0 0 16 16" {...props}>
      <rect x="2.75" y="3" width="10.5" height="10" rx="1.75" stroke="currentColor" strokeWidth="1.35" />
      {side === 'left' ? (
        <rect x="4" y="4.35" width="2.15" height="7.3" rx="0.55" fill="currentColor" />
      ) : (
        <rect x="9.85" y="4.35" width="2.15" height="7.3" rx="0.55" fill="currentColor" />
      )}
    </Icon>
  )
}

/** Figma-style section icon: rectangle with a header tab on top. */
export function IconSection({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path d="M5 3h7a1.5 1.5 0 0 1 1.5 1.5V6H5V3Z" fill="currentColor" />
      <rect x="3" y="6.5" width="18" height="14.5" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </Icon>
  )
}

/** Shader fills mark: square with inset diamond. */
export function IconPaperShaders({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <rect x="3" y="3" width="18" height="18" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 6.5 17.5 12 12 17.5 6.5 12Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </Icon>
  )
}

/** Create SVG: image frame with mountains + sparkle. */
export function IconCreateSvg({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 24 24" {...props}>
      <path
        d="M16.5 3H5.5A2.5 2.5 0 0 0 3 5.5v13A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5V8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M6 17.5 9.5 12.5l2.25 2.75L15 10.75 18.25 17.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M20 1.5c.17 1.3.78 2.13 2.35 2.5-1.57.37-2.18 1.2-2.35 2.5-.17-1.3-.78-2.13-2.35-2.5 1.57-.37 2.18-1.2 2.35-2.5Z"
        fill="currentColor"
      />
    </Icon>
  )
}
