import * as THREE from 'three';
import { audio, type Sfx } from './audio';
import { Input } from './input';
import { getLevel, mulberry32, type LevelData, type Theme } from './levels';
import { buildLevelObjects, renderLevelMap, type LevelMap, type LevelObjects } from './levelMesh';
import { World, rayAABB, raySphere, type RayHit } from './world';
import { Nav } from './nav';
import { Blasts, Decals, Particles, Tracers } from './fx';
import { WEAPONS, WEAPON_ORDER, buildViewModel, type ViewModel, type WeaponDef } from './weapons';
import { BotView, Fighter, newAI } from './fighter';
import { updateBot, type AICtx, type PickupLite } from './ai';
import { DIFF_PARAMS, NO_CHEATS, isTeamMode, type Cheats, type Difficulty, type LevelId, type ModeId, type Rules, type ServerInfo, type Settings, type WeaponId } from './types';
import { pingFor, userPingTo } from './serverSim';
import { PostPipeline } from './post';
import { chatLine, genBotName, genPlayerName, pickOf, type ChatKind } from './names';

export type EngineState = 'intro' | 'playing' | 'paused' | 'over';

export interface HudState {
  hp: number;
  armor: number;
  ammo: number;
  mag: number;
  reload: number;
  weapon: WeaponId;
  weaponName: string;
  weapons: { id: WeaponId; name: string; ammo: number; mag: number }[];
  cur: number;
  dash: number;
  speed: number;
  timeLeft: number;
  scoreLimit: number;
  mode: ModeId;
  myKills: number;
  deaths: number;
  streak: number;
  points: number;
  leaderName: string;
  leaderKills: number;
  teamScores: [number, number];
  myTeam: number;
  rank: number;
  total: number;
  alive: boolean;
  respawnIn: number;
  killer: string;
  fps: number;
  ping: number;
  aiming: boolean;
  sliding: boolean;
  protect: boolean;
  airJumps: number;
  cheats: boolean;
  assist: boolean;
  modeName: string;
  hill: boolean;
  hillOwner: string;
  wave: number;
  bounty: string;
  flagStatus: string;
  fakeCount: number;
  timeLimit: number;
  leaderScore: number;
  bountyRel: number | null;
  bountyDist: number;
  warmup: boolean;
}

export type GameEvent =
  | { type: 'kill'; killer: string; victim: string; weapon: string; headshot: boolean; killerTeam: number; victimTeam: number; mine: 'killer' | 'victim' | null }
  | { type: 'chat'; name: string; text: string; team: number; system?: boolean }
  | { type: 'announce'; text: string; sub?: string; points?: number; tone: 'good' | 'bad' | 'info' | 'streak' }
  | { type: 'hitmarker'; head: boolean; kill: boolean }
  | { type: 'pickup'; text: string; color: string }
  | { type: 'scoreboard'; show: boolean };

export interface ScoreRow {
  id: number;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  isPlayer: boolean;
  alive: boolean;
}

export interface MatchResult {
  id: number;
  won: boolean;
  rank: number;
  total: number;
  score: number;
  kills: number;
  deaths: number;
  headshots: number;
  accuracy: number;
  bestStreak: number;
  duration: number;
  rows: ScoreRow[];
  winnerName: string;
  teamplay: boolean;
  myTeam: number;
  teamScores: [number, number];
  reason: 'limit' | 'time' | 'death';
  cheated: boolean;
}

export interface EngineHandlers {
  onHud(h: HudState): void;
  onEvent(e: GameEvent): void;
  onState(s: EngineState): void;
  onOver(r: MatchResult): void;
}

export interface FakeProfile {
  name: string;
  region?: string;
  skill?: Difficulty;
  frustration?: number;
}

export interface EngineOptions {
  container: HTMLElement;
  server: ServerInfo;
  bots: number;
  settings: Settings;
  touch: boolean;
  handlers: EngineHandlers;
  fakeProfiles?: FakeProfile[];
  botCount?: number;
  warmup?: boolean;
}

const R = 0.3;
const STAND_H = 1.8;
const CROUCH_H = 1.15;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.0;
const WALK = 7;
const SPRINT = 10.6;
const CROUCH_SPEED = 3.6;
const JUMP_V = 8.8;
const TEAM_COLORS = [0x2de2ff, 0xff2d95];
const BOT_COLORS = [0xff9a3c, 0xb26bff, 0x7dff6b, 0xffe14d, 0xff6ec7, 0x4dffd2, 0xff5a3c, 0x6b8cff, 0xe0e0ff, 0xff4d6d];
const TAU = Math.PI * 2;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function angDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

interface Pickup extends PickupLite {
  t: number;
  group: THREE.Group;
}
interface Rocket {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  owner: Fighter;
  age: number;
  mesh: THREE.Mesh;
  active: boolean;
}
interface FHit {
  f: Fighter;
  t: number;
  head: boolean;
}

/** free geometry + materials of an object tree (shared textures are left alone) */
function freeObject(o: THREE.Object3D) {
  const m = o as THREE.Mesh;
  m.geometry?.dispose();
  const mt = m.material as THREE.Material | THREE.Material[] | undefined;
  if (mt) (Array.isArray(mt) ? mt : [mt]).forEach((x) => x.dispose());
}

export class Engine {
  // three
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  wScene = new THREE.Scene();
  wCam: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  sunDir = new THREE.Vector3();
  levelObjs: LevelObjects;
  fx: { particles: Particles; tracers: Tracers; decals: Decals; blasts: Blasts };
  vmRoot = new THREE.Group();
  vms: ViewModel[] = [];
  vmAll: Partial<Record<WeaponId, ViewModel>> = {};
  rocketPool: Rocket[] = [];

  // data
  level: LevelData;
  world: World;
  nav: Nav;
  map: LevelMap;
  input = new Input();
  settings: Settings;
  server: ServerInfo;
  rules: Rules;
  handlers: EngineHandlers;
  touch: boolean;
  botTarget: number;
  fakeProfiles: FakeProfile[] = [];
  private fighterGrid = new Map<number, Fighter[]>();
  private hitPool: FHit[] = [];
  private hitCount = 0;
  private aimResult: { f: Fighter; yaw: number; pitch: number; ang: number; cone: number } | null = null;
  private aimT = 0;
  private scoreCache: ScoreRow[] = [];
  private scoreDirty = true;
  private weaponsCache: HudState['weapons'] = [];
  private digitKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  private keyCache: Record<string, boolean> = {};
  private lastSunX = 1e9;
  private lastSunZ = 1e9;
  private levelT = 0;
  private chatBudget = 0;
  private lowQuality = false;
  warmup = false;
  boardOpen = false;
  boardScroll = 0;
  minActiveAI = 6;
  private liveAIT = 0;
  // special modes
  mode: ModeId = 'ffa';
  get coOp(): boolean {
    return this.mode === 'survival';
  }
  get teamMode(): boolean {
    return this.teamplay || this.coOp;
  }
  hillPos = new THREE.Vector3();
  hillR = 6;
  private hillMesh: THREE.Group | null = null;
  private hillAcc = 0;
  wave = 1;
  private waveKills = 0;
  bountyId = -1;
  private bountyMarker: THREE.Mesh | null = null;
  private flags: { team: number; x: number; z: number; baseX: number; baseZ: number; carrier: Fighter | null; mesh: THREE.Group }[] = [];
  private flagT = 0;
  teamplay: boolean;
  insta: boolean;
  gravity: number;
  speedMul: number;
  diff = DIFF_PARAMS.normal;
  defs = {} as Record<WeaponId, WeaponDef>;
  spawnNodes: number[] = [];
  pickups: Pickup[] = [];
  pickupGeo: Record<string, THREE.BufferGeometry> = {};

  // state
  state: EngineState = 'intro';
  fighters: Fighter[] = [];
  player!: Fighter;
  matchId = 0;
  t = 0;
  time = 0;
  teamScore: [number, number] = [0, 0];
  over: { winner: string; reason: 'limit' | 'time' | 'death' } | null = null;
  fps = 60;
  trauma = 0;
  timeScale = 1;
  vfx = { damage: 0, heal: 0, flash: 0, speed: 0, low: 0, spread: 0.01, fov: 1.5, yaw: 0, indicators: [] as { ang: number; life: number }[] };
  private pm = 1;
  post: PostPipeline | null = null;
  private lights: { l: THREE.PointLight; t: number; dur: number; base: number }[] = [];
  private lightsOn = false;
  cheats: Cheats = { ...NO_CHEATS };
  cheated = false;
  extraTime = 0;
  private sunAngle = 0;
  private sunBase = new THREE.Vector3();
  aimTarget: Fighter | null = null;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private rayCol = new THREE.Color();
  private sunUv = new THREE.Vector2();
  private nextId = 1;
  private usedNames = new Set<string>();
  private rand = mulberry32(Date.now() & 0xffff);

  // runtime
  private raf = 0;
  private last = 0;
  private disposed = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lowFpsT = 0;
  private highFpsT = 0;
  private scaleAdapt = 1;
  private hudT = 0;
  private frameN = 0;
  private listeners: [EventTarget, string, EventListenerOrEventListenerObject, AddEventListenerOptions?][] = [];
  private locked = false;
  private lockedOnce = false;
  private noLock = false;
  private pendingPlay = false;
  private churnT = 30;
  private chatT = 20;
  private aiCtx!: AICtx;
  private hitFlag = false;
  private mouseDirty = false;
  private cameraDirty = true;
  private lastHudAlive = true;
  private espT = 0;
  private espCache: { x: number; y: number; h: number; name: string; d: number; hp: number; shootable: boolean }[] = [];
  private ro: ResizeObserver | null = null;
  private container: HTMLElement;
  private introAngle = Math.random() * 6;

  // player controller state
  P = {
    eye: EYE_STAND, bobPhase: 0, bobAmp: 0, landDip: 0, stepOff: 0, sliding: false, slideT: 0, slideCd: 0, crouchToggle: false,
    coyote: 0, jumpBuf: 0, airJumps: 1, wallJumps: 2, dashT: 0, dashCd: 0, dashX: 0, dashZ: 0, tilt: 0, fovPunch: 0, fovCur: 90,
    boostT: 0, jumped: false, aimT: 0, sprintT: 0, slideW: 0, kick: 0, recoil: 0, recoilYaw: 0, padCd: 0, deadT: 0, vmKick: 0, swayX: 0, swayY: 0,
    lastYaw: 0, lastPitch: 0, hv: 0, crouching: false, sprinting: false, stepCount: 0, killerYaw: 0, peek: 0,
  };
  W = { list: ['rifle', 'shotgun', 'rail', 'rocket'] as WeaponId[], cur: 0, ammo: [30, 6, 4, 4], fireCd: 0, reloadT: 0, reloadDur: 1, switchT: 0, bloom: 0, fireBuf: 0, flashT: 0 };

