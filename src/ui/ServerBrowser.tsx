import { useEffect, useMemo, useRef, useState } from 'react';
import { DIFFS, LEVEL_IDS, MODES, MUTATORS, REGIONS, fmtTime, type LevelId, type ModeId, type Mutator, type ServerInfo } from '@/game/types';
import { MAP_NICE, levelLabel } from '@/game/servers';
import { getLevel, type LevelData } from '@/game/levels';
import { Btn, Chip, MapPreview, sfx } from './kit';
import { MapDetails } from './MapDetails';
import { cn } from '@/utils/cn';

type SortKey = 'name' | 'mode' | 'map' | 'players' | 'ping';

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => {
          sfx.ui();
          onChange(e.target.value);
        }}
        className="cut-sm bg-panel2 px-2 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-white outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} className="bg-ink">
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PingBars({ ping }: { ping: number }) {
  const lv = ping < 50 ? 4 : ping < 90 ? 3 : ping < 150 ? 2 : 1;
  const col = lv >= 4 ? '#7dff6b' : lv === 3 ? '#b6ff6b' : lv === 2 ? '#ffe14d' : '#ff3b5c';
  return (
    <span className="inline-flex items-end gap-[2px]" title={ping + ' ms'}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="w-[3px]" style={{ height: 4 + i * 3, background: i <= lv ? col : '#3a2a70' }} />
      ))}
    </span>
  );
}

const pingColor = (p: number) => (p < 60 ? '#7dff6b' : p < 120 ? '#ffe14d' : '#ff3b5c');

