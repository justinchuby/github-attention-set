/**
 * Create DOM elements safely — no innerHTML, no XSS risk.
 * Usage: h('div', {class: 'foo'}, [h('span', null, 'text'), 'raw text'])
 */
export function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k === 'className') {
        el.className = v;
      } else if (v !== null && v !== undefined && v !== false) {
        el.setAttribute(k, v);
      }
    }
  }
  if (children != null) {
    const items = Array.isArray(children) ? children : [children];
    for (const child of items) {
      if (child == null || child === false) continue;
      el.append(
        typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child,
      );
    }
  }
  return el;
}
