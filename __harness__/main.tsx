/**
 * Visual-regression fixture harness: mounts every UI surface with fixed props so
 * screenshots can be compared against the pre-React-removal baseline.
 *
 * Build it with `npm run harness` and open /__harness__/index.html?fixture=<name>.
 * It is never part of the shipped bundle (vite.config.ts only builds index.html).
 */
import '../src/index.css';
import { Menu } from '@/ui/Menu';
import { SettingsPanel } from '@/ui/SettingsPanel';
import { Leaderboard } from '@/ui/Leaderboard';
import { ServerBrowser } from '@/ui/ServerBrowser';
import { CustomGame } from '@/ui/CustomGame';
import { LobbyRoom } from '@/ui/LobbyRoom';
import { MapDetails } from '@/ui/MapDetails';
import { CheatsEditor } from '@/ui/Cheats';
import { Hud } from '@/ui/Hud';
import { TouchControls } from '@/ui/TouchControls';
import { ConnectingOverlay, DeployOverlay, GameOverOverlay, PauseOverlay } from '@/ui/Overlays';
import { HostOptions } from '@/ui/HostOptions';
import { Btn, Chip, Logo, Panel, Segmented, Slider, Toggle, MapPreview } from '@/ui/kit';
import { errorScreen } from '@/ui/ErrorScreen';
import { NO_CHEATS, type Settings } from '@/game/types';
import * as F from './fixtures';

function Shell(props: { children: Node }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-ink font-body text-white">
      <div className="synth-bg">
        <div className="synth-stars" />
        <div className="synth-sun" />
        <div className="synth-grid" />
      </div>
      <div className="scanlines absolute inset-0 pointer-events-none" />
      {props.children}
    </div>
  );
}

function KitchenSink(props: { settings: Settings }) {
  return (
    <Shell>
      <div className="absolute inset-0 nscroll overflow-y-auto p-6">
        <div className="flex flex-col gap-4">
          <Logo />
          <Panel title="Panel title" onClose={() => {}} right={<Chip color="#ff3b5c">right</Chip>}>
            <div className="p-4">
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => {}}>Primary</Btn>
                <Btn variant="cyan" onClick={() => {}}>Cyan</Btn>
                <Btn variant="yellow" onClick={() => {}}>Yellow</Btn>
                <Btn variant="ghost" onClick={() => {}}>Ghost</Btn>
                <Btn variant="danger" back onClick={() => {}}>Danger</Btn>
                <Btn size="sm" onClick={() => {}}>Small</Btn>
                <Btn size="lg" onClick={() => {}}>Large</Btn>
                <Btn disabled onClick={() => {}}>Disabled</Btn>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip>Default chip</Chip>
                <Chip color="#ffe14d">Yellow chip</Chip>
                <Chip color="#ff3b5c">Red chip</Chip>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Slider label="Master volume" value={0.65} min={0} max={1} onChange={() => {}} format={(v) => Math.round(v * 100) + '%'} />
                <Slider label="Cyan slider" value={0.4} min={0.5} max={1} step={0.05} onChange={() => {}} format={(v) => Math.round(v * 100) + '%'} color="#2de2ff" />
                <Toggle label="Toggle on" value onChange={() => {}} hint="A helpful hint" />
                <Toggle label="Toggle off" value={false} onChange={() => {}} />
                <Segmented label="Segmented" value={2} onChange={() => {}} options={[{ v: 0, label: 'Off' }, { v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }]} />
                <Segmented label="Coloured" value="tdm" onChange={() => {}} options={[{ v: 'ffa', label: 'Deathmatch', color: '#ff2d95' }, { v: 'tdm', label: 'Team Deathmatch', color: '#2de2ff' }]} />
              </div>
              <div className="mt-3 max-w-xs">
                <MapPreview level={F.level} size={220} />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}

function HudFixture(props: { board: boolean; touch: boolean }) {
  return (
    <div className="absolute inset-0 bg-black">
      {Hud({
        engine: F.fakeEngine() as never,
        hud: F.hud,
        settings: F.settings,
        touch: props.touch,
        feed: F.feed as never,
        chat: F.chat as never,
        announce: F.announce as never,
        hit: F.hitMarker as never,
        toast: F.toast as never,
        board: props.board,
      }).root}
    </div>
  );
}

