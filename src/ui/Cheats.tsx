import { AIMBOT_TARGETS, CHEAT_INFO, NO_CHEATS, type Cheats, type Settings } from '@/game/types';
import { Toggle, sfx } from './kit';
import { cn } from '@/utils/cn';

/** Target priority for the aimbot cheat. Lives with the cheat it configures, not in Settings. */
export function AimbotTargetPicker({ settings, onSettings }: { settings: Settings; onSettings: (s: Settings) => void }) {
  const cur = AIMBOT_TARGETS.find((t) => t.v === settings.aimbotTarget) ?? AIMBOT_TARGETS[0];
  return (
    <div className="mt-1 border-t border-line/50 pt-2">
      <div className="mb-1 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-neon-red">Aimbot target priority</div>
      <div className="flex flex-wrap gap-1.5">
        {AIMBOT_TARGETS.map((t) => (
          <button
            key={t.v}
            type="button"
            title={t.desc}
            onClick={() => {
              sfx.ui();
              onSettings({ ...settings, aimbotTarget: t.v });
            }}
            className={cn(
              'cut-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-widest transition',
              settings.aimbotTarget === t.v ? 'bg-neon-red text-white shadow-[0_0_14px_rgba(255,59,92,0.5)]' : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-1 text-xs text-white/40">{cur.desc}</div>
    </div>
  );
}

export function CheatsEditor({
  value, onChange, compact, settings, onSettings,
}: {
  value: Cheats;
  onChange: (c: Cheats) => void;
  compact?: boolean;
  /** when provided, the aimbot target priority picker is shown under the aimbot toggle */
  settings?: Settings;
  onSettings?: (s: Settings) => void;
}) {
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
      {value.aimbot && settings && onSettings && <AimbotTargetPicker settings={settings} onSettings={onSettings} />}
    </div>
  );
}
