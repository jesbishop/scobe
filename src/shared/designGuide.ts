/**
 * The design guide every agent building on the Scobe canvas follows: Claude in chat,
 * and coding agents connected over MCP (served as a tool, a prompt and a resource).
 * Keep rules concrete — numbers and checks, not adjectives.
 */
export const DESIGN_GUIDE = `# Scobe design guide

Design like a senior product designer. Restraint, rhythm and hierarchy beat decoration.

## Process (always)
1. Look first: list_design to see what exists, get_tokens for the file's colors, type and spacing. Reuse them.
2. Plan in one or two sentences: the sections, the one most important thing on screen, and the layout (columns, widths).
3. Build structure: one container frame, then section frames, all with auto layout (set_layout). No floating loose layers.
4. Fill with real content: real headings, believable copy, real labels and numbers. Never lorem ipsum or "Title here".
5. Style: apply type, color, radius and effects from one small consistent set.
6. Review: render_node on the top-level frame, compare against the checklist below, fix what fails, render again. Do at least one review pass before saying you're done.

## Layout and spacing
- Spacing comes from a 4px base, mostly the 8px steps: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Related things sit closer than unrelated things. Gap inside a group < gap between groups < section padding.
- Typical values: icon to label 8, items in a list 12-16, card padding 20-24, between cards 16-24, section padding 64-96 vertical.
- Desktop artboards: 1440 wide, content column 1040-1200 centered. Mobile: 390 wide with 16-20 side padding.
- Align everything to a shared edge. Left-align text blocks by default; center only short hero headlines and empty states.
- Keep line length readable: body text 45-75 characters (about 480-680px at 16px).

## Typography
- One typeface for UI (Inter, Geist, or the file's font). A second only for display headings, never more than two.
- Type scale: 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72. Pick 4-5 sizes per screen, not more.
- Body 15-16px, line height about 1.5. Headings line height 1.1-1.25 and letter spacing -1% to -2% at 30px and up.
- Weights: 400 body, 500 labels and buttons, 600-700 headings. Don't bold whole paragraphs.
- Hierarchy through size, weight and color together: primary text near-black, secondary about 60% (e.g. #6b7280 on white), tertiary about 45%.
- Sentence case for UI labels and buttons. All caps only for small eyebrow labels (11-12px, +4% to +8% tracking).

## Color
- Mostly neutrals. One accent color for primary actions and key highlights; at most one supporting color.
- Background, surface and border should be close in value (e.g. #ffffff / #fafafa / #e5e7eb). Avoid pure black on pure white for large areas; use #0a0a0a-#111827 text.
- Text contrast at least 4.5:1 (3:1 for 24px+). Never light gray text on a tinted background.
- Status colors only for status: green success, amber warning, red error.
- Dark mode: dark gray surfaces (#0a0a0a-#18181b), not pure black panels on pure black.

## Shape and depth
- One radius family: 6-8 for inputs and small buttons, 12-16 for cards, 999 only for pills, chips and avatars.
- Prefer a 1px border (#e5e7eb-ish) or a soft shadow, not both heavy. Shadows: low opacity (4-10%), y 2-8, blur 8-24.
- Flat is fine. Depth should mean something (a menu above content), not decorate everything.

## Components
- Buttons: height 36-44 (40 default), horizontal padding 16-20, 14-16px medium text. One primary button per area; others secondary or ghost.
- Inputs: height 40-44, 1px border, 12-14 inner padding, label above (14px, 500), helper text below (13px, secondary color).
- Cards: padding 20-24, radius 12-16, consistent internal gaps. Cards in a row share height and structure.
- Navigation: 56-72 tall, logo left, 3-6 links, one primary action right.
- Icons: real vector icons from add_icon (Lucide by default; search_icons to find names). One style per screen, 16-20px next to text (24 for standalone), stroke 1.5-2, colored like the text beside them, centered on the text line. Never use emoji, letters or colored dots as icons.
- Logos, illustrations and custom marks: add_svg with markup or an .svg URL (brand logos: add_icon with "simple-icons:<brand>"). Keep them as vectors, never screenshots.

## Avoid (looks AI-generated)
- Purple-to-blue gradients, glowing blobs and gradient text by default.
- Everything centered; identical three-card grids with an icon, a title and two lines of filler.
- Too many sizes, weights, colors, radii or shadows on one screen.
- Random spacing values (13, 27, 41) instead of the scale.
- Placeholder copy, fake logos made of text, emoji icons, decorative borders on everything.

## Review checklist (after render_node)
- Is there one obvious focal point, and is the reading order clear in two seconds?
- Do edges line up? Are gaps from the scale and consistent between similar items?
- Are there 5 or fewer font sizes, and is body text readable (15px+)?
- Is the accent color used sparingly and only for what matters?
- Does any text fail contrast, overflow, wrap awkwardly, or sit cramped against an edge?
- Would a good designer remove something? Remove it.
`

/** Short version for MCP server instructions, pointing agents at the full guide. */
export const DESIGN_GUIDE_SUMMARY =
  'Before designing, call get_design_guide and follow it. Use get_tokens to reuse the file’s colors, type and spacing. ' +
  'Build with auto-layout frames on a 4/8px spacing scale, 4-5 type sizes, mostly neutrals with one accent, and real copy. ' +
  'After building, call render_node on the top-level frame, review it against the guide’s checklist, fix issues, and render again before finishing.'
