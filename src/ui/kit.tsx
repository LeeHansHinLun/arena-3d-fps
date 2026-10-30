import { audio } from '@/game/audio';
import type { LevelData } from '@/game/levels';
import { renderLevelMap } from '@/game/levelMesh';
import type { JsxChild } from './dom';

export const sfx = {
  ui: () => audio.play('ui'),
  hover: () => audio.play('uiHover'),
  back: () => audio.play('uiBack'),
};

type Variant = 'primary' | 'cyan' | 'yellow' | 'ghost' | 'danger';

/** Joins class names, dropping falsy values. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const BTN_VARIANT: Record<Variant, string> = {
  primary: 'bg-neon-pink text-white hover:bg-white hover:text-ink shadow-[0_0_22px_rgba(255,45,149,0.45)]',
  cyan: 'bg-neon-cyan text-ink hover:bg-white shadow-[0_0_22px_rgba(45,226,255,0.4)]',
  yellow: 'bg-neon-yellow text-ink hover:bg-white shadow-[0_0_22px_rgba(255,225,77,0.4)]',
  ghost: 'bg-panel2/80 text-white/90 hover:bg-neon-cyan/20 hover:text-neon-cyan shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] hover:shadow-[inset_0_0_0_1px_rgba(45,226,255,0.9)]',
  danger: 'bg-neon-red/90 text-white hover:bg-white hover:text-ink',
};

const BTN_SIZE = { sm: 'px-3 py-1.5 text-xs', md: 'px-5 py-2.5 text-sm', lg: 'px-8 py-4 text-lg' };

export function Btn(props: {
  children?: JsxChild;
  onClick?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  title?: string;
  back?: boolean;
}) {
  const variant = props.variant ?? 'primary';
  const size = props.size ?? 'md';
  // a disabled button never gets the interactive (hover/active) utilities — the
  // values below are exactly what the old clsx + tailwind-merge combination produced
  const flavour = props.disabled
    ? BTN_VARIANT[variant].split(' ').filter((t) => !t.startsWith('hover:') && !t.startsWith('active:')).join(' ')
    : BTN_VARIANT[variant];
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onMouseEnter={() => !props.disabled && sfx.hover()}
      onClick={() => {
        if (props.disabled) return;
        audio.init();
        props.back ? sfx.back() : sfx.ui();
        props.onClick?.();
      }}
      className={cx(
        'cut-sm font-display font-bold uppercase tracking-[0.18em] transition-all duration-150',
        props.disabled ? null : 'active:scale-95',
        'select-none',
        flavour,
        BTN_SIZE[size],
        !!props.disabled && 'opacity-40 cursor-not-allowed hover:bg-panel2 hover:text-white/90 active:scale-100',
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function Panel(props: {
  title: string;
  onClose?: () => void;
  children?: JsxChild;
  className?: string;
  right?: JsxChild;
}) {
  return (
    <div className={cx('cut glass neon-border flex flex-col min-h-0 pop-in', props.className)}>
      <div className="flex items-center gap-3 border-b border-line/80 px-5 py-3 shrink-0">
        <span className="h-3 w-3 rotate-45 bg-neon-pink shadow-[0_0_10px_#ff2d95]" />
        <h2 className="font-display text-base font-extrabold uppercase tracking-[0.25em] text-white sm:text-lg">{props.title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {props.right}
          {props.onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                sfx.back();
                props.onClose?.();
              }}
              className="h-8 w-8 cut-sm bg-panel2 text-lg leading-none text-white/80 transition hover:bg-neon-pink hover:text-white"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {props.children}
    </div>
  );
}

export function Modal(props: { children?: JsxChild; onClose?: () => void; z?: number }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm fade-in sm:p-6"
      style={{ zIndex: props.z ?? 50 }}
      onPointerDown={(e: PointerEvent) => {
        if (e.target === e.currentTarget) props.onClose?.();
      }}
    >
      {props.children}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  color?: string;
}) {
  const step = props.step ?? 0.01;
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <label className="block py-1.5">
      <div className="mb-0.5 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-white/80">
        <span>{props.label}</span>
        <span className="font-display text-xs text-neon-cyan">{props.format ? props.format(props.value) : props.value.toFixed(2)}</span>
      </div>
      <input
        className="nr"
        type="range"
        min={props.min}
        max={props.max}
        step={step}
        value={props.value}
        style={{ '--pct': pct + '%', '--fill': props.color ?? '#ff2d95' }}
        onChange={(e: Event) => props.onChange(parseFloat((e.target as HTMLInputElement).value))}
        onPointerUp={() => sfx.hover()}
      />
    </label>
  );
}

export function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.ui();
        props.onChange(!props.value);
      }}
      className="flex w-full items-center justify-between gap-3 py-2 text-left"
    >
      <span>
        <span className="block text-sm font-semibold uppercase tracking-wider text-white/80">{props.label}</span>
        {props.hint && <span className="block text-xs text-white/40">{props.hint}</span>}
      </span>
      <span className={cx('relative h-6 w-12 shrink-0 cut-sm transition-colors', props.value ? 'bg-neon-pink' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)]')}>
        <span className={cx('absolute top-1 h-4 w-4 bg-white transition-all', props.value ? 'left-7' : 'left-1')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>(props: {
  label?: string;
  options: { v: T; label: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('py-1.5', props.className)}>
      {props.label && <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">{props.label}</div>}
      <div className="flex flex-wrap gap-1.5">
        {props.options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => {
              sfx.ui();
              props.onChange(o.v);
            }}
            style={props.value === o.v && o.color ? { backgroundColor: o.color, color: '#0a0518' } : undefined}
            className={cx(
              'cut-sm px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-widest transition',
              props.value === o.v
                ? 'bg-neon-pink text-white shadow-[0_0_14px_rgba(255,45,149,0.5)]'
                : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chip(props: { children?: JsxChild; color?: string; className?: string }) {
  const color = props.color ?? '#2de2ff';
  return (
    <span
      className={cx('inline-block px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider', props.className)}
      style={{ color, boxShadow: `inset 0 0 0 1px ${color}66`, backgroundColor: color + '14' }}
    >
      {props.children}
    </span>
  );
}

/** Canvas preview of an arena, drawn once when the element is created. */
export function MapPreview(props: { level: LevelData; size?: number; className?: string }) {
  const size = props.size ?? 240;
  const canvas = <canvas className="block h-auto w-full" /> as HTMLCanvasElement;
  const map = renderLevelMap(props.level, size);
  canvas.width = map.canvas.width;
  canvas.height = map.canvas.height;
  canvas.getContext('2d')?.drawImage(map.canvas, 0, 0);
  return <div className={cx('flex aspect-square w-full items-center justify-center bg-ink', props.className)}>{canvas}</div>;
}

export function Logo(props: { size?: 'sm' | 'lg' }) {
  const cls = (props.size ?? 'lg') === 'lg' ? 'text-5xl sm:text-7xl md:text-8xl' : 'text-2xl';
  return (
    <div className="leading-none">
      <h1 data-text="NEON RIOT" className={cx('glitch title-glow font-display font-black tracking-[0.06em]', cls)}>
        NEON RIOT
      </h1>
    </div>
  );
}
