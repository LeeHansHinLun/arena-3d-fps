import { SIZE_INFO, type BuiltinLevelId, type LevelId, type MapSize } from './types';

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  color: number;
}
export interface Pad {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: number;
}
export interface Theme {
  skyTop: number;
  skyBottom: number;
  fog: number;
  ground: number;
  accent: number;
  accent2: number;
  sunColor: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  lightColor: number;
  discColor: number;
}
export interface LevelData {
  id: LevelId;
  key?: string;
  themeName?: string;
  name: string;
  tagline: string;
  size: string;
  w: number;
  d: number;
  maxH: number;
  boxes: Box[];
  glow: Box[];
  pads: Pad[];
  theme: Theme;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G = 24; // reference gravity used to design jump pads
const MG = 0xff2d95;
const CY = 0x2de2ff;
const YL = 0xffe14d;
const OR = 0xff8a3c;
const GR = 0x7dff6b;

type Dir = '+x' | '-x' | '+z' | '-z';

class LB {
  boxes: Box[] = [];
  glow: Box[] = [];
  pads: Pad[] = [];
  r: () => number;
  constructor(public w: number, public d: number, seed: number) {
    this.r = mulberry32(seed);
  }
  pick<T>(a: T[]): T {
    return a[Math.floor(this.r() * a.length)];
  }
  range(a: number, b: number) {
    return a + this.r() * (b - a);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): Box {
    const b = { x0, y0, z0, x1, y1, z1, color };
    this.boxes.push(b);
    return b;
  }
  gbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number) {
    this.glow.push({ x0, y0, z0, x1, y1, z1, color });
  }
  solid(cx: number, cz: number, sx: number, sz: number, h: number, color: number, y0 = 0): Box {
    return this.box(cx - sx / 2, y0, cz - sz / 2, cx + sx / 2, y0 + h, cz + sz / 2, color);
  }
  /** neon rim around the top edge of a box */
  strip(b: Box, color: number, t = 0.14, l = 0.03) {
    const y0 = b.y1 - t;
    const y1 = b.y1 + 0.03;
    this.gbox(b.x0 - l, y0, b.z0 - l, b.x1 + l, y1, b.z0 - l + t, color);
    this.gbox(b.x0 - l, y0, b.z1 + l - t, b.x1 + l, y1, b.z1 + l, color);
    this.gbox(b.x0 - l, y0, b.z0 - l, b.x0 - l + t, y1, b.z1 + l, color);
    this.gbox(b.x1 + l - t, y0, b.z0 - l, b.x1 + l, y1, b.z1 + l, color);
  }
  /** horizontal band around the sides of a box */
  band(b: Box, y: number, color: number, t = 0.16, l = 0.04) {
    this.gbox(b.x0 - l, y, b.z0 - l, b.x1 + l, y + t, b.z0 + 0.0, color);
    this.gbox(b.x0 - l, y, b.z1, b.x1 + l, y + t, b.z1 + l, color);
    this.gbox(b.x0 - l, y, b.z0 - l, b.x0, y + t, b.z1 + l, color);
    this.gbox(b.x1, y, b.z0 - l, b.x1 + l, y + t, b.z1 + l, color);
  }
  loop(s: number, y: number, color: number, t = 0.16) {
    this.gbox(-s, y - 0.02, s, s, y + 0.04, s + t, color);
    this.gbox(-s, y - 0.02, -s - t, s, y + 0.04, -s, color);
    this.gbox(s, y - 0.02, -s, s + t, y + 0.04, s, color);
    this.gbox(-s - t, y - 0.02, -s, -s, y + 0.04, s, color);
  }
  stairs(sx: number, sz: number, dir: Dir, width: number, n: number, rise: number, run: number, color: number, y0 = 0) {
    for (let i = 0; i < n; i++) {
      const top = y0 + (i + 1) * rise;
      let x0 = 0, x1 = 0, z0 = 0, z1 = 0;
      if (dir === '+x') {
        x0 = sx + i * run; x1 = x0 + run; z0 = sz - width / 2; z1 = sz + width / 2;
      } else if (dir === '-x') {
        x1 = sx - i * run; x0 = x1 - run; z0 = sz - width / 2; z1 = sz + width / 2;
      } else if (dir === '+z') {
        z0 = sz + i * run; z1 = z0 + run; x0 = sx - width / 2; x1 = sx + width / 2;
      } else {
        z1 = sz - i * run; z0 = z1 - run; x0 = sx - width / 2; x1 = sx + width / 2;
      }
      this.box(x0, 0, z0, x1, top, z1, color);
    }
  }
  /** four staircases climbing toward a structure whose face is `face` away from (cx,cz) */
  stairs4(cx: number, cz: number, face: number, n: number, rise: number, run: number, y0: number, width: number, color: number) {
    const s = face + n * run;
    this.stairs(cx + s, cz, '-x', width, n, rise, run, color, y0);
    this.stairs(cx - s, cz, '+x', width, n, rise, run, color, y0);
    this.stairs(cx, cz + s, '-z', width, n, rise, run, color, y0);
    this.stairs(cx, cz - s, '+z', width, n, rise, run, color, y0);
  }
  walls(color: number, h: number, accent: number) {
    const w = this.w / 2;
    const d = this.d / 2;
    const t = 3;
    const a = this.box(-w - t, 0, d, w + t, h, d + t, color);
    const b = this.box(-w - t, 0, -d - t, w + t, h, -d, color);
    const c = this.box(w, 0, -d, w + t, h, d, color);
    const e = this.box(-w - t, 0, -d, -w, h, d, color);
    void a; void b; void c; void e;
    // neon lines on the inside faces
    for (const y of [1.2, h - 2.2]) {
      this.gbox(-w, y, d - 0.06, w, y + 0.18, d, accent);
      this.gbox(-w, y, -d, w, y + 0.18, -d + 0.06, accent);
      this.gbox(w - 0.06, y, -d, w, y + 0.18, d, accent);
      this.gbox(-w, y, -d, -w + 0.06, y + 0.18, d, accent);
    }
  }
  free(x0: number, x1: number, z0: number, z1: number, m: number) {
    for (const b of this.boxes) {
      if (!(x1 + m <= b.x0 || x0 - m >= b.x1 || z1 + m <= b.z0 || z0 - m >= b.z1)) return false;
    }
    return true;
  }
  /** true if a jump pad at (x,y,z) has clear space above it */
  padClear(x: number, y: number, z: number): boolean {
    for (const b of this.boxes) {
      if (x + 1.7 > b.x0 && x - 1.7 < b.x1 && z + 1.7 > b.z0 && z - 1.7 < b.z1 && y + 2.6 > b.y0 && y + 0.05 < b.y1) return false;
    }
    return true;
  }

