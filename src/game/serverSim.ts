import { LEVEL_IDS, MODES, type Difficulty, type LevelId, type ModeId, type Mutator, type RosterEntry, type ServerInfo } from './types';
import { MOTDS, genPlayerName } from './names';
import { mulberry32 } from './levels';

/** Symmetric inter-region base round-trip latency (ms) */
const RTT_MATRIX: Record<string, Record<string, number>> = {
  EU: { EU: 18, NA: 76, AS: 162, SA: 142, OC: 235 },
  NA: { EU: 76, NA: 20, AS: 132, SA: 92, OC: 158 },
  AS: { EU: 162, NA: 132, AS: 19, SA: 215, OC: 92 },
  SA: { EU: 142, NA: 92, AS: 215, SA: 22, OC: 210 },
  OC: { EU: 235, NA: 158, AS: 92, SA: 210, OC: 20 },
};

export const USER_HOME_REGION = 'EU';
export const REGION_BASE: Record<string, number> = RTT_MATRIX[USER_HOME_REGION];
const REGIONS = Object.keys(RTT_MATRIX);

const IP_PREFIX: Record<string, string[]> = {
  EU: ['51.38', '185.62', '94.23', '37.187', '5.9', '51.15', '146.59'],
  NA: ['104.238', '198.58', '72.14', '45.79', '142.44', '23.94', '172.96'],
  AS: ['103.28', '43.249', '157.245', '139.162', '45.118', '128.199'],
  SA: ['177.71', '200.98', '191.252', '168.195', '177.54'],
  OC: ['139.99', '103.43', '45.248', '203.30', '119.9'],
};

const SRV_BRAND = [
  'Pulse', 'Neon', 'Voltage', 'Synth', 'Apex', 'Vortex', 'Hyper', 'Arcade', 'Nova', 'Glitch',
  'Turbo', 'Static', 'Prism', 'Echo', 'Rogue', 'Zero', 'Quantum', 'Midnight', 'Solar', 'Lunar',
  'Crimson', 'Cobalt', 'Velvet', 'Astral', 'Chrome', 'Vapor', 'Ember', 'Frost', 'Storm', 'Flux',
];

const SRV_NOUN = ['Arena', 'Zone', 'Sector', 'Station', 'Outpost', 'Bunker', 'Foundry', 'Terminal', 'Relay', 'Nexus', 'Citadel', 'Bastion', 'Rift', 'Grid'];

const LEVEL_TAG: Record<LevelId, string[]> = {
  plaza: ['Neon Plaza', 'Plaza', 'Ziggurat'],
  yard: ['Container Yard', 'Dockyard', 'Freight Yard'],
  skyline: ['Skyline', 'Skyline District', 'Rooftops'],
  colosseum: ['Colosseum', 'The Pit', 'Amphitheater'],
  procedural: ['Procedural', 'Generated Sector', 'Dynamic Map'],
};

const MODE_TAG: Record<ModeId, string[]> = {
  ffa: ['DM', 'Deathmatch', 'FFA', 'Free-For-All'],
  tdm: ['TDM', 'Team DM', 'Squad TDM', 'Team Deathmatch'],
  insta: ['Instagib', 'Rail Only', 'InstaGib', 'One-Shot'],
  duel: ['1v1 Duel', 'Duel', 'Showdown 1v1'],
  ctf: ['CTF', 'Capture The Flag', 'Flag Run'],
  koth: ['KOTH', 'King of the Hill', 'Hill Control'],
  survival: ['Co-op Survival', 'Wave Survival', 'Horde Defense'],
  bounty: ['Bounty Hunt', 'Bounty', 'Marked Target'],
};

