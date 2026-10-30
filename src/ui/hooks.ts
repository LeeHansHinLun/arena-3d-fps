/**
 * A tiny, synchronous hooks implementation for the vanilla `component()` runtime.
 *
 * Components are plain functions: `build(props)` runs on every render, so the
 * call order of hooks is stable (the same guarantee React gives). State lives in
 * slots keyed by the owning `View`, which means re-entrant builds (a child
 * component rendered from inside a parent) each get their own slot list.
 */
import type { View } from './dom';

export type Deps = readonly unknown[] | undefined;

interface Slot {
  value?: unknown;
  filled?: boolean;
  deps?: Deps;
  cleanup?: () => void;
}

interface Store {
  slots: Slot[];
  /** Effects queued by the build that just finished. */
  queue: (() => void)[];
}

interface Ctx {
  view: View<Record<string, unknown>>;
  store: Store;
  i: number;
}

const stores = new WeakMap<View<Record<string, unknown>>, Store>();
const stack: Ctx[] = [];

/** Called by `component()` before running `build`. */
export function beginRender<P extends object>(view: View<P>): void {
  const v = view as unknown as View<Record<string, unknown>>;
  let store = stores.get(v);
  if (!store) {
    store = { slots: [], queue: [] };
    stores.set(v, store);
    const s = store;
    view.onUpdate(() => drain(s));
    view.cleanup(() => {
      for (const sl of s.slots) sl.cleanup?.();
    });
  }
  stack.push({ view: v, store, i: 0 });
}

/** Called by `component()` once `build` returned (or threw). */
export function endRender(): void {
  stack.pop();
}

function drain(store: Store): void {
  if (!store.queue.length) return;
  const q = store.queue;
  store.queue = [];
  for (const fn of q) fn();
}

function ctx(): Ctx {
  const c = stack[stack.length - 1];
  if (!c) throw new Error('hooks can only be called while rendering a component');
  return c;
}

function nextSlot(c: Ctx): Slot {
  let s = c.store.slots[c.i];
  if (!s) s = c.store.slots[c.i] = {};
  c.i++;
  return s;
}

function depsChanged(prev: Deps, next: Deps): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) if (!Object.is(prev[i], next[i])) return true;
  return false;
}

export function useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
  const c = ctx();
  const s = nextSlot(c);
  if (!s.filled) {
    s.value = typeof init === 'function' ? (init as () => S)() : init;
    s.filled = true;
  }
  const setState = (next: S | ((prev: S) => S)) => {
    const prev = s.value as S;
    const value = typeof next === 'function' ? (next as (p: S) => S)(prev) : next;
    if (Object.is(value, prev)) return;
    s.value = value;
    c.view.update();
  };
  return [s.value as S, setState];
}

export function useReducer<S, A>(reducer: (s: S, a: A) => S, init: S): [S, (a: A) => void] {
  const c = ctx();
  const s = nextSlot(c);
  if (!s.filled) {
    s.value = init;
    s.filled = true;
  }
  return [
    s.value as S,
    (action: A) => {
      const value = reducer(s.value as S, action);
      if (Object.is(value, s.value)) return;
      s.value = value;
      c.view.update();
    },
  ];
}

export function useRef<T>(init: T): { current: T } {
  const s = nextSlot(ctx());
  if (!s.filled) {
    s.value = { current: init };
    s.filled = true;
  }
  return s.value as { current: T };
}

export function useMemo<T>(fn: () => T, deps: Deps): T {
  const c = ctx();
  let s = c.store.slots[c.i];
  if (!s || !s.filled || depsChanged(s.deps, deps)) {
    if (!s) s = c.store.slots[c.i] = {};
    s.value = fn();
    s.deps = deps ? [...deps] : deps;
    s.filled = true;
  }
  c.i++;
  return s.value as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCallback<T extends (...args: any[]) => unknown>(fn: T, deps: Deps): T {
  return useMemo(() => fn, deps);
}

export function useEffect(fn: () => void | (() => void), deps?: Deps): void {
  const c = ctx();
  const s = nextSlot(c);
  if (!depsChanged(s.deps, deps)) return;
  s.deps = deps ? [...deps] : deps;
  c.store.queue.push(() => {
    s.cleanup?.();
    const cleanup = fn();
    s.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
}

export function useLayoutEffect(fn: () => void | (() => void), deps?: Deps): void {
  useEffect(fn, deps);
}
