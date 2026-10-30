import { useEffect, useMemo, useRef, useState } from 'react';
import { LEVEL_IDS, MODES, fmtTime, type ServerInfo } from '@/game/types';
import { getLevel } from '@/game/levels';
import { chatLine, genBotName, genPlayerName, pickOf } from '@/game/names';
import { pingFor } from '@/game/serverSim';
import { MapDetails } from './MapDetails';
import { audio } from '@/game/audio';
import { Btn, Chip, MapPreview, sfx } from './kit';
import { RuleChips } from './Overlays';
import { PingBars } from './ServerBrowser';
import type { LobbyConfig } from './CustomGame';
import { cn } from '@/utils/cn';

export interface Member {
  name: string;
  ping: number;
  ready: boolean;
  host?: boolean;
  bot?: boolean;
  invited?: boolean;
  region?: string;
}

export interface HostedLobby {
  config: LobbyConfig;
  ip: string;
  port: number;
  members: Member[];
  /** resolved level for "random" picks; re-rolled each time the config changes */
  resolved: ServerInfo['level'];
}


export function lobbyToServer(l: HostedLobby): ServerInfo {
  const c = l.config;
  const level = c.map === 'procedural' ? 'procedural' : c.map === 'random' ? l.resolved : c.map;
  return {
    id: 'hosted-lobby', name: c.name, ip: l.ip, port: l.port, region: c.region, level,
    gen: level === 'procedural' ? c.gen : undefined,
    rules: { mode: c.mode, scoreLimit: c.scoreLimit, timeLimit: c.timeLimit, difficulty: c.difficulty, mutator: c.mutator, maxPlayers: c.maxPlayers, cheats: c.cheatsOn ? c.cheats : undefined },
    players: l.members.length, ping: 6, motd: c.cheatsOn ? 'Cheats are enabled on this server.' : 'Hosted lobby. GL HF!',
    roster: l.members.map((m) => ({ name: m.name, score: 0, ping: m.ping, region: c.region })), hosted: true, password: !!c.password,
  };
}

/** How many non-host fighters (fake players + bots) the match should run, including empty fill slots. */
export function lobbyOpponents(l: HostedLobby): number {
  const target = Math.min(l.config.fill, l.config.maxPlayers);
  return Math.max(1, l.members.filter((m) => !m.host).length + Math.max(0, target - l.members.length));
}

export function newLobby(config: LobbyConfig, me: string): HostedLobby {
  const ip = config.isPublic ? `${pickOf(['51.38', '104.238', '185.62', '45.79'])}.${2 + Math.floor(Math.random() * 248)}.${2 + Math.floor(Math.random() * 248)}` : '192.168.1.' + (10 + Math.floor(Math.random() * 200));
  return { config, ip, port: 27015, members: [{ name: me || 'Player', ping: 5, ready: true, host: true, region: config.region }], resolved: pickOf(LEVEL_IDS) };
}

