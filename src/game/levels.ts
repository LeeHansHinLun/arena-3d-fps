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
  styleName?: string;
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
  lights?: LightFixture[];
  cones?: VolumeCone[];
  /** closed cinematic camera loop (showcase attract mode + benchmark path) */
  vista?: [number, number, number][];
  vistaLook?: [number, number, number][];
}

/** A static coloured light source placed in the map (real spotlight when the quality budget allows). */
export interface LightFixture {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  dist: number;
  /** spotlight half-angle in radians; matched to the volumetric cone when it has one */
  angle?: number;
  /** vertical aim: -1 = down (lamps), +1 = up (jump-pad uplights) */
  dirY?: number;
  /** 0 = steady, higher = stronger animated flicker (braziers, beacons…) */
  flicker?: number;
  /** authored lamp, derived neon emitter, or jump pad (used for pool priority) */
  kind?: 'fixture' | 'neon' | 'pad';
  /** approximate visible emitter radius in metres, for lens-flare sizing */
  radius?: number;
  /** relative lens-flare strength before distance, screen position and occlusion */
  flare?: number;
  /**
   * Second endpoint for a linear emitter. `(x,y,z)` remains the centre, so
   * the first endpoint is `2*centre - endpoint2`; point emitters omit these.
   */
  x2?: number;
  y2?: number;
  z2?: number;
  /** connected neon component this straight run/span belongs to */
  group?: number;
  /** length of this merged straight neon run in metres */
  stripLength?: number;
  /** cross-section width of a neon strip in metres */
  stripWidth?: number;
  /** horizontal direction away from the neon strip's support, for tilting its grouped light cone */
  nx?: number;
  nz?: number;
}

/** A fake-volumetric light cone hanging below a fixture: apex at (x,y,z), opening downwards. */
export interface VolumeCone {
  x: number;
  y: number;
  z: number;
  r0: number; // apex radius
  r1: number; // base radius
  h: number;
  color: number;
  intensity: number;
}

