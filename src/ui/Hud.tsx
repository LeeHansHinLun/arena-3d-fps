import { useEffect, useRef, useState } from 'react';
import type { Engine, HudState, ScoreRow } from '@/game/engine';
import { MODES, fmtTime, isTeamMode, type Settings } from '@/game/types';
import { cn } from '@/utils/cn';

export interface FeedItem {
  id: number;
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  mine: 'killer' | 'victim' | null;
  killerTeam: number;
  victimTeam: number;
}
export interface ChatItem {
  id: number;
  name: string;
  text: string;
  team: number;
  system?: boolean;
}
export interface AnnounceItem {
  key: number;
  text: string;
  sub?: string;
  points?: number;
  tone: 'good' | 'bad' | 'info' | 'streak';
}

const TEAM = ['#2de2ff', '#ff2d95'];
const TAU = Math.PI * 2;
function angDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

interface Slot {
  label: string;
  value: string | number;
  color: string;
}

/** Score bar slots adapt to the mode: teams, points, waves or kills. */
function scoreSlots(hud: HudState, settings: Settings): [Slot, Slot] {
  if (isTeamMode(hud.mode)) {
    return [
      { label: hud.myTeam === 0 ? 'Cyan · you' : 'Cyan', value: hud.teamScores[0], color: TEAM[0] },
      { label: hud.myTeam === 1 ? 'Magenta · you' : 'Magenta', value: hud.teamScores[1], color: TEAM[1] },
    ];
  }
  if (hud.mode === 'koth' || hud.mode === 'bounty') {
    return [
      { label: 'Your points', value: hud.points, color: '#ffffff' },
      { label: hud.leaderName === settings.name ? 'You lead' : hud.leaderName || 'Leader', value: hud.leaderScore, color: '#ffe14d' },
    ];
  }
  if (hud.mode === 'survival') {
    return [
      { label: 'Wave', value: hud.wave, color: '#7dff6b' },
      { label: 'Kills', value: hud.myKills, color: '#ffffff' },
    ];
  }
  return [
    { label: 'You', value: hud.myKills, color: '#ffffff' },
    { label: hud.leaderName === settings.name ? 'Rank 1' : hud.leaderName || 'Leader', value: hud.leaderKills, color: '#ffe14d' },
  ];
}

function ModeStrip({ hud }: { hud: HudState }) {
  let text: string | null = null;
  let color = '#ffffff';
  if (hud.mode === 'koth') {
    text = `HILL · ${hud.hillOwner || 'NEUTRAL'}${hud.hill ? ' · YOU ARE SCORING' : ''}`;
    color = hud.hillOwner === 'CYAN' ? TEAM[0] : hud.hillOwner === 'MAGENTA' ? TEAM[1] : hud.hillOwner === 'CONTESTED' ? '#ffffff' : '#ffe14d';
  } else if (hud.mode === 'ctf') {
    text = hud.flagStatus;
    color = TEAM[0];
  } else if (hud.mode === 'bounty') {
    text = hud.bounty ? `◆ BOUNTY · ${hud.bounty}${hud.bountyDist ? ` · ${Math.round(hud.bountyDist)} m` : ''}` : 'BOUNTY · marking a target…';
    color = '#ff3b5c';
  } else if (hud.mode === 'survival') {
    text = `WAVE ${hud.wave}${hud.scoreLimit ? ` / ${hud.scoreLimit}` : ' · ENDLESS'} · one death ends the run`;
    color = '#7dff6b';
  }
  if (!text) return null;
  return (
    <div className="cut-sm mt-1 max-w-[92vw] truncate bg-black/55 px-3 py-0.5 text-center font-display text-[10px] font-bold uppercase tracking-[0.2em] hud-text" style={{ color }}>
      {text}
    </div>
  );
}

