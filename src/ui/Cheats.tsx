import { CHEAT_INFO, NO_CHEATS, type Cheats } from '@/game/types';
import { Toggle, sfx } from './kit';
import { cn } from '@/utils/cn';

export function CheatsEditor({ value, onChange, compact }: { value: Cheats; onChange: (c: Cheats) => void; compact?: boolean }) {
  const any = Object.values(value).some(Boolean);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-white/50">Cheats only affect the host. Matches with cheats are recorded on a separate Cheats leaderboard.</span>
        {any && (
          <button
            type="button"
            onClick={() => {
              sfx.back();
              onChange({ ...NO_CHEATS });
            }}
            className="shrink-0 px-2 font-display text-[10px] font-bold uppercase tracking-widest text-neon-red hover:text-white"
          >
            Clear all
          </button>
        )}
      </div>
      <div className={cn('grid gap-x-4', compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')}>
        {CHEAT_INFO.map((c) => (
          <Toggle key={c.k} label={c.name} hint={c.desc} value={value[c.k]} onChange={(v) => onChange({ ...value, [c.k]: v })} />
        ))}
      </div>
    </div>
  );
}
