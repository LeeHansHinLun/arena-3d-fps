import { beginRender, endRender } from './hooks';

/**
 * NEON RIOT · tiny JSX DOM runtime
 * -----------------------------------------------------------------------------
 * The game UI is written with JSX but rendered straight into real DOM nodes —
 * there is no virtual DOM framework and no runtime dependency.
 *
 *   h(tag, props, ...children)   creates an element (or a DocumentFragment for
 *                                <Fragment>), applying attributes, styles and
 *                                event handlers.
 *   component(props, build)      re-renders by rebuilding the element and
 *                                patching it into the existing DOM tree, which
 *                                keeps focus, scroll position and live elements
 *                                (canvas, inputs) intact.
 *
 * Event handlers are attached once per element and always dispatch to the
 * latest props, so re-rendering never stacks listeners.
 */

export type JsxChild = Node | string | number | boolean | null | undefined | JsxChild[];

export interface Props {
  [key: string]: unknown;
  children?: JsxChild;
}

const NODES = Symbol('nr.props');
const KEY = Symbol('nr.key');
const STYLE = Symbol('nr.style');
const ATTRS = Symbol('nr.attrs');

export const Fragment = Symbol('Fragment');

interface Tracked extends HTMLElement {
  [NODES]?: Props;
  [KEY]?: unknown;
  [STYLE]?: Record<string, unknown>;
  [ATTRS]?: string[];
  [EVENTS]?: Record<string, true>;
  [ROOT]?: true;
  [SLOT]?: Node;
}
/** Marks the root element owned by a component instance. */
const ROOT = Symbol('nr.root');
/** Placeholder that keeps a reused component root in its tree position. */
const SLOT = Symbol('nr.slot');
/** Anything that can carry a slot placeholder (comments included). */
type SlotHost = Node & { [SLOT]?: Node };
const EVENTS = Symbol('nr.events');

const SVG_TAGS = new Set(['svg', 'path', 'circle', 'g', 'line', 'polyline', 'polygon', 'rect', 'ellipse', 'defs']);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Style properties that take a bare number (no "px" suffix). */
const UNITLESS = new Set([
  'opacity', 'zIndex', 'lineHeight', 'flexGrow', 'flexShrink', 'flex', 'order', 'zoom', 'fontWeight',
  'columnCount', 'gridRow', 'gridColumn', 'gridRowStart', 'gridRowEnd', 'gridColumnStart', 'gridColumnEnd',
  'animationIterationCount', 'aspectRatio', 'scale', 'rotate',
]);

const NON_PASSIVE = new Set(['wheel', 'touchstart', 'touchmove']);

/** "onPointerDown" -> ["pointerdown"]. `onChange` behaves like React: "input". */
function eventTypes(prop: string): string[] {
  if (!prop.startsWith('on') || prop.length < 4) return [];
  if (prop === 'onChange' || prop === 'onInput') return ['input'];
  if (prop === 'onDoubleClick') return ['dblclick'];
  if (prop === 'onMouseEnter' || prop === 'onMouseLeave') return [prop === 'onMouseEnter' ? 'mouseenter' : 'mouseleave'];
  return [prop.slice(2).toLowerCase()];
}

function isEventProp(prop: string) {
  return eventTypes(prop).length > 0;
}

function attachEvent(el: Element, prop: string) {
  const store = el as Tracked;
  const done = store[EVENTS] ?? (store[EVENTS] = {});
  if (done[prop]) return;
  done[prop] = true;
  for (const type of eventTypes(prop)) {
    el.addEventListener(
      type,
      (e) => {
        const handler = store[NODES]?.[prop];
        if (typeof handler === 'function') (handler as (ev: Event) => void)(e);
      },
      NON_PASSIVE.has(type) ? { passive: false } : undefined,
    );
  }
}

function setStyleValue(el: HTMLElement, prop: string, value: unknown) {
  if (prop.startsWith('--')) {
    if (value == null || value === '') el.style.removeProperty(prop);
    else el.style.setProperty(prop, String(value));
    return;
  }
  let v: unknown = value;
  if (typeof v === 'number' && !UNITLESS.has(prop)) v = `${v}px`;
  if (v == null || v === false) el.style[prop as never] = '' as never;
  else el.style[prop as never] = String(v) as never;
}

function applyStyle(el: HTMLElement, style: unknown) {
  const store = el as Tracked;
  if (typeof style === 'string') {
    el.style.cssText = style;
    store[STYLE] = {};
    return;
  }
  const next = (style ?? {}) as Record<string, unknown>;
  const prev = store[STYLE] ?? {};
  for (const k of Object.keys(prev)) if (!(k in next)) setStyleValue(el, k, '');
  for (const [k, v] of Object.entries(next)) setStyleValue(el, k, v);
  store[STYLE] = { ...next };
}