export function LobbyRoom({ lobby, setLobby, onStart, onWarmup, onEdit, onClose }: { lobby: HostedLobby; setLobby: (f: (l: HostedLobby) => HostedLobby) => void; onStart: () => void; onWarmup: () => void; onEdit: () => void; onClose: () => void }) {
  const c = lobby.config;
  const [chat, setChat] = useState<{ id: number; name: string; text: string; sys?: boolean }[]>([{ id: 0, name: '', text: `Lobby created on ${lobby.ip}:${lobby.port}${c.isPublic ? ' · listed publicly' : ' · private (LAN)'}`, sys: true }]);
  const [msg, setMsg] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const uid = useRef(1);
  const chatEnd = useRef<HTMLDivElement>(null);
  const server = lobbyToServer(lobby);
  const level = useMemo(
    () => getLevel(server.level, server.gen),
    [server.level, server.gen?.seed, server.gen?.size, server.gen?.w, server.gen?.d, server.gen?.theme, server.gen?.style],
  );
  const say = (name: string, text: string, sys?: boolean) => setChat((l) => [...l.slice(-40), { id: uid.current++, name, text, sys }]);
  const target = Math.min(c.fill, c.maxPlayers);

  // Simulated players joining / leaving / readying. State is read from a ref and every side effect
  // (chat, sounds) runs outside the state update, so StrictMode's double-invoked updaters can't duplicate messages.
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  useEffect(() => {
    if (count !== null) return;
    const t = window.setInterval(() => {
      const l = lobbyRef.current;
      const m = l.members;
      const r = Math.random();
      let next: HostedLobby | null = null;
      let after: (() => void) | null = null;
      if (!c.password && m.length < target && r < 0.55) {
        const name = genPlayerName(new Set(m.map((x) => x.name)));
        const pr = Math.random() < 0.72 ? c.region : pickOf(['EU', 'NA', 'AS', 'SA', 'OC']);
        next = { ...l, members: [...m, { name, ping: pingFor(c.region, pr), ready: false, region: pr }] };
        after = () => {
          say('', `${name} joined the lobby`, true);
          audio.play('join');
          if (Math.random() < 0.4) setTimeout(() => say(name, chatLine('join', { region: pr })), 700);
        };
      } else if (m.some((x) => !x.host && !x.ready) && r < 0.85) {
        const who = pickOf(m.filter((x) => !x.host && !x.ready));
        next = { ...l, members: m.map((x) => (x === who ? { ...x, ready: true } : x)) };
      } else if (r > 0.985 && m.filter((x) => !x.host && !x.bot).length > 1) {
        const who = pickOf(m.filter((x) => !x.host && !x.bot));
        next = { ...l, members: m.filter((x) => x !== who) };
        after = () => say('', `${who.name} left the lobby`, true);
      } else if (r > 0.93 && m.some((x) => !x.host && !x.bot)) {
        // Only fake players chat in the lobby; bots stay silent
        const talker = pickOf(m.filter((x) => !x.host && !x.bot));
        after = () => say(talker.name, chatLine(Math.random() < 0.5 ? 'idle' : 'question', { region: talker.region ?? c.region }));
      } else {
        next = {
          ...l,
          members: m.map((x) => {
            if (x.host || x.bot) return x;
            const basePing = pingFor(c.region, x.region ?? c.region);
            return { ...x, ping: Math.max(6, Math.round(x.ping * 0.75 + basePing * 0.25 + (Math.random() - 0.5) * 3)) };
          }),
        };
      }
      if (next) {
        const committed = next;
        setLobby(() => committed);
      }
      after?.();
    }, 900);
    return () => clearInterval(t);
  }, [target, count, setLobby, c.password, c.region]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  useEffect(() => {
    if (count === null) return;
    if (count <= 0) {
      onStart();
      return;
    }
    audio.play(count === 1 ? 'go' : 'beep');
    const t = setTimeout(() => setCount((x) => (x === null ? null : x - 1)), 900);
    return () => clearTimeout(t);
  }, [count, onStart]);

  const send = () => {
    const t = msg.trim();
    if (!t) return;
    say(lobby.members[0].name, t);
    setMsg('');
    sfx.ui();
    const others = lobby.members.filter((m) => !m.host && !m.bot);
    if (others.length && Math.random() < 0.6) setTimeout(() => say(pickOf(others).name, pickOf(['lol', 'true', 'ok', 'gg', 'haha', 'sure', 'yep', '👍', 'start it!'])), 900 + Math.random() * 1500);
  };
  const kick = (name: string) => {
    sfx.back();
    setLobby((l) => ({ ...l, members: l.members.filter((m) => m.name !== name) }));
    say('', `${name} left the lobby`, true);
  };
  const fill = () => {
    setLobby((l) => {
      const used = new Set(l.members.map((m) => m.name));
      const add: typeof l.members = [];
      while (l.members.length + add.length < target) {
        const n = genBotName(used);
        add.push({ name: n, ping: 0, ready: true, bot: true, region: c.region });
      }
      return { ...l, members: [...l.members, ...add] };
    });
  };
  const invite = () => {
    const used = new Set(lobby.members.map((m) => m.name));
    const name = genPlayerName(used);
    const pr = Math.random() < 0.75 ? c.region : pickOf(['EU', 'NA', 'AS', 'SA', 'OC']);
    setLobby((l) => ({ ...l, members: [...l.members, { name, ping: pingFor(c.region, pr), ready: false, invited: true, region: pr }] }));
    say('', `${name} joined the lobby`, true);
    setTimeout(() => say(name, chatLine('join', { region: pr })), 800);
    sfx.ui();
  };
  const setRegion = (region: string) => {
    // Switching server region updates remote players' pings to the new region, while host ping stays untouched
    setLobby((l) => ({
      ...l,
      config: { ...l.config, region },
      members: l.members.map((m) => (m.host || m.bot ? m : { ...m, ping: pingFor(region, m.region ?? region) })),
    }));
    sfx.ui();
  };
  const ready = lobby.members.filter((m) => m.ready).length;
  const slots = Array.from({ length: c.maxPlayers }, (_, i) => lobby.members[i] ?? null);

  return (
    <div className="absolute inset-0 flex flex-col gap-3 p-3 sm:p-6">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Btn variant="danger" size="sm" back onClick={onClose}>✕ Close lobby</Btn>
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-black uppercase tracking-[0.15em] text-white sm:text-2xl">{c.name}</h2>
          <div className="font-display text-[11px] uppercase tracking-[0.2em] text-neon-cyan">
            {lobby.ip}:{lobby.port} · {c.region} · {c.isPublic ? 'Public' : 'Private'} {c.password ? '· 🔒 Password' : ''}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <select value={c.region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className="cut-sm bg-panel2 px-2 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-white outline-none">
            {['EU', 'NA', 'AS', 'SA', 'OC'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Btn variant="ghost" size="sm" onClick={onEdit} disabled={count !== null}>⚙ Settings</Btn>
          <Btn variant="ghost" size="sm" onClick={invite} disabled={lobby.members.length >= c.maxPlayers || count !== null}>+ Invite</Btn>
          <Btn variant="ghost" size="sm" onClick={fill} disabled={lobby.members.length >= target || count !== null}>Fill bots</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setDetails(true)}>🗺 Map</Btn>
          <Btn variant="cyan" size="sm" onClick={onWarmup} disabled={count !== null} title="Roam the arena with lobby players before starting the match">
            🏃 Enter map
          </Btn>
          <Btn variant="primary" onClick={() => setCount(3)} disabled={count !== null}>▶ Start match</Btn>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="cut glass neon-border flex min-h-0 flex-col lg:w-[22rem]">
          <button
            type="button"
            title="Click to inspect map"
            onClick={() => { sfx.ui(); setDetails(true); }}
            className="group relative shrink-0 overflow-hidden text-left"
          >
            <MapPreview key={level.key} level={level} size={220} className="max-h-48 transition group-hover:scale-[1.02] lg:max-h-none" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink to-transparent p-3 pt-8">
              <div className="font-display text-sm font-extrabold uppercase tracking-wider">{c.map === 'random' ? `🎲 ${level.name}` : level.name}</div>
              <div className="text-[11px] text-white/55">{level.tagline}</div>
            </div>
          </button>
          <div className="space-y-2 p-3">
            <RuleChips server={server} />
            <div className="text-center text-xs text-white/50">{MODES[c.mode].desc} {fmtTime(c.timeLimit)} time limit.</div>
            {c.cheatsOn && <div className="text-center"><Chip color="#ff3b5c">Cheats enabled</Chip></div>}
            {c.password && <div className="text-center text-[11px] text-neon-yellow">🔒 Password protected — only invited players and bots can join</div>}
          </div>
        </div>
        <div className="cut glass neon-border flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-line/60 px-4 py-2 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
            <span>Players {lobby.members.length}/{c.maxPlayers}</span>
            <span className="text-neon-green">{ready} ready</span>
          </div>
          <div className="nscroll grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
            {slots.map((m, i) => (
              <div key={m ? m.name : 'empty' + i} className={cn('flex items-center gap-2 px-3 py-1.5 text-sm', m ? 'bg-white/5 fade-in' : 'border border-dashed border-line/50 text-white/25')}>
                {m ? (
                  <>
                    <span className={cn('h-2 w-2 shrink-0 rotate-45', m.ready ? 'bg-neon-green' : 'bg-white/30')} />
                    <span className="truncate font-semibold">{m.host && '★ '}{m.name}</span>
                    {m.bot && <Chip color="#a26bff">Bot</Chip>}
                    {m.invited && <Chip color="#7dff6b">Invited</Chip>}
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {!m.bot && <PingBars ping={m.ping} />}
                      {!m.host && (
                        <button type="button" onClick={() => kick(m.name)} className="font-display text-[10px] font-bold uppercase tracking-wider text-neon-red/80 hover:text-white">Kick</button>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="font-display text-[10px] uppercase tracking-widest">{i < target ? 'Waiting for player…' : 'Open slot'}</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex h-40 shrink-0 flex-col border-t border-line/60 lg:h-48">
            <div className="nscroll min-h-0 flex-1 overflow-y-auto px-3 py-1 text-sm">
              {chat.map((m) => (
                <div key={m.id} className="chat-in">
                  {m.sys ? <span className="text-neon-yellow">» {m.text}</span> : (<><span className="font-bold text-neon-violet">{m.name}</span><span className="text-white/85">: {m.text}</span></>)}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form className="flex gap-2 p-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input type="text" value={msg} maxLength={120} onChange={(e) => setMsg(e.target.value)} placeholder="Say something to the lobby…"
                className="flex-1 cut-sm bg-panel2 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] focus:shadow-[inset_0_0_0_1px_#2de2ff]" />
              <Btn size="sm" variant="cyan" onClick={send}>Send</Btn>
            </form>
          </div>
        </div>
      </div>
      {details && <MapDetails level={level} onClose={() => setDetails(false)} />}
      {count !== null && count > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/60">
          <div key={count} className="pop-in text-center">
            <div className="font-display text-xs font-bold uppercase tracking-[0.4em] text-neon-cyan">Match starting</div>
            <div className="font-display text-9xl font-black text-neon-pink" style={{ textShadow: '0 0 40px #ff2d95' }}>{count}</div>
          </div>
        </div>
      )}
    </div>
  );
}