  constructor(opts: EngineOptions) {
    this.container = opts.container;
    this.settings = opts.settings;
    this.server = opts.server;
    this.rules = opts.server.rules;
    this.handlers = opts.handlers;
    this.touch = opts.touch;
    this.warmup = !!opts.warmup;
    this.mode = this.rules.mode;
    this.teamplay = isTeamMode(this.rules.mode);
    this.insta = this.rules.mode === 'insta';
    this.fakeProfiles = opts.fakeProfiles ?? opts.server.roster.map((r) => ({ name: r.name, region: r.region, skill: r.skill, frustration: r.frustration }));
    this.botTarget = Math.max(1, Math.min(opts.botCount ?? opts.bots, 120));
    this.gravity = this.rules.mutator === 'lowgrav' ? 10.5 : 24;
    this.speedMul = this.rules.mutator === 'turbo' ? 1.25 : 1;
    this.diff = DIFF_PARAMS[this.rules.difficulty];
    const s = this.settings;
    this.level = getLevel(opts.server.level, opts.server.gen);

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: s.antialias, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    this.container.appendChild(this.canvas);

    const th = this.level.theme;
    this.renderer.setClearColor(th.fog);
    this.scene.fog = new THREE.Fog(th.fog, 30, 200);
    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.06, 900);
    this.camera.rotation.order = 'YXZ';
    this.wCam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);

    // lights
    this.hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, 2.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(th.lightColor, 3.4);
    this.sunDir.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
    this.sunBase.copy(this.sunDir);
    this.rayCol.setHex(th.sunColor);
    if (this.rules.cheats) this.cheats = { ...this.rules.cheats };
    this.cheated = Object.values(this.cheats).some(Boolean);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.wScene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.6));
    const wd = new THREE.DirectionalLight(0xffffff, 3);
    wd.position.set(1, 2, 2);
    this.wScene.add(wd);

    // level
    this.levelObjs = buildLevelObjects(this.level, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.levelObjs.group);
    this.world = new World(this.level.boxes);
    this.nav = new Nav(this.world, this.level.w, this.level.d);
    this.map = renderLevelMap(this.level, 256);
    this.fx = {
      particles: new Particles(this.scene, 1000),
      tracers: new Tracers(this.scene),
      decals: new Decals(this.scene),
      blasts: new Blasts(this.scene),
    };
    this.setupPickups();
    this.setupRockets();

    // viewmodels
    this.vmRoot.position.set(0.2, -0.19, -0.42);
    this.wScene.add(this.vmRoot);
    // viewmodels are built lazily on first switch (only the starting weapon up front)

    this.buildDefs();
    this.buildAICtx();
    this.applySettings(s);
    this.bind();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
    this.setState('intro');
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ============================================================ setup helpers */
  private buildDefs() {
    const turbo = this.rules.mutator === 'turbo';
    for (const id of WEAPON_ORDER) {
      const d = { ...WEAPONS[id] };
      if (turbo) {
        d.interval *= 0.8;
        d.reload *= 0.7;
      }
      if (this.insta && id === 'rail') {
        d.dmg = 1000;
        d.interval = turbo ? 0.65 : 0.8;
        d.mag = 999;
        d.reload = 0;
        d.pierce = 1;
      }
      this.defs[id] = d;
    }
  }

  private buildAICtx() {
    this.aiCtx = {
      world: this.world,
      nav: this.nav,
      fighters: this.fighters,
      time: 0,
      diff: this.diff,
      gravity: this.gravity,
      speedMul: this.speedMul,
      insta: this.insta,
      mode: this.mode,
      warmup: this.warmup,
      hill: { x: 0, z: 0, r: this.hillR },
      pickups: this.pickups,
      isEnemy: (a, b) => a !== b && (!this.teamMode || a.team !== b.team),
      fire: (f, t, w) => {
        if (!this.cheats.botsPassive) this.botFire(f, t, w);
      },
    };
  }

  private setupPickups() {
    const rnd = mulberry32(777);
    const ids = this.nav.spread(11, rnd, 0, 8, 6);
    const hGeoA = new THREE.BoxGeometry(0.5, 0.16, 0.16);
    const hGeoB = new THREE.BoxGeometry(0.16, 0.5, 0.16);
    const aGeo = new THREE.OctahedronGeometry(0.34, 0);
    const ringGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.05, 16);
    const beamGeo = new THREE.CylinderGeometry(0.55, 0.7, 3, 10, 1, true);
    ids.forEach((id, i) => {
      const n = this.nav.nodes[id];
      const type: 'health' | 'armor' = i % 3 === 0 ? 'armor' : 'health';
      const col = type === 'health' ? 0x7dff6b : 0x2de2ff;
      const g = new THREE.Group();
      g.position.set(n.x, n.y, n.z);
      const core = new THREE.Group();
      core.name = 'core';
      if (type === 'health') {
        const m = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
        core.add(new THREE.Mesh(hGeoA, m), new THREE.Mesh(hGeoB, m));
      } else core.add(new THREE.Mesh(aGeo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false })));
      core.position.y = 0.95;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, toneMapped: false }));
      ring.position.y = 0.04;
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = 1.5;
      g.add(core, ring, beam);
      this.scene.add(g);
      this.pickups.push({ x: n.x, y: n.y, z: n.z, type, active: true, t: 0, group: g });
    });
  }

  private setupRockets() {
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb040, toneMapped: false });
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.rocketPool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null as unknown as Fighter, age: 0, mesh, active: false });
    }
  }

  applySettings(s: Settings) {
    this.settings = s;
    const r = this.renderer;
    const enabled = s.shadows > 0;
    if (r.shadowMap.enabled !== enabled) {
      r.shadowMap.enabled = enabled;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    const stype = [THREE.BasicShadowMap, THREE.PCFShadowMap, THREE.VSMShadowMap][s.shadowSoftness] ?? THREE.PCFShadowMap;
    if (r.shadowMap.type !== stype) {
      r.shadowMap.type = stype;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    this.sun.shadow.radius = s.shadowSoftness === 2 ? 6 : s.shadowSoftness === 1 ? 2.5 : 1;
    this.sun.shadow.blurSamples = 10;
    this.sun.shadow.bias = s.shadowSoftness === 2 ? -0.0002 : -0.0005;
    this.sun.castShadow = enabled;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.needsUpdate = true;
    r.toneMappingExposure = s.exposure;
    if (s.post && !this.post) this.post = new PostPipeline(r, s.antialias);
    else if (!s.post && this.post) {
      this.post.dispose();
      this.post = null;
    }
    if (s.dynamicLights !== this.lightsOn) {
      this.lightsOn = s.dynamicLights;
      if (this.lightsOn && !this.lights.length) {
        for (let i = 0; i < 4; i++) {
          const l = new THREE.PointLight(0xffffff, 0, 16, 1.6);
          l.visible = true;
          this.scene.add(l);
          this.lights.push({ l, t: 0, dur: 1, base: 0 });
        }
      } else if (!this.lightsOn) {
        this.lights.forEach((x) => this.scene.remove(x.l));
        this.lights = [];
      }
    }
    const size = [512, 512, 1024, 2048][s.shadows];
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const half = [30, 30, 38, 46][s.shadows];
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog;
    const vd = [[18, 110], [30, 190], [45, 330]][s.viewDistance];
    const haze = 1.6 - s.atmosphere * 1.1;
    fog.near = vd[0] * haze;
    fog.far = vd[1] * haze;
    this.pm = [0.4, 0.7, 1][s.particles];
    this.fx.particles.cap = [260, 520, 1000][s.particles];
    audio.setVolumes(s.masterVol, s.sfxVol, s.musicVol);
    if (this.container) this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sc = this.settings.renderScale * this.scaleAdapt;
    this.renderer.setPixelRatio(1);
    const bw = Math.floor(w * dpr * sc), bh = Math.floor(h * dpr * sc);
    this.renderer.setSize(bw, bh, false);
    this.post?.setSize(bw, bh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wCam.aspect = w / h;
    this.wCam.updateProjectionMatrix();
  }

  private adapt() {
    if (!this.settings.adaptive || this.state !== 'playing') {
      this.lowFpsT = 0;
      this.highFpsT = 0;
      return;
    }
    if (this.fps < 48) {
      this.lowFpsT += 0.5;
      this.highFpsT = 0;
      if (this.lowFpsT >= 1.5 && this.scaleAdapt > 0.55) {
        this.scaleAdapt = Math.max(0.55, this.scaleAdapt - 0.1);
        this.lowFpsT = 0;
        if (this.scaleAdapt < 0.8 && !this.lowQuality) {
          this.lowQuality = true;
          this.fx.particles.cap = Math.min(this.fx.particles.cap, 320);
          this.sun.shadow.mapSize.set(512, 512);
          this.sun.shadow.map?.dispose();
          this.sun.shadow.map = null;
        }
        this.resize();
      }
    } else if (this.fps > 57 && this.scaleAdapt < 1) {
      this.highFpsT += 0.5;
      this.lowFpsT = 0;
      if (this.highFpsT >= 8) {
        this.scaleAdapt = Math.min(1, this.scaleAdapt + 0.05);
        this.highFpsT = 0;
        this.resize();
      }
    } else this.lowFpsT = 0;
  }

  /* ================================================================== events */
  private on(t: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opt?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opt);
    this.listeners.push([t, type, fn, opt]);
  }

  private bind() {
    this.on(window, 'keydown', ((e: KeyboardEvent) => this.onKey(e, true)) as EventListener);
    this.on(window, 'keyup', ((e: KeyboardEvent) => this.onKey(e, false)) as EventListener);
    this.on(document, 'mousemove', ((e: MouseEvent) => {
      if (this.state !== 'playing') return;
      if (!this.locked && !this.noLock) return;
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.input.mouseDX += e.movementX;
      this.input.mouseDY += e.movementY;
    }) as EventListener);
    this.on(this.canvas, 'mousedown', ((e: MouseEvent) => {
      if (this.state === 'playing' && (this.locked || this.noLock)) {
        this.input.mouseButton(e.button, true);
        e.preventDefault();
      }
    }) as EventListener);
    this.on(window, 'mouseup', ((e: MouseEvent) => this.input.mouseButton(e.button, false)) as EventListener);
    this.on(this.canvas, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
    this.on(window, 'wheel', ((e: WheelEvent) => {
      if (this.boardOpen && (this.state === 'playing' || this.state === 'over')) {
        e.preventDefault();
        this.boardScroll += e.deltaY;
        return;
      }
      if (this.state === 'playing') this.input.wheel += Math.sign(e.deltaY);
    }) as EventListener, { passive: false });
    this.on(document, 'pointerlockchange', (() => {
      const locked = document.pointerLockElement === this.canvas;
      this.locked = locked;
      if (locked) {
        this.lockedOnce = true;
        if (this.pendingPlay || this.state === 'paused') {
          this.pendingPlay = false;
          this.setState('playing');
        }
      } else {
        this.input.releaseAll();
        if (this.state === 'playing' && !this.touch) this.pause();
      }
    }) as EventListener);
    this.on(document, 'pointerlockerror', (() => this.onLockError()) as EventListener);
    this.on(window, 'blur', (() => {
      this.input.releaseAll();
      if (this.state === 'playing') this.pause();
    }) as EventListener);
    this.on(document, 'visibilitychange', (() => {
      if (document.hidden && this.state === 'playing') this.pause();
    }) as EventListener);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const code = e.code;
    const gameKeys = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if ((this.state === 'playing' || this.state === 'over') && gameKeys.includes(code)) e.preventDefault();
    if (code === 'Tab') {
      if (this.state === 'playing' || this.state === 'over') {
        this.boardOpen = down;
        this.handlers.onEvent({ type: 'scoreboard', show: down });
      }
      return;
    }
    if (!down) {
      this.input.keyUp(code);
      return;
    }
    if (this.state === 'over') {
      if (code === 'Enter' || code === 'KeyR') this.restart();
      return;
    }
    if (this.state === 'paused' && (code === 'KeyP' || code === 'Enter')) {
      this.resume();
      return;
    }
    if (this.state !== 'playing') return;
    if (e.repeat && code !== 'Space') return;
    if (code === 'KeyP' || (code === 'Escape' && this.noLock)) {
      this.pause();
      return;
    }
    this.input.keyDown(code);
  }

  private requestLock() {
    if (this.touch) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => this.onLockError());
    } catch {
      this.onLockError();
    }
  }

  /** If the browser refuses pointer lock while we want to play, fall back to unlocked mouse look. */
  private onLockError() {
    const wantPlay = this.pendingPlay || this.state === 'paused';
    this.pendingPlay = false;
    if (wantPlay) {
      this.noLock = true;
      this.setState('playing');
    }
  }

  private requestPlay() {
    if (this.touch || this.noLock) {
      this.setState('playing');
      return;
    }
    this.pendingPlay = true;
    this.requestLock();
    this.later(() => {
      if (this.pendingPlay && !this.disposed && !this.locked && !this.lockedOnce) {
        this.noLock = true;
        this.pendingPlay = false;
        this.setState('playing');
      }
    }, 900);
  }

  private setState(s: EngineState) {
    this.state = s;
    audio.setIntensity(s === 'playing' ? 1 : 0.5);
    this.handlers.onState(s);
  }

  /* ============================================================= public API */
  deploy() {
    audio.init();
    audio.startMusic();
    this.startMatch();
    this.requestPlay();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.input.releaseAll();
    this.boardOpen = false;
    this.handlers.onEvent({ type: 'scoreboard', show: false });
    this.state = 'paused';
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.setState('paused');
  }

  /** Transitions from pre-match warmup directly into a live match. */
  startMatchFromWarmup() {
    this.warmup = false;
    this.aiCtx.warmup = false;
    this.startMatch();
    if (this.state !== 'playing') this.requestPlay();
  }

  /** Applies a new theme to sky, fog, sun and level materials in-place without respawning players. */
  applyThemeOnly(th: Theme) {
    this.renderer.setClearColor(th.fog);
    (this.scene.fog as THREE.Fog).color.setHex(th.fog);
    this.hemi.color.setHex(th.hemiSky);
    this.hemi.groundColor.setHex(th.hemiGround);
    this.sun.color.setHex(th.lightColor);
    this.sunDir.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
    this.sunBase.copy(this.sunDir);
    this.rayCol.setHex(th.sunColor);
    this.levelObjs.applyTheme(th);
    this.sun.shadow.needsUpdate = true;
  }

  /**
   * Changes the arena or theme in-game. If only the theme changed on the same map layout,
   * updates the theme in place; if the map layout changed, rebuilds the arena, updates the theme,
   * and respawns all players.
   */
  setMapOrTheme(levelId: LevelId, gen?: ServerInfo['gen']) {
    const prevGen = this.server.gen;
    const sameLayout =
      this.server.level === levelId &&
      (levelId !== 'procedural' ||
        (prevGen?.seed === gen?.seed &&
          prevGen?.size === gen?.size &&
          prevGen?.w === gen?.w &&
          prevGen?.d === gen?.d &&
          prevGen?.style === gen?.style));
    this.server = { ...this.server, level: levelId, gen };
    const next = getLevel(levelId, gen);
    this.level = next;
    this.applyThemeOnly(next.theme);
    if (sameLayout) {
      this.map = renderLevelMap(next, 256);
      this.emit({ type: 'announce', text: `THEME · ${next.themeName ?? 'UPDATED'}`, sub: next.name, tone: 'info' });
      return;
    }
    this.scene.remove(this.levelObjs.group);
    this.levelObjs.dispose();
    this.levelObjs = buildLevelObjects(next, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.levelObjs.group);
    this.world = new World(next.boxes);
    this.nav = new Nav(this.world, next.w, next.d);
    this.map = renderLevelMap(next, 256);
    this.spawnNodes = [];
    this.pickups.forEach((p) => this.scene.remove(p.group));
    this.pickups = [];
    this.setupPickups();
    this.aiCtx.world = this.world;
    this.aiCtx.nav = this.nav;
    this.aiCtx.pickups = this.pickups;
    this.sun.shadow.needsUpdate = true;
    for (const f of this.fighters) {
      if (!f.gone) this.spawnFighter(f, true);
    }
    this.emit({ type: 'announce', text: next.name.toUpperCase(), sub: 'Map changed · all pilots respawned', tone: 'info' });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.input.releaseAll();
    if (this.touch || this.noLock) {
      this.setState('playing');
      return;
    }
    this.requestLock();
  }

  restart() {
    audio.init();
    this.startMatch();
    this.state = 'paused';
    this.requestPlay();
  }

  getScoreboard(): ScoreRow[] {
    if (!this.scoreDirty && this.scoreCache.length) return this.scoreCache;
    const byPoints = this.mode === 'koth' || this.mode === 'bounty' || this.mode === 'ctf';
    this.scoreCache = this.fighters
      .filter((f) => !f.gone && (!this.coOp || f.team === 0))
      .map((f) => ({ id: f.id, name: f.name, team: f.team, kills: f.kills, deaths: f.deaths, score: f.score, ping: Math.round(f.ping), isPlayer: f.isPlayer, alive: f.alive }))
      .sort(byPoints ? (a, b) => b.score - a.score || b.kills - a.kills : (a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score);
    this.scoreDirty = false;
    return this.scoreCache;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const [t, type, fn, opt] of this.listeners) t.removeEventListener(type, fn, opt);
    this.listeners = [];
    this.ro?.disconnect();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.post?.dispose();
    this.levelObjs.dispose();
    this.fighters.forEach((f) => f.view?.dispose());
    this.sun.shadow.map?.dispose();
    for (const m of [this.fx.particles.mesh, this.fx.tracers.mesh, this.fx.decals.mesh]) freeObject(m);
    (this.fx.decals.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
    this.fx.blasts.dispose();
    this.wScene.traverse(freeObject);
    this.renderer.dispose();
    // release the WebGL context now: browsers cap live contexts, and players join many matches
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  /* ============================================================ match setup */
  /** timers that never fire after dispose() */
  private later(fn: () => void, ms: number) {
    window.setTimeout(() => {
      if (!this.disposed) fn();
    }, ms);
  }

  private emit(e: GameEvent) {
    this.handlers.onEvent(e);
  }

  private startMatch() {
    this.matchId++;
    this.t = 0;
    this.timeScale = 1;
    this.over = null;
    this.extraTime = 0;
    this.cheated = Object.values(this.cheats).some(Boolean);
    this.teamScore = [0, 0];
    this.trauma = 0;
    this.fx.particles.clear();
    this.fx.tracers.clear();
    this.fx.decals.clear();
    this.fx.blasts.clear();
    this.rocketPool.forEach((r) => {
      r.active = false;
      r.mesh.visible = false;
    });
    for (const p of this.pickups) {
      p.active = true;
      p.group.visible = true;
    }
    this.fighters.forEach((f) => {
      if (f.view) {
        this.scene.remove(f.view.group);
        f.view.dispose();
      }
    });
    this.fighters.length = 0;
    this.usedNames.clear();
    this.nextId = 1;
    this.mode = this.rules.mode;
    this.aiCtx.warmup = this.warmup;
    const s = this.settings;
    const myTeam = this.coOp ? 0 : Math.random() < 0.5 ? 0 : 1;
    this.usedNames.add(s.name);
    const p = new Fighter(0, s.name || 'Player', this.teamMode ? myTeam : 0, true, this.teamMode ? TEAM_COLORS[myTeam] : 0xffffff, 'player');
    p.ping = this.server.hosted ? 5 : this.server.ping;
    this.player = p;
    this.fighters.push(p);
    const counts = [this.teamplay && myTeam === 0 ? 1 : 0, this.teamplay && myTeam === 1 ? 1 : 0];
    const nextTeam = () => {
      if (this.coOp) return 0;
      let team = 0;
      if (this.teamplay) {
        team = counts[0] <= counts[1] ? 0 : 1;
        counts[team]++;
      }
      return team;
    };
    const target = this.mode === 'duel' ? 1 : this.botTarget;
    for (const prof of this.fakeProfiles.slice(0, target)) this.fighters.push(this.makeFake(nextTeam(), prof.name, prof));
    let bi = 0;
    if (!this.warmup) {
      if (this.coOp) {
        const hordeCount = Math.max(6, Math.min(16, 4 + this.wave * 2));
        for (let i = 0; i < hordeCount; i++) this.fighters.push(this.makeBot(1, bi++));
      } else {
        while (this.fighters.length - 1 < target) this.fighters.push(this.makeBot(nextTeam(), bi++));
      }
    }
    this.wave = 1;
    this.waveKills = 0;
    this.bountyId = -1;
    this.aiCtx.bountyId = -1;
    this.hillAcc = 0;
    this.scoreDirty = true;
    this.scoreCache = [];
    if (this.hillMesh) {
      this.scene.remove(this.hillMesh);
      this.hillMesh = null;
    }
    if (this.bountyMarker) {
      this.scene.remove(this.bountyMarker);
      this.bountyMarker = null;
    }
    this.flags.forEach((f) => this.scene.remove(f.mesh));
    this.flags = [];
    if (!this.warmup) this.setupSpecialMode();
    this.aiCtx.fighters = this.fighters;
    for (const f of this.fighters) if (!f.isPlayer) this.spawnFighter(f, true);
    this.spawnFighter(p, true);
    // weapons
    this.W.list = this.insta ? ['rail'] : [...WEAPON_ORDER];
    this.W.cur = 0;
    this.W.ammo = this.W.list.map((id) => this.defs[id].mag);
    this.W.fireCd = 0.3;
    this.W.reloadT = 0;
    this.W.switchT = 0.3;
    this.W.bloom = 0;
    this.selectViewmodel();
    this.churnT = 25 + Math.random() * 25;
    this.chatT = 14 + Math.random() * 14;
    const pr = this.P;
    pr.crouchToggle = false;
    pr.dashCd = 0;
    const modeName = this.warmup
      ? 'PRE-MATCH WARMUP'
      : this.rules.mode === 'survival'
        ? 'CO-OP SURVIVAL'
        : this.rules.mode === 'koth'
          ? 'HOLD THE HILL'
          : this.rules.mode === 'ctf'
            ? 'CAPTURE THE FLAG'
            : this.rules.mode === 'bounty'
              ? 'BOUNTY HUNT'
              : this.teamplay
                ? `FIRST TEAM TO ${this.rules.scoreLimit}`
                : this.rules.scoreLimit > 0
                  ? `FIRST TO ${this.rules.scoreLimit} FRAGS`
                  : 'ENDLESS DEATHMATCH';
    this.emit({
      type: 'announce',
      text: modeName,
      sub: this.warmup ? 'Damage & scoring disabled · roam the arena' : this.server.name,
      tone: 'info',
    });
    this.emit({ type: 'chat', name: 'SERVER', text: `Connected to ${this.server.name} — ${this.server.motd}`, team: -1, system: true });
    audio.play('go');
  }

  /** Auto skill is rolled once per fighter and then stays with them across respawns. */
  private skillFor(f: Fighter): Difficulty {
    if (this.rules.difficulty !== 'auto') return this.rules.difficulty;
    if (!f.profileSkill) f.profileSkill = pickOf<Difficulty>(['easy', 'normal', 'normal', 'hard', 'hard', 'insane']);
    return f.profileSkill;
  }

  private makeBot(team: number, idx: number): Fighter {
    const name = genBotName(this.usedNames);
    const color = this.coOp ? (team === 1 ? 0xff3b5c : TEAM_COLORS[0]) : this.teamplay ? TEAM_COLORS[team] : BOT_COLORS[idx % BOT_COLORS.length];
    const f = new Fighter(this.nextId++, name, team, false, color, 'bot');
    f.ping = 8 + Math.random() * 14;
    f.skill = this.skillFor(f);
    f.region = this.server.region;
    f.ai = newAI();
    f.view = new BotView(color, name, color);
    this.scene.add(f.view.group);
    return f;
  }

  private makeFake(team: number, name: string, prof?: FakeProfile): Fighter {
    const color = this.teamMode ? TEAM_COLORS[team] : BOT_COLORS[this.fighters.length % BOT_COLORS.length];
    const f = new Fighter(this.nextId++, name, team, false, color, 'fake');
    this.usedNames.add(name);
    f.profileSkill = prof?.skill;
    f.skill = this.skillFor(f);
    f.region = prof?.region ?? pickOf(['EU', 'NA', 'AS', 'SA', 'OC']);
    f.ping = pingFor(this.server.region, f.region);
    f.frustration = prof?.frustration ?? Math.random() * 0.2;
    f.ai = newAI();
    f.view = new BotView(color, name, color);
    this.scene.add(f.view.group);
    return f;
  }

  private pickSpawn(f: Fighter, first: boolean): { x: number; y: number; z: number } {
    if (!this.spawnNodes.length) this.spawnNodes = this.nav.spread(30, this.rand, 0, 99, 7);
    let best = this.nav.nodes[this.spawnNodes[0]];
    let bs = -1e9;
    // With few live AI, bias respawns toward the player so the action never dries up
    const wantNearPlayer = this.liveAIT < this.minActiveAI && !f.isPlayer;
    const px = this.player.body.x;
    const pz = this.player.body.z;
    for (const id of this.spawnNodes) {
      const n = this.nav.nodes[id];
      let minD = 90;
      let seen = 0;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const enemy = this.aiCtx.isEnemy(f, o);
        const ddx = o.body.x - n.x, ddz = o.body.z - n.z;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (enemy) {
          minD = Math.min(minD, d);
          if (d < 55 && this.world.raycast(n.x, n.y + 1.5, n.z, (o.body.x - n.x) / d, (o.body.y + 1.2 - n.y - 1.5) / d, (o.body.z - n.z) / d, d - 0.5) === Infinity) seen++;
        } else minD = Math.min(minD, d * 1.5);
      }
      let sc: number;
      if (first && f.isPlayer) sc = -Math.abs(minD - 34) - seen * 20 + Math.random() * 6;
      else if (wantNearPlayer) {
        const ddx = n.x - px, ddz = n.z - pz;
        const pd = Math.sqrt(ddx * ddx + ddz * ddz);
        // Ideal engagement range ~ 18m: penalize too close or too far
        sc = -Math.abs(pd - 18) * 0.6 - seen * 10 + Math.random() * 4;
      } else sc = Math.min(minD, 60) - seen * 22 + Math.random() * 14;
      if (sc > bs) {
        bs = sc;
        best = n;
      }
    }
    return best;
  }

  private spawnFighter(f: Fighter, first = false) {
    const n = this.pickSpawn(f, first);
    const b = f.body;
    b.x = n.x; b.y = n.y + 0.02; b.z = n.z;
    b.vx = b.vy = b.vz = 0;
    b.h = STAND_H;
    b.r = R;
    b.onGround = false;
    f.hp = f.isPlayer && this.cheats.oneHp ? 1 : 100;
    f.armor = 0;
    f.alive = true;
    f.spawnProt = f.isPlayer ? 2.2 : 1.6;
    f.killer = null;
    f.yaw = Math.atan2(-(0 - n.x), -(0 - n.z)) + (Math.random() - 0.5) * 1.2;
    f.pitch = 0;
    f.moveSpeed = 0;
    f.skill = this.skillFor(f);
    if (!f.isPlayer) f.ping = f.kind === 'fake' ? pingFor(this.server.region, f.region) : 8 + Math.random() * 20;
    if (f.ai) {
      const ai = newAI();
      ai.weapon = this.insta ? 'rail' : 'rifle';
      f.ai = ai;
    }
    this.scoreDirty = true;
    this.fx.blasts.add(b.x, b.y + 0.1, b.z, 1.6, f.isPlayer ? 0x2de2ff : f.color, 0.6, true);
    this.fx.particles.burst(b.x, b.y + 0.2, b.z, Math.ceil(14 * this.pm), 4, f.color, 0.08, 0.7, -2, 1.5);
    if (f.isPlayer) {
      const P = this.P;
      P.sliding = false;
      P.dashT = 0;
      P.airJumps = 1;
      P.wallJumps = 2;
      P.deadT = 0;
      P.recoil = P.recoilYaw = P.kick = 0;
      P.eye = EYE_STAND;
      this.W.ammo = this.W.list.map((id) => this.defs[id].mag);
      this.W.reloadT = 0;
      this.W.switchT = 0.3;
      this.W.cur = 0;
      this.selectViewmodel();
      audio.play('spawn');
      this.vfx.flash = 0.6;
    } else {
      this.sfxAt('spawn', b.x, b.y, b.z, 0.5, 25);
    }
  }

  private selectViewmodel() {
    for (const id of WEAPON_ORDER) {
      const vm = this.vmAll[id];
      if (vm) vm.group.visible = false;
    }
    const id = this.W.list[this.W.cur];
    let cur = this.vmAll[id];
    if (!cur) {
      cur = buildViewModel(id);
      this.vmRoot.add(cur.group);
      this.vmAll[id] = cur;
    }
    cur.group.visible = true;
  }

  /* ================================================================ main loop */
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.adapt();
    }
    this.time += dt;
    this.step(dt);
    this.render();
  };

  private step(dt: number) {
    this.frameN++;
    // Mouse look deltas are accumulated during the frame; mark the camera dirty so the
    // projection matrix is only rebuilt when the view actually changed.
    if (this.mouseDirty) {
      this.mouseDirty = false;
      this.cameraDirty = true;
    }
    if (this.state === 'playing') this.simulate(dt, dt);
    else if (this.state === 'over') this.simulate(dt * 0.3, dt);
    else if (this.state === 'intro') this.introStep(dt);
    // paused: freeze
    this.input.endFrame();
  }

  private introStep(dt: number) {
    this.introAngle += dt * 0.12;
    const L = this.level;
    const rad = Math.max(L.w, L.d) * 0.42;
    const h = 24 + Math.sin(this.time * 0.2) * 5;
    this.camera.position.set(Math.cos(this.introAngle) * rad, h, Math.sin(this.introAngle) * rad);
    this.camera.lookAt(0, 3, 0);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.fx.particles.update(dt);
    this.updateSun(dt);
    this.levelObjs.update(this.time, this.camera.position, this.sunDir);
    this.animatePickups(dt);
    this.followSun(0, 0);
  }

  private simulate(dt: number, rdt: number) {
    this.t += dt;
    this.aiCtx.time = this.t;
    const p = this.player;
    const playing = this.state === 'playing';
    if (p.alive) {
      if (playing) this.updatePlayer(rdt);
      else this.coastPlayer(dt);
    } else this.updateDead(dt, rdt);
    if (p.spawnProt > 0) p.spawnProt -= dt;
    if (playing) this.updateWeapon(rdt);
    this.rebuildFighterGrid();
    // bots (LOD: near every frame, mid every 3rd, far every 8th). Stop AI immediately once the match ends.
    const cam = this.camera.position;
    const hideNames = this.cheats.wallhack;
    for (const f of this.fighters) {
      if (f.isPlayer || f.gone) continue;
      if (f.alive) {
        if (f.spawnProt > 0) f.spawnProt -= dt;
        // Never let dead/respawning AI keep a stale target (prevents attacking a respawning player)
        if (f.ai && f.ai.target && !f.ai.target.alive) {
          f.ai.target = null;
          f.ai.canSee = false;
          f.ai.path = [];
        }
        if (!playing || this.over) {
          f.body.vx *= 0.85;
          f.body.vz *= 0.85;
          f.body.vy -= this.gravity * dt;
          this.world.moveBody(f.body, dt);
          f.moveSpeed = Math.hypot(f.body.vx, f.body.vz);
        } else {
          const dx = f.body.x - cam.x, dz = f.body.z - cam.z;
          const d2 = dx * dx + dz * dz;
          const lod = d2 < 625 ? 0 : d2 < 3025 ? 1 : 2;
          if (lod === 2 && (this.frameN + f.id) % 8 !== 0) {
            f.body.vy -= this.gravity * dt;
            this.world.moveBody(f.body, dt);
          } else updateBot(this.aiCtx, f, dt, lod);
          this.botFootsteps(f, dt);
        }
      } else {
        f.respawnT -= dt;
        if (f.respawnT <= 0 && playing && !this.over) this.spawnFighter(f);
      }
      if (f.view) f.view.update(f, dt, this.time, cam.x, cam.y, cam.z, !hideNames);
    }
    this.updateRockets(dt);
    this.updateLights(rdt);
    this.updateSun(dt);
    this.updatePickups(dt);
    this.fx.particles.update(dt);
    this.fx.tracers.update(dt);
    this.fx.blasts.update(dt);
    this.levelT -= dt;
    if (this.levelT <= 0) {
      this.levelT = 0.05;
      this.levelObjs.update(this.time, this.camera.position, this.sunDir);
    }
    this.animatePickups(dt);
    this.updateSpecial(dt);
    this.updateCamera(rdt);
    this.updateViewmodel(rdt);
    this.updateVfx(rdt);
    if (playing) this.updateMatchEvents(dt);
    // HUD at 10 Hz, but throttle further (to ~4 Hz) when nothing scoreboard-relevant changed
    this.hudT -= rdt;
    if (this.hudT <= 0) {
      const fast = this.scoreDirty || p.alive !== this.lastHudAlive || this.cheats.aimbot;
      this.hudT = fast ? 0.1 : 0.25;
      this.lastHudAlive = p.alive;
      this.handlers.onHud(this.makeHud());
      // ping: fake players depend on their region vs the server region; bots and host are unaffected
      for (const f of this.fighters) {
        if (f.isPlayer) continue;
        if (f.kind === 'fake') {
          const targetPing = pingFor(this.server.region, f.region);
          f.ping = clamp(f.ping * 0.75 + targetPing * 0.25 + (Math.random() - 0.5) * 3, 5, 360);
        } else {
          f.ping = clamp(f.ping + (Math.random() - 0.5) * 1.5, 4, 24);
        }
      }
      p.ping = clamp(userPingTo(this.server.region, this.server.hosted ? 0 : 4) + (Math.random() - 0.5) * 3, 5, 340);
    }

    // Enforce a minimum number of live AI opponents so small lobbies never feel empty.
    // Respawns are biased toward the player's vicinity (see pickSpawn) to avoid far-away unloads.
    if (playing && !this.over && this.mode !== 'duel') {
      let live = 0;
      for (const f of this.fighters) {
        if (f.isPlayer || f.gone) continue;
        if (f.alive && this.aiCtx.isEnemy(this.player, f)) live++;
      }
      this.liveAIT = live;
      let guard = 0;
      while (live < this.minActiveAI && guard++ < this.minActiveAI) {
        // Prefer respawning an existing dead enemy (cheapest), otherwise spawn a fresh bot
        let dead = this.fighters.find((f) => !f.isPlayer && !f.gone && !f.alive && this.aiCtx.isEnemy(this.player, f));
        if (!dead && this.fighters.length < 120) {
          const team = this.teamMode ? (this.player.team === 0 ? 1 : 0) : 0;
          dead = this.makeBot(team, this.fighters.length);
          this.fighters.push(dead);
          this.aiCtx.fighters = this.fighters;
          this.scoreDirty = true;
        }
        if (dead) {
          dead.respawnT = 0;
          this.spawnFighter(dead);
          live++;
        } else break;
      }
    }
  }

  private rebuildFighterGrid() {
    this.fighterGrid.clear();
    for (const f of this.fighters) {
      if (!f.alive || f.gone) continue;
      const key = (Math.floor(f.body.x / 8) + 128) * 1024 + (Math.floor(f.body.z / 8) + 128);
      let l = this.fighterGrid.get(key);
      if (!l) this.fighterGrid.set(key, (l = []));
      l.push(f);
    }
  }

  private nearbyFighters(x: number, z: number, r: number): Fighter[] {
    const out: Fighter[] = [];
    const cs = 8;
    const x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs);
    const z0 = Math.floor((z - r) / cs), z1 = Math.floor((z + r) / cs);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const l = this.fighterGrid.get((ix + 128) * 1024 + (iz + 128));
      if (l) for (const f of l) out.push(f);
    }
    return out;
  }

  private setupSpecialMode() {
    // bots need to know the objectives; flags are pushed into this same array below
    this.aiCtx.mode = this.mode;
    this.aiCtx.ctf = { flags: this.flags };
    if (this.mode === 'koth') {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(this.hillR, this.hillR, 0.12, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
      ring.position.y = 0.08;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(this.hillR * 0.92, this.hillR, 14, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      beam.position.y = 7;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(this.hillR, 32), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.05;
      g.add(ring, beam, disc);
      g.position.set(0, 0, 0);
      this.scene.add(g);
      this.hillMesh = g;
      this.hillPos.set(0, 0, 0);
    }
    if (this.mode === 'ctf') {
      const w = this.level.w / 2 - 10;
      for (const team of [0, 1]) {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 }));
        pole.position.y = 2;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], side: THREE.DoubleSide, toneMapped: false }));
        cloth.position.set(0.8, 3.4, 0);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.1, 20), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.35, toneMapped: false }));
        base.position.y = 0.05;
        g.add(pole, cloth, base);
        const bx = team === 0 ? -w : w;
        g.position.set(bx, 0, 0);
        this.scene.add(g);
        this.flags.push({ team, x: bx, z: 0, baseX: bx, baseZ: 0, carrier: null, mesh: g });
      }
    }
    if (this.mode === 'bounty') {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4), new THREE.MeshBasicMaterial({ color: 0xff3b5c, toneMapped: false }));
      m.rotation.x = Math.PI;
      m.visible = false;
      this.scene.add(m);
      this.bountyMarker = m;
    }
  }

  private inHill(f: Fighter) {
    if (this.mode !== 'koth') return false;
    const b = f.body;
    return Math.abs(b.x) < this.hillR && Math.abs(b.z) < this.hillR && b.y < 3.5;
  }

  private hillOwner(): string {
    if (this.mode !== 'koth') return '';
    const occ = this.fighters.filter((f) => f.alive && this.inHill(f));
    if (!occ.length) return '';
    if (this.teamplay) {
      const t0 = occ.filter((f) => f.team === 0).length;
      const t1 = occ.length - t0;
      return t0 === t1 ? 'CONTESTED' : t0 > t1 ? 'CYAN' : 'MAGENTA';
    }
    return occ.length > 1 ? 'CONTESTED' : occ[0].name;
  }

  private flagStatus(): string {
    if (this.mode !== 'ctf') return '';
    return this.flags.map((f) => (f.carrier ? `${f.carrier.name} has the flag` : 'flag at base')).join(' · ');
  }

  private updateSpecial(dt: number) {
    if (this.warmup || this.over) return;
    if (this.mode === 'koth') {
      const occ = this.fighters.filter((f) => f.alive && this.inHill(f));
      this.hillAcc += dt;
      if (this.hillAcc >= 1) {
        this.hillAcc -= 1;
        const owner = this.hillOwner();
        // one point per second for whoever holds an uncontested hill; contested hills score nothing
        if (occ.length && owner !== 'CONTESTED') {
          if (this.teamplay) this.teamScore[occ[0].team] += 1;
          else occ[0].score += 1;
          this.scoreDirty = true;
        }
      }
      if (this.hillMesh) {
        const c = this.hillOwner();
        const col = c === 'CYAN' ? 0x2de2ff : c === 'MAGENTA' ? 0xff2d95 : c === 'CONTESTED' ? 0xffffff : 0xffe14d;
        this.hillMesh.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m && m.color) m.color.setHex(col);
        });
      }
      if (this.rules.scoreLimit > 0) {
        const top = Math.max(...this.fighters.map((f) => (this.teamplay ? this.teamScore[f.team] : f.score)));
        if (top >= this.rules.scoreLimit) this.endMatch('limit');
      }
    } else if (this.mode === 'bounty') {
      if (this.bountyId < 0 || !this.fighters.find((f) => f.id === this.bountyId && f.alive && !f.gone)) {
        const pool = this.fighters.filter((f) => !f.isPlayer && f.alive && !f.gone);
        if (pool.length) {
          this.bountyId = pickOf(pool).id;
          this.aiCtx.bountyId = this.bountyId;
          this.emit({ type: 'announce', text: 'BOUNTY MARKED', sub: this.fighters.find((f) => f.id === this.bountyId)?.name, tone: 'info' });
        }
      }
      const b = this.fighters.find((f) => f.id === this.bountyId);
      if (this.bountyMarker) {
        this.bountyMarker.visible = !!b && b.alive;
        if (b) this.bountyMarker.position.set(b.body.x, b.body.y + 2.7 + Math.sin(this.time * 3) * 0.12, b.body.z);
      }
    } else if (this.mode === 'ctf') {
      this.flagT -= dt;
      for (const fl of this.flags) {
        if (fl.carrier) {
          if (!fl.carrier.alive) {
            fl.carrier.carrying = -1;
            fl.carrier = null;
            fl.x = fl.baseX;
            fl.z = fl.baseZ;
          } else {
            fl.x = fl.carrier.body.x;
            fl.z = fl.carrier.body.z;
            const ownBase = this.flags.find((o) => o.team === fl.carrier!.team)!;
            if (Math.hypot(fl.carrier.body.x - ownBase.baseX, fl.carrier.body.z - ownBase.baseZ) < 3) {
              const capturer = fl.carrier;
              const capTeam = capturer.team;
              capturer.carrying = -1;
              fl.carrier = null;
              fl.x = fl.baseX;
              fl.z = fl.baseZ;
              this.teamScore[capTeam] += 1;
              capturer.score += 1;
              this.scoreDirty = true;
              this.emit({ type: 'announce', text: 'FLAG CAPTURED', sub: `${capturer.name} · ${capTeam === 0 ? 'CYAN' : 'MAGENTA'} SCORES`, tone: 'good' });
              audio.play('streak');
              if (this.rules.scoreLimit > 0 && Math.max(this.teamScore[0], this.teamScore[1]) >= this.rules.scoreLimit) this.endMatch('limit');
            }
          }
        } else {
          const enemy = this.fighters.find((f) => f.alive && f.team !== fl.team && Math.hypot(f.body.x - fl.x, f.body.z - fl.z) < 2.2 && Math.abs(f.body.y - fl.mesh.position.y) < 4);
          if (enemy) {
            fl.carrier = enemy;
            enemy.carrying = fl.team;
            this.emit({ type: 'announce', text: 'FLAG TAKEN', sub: enemy.name, tone: 'info' });
            audio.play('pickupArmor');
          }
        }
        fl.mesh.position.set(fl.x, fl.mesh.position.y, fl.z);
      }
    }
  }

  /** fighters in grid cells along a 2D ray (used by hitscan) */
  private fightersAlongRay(ox: number, oz: number, dx: number, dz: number, limit: number): Fighter[] {
    const out: Fighter[] = [];
    const seen = new Set<number>();
    const step = 7;
    const n = Math.min(64, Math.ceil(limit / step));
    for (let i = 0; i <= n; i++) {
      const t = Math.min(limit, i * step);
      const x = ox + dx * t, z = oz + dz * t;
      const ix = Math.floor(x / 8), iz = Math.floor(z / 8);
      for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) {
        const l = this.fighterGrid.get((ix + ax + 128) * 1024 + (iz + az + 128));
        if (!l) continue;
        for (const f of l) if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
      }
    }
    return out;
  }

  private updateMatchEvents(dt: number) {
    if (this.over) return;
    if (!this.warmup && this.rules.timeLimit > 0 && this.rules.timeLimit + this.extraTime - this.t <= 0) {
      this.endMatch('time');
      return;
    }
    // fake players (not bots) come and go
    this.churnT -= dt;
    if (this.churnT <= 0) {
      this.churnT = 30 + Math.random() * 40;
      const fakes = this.fighters.filter((f) => f.kind === 'fake' && !f.gone);
      if (fakes.length > 1) {
        const f = pickOf(fakes);
        const old = f.name;
        this.emit({ type: 'chat', name: 'SERVER', text: `${old} left the game`, team: -1, system: true });
        this.usedNames.delete(old);
        if (f.view) {
          this.scene.remove(f.view.group);
          f.view.dispose();
        }
        const idx = this.fighters.indexOf(f);
        const fresh = this.makeFake(f.team, genPlayerName(this.usedNames));
        this.fighters[idx] = fresh;
        fresh.alive = false;
        fresh.respawnT = 2 + Math.random() * 3;
        this.aiCtx.fighters = this.fighters;
        this.scoreDirty = true;
        this.later(() => {
          if (this.disposed) return;
          this.emit({ type: 'chat', name: 'SERVER', text: `${fresh.name} joined the game`, team: -1, system: true });
          audio.play('join');
          if (Math.random() < 0.6) this.say(fresh, 'join');
        }, 1200 + Math.random() * 1500);
      }
    }
    this.chatBudget -= dt;
    this.chatT -= dt;
    if (this.chatT <= 0) {
      this.chatT = 16 + Math.random() * 26;
      const fakes = this.fighters.filter((f) => f.kind === 'fake' && !f.gone);
      if (fakes.length) this.say(pickOf(fakes), 'idle');
    }
  }

  /** only fake players chat; bots stay silent */
  private say(f: Fighter, kind: ChatKind, vars: Record<string, string> = {}) {
    if (f.kind !== 'fake' || this.chatBudget > 0) return;
    this.chatBudget = 1.2;
    this.emit({
      type: 'chat',
      name: f.name,
      text: chatLine(kind, { region: f.region, map: this.level.name, ...vars }),
      team: this.teamMode ? f.team : -1,
    });
  }

  private botFootsteps(f: Fighter, dt: number) {
    if (!f.body.onGround || f.moveSpeed < 2) return;
    const prev = f.stepPhase;
    f.stepPhase += f.moveSpeed * dt * 0.45;
    if (Math.floor(f.stepPhase) !== Math.floor(prev)) {
      const b = f.body;
      const d = Math.hypot(b.x - this.camera.position.x, b.z - this.camera.position.z);
      if (d < 16) this.sfxAt('step', b.x, b.y, b.z, 0.7, 16);
    }
  }

  private render() {
    const r = this.renderer;
    const s = this.settings;
    const showVM = this.state !== 'intro' && this.player?.alive;
    if (this.post) {
      const cam = this.camera;
      cam.getWorldDirection(this.tmpV);
      const facing = this.tmpV.dot(this.sunDir);
      this.tmpV2.copy(cam.position).addScaledVector(this.sunDir, 400).project(cam);
      this.sunUv.set(this.tmpV2.x * 0.5 + 0.5, this.tmpV2.y * 0.5 + 0.5);
      const edge = Math.max(Math.abs(this.tmpV2.x), Math.abs(this.tmpV2.y));
      const vis = facing > 0 ? Math.min(1, facing * 2.2) * Math.max(0, Math.min(1, 2.2 - edge)) : 0;
      this.post.render(this.scene, cam, showVM ? this.wScene : null, this.wCam, {
        bloom: s.bloom, rays: s.godRays, sunUv: this.sunUv, sunVis: vis, rayColor: this.rayCol,
        vignette: s.vignette ? 0.55 + this.vfx.low * 0.5 : 0,
        aberration: s.chromatic ? this.vfx.damage * 0.012 + this.vfx.speed * 0.004 : 0,
        grain: s.filmGrain ? 0.045 : 0, time: this.time,
      });
      return;
    }
    r.clear();
    r.render(this.scene, this.camera);
    if (this.state !== 'intro' && this.player.alive) {
      r.clearDepth();
      r.render(this.wScene, this.wCam);
    }
  }

  private followSun(cx: number, cz: number) {
    if (!this.sun.castShadow) return;
    const sx = Math.round(cx / 2) * 2;
    const sz = Math.round(cz / 2) * 2;
    if (sx === this.lastSunX && sz === this.lastSunZ && !this.settings.dynamicSun) return;
    this.lastSunX = sx;
    this.lastSunZ = sz;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 100, this.sunDir.y * 100, sz + this.sunDir.z * 100);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.needsUpdate = true;
  }

  /* ========================================================= dynamic lights */
  flash(x: number, y: number, z: number, color: number, intensity: number, dist: number, dur: number) {
    if (!this.lightsOn || !this.lights.length) return;
    let best = this.lights[0];
    for (const L of this.lights) {
      if (L.t <= 0) { best = L; break; }
      if (L.t / L.dur * L.base < best.t / best.dur * best.base) best = L;
    }
    best.l.position.set(x, y, z);
    best.l.color.setHex(color);
    best.l.distance = dist;
    best.base = intensity;
    best.t = dur;
    best.dur = dur;
    best.l.intensity = intensity;
  }

  private updateLights(dt: number) {
    for (const L of this.lights) {
      if (L.t <= 0) {
        L.l.intensity = 0;
        continue;
      }
      L.t -= dt;
      const k = Math.max(0, L.t / L.dur);
      L.l.intensity = L.base * k * k;
    }
  }

  private updateSun(dt: number) {
    if (!this.settings.dynamicSun) return;
    this.sunAngle += dt * 0.035;
    const c = Math.cos(this.sunAngle), sn = Math.sin(this.sunAngle);
    const b = this.sunBase;
    const elev = Math.max(0.28, b.y + Math.sin(this.sunAngle * 0.7) * 0.18);
    this.sunDir.set(b.x * c - b.z * sn, elev, b.x * sn + b.z * c).normalize();
  }

  /* ============================================================ host API */
  setCheats(c: Cheats) {
    this.cheats = { ...c };
    if (Object.values(c).some(Boolean)) this.cheated = true;
    if (c.oneHp && this.player.alive) {
      this.player.hp = 1;
      this.player.armor = 0;
    }
    this.emit({ type: 'chat', name: 'SERVER', text: `sv_cheats: ${Object.entries(c).filter(([, v]) => v).map(([k]) => k).join(', ') || 'off'}`, team: -1, system: true });
  }
  setDifficulty(d: Difficulty) {
    this.rules = { ...this.rules, difficulty: d };
    this.diff = DIFF_PARAMS[d];
    this.aiCtx.diff = this.diff;
    this.emit({ type: 'chat', name: 'SERVER', text: `Bot skill set to ${d}`, team: -1, system: true });
  }
  addBot() {
    if (this.fighters.length >= 120) return;
    let team = 0;
    if (this.coOp) team = 1;
    else if (this.teamplay) {
      const c0 = this.fighters.filter((f) => f.team === 0).length;
      team = c0 <= this.fighters.length - c0 ? 0 : 1;
    }
    const f = this.makeBot(team, this.fighters.length);
    this.fighters.push(f);
    this.scoreDirty = true;
    this.aiCtx.fighters = this.fighters;
    this.spawnFighter(f);
    this.emit({ type: 'chat', name: 'SERVER', text: `${f.name} joined the game`, team: -1, system: true });
  }
  kick(id: number) {
    const idx = this.fighters.findIndex((f) => f.id === id && !f.isPlayer);
    if (idx < 0) return;
    const f = this.fighters[idx];
    if (f.view) {
      this.scene.remove(f.view.group);
      f.view.dispose();
    }
    this.fighters.splice(idx, 1);
    this.scoreDirty = true;
    this.usedNames.delete(f.name);
    this.aiCtx.fighters = this.fighters;
    this.emit({ type: 'chat', name: 'SERVER', text: `${f.name} was kicked by the host`, team: -1, system: true });
  }
  addTime(sec: number) {
    this.extraTime += sec;
    this.emit({ type: 'announce', text: `+${Math.round(sec / 60)} MIN`, sub: 'Host extended the match', tone: 'info' });
  }
  forceEnd() {
    this.endMatch('time');
  }

  /** Screen-space boxes for enemies (wallhack cheat), with throttled shootability (LOS) detection. */
  getEsp(w: number, h: number) {
    const out: { x: number; y: number; h: number; name: string; d: number; hp: number; shootable: boolean }[] = [];
    if (!this.cheats.wallhack || this.state === 'intro') return out;
    // Throttle the expensive full ESP loop to ~20 Hz; reuse the last cached projection between updates
    this.espT += 1 / 60;
    if (this.espT < 0.05) return this.espCache;
    this.espT = 0;
    this.espCache = out;
    const cam = this.camera;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const p = this.player;
    for (const f of this.fighters) {
      if (f.isPlayer || !f.alive || (this.teamMode && f.team === p.team)) continue;
      const b = f.body;
      this.tmpV.set(b.x, b.y, b.z).project(cam);
      if (this.tmpV.z > 1 || this.tmpV.z < -1) continue;
      this.tmpV2.set(b.x, b.y + 1.95, b.z).project(cam);
      const y0 = (1 - this.tmpV.y) * 0.5 * h, y1 = (1 - this.tmpV2.y) * 0.5 * h;
      // Throttled LOS check (~20 Hz staggered per fighter) using the fast uniform grid raycast
      if (this.time >= f.espVisT) {
        f.espVisT = this.time + 0.045 + (f.id % 5) * 0.005;
        const dx = b.x - cx, dz = b.z - cz;
        const dyChest = b.y + (b.h > 1.5 ? 1.15 : 0.75) - cy;
        const dChest = Math.sqrt(dx * dx + dyChest * dyChest + dz * dz) || 1;
        let vis = this.world.raycast(cx, cy, cz, dx / dChest, dyChest / dChest, dz / dChest, dChest - 0.3) === Infinity;
        if (!vis) {
          const dyHead = b.y + (b.h > 1.5 ? 1.52 : 0.98) - cy;
          const dHead = Math.sqrt(dx * dx + dyHead * dyHead + dz * dz) || 1;
          vis = this.world.raycast(cx, cy, cz, dx / dHead, dyHead / dHead, dz / dHead, dHead - 0.3) === Infinity;
        }
        f.espVisible = vis;
      }
      out.push({
        x: (this.tmpV.x * 0.5 + 0.5) * w,
        y: y1,
        h: y0 - y1,
        name: f.name,
        d: Math.hypot(b.x - p.body.x, b.z - p.body.z),
        hp: f.hp,
        shootable: f.espVisible,
      });
    }
    return out;
  }

  private pSpeed() {
    return this.speedMul * (this.cheats.speed ? 1.6 : 1);
  }

  /** aim assist: pick the enemy closest to the crosshair inside a distance-scaled cone */
  /** absolute yaw/pitch from the camera to a fighter's chest */
  private aimAngles(f: Fighter): { yaw: number; pitch: number } {
    const cam = this.camera.position;
    const dx = f.body.x - cam.x;
    const dy = f.body.y + (f.body.h > 1.5 ? 1.15 : 0.75) - cam.y;
    const dz = f.body.z - cam.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  private findAimTarget(): { f: Fighter; yaw: number; pitch: number; ang: number; cone: number } | null {
    const p = this.player;
    const cam = this.camera.position;
    let best: { f: Fighter; yaw: number; pitch: number; ang: number; cone: number } | null = null;
    const near = this.nearbyFighters(cam.x, cam.z, 72);
    for (let ni = 0; ni < near.length; ni++) {
      const f = near[ni];
      if (f.isPlayer || !f.alive || f.gone || (this.teamMode && f.team === p.team)) continue;
      const tx = f.body.x, ty = f.body.y + (f.body.h > 1.5 ? 1.15 : 0.75), tz = f.body.z;
      const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z;
      const dh = Math.hypot(dx, dz);
      const d = Math.sqrt(dh * dh + dy * dy);
      if (d > 70 || d < 0.5) continue;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, dh);
      const ay = angDiff(p.yaw, yaw), ap = pitch - p.pitch;
      const ang = Math.hypot(ay * Math.cos(p.pitch), ap);
      const cone = Math.min(0.32, Math.atan(1.9 / d) + 0.02);
      if (ang > cone || (best && ang / cone > best.ang / best.cone)) continue;
      if (this.world.raycast(cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d - 0.4) !== Infinity) continue;
      best = { f, yaw, pitch, ang, cone };
    }
    this.aimResult = best;
    return best;
  }

  /**
   * Aimbot cheat: snaps directly (no smoothing) to any shootable target (even off-screen)
   * when firing, using the AI's internal state (wantX, wantZ, velocity, gravity) to predict
   * where the target will move by the time the shot lands.
   */
  private applyAimbot(dt: number) {
    const p = this.player;
    const def = this.curDef();
    const cam = this.camera.position;
    const ox = cam.x, oy = cam.y, oz = cam.z;
    let bestAng = 1e9;
    let bestYaw = p.yaw;
    let bestPitch = p.pitch;
    let found = false;

    for (const f of this.fighters) {
      if (f.isPlayer || !f.alive || f.gone || f.spawnProt > 0 || (this.teamMode && f.team === p.team)) continue;
      const b = f.body;
      const d0 = Math.hypot(b.x - ox, b.y + 1.2 - oy, b.z - oz);
      if (d0 > def.range || d0 < 0.25) continue;

      // Predict target position when the shot lands using AI's internal desired velocity state
      const tLead = clamp(def.speed > 0 ? d0 / def.speed : dt, 0, 1.1);
      let px = b.x, py = b.y, pz = b.z;
      if (tLead > 0.001) {
        let vx = b.vx, vy = b.vy, vz = b.vz;
        const wx = f.ai ? f.ai.wantX : vx;
        const wz = f.ai ? f.ai.wantZ : vz;
        const steps = Math.max(1, Math.min(8, Math.ceil(tLead / 0.035)));
        const h = tLead / steps;
        for (let s = 0; s < steps; s++) {
          const k = Math.min(1, (py <= b.y + 0.02 && b.onGround ? 14 : 2.5) * h);
          vx += (wx - vx) * k;
          vz += (wz - vz) * k;
          if (!b.onGround || py > 0.01) vy -= this.gravity * h;
          px += vx * h;
          pz += vz * h;
          py = Math.max(0, py + vy * h);
        }
        // Keep predicted position outside world walls
        if (this.world.anyOverlap(px - b.r, py + 0.05, pz - b.r, px + b.r, py + b.h, pz + b.r)) {
          px = b.x;
          py = b.y;
          pz = b.z;
        }
      }

      const headH = b.h > 1.5 ? 1.52 : 0.98;
      const chestH = b.h > 1.5 ? 1.12 : 0.75;
      const pts: [number, number, number][] =
        def.id === 'rocket'
          ? [[px, py + 0.85, pz], [b.x, b.y + 0.85, b.z]]
          : def.headMul > 1
            ? [[px, py + headH, pz], [px, py + chestH, pz], [b.x, b.y + headH, b.z], [b.x, b.y + chestH, b.z]]
            : [[px, py + chestH, pz], [b.x, b.y + chestH, b.z]];

      for (const [tx, ty, tz] of pts) {
        const dx = tx - ox, dy = ty - oy, dz = tz - oz;
        const dh = Math.hypot(dx, dz);
        const dist = Math.hypot(dh, dy) || 1;
        if (this.world.raycast(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist - 0.28) !== Infinity) continue;
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, dh);
        const ang = Math.hypot(angDiff(p.yaw, yaw), pitch - p.pitch);
        if (ang < bestAng) {
          bestAng = ang;
          bestYaw = yaw;
          bestPitch = pitch;
          found = true;
        }
        break;
      }
    }

    if (found) {
      p.yaw = bestYaw;
      p.pitch = clamp(bestPitch, -1.5, 1.5);
      this.P.recoil = 0;
      this.P.recoilYaw = 0;
    }
  }

  /* ============================================================ player logic */
  private accelerate(b: { vx: number; vz: number }, wx: number, wz: number, wishSpeed: number, accel: number, dt: number) {
    const cur = b.vx * wx + b.vz * wz;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(accel * wishSpeed * dt, add);
    b.vx += wx * a;
    b.vz += wz * a;
  }

  private coastPlayer(dt: number) {
    const b = this.player.body;
    b.vx *= 0.9; b.vz *= 0.9;
    b.vy -= this.gravity * dt;
    this.world.moveBody(b, dt);
  }

  private updatePlayer(dt: number) {
    const P = this.P;
    const p = this.player;
    const b = p.body;
    const inp = this.input;
    const s = this.settings;
    const ax = inp.axes();
    const k = this.keyCache;
    k.KeyC = inp.isDown('KeyC'); k.ControlLeft = inp.isDown('ControlLeft'); k.ShiftLeft = inp.isDown('ShiftLeft'); k.ShiftRight = inp.isDown('ShiftRight'); k.KeyZ = inp.isDown('KeyZ'); k.KeyQ = inp.isDown('KeyQ'); k.KeyE = inp.isDown('KeyE');
    const flow = s.movement === 'flow';

    // ---------- look
    const aiming = (inp.aimHeld || k.KeyZ) && !this.touch;
    const aimMul = aiming ? 0.62 : 1;
    let dx = inp.mouseDX * 0.0022 * s.sensitivity * aimMul + inp.lookDX * 0.0042 * s.touchSensitivity;
    let dy = inp.mouseDY * 0.0022 * s.sensitivity * aimMul + inp.lookDY * 0.0042 * s.touchSensitivity;
    const ak = 2.0 * dt * s.sensitivity;
    dx += ((inp.isDown('ArrowRight') ? 1 : 0) - (inp.isDown('ArrowLeft') ? 1 : 0)) * ak;
    dy += ((inp.isDown('ArrowDown') ? 1 : 0) - (inp.isDown('ArrowUp') ? 1 : 0)) * ak;
    const aa = s.aimAssist;
    this.aimT -= dt;
    const tgt = aa > 0 && this.aimT <= 0 ? (this.aimT = 1 / 30, this.findAimTarget()) : this.aimResult;
    if (aa <= 0) this.aimResult = null;
    this.aimTarget = tgt ? tgt.f : null;
    if (tgt) {
      // slowdown ("friction") near targets
      const close = 1 - tgt.ang / tgt.cone;
      const fr = 1 - aa * 0.55 * (0.4 + 0.6 * close);
      dx *= fr;
      dy *= fr;
    }
    p.yaw -= dx;
    p.pitch = clamp(p.pitch - dy * (s.invertY ? -1 : 1), -1.5, 1.5);
    if (tgt && tgt.f.alive) {
      // magnetism: only while the player is actively playing (moving, looking or shooting).
      // Angles are recomputed every frame so the pull never lags behind a moving target.
      const fresh = this.aimAngles(tgt.f);
      const active = Math.min(1, (ax.m > 0.1 ? 0.6 : 0) + (Math.abs(dx) + Math.abs(dy) > 0.0005 ? 0.6 : 0) + (inp.fireHeld ? 1 : 0));
      const k2 = Math.min(1, aa * (this.touch ? 7 : 4.5) * active * dt);
      p.yaw += angDiff(p.yaw, fresh.yaw) * k2;
      p.pitch += (fresh.pitch - p.pitch) * k2 * 0.8;
    }
    if (this.cheats.aimbot && (inp.fireHeld || inp.firePressed)) {
      this.applyAimbot(dt);
    }
    if (p.yaw > Math.PI) p.yaw -= TAU;
    if (p.yaw < -Math.PI) p.yaw += TAU;
    if (this.cheats.oneHp) {
      p.hp = 1;
      p.armor = 0;
    }

    // ---------- intent
    const hv0 = Math.hypot(b.vx, b.vz);
    P.aimT = lerp(P.aimT, aiming ? 1 : 0, Math.min(1, dt * 14));
    const crouchKey = k.KeyC || k.ControlLeft;
    const crouchPressed = inp.pressed('KeyC') || inp.pressed('ControlLeft');
    let wantSprint = (k.ShiftLeft || k.ShiftRight || inp.touchSprint || (s.autoSprint && ax.y > 0.5)) && ax.y > 0.1 && !aiming;
    if (s.toggleCrouch && crouchPressed) P.crouchToggle = !P.crouchToggle;
    const crouchWant = s.toggleCrouch ? P.crouchToggle : crouchKey;

    P.slideCd -= dt;
    P.dashCd -= dt;
    P.padCd -= dt;
    P.boostT -= dt;

    // slide start
    if (crouchPressed && b.onGround && !P.sliding && hv0 > 7.5 && P.slideCd <= 0 && P.dashT <= 0) this.startSlide();

    // dash
    if (inp.pressed('KeyF') && P.dashCd <= 0 && P.dashT <= 0) {
      let wxd = -Math.sin(p.yaw) * ax.y + Math.cos(p.yaw) * ax.x;
      let wzd = -Math.cos(p.yaw) * ax.y - Math.sin(p.yaw) * ax.x;
      const l = Math.hypot(wxd, wzd);
      if (l < 0.1) {
        wxd = -Math.sin(p.yaw);
        wzd = -Math.cos(p.yaw);
      } else {
        wxd /= l;
        wzd /= l;
      }
      P.dashX = wxd;
      P.dashZ = wzd;
      P.dashT = 0.2;
      P.dashCd = this.rules.mutator === 'turbo' ? 1.2 : 1.7;
      P.sliding = false;
      b.vx = wxd * 23;
      b.vz = wzd * 23;
      if (b.vy < 0) b.vy = 0;
      P.boostT = 0.6;
      P.fovPunch += 9;
      this.addTrauma(0.12);
      audio.play('dash');
      this.fx.blasts.add(b.x, b.y + 0.9, b.z, 1.4, 0x2de2ff, 0.4, true);
      this.fx.particles.burst(b.x, b.y + 0.8, b.z, Math.ceil(12 * this.pm), 6, 0x9ff4ff, 0.07, 0.4, 0, 0.2, -wxd, 0, -wzd, 0.8);
    }

    // crouch / stand
    const wantCrouch = P.sliding || crouchWant;
    if (wantCrouch) {
      if (b.h !== CROUCH_H) b.h = CROUCH_H;
    } else if (b.h !== STAND_H) {
      if (!this.world.anyOverlap(b.x - R, b.y + b.h, b.z - R, b.x + R, b.y + STAND_H, b.z + R)) b.h = STAND_H;
    }
    P.crouching = b.h < 1.5;
    if (P.crouching) wantSprint = false;
    P.sprinting = wantSprint;
    P.eye = lerp(P.eye, P.crouching ? EYE_CROUCH : EYE_STAND, Math.min(1, dt * 14));

    // ---------- jump
    const jumpHeld = inp.isDown('Space');
    if (inp.pressed('Space')) P.jumpBuf = 0.14;
    else if (jumpHeld && b.onGround) P.jumpBuf = Math.max(P.jumpBuf, 0.05);
    P.jumpBuf -= dt;
    if (b.onGround) {
      P.coyote = 0.1;
      P.airJumps = 1;
      P.wallJumps = 2;
    } else P.coyote -= dt;
    if (this.cheats.moonJump) P.airJumps = Math.max(P.airJumps, 1);
    if (P.jumpBuf > 0 && (b.onGround || P.coyote > 0) && P.dashT <= 0) {
      b.vy = JUMP_V * (this.cheats.moonJump ? 1.7 : 1);
      if (P.sliding) {
        P.sliding = false;
        const sp = Math.hypot(b.vx, b.vz);
        const k = Math.min(1.12, 15 / Math.max(sp, 1));
        b.vx *= k; b.vz *= k;
        this.fx.particles.burst(b.x, b.y + 0.1, b.z, Math.ceil(8 * this.pm), 4, 0xcfd2ff, 0.1, 0.4, 6, 0.5);
      }
      b.onGround = false;
      P.coyote = 0;
      P.jumpBuf = 0;
      P.jumped = true;
      if (flow) { b.vx += (-Math.sin(p.yaw) * ax.y + Math.cos(p.yaw) * ax.x) * 1.4; b.vz += (-Math.cos(p.yaw) * ax.y - Math.sin(p.yaw) * ax.x) * 1.4; }
      audio.play('jump');
    } else if (inp.pressed('Space') && !b.onGround && P.coyote <= 0) {
      const w = { nx: 0, nz: 0 };
      if (P.wallJumps > 0 && this.world.probeWall(b, 0.18, w)) {
        P.wallJumps--;
        P.airJumps = 1;
        b.vx = w.nx * 8.2 + b.vx * 0.35;
        b.vz = w.nz * 8.2 + b.vz * 0.35;
        b.vy = 9.4;
        P.boostT = 0.5;
        P.jumped = false;
        P.jumpBuf = 0;
        P.fovPunch += 5;
        this.addTrauma(0.1);
        audio.play('walljump');
        this.fx.particles.burst(b.x - w.nx * 0.3, b.y + 1, b.z - w.nz * 0.3, Math.ceil(10 * this.pm), 5, 0xdad4ff, 0.09, 0.45, 12, 0.3, w.nx, 0, w.nz, 1);
        this.emit({ type: 'pickup', text: 'WALL JUMP', color: '#2de2ff' });
      } else if (P.airJumps > 0) {
        if (!this.cheats.moonJump) P.airJumps--;
        b.vy = JUMP_V * 0.95 * (this.cheats.moonJump ? 1.5 : 1);
        P.jumped = false;
        P.jumpBuf = 0;
        // air jump gives a little push toward input
        const wxd = -Math.sin(p.yaw) * ax.y + Math.cos(p.yaw) * ax.x;
        const wzd = -Math.cos(p.yaw) * ax.y - Math.sin(p.yaw) * ax.x;
        b.vx += wxd * 2.5;
        b.vz += wzd * 2.5;
        P.fovPunch += 3;
        audio.play('airjump');
        this.fx.blasts.add(b.x, b.y + 0.1, b.z, 1.2, 0xb6a8ff, 0.4, true);
        this.fx.particles.burst(b.x, b.y + 0.1, b.z, Math.ceil(8 * this.pm), 3, 0xb6a8ff, 0.08, 0.4, -2, 0.3);
      }
    }
    // variable jump height
    if (!jumpHeld && P.jumped && b.vy > 3.5 && !this.touchJumpHeld() && !this.cheats.moonJump) {
      b.vy *= 0.55;
      P.jumped = false;
    }
    if (b.vy <= 0) P.jumped = false;

    // ---------- horizontal movement
    let wx = -Math.sin(p.yaw) * ax.y + Math.cos(p.yaw) * ax.x;
    let wz = -Math.cos(p.yaw) * ax.y - Math.sin(p.yaw) * ax.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.001) {
      wx /= wl;
      wz /= wl;
    }
    let gravMul = 1;
    if (P.dashT > 0) {
      P.dashT -= dt;
      gravMul = 0.12;
      b.vx = P.dashX * 23;
      b.vz = P.dashZ * 23;
      b.vy *= 0.9;
      if (P.dashT <= 0) {
        b.vx *= 0.55;
        b.vz *= 0.55;
      }
    } else if (P.sliding) {
      P.slideT -= dt;
      const sp = Math.hypot(b.vx, b.vz);
      const ns = Math.max(0, sp - (flow ? 3.2 : 5.2) * dt);
      if (sp > 0.01) {
        // steer slightly
        let dxv = b.vx / sp, dzv = b.vz / sp;
        if (wl > 0.1) {
          const cross = dxv * wz - dzv * wx;
          const rot = clamp(cross, -1, 1) * 1.3 * dt;
          const c = Math.cos(rot), sn = Math.sin(rot);
          const nx = dxv * c - dzv * sn, nz = dxv * sn + dzv * c;
          dxv = nx; dzv = nz;
        }
        b.vx = dxv * ns;
        b.vz = dzv * ns;
      }
      if (ns < 4.2 || (!s.toggleCrouch && !crouchKey && P.slideT < 0.9) || !b.onGround && P.slideT < 0.8) {
        P.sliding = false;
        P.slideCd = 0.25;
      }
    } else {
      let maxSpeed = (P.crouching ? CROUCH_SPEED : P.sprinting ? SPRINT : WALK) * this.pSpeed();
      if (aiming) maxSpeed *= 0.7;
      const wishSpeed = maxSpeed * ax.m;
      if (b.onGround) {
        const sp = Math.hypot(b.vx, b.vz);
        if (P.jumpBuf <= 0 && sp > 0.01) {
          const drop = Math.max(sp, 2.5) * (flow ? 6.5 : 11) * dt;
          const ns = Math.max(0, sp - drop) / sp;
          b.vx *= ns;
          b.vz *= ns;
        }
        if (wl > 0.001) this.accelerate(b, wx, wz, wishSpeed, flow ? 17 : 12, dt);
      } else if (wl > 0.001) {
        const airMax = (P.sprintT > 0.5 ? SPRINT : WALK) * this.pSpeed() * ax.m;
        this.accelerate(b, wx, wz, airMax, flow ? 4.6 : 2.6, dt);
      }
    }
    // soft speed cap
    const cap = P.boostT > 0 ? 42 : P.sliding ? 22 : 17 * this.pSpeed();
    const hv = Math.hypot(b.vx, b.vz);
    if (hv > cap) {
      const k = 1 - Math.min(1, 3 * dt) * (1 - cap / hv);
      b.vx *= k;
      b.vz *= k;
    }
    b.vy -= this.gravity * gravMul * dt;
    if (b.vy < -60) b.vy = -60;
    this.world.moveBody(b, dt);
    P.stepOff += b.stepDy;
    b.stepDy = 0;

    // jump pads
    if (P.padCd <= 0) {
      for (const pad of this.level.pads) {
        if (Math.abs(b.x - pad.x) < 1.6 && Math.abs(b.z - pad.z) < 1.6 && b.y - pad.y < 0.6 && b.y - pad.y > -0.4 && b.vy <= 1) {
          const k = Math.sqrt(this.gravity / 24);
          b.vx = pad.vx * k;
          b.vz = pad.vz * k;
          b.vy = pad.vy * k;
          b.onGround = false;
          P.sliding = false;
          P.boostT = 2;
          P.padCd = 0.5;
          P.airJumps = 1;
          P.fovPunch += 10;
          this.addTrauma(0.25);
          audio.play('pad');
          this.fx.blasts.add(pad.x, pad.y + 0.2, pad.z, 2.4, pad.color, 0.5, true);
          this.flash(pad.x, pad.y + 1, pad.z, pad.color, 80, 10, 0.5);
          this.fx.particles.burst(pad.x, pad.y + 0.2, pad.z, Math.ceil(24 * this.pm), 8, pad.color, 0.1, 0.7, 4, 1.2);
          break;
        }
      }
    }

    // landing
    if (!b.wasGround && b.onGround && b.landVy < -4) {
      const impact = -b.landVy;
      P.landDip = Math.max(P.landDip, Math.min(0.3, impact * 0.016));
      if (impact > 6) {
        audio.play('land', { vol: Math.min(1, impact / 18) });
        this.fx.particles.burst(b.x, b.y + 0.05, b.z, Math.ceil(impact * 0.8 * this.pm), 3 + impact * 0.2, 0xcfc8f0, 0.1, 0.5, 6, 0.4);
      }
      if (impact > 14) this.addTrauma(Math.min(0.3, impact * 0.012));
      if (crouchKey && hv > 8.5 && P.slideCd <= 0) this.startSlide();
    }
    P.slideW = lerp(P.slideW, P.sliding ? 1 : 0, Math.min(1, dt * 10));
    P.sprintT = lerp(P.sprintT, P.sprinting && hv > 5 ? 1 : 0, Math.min(1, dt * 8));
    P.landDip = Math.max(0, P.landDip - dt * 1.6);
    P.stepOff *= Math.exp(-dt * 12);
    P.hv = hv;

    // bob + footsteps
    if (b.onGround && !P.sliding && hv > 2.5) {
      const prev = Math.floor(P.bobPhase / Math.PI);
      P.bobPhase += hv * dt * 0.62;
      P.bobAmp = lerp(P.bobAmp, Math.min(1, hv / 9), Math.min(1, dt * 8));
      if (Math.floor(P.bobPhase / Math.PI) !== prev) audio.play('step', { vol: P.crouching ? 0.4 : P.sprinting ? 1.2 : 0.8 });
    } else P.bobAmp = lerp(P.bobAmp, 0, Math.min(1, dt * 6));
    // slide sound handled at start

    // death by falling out of the world
    if (b.y < -30) this.damage(p, 999, null, false, 'rifle', b.x, b.y, b.z, 0, 1, 0);

    // pointer / health regen none. crouch toggle reset on death handled in spawn
    this.vfx.yaw = p.yaw;
  }

  private touchJumpHeld() {
    return this.touch && this.input.isDown('Space');
  }

  private startSlide() {
    const P = this.P;
    const b = this.player.body;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.5) return;
    P.sliding = true;
    P.slideT = 1.4;
    const target = Math.max(sp, 13.2 * this.pSpeed());
    const k = Math.min(1.35, target / sp);
    b.vx *= k;
    b.vz *= k;
    b.h = CROUCH_H;
    P.fovPunch += 6;
    audio.play('slide');
    this.addTrauma(0.08);
    this.fx.particles.burst(b.x, b.y + 0.1, b.z, Math.ceil(10 * this.pm), 4, 0xcfc8f0, 0.09, 0.5, 5, 0.4);
  }

  private addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  private updateDead(dt: number, rdt: number) {
    const P = this.P;
    const p = this.player;
    P.deadT += rdt;
    p.respawnT -= dt;
    const b = p.body;
    b.vx *= 0.92; b.vz *= 0.92;
    b.vy -= this.gravity * dt;
    this.world.moveBody(b, dt);
    // look toward killer
    if (p.killer) {
      const k = p.killer.body;
      const target = Math.atan2(-(k.x - b.x), -(k.z - b.z));
      p.yaw += angDiff(p.yaw, target) * Math.min(1, rdt * 3);
    }
    P.eye = lerp(P.eye, 0.35, Math.min(1, rdt * 4));
    if (this.state === 'playing' && ((p.respawnT <= 0) || (P.deadT > 1.0 && (this.input.firePressed || this.input.pressed('Space'))))) {
      this.spawnFighter(p);
    }
  }

  /* ================================================================ weapons */
  private curDef(): WeaponDef {
    return this.defs[this.W.list[this.W.cur]];
  }

  private switchTo(i: number) {
    const W = this.W;
    if (i === W.cur || i < 0 || i >= W.list.length) return;
    W.cur = i;
    W.reloadT = 0;
    W.switchT = 0.3;
    audio.play('switch');
    this.selectViewmodel();
  }

  private startReload() {
    const W = this.W;
    const def = this.curDef();
    if (W.reloadT > 0 || W.ammo[W.cur] >= def.mag || def.reload <= 0) return;
    W.reloadT = def.reload;
    W.reloadDur = def.reload;
    audio.play('reload');
  }

  private updateWeapon(dt: number) {
    const W = this.W;
    const inp = this.input;
    const p = this.player;
    W.fireCd -= dt;
    W.switchT -= dt;
    W.fireBuf -= dt;
    W.flashT -= dt;
    W.bloom *= Math.exp(-dt * 5);
    if (!p.alive) return;
    const def = this.curDef();
    // switching
    for (let i = 0; i < W.list.length; i++) if (inp.pressed(this.digitKeys[i])) this.switchTo(i);
    if (inp.wheel !== 0 && W.list.length > 1) this.switchTo((W.cur + (inp.wheel > 0 ? 1 : W.list.length - 1)) % W.list.length);
    if (inp.pressed('KeyX') && W.list.length > 1) this.switchTo((W.cur + 1) % W.list.length);
    // reload
    if (W.reloadT > 0) {
      W.reloadT -= dt;
      if (W.reloadT <= 0) W.ammo[W.cur] = def.mag;
    }
    if (inp.pressed('KeyR')) this.startReload();
    if (inp.firePressed) W.fireBuf = 0.12;
    const want = def.auto || this.cheats.rapidFire ? inp.fireHeld : inp.firePressed || W.fireBuf > 0;
    if (want && W.fireCd <= 0 && W.switchT <= 0 && W.reloadT <= 0 && this.state === 'playing') {
      if (W.ammo[W.cur] <= 0 && !this.cheats.infiniteAmmo) {
        if (inp.firePressed) audio.play('empty');
        W.fireCd = 0.2;
        this.startReload();
      } else {
        this.playerShoot(def);
        W.fireBuf = 0;
      }
    }
  }

  private playerShoot(def: WeaponDef) {
    const W = this.W;
    const P = this.P;
    const p = this.player;
    const cam = this.camera;
    const C = this.cheats;
    if (C.aimbot) {
      this.applyAimbot(1 / 60);
      cam.rotation.set(p.pitch, p.yaw, cam.rotation.z, 'YXZ');
    }
    if (!this.insta && !C.infiniteAmmo) W.ammo[W.cur]--;
    W.fireCd = def.interval * (C.rapidFire ? 0.33 : 1);
    W.bloom = Math.min(W.bloom + def.bloom, 0.035);
    W.flashT = 0.055;
    p.shotsFired++;
    p.lastShotT = this.t;
    const yaw = p.yaw + P.recoilYaw;
    const pitch = p.pitch + P.recoil;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const ux = Math.sin(yaw) * fy, uy = -Math.sin(yaw) * fx - Math.cos(yaw) * fz, uz = Math.cos(yaw) * fy;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    const mx = ox + fx * 0.8 + rx * 0.17, my = oy + fy * 0.8 - 0.13 + uy * 0.0, mz = oz + fz * 0.8 + rz * 0.17;
    const moveSpread = Math.min(0.02, P.hv * 0.0014) + (p.body.onGround ? 0 : 0.015);
    const aimK = 1 - P.aimT * 0.55;
    const spread = C.noRecoil ? (def.pellets > 1 ? def.spread * 0.4 : 0) : (def.spread + (def.pellets > 1 ? 0 : W.bloom + moveSpread)) * aimK;
    this.hitFlag = false;
    if (def.id === 'rocket') {
      const tw = this.world.raycast(ox, oy, oz, fx, fy, fz, 120);
      const dist = Math.min(120, tw === Infinity ? 120 : tw);
      let dx = ox + fx * dist - mx, dy = oy + fy * dist - my, dz = oz + fz * dist - mz;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      this.spawnRocket(p, mx, my, mz, dx, dy, dz, def.speed);
    } else {
      for (let i = 0; i < def.pellets; i++) {
        const a = Math.random() * TAU;
        const rad = spread * Math.sqrt(Math.random());
        let dx = fx + rx * Math.cos(a) * rad + ux * Math.sin(a) * rad;
        let dy = fy + 0 * Math.cos(a) * rad + uy * Math.sin(a) * rad;
        let dz = fz + rz * Math.cos(a) * rad + uz * Math.sin(a) * rad;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        this.hitscan(p, ox, oy, oz, dx, dy, dz, def, mx, my, mz, 1);
      }
    }
    if (this.hitFlag) p.shotsHit++;
    // juice
    const rk = C.noRecoil ? 0.15 : 1;
    P.kick = Math.min(2.2, P.kick + def.kick * rk);
    P.vmKick = Math.min(1.6, P.vmKick + def.kick * 0.7);
    P.recoil += def.recoil * (C.noRecoil ? 0 : 1);
    P.recoilYaw += (Math.random() - 0.5) * def.recoil * 0.8 * (C.noRecoil ? 0 : 1);
    this.flash(mx, my, mz, def.color, def.id === 'rifle' ? 22 : 45, def.id === 'rail' ? 16 : 11, def.id === 'rifle' ? 0.06 : 0.12);
    this.addTrauma(def.shake * 0.5);
    if (def.id === 'rail') P.fovPunch += 5;
    if (def.id === 'shotgun') P.fovPunch += 2.5;
    audio.play(def.id as Sfx);
    this.fx.particles.burst(mx, my, mz, Math.ceil(3 * this.pm), 4, 0xffe9a0, 0.04, 0.15, 0, 0, fx, fy, fz, 1.5);
    this.alertBots(p);
  }

  private alertBots(src: Fighter) {
    let n = 0;
    const near = this.nearbyFighters(src.body.x, src.body.z, 55);
    for (let ni = 0; ni < near.length; ni++) {
      const f = near[ni];
      if (f.isPlayer || !f.alive || !f.ai || !this.aiCtx.isEnemy(f, src)) continue;
      const ddx = f.body.x - src.body.x, ddz = f.body.z - src.body.z;
      const d = Math.sqrt(ddx * ddx + ddz * ddz);
      if (d > 55 || f.ai.canSee) continue;
      if (Math.random() < this.diff.hear * (1 - d / 70) && n < 3) {
        n++;
        f.ai.target = src;
        f.ai.seenT = this.t;
        f.ai.lastX = src.body.x;
        f.ai.lastY = src.body.y;
        f.ai.lastZ = src.body.z;
        f.ai.reactT = this.diff.react;
        f.ai.path = [];
        f.ai.repathT = 0;
      }
    }
  }

  /** cast a ray; returns hits sorted by distance, world distance and normal */
  private trace(shooter: Fighter, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, hit: RayHit) {
    const tw = this.world.raycast(ox, oy, oz, dx, dy, dz, range, hit);
    const limit = Math.min(tw, range);
    const near = this.fightersAlongRay(ox, oz, dx, dz, limit);
    this.hitCount = 0;
    for (let ni = 0; ni < near.length; ni++) {
      const f = near[ni];
      if (f === shooter || !f.alive || f.gone) continue;
      if (this.teamMode && f.team === shooter.team) continue;
      const b = f.body;
      const tb = rayAABB(ox, oy, oz, dx, dy, dz, b.x - 0.32, b.y, b.z - 0.32, b.x + 0.32, b.y + b.h, b.z + 0.32);
      if (tb < 0 || tb > limit) continue;
      const hy = b.y + (b.h > 1.5 ? 1.55 : 0.98);
      const th = raySphere(ox, oy, oz, dx, dy, dz, b.x, hy, b.z, 0.25);
      if (this.hitCount >= this.hitPool.length) this.hitPool.push({ f, t: 0, head: false });
      const slot = this.hitPool[this.hitCount++];
      slot.f = f; slot.t = tb; slot.head = th >= 0;
    }
    // insertion sort by distance (tiny n, no allocation)
    for (let i = 1; i < this.hitCount; i++) {
      const cur = this.hitPool[i];
      let j = i - 1;
      while (j >= 0 && this.hitPool[j].t > cur.t) { this.hitPool[j + 1] = this.hitPool[j]; j--; }
      this.hitPool[j + 1] = cur;
    }
    return { tw, hits: this.hitPool, count: this.hitCount };
  }

  private hitscan(shooter: Fighter, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, def: WeaponDef, mx: number, my: number, mz: number, dmgMul: number) {
    const hit: RayHit = { nx: 0, ny: 1, nz: 0 };
    const { tw, hits, count: hitN } = this.trace(shooter, ox, oy, oz, dx, dy, dz, def.range, hit);
    let endT = tw === Infinity ? Math.min(def.range, def.pellets > 1 ? 45 : 140) : tw;
    const isRail = def.id === 'rail';
    const count = Math.min(def.pierce, hitN);
    for (let i = 0; i < count; i++) {
      const h = hits[i];
      const px = ox + dx * h.t, py = oy + dy * h.t, pz = oz + dz * h.t;
      if (i === 0 && !isRail) endT = h.t;
      const dmg = def.dmg * (h.head ? def.headMul : 1) * dmgMul;
      if (shooter.isPlayer) this.hitFlag = true;
      this.damage(h.f, dmg, shooter, h.head, def.id, px, py, pz, dx, dy, dz);
    }
    if (count === 0 && tw !== Infinity) {
      const px = ox + dx * tw, py = oy + dy * tw, pz = oz + dz * tw;
      this.impactFx(px, py, pz, hit.nx, hit.ny, hit.nz, def.id === 'rail' ? 0xff6fb5 : 0xffe9a0);
      if (shooter.isPlayer && this.cheats.explosive && Math.random() < (def.pellets > 1 ? 0.25 : 1)) this.explode(px + hit.nx * 0.2, py + hit.ny * 0.2, pz + hit.nz * 0.2, shooter, 3.2, 45, hit, true);
    } else if (count > 0 && shooter.isPlayer && this.cheats.explosive && Math.random() < (def.pellets > 1 ? 0.25 : 1)) {
      const h = hits[0];
      this.explode(ox + dx * h.t, oy + dy * h.t, oz + dz * h.t, shooter, 3.2, 45, hit, true);
    }
    // tracer visuals
    const ex = ox + dx * endT, ey = oy + dy * endT, ez = oz + dz * endT;
    const col = shooter.isPlayer ? def.color : this.teamplay ? shooter.color : 0xff6a5a;
    if (isRail) {
      this.fx.tracers.add(mx, my, mz, ex, ey, ez, col, 0.1, 0.4);
      this.fx.tracers.add(mx, my, mz, ex, ey, ez, 0xffffff, 0.035, 0.28);
      const n = Math.ceil(26 * this.pm);
      for (let i = 0; i < n; i++) {
        const t = Math.random();
        this.fx.particles.spawn(mx + (ex - mx) * t, my + (ey - my) * t, mz + (ez - mz) * t, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.5, 0.07, col, -1, 1);
      }
    } else if (def.pellets > 1) {
      this.fx.tracers.add(mx, my, mz, ex, ey, ez, col, def.tracer, 0.06);
    } else {
      this.fx.tracers.add(mx, my, mz, ex, ey, ez, col, def.tracer, 0.08);
    }
  }

  private impactFx(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number) {
    this.fx.particles.burst(x, y, z, Math.ceil(5 * this.pm), 5, color, 0.05, 0.3, 14, 0.2, nx, ny, nz, 1.2);
    this.fx.particles.burst(x, y, z, Math.ceil(2 * this.pm), 1.5, 0x9a94b8, 0.12, 0.5, -1, 0.5, nx, ny, nz, 0.8);
    if (this.pm > 0.5) this.fx.decals.add(x, y, z, nx, ny, nz, 0.2 + Math.random() * 0.15);
  }

  /* ================================================================ rockets */
  private spawnRocket(owner: Fighter, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number) {
    const r = this.rocketPool.find((q) => !q.active);
    if (!r) return;
    r.active = true;
    r.owner = owner;
    r.x = x; r.y = y; r.z = z;
    r.vx = dx * speed; r.vy = dy * speed; r.vz = dz * speed;
    r.age = 0;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    r.mesh.lookAt(x + dx, y + dy, z + dz);
  }

  private updateRockets(dt: number) {
    for (const r of this.rocketPool) {
      if (!r.active) continue;
      r.age += dt;
      const sp = Math.hypot(r.vx, r.vy, r.vz);
      const step = sp * dt;
      const dx = r.vx / sp, dy = r.vy / sp, dz = r.vz / sp;
      const hit: RayHit = { nx: 0, ny: 1, nz: 0 };
      const tw = this.world.raycast(r.x, r.y, r.z, dx, dy, dz, step + 0.15, hit);
      let boom = tw !== Infinity;
      let ex = r.x + dx * (boom ? Math.max(0, tw - 0.1) : step);
      let ey = r.y + dy * (boom ? Math.max(0, tw - 0.1) : step);
      let ez = r.z + dz * (boom ? Math.max(0, tw - 0.1) : step);
      if (!boom && r.age > 0.05) {
        for (const f of this.fighters) {
          if (!f.alive || f.gone || (f === r.owner && r.age < 0.25)) continue;
          if (this.teamMode && f.team === r.owner.team && f !== r.owner) continue;
          const b = f.body;
          if (ey > b.y - 0.1 && ey < b.y + b.h + 0.1 && Math.hypot(ex - b.x, ez - b.z) < 0.7) {
            boom = true;
            break;
          }
        }
      }
      if (boom) {
        r.active = false;
        r.mesh.visible = false;
        this.explode(ex, ey, ez, r.owner, this.defs.rocket.splash, this.defs.rocket.dmg, hit);
        continue;
      }
      r.x = ex; r.y = ey; r.z = ez;
      if (r.age > 6) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.position.set(ex, ey, ez);
      this.fx.particles.spawn(ex, ey, ez, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 0.45, 0.14, Math.random() < 0.5 ? 0xffb040 : 0xff6a30, 0, 2);
      if (this.pm > 0.5) this.fx.particles.spawn(ex, ey, ez, 0, 0.5, 0, 0.7, 0.2, 0x8a82a8, -0.5, 1.5);
    }
  }

  private explode(x: number, y: number, z: number, owner: Fighter, radius: number, dmg: number, hit: RayHit, small = false) {
    this.flash(x, y + 0.5, z, 0xff8a30, small ? 90 : 260, radius * 4.5, small ? 0.3 : 0.6);
    this.fx.blasts.add(x, y, z, radius * 0.95, 0xff9030, 0.6);
    this.fx.blasts.add(x, y, z, radius * 0.5, 0xfff0c0, 0.3);
    this.fx.particles.burst(x, y, z, Math.ceil(46 * this.pm), 15, 0xffa040, 0.2, 0.7, 10, 0.5);
    this.fx.particles.burst(x, y, z, Math.ceil(22 * this.pm), 10, 0xffe9a0, 0.1, 0.5, 6, 0.3);
    this.fx.particles.burst(x, y, z, Math.ceil(14 * this.pm), 6, 0x4a4468, 0.28, 1.1, -1, 0.8);
    this.fx.decals.add(x + hit.nx * 0.1, y + hit.ny * 0.1, z + hit.nz * 0.1, hit.nx, hit.ny, hit.nz, 2.4);
    const cam = this.camera.position;
    const dc = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    this.addTrauma(clamp(1 - dc / 40, 0, 1) * 0.85);
    this.sfxAt('explosion', x, y, z, 1.1, 90);
    for (const f of this.fighters) {
      if (!f.alive || f.gone) continue;
      const b = f.body;
      const cx = b.x, cy = b.y + 0.9, cz = b.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d > radius) continue;
      if (this.teamMode && f !== owner && f.team === owner.team) continue;
      if (small && f === owner) continue;
      const fall = 1 - d / radius;
      const self = f === owner;
      const nx = (cx - x) / (d || 1), ny = (cy - y) / (d || 1), nz = (cz - z) / (d || 1);
      const kb = (self ? 19 : 12) * Math.pow(fall, 0.7);
      if (f.spawnProt <= 0) {
        b.vx += nx * kb;
        b.vz += nz * kb;
        b.vy += Math.max(ny, 0.4) * kb * 1.05;
        b.onGround = false;
        if (f.isPlayer) {
          this.P.boostT = 1.2;
          this.P.sliding = false;
        }
      }
      const dm = dmg * (0.2 + 0.8 * fall) * (self ? 0.4 : owner.isPlayer ? 1 : this.diff.dmgMul);
      this.damage(f, dm, owner, false, 'rocket', cx, cy, cz, nx, ny, nz);
    }
  }

  private botFire(f: Fighter, target: Fighter, wid: WeaponId) {
    const def = this.defs[wid];
    const dp = this.diff;
    f.lastShotT = this.t;
    const ex = f.body.x, ey = f.body.y + 1.45, ez = f.body.z;
    const tb = target.body;
    const head = Math.random() < (dp.aimErr < 0.04 ? 0.22 : 0.1);
    let ax = tb.x, ay = tb.y + (head ? 1.52 : 1.05), az = tb.z;
    let dist = Math.hypot(ax - ex, ay - ey, az - ez);
    const lead = wid === 'rocket' ? dist / def.speed : wid === 'rail' ? 0.04 : 0;
    ax += tb.vx * lead;
    az += tb.vz * lead;
    dist = Math.hypot(ax - ex, ay - ey, az - ez);
    const err = Math.max(0.05, dist * dp.aimErr * (1 + Math.hypot(tb.vx, tb.vz) / 10));
    ax += (Math.random() * 2 - 1) * err;
    ay += (Math.random() * 2 - 1) * err * 0.6;
    az += (Math.random() * 2 - 1) * err;
    let dx = ax - ex, dy = ay - ey, dz = az - ez;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const mx = ex - Math.sin(f.yaw) * 0.7 + Math.cos(f.yaw) * 0.25, my = ey - 0.35, mz = ez - Math.cos(f.yaw) * 0.7 - Math.sin(f.yaw) * 0.25;
    const snd: Sfx = wid === 'shotgun' ? 'enemyShotgun' : wid === 'rail' ? 'enemyRail' : wid === 'rocket' ? 'rocket' : 'enemyShot';
    this.sfxAt(snd, ex, ey, ez, 0.9, 80);
    if (Math.hypot(ex - this.camera.position.x, ez - this.camera.position.z) < 35) this.flash(mx, my, mz, this.teamplay ? f.color : 0xff6a5a, 30, 9, 0.08);
    if (wid === 'rocket') {
      this.spawnRocket(f, mx, my, mz, dx, dy, dz, def.speed * 0.8);
      return;
    }
    const pellets = wid === 'shotgun' ? 6 : 1;
    for (let i = 0; i < pellets; i++) {
      let px = dx, py = dy, pz = dz;
      if (pellets > 1) {
        px += (Math.random() - 0.5) * 0.09;
        py += (Math.random() - 0.5) * 0.09;
        pz += (Math.random() - 0.5) * 0.09;
        const ll = Math.hypot(px, py, pz);
        px /= ll; py /= ll; pz /= ll;
      }
      this.hitscan(f, ex, ey, ez, px, py, pz, def, mx, my, mz, dp.dmgMul);
    }
  }

  /* ================================================================== damage */
  private damage(t: Fighter, amount: number, src: Fighter | null, head: boolean, wid: WeaponId, px: number, py: number, pz: number, dx: number, dy: number, dz: number): boolean {
    if (this.warmup || !t.alive || t.gone || t.spawnProt > 0 || this.over) return false;
    if (src && src !== t && this.teamMode && src.team === t.team) return false;
    if (t.isPlayer && (this.cheats.god || this.cheats.oneHp)) {
      if (this.cheats.oneHp) {
        t.hp = 1;
        t.armor = 0;
      }
      this.vfx.damage = Math.min(0.3, this.vfx.damage + 0.1);
      return false;
    }
    if (src && src.isPlayer && src !== t && this.cheats.oneShot) amount = 9999;
    // survival: every wave hits harder
    if (this.mode === 'survival' && t.isPlayer && src && !src.isPlayer) amount *= 1 + (this.wave - 1) * 0.12;
    let hp = amount;
    if (t.armor > 0) {
      const ab = Math.min(t.armor, amount * 0.6);
      t.armor -= ab;
      hp = amount - ab;
    }
    t.hp -= hp;
    t.lastHitT = this.t;
    const player = this.player;
    if (!t.isPlayer && t.view) t.view.flashT = 0.08;
    // sparks on hit
    this.fx.particles.burst(px, py, pz, Math.ceil((head ? 10 : 6) * this.pm), 5, head ? 0xff3b5c : t.isPlayer ? 0xff3b5c : t.color, 0.07, 0.4, 12, 0.3, -dx, -dy, -dz, 0.8);
    const dead = t.hp <= 0;
    if (src === player && t !== player) {
      this.emit({ type: 'hitmarker', head, kill: dead });
      if (this.settings.hitSounds) audio.play(dead ? 'kill' : head ? 'hitHead' : 'hit');
    }
    if (t.isPlayer) {
      const P = this.P;
      this.vfx.damage = Math.min(1, this.vfx.damage + Math.min(0.7, hp / 60) + 0.15);
      this.addTrauma(Math.min(0.55, 0.15 + hp / 90));
      P.fovPunch += 3;
      if (src && src !== t) {
        this.vfx.indicators.push({ ang: Math.atan2(-(src.body.x - t.body.x), -(src.body.z - t.body.z)), life: 1.6 });
        if (this.vfx.indicators.length > 6) this.vfx.indicators.shift();
      }
      if (!dead) audio.play('hurt', { vol: Math.min(1, 0.4 + hp / 50) });
    }
    if (dead) {
      this.kill(t, src, head, wid, dx, dy, dz);
      return true;
    }
    // bots react
    if (!t.isPlayer && t.ai && src && src !== t) {
      const ai = t.ai;
      if (!ai.canSee || !ai.target) {
        ai.target = src;
        ai.seenT = this.t;
        ai.lastX = src.body.x;
        ai.lastY = src.body.y;
        ai.lastZ = src.body.z;
        ai.reactT = Math.min(ai.reactT, this.diff.react * 0.5);
        ai.path = [];
      }
    }
    return false;
  }

  private kill(t: Fighter, src: Fighter | null, head: boolean, wid: WeaponId, dx: number, dy: number, dz: number) {
    const player = this.player;
    t.alive = false;
    t.hp = 0;
    t.deaths++;
    t.streak = 0;
    t.killer = src;
    t.respawnT = t.isPlayer ? 2.8 : 2.5 + Math.random() * 2;
    const b = t.body;
    let points = 0;
    if (src && src !== t) {
      src.kills++;
      src.streak++;
      src.bestStreak = Math.max(src.bestStreak, src.streak);
      if (head) src.headshots++;
      if (this.t - src.multiT < 3.4) src.multiN++;
      else src.multiN = 1;
      src.multiT = this.t;

      if (this.mode === 'ctf' || this.mode === 'koth') {
        // In CTF and KOTH, score only increases via objective play (flag captures / holding the hill)
        points = 0;
      } else if (this.mode === 'bounty') {
        // In Bounty, hunting down the marked target is the only way to score points
        if (t.id === this.bountyId) {
          points = 1;
          src.score += 1;
          this.bountyId = -1;
          this.aiCtx.bountyId = -1;
          this.emit({ type: 'announce', text: 'BOUNTY CLAIMED', sub: `+1 BOUNTY · ${t.name}`, tone: 'streak' });
        } else {
          points = 0;
        }
      } else {
        points = 100 + (head ? 50 : 0) + Math.min(100, (src.streak - 1) * 10) + (src.multiN - 1) * 50;
        src.score += points;
        if (this.mode === 'tdm') this.teamScore[src.team]++;
      }

      if (this.mode === 'survival' && src.team === 0 && t.team === 1) {
        this.waveKills++;
        const need = 5 + (this.wave - 1) * 2;
        if (this.waveKills >= need) {
          this.waveKills = 0;
          this.wave++;
          for (const surv of this.fighters) {
            if (surv.team === 0 && !surv.gone) {
              if (surv.alive && !(surv.isPlayer && this.cheats.oneHp)) surv.hp = Math.min(100, surv.hp + 35);
              else if (!surv.alive && !surv.isPlayer) this.spawnFighter(surv);
            }
          }
          if (this.fighters.filter((x) => x.team === 1).length < 18) {
            const extra = this.makeBot(1, this.fighters.length);
            this.fighters.push(extra);
            this.spawnFighter(extra);
          }
          this.emit({ type: 'announce', text: `WAVE ${this.wave}`, sub: '+35 HP · hostile reinforcements incoming', tone: 'streak' });
          audio.play('streak');
        }
      }
    }
    // gibs
    const col = t.isPlayer ? 0xff3b5c : t.color;
    this.fx.particles.burst(b.x, b.y + 1, b.z, Math.ceil(26 * this.pm), 8, col, 0.16, 0.9, 20, 0.6, dx, dy, dz, 0.7);
    this.fx.particles.burst(b.x, b.y + 1, b.z, Math.ceil(14 * this.pm), 9, 0xffffff, 0.07, 0.5, 14, 0.4);
    this.fx.blasts.add(b.x, b.y + 1, b.z, 1.8, col, 0.45);
    this.flash(b.x, b.y + 1.2, b.z, col, 120, 12, 0.5);
    this.sfxAt('explosion', b.x, b.y, b.z, 0.35, 45);
    if (t.view) t.view.group.visible = false;
    this.emit({
      type: 'kill', killer: src?.name ?? 'WORLD', victim: t.name, weapon: WEAPONS[wid].name, headshot: head,
      killerTeam: src?.team ?? -1, victimTeam: t.team, mine: src === player && t !== player ? 'killer' : t === player ? 'victim' : null,
    });
    if (src === player && t !== player) {
      const P = this.P;
      P.fovPunch += 6;
      this.addTrauma(0.2);
      this.vfx.flash = Math.max(this.vfx.flash, 0.25);
      this.emit({ type: 'announce', text: head ? 'HEADSHOT' : 'ELIMINATED', sub: t.name, points, tone: 'good' });
      const s = player.streak;
      const m = player.multiN;
      if (m >= 2) {
        const names = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'RAMPAGE'];
        this.later(() => {
          this.emit({ type: 'announce', text: names[Math.min(5, m)], sub: `+${(m - 1) * 50} BONUS`, tone: 'streak' });
          audio.play('streak');
        }, 250);
      } else if (s === 3 || s === 5 || s === 7 || s >= 10 && s % 5 === 0) {
        const nm = s === 3 ? 'KILLING SPREE' : s === 5 ? 'UNSTOPPABLE' : s === 7 ? 'DOMINATING' : 'GODLIKE';
        this.later(() => {
          this.emit({ type: 'announce', text: nm, sub: `${s} KILL STREAK`, tone: 'streak' });
          audio.play('streak');
        }, 250);
      }
    }
    if (t === player) {
      this.P.deadT = 0;
      this.P.sliding = false;
      this.P.dashT = 0;
      audio.play('die');
      this.addTrauma(0.7);
      this.vfx.damage = 1;
      this.emit({ type: 'announce', text: 'YOU DIED', sub: src && src !== t ? `Fragged by ${src.name}` : 'Self-destruct', tone: 'bad' });
    }
    // trash talk
    if (t === player && this.mode === 'survival') this.endMatch('death');
    if (t.kind === 'fake') t.frustration = clamp(t.frustration + 0.16, 0, 1);
    if (src && src.kind === 'fake') src.frustration = clamp(src.frustration - 0.1, 0, 1);
    if (src && src !== t && src.kind === 'fake' && Math.random() < 0.1) this.say(src, t.frustration > 0.6 ? 'insult' : 'kill');
    else if (t.kind === 'fake' && Math.random() < 0.08) this.say(t, t.frustration > 0.6 ? 'frustrated' : 'death');
    this.scoreDirty = true;
    this.checkWin();
  }

  private checkWin() {
    if (this.over || this.warmup) return;
    const lim = this.rules.scoreLimit;
    if (this.mode === 'survival') {
      // survival is decided by waves reached (or by dying, see kill())
      if (lim > 0 && this.wave >= lim) this.endMatch('limit');
      return;
    }
    if (lim <= 0) return;
    if (this.mode === 'tdm' || this.mode === 'ctf') {
      if (this.teamScore[0] >= lim || this.teamScore[1] >= lim) this.endMatch('limit');
    } else if (this.mode === 'koth' || this.mode === 'bounty') {
      const top = Math.max(...this.fighters.map((f) => f.score));
      if (top >= lim) this.endMatch('limit');
    } else {
      for (const f of this.fighters) if (f.kills >= lim) {
        this.endMatch('limit');
        return;
      }
    }
  }

  private endMatch(reason: 'limit' | 'time' | 'death') {
    if (this.over) return;
    const p = this.player;
    this.scoreDirty = true;
    const rows = this.getScoreboard();
    let won = false;
    let winnerName = '';
    let rank = 1;
    if (this.teamplay) {
      const [a, b] = this.teamScore;
      const wt = a === b ? -1 : a > b ? 0 : 1;
      won = wt === p.team;
      winnerName = wt < 0 ? 'DRAW' : wt === 0 ? 'CYAN TEAM' : 'MAGENTA TEAM';
      rank = rows.findIndex((r) => r.isPlayer) + 1;
    } else {
      rank = rows.findIndex((r) => r.isPlayer) + 1;
      won = rank === 1;
      winnerName = rows[0]?.name ?? '';
    }
    if (this.mode === 'survival') {
      won = this.rules.scoreLimit > 0 && this.wave >= this.rules.scoreLimit;
      winnerName = `WAVE ${this.wave}`;
    }
    this.over = { winner: winnerName, reason };
    const isObjMode = this.mode === 'ctf' || this.mode === 'koth' || this.mode === 'bounty';
    const score = isObjMode ? p.score : p.score + (won ? 500 : 0);
    const res: MatchResult = {
      id: this.matchId, won, rank, total: rows.length, score, kills: p.kills, deaths: p.deaths, headshots: p.headshots,
      accuracy: p.shotsFired ? p.shotsHit / p.shotsFired : 0, bestStreak: p.bestStreak, duration: this.t, rows, winnerName,
      teamplay: this.teamplay, myTeam: p.team, teamScores: [...this.teamScore] as [number, number], reason, cheated: this.cheated,
    };
    this.input.releaseAll();
    this.state = 'over';
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    audio.play(won ? 'win' : 'lose');
    this.emit({ type: 'announce', text: won ? 'VICTORY' : this.teamplay && winnerName === 'DRAW' ? 'DRAW' : 'DEFEAT', sub: reason === 'time' ? 'TIME UP' : reason === 'death' ? 'OVERRUN' : 'SCORE LIMIT', tone: won ? 'good' : 'bad' });
    this.handlers.onState('over');
    this.handlers.onOver(res);
  }

  /* ================================================================ pickups */
  private updatePickups(dt: number) {
    const p = this.player;
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.t -= dt;
        if (pk.t <= 0) {
          pk.active = true;
          pk.group.visible = true;
        }
        continue;
      }
      const near = this.nearbyFighters(pk.x, pk.z, 2);
      for (let ni = 0; ni < near.length; ni++) {
        const f = near[ni];
        if (!f.alive || f.gone) continue;
        const b = f.body;
        if (Math.abs(b.x - pk.x) > 1.2 || Math.abs(b.z - pk.z) > 1.2 || b.y - pk.y > 1.2 || b.y - pk.y < -1.8) continue;
        if (pk.type === 'health' && f.hp >= 100) continue;
        if (pk.type === 'armor' && f.armor >= 100) continue;
      if (f.isPlayer && this.cheats.oneHp) continue;
      if (pk.type === 'health') f.hp = Math.min(100, f.hp + 50);
      else f.armor = Math.min(100, f.armor + 60);
        pk.active = false;
        pk.t = 18;
        pk.group.visible = false;
        this.fx.blasts.add(pk.x, pk.y + 0.5, pk.z, 1.5, pk.type === 'health' ? 0x7dff6b : 0x2de2ff, 0.45, true);
        this.fx.particles.burst(pk.x, pk.y + 1, pk.z, Math.ceil(12 * this.pm), 4, pk.type === 'health' ? 0x7dff6b : 0x2de2ff, 0.08, 0.6, -3, 1);
        if (f === p) {
          audio.play(pk.type === 'health' ? 'pickupHealth' : 'pickupArmor');
          this.vfx.heal = 1;
          this.emit({ type: 'pickup', text: pk.type === 'health' ? '+50 HEALTH' : '+60 ARMOR', color: pk.type === 'health' ? '#7dff6b' : '#2de2ff' });
        }
        break;
      }
    }
  }

  private animatePickups(dt: number) {
    void dt;
    const t = this.time;
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      const core = pk.group.getObjectByName('core');
      if (core) {
        core.rotation.y = t * 2;
        core.position.y = 0.95 + Math.sin(t * 2.5 + pk.x) * 0.1;
      }
    }
  }

  /* ================================================================== camera */
  private updateCamera(dt: number) {
    const P = this.P;
    const p = this.player;
    const b = p.body;
    const cam = this.camera;
    const s = this.settings;
    const inp = this.input;
    const ax = inp.axes();
    const k = this.keyCache;
    k.PeekQ = inp.isDown('KeyQ'); k.PeekE = inp.isDown('KeyE');
    // trauma shake
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const tr = this.trauma * this.trauma * s.screenShake;
    const tt = this.time;
    const shP = (Math.sin(tt * 41) + Math.sin(tt * 67.3)) * 0.5 * tr * 0.05;
    const shY = (Math.sin(tt * 37.1 + 1) + Math.sin(tt * 59.7)) * 0.5 * tr * 0.05;
    const shR = (Math.sin(tt * 31.7 + 2) + Math.sin(tt * 47)) * 0.5 * tr * 0.06;
    // recoil recovery
    P.recoil *= Math.exp(-dt * 7);
    P.recoilYaw *= Math.exp(-dt * 7);
    P.kick *= Math.exp(-dt * 16);
    P.vmKick *= Math.exp(-dt * 12);
    P.fovPunch *= Math.exp(-dt * 7);
    let roll = 0;
    let bobY = 0;
    let bobX = 0;
    if (p.alive) {
      const tiltTarget = -ax.x * 0.022 * (P.sliding ? 0.5 : 1) + (P.sliding ? 0.06 : 0);
      P.tilt = lerp(P.tilt, tiltTarget, Math.min(1, dt * 9));
      roll = P.tilt;
      if (s.headBob) {
        bobY = Math.sin(P.bobPhase * 2) * 0.03 * P.bobAmp;
        bobX = Math.cos(P.bobPhase) * 0.015 * P.bobAmp;
        roll += Math.cos(P.bobPhase) * 0.004 * P.bobAmp;
      }
    } else {
      roll = lerp(0, 0.6, Math.min(1, P.deadT * 2));
    }
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const peekIn = s.peek ? (k.PeekE ? 1 : 0) - (k.PeekQ ? 1 : 0) : 0;
    P.peek = lerp(P.peek, peekIn, Math.min(1, dt * 12));
    let px = b.x + rx * bobX, pz = b.z + rz * bobX;
    if (Math.abs(P.peek) > 0.02) {
      const off = P.peek * 0.45;
      const tx = px + rx * off, tz = pz + rz * off;
      if (!this.world.anyOverlap(tx - 0.18, b.y + 0.25, tz - 0.18, tx + 0.18, b.y + 1.65, tz + 0.18)) { px = tx; pz = tz; }
      roll += P.peek * 0.1;
    }
    cam.position.set(px, b.y + P.eye + bobY - P.landDip + P.stepOff, pz);
    cam.rotation.set(p.pitch + P.recoil + P.kick * 0.012 + shP, p.yaw + P.recoilYaw + shY, roll + shR, 'YXZ');
    this.cameraDirty = true;
    // fov: only update the projection matrix when the value actually changed beyond a threshold
    const base = s.fov;
    let fov = base * lerp(1, 0.66, P.aimT) + P.sprintT * 5 + P.slideW * 7 + P.fovPunch + Math.max(0, Math.min(6, (P.hv - 11) * 0.5));
    if (P.dashT > 0) fov += 6;
    P.fovCur = lerp(P.fovCur, fov, Math.min(1, dt * 12));
    if (Math.abs(cam.fov - P.fovCur) > 0.05 || this.cameraDirty) {
      cam.fov = P.fovCur;
      cam.updateProjectionMatrix();
      this.cameraDirty = false;
    }
    this.vfx.fov = (cam.fov * Math.PI) / 180;
    // sun follows
    this.followSun(b.x, b.z);
    // audio listener awareness via camera orientation is computed in sfxAt
  }

  private updateViewmodel(dt: number) {
    const P = this.P;
    const W = this.W;
    const p = this.player;
    const inp = this.input;
    const firing = W.flashT > 0 || (inp.fireHeld && W.fireCd > 0.02) || W.reloadT > 0;
    const root = this.vmRoot;
    const def = this.curDef();
    const aim = P.aimT;
    // sway from look delta
    const dyaw = angDiff(P.lastYaw, p.yaw);
    const dpitch = p.pitch - P.lastPitch;
    P.lastYaw = p.yaw;
    P.lastPitch = p.pitch;
    P.swayX = lerp(P.swayX, clamp(dyaw * 1.8, -0.07, 0.07), Math.min(1, dt * 10));
    P.swayY = lerp(P.swayY, clamp(-dpitch * 1.8, -0.05, 0.05), Math.min(1, dt * 10));
    let px = lerp(0.2, 0.0, aim);
    let py = lerp(-0.19, -0.125, aim);
    let pz = lerp(-0.42, -0.34, aim);
    let rotX = 0, rotY = 0, rotZ = 0;
    px += P.swayX * 0.6;
    py += P.swayY * 0.6;
    rotY += P.swayX * 1.2;
    rotX += -P.swayY * 1.2;
    const bob = this.settings.headBob ? P.bobAmp : 0;
    px += Math.cos(P.bobPhase) * 0.012 * bob;
    py += Math.abs(Math.sin(P.bobPhase)) * -0.016 * bob;
    // sprint pose — suppressed while shooting / reloading
    const sprintPose = firing ? 0 : P.sprintT * (1 - aim);
    px -= 0.06 * sprintPose;
    py -= 0.045 * sprintPose;
    rotX += 0.28 * sprintPose;
    rotY += -0.45 * sprintPose;
    // slide tilt
    rotZ += 0.28 * P.slideW;
    py -= 0.03 * P.slideW;
    // kick
    pz += P.vmKick * 0.055;
    rotX += P.vmKick * 0.09;
    // reload
    if (W.reloadT > 0) {
      const prog = 1 - W.reloadT / Math.max(0.01, W.reloadDur);
      const s = Math.sin(prog * Math.PI);
      rotX += -0.9 * s;
      rotZ += 0.35 * s;
      py -= 0.1 * s;
      px -= 0.03 * s;
    }
    // switch
    if (W.switchT > 0) {
      const sw = clamp(W.switchT / 0.3, 0, 1);
      py -= 0.32 * sw;
      rotX -= 0.7 * sw;
    }
    // dash push
    if (P.dashT > 0) pz += 0.05;
    root.position.set(px, py, pz);
    root.rotation.set(rotX, rotY, rotZ);
    const vm = this.vmAll[W.list[W.cur]];
    if (vm) {
      const on = W.flashT > 0;
      vm.flash.visible = on;
      if (on) {
        vm.flash.scale.setScalar(0.7 + Math.random() * 0.7);
        vm.flash.rotation.z = Math.random() * 6;
      }
    }
    // crosshair spread
    const moveSpread = Math.min(0.02, P.hv * 0.0014) + (p.body.onGround ? 0 : 0.015);
    this.vfx.spread = (def.pellets > 1 ? def.spread : def.spread + W.bloom + moveSpread) * (1 - aim * 0.55) + 0.004;
    this.vfx.yaw = p.yaw;
  }

  private updateVfx(dt: number) {
    const v = this.vfx;
    const p = this.player;
    v.damage = Math.max(0, v.damage - dt * 1.3);
    v.heal = Math.max(0, v.heal - dt * 2.2);
    v.flash = Math.max(0, v.flash - dt * 2.5);
    const speedT = clamp((this.P.hv - 10) / 9, 0, 1) * (p.alive ? 1 : 0);
    v.speed = lerp(v.speed, this.P.dashT > 0 ? 1 : speedT, Math.min(1, dt * 8));
    v.low = p.alive && p.hp < 35 ? 1 - p.hp / 35 : 0;
    for (let i = v.indicators.length - 1; i >= 0; i--) {
      v.indicators[i].life -= dt;
      if (v.indicators[i].life <= 0) {
        v.indicators[i] = v.indicators[v.indicators.length - 1];
        v.indicators.pop();
      }
    }
  }

  /* =================================================================== audio */
  private sfxAt(name: Sfx, x: number, y: number, z: number, vol: number, range: number) {
    const cam = this.camera;
    const dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return;
    const rx = Math.cos(this.player.yaw), rz = -Math.sin(this.player.yaw);
    const pan = d < 1 ? 0 : ((dx * rx + dz * rz) / d) * 0.9;
    const g = vol / (1 + d * 0.07);
    audio.play(name, { vol: g, pan });
  }

  /* ===================================================================== hud */
  private makeHud(): HudState {
    const p = this.player;
    const W = this.W;
    const def = this.curDef();
    const rows = this.getScoreboard();
    const lead = this.teamplay ? null : rows[0];
    const rank = rows.findIndex((r) => r.isPlayer) + 1;
    const hv = this.P.hv;
    if (this.weaponsCache.length !== W.list.length) this.weaponsCache = W.list.map((id, i) => ({ id, name: this.defs[id].name, ammo: W.ammo[i], mag: this.defs[id].mag }));
    else W.list.forEach((id, i) => { const w = this.weaponsCache[i]; w.ammo = W.ammo[i]; w.name = this.defs[id].name; w.mag = this.defs[id].mag; w.id = id; });
    const bounty = this.fighters.find((f) => f.id === this.bountyId);
    const hillOwner = this.hillOwner();
    const bountyRel = bounty && bounty.alive ? angDiff(p.yaw, Math.atan2(-(bounty.body.x - p.body.x), -(bounty.body.z - p.body.z))) : null;
    const bountyDist = bounty ? Math.hypot(bounty.body.x - p.body.x, bounty.body.z - p.body.z) : 0;
    const h: HudState = {
      hp: Math.max(0, Math.ceil(p.hp)),
      armor: Math.ceil(p.armor),
      ammo: W.ammo[W.cur],
      mag: def.mag,
      reload: W.reloadT > 0 ? 1 - W.reloadT / Math.max(0.01, W.reloadDur) : 0,
      weapon: def.id,
      weaponName: def.name,
      weapons: W.list.map((id, i) => ({ id, name: this.defs[id].name, ammo: W.ammo[i], mag: this.defs[id].mag })),
      cur: W.cur,
      dash: clamp(1 - this.P.dashCd / (this.rules.mutator === 'turbo' ? 1.2 : 1.7), 0, 1),
      speed: hv,
      // During warmup the match clock is frozen (timer disabled until the match actually starts)
      timeLeft: this.warmup ? (this.rules.timeLimit > 0 ? this.rules.timeLimit + this.extraTime : 0) : this.rules.timeLimit > 0 ? Math.max(0, this.rules.timeLimit + this.extraTime - this.t) : 0,
      scoreLimit: this.rules.scoreLimit,
      mode: this.rules.mode,
      myKills: p.kills,
      deaths: p.deaths,
      streak: p.streak,
      points: p.score,
      leaderName: lead ? lead.name : '',
      leaderKills: lead ? lead.kills : 0,
      teamScores: [...this.teamScore] as [number, number],
      myTeam: p.team,
      rank,
      total: rows.length,
      alive: p.alive,
      respawnIn: p.alive ? 0 : Math.max(0, p.respawnT),
      killer: p.killer?.name ?? '',
      fps: Math.round(this.fps),
      ping: Math.round(p.ping),
      aiming: this.P.aimT > 0.5,
      sliding: this.P.sliding,
      protect: p.spawnProt > 0,
      airJumps: this.P.airJumps,
      cheats: Object.values(this.cheats).some(Boolean),
      assist: !!this.aimTarget && this.settings.aimAssist > 0,
      modeName: this.mode === 'ffa' ? 'DEATHMATCH' : this.mode === 'tdm' ? 'TEAM DEATHMATCH' : this.mode === 'insta' ? 'INSTAGIB' : this.mode === 'duel' ? 'DUEL' : this.mode === 'ctf' ? 'CAPTURE THE FLAG' : this.mode === 'koth' ? 'KING OF THE HILL' : this.mode === 'survival' ? 'SURVIVAL' : 'BOUNTY',
      hill: this.mode === 'koth' && this.inHill(this.player),
      hillOwner: this.mode === 'koth' ? hillOwner : '',
      wave: this.wave,
      bounty: bounty ? bounty.name : '',
      flagStatus: this.flagStatus(),
      fakeCount: this.fighters.filter((f) => f.kind === 'fake').length,
      timeLimit: this.rules.timeLimit,
      leaderScore: lead ? lead.score : 0,
      bountyRel,
      bountyDist,
      warmup: this.warmup,
    };
    return h;
  }

  /** draws the rotating radar into a canvas */
  drawMinimap(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const view = 78; // world units across
    const k = size / view;
    const p = this.player;
    const yaw = this.state === 'intro' ? 0 : p.yaw;
    const m = this.map;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,4,24,0.85)';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(yaw);
    const is = k / m.scale;
    ctx.save();
    ctx.scale(is, is);
    ctx.translate(-((p.body.x + this.level.w / 2) * m.scale + m.offX), -((p.body.z + this.level.d / 2) * m.scale + m.offY));
    ctx.globalAlpha = 0.9;
    ctx.drawImage(m.canvas, 0, 0);
    ctx.restore();
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      ctx.fillStyle = pk.type === 'health' ? '#7dff6b' : '#2de2ff';
      ctx.fillRect((pk.x - p.body.x) * k - 2, (pk.z - p.body.z) * k - 2, 4, 4);
    }
    for (const f of this.fighters) {
      if (f.isPlayer || !f.alive || f.gone) continue;
      const dx = f.body.x - p.body.x, dz = f.body.z - p.body.z;
      const friendly = this.teamMode && f.team === p.team;
      const d = Math.hypot(dx, dz);
      const spotted = friendly || this.t - f.lastShotT < 1.8 || d < 14;
      if (!spotted) continue;
      ctx.fillStyle = friendly ? '#2de2ff' : '#ff3b5c';
      ctx.beginPath();
      ctx.arc(dx * k, dz * k, 3.4, 0, TAU);
      ctx.fill();
      // facing tick
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(dx * k, dz * k);
      ctx.lineTo(dx * k - Math.sin(f.yaw) * 8, dz * k - Math.cos(f.yaw) * 8);
      ctx.stroke();
    }
    ctx.restore();
    // player arrow
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(this.state === 'intro' ? -yaw : 0);
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
