import type { Input } from '@/game/input';
import { component, subView } from './dom';
import { useState, useRef } from './hooks';
import { cx } from './kit';
import type { View } from './dom';

const R = 58;

type Tone = 'pink' | 'cyan' | 'yellow' | 'violet';

interface TBtnProps {
  label?: string;
  size: number;
  style: Record<string, string | number>;
  onDown: () => void;
  onUp?: () => void;
  input?: Input;
  look?: boolean;
  tone?: Tone;
  children?: Node;
}

function TBtn(props: TBtnProps): View<TBtnProps> {
  return component<TBtnProps>(props, (p) => {
    const [on, setOn] = useState(false);
    const last = useRef<{ id: number; x: number; y: number } | null>(null);
    const col = { pink: '#ff2d95', cyan: '#2de2ff', yellow: '#ffe14d', violet: '#a26bff' }[p.tone ?? 'pink'];
    return (
      <div
        className="pointer-events-auto absolute flex touch-none select-none items-center justify-center rounded-full font-display text-[10px] font-black uppercase tracking-wider text-white"
        style={{
          width: p.size,
          height: p.size,
          ...p.style,
          background: on ? col + 'cc' : 'rgba(10,5,24,0.5)',
          boxShadow: `inset 0 0 0 2px ${col}${on ? 'ff' : '99'}, 0 0 ${on ? 22 : 10}px ${col}${on ? 'aa' : '44'}`,
          transform: on ? 'scale(0.92)' : 'scale(1)',
          transition: 'transform 60ms, background 60ms',
        }}
        onPointerDown={(e: PointerEvent) => {
          e.stopPropagation();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          last.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          setOn(true);
          p.onDown();
          if (navigator.vibrate) navigator.vibrate(8);
        }}
        onPointerMove={(e: PointerEvent) => {
          if (p.look && p.input && last.current && last.current.id === e.pointerId) {
            p.input.addLook(e.clientX - last.current.x, e.clientY - last.current.y);
            last.current.x = e.clientX;
            last.current.y = e.clientY;
          }
        }}
        onPointerUp={(e: PointerEvent) => {
          e.stopPropagation();
          last.current = null;
          setOn(false);
          p.onUp?.();
        }}
        onPointerCancel={() => {
          last.current = null;
          setOn(false);
          p.onUp?.();
        }}
      >
        {p.children ?? p.label}
      </div>
    );
  });
}

export interface TouchControlsProps {
  input: Input;
  onPause: () => void;
  onBoard: (show: boolean) => void;
}

