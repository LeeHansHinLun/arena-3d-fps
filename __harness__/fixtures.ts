/**
 * Shared fixture data for the visual-regression harness.
 *
 * The harness mounts every UI surface with fixed props so that the markup rendered by the
 * React implementation (before) and the vanilla implementation (after) can be compared
 * pixel-for-pixel and style-for-style with Playwright.
 */
import { getLevel } from '@/game/levels';
import { defaultSettings } from '@/game/storage';
import type { HudState, MatchResult, ScoreRow } from '@/game/engine';
import { LEVEL_IDS, NO_CHEATS, type ScoreEntry, type ServerInfo, type Settings } from '@/game/types';
import type { LobbyConfig } from '@/ui/CustomGame';
import type { HostedLobby } from '@/ui/LobbyRoom';

export const settings: Settings = { ...defaultSettings(false), name: 'NEON_PILOT' };

const mode = 'ffa' as const;

export const scores: ScoreEntry[] = [
  { name: 'VOIDRUNNER', score: 18420, kills: 27, deaths: 9, headshots: 11, mode: 'ffa', level: 'plaza', server: 'Neon Plaza · EU #1', won: true, date: 1735689600000 },
  { name: 'NEON_PILOT', score: 15310, kills: 22, deaths: 12, headshots: 8, mode: 'tdm', level: 'yard', server: 'Container Yard · EU #2', won: false, date: 1735776000000 },
  { name: 'KILO_9', score: 12980, kills: 19, deaths: 14, headshots: 6, mode: 'koth', level: 'skyline', server: 'Skyline District · NA #1', won: true, date: 1735862400000 },
  { name: 'PIXELWRAITH', score: 11240, kills: 17, deaths: 15, headshots: 9, mode: 'ctf', level: 'colosseum', server: 'The Colosseum · AS #1', won: false, date: 1735948800000 },
  { name: 'SAMURAI_7', score: 9860, kills: 14, deaths: 16, headshots: 4, mode: 'insta', level: 'plaza', server: 'Neon Plaza · SA #1', won: true, date: 1736035200000 },
  { name: 'DELTA_ZERO', score: 8120, kills: 12, deaths: 18, headshots: 3, mode: 'duel', level: 'yard', server: 'Container Yard · OC #1', won: false, date: 1736121600000 },
  { name: 'GLITCHKID', score: 7340, kills: 11, deaths: 20, headshots: 5, mode: 'survival', level: 'skyline', server: 'Skyline District · EU #3', won: false, date: 1736208000000 },
  { name: 'RAZORBYTE', score: 6520, kills: 9, deaths: 21, headshots: 2, mode: 'bounty', level: 'plaza', server: 'Neon Plaza · NA #2', won: false, date: 1736294400000 },
];

export const cheatedScores: ScoreEntry[] = [
  { name: 'CHEATER_ONE', score: 90210, kills: 61, deaths: 2, headshots: 40, mode: 'ffa', level: 'plaza', server: 'Neon Plaza · EU #1', won: true, date: 1735689600000, cheated: true },
  { name: 'NEON_PILOT', score: 42000, kills: 33, deaths: 5, headshots: 21, mode: 'tdm', level: 'yard', server: 'Container Yard · EU #2', won: true, date: 1735776000000, cheated: true },
];

export const profile = { matches: 42, kills: 517, deaths: 233, wins: 19 };

export function seedStorage() {
  const SKEY = 'neonriot.settings.v1';
  const HKEY = 'neonriot.scores.v1';
  const HKEY_CHEAT = 'neonriot.scores.cheated.v1';
  const PKEY = 'neonriot.profile.v1';
  localStorage.setItem(SKEY, JSON.stringify(settings));
  localStorage.setItem(HKEY, JSON.stringify(scores));
  localStorage.setItem(HKEY_CHEAT, JSON.stringify(cheatedScores));
  localStorage.setItem(PKEY, JSON.stringify(profile));
}

