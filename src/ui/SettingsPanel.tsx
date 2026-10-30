import { useState } from 'react';
import { AIMBOT_TARGETS, type Settings } from '@/game/types';
import { defaultSettings } from '@/game/storage';
import { audio } from '@/game/audio';
import { Btn, Modal, Panel, Segmented, Slider, Toggle, sfx } from './kit';
import { cn } from '@/utils/cn';

const TABS = ['Audio', 'Graphics', 'Controls', 'Gameplay'] as const;
const CROSS = ['#2de2ff', '#ff2d95', '#ffe14d', '#7dff6b', '#ffffff', '#ff3b5c'];

const PRESETS: Record<string, Partial<Settings>> = {
  Low: { shadows: 0, renderScale: 0.6, particles: 0, viewDistance: 0, antialias: false, post: false, dynamicLights: false, godRays: 0, shadowSoftness: 0 },
  Medium: { shadows: 1, renderScale: 0.8, particles: 1, viewDistance: 1, antialias: false, post: true, bloom: 0.6, godRays: 0, dynamicLights: true, shadowSoftness: 1 },
  High: { shadows: 2, renderScale: 1, particles: 2, viewDistance: 2, antialias: true, post: true, bloom: 0.7, godRays: 0.8, dynamicLights: true, shadowSoftness: 1 },
  Ultra: { shadows: 3, renderScale: 1, particles: 2, viewDistance: 2, antialias: true, post: true, bloom: 0.85, godRays: 1, dynamicLights: true, shadowSoftness: 2, dynamicSun: true },
};

const KEYS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Left Click', 'Fire'],
  ['Right Click / Z', 'Aim (zoom)'],
  ['Space', 'Jump · hold to bunny-hop · tap in air for double jump'],
  ['Space near wall', 'Wall jump (x2)'],
  ['Shift', 'Sprint'],
  ['C / Ctrl', 'Crouch · press while sprinting to SLIDE'],
  ['F', 'Dash (cooldown)'],
  ['Q / E', 'Peek left / right'],
  ['R', 'Reload'],
  ['1-4 / Wheel / X', 'Switch weapon'],
  ['Tab', 'Scoreboard'],
  ['Arrow keys', 'Look (alternative)'],
  ['P / Esc', 'Pause'],
  ['R / Enter', 'Instant restart on game over'],
];

