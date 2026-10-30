/**
 * Simulated lobby population: people wander in while the server is listed, chat a little and
 * leave again. Readiness is not a lobby concern any more — you join the map first and ready up
 * in the warmup there.
 *
 * Everything is pure: the caller receives a new lobby plus a list of things that should be
 * shown in chat / played as sound effects.
 */
import { REGIONS } from './types';
import { chatLine, genBotName, genPlayerName, pickOf } from './names';
import { pingFor } from './serverSim';
import { acceptsWalkIns, uid, type HostedLobby, type Member } from './lobby';

export type LobbyEvent =
  | { kind: 'sys'; text: string }
  | { kind: 'chat'; name: string; text: string }
  | { kind: 'join'; name: string; region: string };

export interface LobbyTick {
  lobby: HostedLobby;
  events: LobbyEvent[];
}

const chance = (p: number) => Math.random() < p;

function regionFor(serverRegion: string): string {
  return chance(0.74) ? serverRegion : pickOf(REGIONS.filter((r) => r !== serverRegion).concat(serverRegion));
}

function makeHuman(members: Member[], serverRegion: string, invited = false): Member {
  const used = new Set(members.map((m) => m.name));
  const name = genPlayerName(used);
  const region = regionFor(serverRegion);
  return { id: uid('p'), name, ping: pingFor(serverRegion, region), region, invited };
}

function makeBot(members: Member[], serverRegion: string): Member {
  const used = new Set(members.map((m) => m.name));
  return { id: uid('bot'), name: genBotName(used), ping: 0, bot: true, region: serverRegion };
}

function driftPings(members: Member[], c: HostedLobby['config']): void {
  for (const m of members) {
    if (m.host || m.bot) continue;
    const base = pingFor(c.region, m.region ?? c.region);
    m.ping = Math.max(5, Math.round(m.ping * 0.72 + base * 0.28 + (Math.random() - 0.5) * 3));
  }
}

/* ------------------------------------------------------------------- tick */

export function simulateLobby(hosted: HostedLobby, opts: { locked?: boolean } = {}): LobbyTick {
  const c = hosted.config;
  const events: LobbyEvent[] = [];
  const members = hosted.members.map((m) => ({ ...m }));
  const locked = !!opts.locked;

  driftPings(members, c);

  const humans = members.filter((m) => !m.host && !m.bot);

  /* ---------------------------------------------------------- walk-ins */
  if (!locked && acceptsWalkIns(c, members.length)) {
    const fill = members.length / Math.max(1, c.maxPlayers);
    if (chance(0.06 + 0.55 * (1 - fill))) {
      const m = makeHuman(members, c.region);
      members.push(m);
      events.push({ kind: 'join', name: m.name, region: m.region ?? c.region });
      if (chance(0.45)) events.push({ kind: 'chat', name: m.name, text: chatLine('join', { region: m.region ?? c.region }) });
    }
  }

  /* ---------------------------------------------------------------- chat */
  if (humans.length && chance(0.2)) {
    const who = pickOf(humans);
    const pool: string[] = chance(0.5)
      ? [chatLine('idle'), chatLine('question'), chatLine('map'), chatLine('weapon')]
      : [chatLine('join'), chatLine('movement'), chatLine('strategy'), chatLine('ready')];
    events.push({ kind: 'chat', name: who.name, text: pickOf(pool) });
  }

  /* --------------------------------------------------------------- leave */
  if (!locked && humans.length > 1 && chance(0.022)) {
    const who = pickOf(humans);
    const i = members.indexOf(who);
    if (i >= 0) {
      members.splice(i, 1);
      events.push({ kind: 'sys', text: `${who.name} left the lobby` });
      if (chance(0.4)) events.push({ kind: 'chat', name: 'SERVER', text: `${who.name} disconnected` });
    }
  }

  return { lobby: { ...hosted, members }, events };
}

/* ------------------------------------------------------- host bulk actions */

export function fillWithPlayers(hosted: HostedLobby): LobbyTick {
  const c = hosted.config;
  const open = Math.max(0, c.maxPlayers - hosted.members.length);
  if (!open) return { lobby: hosted, events: [{ kind: 'sys', text: 'Server is already full' }] };
  const members = hosted.members.map((m) => ({ ...m }));
  for (let i = 0; i < open; i++) members.push(makeHuman(members, c.region));
  return { lobby: { ...hosted, members }, events: [{ kind: 'sys', text: `Filled ${open} open slot${open === 1 ? '' : 's'}` }] };
}

export function fillWithBots(hosted: HostedLobby): LobbyTick {
  const c = hosted.config;
  const open = Math.max(0, c.maxPlayers - hosted.members.length);
  if (!open) return { lobby: hosted, events: [{ kind: 'sys', text: 'Server is already full' }] };
  const members = hosted.members.map((m) => ({ ...m }));
  for (let i = 0; i < open; i++) members.push(makeBot(members, c.region));
  return { lobby: { ...hosted, members }, events: [{ kind: 'sys', text: `Added ${open} bot${open === 1 ? '' : 's'}` }] };
}

export function kickAll(hosted: HostedLobby): LobbyTick {
  const removed = hosted.members.filter((m) => !m.host).length;
  if (!removed) return { lobby: hosted, events: [] };
  return {
    lobby: { ...hosted, members: hosted.members.filter((m) => m.host) },
    events: [{ kind: 'sys', text: `Removed ${removed} player${removed === 1 ? '' : 's'} from the server` }],
  };
}

/** Host-invited player: works even when the server is unlisted or locked. */
export function invitePlayer(hosted: HostedLobby): LobbyTick {
  if (hosted.members.length >= hosted.config.maxPlayers) {
    return { lobby: hosted, events: [{ kind: 'sys', text: 'Server is already full' }] };
  }
  const m = makeHuman(hosted.members, hosted.config.region, true);
  return {
    lobby: { ...hosted, members: [...hosted.members, m] },
    events: [{ kind: 'join', name: m.name, region: m.region ?? hosted.config.region }],
  };
}