const roster = (names: string[]): ServerInfo['roster'] =>
  names.map((name, i) => ({ name, score: 120 - i * 13, ping: 14 + i * 9, region: ['EU', 'NA', 'AS'][i % 3] }));

export const servers: ServerInfo[] = [
  {
    id: 's1', name: 'NEON PLAZA · EU #1', ip: '51.38.12.9', port: 27015, region: 'EU', level: 'plaza',
    rules: { mode: 'ffa', scoreLimit: 20, timeLimit: 600, difficulty: 'normal', mutator: 'none', maxPlayers: 24 },
    players: 18, ping: 24, motd: 'No camping, no mercy. GL HF!', roster: roster(['VOIDRUNNER', 'NEON_PILOT', 'KILO_9', 'PIXELWRAITH']),
    alwaysOnline: true,
  },
  {
    id: 's2', name: 'CONTAINER YARD · TEAM MAYHEM', ip: '104.238.44.17', port: 27016, region: 'NA', level: 'yard',
    rules: { mode: 'tdm', scoreLimit: 50, timeLimit: 900, difficulty: 'hard', mutator: 'turbo', maxPlayers: 16 },
    players: 12, ping: 88, motd: 'Team up or die trying.', roster: roster(['DELTA_ZERO', 'SAMURAI_7', 'GLITCHKID', 'RAZORBYTE']),
  },
  {
    id: 's3', name: 'SKYLINE · KING OF THE HILL', ip: '185.62.190.4', port: 27015, region: 'EU', level: 'skyline',
    rules: { mode: 'koth', scoreLimit: 120, timeLimit: 600, difficulty: 'insane', mutator: 'lowgrav', maxPlayers: 12 },
    players: 12, ping: 46, motd: 'Hold the hill. Hold your nerve.', roster: roster(['SUNSET', 'MOONBEAM', 'TAPEDECK']),
  },
  {
    id: 's4', name: 'PROCEDURAL LAB · SURVIVAL', ip: '45.79.200.31', port: 27020, region: 'AS', level: 'procedural',
    gen: { seed: 4821, size: 'large', w: 144, d: 144, theme: 'vapor', style: 'maze' },
    rules: { mode: 'survival', scoreLimit: 10, timeLimit: 0, difficulty: 'easy', mutator: 'none', maxPlayers: 4 },
    players: 3, ping: 188, motd: 'Waves never end. Bring friends.', roster: roster(['AEGIS', 'NOVA_77']),
  },
  {
    id: 's5', name: 'COLOSSEUM DUELS', ip: '51.38.88.2', port: 27018, region: 'SA', level: 'colosseum',
    rules: { mode: 'duel', scoreLimit: 10, timeLimit: 300, difficulty: 'normal', mutator: 'none', maxPlayers: 2 },
    players: 1, ping: 132, motd: '1v1 me bro.', roster: roster(['CHALLENGER']),
  },
  {
    id: 's6', name: 'NEON PLAZA · CTF 24/7', ip: '104.238.9.77', port: 27015, region: 'OC', level: 'plaza',
    rules: { mode: 'ctf', scoreLimit: 5, timeLimit: 900, difficulty: 'auto', mutator: 'none', maxPlayers: 32, cheats: { ...NO_CHEATS, god: true } },
    players: 22, ping: 205, motd: 'Two flags. Zero excuses.', roster: roster(['FLAGZ', 'RUSH_IT', 'BASECAMP']),
  },
];

