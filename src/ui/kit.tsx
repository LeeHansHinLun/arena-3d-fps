import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { audio } from '@/game/audio';
import type { LevelData } from '@/game/levels';
import { renderLevelMap } from '@/game/levelMesh';

export const sfx = {
  ui: () => audio.play('ui'),
  hover: () => audio.play('uiHover'),
  back: () => audio.play('uiBack'),
};

type Variant = 'primary' | 'cyan' | 'yellow' | 'ghost' | 'danger';

export function Btn({
  children, onClick, variant = 'primary', size = 'md', className, disabled, title, back,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  title?: string;
  back?: boolean;
}) {
  const v: Record<Variant, string> = {
    primary: 'bg-neon-pink text-white hover:bg-white hover:text-ink shadow-[0_0_22px_rgba(255,45,149,0.45)]',
    cyan: 'bg-neon-cyan text-ink hover:bg-white shadow-[0_0_22px_rgba(45,226,255,0.4)]',
    yellow: 'bg-neon-yellow text-ink hover:bg-white shadow-[0_0_22px_rgba(255,225,77,0.4)]',
    ghost: 'bg-panel2/80 text-white/90 hover:bg-neon-cyan/20 hover:text-neon-cyan shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] hover:shadow-[inset_0_0_0_1px_rgba(45,226,255,0.9)]',
    danger: 'bg-neon-red/90 text-white hover:bg-white hover:text-ink',
  };
  const s = { sm: 'px-3 py-1.5 text-xs', md: 'px-5 py-2.5 text-sm', lg: 'px-8 py-4 text-lg' }[size];
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseEnter={() => !disabled && sfx.hover()}
      onClick={() => {
        if (disabled) return;
        audio.init();
        back ? sfx.back() : sfx.ui();
        onClick?.();
      }}
      className={cn(
        'cut-sm font-display font-bold uppercase tracking-[0.18em] transition-all duration-150 active:scale-95 select-none',
        v[variant], s,
        disabled && 'opacity-40 cursor-not-allowed hover:bg-panel2 hover:text-white/90 active:scale-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Panel({ title, onClose, children, className, right }: { title: string; onClose?: () => void; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cn('cut glass neon-border flex flex-col min-h-0 pop-in', className)}>
      <div className="flex items-center gap-3 border-b border-line/80 px-5 py-3 shrink-0">
        <span className="h-3 w-3 rotate-45 bg-neon-pink shadow-[0_0_10px_#ff2d95]" />
        <h2 className="font-display text-base font-extrabold uppercase tracking-[0.25em] text-white sm:text-lg">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          {right}
          {onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                sfx.back();
                onClose();
              }}
              className="h-8 w-8 cut-sm bg-panel2 text-lg leading-none text-white/80 transition hover:bg-neon-pink hover:text-white"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Modal({ children, onClose, z = 50 }: { children: ReactNode; onClose?: () => void; z?: number }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm fade-in sm:p-6"
      style={{ zIndex: z }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {children}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, color }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; color?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block py-1.5">
      <div className="mb-0.5 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-white/80">
        <span>{label}</span>
        <span className="font-display text-xs text-neon-cyan">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        className="nr"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: pct + '%', ['--fill' as string]: color ?? '#ff2d95' }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={() => sfx.hover()}
      />
    </label>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.ui();
        onChange(!value);
      }}
      className="flex w-full items-center justify-between gap-3 py-2 text-left"
    >
      <span>
        <span className="block text-sm font-semibold uppercase tracking-wider text-white/80">{label}</span>
        {hint && <span className="block text-xs text-white/40">{hint}</span>}
      </span>
      <span className={cn('relative h-6 w-12 shrink-0 cut-sm transition-colors', value ? 'bg-neon-pink' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)]')}>
        <span className={cn('absolute top-1 h-4 w-4 bg-white transition-all', value ? 'left-7' : 'left-1')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ label, options, value, onChange, className }: { label?: string; options: { v: T; label: string; color?: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('py-1.5', className)}>
      {label && <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">{label}</div>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => {
              sfx.ui();
              onChange(o.v);
            }}
            style={value === o.v && o.color ? { backgroundColor: o.color, color: '#0a0518' } : undefined}
            className={cn(
              'cut-sm px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-widest transition',
              value === o.v ? 'bg-neon-pink text-white shadow-[0_0_14px_rgba(255,45,149,0.5)]' : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chip({ children, color = '#2de2ff', className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn('inline-block px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider', className)} style={{ color, boxShadow: `inset 0 0 0 1px ${color}66`, backgroundColor: color + '14' }}>
      {children}
    </span>
  );
}

export function MapPreview({ level, size = 240, className }: { level: LevelData; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const m = renderLevelMap(level, size);
    c.width = m.canvas.width;
    c.height = m.canvas.height;
    const g = c.getContext('2d');
    g?.drawImage(m.canvas, 0, 0);
  }, [level, size]);
  return (
    <div className={cn('flex aspect-square w-full items-center justify-center bg-ink', className)}>
      <canvas ref={ref} className="block h-auto w-full" />
    </div>
  );
}

export function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-5xl sm:text-7xl md:text-8xl' : 'text-2xl';
  return (
    <div className="leading-none">
      <h1 data-text="NEON RIOT" className={cn('glitch title-glow font-display font-black tracking-[0.06em]', cls)}>
        NEON RIOT
      </h1>
    </div>
  );
}
