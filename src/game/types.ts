export type ModeId = 'ffa' | 'tdm' | 'insta' | 'ctf' | 'koth' | 'survival' | 'bounty' | 'duel';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane' | 'auto';
export type Mutator = 'none' | 'lowgrav' | 'turbo';
export type LevelId = 'plaza' | 'yard' | 'skyline' | 'colosseum' | 'procedural';
export type MapSize = 'small' | 'medium' | 'large' | 'huge';
export type BuiltinLevelId = Exclude<LevelId, 'procedural'>;
export type WeaponId = 'rifle' | 'shotgun' | 'rail' | 'rocket';
export type AimbotTarget = 'closest' | 'health' | 'screen' | 'screen-first' | 'smart';

export interface Cheats {
  god: boolean;
  oneHp: boolean;
  aimbot: boolean;
  infiniteAmmo: boolean;
  rapidFire: boolean;
  oneShot: boolean;
  noRecoil: boolean;
  speed: boolean;
  moonJump: boolean;
  wallhack: boolean;
  explosive: boolean;
  botsPassive: boolean;
}

export const NO_CHEATS: Cheats = {
  god: false,
  oneHp: false,
  aimbot: false,
  infiniteAmmo: false,
  rapidFire: false,
  oneShot: false,
  noRecoil: false,
  speed: false,
  moonJump: false,
  wallhack: false,
  explosive: false,
  botsPassive: false,
};

export const AIMBOT_TARGETS: { v: AimbotTarget; label: string; desc: string }[] = [
  { v: 'closest', label: 'Closest (3D)', desc: 'Always lock onto the enemy closest to you in 3D space' },
  { v: 'health', label: 'Lowest HP', desc: 'Prioritizes the enemy with the lowest current health' },
  { v: 'screen', label: 'On-screen only', desc: 'Only locks onto enemies currently visible on screen' },
  { v: 'screen-first', label: 'On-screen first', desc: 'Prefers on-screen enemies, falls back to any enemy' },
  { v: 'smart', label: 'Smart', desc: 'Weighs distance, screen proximity, health and visibility together' },
];

export const CHEAT_INFO: { k: keyof Cheats; name: string; desc: string }[] = [
  { k: 'god', name: 'God mode', desc: 'You take no damage' },
  { k: 'oneHp', name: '1 HP lock', desc: 'Locks your health at 1 HP and prevents death' },
  { k: 'aimbot', name: 'Aimbot', desc: 'Snaps to a target with movement prediction when firing (target priority is set below)' },
  { k: 'infiniteAmmo', name: 'Infinite ammo', desc: 'Never reload again' },
  { k: 'rapidFire', name: 'Rapid fire', desc: '3× fire rate, every gun is automatic' },
  { k: 'oneShot', name: 'One-shot kills', desc: 'Any hit is lethal' },
  { k: 'noRecoil', name: 'No recoil / spread', desc: 'Laser-accurate weapons' },
  { k: 'speed', name: 'Super speed', desc: '+60% movement speed' },
  { k: 'moonJump', name: 'Moon jump', desc: 'Huge jumps and infinite air jumps' },
  { k: 'wallhack', name: 'Wallhack (ESP)', desc: 'See enemies through walls (green when shootable)' },
  { k: 'explosive', name: 'Explosive rounds', desc: 'Every bullet impact explodes' },
  { k: 'botsPassive', name: 'Passive bots', desc: 'Bots never shoot' },
];

export const SIZE_INFO: Record<MapSize, { name: string; dim: number }> = {
  small: { name: 'Small', dim: 84 },
  medium: { name: 'Medium', dim: 112 },
  large: { name: 'Large', dim: 144 },
  huge: { name: 'Huge', dim: 180 },
};

export interface Rules {
  mode: ModeId;
  cheats?: Cheats;
  scoreLimit: number;
  timeLimit: number; // seconds
  difficulty: Difficulty;
  mutator: Mutator;
  maxPlayers: number;
}

export interface RosterEntry {
  name: string;
  score: number;
  kills?: number;
  deaths?: number;
  ping: number;
  region: string;
  skill?: Difficulty;
  frustration?: number;
}

export interface ServerInfo {
  id: string;
  name: string;
  ip: string;
  port: number;
  region: string;
  level: LevelId;
  rules: Rules;
  players: number;
  ping: number;
  motd: string;
  roster: RosterEntry[];
  gen?: { seed: number; size: MapSize; w?: number; d?: number; theme?: string; style?: string };
  hosted?: boolean;
  password?: boolean;
  createdAt?: number;
  alwaysOnline?: boolean;
}

