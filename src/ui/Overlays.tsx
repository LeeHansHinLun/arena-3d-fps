import type { MatchResult } from '@/game/engine';
import { DIFFS, MODES, MUTATORS, fmtTime, type ScoreEntry, type ServerInfo } from '@/game/types';
import { levelLabel } from '@/game/servers';
import { Btn, Chip, Modal, Panel, cx } from './kit';
import { ScoreTable } from './Leaderboard';
import { component, listen } from './dom';
import { useEffect, useState } from './hooks';
import type { View } from './dom';

export function RuleChips(props: { server: ServerInfo }) {
  const r = props.server.rules;
  const unit =
    MODES[r.mode].unit === 'captures'
      ? 'Capture limit'
      : MODES[r.mode].unit === 'points'
        ? 'Point limit'
        : MODES[r.mode].unit === 'bounties'
          ? 'Bounty limit'
          : MODES[r.mode].unit === 'waves'
            ? 'Wave limit'
            : r.mode === 'tdm'
              ? 'Team limit'
              : 'Frag limit';
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      <Chip color={MODES[r.mode].color}>{MODES[r.mode].name}</Chip>
      <Chip color="#ffe14d">{unit} {r.scoreLimit === 0 ? '∞' : r.scoreLimit}</Chip>
      <Chip color="#2de2ff">{r.timeLimit === 0 ? '∞ Time' : fmtTime(r.timeLimit)}</Chip>
      <Chip color={DIFFS[r.difficulty].color}>Skill · {DIFFS[r.difficulty].name}</Chip>
      {r.mutator !== 'none' && <Chip color="#a26bff">{MUTATORS[r.mutator].name}</Chip>}
    </div>
  );
}

/* ----------------------------------------------------------- connecting */
const STEPS = ['Resolving host', 'Opening UDP socket', 'Handshake · protocol v4', 'Syncing map', 'Spawning you into the arena'];

export interface ConnectingOverlayProps {
  server: ServerInfo;
  name: string;
  onDone: () => void;
}

export function ConnectingOverlay(props: ConnectingOverlayProps): View<ConnectingOverlayProps> {
  return component<ConnectingOverlayProps>(props, () => {
    const { server, name, onDone } = props;
    const [step, setStep] = useState(0);
    useEffect(() => {
      const ids: number[] = [];
      STEPS.forEach((_, i) => ids.push(window.setTimeout(() => setStep(i + 1), 280 * (i + 1))));
      ids.push(window.setTimeout(onDone, 280 * STEPS.length + 250));
      return () => ids.forEach(clearTimeout);
    }, [onDone]);
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink p-4">
        <div className="synth-bg opacity-60" />
        <div className="cut glass neon-border relative w-full max-w-md p-6">
          <div className="font-display text-[10px] font-bold uppercase tracking-[0.35em] text-neon-cyan">Connecting</div>
          <div className="mt-1 truncate font-display text-xl font-black uppercase tracking-wider text-white">{server.name}</div>
          <div className="font-display text-xs text-white/50">{server.ip}:{server.port} · {server.region} · {server.ping} ms · {server.players}/{server.rules.maxPlayers} players</div>
          <div className="mt-4 space-y-1.5">
            {STEPS.map((s, i) => (
              <div key={s} className={cx('flex items-center gap-2 text-sm transition-opacity', i < step ? 'opacity-100' : 'opacity-25')}>
                <span className={cx('inline-block h-2 w-2', i < step ? 'bg-neon-green' : 'bg-white/30')} />
                <span className="font-semibold uppercase tracking-wider">
                  {s}
                  {i === 3 ? ` — ${levelLabel(server)}` : ''}
                  {i === 4 ? ` as ${name}` : ''}
                </span>
                {i === step && <span className="blink ml-auto text-neon-yellow">…</span>}
              </div>
            ))}
          </div>
          <div className="mt-4 h-1.5 w-full bg-line/60">
            <div className="h-full bg-gradient-to-r from-neon-pink to-neon-cyan transition-all duration-300" style={{ width: (step / STEPS.length) * 100 + '%' }} />
          </div>
          <div className="mt-3 text-xs italic text-white/50">MOTD: “{server.motd}”</div>
        </div>
      </div>
    );
  });
}

/* --------------------------------------------------------------- deploy */
export interface DeployOverlayProps {
  server: ServerInfo;
  touch: boolean;
  onDeploy: () => void;
}

