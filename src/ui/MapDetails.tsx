import { useEffect, useMemo, useRef, useState } from 'react';
import type { Box, LevelData } from '@/game/levels';
import { renderLevelMap } from '@/game/levelMesh';
import { Btn, Modal, Panel } from './kit';

interface Hover {
  px: number;
  py: number;
  wx: number;
  wz: number;
  box: Box | null;
  top: number;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export function MapDetails({ level, onClose }: { level: LevelData; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<Hover | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  // the map keeps its true aspect ratio; the longest side fills the available width
  const scale = width / Math.max(level.w, level.d);
  const dispW = Math.round(level.w * scale);
  const dispH = Math.round(level.d * scale);
  const base = useMemo(() => renderLevelMap(level, 640).canvas, [level]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setWidth(Math.max(240, Math.min(680, el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // draw: only resize the backing store when the size really changes (avoids flicker on hover)
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(dispW * dpr);
    const bh = Math.round(dispH * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, dispW, dispH);
    g.drawImage(base, 0, 0, dispW, dispH);
    if (showGrid) {
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      for (let x = 10; x < level.w; x += 10) {
        g.beginPath();
        g.moveTo(x * scale + 0.5, 0);
        g.lineTo(x * scale + 0.5, dispH);
        g.stroke();
      }
      for (let z = 10; z < level.d; z += 10) {
        g.beginPath();
        g.moveTo(0, z * scale + 0.5);
        g.lineTo(dispW, z * scale + 0.5);
        g.stroke();
      }
    }
    if (hover) {
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 1.5;
      g.strokeRect(hover.px - 7, hover.py - 7, 14, 14);
      g.beginPath();
      g.arc(hover.px, hover.py, 3, 0, Math.PI * 2);
      g.fillStyle = '#ffe14d';
      g.fill();
    }
  }, [base, dispW, dispH, scale, level, hover, showGrid]);

  const onMove = (e: React.MouseEvent) => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    // world coords: origin at the map centre, x to the right, z downwards
    const wx = px / scale - level.w / 2;
    const wz = py / scale - level.d / 2;
    let top = 0;
    let box: Box | null = null;
    for (const b of level.boxes) {
      if (wx >= b.x0 && wx <= b.x1 && wz >= b.z0 && wz <= b.z1 && b.y1 >= top) {
        top = b.y1;
        box = b;
      }
    }
    setHover({ px, py, wx, wz, box, top });
  };

  const stats: [string, string | number][] = [
    ['Size', `${level.w} × ${level.d} m`],
    ['Structures', level.boxes.length],
    ['Jump pads', level.pads.length],
    ['Max height', `${level.maxH} m`],
    ['Theme', level.themeName ?? 'Classic'],
    ['Seed', level.key?.split('-')[1] ?? '—'],
  ];

  return (
    <Modal onClose={onClose} z={70}>
      <Panel title="Map details" onClose={onClose} className="max-h-[94vh] w-full max-w-4xl">
        <div className="nscroll grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1.4fr_1fr]">
          <div ref={wrap} className="min-w-0">
            <div className="relative inline-block max-w-full">
              <canvas
                ref={canvas}
                style={{ width: dispW, height: dispH, maxWidth: '100%' }}
                className="block cursor-crosshair bg-ink shadow-[0_0_0_1px_rgba(120,100,220,0.6)]"
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
              />
              {hover && (
                <div className="pointer-events-none absolute left-2 top-2 max-w-[220px] cut-sm bg-ink/95 p-2 text-xs shadow-lg">
                  <div className="font-display text-[10px] font-bold uppercase tracking-widest text-neon-cyan">Cursor</div>
                  <div className="font-display text-white">X {hover.wx.toFixed(1)} · Z {hover.wz.toFixed(1)} m</div>
                  {hover.box ? (
                    <>
                      <div className="mt-1 text-white/70">Top height <span className="text-neon-yellow">{hover.top.toFixed(1)} m</span></div>
                      <div className="text-white/70">Footprint <span className="text-white">{(hover.box.x1 - hover.box.x0).toFixed(1)} × {(hover.box.z1 - hover.box.z0).toFixed(1)} m</span></div>
                      <div className="text-white/70">Base <span className="text-white">{hover.box.y0.toFixed(1)} m</span></div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="h-3 w-3" style={{ background: hex(hover.box.color) }} />
                        <span className="font-display text-[10px] text-white/60">{hex(hover.box.color)}</span>
                      </div>
                    </>
                  ) : <div className="mt-1 text-white/50">Open ground</div>}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.15em] text-white/50">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-[#4b3a8f]" /> Structures</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-neon-cyan" /> Jump pads</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 border border-neon-pink" /> Edge</span>
              <button type="button" onClick={() => setShowGrid((g) => !g)} className="ml-auto font-display font-bold text-neon-cyan hover:text-white">
                Grid {showGrid ? 'on' : 'off'}
              </button>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">Hover to inspect structures · grid lines every 10 m</div>
          </div>
          <div>
            <div className="font-display text-lg font-extrabold uppercase tracking-wider text-white">{level.name}</div>
            <div className="text-xs text-white/55">{level.tagline}</div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {stats.map(([k, v]) => (
                <div key={k} className="border-b border-line/40 py-1">
                  <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">{k}</div>
                  <div className="font-display text-sm text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-white/50">
              Jump pads are checked for clearance, so none spawn under a structure. Larger maps have more districts and longer sightlines.
            </div>
            <div className="mt-4 flex gap-2">
              <Btn size="sm" variant="cyan" onClick={onClose}>Done</Btn>
            </div>
          </div>
        </div>
      </Panel>
    </Modal>
  );
}
