import type { ScoreEntry, Settings } from './types';

const SKEY = 'neonriot.settings.v1';
const HKEY = 'neonriot.scores.v1';
const PKEY = 'neonriot.profile.v1';

export function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia('(hover: none)').matches;
    return (coarse || noHover) && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  } catch {
    return false;
  }
}

export function defaultSettings(touch = detectTouch()): Settings {
  return {
    name: 'Rookie' + Math.floor(100 + Math.random() * 900),
    masterVol: 0.8,
    sfxVol: 0.9,
    musicVol: 0.35,
    hitSounds: true,
    fov: touch ? 90 : 95,
    sensitivity: 1,
    touchSensitivity: 1,
    invertY: false,
    toggleCrouch: false,
    autoSprint: touch,
    shadows: touch ? 1 : 2,
    renderScale: touch ? 0.75 : 1,
    adaptive: true,
    particles: touch ? 0 : 2,
    antialias: !touch,
    viewDistance: touch ? 1 : 2,
    screenShake: 0.8,
    headBob: true,
    showFps: false,
    crosshair: '#2de2ff',
    aimAssist: touch ? 0.6 : 0,
    post: !touch,
    bloom: 0.7,
    godRays: touch ? 0 : 0.8,
    dynamicLights: true,
    shadowSoftness: 1,
    dynamicSun: false,
    vignette: true,
    chromatic: true,
    filmGrain: false,
    exposure: 1.15,
    atmosphere: 0.5,
    movement: 'classic',
    peek: true,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(SKEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return d;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SKEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(HKEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** Adds a score, returns the 1-based rank in the table (or 0 if it did not place). */
export function addScore(e: ScoreEntry): number {
  const all = loadScores();
  all.push(e);
  all.sort((a, b) => b.score - a.score || a.date - b.date);
  const top = all.slice(0, 25);
  try {
    localStorage.setItem(HKEY, JSON.stringify(top));
  } catch {
    /* ignore */
  }
  const idx = top.findIndex((x) => x === e || (x.date === e.date && x.score === e.score && x.name === e.name));
  return idx >= 0 ? idx + 1 : 0;
}

export function clearScores() {
  try {
    localStorage.removeItem(HKEY);
  } catch {
    /* ignore */
  }
}

export interface Profile {
  matches: number;
  kills: number;
  deaths: number;
  wins: number;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PKEY);
    if (raw) return { matches: 0, kills: 0, deaths: 0, wins: 0, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { matches: 0, kills: 0, deaths: 0, wins: 0 };
}

export function bumpProfile(kills: number, deaths: number, won: boolean) {
  const p = loadProfile();
  p.matches++;
  p.kills += kills;
  p.deaths += deaths;
  if (won) p.wins++;
  try {
    localStorage.setItem(PKEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