export function DeployOverlay(props: DeployOverlayProps): View<DeployOverlayProps> {
  const view = component<DeployOverlayProps>(props, (p) => {
    const { server, touch, onDeploy } = p;
    return (
      <div className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-between bg-gradient-to-b from-ink/80 via-transparent to-ink/90 p-5 text-center" onClick={onDeploy}>
        <div className="pt-4">
          <div className="font-display text-[10px] font-bold uppercase tracking-[0.4em] text-neon-cyan">{levelLabel(server)}</div>
          <div className="mt-1 max-w-[90vw] truncate font-display text-2xl font-black uppercase tracking-wider text-white sm:text-4xl">{server.name}</div>
          <div className="mt-3"><RuleChips server={server} /></div>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="cut-sm bg-neon-pink px-8 py-4 font-display text-xl font-black uppercase tracking-[0.3em] text-white shadow-[0_0_40px_rgba(255,45,149,0.7)] animate-pulse sm:text-3xl">
            {touch ? 'Tap to deploy' : 'Click to deploy'}
          </div>
          <div className="max-w-xl text-xs uppercase tracking-[0.2em] text-white/60">
            {touch ? 'Left thumb: move · Right thumb: look · Slide, dash, peek and double-jump with the buttons' : 'WASD move · Shift sprint · Space jump (tap again mid-air!) · C slide · F dash · Q/E peek · R reload · 1-4 weapons'}
          </div>
        </div>
      </div>
    );
  });

  listen(view, window, 'keydown', (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key === 'Enter' || ev.code === 'Space') {
      ev.preventDefault();
      view.props.onDeploy();
    }
  });

  return view;
}

/* ---------------------------------------------------------------- pause */
export interface PauseOverlayProps {
  server: ServerInfo;
  warmup?: boolean;
  onResume: () => void;
  onStartMatch?: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onLeave: () => void;
  onHost?: () => void;
}

export function PauseOverlay(props: PauseOverlayProps): View<PauseOverlayProps> {
  return component<PauseOverlayProps>(props, (p) => {
    const { server, warmup, onResume, onStartMatch, onRestart, onSettings, onLeave, onHost } = p;
    const fs = () => {
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      } catch {
        /* ignore */
      }
    };
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/75 p-4 backdrop-blur-sm fade-in">
        <Panel title="Paused" className="w-full max-w-sm">
          <div className="p-5">
            <div className="mb-4 text-center">
              <div className="truncate font-display text-sm font-extrabold uppercase tracking-wider">{server.name}</div>
              <div className="mt-1 text-xs text-white/50">{server.ip}:{server.port} · {levelLabel(server)}</div>
            </div>
            <div className="flex flex-col gap-2.5">
              <Btn size="lg" onClick={onResume}>Resume</Btn>
              {warmup && onStartMatch && <Btn variant="primary" onClick={onStartMatch}>▶ Start match</Btn>}
              {onHost && <Btn variant="cyan" onClick={onHost}>★ Host options</Btn>}
              <Btn variant="yellow" onClick={onRestart}>{warmup ? 'Respawn warmup' : 'Restart match'}</Btn>
              <div className="grid grid-cols-2 gap-2.5">
                <Btn variant="ghost" onClick={onSettings}>Settings</Btn>
                <Btn variant="ghost" onClick={fs}>Fullscreen</Btn>
              </div>
              <Btn variant="danger" back onClick={onLeave}>{onHost ? 'Back to lobby' : 'Leave server'}</Btn>
            </div>
            <div className="mt-4 text-center text-[10px] uppercase tracking-[0.25em] text-white/35">P / Esc to resume</div>
          </div>
        </Panel>
      </div>
    );
  });
}

/* ------------------------------------------------------------- game over */
export interface GameOverOverlayProps {
  result: MatchResult;
  server: ServerInfo;
  placed: number;
  top: ScoreEntry[];
  onRestart: () => void;
  onServers: () => void;
  onMenu: () => void;
  onLobby?: () => void;
}

