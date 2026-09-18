export const INSPECT_SCRIPT = `
(() => {
  if (window.__vantaInspect) {
    window.__vantaInspect.enable();
    return;
  }
  const overlay = document.createElement('div');
  overlay.setAttribute('data-vanta-inspect', '1');
  overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7aa2ff;background:rgba(122,162,255,0.12);display:none;';
  document.documentElement.appendChild(overlay);
  const skip = (el) => el && (el === overlay || (el.closest && el.closest('[data-vanta-inspect]')));
  const pick = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el || skip(el)) return null;
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
  const onMove = (event) => {
    const info = pick(event.clientX, event.clientY);
    if (!info) { overlay.style.display = 'none'; window.__vantaInspect.last = null; return; }
    overlay.style.display = 'block';
    overlay.style.left = info.rect.x + 'px';
    overlay.style.top = info.rect.y + 'px';
    overlay.style.width = info.rect.width + 'px';
    overlay.style.height = info.rect.height + 'px';
    window.__vantaInspect.last = info;
  };
  const onClick = (event) => {
    const info = pick(event.clientX, event.clientY);
    if (!info) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.__vantaInspect.last = info;
    window.__vantaInspect.clicked = true;
    window.__vantaInspect.pinned = true;
  };
  window.__vantaInspect = {
    enabled: false,
    last: null,
    clicked: false,
    pinned: false,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      document.documentElement.style.cursor = 'crosshair';
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
    },
    disable() {
      this.enabled = false;
      this.pinned = false;
      document.documentElement.style.cursor = '';
      overlay.style.display = 'none';
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
    },
    consume() {
      const clicked = this.clicked;
      this.clicked = false;
      return { clicked, pinned: this.pinned, info: this.last };
    }
  };
  window.__vantaInspect.enable();
})();
`