export function ServerBrowser({ servers, online, refreshing, onRefresh, onJoin, onBack }: { servers: ServerInfo[]; online: number; refreshing: boolean; onRefresh: () => void; onJoin: (s: ServerInfo) => void; onBack: () => void }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | ModeId>('all');
  const [map, setMap] = useState<'all' | LevelId>('all');
  const [region, setRegion] = useState('all');
  const [mut, setMut] = useState<'all' | Mutator>('all');
  const [maxPing, setMaxPing] = useState(300);
  const [minPlayers, setMinPlayers] = useState(0);
  const [hideFull, setHideFull] = useState(false);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'ping', dir: 1 });
  const [sel, setSel] = useState<string | null>(null);
  const [detailsLevel, setDetailsLevel] = useState<LevelData | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const listRef = useRef<HTMLDivElement>(null);
  const ROW = 60;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const l = servers.filter((s) => {
      if (needle && !(s.name.toLowerCase().includes(needle) || s.ip.includes(needle) || levelLabel(s).toLowerCase().includes(needle))) return false;
      if (mode !== 'all' && s.rules.mode !== mode) return false;
      if (map !== 'all' && s.level !== map) return false;
      if (region !== 'all' && s.region !== region) return false;
      if (mut !== 'all' && s.rules.mutator !== mut) return false;
      if (s.ping > maxPing) return false;
      if (s.players < minPlayers) return false;
      if (hideFull && s.players >= s.rules.maxPlayers) return false;
      return true;
    });
    const val = (s: ServerInfo): string | number =>
      sort.k === 'name' ? s.name.toLowerCase() : sort.k === 'mode' ? s.rules.mode : sort.k === 'map' ? s.level : sort.k === 'players' ? s.players : s.ping;
    l.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
    return l;
  }, [servers, q, mode, map, region, mut, maxPing, minPlayers, hideFull, sort]);

  const selected = servers.find((s) => s.id === sel) ?? null;
  const resetFilters = () => {
    setQ('');
    setMode('all');
    setMap('all');
    setRegion('all');
    setMut('all');
    setMaxPing(300);
    setMinPlayers(0);
    setHideFull(false);
  };
  // keyboard: arrows move the selection (keeping it in view), Enter joins
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!list.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = list.findIndex((s) => s.id === sel);
        const n = Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)));
        setSel(list[n].id);
        const el = listRef.current;
        if (el) {
          const top = n * ROW;
          if (top < el.scrollTop) el.scrollTop = top;
          else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
        }
      } else if (e.key === 'Enter' && selected && selected.players < selected.rules.maxPlayers) {
        onJoin(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, sel, selected, onJoin]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const start = Math.max(0, Math.floor(scrollTop / ROW) - 4);
  const end = Math.min(list.length, Math.ceil((scrollTop + viewH) / ROW) + 4);
  const th = (k: SortKey, label: string, cls = '') => (
    <button
      type="button"
      onClick={() => {
        sfx.ui();
        setSort((s) => (s.k === k ? { k, dir: (s.dir * -1) as 1 | -1 } : { k, dir: 1 }));
      }}
      className={cn('text-left font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 hover:text-neon-cyan', sort.k === k && 'text-neon-cyan', cls)}
    >
      {label} {sort.k === k ? (sort.dir === 1 ? '▲' : '▼') : ''}
    </button>
  );

  const quick = () => {
    const pool = list.filter((s) => s.players < s.rules.maxPlayers);
    const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    if (pick) onJoin(pick);
  };

  return (
    <div className="absolute inset-0 flex flex-col gap-3 p-3 sm:p-6">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Btn variant="ghost" size="sm" back onClick={onBack}>
          ← Back
        </Btn>
        <div>
          <h2 className="font-display text-xl font-black uppercase tracking-[0.2em] text-white sm:text-2xl">Server Browser</h2>
          <div className="text-[11px] uppercase tracking-[0.2em] text-neon-cyan">
            {servers.length} servers · {online} pilots online
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" size="sm" onClick={onRefresh}>
            <svg viewBox="0 0 24 24" className={cn('mr-1 inline h-3.5 w-3.5', refreshing && 'animate-spin')} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3.2-6.9" />
              <path d="M21 3v6h-6" />
            </svg>
            Refresh
          </Btn>
          <Btn variant="yellow" size="sm" onClick={quick} disabled={!list.some((s) => s.players < s.rules.maxPlayers)}>
            Quick join ›
          </Btn>
        </div>
      </div>

      <div className="cut glass neon-border shrink-0 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <label className="col-span-2 flex flex-col gap-0.5 lg:col-span-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">Search name / IP / map</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. 51.38 or rail…"
              className="cut-sm bg-panel2 px-3 py-1.5 font-display text-xs text-white outline-none placeholder:text-white/25 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
            />
          </label>
          <Sel label="Mode" value={mode} onChange={(v) => setMode(v as 'all' | ModeId)} options={[['all', 'All modes'], ...(Object.keys(MODES) as ModeId[]).map((m): [string, string] => [m, MODES[m].name])]} />
          <Sel label="Map" value={map} onChange={(v) => setMap(v as 'all' | LevelId)} options={[['all', 'All maps'], ...LEVEL_IDS.map((m): [string, string] => [m, MAP_NICE[m]]), ['procedural', 'Procedural']]} />
          <Sel label="Region" value={region} onChange={setRegion} options={[['all', 'Worldwide'], ...REGIONS.map((r): [string, string] => [r, r])]} />
          <Sel label="Rules" value={mut} onChange={(v) => setMut(v as 'all' | Mutator)} options={[['all', 'Any'], ...(Object.keys(MUTATORS) as Mutator[]).map((m): [string, string] => [m, MUTATORS[m].name])]} />
          <Sel label="Max ping" value={String(maxPing)} onChange={(v) => setMaxPing(+v)} options={[['300', 'Any'], ['60', '< 60 ms'], ['100', '< 100 ms'], ['150', '< 150 ms']]} />
          <Sel label="Min players" value={String(minPlayers)} onChange={(v) => setMinPlayers(+v)} options={[['0', 'Any'], ['6', '6+'], ['10', '10+']]} />
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/70">
          <input type="checkbox" checked={hideFull} onChange={(e) => { sfx.ui(); setHideFull(e.target.checked); }} className="h-4 w-4 accent-[#ff2d95]" />
          Hide full servers
          <span className="ml-auto text-white/40">{list.length} shown</span>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="cut glass neon-border flex min-h-0 flex-1 flex-col">
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_64px_52px] gap-2 border-b border-line/60 px-4 py-2 lg:grid-cols-[minmax(0,2.4fr)_1.1fr_1.3fr_1fr_60px]">
            {th('name', 'Server')}
            {th('mode', 'Mode', 'hidden lg:block')}
            {th('map', 'Map', 'hidden lg:block')}
            {th('players', 'Players')}
            {th('ping', 'Ping')}
          </div>
          <div ref={listRef} className="nscroll min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            {list.length === 0 && (
              <div className="flex flex-col items-center gap-3 p-10 text-center text-white/50">
                <div>No servers match your filters.</div>
                <Btn variant="ghost" size="sm" onClick={resetFilters}>Clear filters</Btn>
              </div>
            )}
            {list.length > 0 && (
              <div className="relative" style={{ height: list.length * ROW }}>
                {list.slice(start, end).map((s, k) => {
                  const i = start + k;
                  const full = s.players >= s.rules.maxPlayers;
                  const m = MODES[s.rules.mode];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, height: ROW }}
                      onClick={() => { sfx.ui(); setSel(s.id); }}
                      onDoubleClick={() => !full && onJoin(s)}
                      className={cn(
                        'grid w-full grid-cols-[minmax(0,1fr)_64px_52px] items-center gap-2 border-b border-line/30 px-4 text-left transition lg:grid-cols-[minmax(0,2.4fr)_1.1fr_1.3fr_1fr_60px]',
                        sel === s.id ? 'bg-neon-pink/20 shadow-[inset_3px_0_0_#ff2d95]' : 'hover:bg-white/5',
                        full && 'opacity-60',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-bold leading-tight text-white">{s.name}</div>
                        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-white/45">
                          <span className="font-display">{s.ip}:{s.port}</span>
                          <span className="lg:hidden"><Chip color={m.color}>{m.short}</Chip></span>
                          <span className="lg:hidden">{levelLabel(s)}</span>
                          {s.alwaysOnline && <Chip color="#7dff6b">24/7</Chip>}
                          {s.rules.mutator !== 'none' && <Chip color="#a26bff">{MUTATORS[s.rules.mutator].name}</Chip>}
                          {s.hosted && <Chip color="#ffe14d">Your lobby</Chip>}
                          {s.password && <Chip color="#ff3b5c">🔒 Locked</Chip>}
                        </div>
                      </div>
                      <div className="hidden lg:block"><Chip color={m.color}>{m.name}</Chip></div>
                      <div className="hidden text-sm text-white/80 lg:block">{levelLabel(s)}</div>
                      <div>
                        <div className={cn('font-display text-xs font-bold', full ? 'text-neon-red' : 'text-white')}>{s.players}/{s.rules.maxPlayers}</div>
                        <div className="mt-0.5 h-1 w-full bg-line/50">
                          <div className="h-full" style={{ width: (s.players / s.rules.maxPlayers) * 100 + '%', background: full ? '#ff3b5c' : '#2de2ff' }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <PingBars ping={s.ping} />
                        <span className="hidden font-display text-[11px] sm:inline" style={{ color: pingColor(s.ping) }}>{s.ping}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="cut glass neon-border flex max-h-[44%] min-h-0 flex-col lg:max-h-none lg:w-[24rem]">
          {selected ? <Detail s={selected} onJoin={() => onJoin(selected)} onInspect={(lvl) => setDetailsLevel(lvl)} /> : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-white/45">Select a server to view rules, players and map.</div>
          )}
        </div>
      </div>
      {detailsLevel && <MapDetails level={detailsLevel} onClose={() => setDetailsLevel(null)} />}
    </div>
  );
}

function Detail({ s, onJoin, onInspect }: { s: ServerInfo; onJoin: () => void; onInspect: (lvl: LevelData) => void }) {
  const full = s.players >= s.rules.maxPlayers;
  const m = MODES[s.rules.mode];
  const r = s.rules;
  const unitLabel =
    m.unit === 'captures'
      ? 'Capture limit'
      : m.unit === 'points'
        ? 'Point limit'
        : m.unit === 'bounties'
          ? 'Bounty limit'
          : m.unit === 'waves'
            ? 'Wave limit'
            : r.mode === 'tdm'
              ? 'Team limit'
              : 'Frag limit';
  const rules: [string, string][] = [
    ['Mode', m.name],
    ['Map', levelLabel(s)],
    [unitLabel, r.scoreLimit === 0 ? '∞ Infinite' : String(r.scoreLimit)],
    ['Time limit', r.timeLimit === 0 ? '∞ Infinite' : fmtTime(r.timeLimit)],
    ['Skill', DIFFS[r.difficulty].name],
    ['Physics', MUTATORS[r.mutator].name],
    ['Uptime', s.alwaysOnline ? '24/7 Dedicated' : 'Standard'],
  ];
  const lvl = getLevel(s.level, s.gen);
  return (
    <>
      <div className="flex shrink-0 items-start gap-3 border-b border-line/60 p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm font-extrabold uppercase tracking-wider text-white">{s.name}</div>
          <div className="font-display text-[11px] text-neon-cyan">{s.ip}:{s.port} · {s.region}</div>
          <div className="mt-1 text-xs italic text-white/50">“{s.motd}”</div>
        </div>
        <Btn variant="primary" onClick={onJoin} disabled={full} className="shrink-0">
          {full ? 'Full' : 'Join'}
        </Btn>
      </div>
      <div className="nscroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="hidden gap-3 lg:grid lg:grid-cols-[110px_1fr]">
          <button
            type="button"
            title="Click to inspect map"
            onClick={() => { sfx.ui(); onInspect(lvl); }}
            className="group relative w-[110px] overflow-hidden text-left shadow-[0_0_0_1px_rgba(45,226,255,0.4)] hover:shadow-[0_0_0_2px_#2de2ff]"
          >
            <MapPreview level={lvl} size={110} className="w-[110px]" />
            <span className="block bg-ink/85 py-0.5 text-center font-display text-[8px] font-bold uppercase tracking-wider text-neon-cyan group-hover:bg-neon-cyan group-hover:text-ink">
              🔍 Inspect
            </span>
          </button>
          <div className="grid content-start gap-1 text-xs">
            {rules.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-line/30 pb-0.5">
                <span className="uppercase tracking-wider text-white/45">{k}</span>
                <span className="font-semibold text-white">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-1 text-xs lg:hidden">
          {rules.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line/30 pb-0.5">
              <span className="uppercase tracking-wider text-white/45">{k}</span>
              <span className="font-semibold text-white">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 mb-1 flex items-center justify-between font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
          <span>Players ({s.players}/{r.maxPlayers})</span>
          <span>Score · Ping</span>
        </div>
        {s.roster.map((p, i) => (
          <div key={p.name + i} className="flex items-center justify-between border-b border-line/20 py-0.5 text-sm">
            <span className="truncate text-white/85">{p.name}</span>
            <span className="shrink-0 font-display text-[11px] text-white/55">
              {p.score} · <span style={{ color: pingColor(p.ping) }}>{p.ping}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
