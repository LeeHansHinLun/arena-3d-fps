import { useState } from 'react';
import { COLORED_LIGHT_PRESET_VALUES, COLORED_LIGHT_UNLIMITED, aaModeOf, coloredLightDistanceOf, coloredLightLimitOf, coloredLightPresetSettings, type AaMode, type Settings } from '@/game/types';
import { defaultSettings } from '@/game/storage';
import { audio } from '@/game/audio';
import { Btn, Modal, Panel, Segmented, Slider, Toggle, sfx } from './kit';
import { cn } from '@/utils/cn';

const TABS = ['Audio', 'Graphics', 'Controls', 'Gameplay'] as const;
/** Stepped visible-light counts: fine control at the low end, broad steps at the high end, then Unlimited. */
const COLORED_LIGHT_LIMIT_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 320, 384, 512] as const;
function nearestColoredLimitStep(limit: number): number {
  if (limit < 0) return COLORED_LIGHT_LIMIT_STEPS.length;
  let best = 0;
  for (let i = 1; i < COLORED_LIGHT_LIMIT_STEPS.length; i++) {
    if (Math.abs(COLORED_LIGHT_LIMIT_STEPS[i] - limit) < Math.abs(COLORED_LIGHT_LIMIT_STEPS[best] - limit)) best = i;
  }
  return best;
}
const CROSS = ['#2de2ff', '#ff2d95', '#ffe14d', '#7dff6b', '#ffffff', '#ff3b5c'];

export const PRESETS: Record<string, Partial<Settings>> = {
  Low: { shadows: 0, renderScale: 0.6, particles: 0, viewDistance: 0, antialias: false, post: false, dynamicLights: false, godRays: 0, shadowSoftness: 0, ...coloredLightPresetSettings(0), volumetric: 0 },
  Medium: { shadows: 1, renderScale: 0.8, particles: 1, viewDistance: 1, antialias: false, post: true, bloom: 0.55, godRays: 0.3, flare: 0.12, dynamicLights: true, shadowSoftness: 1, ...coloredLightPresetSettings(1), volumetric: 1 },
  High: { shadows: 2, renderScale: 1, particles: 2, viewDistance: 2, antialias: true, post: true, bloom: 0.62, godRays: 0.55, flare: 0.18, dynamicLights: true, shadowSoftness: 1, ...coloredLightPresetSettings(2), volumetric: 1 },
  Ultra: { shadows: 3, renderScale: 1, particles: 2, viewDistance: 2, antialias: true, post: true, bloom: 0.68, godRays: 0.65, flare: 0.22, dynamicLights: true, shadowSoftness: 2, dynamicSun: true, ...coloredLightPresetSettings(3), volumetric: 2 },
  // Reference: everything the engine can do, all at once. Deliberately heavy — this is the
  // ground-truth look (and the preset the benchmark is most interesting with), not a
  // recommendation for everyday matches. Its effect amounts are still kept below the
  // old full-screen-fog values; sliders remain available for a more extreme look.
  Reference: {
    shadows: 4, renderScale: 1.25, particles: 2, viewDistance: 2, antialias: false, aaMode: 'taa', ssaaScale: 1.75, aniso: 3,
    post: true, bloom: 0.72, bloomQuality: 2, godRays: 0.85, raysQuality: 2, dynamicLights: true, shadowSoftness: 2, dynamicSun: true,
    ...coloredLightPresetSettings(3), volumetric: 2, envReflections: true, ao: 2, ssr: 2, dof: 0.45, dofAutoFocus: true,
    flare: 0.3, sharpen: 0.28, colorGrade: 0.28, adaptive: false, vignette: true, chromatic: true, showFps: true,
  },
};

/**
 * Applies a quality preset. Optional screen-space features are first reset off so
 * switching e.g. Reference → Low cannot leave heavy effects behind. Individual
 * presets may then opt back into map lights/volumetric cones at their own budget.
 */