export function GameOverOverlay(props: GameOverOverlayProps): View<GameOverOverlayProps> {
  return component<GameOverOverlayProps>(props, (p) => {
    const { result, server, placed, top, onRestart, onServers, onMenu, onLobby } = p;
    const draw = result.winnerName === 'DRAW';
    const tone = result.won ? '#7dff6b' : draw ? '#ffe14d' : '#ff3b5c';
    const kd = result.deaths ? (result.kills / result.deaths).toFixed(2) : result.kills.toFixed(2);
    const stats: [string, string | number][] = [
      ['Score', result.score.toLocaleString()],
      ['Frags', result.kills],
      ['Deaths', result.deaths],
      ['K/D', kd],
      ['Headshots', result.headshots],
      ['Accuracy', Math.round(result.accuracy * 100) + '%'],
      ['Best streak', result.bestStreak],
      ['Time', fmtTime(result.duration)],
    ];
    return (
      <Modal z={40}>
        <div className="cut glass neon-border pop-in flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden">
          <div className="shrink-0 border-b border-line/70 px-5 py-4 text-center" style={{ background: `linear-gradient(180deg, ${tone}33, transparent)` }}>
            <div className="font-display text-4xl font-black uppercase tracking-[0.15em] sm:text-6xl" style={{ color: tone, textShadow: `0 0 28px ${tone}` }}>
              {result.won ? 'Victory' : draw ? 'Draw' : 'Defeat'}
            </div>
            <div className="mt-1 font-display text-[11px] font-bold uppercase tracking-[0.3em] text-white/70">
              {result.winnerName.startsWith('WAVE') ? `Reached ${result.winnerName}` : `${result.winnerName} wins`} · {result.reason === 'time' ? 'time limit' : result.reason === 'death' ? 'overrun' : 'score limit'} · you placed #{result.rank} of {result.total}
            </div>
            {result.cheated && (
              <div className="mx-auto mt-2 inline-block cut-sm bg-neon-red px-4 py-1 font-display text-xs font-black uppercase tracking-[0.25em] text-white">
                Cheats active · recorded on Cheats leaderboard{placed > 0 ? ` (#${placed})` : ''}
              </div>
            )}
            {!result.cheated && placed > 0 && placed <= 10 && (
              <div className="mx-auto mt-2 inline-block cut-sm bg-neon-yellow px-4 py-1 font-display text-xs font-black uppercase tracking-[0.25em] text-ink">
                {placed === 1 ? '★ New personal best ★' : `New high score · rank #${placed}`}
              </div>
            )}
          </div>
          <div className="nscroll grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
            <div>
              <div className="grid grid-cols-4 gap-px bg-line/40 text-center">
                {stats.map(([l, v]) => (
                  <div key={l} className="bg-panel/90 py-2">
                    <div className="font-display text-base font-extrabold text-neon-cyan sm:text-lg">{v}</div>
                    <div className="text-[9px] uppercase tracking-[0.18em] text-white/50">{l}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-white/50">Final standings</div>
              <table className="mt-1 w-full text-sm">
                <tbody>
                  {result.rows.slice(0, 8).map((r, i) => (
                    <tr key={r.id} className={cx('border-t border-line/30', r.isPlayer && 'bg-neon-pink/20 font-bold')}>
                      <td className="w-7 px-2 py-1 font-display text-xs text-white/50">{i + 1}</td>
                      <td className="py-1">
                        {result.teamplay && <span className="mr-2 inline-block h-2 w-2" style={{ background: r.team === 0 ? '#2de2ff' : '#ff2d95' }} />}
                        {r.name}
                      </td>
                      <td className="px-2 py-1 text-right font-display">{r.kills}</td>
                      <td className="px-2 py-1 text-right font-display text-white/50">{r.deaths}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="font-display text-[10px] font-bold uppercase tracking-[0.25em] text-white/50">
                {result.cheated ? 'Local high scores (Cheats)' : 'Local high scores'}
              </div>
              <div className="nscroll mt-1 max-h-72 overflow-auto bg-panel/50">
                <ScoreTable rows={top} highlight={placed} limit={8} />
              </div>
              <div className="mt-2 text-[11px] text-white/40">{server.name} · {levelLabel(server)}</div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t border-line/70 p-4">
            <Btn size="lg" onClick={onRestart}>Play again <span className="opacity-70">(R)</span></Btn>
            {onLobby ? <Btn variant="cyan" onClick={onLobby}>Back to lobby</Btn> : <Btn variant="cyan" onClick={onServers}>Server list</Btn>}
            <Btn variant="ghost" back onClick={onMenu}>Main menu</Btn>
          </div>
        </div>
      </Modal>
    );
  });
}
