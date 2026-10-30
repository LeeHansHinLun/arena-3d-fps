import { LEVEL_IDS, MODES, type Difficulty, type LevelId, type ModeId, type Mutator, type RosterEntry, type ServerInfo } from './types';
import { MOTDS, genPlayerName } from './names';
import { mulberry32 } from './levels';

export const REGION_BASE: Record<string, number> = { EU: 18, NA: 92, AS: 185, SA: 148, OC: 265 };
const REGION_DIST: Record<string, Record<string, number>> = {
  EU: { EU: 0, NA: 78, AS: 140, SA: 120, OC: 210 },
  NA: { EU: 78, NA: 0, AS: 150, SA: 55, OC: 190 },
  AS: { EU: 140, NA: 150, AS: 0, SA: 190, OC: 95 },
  SA: { EU: 120, NA: 55, AS: 190, SA: 0, OC: 200 },
  OC: { EU: 210, NA: 190, AS: 95, SA: 200, OC: 0 },
};
const REGIONS = Object.keys(REGION_BASE);
const IP_PREFIX: Record<string, string[]> = {
  EU: ['51.38', '185.62', '94.23', '37.187', '5.9', '51.15', '146.59'],
  NA: ['104.238', '198.58', '72.14', '45.79', '142.44', '23.94', '172.96'],
  AS: ['103.28', '43.249', '157.245', '139.162', '45.118', '128.199'],
  SA: ['177.71', '200.98', '191.252', '168.195', '177.54'],
  OC: ['139.99', '103.43', '45.248', '203.30', '119.9'],
};
const SRV_A = ['Pulse', 'Neon', 'Voltage', 'Synth', 'Apex', 'Vortex', 'Hyper', 'Arcade', 'Nova', 'Glitch', 'Turbo', 'Static', 'Prism', 'Echo', 'Rogue', 'Zero', 'Quantum', 'Midnight', 'Solar', 'Lunar', 'Crimson', 'Cobalt', 'Velvet', 'Astral', 'Chrome', 'Vapor', 'Ember', 'Frost', 'Storm', 'Flux'];
const SRV_B = ['Arena', 'Zone', 'Sector', 'Pit', 'Yard', 'Plaza', 'District', 'Station', 'Outpost', 'Bunker', 'Colosseum', 'Skyline', 'Foundry', 'Terminal', 'Relay', 'Nexus', 'Citadel', 'Bastion', 'Rift', 'Grid'];
const SRV_C = ['DM', 'TDM', 'Instagib', 'CTF', 'KOTH', 'Bounty', 'Survival', 'Duel', 'Customs', 'Warmup', 'Ranked', 'Casual', 'Nightly', 'Pro', 'Chill'];
const FLAVOURS = ['24/7', 'Fast Pipes', 'No Rules', 'Sweat Only', 'Chill Vibes', 'Pro Rules', 'New Players', 'Movement', 'Low Gravity', 'Turbo', 'Hardcore', 'Classic'];

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function pingFor(serverRegion: string, playerRegion: string): number {
  const base = REGION_BASE[serverRegion] ?? 60;
  const dist = REGION_DIST[serverRegion]?.[playerRegion] ?? 60;
  return Math.round(base + dist * 0.55 + Math.random() * 14);
}