function clampLevelNum(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Nudges a neon source a little away from its supporting solid. Glow strips
 * sit slightly proud of walls/blocks, but long runs are represented by their
 * segment centres; those centres can otherwise land flush with (or a hair
 * inside) the parent box, making both the proxy light and flare occlusion
 * test needlessly erratic.
 */
function outwardGlowOffset(level: LevelData, x: number, y: number, z: number): [number, number] {
  let best: Box | null = null;
  let bestD = Infinity;
  for (const b of level.boxes) {
    if (y < b.y0 - 0.8 || y > b.y1 + 0.8) continue;
    const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    const dz = z < b.z0 ? b.z0 - z : z > b.z1 ? z - b.z1 : 0;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (!best) return [0, 0];
  const qx = clampLevelNum(x, best.x0, best.x1);
  const qz = clampLevelNum(z, best.z0, best.z1);
  let ox = x - qx;
  let oz = z - qz;
  if (ox * ox + oz * oz < 0.0004) {
    ox = x - (best.x0 + best.x1) * 0.5;
    oz = z - (best.z0 + best.z1) * 0.5;
  }
  const len = Math.hypot(ox, oz);
  if (len < 0.02) return [0, 0];
  return [(ox / len) * 0.3, (oz / len) * 0.3];
}

/** One straight centreline extracted from a neon/glow box. */
interface GlowRun {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  color: number;
  axis: 'x' | 'y' | 'z';
  width: number;
  length: number;
  group: number;
  /** first constituent glow-box index; keeps merged output in authored order */
  order: number;
}

/** True when any endpoint pair is within `max2` (squared distance). Allocation-free. */
function glowEndpointsTouch(a: GlowRun, b: GlowRun, max2: number): boolean {
  let dx = a.ax - b.ax;
  let dy = a.ay - b.ay;
  let dz = a.az - b.az;
  if (dx * dx + dy * dy + dz * dz <= max2) return true;
  dx = a.ax - b.bx;
  dy = a.ay - b.by;
  dz = a.az - b.bz;
  if (dx * dx + dy * dy + dz * dz <= max2) return true;
  dx = a.bx - b.ax;
  dy = a.by - b.ay;
  dz = a.bz - b.az;
  if (dx * dx + dy * dy + dz * dz <= max2) return true;
  dx = a.bx - b.bx;
  dy = a.by - b.by;
  dz = a.bz - b.bz;
  return dx * dx + dy * dy + dz * dz <= max2;
}

function glowRunStart(r: GlowRun): number {
  return r.axis === 'x' ? r.ax : r.axis === 'y' ? r.ay : r.az;
}

function glowRunEnd(r: GlowRun): number {
  return r.axis === 'x' ? r.bx : r.axis === 'y' ? r.by : r.bz;
}

function setGlowRunEnds(r: GlowRun, start: number, end: number) {
  if (r.axis === 'x') {
    r.ax = start;
    r.bx = end;
  } else if (r.axis === 'y') {
    r.ay = start;
    r.by = end;
  } else {
    r.az = start;
    r.bz = end;
  }
  r.length = Math.hypot(r.bx - r.ax, r.by - r.ay, r.bz - r.az);
}

/**
 * Joins same-group, same-colour, collinear glow boxes whose centre-lines line
 * up and whose intervals touch or overlap. Corner pieces remain separate
 * straight runs but retain the same connected-component group.
 */
function mergeCollinearGlowRuns(runs: GlowRun[]): GlowRun[] {
  // Bucket first: only runs in the same component/colour/axis can ever merge.
  // Those buckets are tiny (a rim contributes two runs per axis), so the
  // exact pairwise merge below — previously restarted over the whole level
  // after every splice — now restarts over a handful of runs instead.
  const buckets = new Map<string, GlowRun[]>();
  for (const run of runs) {
    const key = `${run.group}|${run.color}|${run.axis}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(run);
  }

  const out: GlowRun[] = [];
  for (const bucket of buckets.values()) {
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i];
        for (let j = i + 1; j < bucket.length; j++) {
          const b = bucket[j];
          const fixedA: [number, number] = a.axis === 'x' ? [a.ay, a.az] : a.axis === 'y' ? [a.ax, a.az] : [a.ax, a.ay];
          const fixedB: [number, number] = b.axis === 'x' ? [b.ay, b.az] : b.axis === 'y' ? [b.ax, b.az] : [b.ax, b.ay];
          if (Math.abs(fixedA[0] - fixedB[0]) > 0.32 || Math.abs(fixedA[1] - fixedB[1]) > 0.32) continue;
          const gap = Math.max(glowRunStart(a), glowRunStart(b)) - Math.min(glowRunEnd(a), glowRunEnd(b));
          if (gap > 0.65) continue;

          const total = Math.max(0.01, a.length + b.length);
          const fixed: [number, number] = [
            (fixedA[0] * a.length + fixedB[0] * b.length) / total,
            (fixedA[1] * a.length + fixedB[1] * b.length) / total,
          ];
          if (a.axis === 'x') {
            a.ay = a.by = fixed[0];
            a.az = a.bz = fixed[1];
          } else if (a.axis === 'y') {
            a.ax = a.bx = fixed[0];
            a.az = a.bz = fixed[1];
          } else {
            a.ax = a.bx = fixed[0];
            a.ay = a.by = fixed[1];
          }
          setGlowRunEnds(a, Math.min(glowRunStart(a), glowRunStart(b)), Math.max(glowRunEnd(a), glowRunEnd(b)));
          a.width = Math.max(a.width, b.width);
          a.order = Math.min(a.order, b.order);
          bucket.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
    out.push(...bucket);
  }

  // Bucketing must not reorder the level's emitters: downstream ranking uses
  // source order as its tie-break, exactly as the unbucketed merge did.
  out.sort((a, b) => a.order - b.order);
  return out;
}

/**
 * Every static thing in a level that visibly emits light: authored lamps,
 * jump pads, and the separate neon-edge boxes in `level.glow` (top strips,
 * wall bands, perimeter lines, tower trims, signs and free-standing glow
 * slabs).
 *
 * Neon is no longer reduced to isolated centre points. Each glow box first
 * becomes an axial run; touching same-colour runs are grouped into connected
 * components (all four sides of a rim, for example), and collinear pieces in
 * a component are merged into full straight strips. Each merged strip is a
 * single grouped emitter: lens flare uses one ordinary point flare for it,
 * while coloured lighting assigns it one wide spotlight whose cone/range
 * cover the strip's length. Endpoints and group are retained so visibility
 * and occlusion are still evaluated over the whole strip, not just its centre.
 * Neon intensities remain modest beside authored lamps, which retain pool
 * selection priority at capped tiers.
 */
/**
 * Derived sources are a pure function of a level's immutable authored data.
 * `getLevel` already caches LevelData by key, so memoising on the object
 * itself (WeakMap: no retention past the level) makes repeat derivation —
 * pool rebuilds, a second engine, map previews — free instead of re-running
 * the grouping passes. Callers must treat the returned fixtures as read-only.
 */
const emissiveSourceCache = new WeakMap<LevelData, LightFixture[]>();

export function deriveEmissiveSources(level: LevelData): LightFixture[] {
  const cached = emissiveSourceCache.get(level);
  if (cached) return cached;
  const out: LightFixture[] = [];
  const authored = level.lights ?? [];

  for (const f of authored) {
    out.push({
      ...f,
      kind: 'fixture',
      radius: f.radius ?? 0.45,
      flare: f.flare ?? clampLevelNum(f.intensity / 180, 0.22, 0.55),
    });
  }

  for (const p of level.pads) {
    out.push({
      x: p.x,
      y: p.y + 2.7,
      z: p.z,
      color: p.color,
      intensity: 38,
      dist: 12,
      angle: 1.08,
      dirY: -1,
      flicker: 0.08,
      kind: 'pad',
      radius: 1.25,
      flare: 0.3,
    });
  }

  const rawRuns: GlowRun[] = [];
  for (const b of level.glow) {
    const dx = Math.max(0.01, b.x1 - b.x0);
    const dy = Math.max(0.01, b.y1 - b.y0);
    const dz = Math.max(0.01, b.z1 - b.z0);
    const cx = (b.x0 + b.x1) * 0.5;
    const cy = (b.y0 + b.y1) * 0.5;
    const cz = (b.z0 + b.z1) * 0.5;

    // LB.light already adds a small glow bulb at every authored fixture;
    // promoting that bulb as well would spend two pool slots on one lamp.
    const authoredBulb =
      dx <= 2.2 &&
      dy <= 1 &&
      dz <= 2.2 &&
      authored.some((f) => {
        const ax = f.x - cx;
        const ay = f.y - cy;
        const az = f.z - cz;
        return ax * ax + ay * ay + az * az < 2.1;
      });
    if (authoredBulb) continue;

    const axis = dx >= dz && dx >= dy ? 'x' : dz >= dy ? 'z' : 'y';
    const width = axis === 'x' ? Math.max(dy, dz) : axis === 'z' ? Math.max(dx, dy) : Math.max(dx, dz);
    const run: GlowRun = {
      ax: cx,
      ay: cy,
      az: cz,
      bx: cx,
      by: cy,
      bz: cz,
      color: b.color,
      axis,
      width,
      length: 0,
      group: -1,
      order: rawRuns.length,
    };
    if (axis === 'x') {
      run.ax = b.x0;
      run.bx = b.x1;
    } else if (axis === 'y') {
      run.ay = b.y0;
      run.by = b.y1;
    } else {
      run.az = b.z0;
      run.bz = b.z1;
    }
    run.length = Math.hypot(run.bx - run.ax, run.by - run.ay, run.bz - run.az);
    rawRuns.push(run);
  }

  // Connected components: a rim's four side boxes meet at their corners,
  // as do the four perimeter lines and many adjacent tower bands.
  const parent = rawRuns.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== i) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  // Only same-colour runs can connect, so test pairs within colour buckets
  // instead of every pair in the level.
  const runsByColor = new Map<number, number[]>();
  for (let i = 0; i < rawRuns.length; i++) {
    let bucket = runsByColor.get(rawRuns[i].color);
    if (!bucket) runsByColor.set(rawRuns[i].color, (bucket = []));
    bucket.push(i);
  }
  const touch2 = 0.55 * 0.55;
  for (const bucket of runsByColor.values()) {
    for (let bi = 0; bi < bucket.length; bi++) {
      const i = bucket[bi];
      for (let bj = bi + 1; bj < bucket.length; bj++) {
        const j = bucket[bj];
        if (glowEndpointsTouch(rawRuns[i], rawRuns[j], touch2)) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) parent[rj] = ri;
        }
      }
    }
  }
  const groupIds = new Map<number, number>();
  for (let i = 0; i < rawRuns.length; i++) {
    const root = find(i);
    let id = groupIds.get(root);
    if (id === undefined) {
      id = groupIds.size;
      groupIds.set(root, id);
    }
    rawRuns[i].group = id;
  }

  const runs = mergeCollinearGlowRuns(rawRuns);

  for (const run of runs) {
    // Lift horizontal strips slightly and move the whole run a little away
    // from its support. The same offset is applied to both endpoints, so a
    // run stays a run instead of acquiring a bend at every sample.
    if (run.axis !== 'y') {
      run.ay += 0.38;
      run.by += 0.38;
    }
    let cx = (run.ax + run.bx) * 0.5;
    let cy = (run.ay + run.by) * 0.5;
    let cz = (run.az + run.bz) * 0.5;
    const [ox, oz] = outwardGlowOffset(level, cx, cy, cz);
    run.ax += ox;
    run.bx += ox;
    run.az += oz;
    run.bz += oz;
    cx += ox;
    cz += oz;
    run.length = Math.hypot(run.bx - run.ax, run.by - run.ay, run.bz - run.az);

    // One grouped emitter for the whole merged straight strip. The engine
    // gives it one point-style lens flare and one wide coloured spotlight;
    // the cone is sized from the strip length/height so its footprint covers
    // the connected segment instead of producing a row of small span pools.
    const outwardLen = Math.hypot(ox, oz);
    const coverageAngle = clampLevelNum(
      Math.atan2(run.length * 0.5 + 2.5, Math.max(0.9, cy)),
      0.78,
      1.42,
    );
    out.push({
      x: cx,
      y: cy,
      z: cz,
      x2: run.bx,
      y2: run.by,
      z2: run.bz,
      color: run.color,
      intensity: clampLevelNum(12 + run.length * 0.7 + run.width * 2.5, 14, 60),
      dist: clampLevelNum(10 + run.length * 0.55 + Math.max(0, cy - 6) * 0.35, 12, 46),
      angle: coverageAngle,
      dirY: -1,
      kind: 'neon',
      radius: clampLevelNum(run.width * 0.5 + 0.08, 0.12, 1.2),
      flare: clampLevelNum(0.16 + Math.sqrt(run.length) * 0.035 + run.width * 0.03, 0.18, 0.48),
      group: run.group,
      stripLength: run.length,
      stripWidth: run.width,
      nx: outwardLen > 0.001 ? ox / outwardLen : 0,
      nz: outwardLen > 0.001 ? oz / outwardLen : 0,
    });
  }

  emissiveSourceCache.set(level, out);
  return out;
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
  lights: LightFixture[] = [];
  cones: VolumeCone[] = [];
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
  /**
   * Coloured light fixture: registers a real light source for the engine's light pool and
   * (optionally) a glowing bulb + volumetric cone hanging below it. The bulb/cone are pure
   * visuals, so the fixture still reads correctly when the real light is culled by quality.
   */
  light(x: number, y: number, z: number, color: number, intensity = 60, dist = 18, coneH = 0, flicker = 0, bulb = true) {
    const r1 = coneH > 0 ? Math.min(3.4, coneH * 0.44) : 0;
    // Aim the real spotlight down the visible cone (plus a little spill) so it
    // stops leaking through the ceiling/walls behind the fixture. Cone-less
    // beacons and braziers keep a wide downward wash.
    const angle = coneH > 0 ? Math.atan2(r1, coneH) + 0.22 : 1.08;
    this.lights.push({ x, y, z, color, intensity, dist, flicker, angle, dirY: -1 });
    if (bulb) this.gbox(x - 0.3, y - 0.15, z - 0.3, x + 0.3, y + 0.15, z + 0.3, color);
    if (coneH > 0) this.cones.push({ x, y: y - 0.12, z, r0: 0.38, r1, h: coneH, color, intensity: 0.5 });
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
      // bunker floodlight: thin mast + coloured fixture with a volumetric cone
      L.solid(cx, cz, 0.45, 0.45, 2.4, 0x5546a0, 3);
      L.light(cx, 5.6, cz, sx * sz > 0 ? CY : MG, 75, 24, 5);
    }
  }
  // warm beacon over the ziggurat summit
  L.solid(0, 0, 0.4, 0.4, 2, 0x8a6ae0, 6);
  L.light(0, 8.3, 0, YL, 95, 28, 0, 0.25);
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
    id: 'plaza', themeName: 'Neon', styleName: 'Mixed', name: 'Neon Plaza', tagline: 'Open ziggurat arena with fast sightlines and jump pads.', size: '120 × 120',
    w: 120, d: 120, maxH: 14, boxes: L.boxes, glow: L.glow, pads: L.pads, lights: L.lights, cones: L.cones,
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
    // sodium yard lamp: real warm light + volumetric cone (bulb already drawn above)
    L.light(px, 8.1, pz, 0xffc36b, 70, 22, 7.6, 0, false);
    void p;
  }
  // cool wash over the central crane platform (beacon mast on the tower roof)
  L.solid(0, 0, 0.35, 0.35, 2.2, 0x6a5a88, 10);
  L.light(0, 12.5, 0, CY, 80, 26, 0, 0.15);
  return {
    id: 'yard', themeName: 'Dusk', styleName: 'Maze', name: 'Container Yard', tagline: 'Maze of stacked containers, catwalks and a central crane tower.', size: '150 × 100',
    w: 150, d: 100, maxH: 12, boxes: L.boxes, glow: L.glow, pads: L.pads, lights: L.lights, cones: L.cones,
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
  // streetlights along the central cross streets (alternating cyan / magenta)
  {
    let k = 0;
    for (const sx of [-30, 0, 30]) {
      for (const sz of [-30, 0, 30]) {
        if (sx === 0 && sz === 0) continue;
        const x = sx + (sz === 0 ? 0 : 4);
        const z = sz + (sx === 0 ? 0 : 4);
        if (!L.free(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 0.6)) continue;
        L.solid(x, z, 0.5, 0.5, 6.4, 0x23234a);
        L.light(x, 6.7, z, k++ % 2 ? MG : CY, 65, 20, 6.1);
      }
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
    id: 'skyline', themeName: 'Midnight', styleName: 'Towers', name: 'Skyline District', tagline: 'Vertical city blocks. Fight in the streets or launch onto rooftops.', size: '124 × 124',
    w: 124, d: 124, maxH: 20, boxes: L.boxes, glow: L.glow, pads: L.pads, lights: L.lights, cones: L.cones,
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
      // flickering brazier on each pillar top
      L.light(sx * 14, 9.7, sz * 14, 0xff8a3c, 80, 22, 0, 0.7);
    }
  }
  L.solid(0, 0, 0.35, 0.35, 1.4, 0x8a5a90, 3);
  L.light(0, 4.7, 0, MG, 70, 20, 0, 0.2);
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
    id: 'colosseum', themeName: 'Ember', styleName: 'Open', name: 'The Colosseum', tagline: 'A sunken terraced bowl. Hold the high ground or own the pit.', size: '116 × 116',
    w: 116, d: 116, maxH: 16, boxes: L.boxes, glow: L.glow, pads: L.pads, lights: L.lights, cones: L.cones,
    theme: { skyTop: 0x2b0f2e, skyBottom: 0xffc34d, fog: 0x4a2340, ground: 0x4b3a4a, accent: YL, accent2: MG, sunColor: 0xffcf80, sunDir: [0.3, 0.5, -0.8], hemiSky: 0xffd9a0, hemiGround: 0x4a2848, lightColor: 0xffe0b0, discColor: 0xffc34d },
  };
}

/* ------------------------------------------------- Graphics showcase / benchmark
 * PRISM is the engine test range, opened from Settings → Graphics. Every district is built
 * to exercise a different renderer feature, and `vista` is the cinematic camera loop used
 * by both the attract mode and the benchmark run:
 *   centre  — mirror plaza + obelisk (SSR / environment reflections) ringed by a spectrum
 *             of coloured light fixtures with volumetric cones
 *   west    — slatted pergola: striped shadows + sun shafts (shadow quality, god rays)
 *   east    — receding arch alley ending at a tower (depth of field, fog, TAA stability)
 *   south   — bloom boulevard: dense emissive signage (bloom, coloured lights)
 *   north   — vista tower (view distance, atmosphere, sun disc / flare occlusion)
 */
function showcase(): LevelData {
  const L = new LB(144, 144, 20240);
  L.walls(0x241c52, 16, MG);
  const DARK = 0x23234a;
  const MID = 0x3a3565;

  /* ---- centre: mirror plaza + obelisk + spectrum ring ---- */
  const plazaTop = L.solid(0, 0, 36, 36, 0.5, 0x16162e);
  L.strip(plazaTop, CY);
  const ob = L.solid(0, 0, 3.2, 3.2, 11, 0x2c2c58, 0.5);
  L.strip(ob, MG);
  L.band(ob, 3.5, CY);
  L.band(ob, 6.5, MG);
  L.band(ob, 9.5, YL);
  L.solid(0, 0, 0.35, 0.35, 1.2, 0x2c2c58, 11.5);
  L.light(0, 13, 0, YL, 115, 34, 0, 0.2);
  const SPECTRUM = [0xff3b5c, 0xff8a3c, 0xffe14d, 0x7dff6b, 0x2de2ff, 0x4d6bff, 0xa26bff, 0xff2d95];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 13.5;
    const z = Math.sin(a) * 13.5;
    const p = L.solid(x, z, 1.3, 1.3, 4.6, DARK, 0.5);
    L.strip(p, SPECTRUM[k], 0.12);
    L.light(x, 5.8, z, SPECTRUM[k], 85, 24, 5.1);
  }

  /* ---- west: shadow pergola (slatted roof → striped shadows + shafts) ---- */
  for (const cx of [-54, -34]) {
    for (const cz of [-11, -3.7, 3.7, 11]) {
      const c = L.solid(cx, cz, 1.6, 1.6, 9, MID);
      L.band(c, 4.4, CY, 0.12);
    }
  }
  L.box(-56, 8.8, -13.4, -32, 9.6, -12.4, 0x4a4480);
  L.box(-56, 8.8, 12.4, -32, 9.6, 13.4, 0x4a4480);
  for (let z = -12.4; z <= 11; z += 3.2) L.box(-56, 9.05, z, -32, 9.55, z + 1.5, 0x4a4480);
  for (const lz of [-7, 0, 7]) {
    L.solid(-44, lz, 0.14, 0.14, 0.85, DARK, 8.2);
    L.light(-44, 8.1, lz, CY, 70, 20, 7.5);
  }
  L.solid(-48, -5, 4, 3, 1.3, 0x4b3a8f);
  L.solid(-40, 5, 3, 4, 1.3, 0x35508f);
  L.solid(-45, 9, 5, 2, 2.2, 0x5f4bb0);
  L.padTo(-29, 0, 0, -10, 0, 0.5, CY);

  /* ---- east: depth-of-field arch alley ---- */
  L.gbox(24, 0.02, -5.5, 58, 0.09, -5.2, CY);
  L.gbox(24, 0.02, 5.2, 58, 0.09, 5.5, MG);
  const archX = [28, 36, 44, 52];
  archX.forEach((ax, i) => {
    const h = 5.4 + i * 0.8;
    for (const sz of [-1, 1]) {
      const p = L.solid(ax, sz * 6.5, 1.6, 1.6, h, i % 2 ? 0x4a3f8a : 0x3f5fc0);
      L.strip(p, i % 2 ? MG : CY, 0.12);
    }
    if (i % 2 === 1) {
      const lin = L.box(ax - 1, h, -7.3, ax + 1, h + 0.9, 7.3, 0x5546a0);
      L.strip(lin, YL, 0.1);
      L.light(ax, h + 1.4, 0, i === 1 ? CY : 0xff8a3c, 70, 20, h + 0.6);
    }
  });
  for (const bx of [30, 46]) {
    for (const bz of [-4.6, 4.6]) {
      L.solid(bx, bz, 0.7, 0.7, 1.1, DARK);
      L.light(bx, 1.5, bz, bz < 0 ? CY : MG, 34, 12, 0);
    }
  }
  const fg = L.solid(22, 2.8, 1.4, 1.4, 4.2, 0xa3367f); // near foreground pillar for DoF
  L.strip(fg, YL, 0.12);
  const endTower = L.solid(63, 0, 11, 11, 19, 0x3f5fc0);
  L.strip(endTower, YL);
  for (let y = 4; y < 18; y += 4.5) L.band(endTower, y, CY, 0.14);
  L.light(63, 20, 0, MG, 95, 30, 0, 0.85);
  L.padTo(54, 0, 10, 63, 0, 19, YL);

  /* ---- south: bloom boulevard ---- */
  for (const wz of [34, 52]) {
    L.box(-26, 0, wz - 1, -3.5, 7.5, wz + 1, 0x2b2060);
    L.box(3.5, 0, wz - 1, 26, 7.5, wz + 1, 0x2b2060);
  }
  const SIGN = [MG, CY, YL, GR, 0xff8a3c];
  SIGN.forEach((col, i) => {
    const y = 1.3 + i * 1.35;
    L.gbox(-25, y, 35.02, 25, y + 0.32, 35.12, col);
    L.gbox(-25, y, 50.88, 25, y + 0.32, 50.98, col);
  });
  L.box(-24, 5.25, 42.8, 24, 5.5, 43.2, DARK); // lamp cable beam
  [-20, -12, -4, 4, 12, 20].forEach((px, i) => {
    const col = SIGN[i % SIGN.length];
    const plinth = L.solid(px, 43, 2.2, 2.2, 1.6, 0x36306a);
    L.strip(plinth, col, 0.12);
    L.gbox(px - 0.55, 1.6, 42.45, px + 0.55, 2.7, 43.55, col);
    L.solid(px, 43, 0.12, 0.12, 0.7, DARK, 4.6);
    L.light(px, 4.5, 43, col, 72, 19, 3.9);
  });

  /* ---- north: vista tower ---- */
  const base = L.solid(0, -46, 27, 27, 3, 0x40377a);
  L.strip(base, CY);
  L.stairs(0, -26.5, '-z', 6, 6, 0.5, 1, 0x5546a0);
  const tier2 = L.solid(0, -46, 16, 16, 4, 0x4a3f8a, 3);
  L.strip(tier2, MG);
  const tower = L.solid(0, -46, 9, 9, 9, 0x5b46a8, 7);
  L.strip(tower, YL);
  // deck railing
  L.box(-4.5, 16, -50.5, 4.5, 17, -50, 0x6a58b8);
  L.box(-4.5, 16, -42, 4.5, 17, -41.5, 0x6a58b8);
  L.box(4, 16, -50.5, 4.5, 17, -41.5, 0x6a58b8);
  L.box(-4.5, 16, -50.5, -4, 17, -41.5, 0x6a58b8);
  L.solid(0, -46, 0.35, 0.35, 2.4, DARK, 16);
  L.light(0, 18.8, -46, YL, 105, 36, 0, 0.15);
  L.light(6.5, 8.6, -39.5, CY, 55, 16, 0);
  L.padTo(9.5, 3, -36.5, 4, -42, 7, MG);
  L.padTo(6, 7, -39.8, 1.5, -44, 16, CY);
  L.padTo(-16, 0, -30, -6, -40, 3, YL);

  /* ---- corners: combat pockets ---- */
  const cornerCols = [CY, MG, YL, GR];
  [[50, 50], [-50, 50], [50, -50], [-50, -50]].forEach(([cx, cz], i) => {
    const col = cornerCols[i];
    const plat = L.solid(cx, cz, 13, 13, 2.2, 0x3a3565);
    L.strip(plat, col);
    L.stairs(cx - Math.sign(cx) * 10.5, cz, Math.sign(cx) > 0 ? '+x' : '-x', 4, 5, 0.44, 0.9, 0x5546a0);
    L.solid(cx + 3, cz - 3, 3, 1, 1.3, 0x4b3a8f, 2.2);
    L.solid(cx, cz, 0.4, 0.4, 2.8, DARK, 2.2);
    L.light(cx, 5.4, cz, col, 72, 22, 4.6);
    L.padTo(cx - Math.sign(cx) * 5, 2.2, cz - Math.sign(cz) * 5, Math.sign(cx) * 15, Math.sign(cz) * 15, 0.5, col);
  });

  /* ---- backdrop towers (fog / view-distance silhouettes inside the walls) ---- */
  for (const [tx, tz, th] of [[-65, -30, 28], [65, 30, 24], [-30, -65, 30], [34, 65, 22], [-65, 34, 20]] as const) {
    const t = L.solid(tx, tz, 7, 7, th, 0x1d2a55);
    L.strip(t, CY, 0.12);
    for (let y = 5; y < th - 2; y += 6) L.band(t, y, MG, 0.1);
  }

  // scatter cover
  let placed = 0;
  for (let i = 0; i < 700 && placed < 16; i++) {
    const w = L.range(2.4, 5);
    const d = L.range(2.4, 5);
    const x = L.range(-62, 62);
    const z = L.range(-62, 62);
    if (Math.abs(x) < 24 && Math.abs(z) < 24) continue;
    if (x < -26 && Math.abs(z) < 18) continue; // pergola
    if (x > 16 && Math.abs(z) < 11) continue; // alley
    if (Math.abs(x) < 32 && z > 28 && z < 58) continue; // boulevard
    if (Math.abs(x) < 20 && z < -26) continue; // vista tower
    if (!L.free(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 4)) continue;
    const h = L.pick([1.2, 1.4, 2.4, 3.2]);
    const b = L.solid(x, z, w, d, h, L.pick([0x4b3a8f, 0x3f5fc0, 0x5f4bb0, 0x35508f]));
    if (h > 2) L.strip(b, L.pick([CY, MG, YL]));
    placed++;
  }

  // cinematic loop: boulevard → mirror plaza → pergola → vista tower → DoF alley → boulevard
  const vista: [number, number, number][] = [
    [0, 2.6, 66], [0, 2.4, 46], [0, 2.6, 37], [-6, 3, 20], [-12, 2.8, 10], [0, 2.5, 15.5],
    [15.5, 2.9, 9.5], [10, 3.6, -12], [-8, 3.2, -10], [-28, 2.6, -1], [-44, 2.4, 0], [-58, 3.4, 4],
    [-34, 7, -22], [-6, 14, -30], [0, 19.5, -38], [0, 17.8, -46], [12, 11, -28], [23, 3.2, -12],
    [25, 2.3, 1.5], [40, 2.3, 0], [54, 2.8, 0], [38, 5.5, 20], [1, 3.2, 27], [0, 2.6, 43],
  ];
  const vistaLook: [number, number, number][] = [
    [0, 4, 43], [0, 5, 16], [0, 7, 0], [0, 7, 0], [0, 8, 0], [0, 8, 0],
    [0, 8, 0], [-6, 6, -20], [-40, 5, -2], [-48, 4, 0], [-90, 10, -6], [-130, 42, -52],
    [-20, 8, -40], [0, 15, -46], [0, 12, -50], [-16, 3, 30], [24, 3, -4], [48, 4, 0],
    [63, 8, 0], [63, 11, 0], [63, 16, 0], [6, 4, 40], [0, 4, 43], [0, 3.5, 66],
  ];
  return {
    id: 'showcase', themeName: 'Reference', styleName: 'Showcase', name: 'PRISM — Graphics Showcase', tagline: 'Engine test range: lighting, reflections, volumetrics and the benchmark loop.', size: '144 × 144',
    w: 144, d: 144, maxH: 30, boxes: L.boxes, glow: L.glow, pads: L.pads, lights: L.lights, cones: L.cones, vista, vistaLook,
    theme: { skyTop: 0x0b0630, skyBottom: 0xff7a4d, fog: 0x2c1445, ground: 0x262152, accent: MG, accent2: CY, sunColor: 0xffb37a, sunDir: [-0.55, 0.42, -0.6], hemiSky: 0xc9a8ff, hemiGround: 0x38204f, lightColor: 0xffdcb8, discColor: 0xff8a5c },
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
  // Always draw both autoTheme and autoStyle so switching theme never alters style or layout RNG, and vice versa
  const autoTheme = PROC_THEMES[Math.floor(L.r() * PROC_THEMES.length)];
  const autoStyle = (['mixed', 'towers', 'maze', 'open'] as const)[Math.floor(L.r() * 4)];
  const T = (opts?.theme && opts.theme !== 'auto' ? PROC_THEMES.find((t) => t.id === opts.theme) : null) ?? autoTheme;
  const style = (opts?.style && opts.style !== 'auto' ? opts.style : autoStyle) as 'mixed' | 'towers' | 'maze' | 'open';
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
  // districts on a grid — one axis per arena dimension so asymmetric (W≠D) maps stay inside the bounds
  const cell = 22;
  const nx = Math.max(1, Math.floor((W - 10) / cell));
  const nz = Math.max(1, Math.floor((D - 10) / cell));
  const startX = -((nx - 1) * cell) / 2;
  const startZ = -((nz - 1) * cell) / 2;
  type B = { cx: number; cz: number; h: number; box: Box };
  const towers: B[][] = [];
  for (let i = 0; i < nx; i++) {
    towers[i] = [];
    for (let j = 0; j < nz; j++) {
      const cx = startX + i * cell + (L.r() - 0.5) * 3;
      const cz = startZ + j * cell + (L.r() - 0.5) * 3;
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
  // coloured fixtures: centrepiece beacon + a few tower-top lights with cones
  L.light(0, centre === 'zig' ? 5.6 : 10.4, 0, neon[2], 85, 26, 0, 0.2);
  {
    let placedLights = 0;
    for (let i = 0; i < nx && placedLights < 7; i++) {
      for (let j = 0; j < nz && placedLights < 7; j++) {
        const t = towers[i][j];
        if (!t) continue;
        L.light(t.cx, t.h + 0.9, t.cz, L.pick(neon), 65, 20, Math.min(7, t.h - 1), L.r() < 0.3 ? 0.4 : 0);
        placedLights++;
      }
    }
    // a couple of ground lamps near the centrepiece
    for (const [lx, lz] of [[cR + 6, cR + 6], [-(cR + 6), -(cR + 6)], [cR + 6, -(cR + 6)], [-(cR + 6), cR + 6]]) {
      if (!L.free(lx - 0.4, lx + 0.4, lz - 0.4, lz + 0.4, 0.8)) continue;
      L.solid(lx, lz, 0.5, 0.5, 5.6, L.pick(T.cols));
      L.light(lx, 5.9, lz, L.pick(neon), 60, 18, 5.2);
    }
  }
  // bridges between neighbouring towers of the same height
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < nz; j++) {
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
  const styleNice = style.charAt(0).toUpperCase() + style.slice(1);
  return {
    id: 'procedural', themeName: T.name, styleName: styleNice, key: `proc-${seed}-${size}-${W}x${D}-${T.id}-${style}`, name: `${T.name} Sector #${seed % 10000}`,
    tagline: `Procedurally generated ${sz.name.toLowerCase()} arena · ${styleNice.toLowerCase()} layout (seed ${seed}).`, size: `${W} × ${D}`,
    w: W, d: D, maxH: 14, boxes: L.boxes, glow: L.glow, pads: L.pads, lights: L.lights, cones: L.cones, theme: T.theme,
  };
}

export interface BoxMetrics {
  baseY: number;
  objectHeight: number;
  topY: number;
  clearanceUnder: number;
  width: number;
  depth: number;
  area: number;
  volume: number;
  cx: number;
  cz: number;
  kind: string;
  traversal: string;
}

/**
 * Calculates in-world elevation and object height for a structure box, taking into account
 * underlying terraces/platforms when a box is anchored at y0=0 inside a raised tier.
 */
export function computeBoxMetrics(level: LevelData, box: Box): BoxMetrics {
  const width = +(box.x1 - box.x0).toFixed(2);
  const depth = +(box.z1 - box.z0).toFixed(2);
  const cx = +((box.x0 + box.x1) / 2).toFixed(2);
  const cz = +((box.z0 + box.z1) / 2).toFixed(2);
  let supportBelow = 0;
  for (const other of level.boxes) {
    if (other === box) continue;
    if (other.y1 >= box.y1 - 0.01) continue;
    const ox = Math.min(box.x1, other.x1) - Math.max(box.x0, other.x0);
    const oz = Math.min(box.z1, other.z1) - Math.max(box.z0, other.z0);
    if (ox > 0.08 && oz > 0.08) {
      // If box is elevated (y0 > 0), only count supports at or below box.y0
      if (box.y0 > 0.01 && other.y1 > box.y0 + 0.05) continue;
      if (other.y1 > supportBelow) supportBelow = other.y1;
    }
  }
  const baseY = +(box.y0 > 0.01 ? box.y0 : supportBelow).toFixed(2);
  const topY = +box.y1.toFixed(2);
  const objectHeight = +Math.max(0.05, topY - baseY).toFixed(2);
  const clearanceUnder = +(box.y0 > supportBelow + 0.05 ? box.y0 - supportBelow : 0).toFixed(2);
  const area = +(width * depth).toFixed(1);
  const volume = +(area * objectHeight).toFixed(1);

  const hw = level.w / 2;
  const hd = level.d / 2;
  const isPerimeter = box.x0 <= -hw + 0.1 || box.x1 >= hw - 0.1 || box.z0 <= -hd + 0.1 || box.z1 >= hd - 0.1;
  let kind = 'Structure';
  if (isPerimeter && topY >= 10) kind = 'Perimeter Wall';
  else if (clearanceUnder > 0.5 && objectHeight <= 1.6) kind = 'Bridge / Catwalk';
  else if (objectHeight <= 0.6 && (width <= 6.5 || depth <= 6.5)) kind = 'Stair / Step';
  else if (topY >= 7.5) kind = 'Tower / High-Rise';
  else if (area >= 90) kind = 'Platform / Terrace';
  else if (objectHeight <= 1.8) kind = 'Low Cover';
  else kind = 'Fortification / Building';

  let traversal = 'Requires stairs or jump pad';
  if (objectHeight <= 0.56) traversal = 'Walkable step-up (≤ 0.56 m)';
  else if (objectHeight <= 1.45) traversal = 'Single jump reachable';
  else if (objectHeight <= 2.9) traversal = 'Double / wall-jump reachable';

  return { baseY, objectHeight, topY, clearanceUnder, width, depth, area, volume, cx, cz, kind, traversal };
}

const builders: Record<BuiltinLevelId, () => LevelData> = { plaza, yard, skyline, colosseum, showcase };
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
