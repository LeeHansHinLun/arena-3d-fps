import { useEffect, useMemo, useState } from 'react';
import type { Engine, ScoreRow } from '@/game/engine';
import { DIFFS, LEVEL_IDS, MODE_ORDER, MODES, MUTATORS, REGIONS, SIZE_INFO, fmtTime, type BuiltinLevelId, type Cheats, type Difficulty, type LevelId, type MapSize, type ModeId, type Mutator, type Rules, type Settings } from '@/game/types';
import { PROC_THEMES } from '@/game/levels';
import { MAP_NICE } from '@/game/servers';
import { MAX_PLAYERS_MAX, MAX_PLAYERS_MIN, type LobbyConfig } from '@/game/lobby';
import { Btn, Chip, Modal, Panel, Segmented, Toggle, sfx } from './kit';
import { CheatsEditor } from './Cheats';
import { cn } from '@/utils/cn';

type Tab = 'Server' | 'Arena' | 'Rules' | 'Players' | 'Cheats';
const TABS: Tab[] = ['Server', 'Arena', 'Rules', 'Players', 'Cheats'];

const field = 'w-full cut-sm bg-panel2 px-3 py-1.5 font-display text-sm text-white outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]';

/**
 * In-game host menu. Mirrors every option that exists in the lobby screen, so the host never has
 * to leave the server to change how it plays.
 */
