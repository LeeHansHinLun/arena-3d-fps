import { useEffect, useMemo, useState } from './hooks';
import type { LevelData } from '@/game/levels';
import { DIFFS, LEVEL_IDS, MODES, MODE_ORDER, MUTATORS, NO_CHEATS, REGIONS, SIZE_INFO, fmtTime, type BuiltinLevelId, type Cheats, type Difficulty, type MapSize, type ModeId, type Mutator } from '@/game/types';
import { PROC_THEMES, getLevel } from '@/game/levels';
import { Btn, Chip, MapPreview, Segmented, Toggle, cx, sfx } from './kit';
import { component } from './dom';
import type { View } from './dom';
import { CheatsEditor } from './Cheats';
import { MapDetails } from './MapDetails';

export interface LobbyConfig {
  name: string;
  password: string;
  isPublic: boolean;
  region: string;
  map: BuiltinLevelId | 'random' | 'procedural';
  gen: { seed: number; size: MapSize; w: number; d: number; theme: string; style: string };
  mode: ModeId;
  scoreLimit: number;
  timeLimit: number;
  difficulty: Difficulty;
  mutator: Mutator;
  maxPlayers: number;
  fill: number; // players to fill with (incl. you)
  cheatsOn: boolean;
  cheats: Cheats;
}

export function defaultLobby(name: string): LobbyConfig {
  return {
    name: `${name || 'Player'}'s Lobby`,
    password: '',
    isPublic: true,
    region: 'EU',
    map: 'random',
    gen: { seed: Math.floor(Math.random() * 99999) + 1, size: 'medium', w: 112, d: 112, theme: 'auto', style: 'auto' },
    mode: 'ffa',
    scoreLimit: 20,
    timeLimit: 300,
    difficulty: 'normal',
    mutator: 'none',
    maxPlayers: 12,
    fill: 8,
    cheatsOn: false,
    cheats: { ...NO_CHEATS },
  };
}

const field = 'w-full cut-sm bg-panel2 px-3 py-2 font-display text-sm text-white outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]';

export interface CustomGameProps {
  initial: LobbyConfig;
  editing?: boolean;
  onSubmit: (c: LobbyConfig) => void;
  onBack: () => void;
}

