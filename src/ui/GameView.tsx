import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Engine, type EngineState, type FakeProfile, type GameEvent, type HudState, type MatchResult } from '@/game/engine';
import { addScore, bumpProfile, loadScores } from '@/game/storage';
import type { LevelId } from '@/game/types';
import type { ScoreEntry, ServerInfo, Settings } from '@/game/types';
import type { LobbyConfig } from '@/game/lobby';
import { audio } from '@/game/audio';
import { Hud, type AnnounceItem, type ChatItem, type FeedItem } from './Hud';
import { TouchControls } from './TouchControls';
import { ConnectingOverlay, DeployOverlay, GameOverOverlay, PauseOverlay } from './Overlays';
import { SettingsPanel } from './SettingsPanel';
import { HostOptions } from './HostOptions';
import { Btn } from './kit';

export function GameView({
  server, bots, settings, onSettings, touch, onLeave, onServers, onLobby, config, onConfig, fakeProfiles, botCount, joining = true, warmup = false,
}: {
  server: ServerInfo;
  bots: number;
  settings: Settings;
  onSettings: (s: Settings) => void;
  touch: boolean;
  onLeave: () => void;
  onServers: () => void;
  onLobby?: () => void;
  /** live lobby config — present when you are the host of this server */
  config?: LobbyConfig;
  onConfig?: (next: LobbyConfig, resolved?: LevelId) => void;
  fakeProfiles?: FakeProfile[];
  botCount?: number;
  /** false when the server is starting a round we are already connected to (no "connecting" screen) */
  joining?: boolean;
  /** start the map in the pre-round warmup where everybody readies up */
  warmup?: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [phase, setPhase] = useState<EngineState>('intro');
  const [connecting, setConnecting] = useState(joining);
  const [hud, setHud] = useState<HudState | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [announce, setAnnounce] = useState<AnnounceItem | null>(null);
  const [hit, setHit] = useState<{ key: number; head: boolean; kill: boolean } | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string; color: string } | null>(null);
  const [board, setBoard] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [placed, setPlaced] = useState(0);
  const [top, setTop] = useState<ScoreEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const chatInput = useRef<HTMLInputElement>(null);
  const uid = useRef(0);
  const lastPhase = useRef<EngineState>('intro');

  useEffect(() => {
    if (!mount.current) return;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(window.setTimeout(fn, ms));
    };
    const handleEvent = (e: GameEvent) => {
      const id = ++uid.current;
      switch (e.type) {
        case 'kill':
          setFeed((f) => [...f.slice(-6), { id, killer: e.killer, victim: e.victim, weapon: e.weapon, headshot: e.headshot, mine: e.mine, killerTeam: e.killerTeam, victimTeam: e.victimTeam }]);
          later(() => setFeed((f) => f.filter((x) => x.id !== id)), 6000);
          break;
        case 'chat':
          setChat((c) => [...c.slice(-7), { id, name: e.name, text: e.text, team: e.team, system: e.system }]);
          later(() => setChat((c) => c.filter((x) => x.id !== id)), 11000);
          break;
        case 'announce':
          setAnnounce({ key: id, text: e.text, sub: e.sub, points: e.points, tone: e.tone });
          later(() => setAnnounce((a) => (a && a.key === id ? null : a)), 2000);
          break;
        case 'hitmarker':
          setHit({ key: id, head: e.head, kill: e.kill });
          break;
        case 'pickup':
          setToast({ key: id, text: e.text, color: e.color });
          later(() => setToast((t) => (t && t.key === id ? null : t)), 1400);
          break;
        case 'scoreboard':
          setBoard(e.show);
          break;
      }
    };

    let eng: Engine;
    try {
      eng = new Engine({
        container: mount.current,
        server,
        bots,
        botCount,
        fakeProfiles,
        settings: settingsRef.current,
        touch,
        warmup,
        handlers: {
          onHud: setHud,
          onEvent: handleEvent,
          onState: (s) => {
            if (lastPhase.current === 'over' && s !== 'over') {
              setFeed([]);
              setChat([]);
              setResult(null);
              setShowResult(false);
              setBoard(false);
            }
            lastPhase.current = s;
            setPhase(s);
          },
          onOver: (r) => {
            setResult(r);
            setShowResult(false);
            setBoard(false);
            later(() => setShowResult(true), 1500);
            const entry: ScoreEntry = {
              name: settingsRef.current.name || 'Player', score: r.score, kills: r.kills, deaths: r.deaths, headshots: r.headshots,
              mode: server.rules.mode, level: server.level, server: server.name, won: r.won, date: Date.now(), cheated: r.cheated,
            };
            const rank = r.score > 0 ? addScore(entry, r.cheated) : 0;
            if (!r.cheated) bumpProfile(r.kills, r.deaths, r.won);
            setPlaced(rank);
            setTop(loadScores(r.cheated));
          },
        },
      });
    } catch (err) {
      // no WebGL or a renderer failure: show a recoverable message instead of a blank screen
      console.error(err);
      setFailed(err instanceof Error ? err.message : 'Unknown error');
      return () => timers.forEach(clearTimeout);
    }
    engineRef.current = eng;
    if (location.search.includes('debug')) (window as unknown as { __nr: Engine }).__nr = eng;
    setEngine(eng);
    return () => {
      timers.forEach(clearTimeout);
      eng.dispose();
      engineRef.current = null;
      setEngine(null);
      audio.setIntensity(0.55);
    };
    // the engine is created once per session; settings are pushed through applySettings below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, bots, touch]);

  useEffect(() => {
    const t = setTimeout(() => engineRef.current?.applySettings(settings), 120);
    return () => clearTimeout(t);
  }, [settings]);

  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth * 1.05);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /* --------------------------------------------------------------- chat */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (chatOpen || phase !== 'playing' || board || showSettings || hostOpen) return;
      if (e.key === 'Enter' || e.code === 'KeyT') {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen, phase, board, showSettings, hostOpen]);

  useEffect(() => {
    engine?.setChatOpen(chatOpen);
    if (chatOpen) {
      const t = window.setTimeout(() => chatInput.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    if (phase === 'playing') engineRef.current?.input.releaseAll();
    return undefined;
  }, [chatOpen, engine, phase]);

  const sendChat = () => {
    engineRef.current?.sendChat(chatDraft);
    setChatDraft('');
    setChatOpen(false);
    engineRef.current?.input.releaseAll();
  };

  // host edits (name, region, slot count…) should show up on the pause/result screens right away
  const shownServer = useMemo<ServerInfo>(() => {
    const lvl = engine?.server.level ?? server.level;
    const gen = engine?.server.gen ?? server.gen;
    return config
      ? { ...server, level: lvl, gen, name: config.name, region: config.region, password: !!config.password.trim(), rules: { ...server.rules, maxPlayers: config.maxPlayers } }
      : { ...server, level: lvl, gen };
  }, [server, config, engine]);

  const deploy = useCallback(() => engineRef.current?.deploy(), []);
  const done = useCallback(() => setConnecting(false), []);

  const applyConfig = (next: LobbyConfig, resolved?: LevelId) => {
    onConfig?.(next, resolved);
    engineRef.current?.patchServer({ name: next.name, region: next.region, password: !!next.password.trim() });
  };

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-ink p-6">
        <div className="cut glass neon-border max-w-md p-6 text-center">
          <div className="font-display text-lg font-black uppercase tracking-[0.2em] text-neon-red">Couldn’t start the arena</div>
          <p className="mt-2 text-sm text-white/65">Your browser may have hardware acceleration (WebGL) turned off, or the graphics context was lost. Enable it and try again.</p>
          <p className="mt-2 font-display text-[10px] uppercase tracking-widest text-white/35">{failed}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Btn variant="cyan" onClick={onLeave}>Back to menu</Btn>
            <Btn variant="ghost" onClick={() => location.reload()}>Reload</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black" style={{ cursor: phase === 'playing' && !chatOpen ? 'none' : 'default' }}>
      <div ref={mount} className="absolute inset-0" />
      {engine && phase !== 'intro' && (
        <Hud engine={engine} hud={hud} settings={settings} touch={touch} feed={feed} chat={chat} announce={announce} hit={hit} toast={toast} board={board} />
      )}
      {engine && touch && phase === 'playing' && (
        <TouchControls input={engine.input} onPause={() => engine.pause()} onBoard={setBoard} onChat={() => setChatOpen(true)} />
      )}
      {!connecting && phase === 'intro' && <DeployOverlay server={shownServer} touch={touch} onDeploy={deploy} />}
      {phase === 'playing' && !chatOpen && !touch && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-display text-[10px] uppercase tracking-[0.3em] text-white/25">
          Enter / T — chat
        </div>
      )}
      {chatOpen && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center px-4">
          <form
            className="pointer-events-auto flex w-full max-w-xl gap-2"
            onSubmit={(e) => { e.preventDefault(); sendChat(); }}
          >
            <input
              ref={chatInput}
              type="text"
              value={chatDraft}
              maxLength={140}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setChatOpen(false); } }}
              placeholder="Say something — Enter to send, Esc to cancel"
              className="flex-1 cut-sm bg-black/80 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 shadow-[inset_0_0_0_1px_rgba(45,226,255,0.7)]"
            />
            <Btn size="sm" variant="cyan" onClick={sendChat}>Send</Btn>
          </form>
        </div>
      )}
      {touch && portrait && phase !== 'over' && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-30 flex justify-center">
          <div className="cut-sm bg-black/80 px-5 py-3 text-center font-display text-xs font-bold uppercase tracking-[0.2em] text-neon-yellow">⟳ Rotate your device to landscape</div>
        </div>
      )}
      {phase === 'paused' && (
        <PauseOverlay
          server={shownServer}
          warmup={!!hud?.warmup}
          readySelf={!!hud?.readySelf}
          readyCount={hud?.readyCount}
          fighterCount={hud?.fighterCount}
          onReady={() => engine?.toggleReady()}
          onResume={() => engine?.resume()}
          onRestart={server.hosted ? () => engine?.restart() : undefined}
          onSettings={() => setShowSettings(true)}
          onLeave={onLobby ?? onLeave}
          onHost={server.hosted && engine && config ? () => setHostOpen(true) : undefined}
        />
      )}
      {phase === 'over' && showResult && result && (
        <GameOverOverlay result={result} server={shownServer} placed={placed} top={top} onRestart={() => engine?.restart()} onServers={onServers} onMenu={onLeave} onLobby={onLobby} />
      )}
      {hostOpen && engine && config && (
        <HostOptions
          engine={engine}
          config={config}
          onConfig={applyConfig}
          settings={settings}
          onSettings={onSettings}
          onClose={() => setHostOpen(false)}
        />
      )}
      {showSettings && <SettingsPanel settings={settings} onChange={onSettings} onClose={() => setShowSettings(false)} />}
      {connecting && <ConnectingOverlay server={server} name={settings.name} onDone={done} />}
    </div>
  );
}
