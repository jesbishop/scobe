import type { DesignNode } from '../shared/types'

/**
 * Layer-structure and app actions chat can run. Unlike inspector properties these
 * act on the whole selection or the app, so App performs them (see runJevCommand).
 */

export type CommandArea = 'structure' | 'app'

export type CommandId =
  | 'duplicate'
  | 'group'
  | 'wrap_flex'
  | 'ungroup'
  | 'bring_front'
  | 'send_back'
  | 'align_left'
  | 'align_hcenter'
  | 'align_right'
  | 'align_top'
  | 'align_vcenter'
  | 'align_bottom'
  | 'create_rect'
  | 'create_ellipse'
  | 'create_frame'
  | 'create_text'
  | 'create_star'
  | 'create_polygon'
  | 'undo'
  | 'redo'
  | 'add_page'
  | 'go_to_page'
  | 'rename_page'
  | 'create_svg'
  | 'remove_background'
  | 'vectorize'
  | 'export'
  | 'open_browser'

export type Command = {
  id: CommandId
  area: CommandArea
  label: string
  description: string
  keywords: RegExp
  unless?: RegExp
  /** Needs at least this many selected layers to run. */
  minSelection?: number
  /** Only when the selection is an image. */
  imageOnly?: boolean
}

/** "add a", "make a big red", "draw another" — up to two describing words before the shape. */
const CREATE = String.raw`\b(add|create|draw|insert|place|make)\s+(a|an|another|new|one|\d+)\s+(?:(?!with\b|for\b|in\b|on\b|and\b|that\b)[\w#-]+\s+){0,2}`