export function SettingsPanel({ settings, onChange, onClose, initialTab }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; initialTab?: (typeof TABS)[number] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(initialTab ?? 'Audio');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const pct = (v: number) => Math.round(v * 100) + '%';
  return (
    <Modal onClose={onClose}>
      <Panel title="Settings" onClose={onClose} className="max-h-[92vh] w-full max-w-2xl">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/60 px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                sfx.ui();
                setTab(t);
              }}
              className={cn(
                'px-4 py-2 font-display text-[11px] font-bold uppercase tracking-[0.2em] transition',
                tab === t ? 'border-b-2 border-neon-pink text-white' : 'text-white/50 hover:text-white',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="nscroll min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {tab === 'Audio' && (
            <div>
              <Slider label="Master volume" value={settings.masterVol} min={0} max={1} onChange={(v) => set('masterVol', v)} format={pct} />
              <Slider label="Effects" value={settings.sfxVol} min={0} max={1} onChange={(v) => set('sfxVol', v)} format={pct} color="#2de2ff" />
              <Slider label="Music" value={settings.musicVol} min={0} max={1} onChange={(v) => set('musicVol', v)} format={pct} color="#ffe14d" />
              <Toggle label="Hit & kill sounds" value={settings.hitSounds} onChange={(v) => set('hitSounds', v)} hint="Feedback ticks when you damage enemies" />
              <div className="pt-2">
                <Btn size="sm" variant="ghost" onClick={() => { audio.init(); audio.play('rifle'); setTimeout(() => audio.play('hitHead'), 160); setTimeout(() => audio.play('explosion'), 380); }}>
                  Test sounds
                </Btn>
              </div>
            </div>
          )}
          {tab === 'Graphics' && (
            <div>
              <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">Quality preset</div>
              <div className="flex flex-wrap gap-1.5 pb-2">
                {Object.keys(PRESETS).map((p) => (
                  <Btn key={p} size="sm" variant="ghost" onClick={() => onChange({ ...settings, ...PRESETS[p] })}>
                    {p}
                  </Btn>
                ))}
              </div>
              <Segmented label="Shadows" value={settings.shadows} onChange={(v) => set('shadows', v)} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }]} />
              <Slider label="Render scale" value={settings.renderScale} min={0.5} max={1} step={0.05} onChange={(v) => set('renderScale', v)} format={pct} color="#2de2ff" />
              <Toggle label="Adaptive resolution" value={settings.adaptive} onChange={(v) => set('adaptive', v)} hint="Automatically lowers resolution if FPS drops below 50" />
              <Segmented label="Particles" value={settings.particles} onChange={(v) => set('particles', v)} options={[{ v: 0, label: 'Low' }, { v: 1, label: 'Medium' }, { v: 2, label: 'High' }]} />
              <Segmented label="View distance" value={settings.viewDistance} onChange={(v) => set('viewDistance', v)} options={[{ v: 0, label: 'Near' }, { v: 1, label: 'Medium' }, { v: 2, label: 'Far' }]} />
              <Toggle label="Anti-aliasing" value={settings.antialias} onChange={(v) => set('antialias', v)} hint="Takes effect next time you join a server" />
              <Toggle label="Show FPS counter" value={settings.showFps} onChange={(v) => set('showFps', v)} />

              <div className="mt-2 border-t border-line/60 pt-2 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-neon-yellow">Lighting</div>
              <Segmented label="Shadow softness" value={settings.shadowSoftness} onChange={(v) => set('shadowSoftness', v)} options={[{ v: 0, label: 'Hard' }, { v: 1, label: 'Soft (PCF)' }, { v: 2, label: 'Very soft (VSM)' }]} />
              <Toggle label="Dynamic sun" value={settings.dynamicSun} onChange={(v) => set('dynamicSun', v)} hint="The sun slowly travels across the sky, so shadows move during the match" />
              <Toggle label="Dynamic lights" value={settings.dynamicLights} onChange={(v) => set('dynamicLights', v)} hint="Muzzle flashes, explosions, kills and jump pads light up the world" />
              <Slider label="Exposure" value={settings.exposure} min={0.6} max={1.8} onChange={(v) => set('exposure', v)} format={(v) => v.toFixed(2)} color="#ffe14d" />
              <Slider label="Atmospheric haze" value={settings.atmosphere} min={0} max={1} onChange={(v) => set('atmosphere', v)} format={pct} color="#a26bff" />
              <div className="mt-2 border-t border-line/60 pt-2">
                <Toggle label="Post-processing" value={settings.post} onChange={(v) => set('post', v)} hint="HDR pipeline required for bloom, volumetric light and screen effects" />
                <div className={settings.post ? '' : 'pointer-events-none opacity-40'}>
                  <Slider label="Volumetric light (god rays)" value={settings.godRays} min={0} max={1.5} onChange={(v) => set('godRays', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} color="#ffe14d" />
                  <Slider label="Bloom" value={settings.bloom} min={0} max={1.5} onChange={(v) => set('bloom', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} />
                  <Toggle label="Vignette" value={settings.vignette} onChange={(v) => set('vignette', v)} />
                  <Toggle label="Chromatic aberration" value={settings.chromatic} onChange={(v) => set('chromatic', v)} hint="Colour fringing when hit or moving fast" />
                  <Toggle label="Film grain" value={settings.filmGrain} onChange={(v) => set('filmGrain', v)} />
                </div>
              </div>
            </div>
          )}
          {tab === 'Controls' && (
            <div>
              <Slider label="Aim assist" value={settings.aimAssist} min={0} max={1} onChange={(v) => set('aimAssist', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} color="#7dff6b" />
              <div className="-mt-1 mb-1 text-xs text-white/40">Slows your aim over enemies and gently pulls toward them while you move, look or fire. Works in every mode.</div>
              <div className="py-1.5">
                <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">Aimbot target priority</div>
                <div className="flex flex-wrap gap-1.5">
                  {AIMBOT_TARGETS.map((t) => (
                    <button
                      key={t.v}
                      type="button"
                      title={t.desc}
                      onClick={() => { sfx.ui(); set('aimbotTarget', t.v); }}
                      className={cn(
                        'cut-sm px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-widest transition',
                        settings.aimbotTarget === t.v ? 'bg-neon-red text-white shadow-[0_0_14px_rgba(255,59,92,0.5)]' : 'bg-panel2 text-white/70 hover:text-white shadow-[inset_0_0_0_1px_rgba(120,100,220,0.45)]',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-xs text-white/40">{AIMBOT_TARGETS.find((t) => t.v === settings.aimbotTarget)?.desc}</div>
              </div>
              <Slider label="Field of view" value={settings.fov} min={65} max={115} step={1} onChange={(v) => set('fov', v)} format={(v) => Math.round(v) + '°'} color="#ffe14d" />
              <Slider label="Mouse sensitivity" value={settings.sensitivity} min={0.2} max={3} onChange={(v) => set('sensitivity', v)} format={(v) => v.toFixed(2) + '×'} />
              <Slider label="Touch look sensitivity" value={settings.touchSensitivity} min={0.3} max={3} onChange={(v) => set('touchSensitivity', v)} format={(v) => v.toFixed(2) + '×'} color="#2de2ff" />
              <Toggle label="Invert Y axis" value={settings.invertY} onChange={(v) => set('invertY', v)} />
              <Toggle label="Toggle crouch" value={settings.toggleCrouch} onChange={(v) => set('toggleCrouch', v)} hint="Press once to crouch instead of holding" />
              <Toggle label="Auto sprint" value={settings.autoSprint} onChange={(v) => set('autoSprint', v)} hint="Sprint whenever you move forward" />
              <Segmented label="Movement system" value={settings.movement} onChange={(v) => set('movement', v)} options={[{ v: 'classic', label: 'Classic' }, { v: 'flow', label: 'Flow (experimental)' }]} />
              <div className="-mt-1 mb-1 text-xs text-white/40">{settings.movement === 'flow' ? 'Flow: higher acceleration, lower friction, stronger air control and a small boost when jumping. Feels smoother and more reactive.' : 'Classic: the original tuned movement. Slide, dash, double jump and wall jump.'}</div>
              <Toggle label="Q / E peeking" value={settings.peek} onChange={(v) => set('peek', v)} hint="Lean around corners without exposing your whole body" />
              <div className="mt-3 border-t border-line/60 pt-3">
                <div className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Key bindings</div>
                <div className="grid gap-1 text-sm">
                  {KEYS.map(([k, d]) => (
                    <div key={k + d} className="flex gap-3">
                      <span className="w-36 shrink-0 font-display text-[11px] font-bold uppercase tracking-wider text-neon-yellow">{k}</span>
                      <span className="text-white/70">{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {tab === 'Gameplay' && (
            <div>
              <label className="block py-1.5">
                <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">Player name</div>
                <input
                  type="text"
                  maxLength={18}
                  value={settings.name}
                  onChange={(e) => set('name', e.target.value.replace(/[^\w\- .]/g, ''))}
                  className="w-full cut-sm bg-panel2 px-3 py-2 font-display text-sm text-white outline-none shadow-[inset_0_0_0_1px_rgba(120,100,220,0.6)] focus:shadow-[inset_0_0_0_1px_#2de2ff]"
                />
              </label>
              <Slider label="Screen shake" value={settings.screenShake} min={0} max={1.5} onChange={(v) => set('screenShake', v)} format={(v) => (v === 0 ? 'Off' : pct(v))} color="#ffe14d" />
              <Toggle label="Head bob" value={settings.headBob} onChange={(v) => set('headBob', v)} />
              <div className="py-2">
                <div className="mb-1 text-sm font-semibold uppercase tracking-wider text-white/80">Crosshair colour</div>
                <div className="flex gap-2">
                  {CROSS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={'Crosshair ' + c}
                      onClick={() => {
                        sfx.ui();
                        set('crosshair', c);
                      }}
                      className={cn('h-8 w-8 cut-sm transition', settings.crosshair === c ? 'scale-110 ring-2 ring-white' : 'opacity-70 hover:opacity-100')}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-line/60 px-5 py-3">
          <Btn variant="ghost" size="sm" onClick={() => onChange({ ...defaultSettings(), name: settings.name })}>Reset defaults</Btn>
          <Btn variant="cyan" onClick={onClose}>
            Done
          </Btn>
        </div>
      </Panel>
    </Modal>
  );
}
