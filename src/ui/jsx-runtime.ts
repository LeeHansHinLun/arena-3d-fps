/**
 * Minimal JSX runtime. `tsconfig.json` sets `jsxImportSource: "@/ui"`, so every
 * `.tsx` file compiles to calls into this module instead of React.
 */
import { Fragment, h } from './dom';
import type { JsxChild, Props } from './dom';

type Tag = string | ((props: Props) => Node);

function create(type: Tag, props: Props | null, key?: unknown): Node {
  const p: Props = props ? { ...props } : {};
  // the automatic runtime hands the element's `key` over as a separate argument
  if (key !== undefined) p.key = key;
  return h(type as unknown, p);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const jsx = create as (type: any, props: any, key?: any) => Node;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const jsxs = jsx as unknown as (type: any, props: any, key?: any) => Node;
export { jsx as jsxDEV, Fragment };
export type { JsxChild };

type Handler = (e: any) => void;

interface DOMProps {
  onClick?: Handler;
  onDoubleClick?: Handler;
  onChange?: Handler;
  onInput?: Handler;
  onKeyDown?: Handler;
  onKeyUp?: Handler;
  onPointerDown?: Handler;
  onPointerUp?: Handler;
  onPointerMove?: Handler;
  onPointerCancel?: Handler;
  onPointerLeave?: Handler;
  onMouseDown?: Handler;
  onMouseUp?: Handler;
  onMouseMove?: Handler;
  onMouseEnter?: Handler;
  onMouseLeave?: Handler;
  onScroll?: Handler;
  onTouchStart?: Handler;
  onTouchMove?: Handler;
  onTouchEnd?: Handler;
  onContextMenu?: Handler;
  onWheel?: Handler;
  onFocus?: Handler;
  onBlur?: Handler;
  onSubmit?: Handler;
  ref?: any;
}

export declare namespace JSX {
  type Element = Node;
  interface ElementChildrenAttribute {
    children: any;
  }
  interface IntrinsicAttributes {
    key?: unknown;
  }
  interface IntrinsicElements {
    [tag: string]: DOMProps & { [key: string]: any };
  }
}