export const COMMANDS: Command[] = [
  {
    id: 'duplicate',
    area: 'structure',
    label: 'Duplicate',
    description: 'Duplicate / clone / copy the selected layers.',
    keywords: /\b(duplicate|clone|copy (this|it|that|them)|make (a )?copy)\b/i,
    minSelection: 1
  },
  {
    id: 'group',
    area: 'structure',
    label: 'Group in a frame',
    description: 'Group the selected layers / wrap them in a frame.',
    keywords: /^\s*(please\s+)?group\b|\bgroup (them|these|it|this|those|the selection|everything)\b|\b(wrap (it|this|them|these)? ?in (a |one )?frame|put (them|these|it) in a frame|frame (them|these|this|the selection))\b/i,
    unless: /\bungroup|auto[\s-]?layout|flex/i,
    minSelection: 1
  },
  {
    id: 'wrap_flex',
    area: 'structure',
    label: 'Wrap in auto layout',
    description: 'Wrap the selected layers in a new auto-layout (flexbox) frame.',
    keywords: /\bwrap\b.*\b(auto[\s-]?layout|flex\w*|stack)\b|\b(group|stack) (them|these) (in|with|into) (an? )?(auto[\s-]?layout|flex\w*)\b/i,
    minSelection: 1
  },
  {
    id: 'ungroup',
    area: 'structure',
    label: 'Ungroup',
    description: 'Ungroup / unframe: remove the frame around the selected layers and keep its contents.',
    keywords: /\b(ungroup|unframe|remove (the )?(group|frame) (around|but keep))\b/i,
    minSelection: 1
  },
  {
    id: 'bring_front',
    area: 'structure',
    label: 'Bring to front',
    description: 'Bring the selected layers to the front / on top of everything.',
    keywords: /\b(bring (it |this |them )?(to (the )?)?front|bring (it )?forward|to the front|on top of (everything|the others))\b/i,
    minSelection: 1
  },
  {
    id: 'send_back',
    area: 'structure',
    label: 'Send to back',
    description: 'Send the selected layers to the back / behind everything.',
    keywords: /\b(send (it |this |them )?(to (the )?)?back|send (it )?backward|to the back|behind (everything|the others))\b/i,
    minSelection: 1
  },
  ...(
    [
      ['align_left', 'Align left edges', 'left edges', /\balign\w*\b.*\bleft\b|\bleft[\s-]?align\w*\b/i],
      ['align_hcenter', 'Align horizontal centers', 'horizontal centers', /\balign\w*\b.*\b(horizontal(ly)? cent\w*|cent\w* horizontal\w*|cent\w*)\b(?!.*\bvertical)/i],
      ['align_right', 'Align right edges', 'right edges', /\balign\w*\b.*\bright\b|\bright[\s-]?align\w*\b/i],
      ['align_top', 'Align top edges', 'top edges', /\balign\w*\b.*\btops?\b/i],
      ['align_vcenter', 'Align vertical centers', 'vertical middles', /\balign\w*\b.*\b(middle|vertical(ly)? cent\w*|cent\w* vertical\w*)\b/i],
      ['align_bottom', 'Align bottom edges', 'bottom edges', /\balign\w*\b.*\bbottoms?\b/i]
    ] as const
  ).map(
    ([id, label, what, keywords]): Command => ({
      id,
      area: 'structure',
      label,
      description: `Align the ${what} of two or more selected layers with each other.`,
      keywords,
      unless: /\btext\b|\bitems\b|\bcontent\b/i,
      minSelection: 2
    })
  ),
  {
    id: 'create_rect',
    area: 'structure',
    label: 'Add rectangle',
    description: 'Create a plain rectangle / square / box shape.',
    keywords: new RegExp(`${CREATE}(rectangle|rect|square|box)\\b`, 'i')
  },
  {
    id: 'create_ellipse',
    area: 'structure',
    label: 'Add ellipse',
    description: 'Create a circle / ellipse / oval shape.',
    keywords: new RegExp(`${CREATE}(circle|ellipse|oval|dot)\\b`, 'i')
  },
  {
    id: 'create_frame',
    area: 'structure',
    label: 'Add frame',
    description: 'Create an empty frame / artboard / container.',
    keywords: new RegExp(`${CREATE}(empty\\s+)?(frame|artboard|container)\\b`, 'i')
  },
  {
    id: 'create_text',
    area: 'structure',
    label: 'Add text',
    description: 'Create a plain text layer with the given words.',
    keywords: new RegExp(`${CREATE}text(\\s+layer)?\\b(?!\\s*(field|area|input|box))|\\b(add|write)\\s+(the\\s+)?text\\b(?!\\s*(field|area|input|box))`, 'i')
  },
  {
    id: 'create_star',
    area: 'structure',
    label: 'Add star',
    description: 'Create a star shape.',
    keywords: new RegExp(`${CREATE}star\\b`, 'i')
  },
  {
    id: 'create_polygon',
    area: 'structure',
    label: 'Add polygon',
    description: 'Create a polygon / triangle / hexagon shape.',
    keywords: new RegExp(`${CREATE}(polygon|triangle|hexagon|pentagon|octagon)\\b`, 'i')
  },
  {
    id: 'undo',
    area: 'structure',
    label: 'Undo',
    description: 'Undo the last change.',
    keywords: /^\s*(undo|undo (that|it|the last (change|one))|revert (that|it)|go back)\s*[.!]?\s*$/i
  },
  {
    id: 'redo',
    area: 'structure',
    label: 'Redo',
    description: 'Redo the change that was just undone.',
    keywords: /^\s*(redo|redo (that|it))\s*[.!]?\s*$/i
  },
  {
    id: 'add_page',
    area: 'app',
    label: 'Add page',
    description: 'Add a new page to the file.',
    keywords: /\b(add|create|new|make)\s+(a\s+)?(new\s+)?page\b/i
  },
  {
    id: 'go_to_page',
    area: 'app',
    label: 'Go to page',
    description: 'Switch to / open another page.',
    keywords: /\b(go to|switch to|open|show( me)?)\s+(the\s+)?(page\b|.*\bpage\b)|\bpage\s+\d+\b/i,
    unless: /\b(add|create|new|rename)\b/i
  },
  {
    id: 'rename_page',
    area: 'app',
    label: 'Rename page',
    description: 'Rename the current page.',
    keywords: /\brename\s+(the\s+|this\s+)?(current\s+)?page\b/i
  },
  {
    id: 'create_svg',
    area: 'app',
    label: 'Create SVG',
    description: 'Generate a new SVG illustration, icon, or logo from a description (Create SVG).',
    keywords: /\b(create|generate|make|draw|design)\s+(me\s+)?(an?\s+)?(svg|vector|icon|illustration|logo)\b/i
  },
  {
    id: 'remove_background',
    area: 'app',
    label: 'Remove background',
    description: 'Remove the background from the selected image (cut out the subject).',
    keywords: /\b(remove|cut out|delete|erase|get rid of)\s+(the\s+)?(image\s+|photo\s+)?background\b|\bcut (it |the subject )?out\b/i,
    minSelection: 1,
    imageOnly: true
  },
  {
    id: 'vectorize',
    area: 'app',
    label: 'Vectorize',
    description: 'Vectorize / trace the selected image into an editable SVG.',
    keywords: /\b(vectori[sz]e|trace (it|the image)|convert (it |this )?(in)?to (an? )?(svg|vector))\b/i,
    minSelection: 1
  },
  {
    id: 'export',
    area: 'app',
    label: 'Export',
    description: 'Export / download the selected layers as PNG, JPG, SVG, or PDF.',
    keywords: /^\s*(please\s+)?(export|download)\b|\b(export|download|save)\s+(it|this|them|these|that|the selection|everything)\b|\b(export|download|save)\s+(\w+\s+)?(as|to)\s+(an?\s+)?(png|jpe?g|svg|pdf)\b/i,
    minSelection: 1
  },
  {
    id: 'open_browser',
    area: 'app',
    label: 'Open browser',
    description: 'Open a live website / browser on the canvas.',
    keywords: /\b(open|go to|browse|visit|load|pull up)\b.*(https?:\/\/|www\.|\b[\w-]+\.(com|org|net|io|app|dev|ai|co|design)\b)/i,
    unless: /\b(text|say|says|label|rename|link to)\b|["“]/i
  }
]

export const COMMAND_AREA_DESCRIPTIONS: Record<CommandArea, string> = {
  structure:
    'Layer structure: duplicate, group into a frame, wrap in auto layout, ungroup, bring to front, send to back, align several layers, create a basic shape / frame / text, undo or redo.',
  app: 'App actions: add, switch, or rename pages; generate an SVG illustration; remove an image background; vectorize an image; export; open a website on the canvas.'
}

const BY_ID = new Map(COMMANDS.map((command) => [command.id, command]))

export function commandById(id: string): Command | undefined {
  return BY_ID.get(id as CommandId)
}

export function commandRunnable(command: Command, selected: DesignNode[]): string | null {
  if ((command.minSelection || 0) > selected.length) {
    return command.minSelection && command.minSelection > 1
      ? `Select at least ${command.minSelection} layers to ${command.label.toLowerCase()}.`
      : `Select a layer to ${command.label.toLowerCase()}.`
  }
  if (command.imageOnly && !selected.some((node) => node.type === 'image' || node.fills?.some((paint) => paint.type === 'image'))) {
    return 'Select an image first.'
  }
  return null
}

/** The command the words clearly name, when it can run on the current selection. */
export function matchCommand(request: string, selected: DesignNode[]): CommandId | null {
  for (const command of COMMANDS) {
    if (!command.keywords.test(request)) continue
    if (command.unless?.test(request)) continue
    if (commandRunnable(command, selected)) continue
    return command.id
  }
  return null
}