export const hud: HudState = {
  hp: 76, armor: 45, ammo: 24, mag: 30, reload: 0, weapon: 'rifle', weaponName: 'PULSE RIFLE',
  weapons: [
    { id: 'rifle', name: 'PULSE-RIFLE', ammo: 24, mag: 30 },
    { id: 'shotgun', name: 'SCATTER-GUN', ammo: 6, mag: 8 },
    { id: 'rail', name: 'RAIL-LANCE', ammo: 3, mag: 5 },
  ],
  cur: 0, dash: 0.62, speed: 7.4, timeLeft: 214, scoreLimit: 20, mode: 'ffa', myKills: 11, deaths: 4, streak: 3,
  points: 0, leaderName: 'VOIDRUNNER', leaderKills: 14, teamScores: [37, 29], myTeam: 0, rank: 2, total: 12,
  alive: true, respawnIn: 0, killer: '', fps: 118, ping: 24, aiming: false, sliding: false, protect: true, airJumps: 1,
  cheats: false, assist: true, modeName: 'Deathmatch', hill: false, hillOwner: '', wave: 0, bounty: '',
  flagStatus: '', fakeCount: 11, timeLimit: 600, leaderScore: 4300, bountyRel: null, bountyDist: 0, warmup: false,
};
void mode;

export const scoreRows: ScoreRow[] = [
  { id: 1, name: 'VOIDRUNNER', team: 0, kills: 14, deaths: 3, score: 1400, ping: 24, isPlayer: false, alive: true },
  { id: 2, name: 'NEON_PILOT', team: 0, kills: 11, deaths: 4, score: 1100, ping: 24, isPlayer: true, alive: true },
  { id: 3, name: 'KILO_9', team: 1, kills: 9, deaths: 6, score: 900, ping: 46, isPlayer: false, alive: false },
  { id: 4, name: 'PIXELWRAITH', team: 1, kills: 7, deaths: 8, score: 700, ping: 61, isPlayer: false, alive: true },
  { id: 5, name: 'SAMURAI_7', team: 1, kills: 5, deaths: 9, score: 500, ping: 88, isPlayer: false, alive: true },
];

export const matchResult: MatchResult = {
  id: 1, won: true, rank: 2, total: 12, score: 15310, kills: 22, deaths: 12, headshots: 8, accuracy: 0.412,
  bestStreak: 6, duration: 512, rows: scoreRows, winnerName: 'VOIDRUNNER', teamplay: true, myTeam: 0,
  teamScores: [37, 29], reason: 'limit', cheated: false,
};

export const lobbyConfig: LobbyConfig = {
  name: 'NEON_PILOT’s Lobby', password: 'hunter2', isPublic: true, region: 'EU', map: 'plaza',
  gen: { seed: 4821, size: 'medium', w: 112, d: 112, theme: 'auto', style: 'auto' },
  mode: 'tdm', scoreLimit: 50, timeLimit: 600, difficulty: 'normal', mutator: 'turbo', maxPlayers: 12, fill: 8,
  cheatsOn: true, cheats: { ...NO_CHEATS, god: true, aimbot: true, wallhack: true },
};

export const hostedLobby: HostedLobby = {
  config: lobbyConfig, ip: '51.38.44.201', port: 27015,
  members: [
    { name: 'NEON_PILOT', ping: 5, ready: true, host: true, region: 'EU' },
    { name: 'VOIDRUNNER', ping: 22, ready: true, region: 'EU' },
    { name: 'KILO_9', ping: 61, ready: false, region: 'NA' },
    { name: 'BOT_ZETA', ping: 0, ready: true, bot: true, region: 'EU' },
    { name: 'PIXELWRAITH', ping: 140, ready: false, invited: true, region: 'AS' },
  ],
  resolved: 'plaza',
};

export const level = getLevel('plaza');
export const proceduralLevel = getLevel('procedural', { seed: 4821, size: 'large', w: 144, d: 144, theme: 'vapor', style: 'maze' });
export const levelIds = LEVEL_IDS;

export const feed = [
  { id: 1, killer: 'VOIDRUNNER', victim: 'KILO_9', weapon: 'RAIL', headshot: true, mine: null as null, killerTeam: 0, victimTeam: 1 },
  { id: 2, killer: 'NEON_PILOT', victim: 'PIXELWRAITH', weapon: 'RIFLE', headshot: false, mine: 'killer' as const, killerTeam: 0, victimTeam: 1 },
];
export const chat = [
  { id: 1, name: '', text: 'VOIDRUNNER is on a 6 kill streak', team: -1, system: true },
  { id: 2, name: 'KILO_9', text: 'gg wp', team: 1 },
];
export const announce = { key: 1, text: 'DOUBLE KILL', sub: 'NEON_PILOT', points: 200, tone: 'streak' as const };
export const toast = { key: 1, text: '+50 ARMOR', color: '#2de2ff' };
export const hitMarker = { key: 1, head: true, kill: false };