export function applyPreset(settings: Settings, name: string): Settings {
  const preset = PRESETS[name];
  if (!preset) return settings;
  const d = defaultSettings();
  const reset: Partial<Settings> = {
    // Do not inherit optional feature toggles from the previous preset/manual
    // configuration. Medium and above explicitly opt into coloured fixtures,
    // cones and modest flare; AO/SSR/DoF remain Reference-or-manual features.
    ao: 0, ssr: 0, dof: 0, dofAutoFocus: d.dofAutoFocus, ...coloredLightPresetSettings(0),
    volumetric: 0, envReflections: false, bloomQuality: d.bloomQuality,
    raysQuality: d.raysQuality, flare: 0, sharpen: 0, colorGrade: 0, aniso: d.aniso, ssaaScale: d.ssaaScale,
  };
  const merged: Settings = { ...settings, ...reset, ...preset };
  // keep the AA mode and the legacy boolean in agreement
  if (!('aaMode' in preset) && 'antialias' in preset) merged.aaMode = preset.antialias ? 'native' : 'off';
  merged.antialias = merged.aaMode === 'native';
  return merged;
}

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
  ['T / Enter', 'Chat'],
  ['V', 'Ready up (warmup)'],
  ['Arrow keys', 'Look (alternative)'],
  ['P / Esc', 'Pause'],
  ['R / Enter', 'Instant restart on game over'],
];