const MODE_MOTD: Record<ModeId, string[]> = {
  ffa: ['Every pilot for themselves. First to the frag limit takes it.', 'Free-for-all Deathmatch. Keep moving or get fragged.'],
  tdm: ['Cyan vs Magenta. Stick with your squad and trade kills.', 'Team Deathmatch — watch your teammates and control power positions.'],
  insta: ['Instagib rules: Railguns only, one shot is lethal.', 'Pure aim and movement. Every rail shot is a one-hit frag.'],
  duel: ['1v1 Duel arena. No distractions, no excuses.', 'Head-to-head duel. Respect the 1v1.'],
  ctf: ['CTF rules: only flag captures count toward the win limit!', 'Protect your flag carrier and bring the enemy flag home to score.'],
  koth: ['KOTH rules: hold the glowing hill uncontested to bank points.', 'Control the central hill to score. Contested hills award nothing.'],
  survival: ['Co-op Survival: work together with the lobby to survive the AI waves!', 'Team up against the hostile wave bots. Every wave hits harder.'],
  bounty: ['Bounty rules: only eliminating the marked target scores points!', 'Hunt the marked bounty target to score. Normal frags award 0 points.'],
};

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Realistic round-trip ping between a server in `serverRegion` and a player in `playerRegion`. */
export function pingFor(serverRegion: string, playerRegion: string): number {
  const base = RTT_MATRIX[serverRegion]?.[playerRegion] ?? 75;
  const jitter = Math.floor(Math.random() * 11) - 3;
  return clamp(Math.round(base + jitter), 6, 360);
}

/** Ping from the local user to a server in `serverRegion`. */
export function userPingTo(serverRegion: string, hopOffset = 4): number {
  const base = RTT_MATRIX[USER_HOME_REGION]?.[serverRegion] ?? 75;
  return clamp(Math.round(base + hopOffset), 8, 340);
}