  /** Jump pad that lands at (tx,tz) at height th (designed for reference gravity) */
  padTo(x: number, y: number, z: number, tx: number, tz: number, th: number, color: number) {
    if (!this.padClear(x, y, z)) return;
    const dh = Math.max(0.5, th - y);
    const vy = Math.sqrt(2 * G * (dh + 1.6));
    const t = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * G * dh))) / G;
    this.pads.push({ x, y, z, vx: (tx - x) / t, vy, vz: (tz - z) / t, color });
  }
}

/* ---------------------------------------------------------------- Neon Plaza */
function plaza(): LevelData {
  const L = new LB(120, 120, 1337);
  L.walls(0x2b2060, 14, MG);
  const t1 = L.solid(0, 0, 26, 26, 2, 0x4a3a8c);
  const t2 = L.solid(0, 0, 18, 18, 4, 0x5b46a8);
  const t3 = L.solid(0, 0, 10, 10, 6, 0x7a5ad0);
  L.strip(t1, CY);
  L.strip(t2, MG);
  L.strip(t3, YL);
  L.stairs4(0, 0, 13, 4, 0.5, 1.5, 0, 6, 0x6a58b8);
  L.stairs4(0, 0, 9, 4, 0.5, 1, 2, 5, 0x6a58b8);
  L.stairs4(0, 0, 5, 4, 0.5, 1, 4, 4, 0x8a6ae0);
  L.gbox(-2.5, 6, -2.5, 2.5, 6.05, 2.5, YL);

  // corner bunkers
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * 40;
      const cz = sz * 40;
      const p = L.solid(cx, cz, 14, 14, 3, 0x40307a);
      L.strip(p, sx * sz > 0 ? CY : MG);
      L.stairs(cx - sx * 13, cz, sx > 0 ? '+x' : '-x', 5, 6, 0.5, 1, 0x5a49a0);
      L.stairs(cx, cz - sz * 13, sz > 0 ? '+z' : '-z', 5, 6, 0.5, 1, 0x5a49a0);
      L.solid(cx + sx * 4, cz + sz * 1, 1, 8, 1.3, 0x6a58b8, 3);
      L.solid(cx + sx * 1, cz + sz * 4, 8, 1, 1.3, 0x6a58b8, 3);
    }
  }
  // mid-edge fortifications
  for (const [mx, mz] of [[44, 0], [-44, 0], [0, 44], [0, -44]]) {
    const ax = mz === 0;
    const w = L.solid(mx, mz, ax ? 3 : 18, ax ? 18 : 3, 3.2, 0x3f4fa0);
    L.strip(w, YL);
    const sgn = Math.sign(ax ? mx : mz);
    for (const k of [-1, 1]) {
      if (ax) L.solid(mx - sgn * 6, k * 11, 4, 5, 1.4, 0x5c4cb0);
      else L.solid(k * 11, mz - sgn * 6, 5, 4, 1.4, 0x5c4cb0);
    }
  }
  // pads towards the ziggurat
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.padTo(sx * 19, 0, sz * 19, sx * 7, sz * 7, 4, sx * sz > 0 ? CY : MG);

  // scatter cover
  const colors = [0x4b3a8f, 0x5f4bb0, 0x3f5fc0, 0xa3367f, 0x6a3fb0, 0x35508f];
  let placed = 0;
  for (let i = 0; i < 900 && placed < 34; i++) {
    const w = L.range(2.5, 6);
    const d = L.range(2.5, 6);
    const x = L.range(-54, 54);
    const z = L.range(-54, 54);
    if (Math.abs(x) < 27 && Math.abs(z) < 27) continue;
    if (!L.free(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 4)) continue;
    const h = L.pick([1.2, 1.4, 2.4, 3.2]);
    const b = L.solid(x, z, w, d, h, L.pick(colors));
    if (h > 2) L.strip(b, L.pick([CY, MG, YL]));
    placed++;
  }
  return {
    id: 'plaza', name: 'Neon Plaza', tagline: 'Open ziggurat arena with fast sightlines and jump pads.', size: '120 × 120',
    w: 120, d: 120, maxH: 14, boxes: L.boxes, glow: L.glow, pads: L.pads,
    theme: { skyTop: 0x12072e, skyBottom: 0xff5fa2, fog: 0x35134f, ground: 0x2a2350, accent: MG, accent2: CY, sunColor: 0xff8fc0, sunDir: [-0.5, 0.55, -0.65], hemiSky: 0xb7a0ff, hemiGround: 0x3a1f5c, lightColor: 0xffd2e8, discColor: 0xff5fa2 },
  };
}