function applyProps(el: Element, props: Props) {
  const store = el as Tracked;
  store[NODES] = props;
  const prevAttrs = store[ATTRS] ?? [];
  const setAttrs: string[] = [];

  if (!('style' in props)) applyStyle(el as HTMLElement, null);
  if (!('class' in props) && !('className' in props) && el.hasAttribute('class')) el.removeAttribute('class');

  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key') continue;
    if (key === 'className' || key === 'class') {
      const cls = value == null ? '' : String(value);
      if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
      continue;
    }
    if (key === 'style') {
      applyStyle(el as HTMLElement, value);
      continue;
    }
    if (key === 'ref') {
      if (typeof value === 'function') (value as (node: Element) => void)(el);
      continue;
    }
    if (typeof value === 'function' && isEventProp(key)) {
      attachEvent(el, key);
      continue;
    }
    if (key === 'value') {
      const v = value == null ? '' : String(value);
      if ((el as HTMLInputElement).value !== v) (el as HTMLInputElement).value = v;
      continue;
    }
    if (key === 'checked') {
      const v = !!value;
      if ((el as HTMLInputElement).checked !== v) (el as HTMLInputElement).checked = v;
      continue;
    }
    if (value === false || value == null) {
      el.removeAttribute(key);
      continue;
    }
    setAttrs.push(key);
    if (el.getAttribute(key) !== (value === true ? '' : String(value))) el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const key of prevAttrs) if (!setAttrs.includes(key)) el.removeAttribute(key);
  store[ATTRS] = setAttrs;
}

function flatten(children: JsxChild[], out: Node[]) {
  for (const child of children) {
    if (child == null || child === true || child === false) continue;
    if (Array.isArray(child)) flatten(child, out);
    else if (child instanceof Node) out.push(child);
    else out.push(document.createTextNode(String(child)));
  }
}

export function appendChildren(parent: Node, children: JsxChild[]) {
  const nodes: Node[] = [];
  flatten(children, nodes);
  for (const n of nodes) {
    // A component root that is already mounted must not be pulled into the
    // freshly built tree: `appendChild` would detach it from the live DOM for
    // the duration of the build, which kills pointer capture on whatever is
    // being dragged (sliders) and makes the UI flicker. Index it behind a
    // placeholder instead and let `morph` reconcile it in place.
    if ((n as Tracked)[ROOT] && n.parentNode) {
      const marker = document.createComment('') as SlotHost;
      marker[SLOT] = n;
      parent.appendChild(marker);
      continue;
    }
    parent.appendChild(n);
  }
}

/**
 * Replaces any slot placeholders inside `n` with the component roots they
 * stand for, so the subtree can be inserted into the live document. Returns
 * the node to insert.
 */
function materialize(n: Node): Node {
  const slot = (n as Tracked)[SLOT];
  if (slot) return slot;
  if (n.nodeType !== 1 && n.nodeType !== 11) return n;
  const walker = document.createTreeWalker(n, NodeFilter.SHOW_COMMENT);
  const markers: Comment[] = [];
  while (walker.nextNode()) {
    const cur = walker.currentNode as SlotHost;
    if (cur[SLOT]) markers.push(cur as Comment);
  }
  for (const m of markers) {
    const real = (m as SlotHost)[SLOT] as Node;
    m.parentNode?.replaceChild(real, m);
  }
  return n;
}

/** JSX factory. */
export function h(type: unknown, props: Props | null, ...children: JsxChild[]): Node {
  const p: Props = props ? { ...props } : {};
  if (!children.length && p.children != null) children = [p.children as JsxChild];
  else if (children.length) p.children = children.length === 1 ? children[0] : children;

  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    appendChildren(frag, children);
    return frag;
  }
  if (typeof type === 'function') {
    const node = (type as (props: Props) => JsxChild)(p);
    // `null` / booleans render nothing; a comment keeps sibling position stable
    if (node == null || typeof node === 'boolean') return document.createComment('');
    if (!(node instanceof Node)) {
      throw new Error('JSX component returned a View — render `Component(props).root` instead: ' + ((type as { name?: string }).name ?? 'anonymous'));
    }
    if (p.key !== undefined && node instanceof Element) (node as Tracked)[KEY] = p.key;
    return node;
  }

  const tag = String(type);
  const el = SVG_TAGS.has(tag)
    ? (document.createElementNS(SVG_NS, tag) as unknown as HTMLElement)
    : document.createElement(tag);
  const store = el as Tracked;
  if (p.key !== undefined) store[KEY] = p.key;
  applyProps(el, p);
  appendChildren(el, children);
  return el;
}

export const jsx = h;
export const jsxs = h;