export interface Settings {
  name: string;
  masterVol: number;
  sfxVol: number;
  musicVol: number;
  hitSounds: boolean;
  fov: number;
  sensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  autoSprint: boolean;
  shadows: 0 | 1 | 2 | 3;
  renderScale: number;
  adaptive: boolean;
  particles: 0 | 1 | 2;
  antialias: boolean;
  viewDistance: 0 | 1 | 2;
  screenShake: number;
  headBob: boolean;
  crosshair: string;
  aimAssist: number;
  post: boolean;
  bloom: number;
  godRays: number;
  dynamicLights: boolean;
  shadowSoftness: 0 | 1 | 2;
  dynamicSun: boolean;
  vignette: boolean;
  chromatic: boolean;
  filmGrain: boolean;
  exposure: number;
  atmosphere: number;
  movement: 'classic' | 'flow';
  peek: boolean;
  showFps: boolean;
  aimbotTarget: AimbotTarget;
}

export interface ScoreEntry {
  name: string;
  score: number;
  kills: number;
  deaths: number;
  headshots: number;
  mode: ModeId;
  level: LevelId;
  server: string;
  won: boolean;
  date: number;
  cheated?: boolean;
}

export const MODES: Record<ModeId, { name: string; short: string; desc: string; limits: number[]; color: string; team?: boolean; special?: boolean; unit?: string }> = {
  ffa: { name: 'Deathmatch', short: 'DM', desc: 'Every pilot for themselves. First to the frag limit wins.', limits: [10, 20, 30], color: '#ff2d95' },
  tdm: { name: 'Team Deathmatch', short: 'TDM', desc: 'Cyan vs Magenta. Team frags decide the match.', limits: [30, 50], color: '#2de2ff', team: true },
  insta: { name: 'Instagib', short: 'INSTA', desc: 'Railguns only. One hit, one frag. Pure movement.', limits: [10, 20, 30], color: '#ffe14d' },
  duel: { name: 'Duel', short: '1V1', desc: 'One opponent, no excuses. First to the frag limit.', limits: [5, 10, 15], color: '#a26bff' },
  ctf: { name: 'Capture the Flag', short: 'CTF', desc: 'Grab the enemy flag and bring it home. Team captures win.', limits: [3, 5, 8], color: '#2de2ff', team: true, special: true, unit: 'captures' },
  koth: { name: 'King of the Hill', short: 'KOTH', desc: 'Hold the glowing hill to bank points. First to the limit wins.', limits: [60, 120, 180], color: '#ffe14d', special: true, unit: 'points' },
  survival: { name: 'Survival', short: 'SURV', desc: 'Co-op wave survival. One life for you, one life for every hostile — friendly AI redeploys, hostile waves do not. Clear waves to win.', limits: [5, 10, 15], color: '#7dff6b', special: true, unit: 'waves' },
  bounty: { name: 'Bounty', short: 'BOUNTY', desc: 'One pilot is marked. Only hunting the marked target scores points.', limits: [5, 10, 15], color: '#ff3b5c', special: true, unit: 'bounties' },
};

export const MODE_ORDER: ModeId[] = ['ffa', 'tdm', 'insta', 'duel', 'ctf', 'koth', 'bounty', 'survival'];
export const isTeamMode = (m: ModeId) => !!MODES[m].team;
export const isSpecialMode = (m: ModeId) => !!MODES[m].special;

export const MUTATORS: Record<Mutator, { name: string; desc: string }> = {
  none: { name: 'Standard', desc: 'Standard physics' },
  lowgrav: { name: 'Low Gravity', desc: 'Float like a feather, die like a brick' },
  turbo: { name: 'Turbo', desc: '+25% speed, faster weapons' },
};

export const DIFFS: Record<Difficulty, { name: string; color: string }> = {
  auto: { name: 'Auto', color: '#a26bff' },
  easy: { name: 'Rookie', color: '#7dff6b' },
  normal: { name: 'Veteran', color: '#2de2ff' },
  hard: { name: 'Elite', color: '#ffe14d' },
  insane: { name: 'Nightmare', color: '#ff3b5c' },
};

export const DIFF_PARAMS: Record<Difficulty, { react: number; aimErr: number; fireMul: number; dmgMul: number; speedMul: number; turn: number; hear: number }> = {
  auto: { react: 0.38, aimErr: 0.06, fireMul: 1.3, dmgMul: 0.75, speedMul: 0.92, turn: 5.5, hear: 0.45 },
  easy: { react: 0.6, aimErr: 0.1, fireMul: 1.7, dmgMul: 0.55, speedMul: 0.8, turn: 3.5, hear: 0.25 },
  normal: { react: 0.38, aimErr: 0.06, fireMul: 1.3, dmgMul: 0.75, speedMul: 0.92, turn: 5.5, hear: 0.45 },
  hard: { react: 0.24, aimErr: 0.036, fireMul: 1.0, dmgMul: 0.95, speedMul: 1.0, turn: 8, hear: 0.65 },
  insane: { react: 0.13, aimErr: 0.019, fireMul: 0.85, dmgMul: 1.1, speedMul: 1.08, turn: 12, hear: 0.85 },
};

export const REGIONS = ['EU', 'NA', 'AS', 'SA', 'OC'];

export const LEVEL_IDS: BuiltinLevelId[] = ['plaza', 'yard', 'skyline', 'colosseum'];

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