export function TouchControls(props: TouchControlsProps): View<TouchControlsProps> {
  const cache = new Map<unknown, View<TBtnProps>>();

  const view = component<TouchControlsProps>(props, () => {
    const { input, onPause, onBoard } = props;
    const stick = useRef<{ id: number; ox: number; oy: number } | null>(null);
    const look = useRef<{ id: number; x: number; y: number } | null>(null);
    const [ui, setUi] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
    const safe = 'env(safe-area-inset-right, 0px)';
    const safeB = 'env(safe-area-inset-bottom, 0px)';

    const down = (e: PointerEvent) => {
      const split = window.innerWidth * 0.45;
      if (e.clientX < split) {
        if (stick.current) return;
        stick.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
        setUi({ ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 });
      } else {
        if (look.current) return;
        look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const s = stick.current;
      if (s && s.id === e.pointerId) {
        let dx = e.clientX - s.ox;
        let dy = e.clientY - s.oy;
        const l = Math.hypot(dx, dy);
        if (l > R) {
          // drag the base along so the thumb never leaves the ring
          s.ox += (dx / l) * (l - R);
          s.oy += (dy / l) * (l - R);
          dx = (dx / l) * R;
          dy = (dy / l) * R;
        }
        const mag = Math.hypot(dx, dy) / R;
        const dead = mag < 0.1;
        input.moveX = dead ? 0 : dx / R;
        input.moveY = dead ? 0 : -dy / R;
        if (mag > 0.93) input.touchSprint = true;
        else if (mag < 0.6) input.touchSprint = false;
        setUi({ ox: s.ox, oy: s.oy, dx, dy });
        return;
      }
      const lk = look.current;
      if (lk && lk.id === e.pointerId) {
        input.addLook(e.clientX - lk.x, e.clientY - lk.y);
        lk.x = e.clientX;
        lk.y = e.clientY;
      }
    };
    const up = (e: PointerEvent) => {
      if (stick.current && stick.current.id === e.pointerId) {
        stick.current = null;
        input.moveX = input.moveY = 0;
        input.touchSprint = false;
        setUi(null);
      }
      if (look.current && look.current.id === e.pointerId) look.current = null;
    };

    const pos = (right: number, bottom: number): Record<string, string> => ({
      right: `calc(${safe} + ${right}px)`,
      bottom: `calc(${safeB} + ${bottom}px)`,
    });
    const btn = (key: string, p: TBtnProps) => subView(cache, key, TBtn, p);

    return (
      <div className="pointer-events-auto absolute inset-0 touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {ui && (
          <div className="pointer-events-none absolute" style={{ left: ui.ox - R, top: ui.oy - R, width: R * 2, height: R * 2 }}>
            <div className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 2px rgba(45,226,255,0.6), 0 0 18px rgba(45,226,255,0.25)', background: 'rgba(10,5,24,0.35)' }} />
            <div className="absolute h-14 w-14 rounded-full" style={{ left: R - 28 + ui.dx, top: R - 28 + ui.dy, background: 'radial-gradient(circle at 35% 30%, #ffffff, #2de2ff 70%)', boxShadow: '0 0 16px #2de2ff' }} />
          </div>
        )}
        {!ui && (
          <div className="pointer-events-none absolute bottom-32 left-14 flex h-20 w-20 items-center justify-center rounded-full text-center font-display text-[9px] font-bold uppercase tracking-widest text-white/40" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' }}>
            Move
          </div>
        )}
        {btn('fire', { size: 96, style: pos(24, 24), tone: 'pink', input, look: true, onDown: () => input.setVirtualFire(true), onUp: () => input.setVirtualFire(false), children: <span className="text-xs">Fire</span> })}
        {btn('jump', { size: 72, style: pos(132, 40), tone: 'cyan', label: 'Jump', onDown: () => input.setVirtual('Space', true), onUp: () => input.setVirtual('Space', false) })}
        {btn('slide', { size: 62, style: pos(36, 134), tone: 'violet', label: 'Slide', onDown: () => input.setVirtual('KeyC', true), onUp: () => input.setVirtual('KeyC', false) })}
        {btn('dash', { size: 58, style: pos(110, 124), tone: 'yellow', label: 'Dash', onDown: () => input.tap('KeyF') })}
        {btn('peekL', { size: 50, style: pos(176, 124), tone: 'cyan', label: '◀ Peek', onDown: () => input.setVirtual('KeyQ', true), onUp: () => input.setVirtual('KeyQ', false) })}
        {btn('peekR', { size: 50, style: pos(232, 124), tone: 'cyan', label: 'Peek ▶', onDown: () => input.setVirtual('KeyE', true), onUp: () => input.setVirtual('KeyE', false) })}
        {btn('reload', { size: 50, style: pos(206, 52), tone: 'violet', label: 'Rld', onDown: () => input.tap('KeyR') })}
        {btn('swap', { size: 50, style: pos(22, 214), tone: 'violet', label: 'Swap', onDown: () => input.tap('KeyX') })}
        <button
          type="button"
          aria-label="Pause"
          className={cx('pointer-events-auto absolute h-10 w-10 rounded-full bg-black/50 font-display text-sm font-black text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.4)]')}
          style={{ left: 'calc(env(safe-area-inset-left, 0px) + 118px)', top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
          onPointerDown={(e: PointerEvent) => {
            e.stopPropagation();
            onPause();
          }}
        >
          II
        </button>
        <button
          type="button"
          aria-label="Scoreboard"
          className="pointer-events-auto absolute h-10 w-10 rounded-full bg-black/50 font-display text-[10px] font-black text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.4)]"
          style={{ left: 'calc(env(safe-area-inset-left, 0px) + 118px)', top: 'calc(env(safe-area-inset-top, 0px) + 58px)' }}
          onPointerDown={(e: PointerEvent) => {
            e.stopPropagation();
            onBoard(true);
          }}
          onPointerUp={() => onBoard(false)}
          onPointerCancel={() => onBoard(false)}
          onPointerLeave={() => onBoard(false)}
        >
          TAB
        </button>
      </div>
    );
  });

  view.cleanup(() => {
    for (const v of cache.values()) v.dispose();
    cache.clear();
  });

  return view;
}