/* -------------------------------------------------------------- Container Yard */
function yard(): LevelData {
  const L = new LB(150, 100, 777);
  L.walls(0x2d2438, 12, OR);
  const plat = L.solid(0, 0, 22, 22, 4, 0x4a4560);
  L.strip(plat, CY);
  L.stairs4(0, 0, 11, 8, 0.5, 1, 0, 5, 0x5a5578);
  const tower = L.solid(0, 0, 7, 7, 6, 0x6a5a88, 4);
  L.strip(tower, YL);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.padTo(sx * 7, 4, sz * 7, sx * 0.5, sz * 0.5, 10, CY);

  const cols = [0xd9453a, 0x2f6fd0, 0xe08a2b, 0x2f9e6a, 0xe0c030, 0x3aa7a7, 0x8a4fd0, 0x777c88];
  for (const rz of [-40, -26, 26, 40]) {
    let x = -70 + L.r() * 3;
    const groups: { x0: number; x1: number; bridged: boolean }[] = [];
    while (x < 52) {
      const n = 1 + Math.floor(L.r() * 3);
      const len = n * 12;
      if (x + len > 72) break;
      groups.push({ x0: x, x1: x + len, bridged: false });
      x += len + 8;
    }
    for (let i = 0; i < groups.length - 1; i++) {
      if (L.r() < 0.5) {
        groups[i].bridged = true;
        groups[i + 1].bridged = true;
        const g0 = groups[i];
        const g1 = groups[i + 1];
        const pl = L.box(g0.x1 - 0.5, 2.1, rz - 1.4, g1.x0 + 0.5, 2.5, rz + 1.4, 0x8a8f9c);
        L.strip(pl, OR, 0.1);
      }
    }
    for (const g of groups) {
      const n = Math.round((g.x1 - g.x0) / 12);
      for (let i = 0; i < n; i++) {
        const cx = g.x0 + 6 + i * 12;
        const b = L.solid(cx, rz, 12, 2.6, 2.5, L.pick(cols));
        if (g.bridged) L.strip(b, OR, 0.1);
      }
      const mid = (g.x0 + g.x1) / 2;
      if (!g.bridged && L.r() < 0.4) {
        L.solid(g.x0 + 6, rz, 12, 2.6, 2.5, L.pick(cols), 2.5);
      } else {
        const outer = Math.abs(rz) > 30;
        const towardsCenter = rz < 0 ? 1 : -1;
        const dirZ = outer ? -towardsCenter : towardsCenter;
        const edge = rz + (dirZ > 0 ? -1.3 : 1.3);
        const start = edge - dirZ * 5;
        if (L.r() < 0.75 && Math.abs(mid) > 2) {
          L.stairs(g.x1 - 6, start, dirZ > 0 ? '+z' : '-z', 2.6, 5, 0.5, 1, 0x9a9fac);
        }
      }
    }
  }
  // gantries + light poles
  for (const gx of [-48, 48]) {
    for (const gz of [-33, 33]) {
      const p = L.solid(gx, gz, 2.4, 2.4, 11, 0x3a3548);
      L.band(p, 3, OR);
    }
    const beam = L.solid(gx, 0, 2, 70, 1.4, 0x4a4560, 9.6);
    L.strip(beam, OR);
  }
  for (const [px, pz] of [[-22, -33], [22, -33], [-22, 33], [22, 33], [-60, 0], [60, 0], [0, -33], [0, 33]]) {
    if (!L.free(px - 0.5, px + 0.5, pz - 0.5, pz + 0.5, 1)) continue;
    const p = L.solid(px, pz, 0.7, 0.7, 8, 0x2a2438);
    L.gbox(px - 0.9, 8, pz - 0.9, px + 0.9, 8.3, pz + 0.9, YL);
    void p;
  }
  return {
    id: 'yard', name: 'Container Yard', tagline: 'Maze of stacked containers, catwalks and a central crane tower.', size: '150 × 100',
    w: 150, d: 100, maxH: 12, boxes: L.boxes, glow: L.glow, pads: L.pads,
    theme: { skyTop: 0x1b1030, skyBottom: 0xff9a3c, fog: 0x3f2338, ground: 0x3a3745, accent: OR, accent2: CY, sunColor: 0xffb070, sunDir: [0.6, 0.45, -0.6], hemiSky: 0xffc9a0, hemiGround: 0x3d2a4a, lightColor: 0xffd8b0, discColor: 0xffa040 },
  };
}

