import { useEffect, useState } from './hooks';
import type { Engine, ScoreRow } from '@/game/engine';
import { DIFFS, LEVEL_IDS, type Cheats, type Difficulty, type LevelId } from '@/game/types';
import { PROC_THEMES } from '@/game/levels';
import { MAP_NICE } from '@/game/servers';
import { Btn, Modal, Panel, Segmented, Toggle, cx, sfx } from './kit';
import { CheatsEditor } from './Cheats';
import { component } from './dom';
import type { View } from './dom';

export interface HostOptionsProps {
  engine: Engine;
  cheatsAllowed: boolean;
  onCheatsAllowed: (v: boolean) => void;
  onCheats: (c: Cheats) => void;
  onMapChange?: (level: LevelId, gen?: Engine['server']['gen']) => void;
  onClose: () => void;
}

export function HostOptions(props: HostOptionsProps): View<HostOptionsProps> {
  return component<HostOptionsProps>(props, () => {
    const { engine, cheatsAllowed, onCheatsAllowed, onCheats, onMapChange, onClose } = props;
    const [cheats, setCheats] = useState<Cheats>({ ...engine.cheats });
    const [diff, setDiff] = useState<Difficulty>(engine.rules.difficulty);
    const [rows, setRows] = useState<ScoreRow[]>(engine.getScoreboard());
    const [confirmEnd, setConfirmEnd] = useState(false);
    const [curMap, setCurMap] = useState<LevelId>(engine.server.level);
    const [curTheme, setCurTheme] = useState<string>(engine.server.gen?.theme ?? (engine.level.themeName ?? 'Neon').toLowerCase());

    useEffect(() => {
      const i = setInterval(() => setRows(engine.getScoreboard()), 500);
      return () => clearInterval(i);
    }, [engine]);

    const applyCheats = (c: Cheats) => {
      setCheats(c);
      engine.setCheats(c);
      onCheats(c);
    };

    const switchMap = (lvl: LevelId) => {
      sfx.ui();
      setCurMap(lvl);
      const gen =
        lvl === 'procedural'
          ? engine.server.gen ?? { seed: Math.floor(Math.random() * 99999) + 1, size: 'medium', w: 112, d: 112, theme: curTheme, style: 'auto' }
          : undefined;
      engine.setMapOrTheme(lvl, gen);
      if (lvl !== 'procedural') setCurTheme((engine.level.themeName ?? 'Neon').toLowerCase());
      onMapChange?.(lvl, gen);
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
        onMapChange?.('procedural', nextGen);
      } else if (found) {
        engine.applyThemeOnly(found.theme);
      }
    };

    return (
      <Modal onClose={onClose} z={60}>
        <Panel title="Host options" onClose={onClose} className="max-h-[92vh] w-full max-w-3xl">
          <div className="nscroll grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
            <div>
              {engine.warmup && (
                <div className="mb-3 cut-sm bg-neon-cyan/15 p-3 shadow-[inset_0_0_0_1px_rgba(45,226,255,0.45)]">
                  <div className="font-display text-xs font-extrabold uppercase tracking-wider text-neon-cyan">Pre-match warmup active</div>
                  <div className="mt-0.5 text-xs text-white/65">Damage and scoring are disabled while roaming.</div>
                  <Btn size="sm" variant="primary" className="mt-2" onClick={() => { engine.startMatchFromWarmup(); onClose(); }}>
                    ▶ Start match now
                  </Btn>
                </div>
              )}

              <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Arena & Theme</div>
              <div className="flex flex-wrap gap-1.5 py-1">
                {([...LEVEL_IDS, 'procedural'] as LevelId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => switchMap(id)}
                    className={cx(
                      'cut-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider transition',
                      curMap === id ? 'bg-neon-pink text-white' : 'bg-panel2 text-white/70 hover:text-white',
                    )}
                  >
                    {MAP_NICE[id]}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 py-1">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Theme (changes lighting in place)</div>
                <div className="flex flex-wrap gap-1.5">
                  {PROC_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => switchTheme(t.id)}
                      className={cx(
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

              <div className="mb-1 mt-3 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Match</div>
              <Segmented label="Bot skill" value={diff} onChange={(d) => { setDiff(d); engine.setDifficulty(d); }} options={(Object.keys(DIFFS) as Difficulty[]).map((d) => ({ v: d, label: DIFFS[d].name, color: DIFFS[d].color }))} />
              <div className="flex flex-wrap gap-2 py-2">
                <Btn size="sm" variant="ghost" onClick={() => engine.addTime(120)}>+2 min</Btn>
                {!engine.warmup && (
                  <Btn size="sm" variant="ghost" onClick={() => { engine.addBot(); setRows(engine.getScoreboard()); }} disabled={rows.length >= 120}>
                    + Add bot
                  </Btn>
                )}
                {!engine.warmup && (
                  confirmEnd ? (
                    <Btn size="sm" variant="danger" onClick={() => { engine.forceEnd(); onClose(); }}>Confirm end</Btn>
                  ) : (
                    <Btn size="sm" variant="danger" onClick={() => setConfirmEnd(true)}>End match now</Btn>
                  )
                )}
              </div>
              <div className="mb-1 mt-2 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Players ({rows.length})</div>
              <div className="nscroll max-h-48 overflow-y-auto">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 border-b border-line/30 py-1 text-sm">
                    <span className="truncate">{r.isPlayer && '★ '}{r.name}</span>
                    <span className="ml-auto font-display text-[11px] text-white/50">{r.kills}/{r.deaths}</span>
                    {!r.isPlayer && (
                      <button type="button" onClick={() => { engine.kick(r.id); setRows(engine.getScoreboard()); }} className="font-display text-[10px] font-bold uppercase tracking-wider text-neon-red/80 hover:text-white">Kick</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-red">Cheats</div>
              <Toggle label="sv_cheats" value={cheatsAllowed} onChange={(v) => { onCheatsAllowed(v); if (!v) applyCheats(Object.fromEntries(Object.keys(cheats).map((k) => [k, false])) as unknown as Cheats); }} hint="Allow cheats on this server" />
              {cheatsAllowed ? <CheatsEditor value={cheats} onChange={applyCheats} compact /> : <div className="py-4 text-sm text-white/40">Enable sv_cheats to unlock cheat options.</div>}
            </div>
          </div>
          <div className="flex shrink-0 justify-end border-t border-line/60 px-5 py-3">
            <Btn variant="cyan" onClick={onClose}>Done</Btn>
          </div>
        </Panel>
      </Modal>
    );
  });
}