function makeServerName(used: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const r = Math.random();
    let n: string;
    if (r < 0.22) n = `${pick(SRV_A)} ${pick(SRV_B)}`;
    else if (r < 0.45) n = `[${pick(REGIONS)}] ${pick(SRV_A)} ${pick(SRV_C)}`;
    else if (r < 0.62) n = `${pick(SRV_A)} ${pick(SRV_B)} | ${pick(FLAVOURS)}`;
    else if (r < 0.78) n = `${pick(SRV_C)} ${pick(SRV_B)} ${pick(FLAVOURS)}`;
    else if (r < 0.9) n = `${pick(SRV_A)}'s ${pick(SRV_B)}`;
    else n = `${pick(FLAVOURS)} ${pick(SRV_B)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const n = `${pick(SRV_A)} ${pick(SRV_B)} ${used.size}`;
  used.add(n);
  return n;
}

function makeServer(usedNames: Set<string>, usedServers: Set<string>, seed: number): ServerInfo {
  const region = pick(REGIONS);
  const mode = pick<ModeId>(['ffa', 'ffa', 'ffa', 'tdm', 'tdm', 'insta', 'duel', 'ctf', 'koth', 'bounty', 'survival']);
  const mutator = pick<Mutator>(['none', 'none', 'none', 'none', 'lowgrav', 'turbo']);
  const difficulty = pick<Difficulty>(['easy', 'normal', 'normal', 'hard', 'hard', 'insane', 'auto']);
  const level: LevelId = Math.random() < 0.16 ? 'procedural' : pick(LEVEL_IDS);
  const maxPlayers = pick([8, 10, 12, 16, 16, 20, 24]);
  const endless = mode === 'survival' && Math.random() < 0.5;
  const scoreLimit = mode === 'survival' ? (endless ? 0 : pick([5, 10, 15])) : pick(MODES[mode].limits);
  const timeLimit = endless ? 0 : pick([180, 300, 300, 600, 900, 0]);
  const name = makeServerName(usedServers);
  const roster: RosterEntry[] = [];
  const initial = rnd(1, 6);
  for (let i = 0; i < initial; i++) {
    const pr = pick(REGIONS);
    roster.push({ name: genPlayerName(usedNames), score: rnd(0, 18) * 100, ping: pingFor(region, pr), region: pr, skill: pick(['easy', 'normal', 'hard', 'insane']), frustration: Math.random() * 0.2 });
  }
  return {
    id: `srv-${seed}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    name, ip: `${pick(IP_PREFIX[region])}.${rnd(2, 250)}.${rnd(2, 250)}`, port: pick([27015, 27016, 7777, 28960, 27960]),
    region, level, rules: { mode, scoreLimit, timeLimit, difficulty, mutator, maxPlayers },
    players: roster.length, ping: roster.length ? Math.round(roster.reduce((a, r) => a + r.ping, 0) / roster.length) : REGION_BASE[region] + rnd(0, 20),
    motd: pick(MOTDS).replace('{region}', region), roster, createdAt: Date.now(),
    gen: level === 'procedural' ? { seed: rnd(1, 99999), size: pick(['small', 'medium', 'large', 'huge'] as const) } : undefined,
  };
}

/**
 * Session-stable fake server list. Only advances while the browser is open (or when catchUp is called
 * after a match). Players move between servers, quit and join; servers can go offline or come online.
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

  constructor(initial = 150) {
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
    const pr = region ?? pick(REGIONS);
    const name = genPlayerName(this.usedNames);
    s.roster.push({ name, score: rnd(0, 12) * 100, ping: pingFor(s.region, pr), region: pr, skill: pick(['easy', 'normal', 'hard', 'insane']), frustration: Math.random() * 0.15 });
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
    // ping drift: only a few servers, tiny changes
    const pingN = 1 + Math.floor(this.rng() * 3);
    for (let i = 0; i < pingN; i++) {
      const s = this.servers[Math.floor(this.rng() * this.servers.length)];
      if (!s) continue;
      if (s.roster.length) {
        const p = s.roster[Math.floor(this.rng() * s.roster.length)];
        p.ping = clamp(p.ping + Math.round((this.rng() - 0.5) * 5), 5, 400);
        p.frustration = clamp((p.frustration ?? 0) + (this.rng() - 0.5) * 0.05, 0, 1);
        s.ping = Math.round(s.roster.reduce((a, r) => a + r.ping, 0) / s.roster.length);
      } else s.ping = clamp(s.ping + Math.round((this.rng() - 0.5) * 4), 5, 400);
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
        // move to another server, preferring same region and space
        const candidates = this.servers.filter((s) => s !== from && s.roster.length < s.rules.maxPlayers);
        if (candidates.length) {
          // prefer servers in the player's own region, otherwise any server with room
          const same = candidates.filter((s) => s.region === p.region);
          const pool = same.length ? same : candidates;
          const to = pool[Math.floor(this.rng() * Math.min(6, pool.length))];
          this.movePlayer(from, to, idx);
        }
      } else if (r < 0.86) {
        // quit
        this.usedNames.delete(p.name);
        from.roster.splice(idx, 1);
        from.players = from.roster.length;
      }
      // someone new joins somewhere
      if (this.rng() < 0.7) {
        const open = this.servers.filter((s) => s.roster.length < s.rules.maxPlayers);
        if (open.length) this.addPlayerTo(open[Math.floor(this.rng() * open.length)]);
      }
    }
    // server churn (rare)
    const roll = this.rng();
    if (roll < 0.012 && this.servers.length > 90) {
      const idx = Math.floor(this.rng() * this.servers.length);
      const gone = this.servers[idx];
      this.servers.splice(idx, 1);
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
    } else if (roll < 0.024) {
      const s = makeServer(this.usedNames, this.usedServers, this.seedCounter++);
      for (let i = 0; i < rnd(1, 3); i++) this.addPlayerTo(s);
      this.servers.push(s);
    }
    // keep server objects' player counts exact
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