export function CustomGame(props: CustomGameProps): View<CustomGameProps> {
  let detailsView: View<{ level: LevelData; onClose: () => void }> | null = null;

  const view = component<CustomGameProps>(props, () => {
    const { initial, editing, onSubmit, onBack } = props;
    const [c, setC] = useState<LobbyConfig>(initial);
    const [details, setDetails] = useState<LevelData | null>(null);
    const [presets, setPresets] = useState(false);
    const [randomSample] = useState<BuiltinLevelId>(() => LEVEL_IDS[Math.floor(Math.random() * LEVEL_IDS.length)]);
    const set = <K extends keyof LobbyConfig>(k: K, v: LobbyConfig[K]) => setC((o) => ({ ...o, [k]: v }));
    const limits = MODES[c.mode].limits;

    // Debounce procedural regeneration while dragging sliders
    const [previewGen, setPreviewGen] = useState(c.gen);
    useEffect(() => {
      const t = setTimeout(() => setPreviewGen(c.gen), 180);
      return () => clearTimeout(t);
    }, [c.gen]);

    const isProc = c.map === 'procedural';
    const activeLevel = useMemo<LevelData>(() => {
      if (c.map === 'procedural') return getLevel('procedural', previewGen);
      if (c.map === 'random') return getLevel(randomSample);
      return getLevel(c.map);
    }, [c.map, previewGen, randomSample]);

    const shownW = isProc ? c.gen.w : activeLevel.w;
    const shownD = isProc ? c.gen.d : activeLevel.d;
    const shownTheme = isProc ? c.gen.theme : (activeLevel.themeName ?? 'Neon').toLowerCase();
    const shownStyle = isProc ? c.gen.style : (activeLevel.styleName ?? 'Mixed').toLowerCase();

    const setMaxPlayers = (raw: number) => {
      const v = Math.max(2, Math.min(120, Math.round(raw || 2)));
      setC((o) => ({ ...o, maxPlayers: v, fill: Math.min(o.fill, v) }));
    };
    const setFill = (raw: number) => {
      const v = Math.max(1, Math.min(c.maxPlayers, Math.round(raw || 1)));
      set('fill', v);
    };

    const section = (n: string, t: string) => <div className="mb-2 mt-1 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-white/60">{n} · {t}</div>;

    const closeDetails = () => {
      detailsView?.dispose();
      detailsView = null;
      setDetails(null);
    };
    const detailsNode = details ? (detailsView ??= MapDetails({ level: details, onClose: closeDetails })).root : null;

    return (
      <div className="absolute inset-0 flex flex-col gap-3 overflow-hidden p-3 sm:p-6">
        <div className="flex shrink-0 items-center gap-3">
          <Btn variant="ghost" size="sm" back onClick={onBack}>← Back</Btn>
          <div>
            <h2 className="font-display text-xl font-black uppercase tracking-[0.2em] text-white sm:text-2xl">{editing ? 'Lobby settings' : 'Create lobby'}</h2>
            <div className="text-[11px] uppercase tracking-[0.2em] text-neon-cyan">Host your own server · pick or generate a map · set the rules</div>
          </div>
          <div className="ml-auto flex gap-2">
            <Btn variant="cyan" size="sm" onClick={() => setPresets(true)}>⚡ Mode presets</Btn>
          </div>
        </div>

        <div className="nscroll min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-4 pb-24 lg:grid-cols-[1.25fr_1fr]">
            <div className="flex flex-col gap-4">
              <div className="cut glass neon-border p-4">
                {section('1', 'Lobby')}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Server name</div>
                    <input type="text" maxLength={32} value={c.name} onChange={(e) => set('name', e.target.value)} className={field} />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Password (optional)</div>
                    <input type="text" maxLength={16} value={c.password} placeholder="none" onChange={(e) => set('password', e.target.value)} className={cx(field, 'placeholder:text-white/25')} />
                  </label>
                </div>
                <Toggle label="Public lobby" value={c.isPublic} onChange={(v) => set('isPublic', v)} hint="Listed in the server browser so others can join" />
                <Segmented label="Region" value={c.region} onChange={(v) => set('region', v)} options={REGIONS.map((r) => ({ v: r, label: r }))} />

                <div className="py-1.5">
                  <div className="mb-1 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-white/80">
                    <span>Max players</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-white/40">Custom:</span>
                      <input
                        type="number"
                        min={2}
                        max={120}
                        aria-label="Custom max players"
                        value={c.maxPlayers}
                        onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
                        className="w-16 cut-sm bg-panel2 px-2 py-1 text-right font-display text-xs font-bold text-neon-cyan outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[4, 8, 12, 16, 24, 32, 48, 64].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { sfx.ui(); setMaxPlayers(n); }}
                        className={cx(
                          'cut-sm px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-widest transition',
                          c.maxPlayers === n ? 'bg-neon-pink text-white shadow-[0_0_14px_rgba(255,45,149,0.5)]' : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="py-1.5">
                  <div className="mb-1 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-white/80">
                    <span>Expected players</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-white/40">Custom:</span>
                      <input
                        type="number"
                        min={1}
                        max={c.maxPlayers}
                        aria-label="Custom expected players"
                        value={c.fill}
                        onChange={(e) => setFill(parseInt(e.target.value, 10))}
                        className="w-16 cut-sm bg-panel2 px-2 py-1 text-right font-display text-xs font-bold text-neon-cyan outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[2, 4, 6, 8, 12, 16, 24, 32, 48, 64]
                      .filter((n) => n <= c.maxPlayers)
                      .map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => { sfx.ui(); setFill(n); }}
                          className={cx(
                            'cut-sm px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-widest transition',
                            c.fill === n ? 'bg-neon-pink text-white shadow-[0_0_14px_rgba(255,45,149,0.5)]' : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
                          )}
                        >
                          {n}
                        </button>
                      ))}
                  </div>
                </div>
              </div>

              <div>
                {section('2', 'Arena')}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {LEVEL_IDS.map((id) => {
                    const L = getLevel(id);
                    const active = c.map === id;
                    return (
                      <div
                        key={id}
                        role="button"
                        tabIndex={0}
                        onClick={() => { sfx.ui(); set('map', id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') set('map', id); }}
                        className={cx(
                          'cut group relative cursor-pointer overflow-hidden text-left transition hover:-translate-y-0.5',
                          active ? 'shadow-[0_0_0_2px_#ff2d95,0_0_30px_rgba(255,45,149,0.5)]' : 'shadow-[0_0_0_1px_rgba(120,100,220,0.5)]',
                        )}
                      >
                        <MapPreview level={L} size={180} className="opacity-90 group-hover:opacity-100" />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/85 to-transparent p-2 pt-6">
                          <div className="font-display text-[11px] font-extrabold uppercase tracking-wider text-white">{L.name}</div>
                          <div className="text-[10px] text-white/55">{L.size}</div>
                        </div>
                        {active && <div className="absolute left-1 top-1 bg-neon-pink px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-white">✓ Active</div>}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => { sfx.ui(); set('map', 'random'); }}
                    className={cx(
                      'cut relative flex aspect-square flex-col items-center justify-center gap-1 font-display text-xs font-extrabold uppercase tracking-[0.2em] transition',
                      c.map === 'random' ? 'bg-neon-yellow text-ink shadow-[0_0_24px_rgba(255,225,77,0.5)]' : 'bg-panel2 text-white/80 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] hover:text-neon-yellow',
                    )}
                  >
                    {c.map === 'random' && <span className="absolute left-1 top-1 bg-ink px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-neon-yellow">✓ Active</span>}
                    <span className="text-3xl">🎲</span>Random map
                  </button>
                  <button
                    type="button"
                    onClick={() => { sfx.ui(); set('map', 'procedural'); }}
                    className={cx(
                      'cut relative flex aspect-square flex-col items-center justify-center gap-1 font-display text-xs font-extrabold uppercase tracking-[0.2em] transition',
                      c.map === 'procedural' ? 'bg-neon-cyan text-ink shadow-[0_0_24px_rgba(45,226,255,0.5)]' : 'bg-panel2 text-white/80 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] hover:text-neon-cyan',
                    )}
                  >
                    {c.map === 'procedural' && <span className="absolute left-1 top-1 bg-ink px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-neon-cyan">✓ Active</span>}
                    <span className="text-3xl">⚙</span>Procedural
                  </button>
                </div>

                {/* Always-available arena options & inspector panel */}
                <div className="cut glass neon-border mt-3 grid gap-3 p-3 sm:grid-cols-[168px_1fr]">
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      title="Click map preview to open interactive 2D / 3D map inspector"
                      onClick={() => { sfx.ui(); setDetails(activeLevel); }}
                      className="cut-sm group relative overflow-hidden text-left shadow-[0_0_0_1px_rgba(45,226,255,0.45)] transition hover:shadow-[0_0_0_2px_#2de2ff]"
                    >
                      <MapPreview key={activeLevel.key} level={activeLevel} size={168} className="fade-in transition group-hover:scale-[1.03]" />
                      <div className=" inset-x-0 bottom-0 bg-ink/85 px-2 py-1 text-center font-display text-[9px] font-bold uppercase tracking-wider text-neon-cyan group-hover:bg-neon-cyan group-hover:text-ink">
                        🔍 Click to inspect map
                      </div>
                    </button>
                    <div className="text-center text-[10px] text-white/45">
                      {activeLevel.boxes.length} structures · {activeLevel.pads.length} pads
                    </div>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-display text-sm font-extrabold uppercase tracking-wider text-white">
                          {c.map === 'random' ? `Random Arena (e.g. ${activeLevel.name})` : activeLevel.name}
                        </div>
                        <div className="text-xs text-white/55">{activeLevel.tagline}</div>
                      </div>
                      {!isProc && <Chip color="#a26bff">Preset arena</Chip>}
                    </div>

                    {/* Width & Depth: always visible, configurable for procedural, read-only for presets */}
                    <div className={cx('mt-2 grid grid-cols-2 gap-2 py-1', !isProc && 'pointer-events-none opacity-60')}>
                      <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                        Width <span className="text-neon-cyan">{shownW}m</span>
                        <input
                          type="range"
                          min={60}
                          max={220}
                          step={4}
                          disabled={!isProc}
                          value={shownW}
                          onChange={(e) => set('gen', { ...c.gen, w: +e.target.value })}
                          className="nr w-full"
                          style={{ ['--pct' as string]: ((shownW - 60) / 160) * 100 + '%', ['--fill' as string]: '#2de2ff' }}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
                        Depth <span className="text-neon-cyan">{shownD}m</span>
                        <input
                          type="range"
                          min={60}
                          max={220}
                          step={4}
                          disabled={!isProc}
                          value={shownD}
                          onChange={(e) => set('gen', { ...c.gen, d: +e.target.value })}
                          className="nr w-full"
                          style={{ ['--pct' as string]: ((shownD - 60) / 160) * 100 + '%', ['--fill' as string]: '#2de2ff' }}
                        />
                      </label>
                    </div>

                    {/* Theme: always visible, independent of generation style */}
                    <div className={cx('py-1', !isProc && 'pointer-events-none opacity-60')}>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Theme</div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={!isProc}
                          onClick={() => { sfx.ui(); set('gen', { ...c.gen, theme: 'auto' }); }}
                          className={cx('cut-sm px-2 py-1 font-display text-[10px] font-bold uppercase tracking-wider', shownTheme === 'auto' ? 'bg-neon-yellow text-ink' : 'bg-panel2 text-white/70')}
                        >
                          Auto
                        </button>
                        {PROC_THEMES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            disabled={!isProc}
                            title={t.name}
                            onClick={() => { sfx.ui(); set('gen', { ...c.gen, theme: t.id }); }}
                            className={cx('flex items-center gap-1 cut-sm px-2 py-1 font-display text-[10px] font-bold uppercase tracking-wider', shownTheme === t.id ? 'bg-white text-ink' : 'bg-panel2 text-white/70')}
                          >
                            <span className="h-2.5 w-2.5" style={{ background: t.swatch }} />
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Generation style: always visible, independent of theme */}
                    <div className={cx(!isProc && 'pointer-events-none opacity-60')}>
                      <Segmented
                        label="Generation style"
                        value={shownStyle}
                        onChange={(v) => set('gen', { ...c.gen, style: v })}
                        options={[
                          { v: 'auto', label: 'Auto' },
                          { v: 'mixed', label: 'Mixed' },
                          { v: 'towers', label: 'Towers' },
                          { v: 'maze', label: 'Maze' },
                          { v: 'open', label: 'Open' },
                        ]}
                      />
                    </div>

                    {/* Extra procedural-only options */}
                    {isProc && (
                      <div className="mt-1 border-t border-line/50 pt-2">
                        <Segmented
                          label="Map size preset"
                          value={c.gen.size}
                          onChange={(v) => set('gen', { ...c.gen, size: v, w: SIZE_INFO[v].dim, d: SIZE_INFO[v].dim })}
                          options={(Object.keys(SIZE_INFO) as MapSize[]).map((k) => ({ v: k, label: `${SIZE_INFO[k].name} ${SIZE_INFO[k].dim}m` }))}
                        />
                        <div className="flex items-end gap-2 py-1">
                          <label className="flex-1">
                            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Seed</div>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={c.gen.seed}
                              onChange={(e) => set('gen', { ...c.gen, seed: Math.max(1, Math.min(9999999, parseInt(e.target.value.replace(/\D/g, '') || '1', 10))) })}
                              className={field}
                            />
                          </label>
                          <Btn size="sm" variant="cyan" onClick={() => set('gen', { ...c.gen, seed: Math.floor(Math.random() * 99999) + 1 })}>🎲 Reroll</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="cut glass neon-border p-4">
                {section('3', 'Rules')}
                <Segmented label="Mode" value={c.mode} onChange={(m) => setC((o) => ({ ...o, mode: m, scoreLimit: MODES[m].limits[1] ?? MODES[m].limits[0] }))} options={MODE_ORDER.map((m) => ({ v: m, label: MODES[m].name, color: MODES[m].color }))} />
                <div className="-mt-1 mb-1 text-xs text-white/50">{MODES[c.mode].desc}</div>
                <Segmented
                  label={MODES[c.mode].unit === 'captures' ? 'Capture limit' : MODES[c.mode].unit === 'points' ? 'Point limit' : MODES[c.mode].unit === 'bounties' ? 'Bounty limit' : MODES[c.mode].unit === 'waves' ? 'Wave limit' : c.mode === 'tdm' ? 'Team frag limit' : 'Frag limit'}
                  value={c.scoreLimit}
                  onChange={(v) => set('scoreLimit', v)}
                  options={[...limits.map((l) => ({ v: l, label: String(l) })), { v: 0, label: '∞ Infinite' }]}
                />
                <Segmented label="Time limit" value={c.timeLimit} onChange={(v) => set('timeLimit', v)} options={[180, 300, 600, 900, 0].map((t) => ({ v: t, label: t === 0 ? '∞ Infinite' : fmtTime(t) }))} />
                <Segmented label="Bot skill" value={c.difficulty} onChange={(v) => set('difficulty', v)} options={(Object.keys(DIFFS) as Difficulty[]).map((d) => ({ v: d, label: DIFFS[d].name, color: DIFFS[d].color }))} />
                <Segmented label="Physics mutator" value={c.mutator} onChange={(v) => set('mutator', v)} options={(Object.keys(MUTATORS) as Mutator[]).map((m) => ({ v: m, label: MUTATORS[m].name }))} />
              </div>
              <div className={cx('cut glass p-4', c.cheatsOn ? 'shadow-[inset_0_0_0_1px_rgba(255,59,92,0.7)]' : 'neon-border')}>
                <div className="flex items-center justify-between">
                  {section('4', 'Cheats')}
                  {c.cheatsOn && <Chip color="#ff3b5c">sv_cheats 1</Chip>}
                </div>
                <Toggle label="Enable cheats (sv_cheats)" value={c.cheatsOn} onChange={(v) => set('cheatsOn', v)} hint="Unlocks cheat options here and in the in-game host menu" />
                {c.cheatsOn && <CheatsEditor value={c.cheats} onChange={(v) => set('cheats', v)} />}
              </div>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-ink via-ink/90 to-transparent p-4 pt-10">
          <Btn size="lg" variant="primary" onClick={() => onSubmit(c)} className="pointer-events-auto" disabled={!c.name.trim()}>
            {editing ? 'Apply settings ›' : 'Create lobby ›'}
          </Btn>
        </div>

        {detailsNode}
        {presets && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" onPointerDown={(e) => { if (e.target === e.currentTarget) setPresets(false); }}>
            <div className="cut glass neon-border pop-in nscroll max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-display text-lg font-black uppercase tracking-[0.2em] text-white">Gamemode presets</div>
                  <div className="text-xs text-white/50">Start from a preset, then fine-tune anything below.</div>
                </div>
                <button type="button" onClick={() => setPresets(false)} className="h-8 w-8 bg-panel2 text-lg text-white/80 hover:bg-neon-pink hover:text-white">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {([
                  ['Endless Survival', 'survival', 0, 0, 'Co-op wave defense with no time or wave limit.'],
                  ['King of the Hill', 'koth', 120, 600, 'Hold the hill uncontested to bank points.'],
                  ['Capture the Flag', 'ctf', 5, 600, 'Two flags, two bases, only captures score.'],
                  ['Bounty Hunt', 'bounty', 10, 300, 'Only hunting the marked target scores points.'],
                  ['Duel', 'duel', 10, 300, 'One opponent. Pure aim.'],
                  ['Team Deathmatch', 'tdm', 50, 600, 'Cyan vs Magenta, team frags.'],
                  ['Instagib', 'insta', 20, 300, 'Railguns only, one shot kills.'],
                  ['Classic Deathmatch', 'ffa', 20, 300, 'The original free-for-all.'],
                  ['Custom', 'ffa', 0, 0, 'Infinite limits, tune everything yourself.'],
                ] as [string, ModeId, number, number, string][]).map(([name, mode, score, time, desc]) => (
                  <button key={name} type="button" onClick={() => { sfx.ui(); setC((o) => ({ ...o, mode, scoreLimit: score, timeLimit: time })); setPresets(false); }} className="cut-sm bg-panel2 p-3 text-left transition hover:bg-white/10">
                    <div className="font-display text-xs font-extrabold uppercase tracking-wider" style={{ color: MODES[mode].color }}>{name}</div>
                    <div className="mt-1 text-[11px] leading-tight text-white/55">{desc}</div>
                    <div className="mt-1 font-display text-[10px] text-white/40">{score === 0 ? '∞ score' : score + ' limit'} · {time === 0 ? '∞ time' : fmtTime(time)}</div>
                  </button>
                ))}
              </div>
              <div className="mt-4 border-t border-line/60 pt-3">
                <div className="mb-2 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Fine tune</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-white/70">Mode
                    <select value={c.mode} onChange={(e) => setC((o) => ({ ...o, mode: e.target.value as ModeId, scoreLimit: MODES[e.target.value as ModeId].limits[1] ?? 0 }))} className="mt-1 w-full cut-sm bg-panel2 px-2 py-1.5 font-display text-xs text-white outline-none">
                      {MODE_ORDER.map((m) => <option key={m} value={m}>{MODES[m].name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wider text-white/70">Score limit
                    <select value={c.scoreLimit} onChange={(e) => set('scoreLimit', +e.target.value)} className="mt-1 w-full cut-sm bg-panel2 px-2 py-1.5 font-display text-xs text-white outline-none">
                      <option value={0}>∞ Infinite</option>
                      {MODES[c.mode].limits.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wider text-white/70">Time limit
                    <select value={c.timeLimit} onChange={(e) => set('timeLimit', +e.target.value)} className="mt-1 w-full cut-sm bg-panel2 px-2 py-1.5 font-display text-xs text-white outline-none">
                      <option value={0}>∞ Infinite</option>
                      {[180, 300, 600, 900].map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wider text-white/70">Bot skill
                    <select value={c.difficulty} onChange={(e) => set('difficulty', e.target.value as Difficulty)} className="mt-1 w-full cut-sm bg-panel2 px-2 py-1.5 font-display text-xs text-white outline-none">
                      {(Object.keys(DIFFS) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFS[d].name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex justify-end"><Btn size="sm" variant="cyan" onClick={() => setPresets(false)}>Done</Btn></div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  });

  return view;
}
