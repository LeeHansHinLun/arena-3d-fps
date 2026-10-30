import {
  LEVEL_IDS,
  NO_CHEATS,
  type BuiltinLevelId,
  type Cheats,
  type Difficulty,
  type LevelId,
  type MapSize,
  type ModeId,
  type Mutator,
  type ServerInfo,
} from './types';
import { pickOf } from './names';
import { pingFor, userPingTo } from './serverSim';

/* ------------------------------------------------------------------ types */

export type LobbyMap = BuiltinLevelId | 'random' | 'procedural';

export interface Member {
  /** stable identity — names alone are not unique once players come and go */
  id: string;
  name: string;
  ping: number;
  host?: boolean;
  bot?: boolean;
  /** joined through an invite (bypasses the server being unlisted / locked) */
  invited?: boolean;
  region?: string;
}

export interface LobbyConfig {
  name: string;
  password: string;
  isPublic: boolean;
  region: string;
  map: LobbyMap;
  gen: { seed: number; size: MapSize; w: number; d: number; theme: string; style: string };
  mode: ModeId;
  scoreLimit: number;
  timeLimit: number;
  difficulty: Difficulty;
  mutator: Mutator;
  maxPlayers: number;
  cheatsOn: boolean;
  cheats: Cheats;
}

export interface HostedLobby {
  config: LobbyConfig;
  ip: string;
  port: number;
  members: Member[];
  /** resolved level for "random" picks; re-rolled each time the map setting changes */
  resolved: LevelId;
}

export const MAX_PLAYERS_MIN = 2;
export const MAX_PLAYERS_MAX = 120;

let seq = 0;
/** stable, collision-free member id */
export function uid(prefix = 'm'): string {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

export function defaultLobby(name: string): LobbyConfig {
  return {
    name: `${name || 'Player'}'s Lobby`,
    password: '',
    isPublic: true,
    region: 'EU',
    map: 'random',
    gen: { seed: Math.floor(Math.random() * 99999) + 1, size: 'medium', w: 112, d: 112, theme: 'auto', style: 'auto' },
    mode: 'ffa',
    scoreLimit: 20,
    timeLimit: 300,
    difficulty: 'normal',
    mutator: 'none',
    maxPlayers: 12,
    cheatsOn: false,
    cheats: { ...NO_CHEATS },
  };
}

/* ---------------------------------------------------------------- helpers */

export function resolvedLevel(l: HostedLobby): LevelId {
  const m = l.config.map;
  return m === 'procedural' ? 'procedural' : m === 'random' ? l.resolved : m;
}

/** An open lobby accepts walk-in players: it is listed in the browser and carries no password. */
export function isOpenLobby(c: LobbyConfig): boolean {
  return c.isPublic && !c.password.trim();
}

/**
 * Walk-in players can only appear when the server is listed and unlocked.
 * This is what makes the "public" switch behave exactly like setting a password:
 * no strangers show up, so the only way in is to be added by the host.
 */
export function acceptsWalkIns(c: LobbyConfig, count: number): boolean {
  if (!isOpenLobby(c)) return false;
  return count < c.maxPlayers;
}

export function openSlots(l: HostedLobby): number {
  return Math.max(0, l.config.maxPlayers - l.members.length);
}

/** Fighters the engine should spawn: everyone in the lobby except you. */
export function opponentCount(l: HostedLobby): number {
  return Math.max(1, l.members.filter((m) => !m.host).length);
}

export function selfMember(l: HostedLobby): Member | undefined {
  return l.members.find((m) => m.host) ?? l.members[0];
}

/** Everybody who is in the server will spawn in the map with you. */
export function spawnCount(l: HostedLobby): number {
  return l.members.filter((m) => !m.host).length;
}

/** Random public address for the hosted server (unlisted servers still have a real IP). */
export function makeAddress(): string {
  return `${pickOf(['51.38', '104.238', '185.62', '45.79', '139.99', '94.23'])}.${2 + Math.floor(Math.random() * 248)}.${2 + Math.floor(Math.random() * 248)}`;
}

export function newLobby(config: LobbyConfig, me: string): HostedLobby {
  return {
    config,
    ip: makeAddress(),
    port: 27015,
    members: [{ id: uid('host'), name: me || 'Player', ping: 4, host: true, region: config.region }],
    resolved: pickOf(LEVEL_IDS),
  };
}

/** Snapshot of the lobby as a joinable server (also used for the in-game server info). */
export function lobbyToServer(l: HostedLobby): ServerInfo {
  const c = l.config;
  const level = resolvedLevel(l);
  return {
    id: 'hosted-lobby',
    name: c.name,
    ip: l.ip,
    port: l.port,
    region: c.region,
    level,
    gen: level === 'procedural' ? c.gen : undefined,
    rules: {
      mode: c.mode,
      scoreLimit: c.scoreLimit,
      timeLimit: c.timeLimit,
      difficulty: c.difficulty,
      mutator: c.mutator,
      maxPlayers: c.maxPlayers,
      cheats: c.cheatsOn ? c.cheats : undefined,
    },
    players: l.members.length,
    ping: userPingTo(c.region, 3),
    motd: c.cheatsOn ? 'Cheats are enabled on this server.' : 'Hosted server. GL HF!',
    roster: l.members.map((m) => ({
      name: m.name,
      score: 0,
      ping: m.ping,
      region: m.region ?? c.region,
      skill: c.difficulty === 'auto' ? undefined : c.difficulty,
    })),
    hosted: true,
    password: !!c.password.trim(),
    createdAt: Date.now(),
  };
}

/**
 * Re-pings everyone after the region changed and trims the roster if the slot count shrank.
 */
export function reconcileMembers(members: Member[], c: LobbyConfig): Member[] {
  const trimmed = members.slice(0, Math.max(1, c.maxPlayers));
  return trimmed.map((m) =>
    m.host || m.bot ? m : { ...m, ping: pingFor(c.region, m.region ?? c.region) },
  );
}
