/**
 * Injected into a canvas browser for Paper-style snapshot.
 * Hover highlights an element; ↑/↓ walks the ancestor chain; click or Enter
 * serializes that subtree (computed styles + images) so the shell can paste
 * it onto the design canvas.
 */
export const SNAPSHOT_SCRIPT = `
(() => {
  const NS = '__vantaSnapshot';
  if (window[NS] && window[NS].ready) return;

  const MAX_NODES = 600;
  const MAX_DEPTH = 16;
  const MAX_IMAGES = 36;
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
    bound: false
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

  const hasBox = (style) => {
    if (parseColor(style.backgroundColor)) return true;
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    if ((parseFloat(style.borderTopWidth) || 0) > 0) return true;
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
      shadow: parseShadow(style.boxShadow),
      layerBlur: blurPx(style.filter) || undefined,
      backgroundBlur: blurPx(style.backdropFilter) || undefined,
      children: []
    };
  };

  const addStroke = (node, style) => {
    const width = Math.max(
      parseFloat(style.borderTopWidth) || 0,
      parseFloat(style.borderRightWidth) || 0,
      parseFloat(style.borderBottomWidth) || 0,
      parseFloat(style.borderLeftWidth) || 0
    );
    if (width <= 0) return;
    const color = parseColor(style.borderTopColor) || parseColor(style.borderColor);
    if (!color) return;
    node.stroke = color;
    node.strokeWidth = width;
  };

  const buildOne = (el, depth) => {
    if (count >= MAX_NODES || depth > MAX_DEPTH || skipEl(el)) return null;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return null;
    if (style.display === 'contents') return null;
    const rect = rectOf(el);
    if (rect.width < 1 || rect.height < 1) return null;
    count++;
    const tag = el.tagName;
    const node = baseNode(el, rect, style);
    addStroke(node, style);

    if (tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG' || tag === 'VIDEO') {
      node.kind = 'image';
      node.name = layerName(el, el.alt || '');
      const src = tag === 'IMG' ? (el.currentSrc || el.src || '') : tag === 'VIDEO' ? (el.poster || '') : '';
      rasters.push({ node, el: tag === 'VIDEO' ? null : el, src, w: rect.width, h: rect.height });
      return node;
    }

    const kids = childElements(el);
    const text = leafText(el);
    node.name = layerName(el, text);
    node.fill = fillOf(style);

    if (!kids.length && text) {
      const styled = textStyle(style, text);
      if (!hasBox(style) && !node.fill && !(node.strokeWidth > 0)) {
        node.kind = 'text';
        node.text = text;
        Object.assign(node, styled);
        return node;
      }
      const padL = parseFloat(style.paddingLeft) || 0;
      const padT = parseFloat(style.paddingTop) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      const padB = parseFloat(style.paddingBottom) || 0;
      node.children.push(Object.assign({
        kind: 'text',
        tag: 'span',
        name: text.slice(0, 64),
        absX: rect.x + padL,
        absY: rect.y + padT,
        x: 0,
        y: 0,
        width: Math.max(1, rect.width - padL - padR),
        height: Math.max(1, rect.height - padT - padB),
        text,
        children: []
      }, styled));
      return node;
    }

    if (node.fill && node.fill.type === 'image' && node.fill.src) {
      rasters.push({ node, el: null, src: node.fill.src, w: rect.width, h: rect.height, background: true });
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
    if (!node.children.length && !node.fill && !(node.strokeWidth > 0) && !node.shadow) return null;
    return node;
  };

  const finalize = (node, parentX, parentY) => {
    const absX = node.absX;
    const absY = node.absY;
    node.x = Math.round(absX - parentX);
    node.y = Math.round(absY - parentY);
    node.width = Math.round(node.width);
    node.height = Math.round(node.height);
    delete node.absX;
    delete node.absY;
    if (node.fill && node.fill.src) delete node.fill.src;
    for (const child of node.children || []) finalize(child, absX, absY);
  };

  const blobToData = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const urlToData = async (url) => {
    if (!url) return null;
    if (url.indexOf('data:') === 0) return url;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await blobToData(await res.blob());
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const drawToData = (drawable, width, height) => {
    try {
      const maxEdge = 1100;
      const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.84);
    } catch (err) {
      return null;
    }
  };

  const rasterize = async (entry) => {
    const el = entry.el;
    if (el && el.tagName === 'CANVAS') {
      try { return el.toDataURL('image/jpeg', 0.84); } catch (err) { return null; }
    }
    if (el && el.tagName === 'IMG') {
      const drawn = drawToData(el, entry.w, entry.h);
      if (drawn) return drawn;
    }
    if (el && el.tagName === 'SVG') {
      try {
        const clone = el.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(Math.max(1, Math.round(entry.w))));
        clone.setAttribute('height', String(Math.max(1, Math.round(entry.h))));
        const xml = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        const href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = href; });
        return drawToData(img, entry.w, entry.h);
      } catch (err) {
        return null;
      }
    }
    return urlToData(entry.src);
  };

  const resolveImages = async (gen) => {
    const jobs = rasters.slice(0, MAX_IMAGES);
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        if (gen !== state.generation) return;
        const entry = jobs[cursor++];
        const data = await rasterize(entry);
        if (gen !== state.generation) return;
        if (data) {
          if (entry.background) entry.node.fill = { type: 'image', dataUrl: data };
          else {
            entry.node.kind = 'image';
            entry.node.fill = { type: 'image', dataUrl: data };
          }
        } else if (!entry.background) {
          entry.node.shot = {
            x: Math.round(entry.node.absX),
            y: Math.round(entry.node.absY),
            width: Math.round(entry.w),
            height: Math.round(entry.h)
          };
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
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

  const capture = async (el) => {
    if (!el || state.pending) return;
    const gen = ++state.generation;
    state.pending = true;
    hud.textContent = 'Capturing…';
    count = 0;
    rasters.length = 0;
    try {
      const tree = buildOne(el, 0);
      if (!tree) throw new Error('Nothing visible to snapshot');
      await resolveImages(gen);
      if (gen !== state.generation) return;
      finalize(tree, tree.absX, tree.absY);
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
    enable() {
      state.enabled = true;
      state.cancel = false;
      state.result = null;
      state.error = '';
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
    }
  };
})();
`