function buildServerName(
  used: Set<string>,
  region: string,
  mode: ModeId,
  mutator: Mutator,
  level: LevelId,
  difficulty: Difficulty,
  alwaysOnline: boolean,
  endless: boolean,
): string {
  const modeLabel = pick(MODE_TAG[mode]);
  const mapLabel = Math.random() < 0.55 ? pick(LEVEL_TAG[level]) : pick(SRV_NOUN);
  const flavours: string[] = [];
  if (alwaysOnline) flavours.push('24/7');
  if (mutator === 'lowgrav') flavours.push('Low Gravity', 'Zero-G');
  else if (mutator === 'turbo') flavours.push('Turbo', 'Hyper Speed');
  if (endless) flavours.push('Endless');
  if (difficulty === 'hard' || difficulty === 'insane') flavours.push('Pro Rules', 'Competitive', 'Hardcore');
  else if (difficulty === 'easy') flavours.push('Newcomers', 'Chill Vibes', 'Casual');
  else flavours.push('128 Tick', 'Fast Pipes', 'Dedicated', 'Public');

  for (let i = 0; i < 45; i++) {
    const brand = pick(SRV_BRAND);
    const flav = pick(flavours);
    const r = Math.random();
    let n: string;
    if (r < 0.28) n = `[${region}] ${brand} ${modeLabel} | ${flav}`;
    else if (r < 0.52) n = `[${region}] ${brand} ${mapLabel} ${modeLabel}`;
    else if (r < 0.74) n = `${brand} ${modeLabel} · ${mapLabel}`;
    else if (r < 0.9) n = `${brand} ${mapLabel} | ${flav}`;
    else n = `[${region}] ${modeLabel} ${flav} — ${brand}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const fallback = `[${region}] ${pick(SRV_BRAND)} ${modeLabel} #${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function buildMotd(region: string, mode: ModeId, mutator: Mutator, level: LevelId, alwaysOnline: boolean): string {
  const pool: string[] = [...MODE_MOTD[mode], ...MOTDS];
  if (level === 'procedural') pool.push('Procedural map rotation enabled on this server.');
  if (mutator === 'lowgrav') pool.push('Low-gravity physics active. Watch your airtime!');
  if (mutator === 'turbo') pool.push('Turbo mutator active: +25% movement speed and faster weapons.');
  if (alwaysOnline) pool.push('24/7 dedicated server hosted in {region}.');
  return pick(pool).replace(/\{region\}/g, region);
}

function pickPlayerRegion(serverRegion: string, rng: () => number): string {
  // ~72% of players join a server in their own region for low ping
  if (rng() < 0.72) return serverRegion;
  return REGIONS[Math.floor(rng() * REGIONS.length)];
}

function makeServer(usedNames: Set<string>, usedServers: Set<string>, seed: number): ServerInfo {
  const region = pick(REGIONS);
  const mode = pick<ModeId>(['ffa', 'ffa', 'ffa', 'tdm', 'tdm', 'insta', 'duel', 'ctf', 'koth', 'bounty', 'survival']);
  const mutator = pick<Mutator>(['none', 'none', 'none', 'none', 'lowgrav', 'turbo']);
  const difficulty = pick<Difficulty>(['easy', 'normal', 'normal', 'hard', 'hard', 'insane', 'auto']);
  const level: LevelId = Math.random() < 0.18 ? 'procedural' : pick(LEVEL_IDS);
  const maxPlayers = mode === 'duel' ? 2 : pick([8, 10, 12, 16, 16, 20, 24]);
  const endless = mode === 'survival' && Math.random() < 0.5;
  const scoreLimit = mode === 'survival' ? (endless ? 0 : pick([5, 10, 15])) : pick(MODES[mode].limits);
  const timeLimit = endless ? 0 : pick([180, 300, 300, 600, 900, 0]);
  const alwaysOnline = Math.random() < 0.38;
  const name = buildServerName(usedServers, region, mode, mutator, level, difficulty, alwaysOnline, endless);
  const is247 = alwaysOnline || name.includes('24/7');
  const roster: RosterEntry[] = [];
  const initial = mode === 'duel' ? rnd(1, 2) : rnd(1, Math.min(6, maxPlayers - 1));
  for (let i = 0; i < initial; i++) {
    const pr = pickPlayerRegion(region, Math.random);
    roster.push({
      name: genPlayerName(usedNames),
      score: mode === 'ctf' || mode === 'bounty' ? rnd(0, 4) : mode === 'koth' ? rnd(0, 75) : rnd(0, 18) * 100,
      ping: pingFor(region, pr),
      region: pr,
      skill: pick(['easy', 'normal', 'hard', 'insane']),
      frustration: Math.random() * 0.2,
    });
  }
  const hopOffset = rnd(-3, 16);
  return {
    id: `srv-${seed}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    name,
    ip: `${pick(IP_PREFIX[region])}.${rnd(2, 250)}.${rnd(2, 250)}`,
    port: pick([27015, 27016, 7777, 28960, 27960]),
    region,
    level,
    rules: { mode, scoreLimit, timeLimit, difficulty, mutator, maxPlayers },
    players: roster.length,
    ping: userPingTo(region, hopOffset),
    motd: buildMotd(region, mode, mutator, level, is247),
    roster,
    createdAt: Date.now(),
    alwaysOnline: is247,
    gen: level === 'procedural' ? { seed: rnd(1, 99999), size: pick(['small', 'medium', 'large', 'huge'] as const) } : undefined,
  };
}

/**
 * Session-stable fake server list. Only advances while the browser is open (or when catchUp is called
 * after a match). Players move between servers, quit and join; non-24/7 servers can go offline or come online.
 */
export class ServerSim {
  servers: ServerInfo[] = [];
  online = 0;
  private usedNames = new Set<string>();
  private usedServers = new Set<string>();
  private listeners = new Set<() => void>();
  private rng = mulberry32((Date.now() ^ 0x5f3759df) >>> 0);
  private seedCounter = 1;
  private lastCatchUp = 0;

  constructor(initial = 220) {
    for (let i = 0; i < initial; i++) this.servers.push(makeServer(this.usedNames, this.usedServers, this.seedCounter++));
    this.recount();
  }

  private recount() {
    let n = 0;
    for (const s of this.servers) n += s.roster.length;
    this.online = n;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.recount();
    this.listeners.forEach((f) => f());
  }

  private addPlayerTo(s: ServerInfo, region?: string) {
    if (s.roster.length >= s.rules.maxPlayers) return false;
    const pr = region ?? pickPlayerRegion(s.region, this.rng);
    const name = genPlayerName(this.usedNames);
    const mode = s.rules.mode;
    s.roster.push({
      name,
      score: mode === 'ctf' || mode === 'bounty' ? rnd(0, 3) : mode === 'koth' ? rnd(0, 50) : rnd(0, 12) * 100,
      ping: pingFor(s.region, pr),
      region: pr,
      skill: pick(['easy', 'normal', 'hard', 'insane']),
      frustration: Math.random() * 0.15,
    });
    s.players = s.roster.length;
    return true;
  }

  private movePlayer(from: ServerInfo, to: ServerInfo, idx: number) {
    if (to === from || to.roster.length >= to.rules.maxPlayers) return false;
    const p = from.roster[idx];
    from.roster.splice(idx, 1);
    p.ping = pingFor(to.region, p.region);
    to.roster.push(p);
    from.players = from.roster.length;
    to.players = to.roster.length;
    return true;
  }

  private step() {
    // subtle ping drift (±1..2 ms) around each player's and server's true regional baseline
    const pingN = 1 + Math.floor(this.rng() * 3);
    for (let i = 0; i < pingN; i++) {
      const s = this.servers[Math.floor(this.rng() * this.servers.length)];
      if (!s) continue;
      if (s.roster.length) {
        const p = s.roster[Math.floor(this.rng() * s.roster.length)];
        const targetPing = pingFor(s.region, p.region);
        p.ping = clamp(Math.round(p.ping * 0.7 + targetPing * 0.3 + (this.rng() - 0.5) * 3), 5, 360);
        p.frustration = clamp((p.frustration ?? 0) + (this.rng() - 0.5) * 0.05, 0, 1);
      }
      const baseServerPing = userPingTo(s.region, 4);
      s.ping = clamp(Math.round(s.ping * 0.8 + baseServerPing * 0.2 + (this.rng() - 0.5) * 3), 6, 340);
    }
    // player movement
    const moves = 1 + (this.rng() < 0.35 ? 1 : 0);
    for (let m = 0; m < moves; m++) {
      const populated = this.servers.filter((s) => s.roster.length > 0);
      if (!populated.length) break;
      const from = populated[Math.floor(this.rng() * populated.length)];
      const idx = Math.floor(this.rng() * from.roster.length);
      const p = from.roster[idx];
      const r = this.rng();
      if (r < 0.62) {
        const candidates = this.servers.filter((s) => s !== from && s.roster.length < s.rules.maxPlayers);
        if (candidates.length) {
          const same = candidates.filter((s) => s.region === p.region);
          const pool = same.length ? same : candidates;
          const to = pool[Math.floor(this.rng() * Math.min(6, pool.length))];
          this.movePlayer(from, to, idx);
        }
      } else if (r < 0.86) {
        this.usedNames.delete(p.name);
        from.roster.splice(idx, 1);
        from.players = from.roster.length;
      }
      if (this.rng() < 0.7) {
        const open = this.servers.filter((s) => s.roster.length < s.rules.maxPlayers);
        if (open.length) this.addPlayerTo(open[Math.floor(this.rng() * open.length)]);
      }
    }
    // server churn (rare): 24/7 servers never go offline
    const roll = this.rng();
    if (roll < 0.012 && this.servers.length > 90) {
      const droppable = this.servers.filter((s) => !s.alwaysOnline);
      if (droppable.length) {
        const gone = droppable[Math.floor(this.rng() * droppable.length)];
        const idx = this.servers.indexOf(gone);
        if (idx >= 0) this.servers.splice(idx, 1);
        this.usedServers.delete(gone.name);
        for (const p of gone.roster) {
          if (this.rng() < 0.7) {
            const open = this.servers.filter((s) => s.roster.length < s.rules.maxPlayers);
            if (open.length) {
              const to = open[Math.floor(this.rng() * open.length)];
              p.ping = pingFor(to.region, p.region);
              to.roster.push(p);
              to.players = to.roster.length;
              continue;
            }
          }
          this.usedNames.delete(p.name);
        }
      }
    } else if (roll < 0.024) {
      const s = makeServer(this.usedNames, this.usedServers, this.seedCounter++);
      for (let i = 0; i < rnd(1, Math.min(3, s.rules.maxPlayers)); i++) this.addPlayerTo(s);
      this.servers.push(s);
    }
    for (const s of this.servers) s.players = s.roster.length;
  }

  /** Advance the simulation. Called only while the browser is open. */
  tick(steps = 1) {
    for (let i = 0; i < steps; i++) this.step();
    this.emit();
  }

  /** Simulate elapsed time after a match (larger number of changes). */
  catchUp(seconds = 30) {
    const steps = clamp(Math.round(seconds / 1.5), 8, 60);
    for (let i = 0; i < steps; i++) this.step();
    this.lastCatchUp = Date.now();
    this.emit();
  }

  refresh() {
    this.catchUp(18);
  }

  get lastUpdate() {
    return this.lastCatchUp;
  }
}