/* -------------------------------------------------------------------- Skyline */
function skyline(): LevelData {
  const L = new LB(124, 124, 4242);
  L.walls(0x1d1a3d, 18, CY);
  const centers = [-45, -15, 15, 45];
  type Bld = { kind: 'tall' | 'low' | 'yard'; h: number; box: Box | null; cx: number; cz: number };
  const grid: Bld[][] = [];
  const cols = [0x3a3a78, 0x4a3f8a, 0x2f4f8f, 0x5a3a8a, 0x3a5a9a, 0x6a3a7a];
  for (let ix = 0; ix < 4; ix++) {
    grid[ix] = [];
    for (let iz = 0; iz < 4; iz++) {
      const cx = centers[ix];
      const cz = centers[iz];
      const roll = L.r();
      if (roll < 0.3) {
        const h = L.pick([3.5, 5, 6.5]);
        const side = L.r() < 0.5 ? -1 : 1;
        const dz = L.r() < 0.5 ? -1 : 1;
        const col = L.pick(cols);
        const b = L.box(cx - side * 2 - 7, 0, cz - 9, cx - side * 2 + 7, h, cz + 9, col);
        L.strip(b, MG);
        L.band(b, 1.2, CY);
        const n = Math.round(h / 0.5);
        const sz0 = cz - dz * 9;
        L.stairs(cx + side * 7, sz0, dz > 0 ? '+z' : '-z', 4, n, 0.5, 1, 0x6a6aa8);
        const lz0 = sz0 + dz * n;
        L.box(cx + side * 5, 0, Math.min(lz0, lz0 + dz * 3), cx + side * 9, h, Math.max(lz0, lz0 + dz * 3), 0x6a6aa8);
        grid[ix][iz] = { kind: 'low', h, box: b, cx, cz };
      } else if (roll < 0.45) {
        const base = L.solid(cx, cz, 12, 12, 0.5, 0x4a4a88);
        L.strip(base, GR);
        for (const [ox, oz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) L.solid(cx + ox, cz + oz, 2.4, 2.4, L.pick([1.2, 1.6]), L.pick(cols));
        L.solid(cx, cz, 3, 3, 1.8, 0x6a5aa8, 0.5);
        grid[ix][iz] = { kind: 'yard', h: 0, box: null, cx, cz };
      } else {
        const h = L.pick([10, 10, 13, 16, 16, 20]);
        const col = L.pick(cols);
        const b = L.solid(cx, cz, 16, 16, h, col);
        L.strip(b, L.pick([CY, MG, YL]));
        for (let y = 2.5; y < h - 1; y += 3.5) L.band(b, y, y % 7 < 3.5 ? CY : MG, 0.14);
        const up = L.solid(cx, cz, 8, 8, 4, 0x2f2f6a, h);
        L.strip(up, YL);
        L.gbox(cx - 0.15, h + 4, cz - 0.15, cx + 0.15, h + 9, cz + 0.15, MG);
        grid[ix][iz] = { kind: 'tall', h, box: b, cx, cz };
      }
    }
  }
  // rooftop bridges between matching tall buildings
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      const a = grid[ix][iz];
      const b = grid[ix + 1][iz];
      if (a.kind === 'tall' && b.kind === 'tall' && a.h === b.h) {
        const pl = L.box(a.box!.x1 - 0.5, a.h - 0.4, a.cz - 1.5, b.box!.x0 + 0.5, a.h, a.cz + 1.5, 0x8a8fc0);
        L.strip(pl, CY, 0.1);
      }
    }
  }
  // jump pads from the street onto rooftops
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      const b = grid[ix][iz];
      if (b.kind !== 'tall' || b.h > 16) continue;
      const side = ix < 2 ? 1 : -1;
      const px = b.cx + side * 12;
      L.padTo(px, 0, b.cz, b.cx + side * 3, b.cz, b.h, CY);
    }
  }
  // street clutter
  let placed = 0;
  for (let i = 0; i < 500 && placed < 20; i++) {
    const x = L.range(-56, 56);
    const z = L.range(-56, 56);
    const w = L.range(1.6, 3.2);
    if (!L.free(x - w / 2, x + w / 2, z - w / 2, z + w / 2, 3.2)) continue;
    L.solid(x, z, w, w, L.pick([1.0, 1.3]), L.pick(cols));
    placed++;
  }
  return {
    id: 'skyline', name: 'Skyline District', tagline: 'Vertical city blocks. Fight in the streets or launch onto rooftops.', size: '124 × 124',
    w: 124, d: 124, maxH: 20, boxes: L.boxes, glow: L.glow, pads: L.pads,
    theme: { skyTop: 0x04071f, skyBottom: 0x7a3cff, fog: 0x160c3a, ground: 0x1b1b3a, accent: CY, accent2: MG, sunColor: 0xb89cff, sunDir: [-0.4, 0.5, 0.7], hemiSky: 0x9ab0ff, hemiGround: 0x2a1850, lightColor: 0xc9c0ff, discColor: 0xb06bff },
  };
}