function render(name: string): Node {
  const key = name.replace(/-mobile$|-tablet$/, '');
  switch (key) {
    case 'menu':
      return (
        <Shell>
          {Menu({
            settings: F.settings,
            onName: () => {},
            onQuick: () => {},
            online: 12384,
            onServers: () => {},
            onCustom: () => {},
            hosting: true,
            onScores: () => {},
            onSettings: () => {},
            onHelp: () => {},
          }).root}
        </Shell>
      );
    case 'settings-audio':
    case 'settings':
    case 'settings-graphics':
    case 'settings-controls':
    case 'settings-gameplay':
      return (
        <Shell>
          {SettingsPanel({ settings: F.settings, onChange: () => {}, onClose: () => {}, initialTab: 'Audio' }).root}
        </Shell>
      );
    case 'leaderboard':
      return <Shell>{Leaderboard({ onClose: () => {} }).root}</Shell>;
    case 'servers':
      return (
        <Shell>
          {ServerBrowser({ servers: F.servers, online: 12384, refreshing: false, onRefresh: () => {}, onJoin: () => {}, onBack: () => {} }).root}
        </Shell>
      );
    case 'custom':
      return (
        <Shell>
          {CustomGame({ initial: F.lobbyConfig, onSubmit: () => {}, onBack: () => {} }).root}
        </Shell>
      );
    case 'lobby':
      return (
        <Shell>
          {LobbyRoom({ lobby: F.hostedLobby, setLobby: () => {}, onStart: () => {}, onWarmup: () => {}, onEdit: () => {}, onClose: () => {} }).root}
        </Shell>
      );
    case 'mapdetails':
      return <Shell>{MapDetails({ level: F.level, onClose: () => {} }).root}</Shell>;
    case 'cheats':
      return (
        <Shell>
          <div className="absolute inset-0 p-6">
            <div className="cut glass neon-border p-4">
              {CheatsEditor({ value: { ...NO_CHEATS, god: true, aimbot: true }, onChange: () => {} })}
            </div>
          </div>
        </Shell>
      );
    case 'kit':
      return <KitchenSink settings={F.settings} />;
    case 'hud':
      return <HudFixture board={false} touch={TOUCH} />;
    case 'hud-scoreboard':
      return <HudFixture board touch={TOUCH} />;
    case 'touch':
      return (
        <div className="absolute inset-0 bg-black">
          {TouchControls({ input: F.fakeInput() as never, onPause: () => {}, onBoard: () => {} }).root}
        </div>
      );
    case 'overlay-deploy':
      return <Shell>{DeployOverlay({ server: F.servers[0], touch: false, onDeploy: () => {} }).root}</Shell>;
    case 'overlay-pause':
      return (
        <Shell>
          {PauseOverlay({ server: F.servers[0], warmup: true, onResume: () => {}, onStartMatch: () => {}, onRestart: () => {}, onSettings: () => {}, onLeave: () => {}, onHost: () => {} }).root}
        </Shell>
      );
    case 'overlay-gameover':
      return (
        <Shell>
          {GameOverOverlay({ result: F.matchResult, server: F.servers[0], placed: 2, top: F.scores, onRestart: () => {}, onServers: () => {}, onMenu: () => {} }).root}
        </Shell>
      );
    case 'overlay-connecting':
      return <Shell>{ConnectingOverlay({ server: F.servers[0], name: 'NEON_PILOT', onDone: () => {} }).root}</Shell>;
    case 'hostoptions':
      return (
        <Shell>
          {HostOptions({
            engine: F.fakeEngine() as never,
            cheatsAllowed: true,
            onCheatsAllowed: () => {},
            onCheats: () => {},
            onMapChange: () => {},
            onClose: () => {},
          }).root}
        </Shell>
      );
    case 'error':
      return errorScreen('Renderer crashed in the harness');
    default:
      return document.createDocumentFragment();
  }
}

F.seedStorage();
const params = new URLSearchParams(location.search);
const name = params.get('fixture') ?? 'menu';
const TOUCH = params.get('touch') === '1';
document.getElementById('root')!.appendChild(render(name));