export function Hud({
  engine, hud, settings, touch, feed, chat, announce, hit, toast, board,
}: {
  engine: Engine;
  hud: HudState | null;
  settings: Settings;
  touch: boolean;
  feed: FeedItem[];
  chat: ChatItem[];
  announce: AnnounceItem | null;
  hit: { key: number; head: boolean; kill: boolean } | null;
  toast: { key: number; text: string; color: string } | null;
  board: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dmg = useRef<HTMLDivElement>(null);
  const heal = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const low = useRef<HTMLDivElement>(null);
  const speed = useRef<HTMLDivElement>(null);
  const xh = useRef<HTMLDivElement>(null);
  const ind = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const esp = useRef<HTMLCanvasElement>(null);
  const espDrawn = useRef(false);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = engine.vfx;
      const t = performance.now() / 1000;
      if (dmg.current) dmg.current.style.opacity = String(Math.min(1, v.damage));
      if (heal.current) heal.current.style.opacity = String(v.heal * 0.7);
      if (flash.current) flash.current.style.opacity = String(v.flash);
      if (low.current) low.current.style.opacity = String(v.low * (0.45 + 0.55 * Math.abs(Math.sin(t * 4))));
      if (speed.current) speed.current.style.opacity = String(v.speed * 0.55);
      const h = root.current?.clientHeight ?? 800;
      const g = (Math.tan(v.spread) / Math.tan(v.fov / 2)) * (h / 2);
      xh.current?.style.setProperty('--g', `${Math.max(3, Math.min(120, g)).toFixed(1)}px`);

      // wallhack boxes: only work while the cheat is on; clear once when it turns off
      const ec = esp.current;
      if (ec) {
        const on = engine.cheats.wallhack;
        if (on || espDrawn.current) {
          const w = ec.clientWidth, hh = ec.clientHeight;
          if (ec.width !== w || ec.height !== hh) {
            ec.width = w;
            ec.height = hh;
          }
          const ctx = ec.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, w, hh);
            if (on) {
              ctx.font = '600 11px Rajdhani, sans-serif';
              ctx.textAlign = 'center';
              for (const e of engine.getEsp(w, hh)) {
                const bw = e.h * 0.45;
                ctx.strokeStyle = 'rgba(255,59,92,0.9)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(e.x - bw / 2, e.y, bw, e.h);
                ctx.fillStyle = '#7dff6b';
                ctx.fillRect(e.x - bw / 2 - 5, e.y + e.h * (1 - e.hp / 100), 3, e.h * (e.hp / 100));
                ctx.fillStyle = '#ffffff';
                ctx.fillText(`${e.name} · ${Math.round(e.d)}m`, e.x, e.y - 4);
              }
            }
          }
          espDrawn.current = on;
        }
      }

      // damage direction arc
      const c = ind.current;
      const ictx = c?.getContext('2d');
      if (c && ictx) {
        ictx.clearRect(0, 0, c.width, c.height);
        for (const i of v.indicators) {
          const delta = angDiff(v.yaw, i.ang);
          const a = -Math.PI / 2 - delta;
          ictx.strokeStyle = `rgba(255,59,92,${Math.min(1, i.life / 0.8)})`;
          ictx.lineWidth = 14;
          ictx.lineCap = 'butt';
          ictx.beginPath();
          ictx.arc(c.width / 2, c.height / 2, 118, a - 0.32, a + 0.32);
          ictx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(loop);
    const mm = window.setInterval(() => {
      if (mini.current) engine.drawMinimap(mini.current);
    }, 66);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(mm);
    };
  }, [engine]);

  const [rows, setRows] = useState<ScoreRow[]>([]);
  useEffect(() => {
    if (!board) return;
    setRows(engine.getScoreboard());
    const i = window.setInterval(() => setRows(engine.getScoreboard()), 250);
    return () => clearInterval(i);
  }, [board, engine]);

  const color = settings.crosshair;
  const bar = (s: React.CSSProperties) => <i className="absolute bg-current shadow-[0_0_3px_rgba(0,0,0,0.9)]" style={s} />;
  const hpCol = !hud ? '#7dff6b' : hud.hp > 60 ? '#7dff6b' : hud.hp > 30 ? '#ffe14d' : '#ff3b5c';
  // infinite time shows ∞ and never blinks as "running out"
  const timed = hud ? hud.timeLimit > 0 : false;
  const timeText = hud ? (timed ? fmtTime(hud.timeLeft) : '∞') : '';
  const timeLow = timed && hud ? hud.timeLeft < 30 : false;
  const [left, right] = hud ? scoreSlots(hud, settings) : [null, null];

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden text-white">
      {/* screen effects */}
      <div ref={speed} className="absolute inset-0 opacity-0" style={{ background: 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(160,240,255,0) 0deg 3deg, rgba(160,240,255,0.5) 3deg 3.6deg)', WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 42%, #000 85%)', maskImage: 'radial-gradient(ellipse at center, transparent 42%, #000 85%)' }} />
      <div ref={dmg} className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(ellipse at center, rgba(255,0,40,0) 40%, rgba(255,20,60,0.75) 100%)' }} />
      <div ref={low} className="absolute inset-0 opacity-0" style={{ boxShadow: 'inset 0 0 140px 30px rgba(255,0,40,0.65)' }} />
      <div ref={heal} className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(ellipse at center, rgba(125,255,107,0) 50%, rgba(125,255,107,0.5) 100%)' }} />
      <div ref={flash} className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.0) 30%, rgba(255,240,200,0.5) 100%)' }} />
      {hud?.protect && hud.alive && <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 90px 10px rgba(45,226,255,0.45)' }} />}
      {hud && hud.aiming && <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />}

      <canvas ref={esp} className="absolute inset-0 h-full w-full" />
      {hud?.cheats && (
        <div className="absolute left-1/2 top-[64px] -translate-x-1/2 cut-sm bg-neon-red/80 px-2 py-0.5 font-display text-[9px] font-black uppercase tracking-[0.25em]">Cheats active · score not recorded</div>
      )}
      {/* damage indicators */}
      <canvas ref={ind} width={280} height={280} className="absolute left-1/2 top-1/2 -ml-[140px] -mt-[140px]" />

      {/* crosshair */}
      {hud?.alive && (
        <div ref={xh} className="absolute left-1/2 top-1/2" style={{ color, ['--g' as string]: '8px' }}>
          {bar({ width: 2, height: 9, left: -1, top: 'calc(-9px - var(--g))' })}
          {bar({ width: 2, height: 9, left: -1, top: 'var(--g)' })}
          {bar({ width: 9, height: 2, top: -1, left: 'calc(-9px - var(--g))' })}
          {bar({ width: 9, height: 2, top: -1, left: 'var(--g)' })}
          {bar({ width: 3, height: 3, left: -1.5, top: -1.5, borderRadius: 3 })}
          {hud.assist && <i className="absolute rounded-full" style={{ width: 26, height: 26, left: -13, top: -13, boxShadow: `0 0 0 1px ${color}88` }} />}
          {hud.reload > 0 && (
            <div className="absolute left-1/2 top-9 h-1 w-14 -translate-x-1/2 bg-black/60">
              <div className="h-full bg-neon-yellow" style={{ width: hud.reload * 100 + '%' }} />
            </div>
          )}
        </div>
      )}
      {hit && (
        <div key={hit.key} className={cn('hitmarker', hit.head && 'head', hit.kill && 'kill')}>
          <i /><i /><i /><i />
        </div>
      )}

      {/* top: score bar, timer, mode strip */}
      {hud && left && right && (
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center sm:top-3">
          <div className="flex items-stretch gap-px">
            <div className="cut-sm flex min-w-[84px] flex-col items-center bg-black/55 px-3 py-1 sm:min-w-[110px]" style={{ boxShadow: `inset 0 -3px 0 ${left.color}` }}>
              <span className="max-w-[100px] truncate font-display text-[9px] uppercase tracking-[0.2em] text-white/60">{left.label}</span>
              <span className="font-display text-xl font-black leading-none" style={{ color: left.color }}>{left.value}</span>
            </div>
            <div className="flex min-w-[88px] flex-col items-center bg-black/70 px-3 py-1">
              <span className={cn('font-display text-lg font-black leading-none tabular-nums', timeLow && 'blink text-neon-red')}>{timeText}</span>
              <span className="font-display text-[9px] uppercase tracking-[0.2em] text-neon-yellow">
                {MODES[hud.mode].short} · {hud.scoreLimit === 0 ? '∞' : hud.scoreLimit}
              </span>
            </div>
            <div className="cut-sm flex min-w-[84px] flex-col items-center bg-black/55 px-3 py-1 sm:min-w-[110px]" style={{ boxShadow: `inset 0 -3px 0 ${right.color}` }}>
              <span className="max-w-[100px] truncate font-display text-[9px] uppercase tracking-[0.2em] text-white/60">{right.label}</span>
              <span className="font-display text-xl font-black leading-none" style={{ color: right.color }}>{right.value}</span>
            </div>
          </div>
          <ModeStrip hud={hud} />
        </div>
      )}
      {/* bounty direction arrow (points at the marked pilot) */}
      {hud?.alive && hud.mode === 'bounty' && hud.bountyRel !== null && (
        <div className="absolute left-1/2 top-[120px] -translate-x-1/2" style={{ transform: `translateX(-50%) rotate(${-hud.bountyRel}rad)` }}>
          <div className="h-0 w-0 border-x-[9px] border-b-[16px] border-x-transparent border-b-neon-red drop-shadow-[0_0_6px_#ff3b5c]" />
        </div>
      )}

      {/* top-left: minimap */}
      <div className="absolute left-2 top-2 sm:left-4 sm:top-4">
        <div className={cn('relative overflow-hidden rounded-full shadow-[0_0_0_2px_rgba(45,226,255,0.7),0_0_18px_rgba(45,226,255,0.3)]', touch ? 'h-24 w-24' : 'h-36 w-36')}>
          <canvas ref={mini} width={180} height={180} className="h-full w-full" />
        </div>
        {hud && (
          <div className="mt-1 flex gap-2 pl-1 font-display text-[10px] font-bold uppercase tracking-wider text-white/70 hud-text">
            {settings.showFps && <span>{hud.fps} FPS</span>}
            <span>{hud.ping} ms</span>
            {hud.rank > 0 && <span className="text-neon-yellow">#{hud.rank}/{hud.total}</span>}
          </div>
        )}
      </div>

      {/* kill feed */}
      <div className={cn('absolute right-2 top-2 flex flex-col items-end gap-1 sm:right-4 sm:top-4', touch ? 'w-[min(34vw,230px)]' : 'w-[min(60vw,300px)]')}>
        {feed.slice(-(touch ? 3 : 5)).map((f) => {
          const kc = isTeamMode(hud?.mode ?? 'ffa') ? TEAM[f.killerTeam] : '#fff';
          const vc = isTeamMode(hud?.mode ?? 'ffa') ? TEAM[f.victimTeam] : '#fff';
          return (
            <div key={f.id} className={cn('feed-in cut-sm flex max-w-full items-center gap-1.5 bg-black/60 px-2.5 py-1 text-[13px] font-bold', f.mine && 'shadow-[inset_0_0_0_1.5px_#ff2d95]')}>
              <span className="truncate" style={{ color: kc }}>{f.killer}</span>
              <span className="shrink-0 font-display text-[9px] uppercase tracking-wider text-white/50">{f.weapon}</span>
              {f.headshot && <span className="shrink-0 text-neon-red">◉</span>}
              <span className="truncate" style={{ color: vc }}>{f.victim}</span>
            </div>
          );
        })}
      </div>

      {/* chat */}
      <div className={cn('absolute left-2 flex w-[min(70vw,320px)] flex-col gap-0.5 sm:left-4', touch ? 'top-[132px]' : 'bottom-[110px]')}>
        {chat.slice(-(touch ? 3 : 5)).map((c) => (
          <div key={c.id} className="chat-in w-fit max-w-full truncate bg-black/40 px-2 py-0.5 text-[13px] hud-text">
            {c.system ? (
              <span className="text-neon-yellow">» {c.text}</span>
            ) : (
              <>
                <span className="font-bold" style={{ color: c.team >= 0 ? TEAM[c.team] : '#b9a8ff' }}>{c.name}</span>
                <span className="text-white/90">: {c.text}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* bottom-left vitals */}
      {hud && (
        <div className={cn('absolute left-2 w-[min(46vw,230px)] sm:left-4', touch ? 'bottom-3' : 'bottom-4')}>
          <div className="flex items-end gap-2">
            <span className="font-display text-4xl font-black leading-none hud-text sm:text-5xl" style={{ color: hpCol }}>{hud.hp}</span>
            <span className="mb-1 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">HP</span>
            {hud.streak >= 2 && (
              <span className="mb-1 ml-auto cut-sm bg-neon-pink px-2 py-0.5 font-display text-[10px] font-black uppercase tracking-wider">×{hud.streak} streak</span>
            )}
          </div>
          <div className="mt-1 h-2.5 w-full bg-black/60 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]">
            <div className="h-full transition-[width] duration-150" style={{ width: hud.hp + '%', background: hpCol, boxShadow: `0 0 10px ${hpCol}` }} />
          </div>
          <div className="mt-1 h-1.5 w-full bg-black/60">
            <div className="h-full bg-neon-cyan transition-[width] duration-150" style={{ width: Math.min(100, hud.armor) + '%', boxShadow: '0 0 8px #2de2ff' }} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 font-display text-[9px] font-bold uppercase tracking-wider text-white/70 hud-text">
            <span className={cn(hud.dash >= 1 ? 'text-neon-cyan' : 'text-white/40')}>{touch ? 'DASH' : 'DASH [F]'}</span>
            <span className="h-1.5 w-14 bg-black/60">
              <span className="block h-full" style={{ width: hud.dash * 100 + '%', background: hud.dash >= 1 ? '#2de2ff' : '#6a5aa8' }} />
            </span>
            <span className={cn('h-2 w-2 rotate-45', hud.airJumps > 0 ? 'bg-neon-yellow' : 'bg-white/20')} title="Air jump" />
            <span className="ml-auto text-white/50">{Math.round(hud.speed * 3.6)} km/h</span>
          </div>
        </div>
      )}

      {/* bottom-right weapon */}
      {hud && (
        <div className={cn('absolute right-2 flex flex-col items-end sm:right-4', touch ? 'bottom-3 right-[285px]' : 'bottom-4')}>
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.25em] text-white/70 hud-text">{hud.weaponName}</span>
          <div className="flex items-baseline gap-1 hud-text">
            <span className={cn('font-display text-5xl font-black leading-none sm:text-6xl', hud.ammo === 0 ? 'text-neon-red blink' : hud.ammo <= hud.mag * 0.25 ? 'text-neon-yellow' : 'text-white')}>{hud.mag > 900 ? '∞' : hud.ammo}</span>
            {hud.mag <= 900 && <span className="font-display text-lg font-bold text-white/50">/ {hud.mag}</span>}
          </div>
          {hud.reload > 0 && <div className="font-display text-[11px] font-black uppercase tracking-[0.3em] text-neon-yellow blink">Reloading</div>}
          {hud.weapons.length > 1 && !touch && (
            <div className="mt-1.5 flex gap-1">
              {hud.weapons.map((w, i) => (
                <div key={w.id} className={cn('cut-sm px-2 py-1 text-center font-display text-[9px] font-bold uppercase tracking-wider', i === hud.cur ? 'bg-neon-pink text-white' : 'bg-black/55 text-white/55')}>
                  {i + 1} · {w.name.split('-')[0]}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* announcements */}
      {announce && (
        <div key={announce.key} className="announce absolute left-1/2 top-[22%] -translate-x-1/2 text-center">
          <div
            className="font-display text-3xl font-black uppercase tracking-[0.12em] sm:text-5xl"
            style={{
              color: announce.tone === 'bad' ? '#ff3b5c' : announce.tone === 'streak' ? '#ffe14d' : announce.tone === 'info' ? '#2de2ff' : '#ff2d95',
              textShadow: '0 0 20px currentColor, 0 3px 0 rgba(0,0,0,0.6)',
            }}
          >
            {announce.text}
          </div>
          {announce.sub && <div className="mt-1 font-display text-xs font-bold uppercase tracking-[0.3em] text-white/85 hud-text sm:text-sm">{announce.sub}</div>}
          {announce.points ? <div className="mt-1 font-display text-xl font-black text-neon-yellow hud-text">+{announce.points}</div> : null}
        </div>
      )}
      {toast && (
        <div key={toast.key} className="toast-in absolute bottom-[28%] left-1/2 -translate-x-1/2 font-display text-sm font-black uppercase tracking-[0.25em] hud-text" style={{ color: toast.color }}>
          {toast.text}
        </div>
      )}

      {/* death */}
      {hud && !hud.alive && (
        <div className="absolute inset-x-0 bottom-[22%] text-center hud-text">
          <div className="font-display text-xs font-bold uppercase tracking-[0.35em] text-white/70">{hud.killer ? `Fragged by ${hud.killer}` : 'You died'}</div>
          <div className="mt-1 font-display text-5xl font-black text-neon-yellow">{Math.ceil(hud.respawnIn)}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.3em] text-white/50">{touch ? 'Tap fire to respawn' : 'Click or Space to respawn'}</div>
        </div>
      )}

      {/* scoreboard */}
      {board && hud && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 p-3">
          <div className="cut glass neon-border w-full max-w-2xl">
            <div className="flex items-center justify-between border-b border-line/70 px-5 py-2">
              <span className="font-display text-sm font-extrabold uppercase tracking-[0.3em]">Scoreboard</span>
              <span className="font-display text-xs text-neon-yellow">{MODES[hud.mode].name} · {timed ? fmtTime(hud.timeLeft) : '∞'}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                <tr>
                  <th className="px-4 py-1.5 text-left">Pilot</th>
                  <th className="px-2 text-right">Kills</th>
                  <th className="px-2 text-right">Deaths</th>
                  <th className="px-2 text-right">Points</th>
                  <th className="px-4 text-right">Ping</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn('border-t border-line/30', r.isPlayer && 'bg-neon-pink/20 font-bold', !r.alive && 'opacity-60')}>
                    <td className="px-4 py-1">
                      <span className="mr-2 inline-block h-2 w-2" style={{ background: isTeamMode(hud.mode) ? TEAM[r.team] : r.isPlayer ? '#ff2d95' : '#6a5aa8' }} />
                      {r.name}
                    </td>
                    <td className="px-2 text-right font-display">{r.kills}</td>
                    <td className="px-2 text-right font-display">{r.deaths}</td>
                    <td className="px-2 text-right font-display text-neon-cyan">{r.score}</td>
                    <td className="px-4 text-right font-display text-white/60">{r.ping}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
