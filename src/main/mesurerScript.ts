/** Injected into BrowserView pages for Mesurer-style inspect + x-ray. */
export const MESURER_SCRIPT = `
(() => {
  const NS = '__vantaMesurer';
  if (window[NS] && window[NS].ready) {
    return;
  }

  const root = document.createElement('div');
  root.setAttribute('data-vanta-mesurer', '1');
  root.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';

  const xray = document.createElement('div');
  xray.style.cssText = 'position:absolute;inset:0;overflow:hidden;display:none;';
  root.appendChild(xray);

  const hoverBox = document.createElement('div');
  hoverBox.style.cssText = 'position:fixed;display:none;border:1.5px solid #0d99ff;background:rgba(13,153,255,0.12);box-sizing:border-box;pointer-events:none;';
  root.appendChild(hoverBox);

  const selectBox = document.createElement('div');
  selectBox.style.cssText = 'position:fixed;display:none;border:1.5px solid #0d99ff;background:rgba(13,153,255,0.08);box-sizing:border-box;pointer-events:none;';
  root.appendChild(selectBox);

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;display:none;z-index:2;padding:2px 6px;border-radius:4px;background:#2c2c2c;color:#fff;font:11px/1.2 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;pointer-events:none;';
  root.appendChild(label);

  const measureLayer = document.createElement('div');
  measureLayer.style.cssText = 'position:fixed;inset:0;display:none;pointer-events:none;';
  root.appendChild(measureLayer);

  const skip = (el) => !el || el === root || (el.closest && el.closest('[data-vanta-mesurer]'));

  const interesting = (el) => {
    if (!el || skip(el) || el === document.documentElement || el === document.body) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const tag = el.tagName;
    if (!tag || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'NOSCRIPT') return false;
    return true;
  };

  const infoFrom = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      text: (el.innerText || '').trim().slice(0, 180),
      href: el.href || el.getAttribute('href') || null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: {
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
        fontSize: style.fontSize,
        color: style.color,
        backgroundColor: style.backgroundColor,
        padding: style.padding,
        margin: style.margin
      }
    };
  };

  const pick = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el || skip(el)) return null;
    let cur = el;
    while (cur && cur !== document.body) {
      if (interesting(cur)) return { el: cur, info: infoFrom(cur) };
      cur = cur.parentElement;
    }
    return null;
  };

  const placeLabel = (rect, text) => {
    label.textContent = text;
    label.style.display = 'block';
    const lw = label.offsetWidth || 48;
    const lh = label.offsetHeight || 16;
    let left = rect.x;
    let top = rect.y - lh - 4;
    if (top < 4) top = rect.y + rect.height + 4;
    if (left + lw > window.innerWidth - 4) left = window.innerWidth - lw - 4;
    if (left < 4) left = 4;
    label.style.left = left + 'px';
    label.style.top = top + 'px';
  };

  const paintBox = (box, rect) => {
    box.style.display = 'block';
    box.style.left = rect.x + 'px';
    box.style.top = rect.y + 'px';
    box.style.width = Math.max(0, rect.width) + 'px';
    box.style.height = Math.max(0, rect.height) + 'px';
  };

  const clearMeasures = () => {
    measureLayer.innerHTML = '';
    measureLayer.style.display = 'none';
  };

  const addMeasure = (x1, y1, x2, y2, text) => {
    measureLayer.style.display = 'block';
    const line = document.createElement('div');
    const vertical = Math.abs(x2 - x1) < 0.5;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const len = vertical ? Math.abs(y2 - y1) : Math.abs(x2 - x1);
    line.style.cssText = vertical
      ? 'position:fixed;left:' + x1 + 'px;top:' + top + 'px;width:0;height:' + len + 'px;border-left:1px solid #ff4d4f;box-sizing:border-box;'
      : 'position:fixed;left:' + left + 'px;top:' + y1 + 'px;width:' + len + 'px;height:0;border-top:1px solid #ff4d4f;box-sizing:border-box;';
    measureLayer.appendChild(line);
    const badge = document.createElement('div');
    badge.textContent = text;
    badge.style.cssText = 'position:fixed;left:' + ((x1 + x2) / 2) + 'px;top:' + ((y1 + y2) / 2) + 'px;transform:translate(-50%,-50%);padding:1px 5px;border-radius:3px;background:#ff4d4f;color:#fff;font:10px/1.2 ui-sans-serif,system-ui,sans-serif;';
    measureLayer.appendChild(badge);
  };

  const measureBetween = (a, b) => {
    clearMeasures();
    if (!a || !b) return;
    const A = a.rect, B = b.rect;
    if (B.x >= A.x + A.width) {
      const y = (Math.max(A.y, B.y) + Math.min(A.y + A.height, B.y + B.height)) / 2;
      addMeasure(A.x + A.width, y, B.x, y, Math.round(B.x - (A.x + A.width)));
    } else if (A.x >= B.x + B.width) {
      const y = (Math.max(A.y, B.y) + Math.min(A.y + A.height, B.y + B.height)) / 2;
      addMeasure(B.x + B.width, y, A.x, y, Math.round(A.x - (B.x + B.width)));
    }
    if (B.y >= A.y + A.height) {
      const x = (Math.max(A.x, B.x) + Math.min(A.x + A.width, B.x + B.width)) / 2;
      addMeasure(x, A.y + A.height, x, B.y, Math.round(B.y - (A.y + A.height)));
    } else if (A.y >= B.y + B.height) {
      const x = (Math.max(A.x, B.x) + Math.min(A.x + A.width, B.x + B.width)) / 2;
      addMeasure(x, B.y + B.height, x, A.y, Math.round(A.y - (B.y + B.height)));
    }
  };

  let xrayTimer = null;
  const renderXray = () => {
    xray.innerHTML = '';
    if (!state.xray) return;
    const nodes = document.body ? document.body.querySelectorAll('*') : [];
    const max = Math.min(nodes.length, 2500);
    for (let i = 0; i < max; i++) {
      const el = nodes[i];
      if (!interesting(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) continue;
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;border:1px solid rgba(13,153,255,0.55);box-sizing:border-box;pointer-events:none;';
      xray.appendChild(box);
    }
  };

  const state = {
    ready: true,
    enabled: false,
    inspect: false,
    xray: false,
    alt: false,
    last: null,
    selected: null,
    clicked: false,
    pinned: false
  };

  const onMove = (event) => {
    if (!state.enabled || (!state.inspect && !state.alt)) return;
    const hit = pick(event.clientX, event.clientY);
    if (!hit) {
      hoverBox.style.display = 'none';
      if (!state.selected) label.style.display = 'none';
      state.last = null;
      clearMeasures();
      return;
    }
    state.last = hit.info;
    paintBox(hoverBox, hit.info.rect);
    placeLabel(hit.info.rect, Math.round(hit.info.rect.width) + ' × ' + Math.round(hit.info.rect.height));
    if (state.alt && state.selected) measureBetween(state.selected, hit.info);
    else if (!state.alt) clearMeasures();
  };

  const onClick = (event) => {
    if (!state.enabled || !state.inspect) return;
    const hit = pick(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.selected = hit.info;
    state.last = hit.info;
    state.clicked = true;
    state.pinned = true;
    paintBox(selectBox, hit.info.rect);
    placeLabel(hit.info.rect, Math.round(hit.info.rect.width) + ' × ' + Math.round(hit.info.rect.height));
  };

  const onKey = (event) => {
    if (event.key === 'Alt') {
      state.alt = event.type === 'keydown';
      if (!state.alt) clearMeasures();
    }
  };

  const ensureMounted = () => {
    if (!root.isConnected) document.documentElement.appendChild(root);
  };

  const applyMode = () => {
    ensureMounted();
    document.documentElement.style.cursor = state.enabled && state.inspect ? 'crosshair' : '';
    xray.style.display = state.enabled && state.xray ? 'block' : 'none';
    if (!(state.enabled && state.inspect)) {
      hoverBox.style.display = 'none';
      if (!state.selected) {
        selectBox.style.display = 'none';
        label.style.display = 'none';
      }
    }
    if (state.enabled && state.xray) renderXray();
    else xray.innerHTML = '';
  };

  window[NS] = {
    ready: true,
    enable(opts) {
      state.enabled = true;
      if (opts && typeof opts.inspect === 'boolean') state.inspect = opts.inspect;
      if (opts && typeof opts.xray === 'boolean') state.xray = opts.xray;
      if (!state._bound) {
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('click', onClick, true);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKey, true);
        window.addEventListener('scroll', () => { if (state.xray) renderXray(); }, true);
        window.addEventListener('resize', () => { if (state.xray) renderXray(); }, true);
        state._bound = true;
      }
      if (xrayTimer) clearInterval(xrayTimer);
      xrayTimer = setInterval(() => { if (state.xray) renderXray(); }, 900);
      applyMode();
    },
    setMode(opts) {
      if (!state.enabled) this.enable(opts || {});
      else {
        if (opts && typeof opts.inspect === 'boolean') state.inspect = opts.inspect;
        if (opts && typeof opts.xray === 'boolean') state.xray = opts.xray;
        applyMode();
      }
    },
    disable() {
      state.enabled = false;
      state.inspect = false;
      state.xray = false;
      state.pinned = false;
      state.selected = null;
      state.last = null;
      hoverBox.style.display = 'none';
      selectBox.style.display = 'none';
      label.style.display = 'none';
      clearMeasures();
      xray.innerHTML = '';
      xray.style.display = 'none';
      document.documentElement.style.cursor = '';
      if (xrayTimer) { clearInterval(xrayTimer); xrayTimer = null; }
    },
    consume() {
      const clicked = state.clicked;
      state.clicked = false;
      return { clicked, pinned: state.pinned, info: state.last || state.selected };
    }
  };

  // Back-compat with old inspect API
  window.__vantaInspect = {
    enable() { window[NS].enable({ inspect: true, xray: false }); },
    disable() { window[NS].disable(); },
    consume() { return window[NS].consume(); }
  };
})();
`