export function SettingsPanel({ settings, onChange, onClose, initialTab, onShowcase }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; initialTab?: (typeof TABS)[number]; onShowcase?: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(initialTab ?? 'Audio');
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const pct = (v: number) => Math.round(v * 100) + '%';
  // The coloured-light sliders use one extra detent past their finite end for
  // Unlimited, stored as COLORED_LIGHT_UNLIMITED (-1) so it survives JSON.
  const presetForColored = (limit: number, distance: number): Settings['coloredLights'] => {
    if (limit === 0) return 0; // distance is inert while the lights are off
    const i = COLORED_LIGHT_PRESET_VALUES.findIndex((p) => p.limit === limit && p.distance === distance);
    return (i >= 0 ? i : 4) as Settings['coloredLights'];
  };
  const setColoredPreset = (v: Settings['coloredLights']) => {
    if (v === 4) set('coloredLights', 4);
    else onChange({ ...settings, ...coloredLightPresetSettings(v) });
  };
  const setColoredSliders = (limit: number, distance: number) => onChange({ ...settings, coloredLightLimit: limit, coloredLightDistance: distance, coloredLights: presetForColored(limit, distance) });
  const coloredLimit = coloredLightLimitOf(settings);
  const coloredDistance = coloredLightDistanceOf(settings);
  const lightLimitStep = nearestColoredLimitStep(coloredLimit);
  const lightDistanceSlider = coloredDistance < 0 ? 305 : Math.min(300, Math.max(10, coloredDistance));
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
              <div className="flex flex-wrap gap-1.5 pb-1">
                {Object.keys(PRESETS).map((p) => (
                  <Btn key={p} size="sm" variant={p === 'Reference' ? 'yellow' : 'ghost'} onClick={() => onChange(applyPreset(settings, p))}>
                    {p}
                  </Btn>
                ))}
              </div>
              <div className="pb-2 text-xs text-white/40">Reference turns every engine feature on — beautiful and very heavy. Medium and above include the maps’ coloured light fixtures.</div>
              {onShowcase && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 cut-sm bg-panel2/70 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,225,77,0.45)]">
                  <div>
                    <div className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-neon-yellow">Graphics showcase &amp; benchmark</div>
                    <div className="text-xs text-white/50">PRISM test range — every district shows off different engine features, with a 30s benchmark loop.</div>
                  </div>
                  <Btn size="sm" variant="yellow" onClick={onShowcase}>Open test level</Btn>
                </div>
              )}
              <Segmented label="Shadows" value={settings.shadows} onChange={(v) => set('shadows', v)} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }, { v: 4, label: '4K' }]} />
              <Slider label="Render scale" value={settings.renderScale} min={0.5} max={2} step={0.05} onChange={(v) => set('renderScale', v)} format={pct} color="#2de2ff" />
              <div className="-mt-1 mb-1 text-xs text-white/40">Above 100% supersamples the whole frame (expensive, very clean).</div>
              <Toggle label="Adaptive resolution" value={settings.adaptive} onChange={(v) => set('adaptive', v)} hint="Automatically lowers resolution if FPS drops below 50" />
              <Segmented label="Particles" value={settings.particles} onChange={(v) => set('particles', v)} options={[{ v: 0, label: 'Low' }, { v: 1, label: 'Medium' }, { v: 2, label: 'High' }]} />
              <Segmented label="View distance" value={settings.viewDistance} onChange={(v) => set('viewDistance', v)} options={[{ v: 0, label: 'Near' }, { v: 1, label: 'Medium' }, { v: 2, label: 'Far' }]} />
              <Segmented
                label="Anti-aliasing"
                value={aaModeOf(settings)}
                onChange={(v: AaMode) => onChange({ ...settings, aaMode: v, antialias: v === 'native' })}
                options={[
                  { v: 'off' as AaMode, label: 'Off' },
                  { v: 'native' as AaMode, label: 'Native (MSAA)' },
                  { v: 'fxaa' as AaMode, label: 'FXAA' },
                  { v: 'smaa' as AaMode, label: 'SMAA' },
                  { v: 'taa' as AaMode, label: 'TAA' },
                  { v: 'ssaa' as AaMode, label: 'SSAA' },
                ]}
              />
              <div className="-mt-1 mb-1 text-xs text-white/40">
                {aaModeOf(settings) === 'native' && 'Hardware multisampling. Without post-processing it applies next time you join a server.'}
                {aaModeOf(settings) === 'fxaa' && 'Fast shader AA. Cheapest option, slightly soft.'}
                {aaModeOf(settings) === 'smaa' && 'High-quality shader AA with sharper edges than FXAA.'}
                {aaModeOf(settings) === 'taa' && 'Temporal AA: jittered accumulation across frames. Cleanest in motion, tiny ghosting on fast objects.'}
                {aaModeOf(settings) === 'ssaa' && 'Super-sampling: renders the scene above display resolution. Brute-force quality, brute-force cost.'}
                {aaModeOf(settings) === 'off' && 'No anti-aliasing — fastest, jagged edges.'}
              </div>
              {aaModeOf(settings) === 'ssaa' && <Slider label="SSAA scale" value={settings.ssaaScale} min={1.25} max={2} step={0.25} onChange={(v) => set('ssaaScale', v)} format={(v) => v.toFixed(2) + '×'} color="#ffe14d" />}
              <Segmented label="Texture filtering" value={settings.aniso} onChange={(v) => set('aniso', v)} options={[{ v: 0, label: '1×' }, { v: 1, label: '4×' }, { v: 2, label: '8×' }, { v: 3, label: '16×' }]} />
              <Toggle label="Show FPS counter" value={settings.showFps} onChange={(v) => set('showFps', v)} />

              <div className="mt-2 border-t border-line/60 pt-2 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-neon-yellow">Lighting</div>
              <Segmented label="Shadow softness" value={settings.shadowSoftness} onChange={(v) => set('shadowSoftness', v)} options={[{ v: 0, label: 'Hard' }, { v: 1, label: 'Soft (PCF)' }, { v: 2, label: 'Very soft (VSM)' }]} />
              <Toggle label="Dynamic sun" value={settings.dynamicSun} onChange={(v) => set('dynamicSun', v)} hint="The sun slowly travels across the sky, so shadows move during the match" />
              <Toggle label="Dynamic lights" value={settings.dynamicLights} onChange={(v) => set('dynamicLights', v)} hint="Muzzle flashes, explosions, kills and jump pads light up the world" />
              <Segmented label="Coloured lights preset" value={settings.coloredLights} onChange={setColoredPreset} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }, { v: 4, label: 'Custom' }]} />
              <Slider label="Visible coloured lights" value={lightLimitStep} min={0} max={COLORED_LIGHT_LIMIT_STEPS.length} step={1} onChange={(v) => setColoredSliders(v >= COLORED_LIGHT_LIMIT_STEPS.length ? COLORED_LIGHT_UNLIMITED : COLORED_LIGHT_LIMIT_STEPS[Math.round(v)], coloredDistance)} format={(v) => (v >= COLORED_LIGHT_LIMIT_STEPS.length ? 'Unlimited' : COLORED_LIGHT_LIMIT_STEPS[Math.round(v)] === 0 ? 'Off' : `${COLORED_LIGHT_LIMIT_STEPS[Math.round(v)]} lights`)} color="#ff2d95" />
              <Slider label="Coloured light distance" value={lightDistanceSlider} min={10} max={305} step={5} onChange={(v) => setColoredSliders(coloredLimit, v >= 305 ? COLORED_LIGHT_UNLIMITED : Math.round(v))} format={(v) => (v >= 305 ? 'Unlimited' : `${Math.round(v)} m`)} color="#2de2ff" />
              <div className="-mt-1 mb-1 text-xs text-white/40">Off–High are presets for both sliders; moving either slider switches to Custom. Distance is how far from the camera a lamp, pad or merged neon segment can be and still activate. The nearest raycast-visible sources win; above 14 simultaneous lights requires WebGPU batching (the WebGL fallback stays capped at 14; nearest keep shadows). Unlimited count also uncaps local lens flare.</div>
              <Segmented label="Volumetric cones" value={settings.volumetric} onChange={(v) => set('volumetric', v)} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'On' }, { v: 2, label: 'High' }]} />
              <div className="-mt-1 mb-1 text-xs text-white/40">Visible light shafts under lamps, floodlights and streetlights.</div>
              <Toggle label="Environment reflections (IBL)" value={settings.envReflections} onChange={(v) => set('envReflections', v)} hint="Image-based lighting generated from the map's sky and sun" />
              <Slider label="Exposure" value={settings.exposure} min={0.6} max={1.8} onChange={(v) => set('exposure', v)} format={(v) => v.toFixed(2)} color="#ffe14d" />
              <Slider label="Atmospheric haze" value={settings.atmosphere} min={0} max={1} onChange={(v) => set('atmosphere', v)} format={pct} color="#a26bff" />
              <div className="mt-2 border-t border-line/60 pt-2">
                <Toggle label="Post-processing" value={settings.post} onChange={(v) => set('post', v)} hint="HDR pipeline required for bloom, volumetric light and screen effects (FXAA/SMAA/TAA enable it automatically)" />
                <div className={settings.post ? '' : 'pointer-events-none opacity-40'}>
                  <Slider label="Volumetric light (god rays)" value={settings.godRays} min={0} max={1.5} onChange={(v) => set('godRays', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} color="#ffe14d" />
                  <Segmented label="God-ray quality" value={settings.raysQuality} onChange={(v) => set('raysQuality', v)} options={[{ v: 0, label: 'Fast' }, { v: 1, label: 'Balanced' }, { v: 2, label: 'Quality' }]} />
                  <Slider label="Bloom" value={settings.bloom} min={0} max={1.5} onChange={(v) => set('bloom', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} />
                  <Segmented label="Bloom quality" value={settings.bloomQuality} onChange={(v) => set('bloomQuality', v)} options={[{ v: 0, label: 'Fast' }, { v: 1, label: 'Balanced' }, { v: 2, label: 'Quality' }]} />
                  <Segmented label="Ambient occlusion (GTAO)" value={settings.ao} onChange={(v) => set('ao', v)} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Balanced' }, { v: 2, label: 'Quality' }]} />
                  <Segmented label="Reflections (SSR)" value={settings.ssr} onChange={(v) => set('ssr', v)} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Balanced' }, { v: 2, label: 'Quality' }]} />
                  <div className="-mt-1 mb-1 text-xs text-white/40">Both modes use coherent mirror reflections with roughness blur; Quality raises resolution, ray quality and range instead of switching to a noisy stochastic ray per pixel.</div>
                  <Slider label="Depth of field" value={settings.dof} min={0} max={1} onChange={(v) => set('dof', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} color="#a26bff" />
                  <Toggle label="DoF autofocus" value={settings.dofAutoFocus} onChange={(v) => set('dofAutoFocus', v)} hint="Focus follows whatever your crosshair is looking at" />
                  <Slider label="Lens flare" value={settings.flare} min={0} max={1} onChange={(v) => set('flare', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} color="#ffe14d" />
                  <div className="-mt-1 mb-1 text-xs text-white/40">Applies to the sun, lamps, tower lights and pads, with one ordinary point flare per merged neon segment—not a line-shaped flare. With Visible coloured lights set to Unlimited—or flare at 100%—every unoccluded in-view emitter is included; finite light limits scale the ranked flare cap with them. The sun is kept extra subtle.</div>
                  <Slider label="Sharpening" value={settings.sharpen} min={0} max={1} onChange={(v) => set('sharpen', v)} format={(v) => (v < 0.01 ? 'Off' : pct(v))} color="#2de2ff" />
                  <Slider label="Colour grade" value={settings.colorGrade} min={0} max={1} onChange={(v) => set('colorGrade', v)} format={(v) => (v < 0.01 ? 'Classic' : pct(v))} color="#ff2d95" />
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
