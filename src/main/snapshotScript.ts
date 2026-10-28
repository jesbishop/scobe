/**
 * Injected into a canvas browser for Paper-style snapshot.
 * Hover highlights an element; ↑/↓ walks the ancestor chain; click or Enter
 * serializes that subtree (computed styles + images) so the shell can paste
 * it onto the design canvas.
 */
const SNAPSHOT_SOURCE = `
(() => {
  const NS = '__vantaSnapshot';
  const VERSION = '__SNAPSHOT_VERSION__';
  if (window[NS] && window[NS].ready && window[NS].version === VERSION) return;
  // A tab that ran an older build keeps that copy until replaced here.
  if (window[NS] && window[NS].disable) {
    try { window[NS].disable(); } catch (err) {}
  }

  // Deep component trees (YouTube nests 60+ levels) lose their leaves under tight caps.
  const MAX_NODES = 6000;
  const MAX_DEPTH = 160;
  const MAX_IMAGES = 600;
  const MAX_ICON = 160;
  const ICON_FONT = /icon|symbol|material|awesome|glyph|feather|codicon|lucide|tabler|phosphor|remix/i;
  const PRIVATE_USE = /[\\uE000-\\uF8FF]|[\\uDB80-\\uDBFF][\\uDC00-\\uDFFF]/;
  const SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'color', 'visibility', 'stop-color', 'stop-opacity', 'clip-rule', 'font-family', 'font-size', 'font-weight'];
  const SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, BR: 1, WBR: 1, TEMPLATE: 1 };

  const root = document.createElement('div');
  root.setAttribute('data-vanta-snapshot', '1');
  root.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;display:none;border:1.5px solid #0d99ff;background:rgba(13,153,255,0.14);box-sizing:border-box;pointer-events:none;';
  root.appendChild(box);

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;display:none;z-index:2;padding:2px 6px;border-radius:4px;background:#1a1a1a;color:#fff;font:11px/1.3 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;pointer-events:none;';
  root.appendChild(label);

  const hud = document.createElement('div');
  hud.textContent = 'Snapshot  ·  click to paste  ·  ↑ parent  ·  ↓ child  ·  esc';
  hud.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:#1a1a1a;color:#fff;font:12px/1.3 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.25);';
  root.appendChild(hud);

  const state = {
    ready: true,
    enabled: false,
    hover: null,
    climb: 0,
    pending: false,
    result: null,
    error: '',
    cancel: false,
    generation: 0,
    bound: false,
    maxNodes: MAX_NODES
  };

  const parentEl = (el) => {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const scope = el.getRootNode && el.getRootNode();
    if (scope && scope.host) return scope.host;
    return null;
  };

  const childElements = (el) => {
    const list = el.children ? Array.from(el.children) : [];
    if (el.shadowRoot) list.push.apply(list, Array.from(el.shadowRoot.children));
    return list.filter((child) => child && child.nodeType === 1 && !SKIP[child.tagName] && !(child.closest && child.closest('[data-vanta-snapshot]')));
  };

  const skipEl = (el) => !el || el === root || (el.closest && el.closest('[data-vanta-snapshot]')) || el === document.documentElement;

  const rectOf = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };

  const interesting = (el) => {
    if (skipEl(el) || !el.tagName || SKIP[el.tagName]) return false;
    const rect = rectOf(el);
    return rect.width >= 1 && rect.height >= 1;
  };

  const parseColor = (input) => {
    if (!input || input === 'transparent' || input === 'rgba(0, 0, 0, 0)') return null;
    const raw = String(input).trim();
    const hexMatch = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (hexMatch) {
      const body = hexMatch[1].length === 3 ? hexMatch[1].split('').map((ch) => ch + ch).join('') : hexMatch[1];
      return { hex: ('#' + body).toUpperCase(), opacity: 1 };
    }
    const match = raw.match(/rgba?\\(\\s*([\\d.]+)(?:[,\\s]+)([\\d.]+)(?:[,\\s]+)([\\d.]+)(?:(?:[,\\s/]+)([\\d.]+%?))?\\s*\\)/);
    if (!match) return null;
    let alpha = 1;
    if (match[4] != null) alpha = match[4].indexOf('%') >= 0 ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    if (!(alpha > 0.01)) return null;
    const hex = '#' + [match[1], match[2], match[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0')).join('');
    return { hex: hex.toUpperCase(), opacity: Math.max(0, Math.min(1, alpha)) };
  };

  const splitArgs = (input) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        parts.push(input.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(input.slice(start).trim());
    return parts.filter(Boolean);
  };

  const parseLinear = (bg) => {
    if (!bg || bg.indexOf('linear-gradient(') < 0) return null;
    const start = bg.indexOf('linear-gradient(');
    let depth = 0;
    let end = -1;
    for (let i = start + 'linear-gradient'.length; i < bg.length; i++) {
      if (bg[i] === '(') depth++;
      else if (bg[i] === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) return null;
    const args = splitArgs(bg.slice(start + 'linear-gradient('.length, end));
    if (args.length < 2) return null;
    let angle = 180;
    let rest = args;
    const head = args[0];
    if (/deg$/.test(head) || head.indexOf('to ') === 0) {
      if (/deg$/.test(head)) angle = parseFloat(head) || 180;
      else if (head === 'to top') angle = 0;
      else if (head === 'to right') angle = 90;
      else if (head === 'to bottom') angle = 180;
      else if (head === 'to left') angle = 270;
      else if (head === 'to top right' || head === 'to right top') angle = 45;
      else if (head === 'to bottom right' || head === 'to right bottom') angle = 135;
      else if (head === 'to bottom left' || head === 'to left bottom') angle = 225;
      else if (head === 'to top left' || head === 'to left top') angle = 315;
      rest = args.slice(1);
    }
    const stops = [];
    rest.forEach((part, index) => {
      const colorMatch = part.match(/rgba?\\([^)]+\\)|#[0-9a-fA-F]{3,8}/);
      if (!colorMatch) return;
      const color = parseColor(colorMatch[0].length === 4 ? '#' + colorMatch[0][1] + colorMatch[0][1] + colorMatch[0][2] + colorMatch[0][2] + colorMatch[0][3] + colorMatch[0][3] : colorMatch[0]);
      if (!color) return;
      const pos = part.match(/([\\d.]+)%/);
      stops.push({
        hex: color.hex,
        opacity: color.opacity,
        position: pos ? Math.max(0, Math.min(1, parseFloat(pos[1]) / 100)) : index / Math.max(1, rest.length - 1)
      });
    });
    if (stops.length < 2) return null;
    return { type: 'linear', angle, stops };
  };

  const firstUrl = (bg) => {
    if (!bg || bg === 'none') return '';
    const match = bg.match(/url\\((['"]?)(.*?)\\1\\)/);
    return match ? match[2] : '';
  };

  const parseShadow = (value) => {
    if (!value || value === 'none') return null;
    const colorMatch = value.match(/rgba?\\([^)]+\\)|#[0-9a-fA-F]{3,8}/);
    const lengths = value.match(/-?[\\d.]+px/g);
    if (!lengths || lengths.length < 2) return null;
    const color = colorMatch ? parseColor(colorMatch[0]) : { hex: '#000000', opacity: 0.25 };
    if (!color) return null;
    return {
      x: parseFloat(lengths[0]) || 0,
      y: parseFloat(lengths[1]) || 0,
      blur: lengths[2] ? parseFloat(lengths[2]) || 0 : 0,
      spread: lengths[3] ? parseFloat(lengths[3]) || 0 : 0,
      hex: color.hex,
      opacity: color.opacity,
      inset: value.indexOf('inset') >= 0
    };
  };

  const blurPx = (value) => {
    if (!value || value === 'none') return 0;
    const match = value.match(/blur\\(([\\d.]+)px\\)/);
    return match ? parseFloat(match[1]) || 0 : 0;
  };

  const fontStack = (family) => {
    const first = String(family || '').split(',')[0].replace(/['"]/g, '').trim();
    return first || 'sans-serif';
  };

  const layerName = (el, text) => {
    const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'));
    if (aria && String(aria).trim()) return String(aria).trim().slice(0, 64);
    if (el.id) return String(el.id).slice(0, 64);
    if (text && text.length <= 42) return text.slice(0, 64);
    return el.tagName.toLowerCase();
  };

  const leafText = (el) => {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return String(el.value || el.placeholder || '').trim();
    if (tag === 'SELECT' && el.options && el.selectedIndex >= 0) return String(el.options[el.selectedIndex].text || '').trim();
    const kids = childElements(el).filter((child) => child.tagName !== 'BR');
    if (kids.length) return '';
    return String(el.innerText || el.textContent || '').replace(/\\u00a0/g, ' ').trim();
  };

  const directTextBoxes = (el) => {
    const boxes = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== 3) continue;
      const text = String(node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      boxes.push({ text, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    return boxes;
  };

  /** Border sides that actually paint: width, a real style, and a visible color (transparent spacers don't). */
  const visibleBorders = (style) => {
    const out = [];
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(style['border' + side + 'Width']) || 0;
      const kind = style['border' + side + 'Style'];
      if (width <= 0 || kind === 'none' || kind === 'hidden') continue;
      const color = parseColor(style['border' + side + 'Color']);
      if (!color) continue;
      out.push({ side, width, color });
    }
    return out;
  };

  const hasBox = (style) => {
    if (parseColor(style.backgroundColor)) return true;
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    if (visibleBorders(style).length) return true;
    if ((parseFloat(style.borderTopLeftRadius) || 0) > 0) return true;
    if (style.boxShadow && style.boxShadow !== 'none') return true;
    return false;
  };

  const textStyle = (style, text) => {
    const size = parseFloat(style.fontSize) || 14;
    const line = parseFloat(style.lineHeight);
    const spacing = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) || 0;
    const align = style.textAlign === 'center' || style.textAlign === 'right' || style.textAlign === 'justify' ? style.textAlign : 'left';
    const deco = style.textDecorationLine && style.textDecorationLine.indexOf('line-through') >= 0
      ? 'line-through'
      : style.textDecorationLine && style.textDecorationLine.indexOf('underline') >= 0
        ? 'underline'
        : 'none';
    const lines = String(text || '').split('\\n').length;
    return {
      color: parseColor(style.color) || { hex: '#111111', opacity: 1 },
      fontFamily: fontStack(style.fontFamily),
      fontWeight: parseInt(style.fontWeight, 10) || 400,
      fontStyle: style.fontStyle === 'italic' ? 'italic' : 'normal',
      fontSize: size,
      lineHeight: line > 0 ? line : undefined,
      letterSpacing: spacing || undefined,
      textAlign: align,
      textAlignVertical: lines <= 1 ? 'middle' : 'top',
      textDecoration: deco
    };
  };

  const radiusOf = (style, rect) => {
    const parseOne = (raw) => {
      if (!raw) return 0
      if (String(raw).indexOf('%') >= 0) return (parseFloat(raw) / 100) * Math.min(rect.width, rect.height)
      return parseFloat(raw) || 0
    }
    const tl = parseOne(style.borderTopLeftRadius)
    const tr = parseOne(style.borderTopRightRadius)
    const br = parseOne(style.borderBottomRightRadius)
    const bl = parseOne(style.borderBottomLeftRadius)
    if (tl === tr && tr === br && br === bl) return { radius: tl || undefined }
    if (tl || tr || br || bl) return { radius: tl, cornerRadii: { tl, tr, br, bl } }
    return {}
  }

  const hasMask = (style) => {
    const mask = style.webkitMaskImage || style.maskImage;
    return Boolean(mask && mask !== 'none');
  };

  const hasPseudoIcon = (el) => {
    for (const which of ['::before', '::after']) {
      const ps = window.getComputedStyle(el, which);
      const content = ps && ps.content;
      if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") continue;
      if (ICON_FONT.test(fontStack(ps.fontFamily)) || PRIVATE_USE.test(content) || hasMask(ps)) return true;
      if (ps.backgroundImage && ps.backgroundImage !== 'none') return true;
    }
    return false;
  };

  /** Icon-font glyphs, ::before icons and CSS-mask icons can't be rebuilt as layers, so they're pasted as pixels. */
  const isIcon = (el, style, rect, kids, text) => {
    if (rect.width > MAX_ICON || rect.height > MAX_ICON) return false;
    if (hasMask(style)) return true;
    if (kids.length) return false;
    if (text && text.length <= 40 && (ICON_FONT.test(fontStack(style.fontFamily)) || PRIVATE_USE.test(text))) return true;
    return !text && hasPseudoIcon(el);
  };

  const boxPad = (style) => ({
    t: (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0),
    r: (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderRightWidth) || 0),
    b: (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0),
    l: (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0)
  });

  /** CSS flow hints so the importer can rebuild flex / stacked blocks as auto layout. */
  const flowOf = (style) => {
    const display = style.display;
    if (display === 'flex' || display === 'inline-flex') {
      const dir = String(style.flexDirection || 'row');
      return {
        kind: 'flex',
        dir: dir.indexOf('column') === 0 ? 'column' : 'row',
        reverse: dir.indexOf('reverse') > 0 || undefined,
        wrap: (style.flexWrap && style.flexWrap !== 'nowrap') || undefined,
        justify: style.justifyContent || undefined,
        pad: boxPad(style)
      };
    }
    if (display === 'grid' || display === 'inline-grid') {
      return { kind: 'grid', pad: boxPad(style) };
    }
    if (display === 'block' || display === 'flow-root' || display === 'list-item' || display === 'inline-block') {
      return { kind: 'block', pad: boxPad(style) };
    }
    return null;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const absUrl = (src) => {
    try { return new URL(src, location.href).href; } catch (err) { return ''; }
  };

  const inFixed = (el) => {
    let cur = el;
    for (let i = 0; cur && cur !== document.documentElement && i < 60; i++) {
      const pos = window.getComputedStyle(cur).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      cur = parentEl(cur);
    }
    return false;
  };

  const singleTextNode = (el) => {
    let found = null;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== 3) continue;
      if (!String(node.textContent || '').trim()) continue;
      if (found) return null;
      found = node;
    }
    return found;
  };

  /** Line-clamped / ellipsized text: keep only what the page actually shows. */
  const clampText = (el, style, rect, text) => {
    const clamp = parseInt(style.webkitLineClamp, 10);
    const clips =
      clamp > 0 ||
      style.textOverflow === 'ellipsis' ||
      style.overflow === 'hidden' ||
      style.overflowY === 'hidden' ||
      style.overflowX === 'hidden';
    if (!clips) return text;
    if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) return text;
    const node = singleTextNode(el);
    if (!node) return text;
    const full = String(node.textContent || '');
    const bottom = rect.y + rect.height + 0.5;
    const right = rect.x + rect.width + 0.5;
    const range = document.createRange();
    const fits = (n) => {
      range.setStart(node, 0);
      range.setEnd(node, n);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];
      return !last || (last.bottom <= bottom && last.right <= right);
    };
    if (fits(full.length)) return text;
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    const kept = full.slice(0, Math.max(0, lo - 1)).replace(/\\s+/g, ' ').trim();
    return kept ? kept + '\\u2026' : text;
  };

  /** Tight box around an element's rendered text (flex-centered button labels etc.). */
  const textRectOf = (el) => {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } catch (err) {
      return null;
    }
  };

  const fillOf = (style) => {
    const image = firstUrl(style.backgroundImage);
    if (image) return { type: 'image', src: image };
    const linear = parseLinear(style.backgroundImage);
    if (linear) return linear;
    const solid = parseColor(style.backgroundColor);
    if (solid) return { type: 'solid', hex: solid.hex, opacity: solid.opacity };
    return null;
  };

  let count = 0;
  const rasters = [];

  const baseNode = (el, rect, style) => {
    const opacity = parseFloat(style.opacity);
    const corners = radiusOf(style, rect);
    return {
      kind: 'frame',
      tag: el.tagName.toLowerCase(),
      name: el.tagName.toLowerCase(),
      absX: rect.x,
      absY: rect.y,
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
      opacity: opacity < 0.999 ? opacity : undefined,
      radius: corners.radius || undefined,
      cornerRadii: corners.cornerRadii || undefined,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      shadow: (() => {
        const next = parseShadow(style.boxShadow);
        return next && next.inset ? next : null;
      })(),
      layerBlur: blurPx(style.filter) || undefined,
      backgroundBlur: blurPx(style.backdropFilter) || undefined,
      flow: flowOf(style),
      abs: style.position === 'absolute' || style.position === 'fixed' || undefined,
      grow: (parseFloat(style.flexGrow) || 0) > 0 || undefined,
      children: []
    };
  };

  const addStroke = (node, style) => {
    const sides = visibleBorders(style);
    if (!sides.length) return;
    const first = sides[0];
    const uniform =
      sides.length === 4 &&
      sides.every((side) => Math.abs(side.width - first.width) < 0.05 && side.color.hex === first.color.hex && Math.abs(side.color.opacity - first.color.opacity) < 0.01);
    if (uniform) {
      node.stroke = first.color;
      node.strokeWidth = first.width;
      return;
    }
    // One-sided borders (dividers, underlines): Vanta strokes are all-around, so draw each side as a bar.
    for (const side of sides) {
      const w = side.width;
      const box =
        side.side === 'Top' ? { x: node.absX, y: node.absY, width: node.width, height: w }
          : side.side === 'Bottom' ? { x: node.absX, y: node.absY + node.height - w, width: node.width, height: w }
            : side.side === 'Left' ? { x: node.absX, y: node.absY, width: w, height: node.height }
              : { x: node.absX + node.width - w, y: node.absY, width: w, height: node.height };
      node.children.push({
        kind: 'frame',
        tag: 'border',
        name: 'border-' + side.side.toLowerCase(),
        absX: box.x,
        absY: box.y,
        x: 0,
        y: 0,
        width: Math.max(0.5, box.width),
        height: Math.max(0.5, box.height),
        fill: { type: 'solid', hex: side.color.hex, opacity: side.color.opacity },
        stroke: null,
        strokeWidth: 0,
        abs: true,
        flow: null,
        children: []
      });
    }
  };

  /**
   * Zero-size wrappers (an inline <span> around a block icon, custom elements with no box)
   * still paint their children — keep those instead of culling the whole subtree.
   */
  const passThrough = (el, style, depth) => {
    const clips = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden' || style.overflow === 'clip';
    if (clips) return null;
    const built = [];
    for (const child of childElements(el)) {
      const node = buildOne(child, depth + 1);
      if (node) built.push(node);
    }
    if (!built.length) return null;
    if (built.length === 1) return built[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of built) {
      minX = Math.min(minX, node.absX);
      minY = Math.min(minY, node.absY);
      maxX = Math.max(maxX, node.absX + node.width);
      maxY = Math.max(maxY, node.absY + node.height);
    }
    count++;
    const group = baseNode(el, { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, style);
    group.flow = null;
    group.name = layerName(el, '');
    group.children = built;
    return group;
  };

  const buildOne = (el, depth) => {
    if (count >= state.maxNodes || depth > MAX_DEPTH || skipEl(el)) return null;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return null;
    if (style.display === 'contents') return null;
    // Hover / ripple layers (YouTube touch feedback, etc.) sit at opacity 0 over buttons.
    if (parseFloat(style.opacity) < 0.01) return null;
    const rect = rectOf(el);
    if (rect.width < 1 || rect.height < 1) return passThrough(el, style, depth);
    count++;
    // SVG elements keep a lowercase tagName in HTML documents.
    const tag = String(el.tagName || '').toUpperCase();
    const node = baseNode(el, rect, style);
    addStroke(node, style);

    if (tag === 'SVG') {
      node.kind = 'image';
      node.name = layerName(el, 'icon');
      let xml = null;
      try {
        xml = vectorSvg(el, rect.width, rect.height);
      } catch (err) {
        xml = null;
      }
      if (xml) {
        node.svg = xml;
        node.fill = { type: 'image', dataUrl: svgDataUrl(xml) };
        node.flow = null;
        return node;
      }
    }

    if (tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG' || tag === 'VIDEO') {
      node.kind = 'image';
      node.name = layerName(el, el.alt || (tag === 'SVG' ? 'icon' : ''));
      const src = tag === 'IMG' ? (el.currentSrc || el.src || '') : tag === 'VIDEO' ? (el.poster || '') : '';
      rasters.push({ node, el: tag === 'VIDEO' ? null : el, host: el, src, w: rect.width, h: rect.height });
      return node;
    }

    const kids = childElements(el);
    const text = leafText(el);
    if (isIcon(el, style, rect, kids, text)) {
      node.name = layerName(el, 'icon');
      node.flow = null;
      const iconFamily = text && !kids.length ? loadableIconFont(fontStack(style.fontFamily)) : '';
      if (iconFamily) {
        // Live glyph in the same icon font — recolor/resize like any icon.
        node.kind = 'text';
        node.text = text;
        node.fill = null;
        node.stroke = null;
        node.strokeWidth = 0;
        Object.assign(node, textStyle(style, text), {
          fontFamily: iconFamily,
          fontVariationSettings: style.fontVariationSettings && style.fontVariationSettings !== 'normal' ? style.fontVariationSettings : undefined,
          lineHeight: Math.max(1, Math.round(rect.height)),
          textAlign: 'center',
          textAlignVertical: 'middle',
          iconGlyph: true
        });
        return node;
      }
      const maskSrc = firstUrl(style.webkitMaskImage || style.maskImage);
      const maskColor = parseColor(style.backgroundColor) || parseColor(style.color);
      node.kind = 'image';
      node.fill = null;
      node.stroke = null;
      node.strokeWidth = 0;
      if (maskSrc && maskColor && !kids.length) {
        node.maskSrc = absUrl(maskSrc) || maskSrc;
        node.maskColor = maskColor;
        node.maskFit = /contain|cover/.test(String(style.webkitMaskSize || style.maskSize || '')) ? 'meet' : 'none';
      }
      rasters.push({ node, el: null, host: el, src: '', w: rect.width, h: rect.height, icon: true });
      return node;
    }
    node.name = layerName(el, text);
    node.fill = fillOf(style);

    if (!kids.length && text) {
      const shown = clampText(el, style, rect, text);
      const styled = textStyle(style, shown);
      if (!hasBox(style) && !node.fill && !(node.strokeWidth > 0)) {
        node.kind = 'text';
        node.text = shown;
        node.flow = null;
        Object.assign(node, styled);
        return node;
      }
      const padL = parseFloat(style.paddingLeft) || 0;
      const padT = parseFloat(style.paddingTop) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      const padB = parseFloat(style.paddingBottom) || 0;
      const content = {
        x: rect.x + padL,
        y: rect.y + padT,
        width: Math.max(1, rect.width - padL - padR),
        height: Math.max(1, rect.height - padT - padB)
      };
      // Use where the label actually renders (flex-centered buttons ignore text-align).
      const tight = textRectOf(el);
      const box = tight && tight.width <= content.width + 2 ? tight : content;
      const centered =
        tight && Math.abs(tight.x + tight.width / 2 - (content.x + content.width / 2)) <= 2 && tight.width < content.width - 4;
      if (node.fill && node.fill.type === 'image' && node.fill.src) {
        rasters.push({ node, el: null, host: el, src: node.fill.src, w: rect.width, h: rect.height, background: true });
      }
      node.children.push(Object.assign({
        kind: 'text',
        tag: 'span',
        name: shown.slice(0, 64),
        absX: box.x,
        absY: box.y,
        x: 0,
        y: 0,
        width: box.width,
        height: box.height,
        text: shown,
        children: []
      }, styled, centered ? { textAlign: 'center' } : null));
      return node;
    }

    if (node.fill && node.fill.type === 'image' && node.fill.src) {
      rasters.push({ node, el: null, host: el, src: node.fill.src, w: rect.width, h: rect.height, background: true });
    }

    for (const child of kids) {
      const childStyle = window.getComputedStyle(child);
      if (childStyle.display === 'contents') {
        for (const nested of childElements(child)) {
          const built = buildOne(nested, depth + 1);
          if (built) node.children.push(built);
        }
        continue;
      }
      const built = buildOne(child, depth + 1);
      if (built) node.children.push(built);
    }
    if (kids.length) {
      const styleForText = textStyle(style, 'x');
      for (const piece of directTextBoxes(el)) {
        node.children.push(Object.assign({
          kind: 'text',
          tag: 'span',
          name: piece.text.slice(0, 64),
          absX: piece.x,
          absY: piece.y,
          x: 0,
          y: 0,
          width: piece.width,
          height: piece.height,
          text: piece.text,
          children: []
        }, styleForText, { textAlignVertical: 'top' }));
      }
    }
    const formField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    // Empty fields still take up space in their row (e.g. Google's search box) — keep them as frames.
    if (!node.children.length && !node.fill && !(node.strokeWidth > 0) && !node.shadow && !formField) return null;
    if (formField) node.flow = null;
    return node;
  };

  const finalize = (node, parentX, parentY) => {
    const absX = node.absX;
    const absY = node.absY;
    node.x = Math.round(absX - parentX);
    node.y = Math.round(absY - parentY);
    // Rounding text down makes the last word wrap onto a hidden line.
    node.width = node.kind === 'text' ? Math.ceil(node.width) + 1 : Math.round(node.width);
    node.height = node.kind === 'text' ? Math.ceil(node.height) : Math.round(node.height);
    delete node.absX;
    delete node.absY;
    if (node.fill && node.fill.type === 'image' && !node.fill.dataUrl) node.fill = null;
    if (!node.flow) delete node.flow;
    if (!node.abs) delete node.abs;
    if (!node.grow) delete node.grow;
    for (const child of node.children || []) finalize(child, absX, absY);
  };

  /** Drop invisible single-child wrappers so the layer tree reads like a design file. */
  const isPlain = (node) =>
    node.kind === 'frame' &&
    !node.fill &&
    !(node.strokeWidth > 0) &&
    !node.shadow &&
    node.opacity == null &&
    !node.layerBlur &&
    !node.backgroundBlur &&
    !node.fetchSrc;
  const GENERIC = /^(div|span|a|section|article|main|header|footer|nav|aside|li|ul|ol|p|figure|picture)$/;
  const collapse = (node) => {
    node.children = (node.children || []).map(collapse);
    if (!isPlain(node) || node.children.length !== 1) return node;
    const only = node.children[0];
    if (GENERIC.test(only.name) && !GENERIC.test(node.name)) only.name = node.name;
    if (node.abs) only.abs = true;
    if (node.grow && !only.grow) only.grow = true;
    return only;
  };

  const blobToData = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  /** Only same-document data is read here; cross-origin images are fetched by the app (no CORS, no timeouts per tile). */
  const urlToData = async (url) => {
    if (!url) return null;
    if (url.indexOf('data:') === 0) return url;
    if (url.indexOf('blob:') === 0) {
      try {
        const res = await fetch(url);
        return res.ok ? await blobToData(await res.blob()) : null;
      } catch (err) {
        return null;
      }
    }
    return null;
  };

  /** PNG keeps transparency (icons, logos); small things are drawn at 2–3x so they stay crisp when zoomed. */
  const drawToData = (drawable, width, height, png) => {
    try {
      const maxEdge = 1100;
      const side = Math.max(width, height, 1);
      const density = side <= 256 ? 3 : Math.max(1, window.devicePixelRatio || 1);
      const scale = Math.min(density, maxEdge / side);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
      return png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.84);
    } catch (err) {
      return null;
    }
  };

  const mayBeTransparent = (src) => !src || /^data:image\\/(png|gif|webp|svg)|\\.(png|gif|webp|svg|ico)(\\?|#|$)/i.test(src);

  const SVG_ID = 'vs' + Math.random().toString(36).slice(2, 7);
  let svgSeq = 0;
  const URL_REF = /url\\((['"]?)[^'")]*#([^'")]+)\\1\\)/g;

  /** Vector copy that is safe to inline into Vanta: no scripts/styles/handlers, unique ids, scales with its box. */
  const vectorSvg = (svg, width, height) => {
    // Work on the detached clone: sites with Trusted Types (YouTube) block DOMParser.
    const root = svgClone(svg, width, height, true);
    if (!root) return null;
    for (const bad of Array.from(root.querySelectorAll('script, style, foreignObject, iframe, object, embed'))) bad.remove();
    const seq = SVG_ID + '-' + (svgSeq++) + '-';
    const ids = new Map();
    for (const el of [root].concat(Array.from(root.querySelectorAll('[id]')))) {
      const id = el.getAttribute('id');
      if (!id) continue;
      ids.set(id, seq + id);
      el.setAttribute('id', seq + id);
    }
    for (const el of [root].concat(Array.from(root.querySelectorAll('*')))) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        if (name.indexOf('on') === 0) { el.removeAttribute(attr.name); continue; }
        if (name === 'href' || name === 'xlink:href') {
          if (/^\\s*javascript:/i.test(value)) { el.removeAttribute(attr.name); continue; }
          if (value.charAt(0) === '#' && ids.has(value.slice(1))) el.setAttribute(attr.name, '#' + ids.get(value.slice(1)));
          continue;
        }
        if (value.indexOf('url(') >= 0) {
          el.setAttribute(attr.name, value.replace(URL_REF, (match, quote, id) => (ids.has(id) ? 'url(#' + ids.get(id) + ')' : match)));
        }
      }
    }
    return new XMLSerializer().serializeToString(root);
  };

  const svgDataUrl = (xml) => {
    try {
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    } catch (err) {
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    }
  };

  /** Material / Google icon fonts that Vanta can load, so glyphs stay live icons instead of pixels. */
  const ICON_FONT_MAP = [
    [/^google symbols$/i, 'Material Symbols Outlined'],
    [/^material symbols (outlined|rounded|sharp)$/i, null],
    [/^google material icons$/i, 'Material Icons'],
    [/^material icons( (outlined|round|sharp|two tone))?$/i, null]
  ];
  const loadableIconFont = (family) => {
    for (const [pattern, mapped] of ICON_FONT_MAP) {
      if (pattern.test(family)) return mapped || family;
    }
    return '';
  };

  /** Standalone copy of an inline <svg>: computed colors baked in (currentColor, CSS classes) and <use> sprites inlined. */
  const serializeSvg = (svg, width, height) => {
    const clone = svgClone(svg, width, height, false);
    return clone ? new XMLSerializer().serializeToString(clone) : null;
  };

  const svgClone = (svg, width, height, scalable) => {
    const clone = svg.cloneNode(true);
    const sources = [svg].concat(Array.from(svg.querySelectorAll('*')));
    const targets = [clone].concat(Array.from(clone.querySelectorAll('*')));
    sources.forEach((source, index) => {
      const target = targets[index];
      if (!target || !target.setAttribute) return;
      const cs = window.getComputedStyle(source);
      let css = '';
      for (const prop of SVG_PROPS) {
        const value = cs.getPropertyValue(prop);
        if (value) css += prop + ':' + value + ';';
      }
      target.setAttribute('style', css);
    });
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const inlined = new Set();
    for (const use of Array.from(clone.querySelectorAll('use'))) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (!href) continue;
      if (href.charAt(0) !== '#') return null;
      const id = href.slice(1);
      if (inlined.has(id) || clone.querySelector('[id="' + id.replace(/"/g, '') + '"]')) continue;
      const scope = svg.getRootNode && svg.getRootNode();
      const ref = (scope && scope.getElementById && scope.getElementById(id)) || document.getElementById(id);
      if (!ref) return null;
      defs.appendChild(ref.cloneNode(true));
      inlined.add(id);
    }
    if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (scalable) {
      // Keep the page's coordinate space so the vector scales with its layer.
      if (!clone.getAttribute('viewBox')) {
        const vb = svg.viewBox && svg.viewBox.baseVal;
        const w = vb && vb.width ? vb.width : Math.max(1, width);
        const h = vb && vb.height ? vb.height : Math.max(1, height);
        clone.setAttribute('viewBox', (vb ? vb.x : 0) + ' ' + (vb ? vb.y : 0) + ' ' + w + ' ' + h);
      }
      clone.setAttribute('width', '100%');
      clone.setAttribute('height', '100%');
      const style = clone.getAttribute('style') || '';
      clone.setAttribute('style', style + 'display:block;overflow:visible;');
    } else {
      clone.setAttribute('width', String(Math.max(1, Math.round(width))));
      clone.setAttribute('height', String(Math.max(1, Math.round(height))));
    }
    return clone;
  };

  const rasterize = async (entry) => {
    const el = entry.el;
    const tag = el ? String(el.tagName || '').toUpperCase() : '';
    if (tag === 'CANVAS') {
      try { return el.toDataURL('image/png'); } catch (err) { return null; }
    }
    if (tag === 'IMG') {
      if (!el.complete || !el.naturalWidth) return null;
      const drawn = drawToData(el, entry.w, entry.h, mayBeTransparent(entry.src));
      if (drawn) return drawn;
    }
    if (tag === 'SVG') {
      try {
        const xml = serializeSvg(el, entry.w, entry.h);
        if (!xml) return null;
        const img = new Image();
        const href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = href; });
        return drawToData(img, entry.w, entry.h, true);
      } catch (err) {
        return null;
      }
    }
    return urlToData(entry.src);
  };

  /** Viewport rect plus scroll, so the app can scroll to below-the-fold crops. */
  const shotOf = (entry) => ({
    x: Math.round(entry.node.absX),
    y: Math.round(entry.node.absY),
    width: Math.round(entry.w),
    height: Math.round(entry.h),
    sx: window.scrollX,
    sy: window.scrollY,
    fixed: entry.host ? inFixed(entry.host) : false
  });

  const resolveImages = async (gen) => {
    const jobs = rasters.slice(0, MAX_IMAGES);
    for (const entry of rasters.slice(MAX_IMAGES)) {
      if (!entry.background) entry.node.shot = shotOf(entry);
    }
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        if (gen !== state.generation) return;
        const entry = jobs[cursor++];
        const data = await rasterize(entry);
        if (gen !== state.generation) return;
        if (data) {
          if (!entry.background) entry.node.kind = 'image';
          entry.node.fill = { type: 'image', dataUrl: data };
          continue;
        }
        const remote = entry.src && /^https?:/i.test(absUrl(entry.src)) ? absUrl(entry.src) : '';
        if (remote) {
          entry.node.fetchSrc = remote;
          if (entry.background) entry.node.fetchBg = true;
        }
        if (!entry.background) entry.node.shot = shotOf(entry);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  };

  /** Lazy images and IntersectionObserver content only load once scrolled into view. */
  const prime = async (el, maxSteps) => {
    const imgs = el.querySelectorAll ? Array.from(el.querySelectorAll('img')) : [];
    if (el.tagName === 'IMG') imgs.push(el);
    for (const img of imgs) {
      if (img.loading === 'lazy') img.loading = 'eager';
    }
    const rect = rectOf(el);
    const vh = window.innerHeight || 800;
    const startX = window.scrollX;
    const startY = window.scrollY;
    const scroller = document.scrollingElement || document.documentElement;
    const canScroll = scroller && scroller.scrollHeight > vh + 4;
    const wholePage = (maxSteps || 16) > 16;
    const offscreen = wholePage || rect.y + rect.height > vh + 4 || rect.y < -4;
    if (canScroll && offscreen) {
      hud.textContent = 'Loading page…';
      const top = wholePage ? 0 : Math.max(0, rect.y + startY - 40);
      const bottom = wholePage ? scroller.scrollHeight : rect.y + startY + rect.height;
      let y = top;
      for (let step = 0; y < Math.max(bottom, wholePage ? scroller.scrollHeight : 0) && step < (maxSteps || 16); step++) {
        window.scrollTo(startX, y);
        await sleep(wholePage ? 140 : 90);
        y += vh * 0.85;
      }
      window.scrollTo(startX, startY);
      await sleep(80);
    }
    const pending = imgs.filter((img) => (img.currentSrc || img.src) && (!img.complete || !img.naturalWidth));
    if (pending.length) {
      await Promise.race([
        Promise.all(pending.map((img) => (img.decode ? img.decode().catch(() => undefined) : undefined))),
        sleep(offscreen ? 1200 : 450)
      ]);
    }
  };

  const chain = (el) => {
    const list = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      if (interesting(cur)) list.push(cur);
      cur = parentEl(cur);
    }
    return list;
  };

  const currentTarget = () => {
    if (!state.hover) return null;
    const list = chain(state.hover);
    if (!list.length) return null;
    return list[Math.max(0, Math.min(state.climb, list.length - 1))];
  };

  const paint = () => {
    const el = currentTarget();
    if (!el) {
      box.style.display = 'none';
      label.style.display = 'none';
      return;
    }
    const rect = rectOf(el);
    box.style.display = 'block';
    box.style.left = rect.x + 'px';
    box.style.top = rect.y + 'px';
    box.style.width = Math.max(0, rect.width) + 'px';
    box.style.height = Math.max(0, rect.height) + 'px';
    label.textContent = el.tagName.toLowerCase() + '  ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
    label.style.display = 'block';
    const lw = label.offsetWidth || 48;
    const lh = label.offsetHeight || 16;
    let left = rect.x;
    let top = rect.y - lh - 4;
    if (top < 4) top = rect.y + rect.height + 4;
    if (left + lw > window.innerWidth - 4) left = window.innerWidth - lw - 4;
    label.style.left = Math.max(4, left) + 'px';
    label.style.top = top + 'px';
  };

  const pick = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    let cur = hit;
    while (cur && cur !== document.body) {
      if (interesting(cur)) return cur;
      cur = parentEl(cur);
    }
    return interesting(document.body) ? document.body : null;
  };

  /** \`full\` captures the whole page: more layers, a deeper scroll to load lazy content, full height. */
  const capture = async (el, full) => {
    if (!el || state.pending) return;
    const gen = ++state.generation;
    state.pending = true;
    state.maxNodes = full ? MAX_NODES * 3 : MAX_NODES;
    hud.textContent = full ? 'Capturing page…' : 'Capturing…';
    count = 0;
    rasters.length = 0;
    try {
      box.style.display = 'none';
      label.style.display = 'none';
      await prime(el, full ? 80 : 16);
      if (gen !== state.generation) return;
      hud.textContent = full ? 'Capturing page…' : 'Capturing…';
      const tree = buildOne(el, 0);
      if (!tree) throw new Error('Nothing visible to snapshot');
      if (full) {
        // body is often only viewport-tall (height: 100%) while the page overflows it.
        const page = document.scrollingElement || document.documentElement;
        tree.height = Math.max(tree.height, page.scrollHeight - Math.max(0, tree.absY + window.scrollY));
        tree.width = Math.max(tree.width, Math.min(page.scrollWidth, window.innerWidth));
        tree.name = (document.title || location.hostname || 'Page').slice(0, 80);
      }
      await resolveImages(gen);
      if (gen !== state.generation) return;
      tree.children = (tree.children || []).map(collapse);
      finalize(tree, tree.absX, tree.absY);
      // Screenshot fallbacks are cropped from the live page, so the highlight must not be in them.
      root.style.display = 'none';
      state.result = tree;
    } catch (err) {
      if (gen === state.generation) state.error = (err && err.message) || 'Snapshot failed';
    } finally {
      if (gen === state.generation) state.pending = false;
    }
  };

  const onMove = (event) => {
    if (!state.enabled || state.pending) return;
    const next = pick(event.clientX, event.clientY);
    if (next !== state.hover) {
      state.hover = next;
      state.climb = 0;
    }
    paint();
  };

  let arm = false;
  const onPointerDown = (event) => {
    if (!state.enabled) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type !== 'pointerdown') return;
    if (state.pending || arm) return;
    arm = true;
    const target = currentTarget() || pick(event.clientX, event.clientY);
    void capture(target).finally(() => { arm = false; });
  };

  const onKey = (event) => {
    if (!state.enabled) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      state.cancel = true;
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const list = state.hover ? chain(state.hover) : [];
      if (!list.length) return;
      if (event.key === 'ArrowUp') state.climb = Math.min(list.length - 1, state.climb + 1);
      else state.climb = Math.max(0, state.climb - 1);
      paint();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const target = currentTarget();
      if (target) void capture(target);
    }
  };

  const mount = () => {
    if (!root.isConnected) document.documentElement.appendChild(root);
  };

  window[NS] = {
    ready: true,
    version: VERSION,
    enable() {
      state.enabled = true;
      state.cancel = false;
      state.result = null;
      state.error = '';
      root.style.display = '';
      mount();
      document.documentElement.style.cursor = 'crosshair';
      if (window.__vantaMesurer && window.__vantaMesurer.disable) window.__vantaMesurer.disable();
      if (!state.bound) {
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('mousedown', onPointerDown, true);
        window.addEventListener('click', onPointerDown, true);
        window.addEventListener('keydown', onKey, true);
        state.bound = true;
      }
      hud.textContent = 'Snapshot  ·  click to paste  ·  ↑ parent  ·  ↓ child  ·  esc';
      paint();
    },
    disable() {
      state.generation++;
      state.enabled = false;
      state.pending = false;
      state.hover = null;
      state.climb = 0;
      document.documentElement.style.cursor = '';
      box.style.display = 'none';
      label.style.display = 'none';
      if (root.parentNode) root.parentNode.removeChild(root);
      if (state.bound) {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('mousedown', onPointerDown, true);
        window.removeEventListener('click', onPointerDown, true);
        window.removeEventListener('keydown', onKey, true);
        state.bound = false;
      }
    },
    consume() {
      if (state.cancel) {
        state.cancel = false;
        return { status: 'cancel' };
      }
      if (state.error) {
        const message = state.error;
        state.error = '';
        return { status: 'error', message };
      }
      if (state.result) {
        const tree = state.result;
        state.result = null;
        return { status: 'ready', tree, cssWidth: window.innerWidth, cssHeight: window.innerHeight };
      }
      return null;
    },
    /**
     * Snapshot the entire page top to bottom, including everything scrolled out of view.
     * The result is picked up by consume(), the same as a click Snapshot.
     */
    async capturePage() {
      if (state.pending) return { status: 'busy' };
      state.cancel = false;
      state.error = '';
      state.result = null;
      const restore = [];
      const loosen = (el) => {
        restore.push([el, el.getAttribute('style')]);
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
      };
      try {
        window.scrollTo(0, 0);
        await sleep(120);
        const page = document.scrollingElement || document.documentElement;
        const vh = window.innerHeight || 800;
        if (page.scrollHeight <= vh + 4 && document.body) {
          // App-style layouts scroll an inner panel instead of the page: let that panel grow to full height.
          let inner = null;
          let hiddenMost = 40;
          for (const el of document.body.querySelectorAll('*')) {
            if (el.closest('[data-vanta-snapshot]')) continue;
            const hidden = el.scrollHeight - el.clientHeight;
            if (hidden <= hiddenMost || el.clientHeight < vh * 0.4) continue;
            const overflowY = window.getComputedStyle(el).overflowY;
            if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
            inner = el;
            hiddenMost = hidden;
          }
          if (inner) {
            for (let cur = inner; cur && cur !== document.documentElement; cur = cur.parentElement) loosen(cur);
            loosen(document.documentElement);
            await sleep(250);
          }
        }
        await capture(document.body, true);
      } finally {
        for (const [el, css] of restore.reverse()) {
          if (css == null) el.removeAttribute('style');
          else el.setAttribute('style', css);
        }
      }
      return { status: 'started' };
    },
    /** Programmatic capture for MCP / agents (same pipeline as click Snapshot). */
    async captureSelector(selector, allowFallback) {
      const list = Array.isArray(selector) ? selector : [selector];
      const isSnapshotable = (node) => {
        if (!node || node === root || (node.closest && node.closest('[data-vanta-snapshot]'))) return false;
        if (SKIP[node.tagName]) return false;
        const style = window.getComputedStyle(node);
        if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.display === 'contents') return false;
        const rect = rectOf(node);
        return rect.width >= 1 && rect.height >= 1;
      };
      // Prefer tall rails/panels over wide short bars (mastheads) when auto-picking.
      const snapScore = (node) => {
        const r = rectOf(node);
        const h = Math.max(0, r.height);
        const w = Math.max(0, r.width);
        return h * h * Math.min(w, 420);
      };
      const largestVisible = (rootEl) => {
        if (!rootEl) return null;
        let best = isSnapshotable(rootEl) ? rootEl : null;
        let bestScore = best ? snapScore(best) : 0;
        const kids = rootEl.children ? Array.from(rootEl.children) : [];
        for (const kid of kids) {
          if (!isSnapshotable(kid)) continue;
          const score = snapScore(kid);
          if (score > bestScore) {
            best = kid;
            bestScore = score;
          }
        }
        return best;
      };
      let el = null;
      let used = '';
      for (const sel of list) {
        if (!sel || typeof sel !== 'string') continue;
        let candidate = null;
        try {
          candidate = document.querySelector(sel);
        } catch {
          candidate = null;
        }
        if (!candidate) continue;
        if (isSnapshotable(candidate)) {
          el = candidate;
          used = sel;
          break;
        }
        // Hidden drawers / zero-size shells: prefer the tallest useful descendant.
        let bestChild = null;
        let bestScore = 0;
        const nested = candidate.querySelectorAll('*');
        for (const node of nested) {
          if (!isSnapshotable(node)) continue;
          const r = rectOf(node);
          if (r.width * r.height < 80 * 80) continue;
          const score = snapScore(node);
          if (score <= bestScore) continue;
          bestChild = node;
          bestScore = score;
        }
        if (bestChild) {
          el = bestChild;
          used = sel + ' (visible child)';
          break;
        }
      }
      if (!el && allowFallback) {
        el = largestVisible(document.body) || largestVisible(document.documentElement);
        used = el ? 'auto:largest-visible' : '';
      }
      if (!el) {
        return {
          status: 'error',
          message:
            'No visible element to snapshot (page may still be loading, or the target is hidden)'
        };
      }
      state.cancel = false;
      state.error = '';
      state.result = null;
      await capture(el);
      if (state.error) {
        const message = state.error;
        state.error = '';
        return { status: 'error', message };
      }
      if (!state.result) return { status: 'error', message: 'Snapshot produced nothing' };
      const tree = state.result;
      state.result = null;
      return {
        status: 'ready',
        tree,
        selector: used,
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight
      };
    },
    async capturePoint(x, y) {
      const el = pick(Number(x) || 0, Number(y) || 0);
      if (!el) return { status: 'error', message: 'No element at point' };
      state.cancel = false;
      state.error = '';
      state.result = null;
      await capture(el);
      if (state.error) {
        const message = state.error;
        state.error = '';
        return { status: 'error', message };
      }
      if (!state.result) return { status: 'error', message: 'Snapshot produced nothing' };
      const tree = state.result;
      state.result = null;
      return {
        status: 'ready',
        tree,
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight
      };
    }
  };
})();
`

const hashText = (text: string): string => {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

export const SNAPSHOT_SCRIPT = SNAPSHOT_SOURCE.replace('__SNAPSHOT_VERSION__', hashText(SNAPSHOT_SOURCE))