/* ----------------------------------------------------------------- Colosseum */
function colosseum(): LevelData {
  const L = new LB(116, 116, 909);
  L.walls(0x3a2540, 16, YL);
  const ringH = (s: number) => (s < 20 ? 0 : s < 47 ? 0.5 * (Math.floor((s - 20) / 3) + 1) : 5);
  const ring = (si: number, so: number, h: number, color: number) => {
    L.box(-so, 0, si, so, h, so, color);
    L.box(-so, 0, -so, so, h, -si, color);
    L.box(si, 0, -si, so, h, si, color);
    L.box(-so, 0, -si, -si, h, si, color);
  };
  for (let k = 0; k < 9; k++) {
    const si = 20 + 3 * k;
    const h = 0.5 * (k + 1);
    ring(si, si + 3, h, k % 2 ? 0x7a5486 : 0x6a4a78);
    if (k % 3 === 2) L.loop(si, h, k === 8 ? MG : CY);
  }
  ring(47, 58, 5, 0x8a6090);
  L.loop(47, 5, YL, 0.2);
  // center spire + pillars
  const sp = L.solid(0, 0, 12, 12, 3, 0x8a5a90);
  L.strip(sp, MG);
  L.stairs4(0, 0, 6, 6, 0.5, 1, 0, 4, 0x9a6aa0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = L.solid(sx * 14, sz * 14, 3, 3, 9, 0x5a3a68);
      L.strip(p, CY);
      L.band(p, 3, MG);
      L.band(p, 6, MG);
    }
  }
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const tx = sx * 32;
    const tz = sz * 32;
    L.padTo(sx * 17, 0, sz * 17, tx, tz, ringH(32), YL);
  }
  const cols = [0x6a4a78, 0x5a3a88, 0x7a4a5a, 0x8a5aa0];
  let placed = 0;
  for (let i = 0; i < 1200 && placed < 34; i++) {
    const w = L.range(2.5, 5);
    const d = L.range(2.5, 5);
    const x = L.range(-45, 45);
    const z = L.range(-45, 45);
    const s = Math.max(Math.abs(x) + w / 2, Math.abs(z) + d / 2);
    if (s > 46.5) continue;
    if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;
    if (!L.free(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 3.2)) continue;
    // sit on the highest ring touched
    const gh = Math.max(ringH(Math.max(Math.abs(x - w / 2), Math.abs(z - d / 2))), ringH(Math.max(Math.abs(x + w / 2), Math.abs(z + d / 2))), ringH(Math.max(Math.abs(x), Math.abs(z))));
    const h = L.pick([1.2, 1.4, 2.4]);
    const b = L.solid(x, z, w, d, gh + h, L.pick(cols));
    if (h > 2) L.strip(b, MG);
    placed++;
  }
  return {
    id: 'colosseum', name: 'The Colosseum', tagline: 'A sunken terraced bowl. Hold the high ground or own the pit.', size: '116 × 116',
    w: 116, d: 116, maxH: 16, boxes: L.boxes, glow: L.glow, pads: L.pads,
    theme: { skyTop: 0x2b0f2e, skyBottom: 0xffc34d, fog: 0x4a2340, ground: 0x4b3a4a, accent: YL, accent2: MG, sunColor: 0xffcf80, sunDir: [0.3, 0.5, -0.8], hemiSky: 0xffd9a0, hemiGround: 0x4a2848, lightColor: 0xffe0b0, discColor: 0xffc34d },
  };
}