export function fakeEngine() {
  return {
    vfx: { damage: 0.2, heal: 0, flash: 0, speed: 0.15, low: 0.1, spread: 0.012, fov: 1.6, yaw: 0.6, indicators: [{ ang: 0.3, life: 0.9 }] },
    cheats: { ...NO_CHEATS, wallhack: false },
    boardScroll: 0,
    warmup: false,
    server: servers[0],
    rules: servers[0].rules,
    level,
    getEsp: () => [],
    drawMinimap: () => {},
    getScoreboard: () => scoreRows,
    setCheats: () => {},
    setDifficulty: () => {},
    addTime: () => {},
    addBot: () => {},
    forceEnd: () => {},
    kick: () => {},
    setMapOrTheme: () => {},
    applyThemeOnly: () => {},
    startMatchFromWarmup: () => {},
    input: fakeInput(),
  };
}

export function fakeInput() {
  return {
    keys: new Set<string>(),
    moveX: 0, moveY: 0, touchSprint: false, virtualFire: false,
    addLook: () => {},
    setVirtualFire: () => {},
    setVirtual: () => {},
    tap: () => {},
  };
}

export interface Fixture {
  name: string;
  width: number;
  height: number;
  /** fake milliseconds to advance before the screenshot */
  advance?: number;
  /** whether to emulate a coarse-pointer (touch) device */
  touch?: boolean;
  /** click this selector before the screenshot */
  click?: string;
  dark?: boolean;
}

export const FIXTURES: Fixture[] = [
  { name: 'menu', width: 1440, height: 900 },
  { name: 'menu-tablet', width: 900, height: 1000 },
  { name: 'menu-mobile', width: 390, height: 844, touch: true },
  { name: 'settings-audio', width: 1280, height: 800 },
  { name: 'settings-graphics', width: 1280, height: 800, click: '[data-fixture-tab="Graphics"]' },
  { name: 'settings-controls', width: 1280, height: 800, click: '[data-fixture-tab="Controls"]' },
  { name: 'settings-gameplay', width: 1280, height: 800, click: '[data-fixture-tab="Gameplay"]' },
  { name: 'settings-mobile', width: 390, height: 844, touch: true },
  { name: 'leaderboard', width: 1280, height: 800 },
  { name: 'servers', width: 1440, height: 900 },
  { name: 'servers-mobile', width: 390, height: 844, touch: true },
  { name: 'custom', width: 1440, height: 900 },
  { name: 'custom-mobile', width: 390, height: 844, touch: true },
  { name: 'lobby', width: 1440, height: 900 },
  { name: 'lobby-mobile', width: 390, height: 844, touch: true },
  { name: 'mapdetails', width: 1280, height: 860 },
  { name: 'cheats', width: 900, height: 900 },
  { name: 'kit', width: 1100, height: 1000 },
  { name: 'hud', width: 1440, height: 900 },
  { name: 'hud-mobile', width: 844, height: 390, touch: true },
  { name: 'hud-scoreboard', width: 1440, height: 900 },
  { name: 'overlay-deploy', width: 1440, height: 900 },
  { name: 'overlay-pause', width: 1440, height: 900 },
  { name: 'overlay-gameover', width: 1440, height: 900 },
  { name: 'overlay-connecting', width: 1440, height: 900, advance: 700 },
  { name: 'touch', width: 844, height: 390, touch: true },
  { name: 'hostoptions', width: 1280, height: 860, advance: 120 },
  { name: 'error', width: 1000, height: 700 },
];
