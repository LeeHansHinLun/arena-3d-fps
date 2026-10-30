import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBody } from './world';
import type { Difficulty, WeaponId } from './types';

export interface AIState {
  path: number[];
  pathIdx: number;
  repathT: number;
  target: Fighter | null;
  seenT: number;
  canSee: boolean;
  lastX: number;
  lastY: number;
  lastZ: number;
  reactT: number;
  scanT: number;
  strafeDir: number;
  strafeT: number;
  px: number;
  pz: number;
  stuckT: number;
  stuckN: number;
  fireCd: number;
  burstLeft: number;
  burstPause: number;
  weapon: WeaponId;
  weaponT: number;
  jumpCd: number;
  wantX: number;
  wantZ: number;
}

export function newAI(): AIState {
  return {
    path: [], pathIdx: 0, repathT: 0, target: null, seenT: -99, canSee: false, lastX: 0, lastY: 0, lastZ: 0,
    reactT: 0, scanT: Math.random() * 0.3, strafeDir: 1, strafeT: 0, px: 0, pz: 0, stuckT: 0, stuckN: 0,
    fireCd: 0, burstLeft: 0, burstPause: 0, weapon: 'rifle', weaponT: 0, jumpCd: 0, wantX: 0, wantZ: 0,
  };
}

export class Fighter {
  body = makeBody();
  yaw = 0;
  pitch = 0;
  hp = 100;
  armor = 0;
  alive = false;
  kills = 0;
  deaths = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  headshots = 0;
  shotsFired = 0;
  shotsHit = 0;
  ping = 40;
  /** warmup ready-up flag (always false once the round is live) */
  ready = false;
  spawnProt = 0;
  respawnT = 0;
  lastShotT = -99;
  lastHitT = -99;
  multiN = 0;
  multiT = 0;
  weapon: WeaponId = 'rifle';
  view: BotView | null = null;
  ai: AIState | null = null;
  moveSpeed = 0;
  stepPhase = 0;
  killer: Fighter | null = null;
  gone = false;
  kind: 'player' | 'fake' | 'bot' = 'bot';
  skill: Difficulty = 'normal';
  frustration = 0;
  /** auto-rolled or server-provided skill, kept stable across respawns */
  profileSkill?: Difficulty;
  region = 'EU';
  carrying = -1;
  hillT = 0;
  espVisible = false;
  espVisT = 0;

  constructor(public id: number, public name: string, public team: number, public isPlayer: boolean, public color: number, kind: 'player' | 'fake' | 'bot' = 'bot') {
    this.kind = kind;
  }

  get eyeY() {
    return this.body.y + (this.body.h > 1.5 ? 1.55 : 1.0);
  }
  get cx() { return this.body.x; }
  get cz() { return this.body.z; }
}

/* ------------------------------------------------------------------ bot mesh */
function part(w: number, h: number, d: number, x: number, y: number, z: number, shade: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
  return g;
}

let geos: { armor: THREE.BufferGeometry; visor: THREE.BufferGeometry; leg: THREE.BufferGeometry } | null = null;
function getGeos() {
  if (geos) return geos;
  const armor = mergeGeometries([
    part(0.5, 0.55, 0.3, 0, 1.05, 0, 1),
    part(0.4, 0.2, 0.28, 0, 0.76, 0, 0.12),
    part(0.3, 0.3, 0.3, 0, 1.5, 0, 0.9),
    part(0.2, 0.2, 0.3, -0.36, 1.28, 0, 1),
    part(0.2, 0.2, 0.3, 0.36, 1.28, 0, 1),
    part(0.12, 0.45, 0.14, -0.36, 1.0, -0.02, 0.14),
    part(0.12, 0.12, 0.5, 0.3, 1.04, -0.3, 0.14),
    part(0.12, 0.12, 0.4, -0.18, 1.06, -0.28, 0.14),
    part(0.1, 0.13, 0.6, 0.22, 1.08, -0.55, 0.28),
    part(0.3, 0.4, 0.16, 0, 1.1, 0.23, 0.5),
  ])!;
  const visor = part(0.24, 0.08, 0.04, 0, 1.52, -0.16, 1);
  const leg = part(0.17, 0.72, 0.2, 0, -0.36, 0, 0.12);
  geos = { armor, visor, leg };
  return geos;
}

const armorMats = new Map<number, THREE.MeshStandardMaterial>();
const visorMats = new Map<number, THREE.MeshBasicMaterial>();
let legMat: THREE.MeshStandardMaterial | null = null;
let flashMat: THREE.MeshBasicMaterial | null = null;