/* ------------------------------------------------------------- Procedural */
export interface ProcThemeOption { id: string; name: string; style: 'mixed' | 'towers' | 'maze' | 'open'; swatch: string; theme: Theme }
export const PROC_THEMES: (ProcThemeOption & { wall: number; cols: number[] })[] = [
  { id: 'neon', name: 'Neon', style: 'mixed', swatch: '#ff2d95', wall: 0x2b2060, cols: [0x4b3a8f, 0x5f4bb0, 0x3f5fc0, 0xa3367f, 0x6a3fb0], theme: plazaTheme() },
  { id: 'dusk', name: 'Dusk', style: 'towers', swatch: '#ff9a3c', wall: 0x2d2438, cols: [0xd9453a, 0x2f6fd0, 0xe08a2b, 0x2f9e6a, 0x777c88], theme: { skyTop: 0x1b1030, skyBottom: 0xff9a3c, fog: 0x3f2338, ground: 0x3a3745, accent: OR, accent2: CY, sunColor: 0xffb070, sunDir: [0.6, 0.45, -0.6], hemiSky: 0xffc9a0, hemiGround: 0x3d2a4a, lightColor: 0xffd8b0, discColor: 0xffa040 } },
  { id: 'midnight', name: 'Midnight', style: 'maze', swatch: '#7a3cff', wall: 0x1d1a3d, cols: [0x3a3a78, 0x4a3f8a, 0x2f4f8f, 0x5a3a8a, 0x3a5a9a], theme: { skyTop: 0x04071f, skyBottom: 0x7a3cff, fog: 0x160c3a, ground: 0x1b1b3a, accent: CY, accent2: MG, sunColor: 0xb89cff, sunDir: [-0.4, 0.5, 0.7], hemiSky: 0x9ab0ff, hemiGround: 0x2a1850, lightColor: 0xc9c0ff, discColor: 0xb06bff } },
  { id: 'toxic', name: 'Toxic', style: 'open', swatch: '#9dff4d', wall: 0x16302a, cols: [0x2f6a4a, 0x3a7a5a, 0x4a5a3a, 0x2a5a6a, 0x5a7a2a], theme: { skyTop: 0x041a14, skyBottom: 0x9dff4d, fog: 0x0f3324, ground: 0x1f3a30, accent: GR, accent2: YL, sunColor: 0xd0ff80, sunDir: [0.5, 0.5, 0.6], hemiSky: 0xbfffc0, hemiGround: 0x173a2a, lightColor: 0xe0ffd0, discColor: 0xb0ff60 } },
  { id: 'ember', name: 'Ember', style: 'mixed', swatch: '#ffc34d', wall: 0x3a2540, cols: [0x6a4a78, 0x7a4a5a, 0x8a5aa0, 0x9a4a3a], theme: { skyTop: 0x2b0f2e, skyBottom: 0xffc34d, fog: 0x4a2340, ground: 0x4b3a4a, accent: YL, accent2: MG, sunColor: 0xffcf80, sunDir: [0.3, 0.5, -0.8], hemiSky: 0xffd9a0, hemiGround: 0x4a2848, lightColor: 0xffe0b0, discColor: 0xffc34d } },
  { id: 'ice', name: 'Ice', style: 'towers', swatch: '#9fe8ff', wall: 0x1d3348, cols: [0x3a6a8a, 0x4a8aa8, 0x2f5f7f, 0x6aa8c0, 0x8ac8d8], theme: { skyTop: 0x041426, skyBottom: 0x9fe8ff, fog: 0x123048, ground: 0x2a4458, accent: 0x9fe8ff, accent2: 0xffffff, sunColor: 0xd8f4ff, sunDir: [-0.3, 0.6, -0.7], hemiSky: 0xd8f4ff, hemiGround: 0x1a3048, lightColor: 0xe8f8ff, discColor: 0xbfefff } },
  { id: 'void', name: 'Void', style: 'maze', swatch: '#a26bff', wall: 0x140a24, cols: [0x2a1a4a, 0x3a2a6a, 0x1f1438, 0x4a2a7a, 0x2f1f5a], theme: { skyTop: 0x020108, skyBottom: 0x5a2a9a, fog: 0x0a0418, ground: 0x140c24, accent: MG, accent2: CY, sunColor: 0xc08aff, sunDir: [0.2, 0.35, 0.9], hemiSky: 0x8a6aff, hemiGround: 0x120820, lightColor: 0xd0b0ff, discColor: 0x8a4aff } },
  { id: 'circuit', name: 'Circuit', style: 'open', swatch: '#7dff6b', wall: 0x0f2a24, cols: [0x1f5a4a, 0x2a7a5a, 0x1a4a5a, 0x3a8a6a, 0x2a6a7a], theme: { skyTop: 0x02120e, skyBottom: 0x4dffb0, fog: 0x0a2a20, ground: 0x143a2e, accent: GR, accent2: CY, sunColor: 0xa0ffd0, sunDir: [0.5, 0.55, 0.4], hemiSky: 0xa0ffd0, hemiGround: 0x0a2a20, lightColor: 0xd0ffe8, discColor: 0x6dffb0 } },
];
function plazaTheme(): Theme {
  return { skyTop: 0x12072e, skyBottom: 0xff5fa2, fog: 0x35134f, ground: 0x2a2350, accent: MG, accent2: CY, sunColor: 0xff8fc0, sunDir: [-0.5, 0.55, -0.65], hemiSky: 0xb7a0ff, hemiGround: 0x3a1f5c, lightColor: 0xffd2e8, discColor: 0xff5fa2 };
}

