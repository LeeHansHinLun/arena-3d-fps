import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '@/game/audio';
import { detectTouch, loadSettings, saveSettings } from '@/game/storage';
import { ServerSim } from '@/game/serverSim';
import { randomPlayerName } from '@/game/names';
import { pingFor } from '@/game/serverSim';
import type { ServerInfo, Settings } from '@/game/types';
import { Menu } from '@/ui/Menu';
import { ServerBrowser } from '@/ui/ServerBrowser';
import { CustomGame, defaultLobby } from '@/ui/CustomGame';
import { LobbyRoom, lobbyOpponents, lobbyToServer, newLobby, type HostedLobby } from '@/ui/LobbyRoom';
import { LEVEL_IDS } from '@/game/types';
import { Leaderboard } from '@/ui/Leaderboard';
import { SettingsPanel } from '@/ui/SettingsPanel';
import { GameView } from '@/ui/GameView';

type Screen = 'menu' | 'servers' | 'custom' | 'lobby' | 'game';
interface Session {
  server: ServerInfo;
  bots: number;
  warmup?: boolean;
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
    const pool = servers.filter((s) => s.players < s.rules.maxPlayers && s.ping < 200);
    const list = pool.length ? pool : servers.filter((s) => s.players < s.rules.maxPlayers);
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

  const lobbyRef = useRef<HostedLobby | null>(null);
  lobbyRef.current = lobby;
  const startLobby = useCallback(() => {
    const l = lobbyRef.current;
    if (!l) return;
    setSession({ server: lobbyToServer(l), bots: l.members.length - 1, warmup: false, key: ++keyRef.current });
    setScreen('game');
  }, []);

  const startWarmup = useCallback(() => {
    const l = lobbyRef.current;
    if (!l) return;
    const fakeCount = l.members.filter((m) => !m.bot && !m.host).length;
    setSession({ server: lobbyToServer(l), bots: fakeCount, warmup: true, key: ++keyRef.current });
    setScreen('game');
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
  const shownServers = useMemo(() => (lobby && lobby.config.isPublic ? [lobbyToServer(lobby), ...servers] : servers), [lobby, servers]);

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
          onBack={() => setScreen(editing ? 'lobby' : 'menu')}
          onSubmit={(c) => {
            if (editing && lobby) {
              const keep = lobby.members.filter((m) => m.host || m.bot || m.invited || !c.password).slice(0, c.maxPlayers);
              setLobbyState({
                ...lobby,
                config: c,
                resolved: c.map === 'random' ? LEVEL_IDS[Math.floor(Math.random() * LEVEL_IDS.length)] : lobby.resolved,
                members: keep.map((m) => (m.host || m.bot ? m : { ...m, ping: pingFor(c.region, m.region ?? c.region) })),
              });
            }
            else setLobbyState(newLobby(c, settings.name));
            setScreen('lobby');
          }}
        />
      )}
      {screen === 'lobby' && lobby && (
        <LobbyRoom
          lobby={lobby}
          setLobby={setLobby}
          onStart={startLobby}
          onWarmup={startWarmup}
          onEdit={() => { setEditing(true); setScreen('custom'); }}
          onClose={() => { setLobbyState(null); setScreen('menu'); }}
        />
      )}
      {screen === 'game' && session && (
        <GameView
          key={session.key}
          server={session.server}
          bots={session.bots}
          warmup={session.warmup}
          settings={settings}
          onSettings={setSettings}
          touch={touch}
          fakeProfiles={session.server.hosted
            ? (lobby?.members ?? []).filter((m) => !m.bot && !m.host).map((m) => ({ name: m.name, region: m.region }))
            : session.server.roster.map((r) => ({ name: r.name, region: r.region, skill: r.skill, frustration: r.frustration }))}
          botCount={session.server.hosted && lobby ? lobbyOpponents(lobby) : session.server.players}
          onLeave={leave}
          onServers={toServers}
          onLobby={session.server.hosted ? toLobby : undefined}
          onCheats={session.server.hosted ? (allowed, c) => setLobby((l) => ({ ...l, config: { ...l.config, cheatsOn: allowed, cheats: c } })) : undefined}
          onMapChange={
            session.server.hosted
              ? (lvl, gen) =>
                  setLobby((l) => ({
                    ...l,
                    config: {
                      ...l.config,
                      map: lvl,
                      gen: gen ? { ...l.config.gen, ...gen } : l.config.gen,
                    },
                  }))
              : undefined
          }
        />
      )}
      {scores && <Leaderboard onClose={() => setScores(false)} />}
      {settingsTab && screen !== 'game' && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsTab(null)} initialTab={settingsTab} />}
    </div>
  );
}