export function HostOptions({
  engine,
  config,
  onConfig,
  settings,
  onSettings,
  onClose,
}: {
  engine: Engine;
  config: LobbyConfig;
  onConfig: (next: LobbyConfig, resolved?: LevelId) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Server');
  const [cfg, setCfg] = useState<LobbyConfig>(config);
  const [rows, setRows] = useState<ScoreRow[]>(engine.getScoreboard());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [curMap, setCurMap] = useState<LevelId>(engine.server.level);
  const [curTheme, setCurTheme] = useState<string>(engine.server.gen?.theme ?? (engine.level.themeName ?? 'Neon').toLowerCase());
  const [cheatsOn, setCheatsOn] = useState(config.cheatsOn);
  const [cheats, setCheats] = useState<Cheats>({ ...engine.cheats });

  useEffect(() => {
    const i = setInterval(() => setRows(engine.getScoreboard()), 500);
    return () => clearInterval(i);
  }, [engine]);

  /** Everything except the match rules applies immediately (no round restart needed). */
  const patch = (p: Partial<LobbyConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    onConfig(next);
    engine.patchServer({ name: next.name, region: next.region, password: !!next.password.trim() });
  };

  const patchRules = (p: Partial<Rules>) => {
    setRulesDirty(true);
    const next: LobbyConfig = {
      ...cfg,
      ...(p.mode !== undefined ? { mode: p.mode } : {}),
      ...(p.scoreLimit !== undefined ? { scoreLimit: p.scoreLimit } : {}),
      ...(p.timeLimit !== undefined ? { timeLimit: p.timeLimit } : {}),
      ...(p.difficulty !== undefined ? { difficulty: p.difficulty } : {}),
      ...(p.mutator !== undefined ? { mutator: p.mutator } : {}),
    };
    setCfg(next);
  };

  const applyRules = () => {
    const rules: Rules = {
      mode: cfg.mode,
      scoreLimit: cfg.scoreLimit,
      timeLimit: cfg.timeLimit,
      difficulty: cfg.difficulty,
      mutator: cfg.mutator,
      maxPlayers: cfg.maxPlayers,
      cheats: cfg.cheatsOn ? cfg.cheats : undefined,
    };
    onConfig(cfg);
    engine.applyRules(rules);
    engine.restart();
    setRulesDirty(false);
    sfx.ui();
    onClose();
  };

  const switchMap = (lvl: LevelId) => {
    sfx.ui();
    setCurMap(lvl);
    const gen =
      lvl === 'procedural'
        ? engine.server.gen ?? { seed: Math.floor(Math.random() * 99999) + 1, size: 'medium' as MapSize, w: 112, d: 112, theme: curTheme, style: 'auto' }
        : undefined;
    engine.setMapOrTheme(lvl, gen);
    if (lvl !== 'procedural') setCurTheme((engine.level.themeName ?? 'Neon').toLowerCase());
    patch({ map: lvl === 'procedural' ? 'procedural' : (lvl as BuiltinLevelId), gen: gen ? { ...cfg.gen, ...gen } : cfg.gen });
  };

  const pickRandom = () => {
    sfx.ui();
    const lvl = LEVEL_IDS[Math.floor(Math.random() * LEVEL_IDS.length)];
    const gen = undefined;
    engine.setMapOrTheme(lvl, gen);
    setCurMap(lvl);
    const next = { ...cfg, map: 'random' as const };
    setCfg(next);
    onConfig(next, lvl);
  };

  const switchTheme = (themeId: string) => {
    sfx.ui();
    setCurTheme(themeId);
    const found = PROC_THEMES.find((t) => t.id === themeId);
    if (curMap === 'procedural') {
      const nextGen = {
        seed: engine.server.gen?.seed ?? 1337,
        size: engine.server.gen?.size ?? 'medium',
        w: engine.server.gen?.w ?? 112,
        d: engine.server.gen?.d ?? 112,
        style: engine.server.gen?.style ?? 'auto',
        theme: themeId,
      };
      engine.setMapOrTheme('procedural', nextGen);
      patch({ gen: { ...cfg.gen, ...nextGen } });
    } else if (found) {
      engine.applyThemeOnly(found.theme);
    }
  };

  const setMaxPlayers = (raw: number) => {
    const v = Math.max(MAX_PLAYERS_MIN, Math.min(MAX_PLAYERS_MAX, Math.round(raw || MAX_PLAYERS_MIN)));
    patch({ maxPlayers: v });
  };

  const applyCheats = (c: Cheats) => {
    setCheats(c);
    engine.setCheats(c);
    const next = { ...cfg, cheatsOn: true, cheats: c };
    setCfg(next);
    onConfig(next);
  };

  const toggleSvCheats = (v: boolean) => {
    sfx.ui();
    setCheatsOn(v);
    const zero = Object.fromEntries(Object.keys(cheats).map((k) => [k, false])) as unknown as Cheats;
    const c = v ? cheats : zero;
    if (v) engine.setCheats(cheats);
    else {
      engine.setCheats(zero);
      setCheats(zero);
    }
    const next = { ...cfg, cheatsOn: v, cheats: c };
    setCfg(next);
    onConfig(next);
  };

  const botRows = useMemo(() => rows.filter((r) => !r.isPlayer), [rows]);
  const limits = MODES[cfg.mode].limits;

  return (
    <Modal onClose={onClose} z={60}>
      <Panel title="Server options" onClose={onClose} className="max-h-[92vh] w-full max-w-3xl">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/60 px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { sfx.ui(); setTab(t); }}
              className={cn(
                'px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.2em] transition',
                tab === t ? 'border-b-2 border-neon-pink text-white' : 'text-white/50 hover:text-white',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="nscroll min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'Server' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Server name</div>
                <input type="text" maxLength={32} value={cfg.name} onChange={(e) => patch({ name: e.target.value })} className={field} />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Password (optional)</div>
                <input type="text" maxLength={16} value={cfg.password} placeholder="none" onChange={(e) => patch({ password: e.target.value })} className={cn(field, 'placeholder:text-white/25')} />
              </label>
              <div className="sm:col-span-2">
                <Toggle
                  label="Public lobby"
                  value={cfg.isPublic}
                  onChange={(v) => patch({ isPublic: v })}
                  hint={cfg.isPublic ? 'Listed in the server browser — anyone can join' : 'Not listed anywhere — nobody can join unless you add them'}
                />
                <Segmented label="Region" value={cfg.region} onChange={(v) => patch({ region: v })} options={REGIONS.map((r) => ({ v: r, label: r }))} />
                <div className="py-1.5">
                  <div className="mb-1 flex items-center justify-between text-sm font-semibold uppercase tracking-wider text-white/80">
                    <span>Max players</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/40">{rows.length} connected</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[4, 8, 12, 16, 24, 32, 48, 64].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { sfx.ui(); setMaxPlayers(n); }}
                        className={cn(
                          'cut-sm px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-widest transition',
                          cfg.maxPlayers === n ? 'bg-neon-pink text-white shadow-[0_0_14px_rgba(255,45,149,0.5)]' : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={MAX_PLAYERS_MIN}
                      max={MAX_PLAYERS_MAX}
                      aria-label="Custom max players"
                      value={cfg.maxPlayers}
                      onChange={(e) => setMaxPlayers(parseInt(e.target.value, 10))}
                      className="w-16 cut-sm bg-panel2 px-2 py-1 text-right font-display text-xs font-bold text-neon-cyan outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
                    />
                  </div>
                  <div className="mt-1 text-xs text-white/40">Slot count is applied from the next round.</div>
                </div>
              </div>
            </div>
          )}

          {tab === 'Arena' && (
            <div>
              <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Arena</div>
              <div className="flex flex-wrap gap-1.5 py-1">
                {([...LEVEL_IDS, 'procedural'] as LevelId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => switchMap(id)}
                    className={cn(
                      'cut-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider transition',
                      curMap === id ? 'bg-neon-pink text-white' : 'bg-panel2 text-white/70 hover:text-white',
                    )}
                  >
                    {MAP_NICE[id]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={pickRandom}
                  className={cn(
                    'cut-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider transition',
                    cfg.map === 'random' ? 'bg-neon-yellow text-ink' : 'bg-panel2 text-white/70 hover:text-white',
                  )}
                >
                  🎲 Random
                </button>
              </div>

              <div className="mt-2 py-1">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Theme (changes lighting in place)</div>
                <div className="flex flex-wrap gap-1.5">
                  {PROC_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => switchTheme(t.id)}
                      className={cn(
                        'flex items-center gap-1 cut-sm px-2 py-1 font-display text-[10px] font-bold uppercase tracking-wider',
                        curTheme === t.id ? 'bg-white text-ink' : 'bg-panel2 text-white/70 hover:text-white',
                      )}
                    >
                      <span className="h-2.5 w-2.5" style={{ background: t.swatch }} />
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {curMap === 'procedural' && (
                <div className="mt-2 border-t border-line/50 pt-2">
                  <Segmented
                    label="Map size"
                    value={cfg.gen.size}
                    onChange={(v) => {
                      const gen = { ...cfg.gen, size: v, w: SIZE_INFO[v].dim, d: SIZE_INFO[v].dim };
                      engine.setMapOrTheme('procedural', gen);
                      patch({ gen });
                    }}
                    options={(Object.keys(SIZE_INFO) as MapSize[]).map((k) => ({ v: k, label: `${SIZE_INFO[k].name} ${SIZE_INFO[k].dim}m` }))}
                  />
                  <Segmented
                    label="Generation style"
                    value={cfg.gen.style}
                    onChange={(v) => {
                      const gen = { ...cfg.gen, style: v };
                      engine.setMapOrTheme('procedural', gen);
                      patch({ gen });
                    }}
                    options={[{ v: 'auto', label: 'Auto' }, { v: 'mixed', label: 'Mixed' }, { v: 'towers', label: 'Towers' }, { v: 'maze', label: 'Maze' }, { v: 'open', label: 'Open' }]}
                  />
                  <div className="flex items-end gap-2 py-1">
                    <label className="flex-1">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Seed</div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={cfg.gen.seed}
                        onChange={(e) => {
                          const seed = Math.max(1, Math.min(9999999, parseInt(e.target.value.replace(/\D/g, '') || '1', 10)));
                          patch({ gen: { ...cfg.gen, seed } });
                        }}
                        className={field}
                      />
                    </label>
                    <Btn size="sm" variant="cyan" onClick={() => {
                      const gen = { ...cfg.gen, seed: Math.floor(Math.random() * 99999) + 1 };
                      engine.setMapOrTheme('procedural', gen);
                      patch({ gen });
                    }}>🎲 Reroll</Btn>
                  </div>
                  <div className="text-xs text-white/40">Changing the layout rebuilds the arena and respawns everyone.</div>
                </div>
              )}
            </div>
          )}

          {tab === 'Rules' && (
            <div>
              <Segmented
                label="Mode"
                value={cfg.mode}
                onChange={(m) => { sfx.ui(); patchRules({ mode: m as ModeId, scoreLimit: MODES[m as ModeId].limits[1] ?? MODES[m as ModeId].limits[0] }); }}
                options={MODE_ORDER.map((m) => ({ v: m, label: MODES[m].name, color: MODES[m].color }))}
              />
              <div className="-mt-1 mb-1 text-xs text-white/50">{MODES[cfg.mode].desc}</div>
              <Segmented
                label={MODES[cfg.mode].unit === 'captures' ? 'Capture limit' : MODES[cfg.mode].unit === 'points' ? 'Point limit' : MODES[cfg.mode].unit === 'bounties' ? 'Bounty limit' : MODES[cfg.mode].unit === 'waves' ? 'Wave limit' : cfg.mode === 'tdm' ? 'Team frag limit' : 'Frag limit'}
                value={cfg.scoreLimit}
                onChange={(v) => patchRules({ scoreLimit: v })}
                options={[...limits.map((l) => ({ v: l, label: String(l) })), { v: 0, label: '∞ Infinite' }]}
              />
              <Segmented label="Time limit" value={cfg.timeLimit} onChange={(v) => patchRules({ timeLimit: v })} options={[180, 300, 600, 900, 0].map((t) => ({ v: t, label: t === 0 ? '∞ Infinite' : fmtTime(t) }))} />
              <Segmented label="Bot skill" value={cfg.difficulty} onChange={(d) => patchRules({ difficulty: d as Difficulty })} options={(Object.keys(DIFFS) as Difficulty[]).map((d) => ({ v: d, label: DIFFS[d].name, color: DIFFS[d].color }))} />
              <Segmented label="Physics mutator" value={cfg.mutator} onChange={(m) => patchRules({ mutator: m as Mutator })} options={(Object.keys(MUTATORS) as Mutator[]).map((m) => ({ v: m, label: MUTATORS[m].name }))} />
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/50 pt-2">
                <Btn size="sm" variant="cyan" onClick={applyRules} disabled={!rulesDirty}>Apply &amp; restart round</Btn>
                <Btn size="sm" variant="ghost" onClick={() => { engine.addTime(120); }}>+2 min</Btn>
                {confirmEnd ? (
                  <Btn size="sm" variant="danger" onClick={() => { engine.forceEnd(); onClose(); }}>Confirm end match</Btn>
                ) : (
                  <Btn size="sm" variant="danger" onClick={() => setConfirmEnd(true)}>End match</Btn>
                )}
                <span className="text-xs text-white/40">{rulesDirty ? 'Rule changes need a fresh round.' : 'Rules match the current round.'}</span>
              </div>
            </div>
          )}

          {tab === 'Players' && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Btn size="sm" variant="ghost" onClick={() => { engine.addBot(); setRows(engine.getScoreboard()); }} disabled={rows.length >= 120}>+ Add bot</Btn>
                <Btn size="sm" variant="ghost" onClick={() => {
                  for (let i = rows.length; i < Math.min(cfg.maxPlayers, 120); i++) engine.addBot();
                  setRows(engine.getScoreboard());
                }} disabled={rows.length >= Math.min(cfg.maxPlayers, 120)}>Fill bots</Btn>
                <Btn size="sm" variant="ghost" onClick={() => {
                  for (const r of engine.getScoreboard()) if (!r.isPlayer) engine.kick(r.id);
                  setRows(engine.getScoreboard());
                }} disabled={botRows.length === 0}>Kick all bots</Btn>
                <span className="ml-auto font-display text-[11px] uppercase tracking-wider text-white/45">{rows.length}/{cfg.maxPlayers} connected</span>
              </div>
              <div className="nscroll max-h-[52vh] overflow-y-auto">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 border-b border-line/30 py-1 text-sm">
                    <span className="truncate">{r.isPlayer && '★ '}{r.name}</span>
                    {r.alive ? <Chip color="#7dff6b">Alive</Chip> : <Chip color="#ff3b5c">Dead</Chip>}
                    <span className="ml-auto font-display text-[11px] text-white/50">{r.kills}/{r.deaths} · {r.ping} ms</span>
                    {!r.isPlayer && (
                      <button type="button" onClick={() => { engine.kick(r.id); setRows(engine.getScoreboard()); }} className="font-display text-[10px] font-bold uppercase tracking-wider text-neon-red/80 hover:text-white">Kick</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'Cheats' && (
            <div>
              <Toggle label="sv_cheats" value={cheatsOn} onChange={toggleSvCheats} hint="Allow cheats on this server" />
              {cheatsOn
                ? <CheatsEditor value={cheats} onChange={applyCheats} compact settings={settings} onSettings={onSettings} />
                : <div className="py-4 text-sm text-white/40">Enable sv_cheats to unlock cheat options.</div>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-line/60 px-5 py-3">
          <span className="font-display text-[10px] uppercase tracking-[0.25em] text-white/35">Host only · changes apply live where possible</span>
          <Btn variant="cyan" onClick={onClose}>Done</Btn>
        </div>
      </Panel>
    </Modal>
  );
}