export function generateProcedural(seed: number, size: MapSize, opts?: { w?: number; d?: number; theme?: string; style?: string }): LevelData {
  const base = SIZE_INFO[size].dim;
  const D = Math.round(Math.max(60, Math.min(240, opts?.d ?? base)));
  const W = Math.round(Math.max(60, Math.min(240, opts?.w ?? base)));
  const L = new LB(W, D, (Math.imul(seed, 2654435761) ^ 0x9e3779b9) >>> 0);
  for (let k = 0; k < 4; k++) L.r();
  const T = (opts?.theme && opts.theme !== 'auto' ? PROC_THEMES.find((t) => t.id === opts.theme) : null) ?? PROC_THEMES[Math.floor(L.r() * PROC_THEMES.length)];
  const style = opts?.style && opts.style !== 'auto' ? opts.style : T.style;
  const neon = [T.theme.accent, T.theme.accent2, YL];
  L.walls(T.wall, 14, T.theme.accent);
  // centrepiece
  const centre = L.r() < 0.5 ? 'zig' : 'tower';
  let cR = 13;
  if (centre === 'zig') {
    const a = L.solid(0, 0, 20, 20, 2, L.pick(T.cols));
    const b = L.solid(0, 0, 12, 12, 4, L.pick(T.cols));
    L.strip(a, neon[0]);
    L.strip(b, neon[1]);
    L.stairs4(0, 0, 10, 4, 0.5, 1.2, 0, 5, L.pick(T.cols));
    L.stairs4(0, 0, 6, 4, 0.5, 1, 2, 4, L.pick(T.cols));
    cR = 16;
  } else {
    const p = L.solid(0, 0, 16, 16, 3, L.pick(T.cols));
    L.strip(p, neon[0]);
    L.stairs4(0, 0, 8, 6, 0.5, 1, 0, 4, L.pick(T.cols));
    const t = L.solid(0, 0, 5, 5, 6, L.pick(T.cols), 3);
    L.strip(t, neon[2]);
    for (const [sx, sz] of [[1, 1], [-1, -1]]) L.padTo(sx * 5.5, 3, sz * 5.5, sx * 0.5, sz * 0.5, 9, neon[1]);
    cR = 15;
  }
  // districts on a grid
  const cell = 22;
  const n = Math.floor((D - 10) / cell);
  const start = -((n - 1) * cell) / 2;
  type B = { cx: number; cz: number; h: number; box: Box };
  const towers: B[][] = [];
  for (let i = 0; i < n; i++) {
    towers[i] = [];
    for (let j = 0; j < n; j++) {
      const cx = start + i * cell + (L.r() - 0.5) * 3;
      const cz = start + j * cell + (L.r() - 0.5) * 3;
      if (Math.hypot(cx, cz) < cR + 9) continue;
      const roll = style === 'towers' ? L.r() * 0.75 : style === 'maze' ? 0.3 + L.r() * 0.7 : style === 'open' ? L.r() * 0.55 : L.r();
      const col = L.pick(T.cols);
      if (roll < 0.32) {
        const h = L.pick([8, 10, 12]);
        const w = 8 + L.r() * 4;
        const b = L.solid(cx, cz, w, w, h, col);
        L.strip(b, L.pick(neon));
        for (let y = 2.5; y < h - 1; y += 3.5) L.band(b, y, L.pick(neon), 0.12);
        const side = cx > 0 ? -1 : 1;
        L.padTo(cx + side * (w / 2 + 3), 0, cz, cx + side * (w / 2 - 2), cz, h, neon[1]);
        towers[i][j] = { cx, cz, h, box: b };
      } else if (roll < 0.6) {
        const h = L.pick([2.5, 3, 4]);
        const wx = 7 + L.r() * 5, wz = 7 + L.r() * 5;
        const b = L.solid(cx, cz, wx, wz, h, col);
        L.strip(b, L.pick(neon));
        const steps = Math.round(h / 0.5);
        const dir = L.pick(['+x', '-x', '+z', '-z'] as Dir[]);
        if (dir === '+x') L.stairs(cx - wx / 2 - steps, cz, '+x', 3, steps, 0.5, 1, col);
        else if (dir === '-x') L.stairs(cx + wx / 2 + steps, cz, '-x', 3, steps, 0.5, 1, col);
        else if (dir === '+z') L.stairs(cx, cz - wz / 2 - steps, '+z', 3, steps, 0.5, 1, col);
        else L.stairs(cx, cz + wz / 2 + steps, '-z', 3, steps, 0.5, 1, col);
        L.solid(cx + (L.r() - 0.5) * 3, cz + (L.r() - 0.5) * 3, 3, 1, 1.2, L.pick(T.cols), h);
      } else if (roll < 0.8) {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + L.r();
          const p = L.solid(cx + Math.cos(a) * 5, cz + Math.sin(a) * 5, 1.6, 1.6, L.pick([2.4, 4, 6]), col);
          L.strip(p, L.pick(neon), 0.1);
        }
      } else {
        const horiz = L.r() < 0.5;
        const w = L.solid(cx, cz, horiz ? 10 : 1.2, horiz ? 1.2 : 10, L.pick([1.3, 2.4]), col);
        L.strip(w, L.pick(neon), 0.1);
        L.solid(cx + (horiz ? 0 : 3), cz + (horiz ? 3 : 0), 2.5, 2.5, 1.3, L.pick(T.cols));
      }
    }
  }
  // bridges between neighbouring towers of the same height
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = towers[i][j], b = towers[i + 1]?.[j];
      if (a && b && a.h === b.h && Math.abs(a.cz - b.cz) < 3) {
        const z = (a.cz + b.cz) / 2;
        const br = L.box(a.box.x1 - 0.5, a.h - 0.4, z - 1.4, b.box.x0 + 0.5, a.h, z + 1.4, 0x8a8fc0);
        L.strip(br, CY, 0.1);
      }
    }
  }
  // scatter cover
  let placed = 0;
  const want = Math.round((W * D) / (style === 'open' ? 620 : style === 'maze' ? 340 : 460));
  for (let k = 0; k < want * 30 && placed < want; k++) {
    const w = L.range(2, 5), d = L.range(2, 5);
    const x = L.range(-W / 2 + 5, W / 2 - 5), z = L.range(-D / 2 + 5, D / 2 - 5);
    if (!L.free(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 3.2)) continue;
    const h = L.pick([1.2, 1.4, 2.4]);
    const b = L.solid(x, z, w, d, h, L.pick(T.cols));
    if (h > 2) L.strip(b, L.pick(neon));
    placed++;
  }
  const sz = SIZE_INFO[size];
  return {
    id: 'procedural', themeName: T.name, key: `proc-${seed}-${size}-${W}x${D}-${T.id}-${style}`, name: `${T.name} Sector #${seed % 10000}`,
    tagline: `Procedurally generated ${sz.name.toLowerCase()} arena (seed ${seed}).`, size: `${W} × ${D}`,
    w: W, d: D, maxH: 14, boxes: L.boxes, glow: L.glow, pads: L.pads, theme: T.theme,
  };
}

const builders: Record<BuiltinLevelId, () => LevelData> = { plaza, yard, skyline, colosseum };
const cache = new Map<string, LevelData>();
export function getLevel(id: LevelId, gen?: { seed: number; size: MapSize; w?: number; d?: number; theme?: string; style?: string }): LevelData {
  const key = id === 'procedural' ? `proc-${gen?.seed ?? 1}-${gen?.size ?? 'medium'}-${gen?.w ?? 0}x${gen?.d ?? 0}-${gen?.theme ?? 'auto'}-${gen?.style ?? 'auto'}` : id;
  let l = cache.get(key);
  if (!l) {
    l = id === 'procedural' ? generateProcedural(gen?.seed ?? 1, gen?.size ?? 'medium', gen) : builders[id]();
    if (!l.key) l.key = key;
    cache.set(key, l);
    if (cache.size > 12) {
      const first = [...cache.keys()].find((k) => k.startsWith('proc-') && k !== key);
      if (first) cache.delete(first);
    }
  }
  return l;
}
