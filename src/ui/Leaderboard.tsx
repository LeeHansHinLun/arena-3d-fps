import { clearScores, loadProfile, loadScores } from '@/game/storage';
import { MODES, type ScoreEntry } from '@/game/types';
import { MAP_NICE } from '@/game/servers';
import { Btn, Chip, Modal, Panel, sfx, cx } from './kit';
import { component } from './dom';

export function ScoreTable(props: { rows: ScoreEntry[]; highlight?: number; limit?: number }) {
  const list = props.limit ? props.rows.slice(0, props.limit) : props.rows;
  if (!list.length) {
    return <div className="px-5 py-10 text-center text-white/50">No scores yet. Jump into a match and set the first record!</div>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-[0.2em] text-white/50">
        <tr>
          <th className="px-3 py-2">#</th>
          <th className="px-2 py-2">Pilot</th>
          <th className="px-2 py-2 text-right">Score</th>
          <th className="hidden px-2 py-2 text-right sm:table-cell">K / D</th>
          <th className="hidden px-2 py-2 text-right md:table-cell">HS</th>
          <th className="px-2 py-2">Mode</th>
          <th className="hidden px-2 py-2 sm:table-cell">Map</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => (
          <tr key={r.date + r.name + i} className={cx('border-t border-line/40', props.highlight === i + 1 && 'bg-neon-yellow/15 text-neon-yellow')}>
            <td className="px-3 py-2 font-display text-xs">{i + 1 <= 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
            <td className="px-2 py-2 font-semibold">
              {r.name}
              {r.won && <span className="ml-1.5 text-[10px] text-neon-green">WIN</span>}
            </td>
            <td className="px-2 py-2 text-right font-display font-bold text-neon-cyan">{r.score.toLocaleString()}</td>
            <td className="hidden px-2 py-2 text-right sm:table-cell">
              {r.kills} / {r.deaths}
            </td>
            <td className="hidden px-2 py-2 text-right md:table-cell">{r.headshots}</td>
            <td className="px-2 py-2">
              <Chip color={MODES[r.mode].color}>{MODES[r.mode].short}</Chip>
            </td>
            <td className="hidden px-2 py-2 text-white/60 sm:table-cell">{MAP_NICE[r.level]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Leaderboard(props: { onClose: () => void }) {
  const state = {
    cheatedTab: false,
    rows: loadScores(false),
    confirm: false,
  };

  const view = component(props, () => {
    const p = loadProfile();
    const switchTab = (cheated: boolean) => {
      sfx.ui();
      state.cheatedTab = cheated;
      state.rows = loadScores(cheated);
      state.confirm = false;
      view.update();
    };
    return (
      <Modal onClose={props.onClose}>
        <Panel title="Hall of Fame" onClose={props.onClose} className="max-h-[90vh] w-full max-w-3xl">
          <div className="grid shrink-0 grid-cols-4 gap-px border-b border-line/60 bg-line/40 text-center">
            {[
              ['Matches', p.matches],
              ['Wins', p.wins],
              ['Frags', p.kills],
              ['K/D', p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2)],
            ].map(([l, v]) => (
              <div key={l as string} className="bg-panel/90 py-2">
                <div className="font-display text-lg font-extrabold text-neon-yellow">{v}</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">{l}</div>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-line/60 px-4 py-2">
            <button
              type="button"
              onClick={() => switchTab(false)}
              className={cx(
                'cut-sm px-3.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.2em] transition',
                !state.cheatedTab ? 'bg-neon-cyan text-ink shadow-[0_0_14px_rgba(45,226,255,0.45)]' : 'bg-panel2 text-white/60 hover:text-white',
              )}
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => switchTab(true)}
              className={cx(
                'cut-sm px-3.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.2em] transition',
                state.cheatedTab ? 'bg-neon-red text-white shadow-[0_0_14px_rgba(255,59,92,0.45)]' : 'bg-panel2 text-white/60 hover:text-white',
              )}
            >
              Cheats (sv_cheats)
            </button>
            <span className="ml-auto text-xs text-white/40">{state.cheatedTab ? 'Matches played with cheats enabled' : 'Official unassisted records'}</span>
          </div>
          <div className="nscroll min-h-0 flex-1 overflow-auto">
            <ScoreTable rows={state.rows} />
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-line/60 px-5 py-3">
            <span className="text-xs text-white/40">Stored locally in your browser</span>
            {state.confirm ? (
              <div className="flex gap-2">
                <Btn
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    clearScores(state.cheatedTab);
                    state.rows = [];
                    state.confirm = false;
                    view.update();
                  }}
                >
                  Really clear
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  back
                  onClick={() => {
                    state.confirm = false;
                    view.update();
                  }}
                >
                  Cancel
                </Btn>
              </div>
            ) : (
              <Btn
                size="sm"
                variant="ghost"
                disabled={!state.rows.length}
                onClick={() => {
                  state.confirm = true;
                  view.update();
                }}
              >
                Clear {state.cheatedTab ? 'cheats ' : ''}table
              </Btn>
            )}
          </div>
        </Panel>
      </Modal>
    );
  });

  return view;
}
