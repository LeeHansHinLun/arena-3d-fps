import { useCallback, useEffect, useRef, useState } from './hooks';
import { Engine, type EngineState, type FakeProfile, type GameEvent, type HudState, type MatchResult } from '@/game/engine';
import { addScore, bumpProfile, loadScores } from '@/game/storage';
import { NO_CHEATS, type Cheats, type ScoreEntry, type ServerInfo, type Settings } from '@/game/types';
import { audio } from '@/game/audio';
import { Hud, type AnnounceItem, type ChatItem, type FeedItem } from './Hud';
import { TouchControls } from './TouchControls';
import { ConnectingOverlay, DeployOverlay, GameOverOverlay, PauseOverlay } from './Overlays';
import { SettingsPanel } from './SettingsPanel';
import { HostOptions } from './HostOptions';
import { component, subView } from './dom';
import type { View } from './dom';
import { Btn } from './kit';

export interface GameViewProps {
  server: ServerInfo;
  bots: number;
  settings: Settings;
  onSettings: (s: Settings) => void;
  touch: boolean;
  onLeave: () => void;
  onServers: () => void;
  onLobby?: () => void;
  onCheats?: (allowed: boolean, c: Cheats) => void;
  onMapChange?: (level: ServerInfo['level'], gen?: ServerInfo['gen']) => void;
  fakeProfiles?: FakeProfile[];
  botCount?: number;
  warmup?: boolean;
}

export function GameView(props: GameViewProps): View<GameViewProps> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = new Map<string, View<any>>();

  const view = component<GameViewProps>(props, () => {
    const { server, bots, settings, onSettings, touch, onLeave, onServers, onLobby, onCheats, onMapChange, fakeProfiles, botCount, warmup } = props;
    const mount = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<Engine | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const [engine, setEngine] = useState<Engine | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [phase, setPhase] = useState<EngineState>('intro');
    const [connecting, setConnecting] = useState(true);
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
    const [cheatsAllowed, setCheatsAllowed] = useState(!!server.rules.cheats);
    const [portrait, setPortrait] = useState(false);
    const uid = useRef(0);
    const lastPhase = useRef<EngineState>('intro');

    useEffect(() => {
      const host = mount.current;
      if (!host) return;
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
          container: host,
          server,
          bots,
          botCount,
          fakeProfiles,
          warmup,
          settings: settingsRef.current,
          touch,
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

    const deploy = useCallback(() => engineRef.current?.deploy(), []);
    const done = useCallback(() => setConnecting(false), []);

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

    const hudNode =
      engine && phase !== 'intro'
        ? subView(cache, 'hud', Hud, { engine, hud, settings, touch, feed, chat, announce, hit, toast, board })
        : null;
    const touchNode =
      engine && touch && phase === 'playing' ? subView(cache, 'touch', TouchControls, { input: engine.input, onPause: () => engine.pause(), onBoard: setBoard }) : null;
    const deployNode = !connecting && phase === 'intro' ? subView(cache, 'deploy', DeployOverlay, { server, touch, onDeploy: deploy }) : null;
    const pauseNode =
      phase === 'paused'
        ? subView(cache, 'pause', PauseOverlay, {
            server,
            warmup: engine?.warmup,
            onResume: () => engine?.resume(),
            onStartMatch: engine?.warmup ? () => engine.startMatchFromWarmup() : undefined,
            onRestart: () => engine?.restart(),
            onSettings: () => setShowSettings(true),
            onLeave: onLobby ?? onLeave,
            onHost: server.hosted && engine ? () => setHostOpen(true) : undefined,
          })
        : null;
    const overNode =
      phase === 'over' && showResult && result
        ? subView(cache, 'over', GameOverOverlay, {
            result,
            server,
            placed,
            top,
            onRestart: () => engine?.restart(),
            onServers,
            onMenu: onLeave,
            onLobby,
          })
        : null;
    const hostNode =
      hostOpen && engine
        ? subView(cache, 'host', HostOptions, {
            engine,
            cheatsAllowed,
            onCheatsAllowed: (v: boolean) => {
              setCheatsAllowed(v);
              onCheats?.(v, v ? engine.cheats : { ...NO_CHEATS });
            },
            onCheats: (c: Cheats) => onCheats?.(cheatsAllowed, c),
            onMapChange,
            onClose: () => setHostOpen(false),
          })
        : null;
    const settingsNode = showSettings ? subView(cache, 'settings', SettingsPanel, { settings, onChange: onSettings, onClose: () => setShowSettings(false) }) : null;
    const connectingNode = connecting ? subView(cache, 'connecting', ConnectingOverlay, { server, name: settings.name, onDone: done }) : null;

    return (
      <div className="absolute inset-0 bg-black" style={{ cursor: phase === 'playing' ? 'none' : 'default' }}>
        <div ref={(el: Element) => { mount.current = el as HTMLDivElement; }} className="absolute inset-0" />
        {hudNode}
        {touchNode}
        {touch && portrait && phase !== 'over' && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 z-30 flex justify-center">
            <div className="cut-sm bg-black/80 px-5 py-3 text-center font-display text-xs font-bold uppercase tracking-[0.2em] text-neon-yellow">⟳ Rotate your device to landscape</div>
          </div>
        )}
        {deployNode}
        {pauseNode}
        {overNode}
        {hostNode}
        {settingsNode}
        {connectingNode}
      </div>
    );
  });

  view.cleanup(() => {
    for (const child of cache.values()) child.dispose();
    cache.clear();
  });

  return view;
}
