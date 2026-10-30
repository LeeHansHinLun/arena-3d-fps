import { useEffect, useState } from 'react';
import type { Settings } from '@/game/types';
import { LEVEL_IDS } from '@/game/types';
import { getLevel } from '@/game/levels';
import { loadProfile, loadScores } from '@/game/storage';
import { randomPlayerName } from '@/game/names';
import { Btn, Logo, MapPreview, sfx } from './kit';

export function Menu({
  settings, onName, onQuick, onServers, onCustom, onScores, onSettings, onHelp, hosting, online,
}: {
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
}) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * LEVEL_IDS.length));
  const profile = loadProfile();
  const best = loadScores()[0];

  useEffect(() => {
    const b = setInterval(() => setIdx((i) => (i + 1) % LEVEL_IDS.length), 4500);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) onQuick();
    };
    window.addEventListener('keydown', k);
    return () => {
      clearInterval(b);
      window.removeEventListener('keydown', k);
    };
  }, [onQuick]);

  const level = getLevel(LEVEL_IDS[idx]);

  return (
    <div className="absolute inset-0 overflow-y-auto overflow-x-hidden nscroll">
      <div className="relative flex min-h-full flex-col items-center justify-center gap-8 p-5 py-10 lg:flex-row lg:items-center lg:justify-center lg:gap-14">
        <div className="flex w-full max-w-md flex-col items-center text-center lg:items-start lg:text-left">
          <div className="mb-1 inline-flex items-center gap-2 bg-neon-cyan/10 px-3 py-1 font-display text-[10px] font-bold uppercase tracking-[0.3em] text-neon-cyan shadow-[inset_0_0_0_1px_rgba(45,226,255,0.4)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-neon-green" />
            {online.toLocaleString()} pilots online
          </div>
          <Logo />
          <p className="mt-3 font-display text-[11px] uppercase tracking-[0.45em] text-neon-yellow sm:text-xs">Low-poly · High-speed · Arena FPS</p>
          <div className="mt-8 flex w-full flex-col gap-3">
            <Btn size="lg" variant="primary" onClick={onQuick} className="w-full">
              ▶ Quick play
            </Btn>
            <div className="grid grid-cols-2 gap-3">
              <Btn variant="cyan" onClick={onServers}>Server browser</Btn>
              <Btn variant="yellow" onClick={onCustom}>{hosting ? '★ Your lobby' : 'Host lobby'}</Btn>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Btn variant="ghost" size="sm" onClick={onScores}>Hall of fame</Btn>
              <Btn variant="ghost" size="sm" onClick={onSettings}>Settings</Btn>
              <Btn variant="ghost" size="sm" onClick={onHelp}>Controls</Btn>
            </div>
          </div>
          <p className="mt-5 text-xs uppercase tracking-[0.25em] text-white/40">Press <span className="text-white/80">Enter</span> to jump in</p>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-4">
          <div className="cut glass neon-border p-4">
            <div className="mb-2 font-display text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">Pilot card</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.name}
                maxLength={18}
                onChange={(e) => onName(e.target.value.replace(/[^\w\- .]/g, ''))}
                onFocus={() => sfx.hover()}
                aria-label="Player name"
                className="min-w-0 flex-1 cut-sm bg-panel2 px-3 py-2 font-display text-lg font-bold text-white outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
              />
              <button type="button" title="Generate a new name" onClick={() => { sfx.ui(); onName(randomPlayerName()); }} className="cut-sm shrink-0 bg-panel2 px-3 font-display text-lg text-neon-cyan shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] hover:text-white">⟳</button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                ['Matches', profile.matches],
                ['Wins', profile.wins],
                ['Frags', profile.kills],
                ['Best', best ? best.score.toLocaleString() : '—'],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div className="font-display text-sm font-extrabold text-neon-yellow">{v}</div>
                  <div className="text-[9px] uppercase tracking-[0.2em] text-white/45">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="cut glass neon-border overflow-hidden">
            <div className="relative">
              <MapPreview key={level.id} level={level} size={260} className="fade-in opacity-90" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent p-3 pt-10">
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-neon-pink">4 large arenas</div>
                <div className="font-display text-base font-extrabold uppercase tracking-wider text-white">{level.name}</div>
                <div className="text-xs text-white/60">{level.tagline}</div>
              </div>
            </div>
            <div className="flex">
              {LEVEL_IDS.map((id, i) => (
                <div key={id} className={'h-1 flex-1 transition-colors ' + (i === idx ? 'bg-neon-pink' : 'bg-line')} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] uppercase tracking-[0.3em] text-white/30">
        Slide · Dash · Wall-jump · Rocket-jump
      </div>
    </div>
  );
}
