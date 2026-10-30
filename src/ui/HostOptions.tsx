import { useEffect, useState } from 'react';
import type { Engine, ScoreRow } from '@/game/engine';
import { DIFFS, type Cheats, type Difficulty } from '@/game/types';
import { Btn, Modal, Panel, Segmented, Toggle } from './kit';
import { CheatsEditor } from './Cheats';

export function HostOptions({ engine, cheatsAllowed, onCheatsAllowed, onCheats, onClose }: { engine: Engine; cheatsAllowed: boolean; onCheatsAllowed: (v: boolean) => void; onCheats: (c: Cheats) => void; onClose: () => void }) {
  const [cheats, setCheats] = useState<Cheats>({ ...engine.cheats });
  const [diff, setDiff] = useState<Difficulty>(engine.rules.difficulty);
  const [rows, setRows] = useState<ScoreRow[]>(engine.getScoreboard());
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    const i = setInterval(() => setRows(engine.getScoreboard()), 500);
    return () => clearInterval(i);
  }, [engine]);
  const applyCheats = (c: Cheats) => {
    setCheats(c);
    engine.setCheats(c);
    onCheats(c);
  };
  return (
    <Modal onClose={onClose} z={60}>
      <Panel title="Host options" onClose={onClose} className="max-h-[92vh] w-full max-w-3xl">
        <div className="nscroll grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <div>
            <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Match</div>
            <Segmented label="Bot skill" value={diff} onChange={(d) => { setDiff(d); engine.setDifficulty(d); }} options={(Object.keys(DIFFS) as Difficulty[]).map((d) => ({ v: d, label: DIFFS[d].name, color: DIFFS[d].color }))} />
            <div className="flex flex-wrap gap-2 py-2">
              <Btn size="sm" variant="ghost" onClick={() => engine.addTime(120)}>+2 min</Btn>
              <Btn size="sm" variant="ghost" onClick={() => { engine.addBot(); setRows(engine.getScoreboard()); }} disabled={rows.length >= 16}>+ Add bot</Btn>
              {confirmEnd ? (
                <Btn size="sm" variant="danger" onClick={() => { engine.forceEnd(); onClose(); }}>Confirm end</Btn>
              ) : (
                <Btn size="sm" variant="danger" onClick={() => setConfirmEnd(true)}>End match now</Btn>
              )}
            </div>
            <div className="mb-1 mt-2 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Players ({rows.length})</div>
            <div className="max-h-64 overflow-y-auto nscroll">
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
}
