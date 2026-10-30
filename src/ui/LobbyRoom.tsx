import { useEffect, useMemo, useRef, useState } from 'react';
import { MODES, REGIONS, fmtTime } from '@/game/types';
import { getLevel } from '@/game/levels';
import { pickOf } from '@/game/names';
import { pingFor } from '@/game/serverSim';
import { audio } from '@/game/audio';
import { isOpenLobby, lobbyToServer, openSlots, selfMember, type HostedLobby, type Member } from '@/game/lobby';
import { fillWithBots, fillWithPlayers, invitePlayer, kickAll, simulateLobby, type LobbyEvent } from '@/game/lobbySim';
import { MapDetails } from './MapDetails';
import { Btn, Chip, MapPreview, sfx } from './kit';
import { RuleChips } from './Overlays';
import { PingBars } from './ServerBrowser';
import { cn } from '@/utils/cn';

interface ChatRow {
  id: number;
  name: string;
  text: string;
  sys?: boolean;
}

export function LobbyRoom({
  lobby,
  setLobby,
  onJoin,
  onEdit,
  onClose,
}: {
  lobby: HostedLobby;
  setLobby: (f: (l: HostedLobby) => HostedLobby) => void;
  /** you join the map from here — readying up happens in the warmup on the map */
  onJoin: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const c = lobby.config;
  const me = selfMember(lobby);
  const server = useMemo(() => lobbyToServer(lobby), [lobby]);
  const level = useMemo(
    () => getLevel(server.level, server.gen),
    [server.level, server.gen?.seed, server.gen?.size, server.gen?.w, server.gen?.d, server.gen?.theme, server.gen?.style],
  );

  const [chat, setChat] = useState<ChatRow[]>([
    { id: 0, name: '', text: `Joined ${c.name} — ${lobby.ip}:${lobby.port} · ${c.region} · ${isOpenLobby(c) ? 'public' : 'unlisted'}${c.password.trim() ? ' · password' : ''}`, sys: true },
  ]);
  const [msg, setMsg] = useState('');
  const [details, setDetails] = useState(false);
  const [joining, setJoining] = useState(false);
  const uid = useRef(1);
  const chatEnd = useRef<HTMLDivElement>(null);

  const say = (name: string, text: string, sys?: boolean) =>
    setChat((l) => [...l.slice(-60), { id: uid.current++, name, text, sys }]);

  const applyEvents = (events: LobbyEvent[]) => {
    for (const e of events) {
      if (e.kind === 'sys') say('', e.text, true);
      else if (e.kind === 'chat') say(e.name, e.text);
      else {
        say('', `${e.name} joined the server`, true);
        audio.play('join');
      }
    }
  };

  /* --------------------------------------------- simulated players tick */
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  const lockedRef = useRef(false);
  lockedRef.current = joining;
  useEffect(() => {
    const t = window.setInterval(() => {
      const res = simulateLobby(lobbyRef.current, { locked: lockedRef.current });
      setLobby(() => res.lobby);
      applyEvents(res.events);
    }, 1100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLobby]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  /* ------------------------------------------------------------ join map */
  const join = () => {
    if (joining) return;
    setJoining(true);
    audio.play('go');
    say('', 'Joining the map — ready up there to start the round', true);
    onJoin();
  };

  /* ------------------------------------------------------------- actions */
  const kick = (m: Member) => {
    if (m.host) return;
    sfx.back();
    setLobby((l) => ({ ...l, members: l.members.filter((x) => x.id !== m.id) }));
    say('', `${m.name} was kicked by the host`, true);
  };
  const run = (fn: (l: HostedLobby) => { lobby: HostedLobby; events: LobbyEvent[] }) => {
    sfx.ui();
    const res = fn(lobbyRef.current);
    setLobby(() => res.lobby);
    applyEvents(res.events);
  };
  const send = () => {
    const t = msg.trim();
    if (!t) return;
    say(me?.name ?? 'Host', t);
    setMsg('');
    sfx.ui();
    const others = lobby.members.filter((m) => !m.host && !m.bot);
    if (others.length && Math.random() < 0.7) {
      setTimeout(() => {
        const who = pickOf(others);
        say(who.name, pickOf(['lol', 'true', 'ok', 'gg', 'haha', 'sure', 'yep', '👍', 'joining now', 'loading in']));
      }, 700 + Math.random() * 1400);
    }
  };
  const setRegion = (region: string) => {
    setLobby((l) => ({
      ...l,
      config: { ...l.config, region },
      members: l.members.map((m) => (m.host || m.bot ? m : { ...m, ping: pingFor(region, m.region ?? region) })),
    }));
    sfx.ui();
  };

  const slots: (Member | null)[] = Array.from({ length: c.maxPlayers }, (_, i) => lobby.members[i] ?? null);

  return (
    <div className="absolute inset-0 flex flex-col gap-3 p-3 sm:p-6">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Btn variant="danger" size="sm" back onClick={onClose}>✕ Leave server</Btn>
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-black uppercase tracking-[0.15em] text-white sm:text-2xl">{c.name}</h2>
          <div className="font-display text-[11px] uppercase tracking-[0.2em] text-neon-cyan">
            {lobby.ip}:{lobby.port} · {c.region} · {lobby.members.length}/{c.maxPlayers} players · {isOpenLobby(c) ? 'Public' : 'Unlisted'}
            {c.password.trim() ? ' · 🔒 Password' : ''}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <select value={c.region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className="cut-sm bg-panel2 px-2 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-white outline-none">
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Btn variant="ghost" size="sm" onClick={onEdit}>⚙ Settings</Btn>
          <Btn variant="ghost" size="sm" onClick={() => run(invitePlayer)} disabled={openSlots(lobby) <= 0}>+ Invite</Btn>
          <Btn variant="ghost" size="sm" onClick={() => run(fillWithBots)} disabled={openSlots(lobby) <= 0}>Fill bots</Btn>
          <Btn variant="ghost" size="sm" onClick={() => run(fillWithPlayers)} disabled={openSlots(lobby) <= 0}>Fill players</Btn>
          <Btn variant="ghost" size="sm" onClick={() => run(kickAll)} disabled={lobby.members.length <= 1}>Kick all</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setDetails(true)}>🗺 Map</Btn>
          <Btn
            variant="primary"
            onClick={join}
            title="Load the map with everyone in this server — you ready up on the map"
            className={cn('min-w-[8.5rem] animate-pulse')}
          >
            ▶ Join server
          </Btn>
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
            {!isOpenLobby(c) && (
              <div className="text-center text-[11px] text-neon-yellow">
                This server is not listed — only players you add can join.
              </div>
            )}
          </div>
        </div>

        <div className="cut glass neon-border flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line/60 px-4 py-2">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
              Players {lobby.members.length}/{c.maxPlayers}
            </span>
            {openSlots(lobby) > 0 && (
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">{openSlots(lobby)} open slot{openSlots(lobby) === 1 ? '' : 's'}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                Join the map, then ready up there
              </span>
            </div>
          </div>
          <div className="nscroll grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
            {slots.map((m, i) => (
              <div key={m ? m.id : 'empty' + i} className={cn('flex items-center gap-2 px-3 py-1.5 text-sm', m ? 'bg-white/5 fade-in' : 'border border-dashed border-line/50 text-white/25')}>
                {m ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rotate-45 bg-neon-green/70" />
                    <span className="truncate font-semibold">{m.host && '★ '}{m.name}</span>
                    {m.bot && <Chip color="#a26bff">Bot</Chip>}
                    {m.invited && !m.host && <Chip color="#7dff6b">Added</Chip>}
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {!m.bot && <PingBars ping={m.ping} />}
                      {!m.host && (
                        <button type="button" onClick={() => kick(m)} className="font-display text-[10px] font-bold uppercase tracking-wider text-neon-red/80 hover:text-white">Kick</button>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="font-display text-[10px] uppercase tracking-widest">Open slot</span>
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
              <input type="text" value={msg} maxLength={120} onChange={(e) => setMsg(e.target.value)} placeholder="Say something to the server…"
                className="flex-1 cut-sm bg-panel2 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30 shadow-[inset_0_0_0_1px_rgba(120,100,220,0.5)] focus:shadow-[inset_0_0_0_1px_#2de2ff]" />
              <Btn size="sm" variant="cyan" onClick={send}>Send</Btn>
            </form>
          </div>
        </div>
      </div>
      {details && <MapDetails level={level} onClose={() => setDetails(false)} />}
      {joining && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/60">
          <div className="pop-in text-center">
            <div className="font-display text-xs font-bold uppercase tracking-[0.4em] text-neon-cyan">Joining</div>
            <div className="font-display text-4xl font-black uppercase tracking-[0.2em] text-neon-pink" style={{ textShadow: '0 0 40px #ff2d95' }}>Loading map</div>
            <div className="mt-2 font-display text-[10px] uppercase tracking-[0.3em] text-white/50">Ready up once you are in</div>
          </div>
        </div>
      )}
    </div>
  );
}