function armorMat(c: number) {
  let m = armorMats.get(c);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.55, metalness: 0.25 });
    armorMats.set(c, m);
  }
  return m;
}
function visorMat(c: number) {
  let m = visorMats.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.5), toneMapped: false });
    visorMats.set(c, m);
  }
  return m;
}

function nameTexture(name: string, color: number) {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 84;
  const g = c.getContext('2d')!;
  const accent = '#' + new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25).getHexString();
  const bright = '#' + new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.65).getHexString();
  g.font = '700 32px Rajdhani, "Segoe UI", system-ui, sans-serif';
  const tw = Math.min(310, Math.max(120, g.measureText(name).width));
  const pw = tw + 48;
  const px = (384 - pw) / 2;
  const py = 14;
  const ph = 56;
  const cut = 10;

  // Angled badge backdrop
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + pw - cut, py);
  g.lineTo(px + pw, py + cut);
  g.lineTo(px + pw, py + ph);
  g.lineTo(px + cut, py + ph);
  g.lineTo(px, py + ph - cut);
  g.closePath();
  g.fillStyle = 'rgba(10, 5, 24, 0.84)';
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = accent;
  g.stroke();

  // Bottom accent bar
  g.fillStyle = accent;
  g.fillRect(px + cut, py + ph - 4, pw - cut, 4);

  // Diamond team/status pip
  g.save();
  g.translate(px + 18, py + ph / 2 - 1);
  g.rotate(Math.PI / 4);
  g.fillStyle = bright;
  g.fillRect(-5, -5, 10, 10);
  g.restore();

  // Crisp text
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(4, 2, 12, 0.95)';
  g.strokeText(name, 192 + 7, py + ph / 2);
  g.fillStyle = '#ffffff';
  g.fillText(name, 192 + 7, py + ph / 2);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BotView {
  group = new THREE.Group();
  private bodyM: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private sprite: THREE.Sprite;
  private mat: THREE.MeshStandardMaterial;
  flashT = 0;
  private phase = 0;

  constructor(color: number, name: string, nameColor: number) {
    const g = getGeos();
    if (!legMat) legMat = new THREE.MeshStandardMaterial({ color: 0x1b1b2c, roughness: 0.7 });
    if (!flashMat) flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mat = armorMat(color);
    this.bodyM = new THREE.Mesh(g.armor, this.mat);
    const visor = new THREE.Mesh(g.visor, visorMat(color));
    this.legL = new THREE.Mesh(g.leg, legMat);
    this.legR = new THREE.Mesh(g.leg, legMat);
    this.legL.position.set(-0.12, 0.74, 0);
    this.legR.position.set(0.12, 0.74, 0);
    this.bodyM.castShadow = this.legL.castShadow = this.legR.castShadow = true;
    this.bodyM.add(visor);
    this.group.add(this.bodyM, this.legL, this.legR);
    this.group.scale.setScalar(1.08);
    // sizeAttenuation: false keeps the nameplate at a fixed screen size regardless of distance
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nameTexture(name, nameColor),
        transparent: true,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    this.sprite.scale.set(0.14, 0.031, 1);
    this.sprite.position.y = 2.15;
    this.group.add(this.sprite);
    this.group.visible = false;
  }

  update(f: Fighter, dt: number, time: number, camX: number, camY: number, camZ: number, showName: boolean) {
    const g = this.group;
    if (!f.alive) {
      g.visible = false;
      return;
    }
    const b = f.body;
    g.visible = f.spawnProt <= 0 || Math.floor(time * 16) % 2 === 0;
    g.position.set(b.x, b.y, b.z);
    g.rotation.y = f.yaw;
    const sp = f.moveSpeed;
    this.phase += dt * sp * 1.5;
    const amp = Math.min(1, sp / 6) * 0.85;
    if (b.onGround) {
      this.legL.rotation.x = Math.sin(this.phase) * amp;
      this.legR.rotation.x = -Math.sin(this.phase) * amp;
      this.bodyM.position.y = Math.abs(Math.sin(this.phase)) * 0.04 * amp;
    } else {
      this.legL.rotation.x = 0.5;
      this.legR.rotation.x = -0.35;
      this.bodyM.position.y = 0;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.bodyM.material = flashMat!;
    } else this.bodyM.material = this.mat;
    const d = Math.hypot(b.x - camX, b.y - camY, b.z - camZ);
    this.sprite.visible = showName && d < 56;
    const far = d > 55;
    this.bodyM.castShadow = !far;
    this.legL.castShadow = !far;
    this.legR.castShadow = !far;
    (this.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, 1.75 - d / 34));
  }

  dispose() {
    (this.sprite.material as THREE.SpriteMaterial).map?.dispose();
    this.sprite.material.dispose();
  }
}