function sameNode(a: Node, b: Node): boolean {
  if (a === b) return true;
  // A component owns the element it renders into. When a new component root
  // shows up where another node used to be, adopt it as-is instead of patching
  // its content into that node — otherwise the component would keep updating a
  // detached tree and changes would only appear one render later.
  if ((b as Tracked)[ROOT]) return false;
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  const ea = a as Tracked;
  const eb = b as Tracked;
  return ea.tagName === eb.tagName && ea[KEY] === eb[KEY];
}

/**
 * Patches `next` into `prev` and returns the node to keep in the tree. Elements
 * are reused whenever tag and key match, so focus, scroll offsets, canvas
 * buffers and pointer captures survive a re-render.
 */
export function morph(prev: Node, next: Node): Node {
  // Never let a slot placeholder reach the live tree: resolve it to the
  // component root it stands for.
  next = (next as SlotHost)[SLOT] ?? next;
  if (prev === next) return prev;
  if (!sameNode(prev, next)) return next;
  if (prev.nodeType !== 1) {
    if (prev.nodeValue !== next.nodeValue) prev.nodeValue = next.nodeValue;
    return prev;
  }
  const a = prev as Tracked;
  const b = next as Tracked;
  applyProps(a, b[NODES] ?? {});
  const incoming = [...b.childNodes];
  for (let i = 0; i < incoming.length; i++) {
    const raw = incoming[i];
    const target = (raw as SlotHost)[SLOT] ?? raw;
    const cur = a.childNodes[i];
    if (!cur) {
      a.appendChild(materialize(target));
      continue;
    }
    if (cur === target) continue;
    const merged = morph(cur, target);
    if (merged !== cur) cur.replaceWith(materialize(merged));
  }
  while (a.childNodes.length > incoming.length) a.lastChild?.remove();
  return a;
}

/* -------------------------------------------------------------------------- */
/*  Components                                                                */
/* -------------------------------------------------------------------------- */

export interface Disposable {
  cleanup(fn: () => void): void;
}

export interface View<P extends object> extends Disposable {
  readonly root: HTMLElement;
  readonly props: P;
  set(patch: Partial<P>): void;
  update(): void;
  /** Registers a callback that runs after every render (canvas painting, measuring…). */
  onUpdate(fn: () => void): void;
  dispose(): void;
}

/**
 * Creates a stateful component. `build` is a plain function of the current
 * props; call `set()` / `update()` whenever local state changes.
 */
export function component<P extends object>(initial: P, build: (props: P) => Node): View<P> {
  let root: HTMLElement | null = null;
  const teardowns: (() => void)[] = [];
  const commits: (() => void)[] = [];
  let disposed = false;

  const view: View<P> = {
    props: initial,
    get root() {
      if (!root) throw new Error('component rendered before build');
      return root;
    },
    set(patch) {
      Object.assign(view.props, patch);
      view.update();
    },
    update() {
      if (disposed) return;
      beginRender(view);
      let next: HTMLElement;
      try {
        next = build(view.props) as HTMLElement;
      } finally {
        endRender();
      }
      if (!root) {
        root = materialize(next) as HTMLElement;
        (root as Tracked)[ROOT] = true;
      } else {
        const merged = morph(root, next);
        if (merged !== root) {
          root.replaceWith(materialize(merged));
          root = merged as HTMLElement;
        }
        (root as Tracked)[ROOT] = true;
      }
      for (const fn of commits) fn();
    },
    onUpdate(fn) {
      commits.push(fn);
    },
    cleanup(fn) {
      teardowns.push(fn);
    },
    dispose() {
      disposed = true;
      for (const fn of teardowns.splice(0)) fn();
      root?.remove();
      root = null;
    },
  };
  view.update();
  return view;
}

/** Adds an event listener that is removed when the view is disposed. */
/**
 * Keeps a child component instance alive across parent re-renders, keyed by
 * `key`. Returns the child's root node so it can be embedded in the parent's
 * JSX. Mirrors what React does for a `<Child/>` element.
 */
export function subView<P extends object>(
  cache: Map<unknown, View<P>>,
  key: unknown,
  build: (props: P) => View<P>,
  props: P,
): Node {
  let child = cache.get(key);
  if (!child) {
    child = build(props);
    cache.set(key, child);
  } else {
    Object.assign(child.props, props);
    child.update();
  }
  return child.root;
}

export function listen(
  view: Disposable,
  target: Window | Document | HTMLElement,
  type: string,
  fn: (e: Event) => void,
  options?: AddEventListenerOptions,
) {
  target.addEventListener(type, fn, options);
  view.cleanup(() => target.removeEventListener(type, fn, options));
}

export function every(view: Disposable, fn: () => void, ms: number, immediate = false) {
  if (immediate) fn();
  const id = window.setInterval(fn, ms);
  view.cleanup(() => window.clearInterval(id));
  return id;
}

export function after(view: Disposable, fn: () => void, ms: number) {
  const id = window.setTimeout(fn, ms);
  view.cleanup(() => window.clearTimeout(id));
  return id;
}
