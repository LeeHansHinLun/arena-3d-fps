import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '@/game/audio';
import { detectTouch, loadSettings, saveSettings } from '@/game/storage';
import { ServerSim } from '@/game/serverSim';
import { randomPlayerName } from '@/game/names';
import { LEVEL_IDS, type LevelId, type ServerInfo, type Settings } from '@/game/types';
import {
  isOpenLobby,
  lobbyToServer,
  newLobby,
  opponentCount,
  reconcileMembers,
  type HostedLobby,
  type LobbyConfig,
} from '@/game/lobby';
import { Menu } from '@/ui/Menu';
import { ServerBrowser } from '@/ui/ServerBrowser';
import { CustomGame, defaultLobby } from '@/ui/CustomGame';
import { LobbyRoom } from '@/ui/LobbyRoom';
import { Leaderboard } from '@/ui/Leaderboard';
import { SettingsPanel } from '@/ui/SettingsPanel';
import { GameView } from '@/ui/GameView';

type Screen = 'menu' | 'servers' | 'custom' | 'lobby' | 'game';
interface Session {
  server: ServerInfo;
  bots: number;
  key: number;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function App() {
  const touch = useMemo(() => detectTouch(), []);
  const [settings, setSettings] = useState<Settings>(() => {
    const s = loadSettings();
    if (!s.name || /^Rookie\d+$/.test(s.name)) return { ...s, name: randomPlayerName() };
    return s;
  });
  const [screen, setScreen] = useState<Screen>('menu');
  const simRef = useRef<ServerSim | null>(null);
  if (!simRef.current) simRef.current = new ServerSim(220);
  const sim = simRef.current;
  const [servers, setServers] = useState<ServerInfo[]>(() => [...sim.servers]);
  const [online, setOnline] = useState(sim.online);
  const [refreshing, setRefreshing] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [settingsTab, setSettingsTab] = useState<'Audio' | 'Controls' | null>(null);
  const [scores, setScores] = useState(false);
  const keyRef = useRef(0);
  const webgl = useMemo(() => hasWebGL(), []);
  const [lobby, setLobbyState] = useState<HostedLobby | null>(null);
  const [editing, setEditing] = useState(false);
  const setLobby = useCallback((f: (l: HostedLobby) => HostedLobby) => setLobbyState((l) => (l ? f(l) : l)), []);
  const lobbyRef = useRef<HostedLobby | null>(null);
  lobbyRef.current = lobby;

  // the host entry in the lobby follows the pilot name you picked in Settings
  useEffect(() => {
    setLobbyState((l) =>
      l && l.members.some((m) => m.host && m.name !== settings.name)
        ? { ...l, members: l.members.map((m) => (m.host ? { ...m, name: settings.name } : m)) }
        : l,
    );
  }, [settings.name]);

  useEffect(() => {
    saveSettings(settings);
    audio.setVolumes(settings.masterVol, settings.sfxVol, settings.musicVol);
  }, [settings]);

  // unlock audio on first interaction, start the menu music
  useEffect(() => {
    const unlock = () => {
      audio.init();
      audio.startMusic();
      audio.setIntensity(0.55);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // keep the fake server list alive — only while the browser is open
  useEffect(() => {
    const sync = () => {
      setServers([...sim.servers]);
      setOnline(sim.online);
    };
    sync();
    const unsub = sim.subscribe(sync);
    return () => { unsub(); };
  }, [sim]);
  useEffect(() => {
    if (screen !== 'servers') return;
    const i = setInterval(() => sim.tick(1), 2600);
    return () => clearInterval(i);
  }, [screen, sim]);
  const catchUp = useCallback(() => {
    sim.catchUp(30);
    setServers([...sim.servers]);
    setOnline(sim.online);
  }, [sim]);

  const join = useCallback((server: ServerInfo, bots?: number) => {
    setSession({ server, bots: bots ?? server.players, key: ++keyRef.current });
    setScreen('game');
  }, []);

  const quick = useCallback(() => {
    const pool = servers.filter((s) => s.players < s.rules.maxPlayers && s.ping < 200 && !s.password);
    const list = pool.length ? pool : servers.filter((s) => s.players < s.rules.maxPlayers && !s.password);
    if (!list.length) return;
    join(list[Math.floor(Math.random() * list.length)]);
  }, [servers, join]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      sim.refresh();
      setServers([...sim.servers]);
      setOnline(sim.online);
      setRefreshing(false);
    }, 700);
  }, [sim]);

  /**
   * Joining loads the map in warmup: you roam, ready up there and the round starts once you and
   * the other players are ready. There is no separate "start match" step.
   */
  const joinMap = useCallback(() => {
    const l = lobbyRef.current;
    if (!l) return;
    setSession({ server: lobbyToServer(l), bots: opponentCount(l), key: ++keyRef.current });
    setScreen('game');
  }, []);

  const updateConfig = useCallback((next: LobbyConfig, resolved?: LevelId) => {
    setLobbyState((l) => {
      if (!l) return l;
      const regionChanged = l.config.region !== next.region;
      return {
        ...l,
        config: next,
        resolved: resolved ?? l.resolved,
        // only re-ping when the server actually moved (otherwise pings would jitter on every edit)
        members: regionChanged ? reconcileMembers(l.members, next) : l.members.slice(0, Math.max(1, next.maxPlayers)),
      };
    });
  }, []);

  const toLobby = useCallback(() => {
    setSession(null);
    setScreen('lobby');
    catchUp();
  }, [catchUp]);

  const leave = useCallback(() => {
    setSession(null);
    setScreen('menu');
  }, []);
  const shownServers = useMemo(
    () => (lobby && isOpenLobby(lobby.config) ? [lobbyToServer(lobby), ...servers] : servers),
    [lobby, servers],
  );

  const toServers = useCallback(() => {
    setSession(null);
    setScreen('servers');
  }, []);

  if (!webgl) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-ink p-6">
        <div className="cut glass neon-border max-w-md p-6 text-center">
          <div className="font-display text-lg font-black uppercase tracking-[0.2em] text-neon-red">WebGL is unavailable</div>
          <p className="mt-2 text-sm text-white/65">NEON RIOT renders in 3D, so it needs WebGL. Turn on hardware acceleration in your browser settings, then reload.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 overflow-hidden bg-ink font-body text-white">
      {screen !== 'game' && (
        <>
          <div className="synth-bg">
            <div className="synth-stars" />
            <div className="synth-sun" />
            <div className="synth-grid" />
          </div>
          <div className="scanlines absolute inset-0 pointer-events-none" />
        </>
      )}
      {screen === 'menu' && (
        <Menu
          settings={settings}
          onName={(name) => setSettings((s) => ({ ...s, name }))}
          onQuick={quick}
          online={online}
          onServers={() => setScreen('servers')}
          onCustom={() => { setEditing(false); setScreen(lobby ? 'lobby' : 'custom'); }}
          hosting={!!lobby}
          onScores={() => setScores(true)}
          onSettings={() => setSettingsTab('Audio')}
          onHelp={() => setSettingsTab('Controls')}
        />
      )}
      {screen === 'servers' && <ServerBrowser servers={shownServers} online={online} refreshing={refreshing} onRefresh={refresh} onJoin={(s) => (s.hosted ? setScreen('lobby') : join(s))} onBack={() => setScreen('menu')} />}
      {screen === 'custom' && (
        <CustomGame
          key={editing ? 'edit' : 'new'}
          initial={editing && lobby ? lobby.config : defaultLobby(settings.name)}
          editing={editing}
          settings={settings}
          onSettings={setSettings}
          onBack={() => setScreen(editing && lobby ? 'lobby' : 'menu')}
          onSubmit={(c) => {
            if (editing && lobby) {
              setLobbyState({
                ...lobby,
                config: c,
                // a new "random" pick is rolled when the map setting changes to random
                resolved: c.map === 'random' ? LEVEL_IDS[Math.floor(Math.random() * LEVEL_IDS.length)] : lobby.resolved,
                members: reconcileMembers(lobby.members, c),
              });
            } else setLobbyState(newLobby(c, settings.name));
            setScreen('lobby');
          }}
        />
      )}
      {screen === 'lobby' && lobby && (
        <LobbyRoom
          lobby={lobby}
          setLobby={setLobby}
          onJoin={joinMap}
          onEdit={() => { setEditing(true); setScreen('custom'); }}
          onClose={() => { setLobbyState(null); setScreen('menu'); }}
        />
      )}
      {screen === 'game' && session && (
        <GameView
          key={session.key}
          server={session.server}
          bots={session.bots}
          settings={settings}
          onSettings={setSettings}
          touch={touch}
          onLeave={leave}
          onServers={toServers}
          onLobby={session.server.hosted ? toLobby : undefined}
          joining={!session.server.hosted}
          warmup={!!session.server.hosted}
          config={session.server.hosted ? lobby?.config : undefined}
          onConfig={session.server.hosted ? updateConfig : undefined}
          fakeProfiles={
            session.server.hosted
              ? (lobby?.members ?? []).filter((m) => !m.host).map((m) => ({ name: m.name, region: m.region ?? lobby?.config.region }))
              : session.server.roster.map((r) => ({ name: r.name, region: r.region, skill: r.skill, frustration: r.frustration, kills: r.kills, deaths: r.deaths, score: r.score }))
          }
          botCount={session.server.hosted && lobby ? opponentCount(lobby) : session.server.players}
        />
      )}
      {scores && <Leaderboard onClose={() => setScores(false)} />}
      {settingsTab && screen !== 'game' && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsTab(null)} initialTab={settingsTab} />}
    </div>
  );
}
