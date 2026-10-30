import type { Settings } from '@/game/types';
import { LEVEL_IDS } from '@/game/types';
import { getLevel } from '@/game/levels';
import { loadProfile, loadScores } from '@/game/storage';
import { randomPlayerName } from '@/game/names';
import { Btn, Logo, MapPreview, sfx } from './kit';
import { MapDetails } from './MapDetails';
import { component, every, listen } from './dom';
import type { View } from './dom';

export interface MenuProps {
  online: number;
  hosting?: boolean;
  settings: Settings;
  onName: (n: string) => void;
  onQuick: () => void;
  onServers: () => void;
  onCustom: () => void;
  onScores: () => void;
  onSettings: () => void;
  onHelp: () => void;
}

export function Menu(props: MenuProps): View<MenuProps> {
  const state = {
    idx: Math.floor(Math.random() * LEVEL_IDS.length),
    inspectOpen: false,
  };
  let details: View<{ level: ReturnType<typeof getLevel>; onClose: () => void }> | null = null;

  const view = component<MenuProps>(props, (p) => {
    const profile = loadProfile();
    const best = loadScores()[0];
    const level = getLevel(LEVEL_IDS[state.idx]);
    const closeDetails = () => {
      state.inspectOpen = false;
      details?.dispose();
      details = null;
      view.update();
    };
    const detailsNode = state.inspectOpen ? (details ??= MapDetails({ level, onClose: closeDetails })).root : null;
    return (
      <div className="absolute inset-0 overflow-y-auto overflow-x-hidden nscroll">
        <div className="relative flex min-h-full flex-col items-center justify-center gap-8 p-5 py-10 lg:flex-row lg:items-center lg:justify-center lg:gap-14">
          <div className="flex w-full max-w-md flex-col items-center text-center lg:items-start lg:text-left">
            <div className="mb-1 inline-flex items-center gap-2 bg-neon-cyan/10 px-3 py-1 font-display text-[10px] font-bold uppercase tracking-[0.3em] text-neon-cyan shadow-[inset_0_0_0_1px_rgba(45,226,255,0.4)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-neon-green" />
              {p.online.toLocaleString()} pilots online
            </div>
            <Logo />
            <p className="mt-3 font-display text-[11px] uppercase tracking-[0.45em] text-neon-yellow sm:text-xs">Low-poly · High-speed · Arena FPS</p>
            <div className="mt-8 flex w-full flex-col gap-3">
              <Btn size="lg" variant="primary" onClick={p.onQuick} className="w-full">
                ▶ Quick play
              </Btn>
              <div className="grid grid-cols-2 gap-3">
                <Btn variant="cyan" onClick={p.onServers}>
                  Server browser
                </Btn>
                <Btn variant="yellow" onClick={p.onCustom}>
                  {p.hosting ? '★ Your lobby' : 'Host lobby'}
                </Btn>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Btn variant="ghost" size="sm" onClick={p.onScores}>
                  Hall of fame
                </Btn>
                <Btn variant="ghost" size="sm" onClick={p.onSettings}>
                  Settings
                </Btn>
                <Btn variant="ghost" size="sm" onClick={p.onHelp}>
                  Controls
                </Btn>
              </div>
            </div>
            <p className="mt-5 text-xs uppercase tracking-[0.25em] text-white/40">
              Press <span className="text-white/80">Enter</span> to jump in
            </p>
          </div>

          <div className="flex w-full max-w-sm flex-col gap-4">
            <div className="cut glass neon-border p-4">
              <div className="mb-2 font-display text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">Pilot card</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={p.settings.name}
                  maxLength={18}
                  onChange={(e: Event) => p.onName((e.target as HTMLInputElement).value.replace(/[^\w\- .]/g, ''))}
                  onFocus={() => sfx.hover()}
                  aria-label="Player name"
                  className="min-w-0 flex-1 cut-sm bg-panel2 px-3 py-2 font-display text-lg font-bold text-white outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
                />
                <button
                  type="button"
                  title="Generate a new name"
                  onClick={() => {
                    sfx.ui();
                    p.onName(randomPlayerName());
                  }}
                  className="cut-sm shrink-0 bg-panel2 px-3 font-display text-lg text-neon-cyan shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] hover:text-white"
                >
                  ⟳
                </button>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {(
                  [
                    ['Matches', profile.matches],
                    ['Wins', profile.wins],
                    ['Frags', profile.kills],
                    ['Best', best ? best.score.toLocaleString() : '—'],
                  ] as [string, string | number][]
                ).map(([l, v]) => (
                  <div key={l}>
                    <div className="font-display text-sm font-extrabold text-neon-yellow">{v}</div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-white/45">{l}</div>
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              title="Click to inspect arena layout"
              onClick={() => {
                sfx.ui();
                state.inspectOpen = true;
                view.update();
              }}
              className="cut glass neon-border group overflow-hidden text-left transition hover:shadow-[0_0_0_1px_#2de2ff]"
            >
              <div className="relative">
                <MapPreview key={level.id} level={level} size={260} className="fade-in opacity-90 transition group-hover:scale-[1.02] group-hover:opacity-100" />
                <div className="absolute right-2 top-2 cut-sm bg-ink/85 px-2 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-neon-cyan group-hover:bg-neon-cyan group-hover:text-ink">
                  🔍 Inspect
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/85 to-transparent p-3 pt-10">
                  <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-neon-pink">
                    {level.size} m · {level.boxes.length} structures · {level.pads.length} pads
                  </div>
                  <div className="font-display text-base font-extrabold uppercase tracking-wider text-white">{level.name}</div>
                  <div className="text-xs text-white/60">{level.tagline}</div>
                </div>
              </div>
              <div className="flex">
                {LEVEL_IDS.map((id, i) => (
                  <div key={id} className={'h-1 flex-1 transition-colors ' + (i === state.idx ? 'bg-neon-pink' : 'bg-line')} />
                ))}
              </div>
            </button>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] uppercase tracking-[0.3em] text-white/30">
          Slide · Dash · Wall-jump · Rocket-jump
        </div>
        {detailsNode}
      </div>
    );
  });

  // rotate the featured arena, pausing while the map inspector is open
  every(view, () => {
    if (state.inspectOpen) return;
    state.idx = (state.idx + 1) % LEVEL_IDS.length;
    view.update();
  }, 4500);

  listen(view, window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && !(e.target instanceof HTMLInputElement)) view.props.onQuick();
  });

  return view;
}
