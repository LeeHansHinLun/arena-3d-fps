import type { Box } from './levels';

export interface Body {
  x: number;
  y: number; // feet
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  h: number;
  onGround: boolean;
  wasGround: boolean;
  landVy: number;
  hitWall: boolean;
  stepDy: number;
}

export function makeBody(r = 0.3, h = 1.8): Body {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r, h, onGround: false, wasGround: false, landVy: 0, hitWall: false, stepDy: 0 };
}

export const STEP_H = 0.56;
const E = 1e-4;

export interface RayHit {
  nx: number;
  ny: number;
  nz: number;
}

export class World {
  n: number;
  b: Float32Array;
  private grid = new Map<number, number[]>();
  private stamp: Int32Array;
  private sid = 0;
  private cs = 8;
  private tmpA: number[] = [];
  private tmpB: number[] = [];
  private cand: number[] = [];

  constructor(boxes: Box[]) {
    this.n = boxes.length;
    this.b = new Float32Array(this.n * 6);
    this.stamp = new Int32Array(this.n);
    boxes.forEach((bx, i) => {
      const o = i * 6;
      this.b[o] = bx.x0; this.b[o + 1] = bx.y0; this.b[o + 2] = bx.z0;
      this.b[o + 3] = bx.x1; this.b[o + 4] = bx.y1; this.b[o + 5] = bx.z1;
      const ix0 = Math.floor(bx.x0 / this.cs), ix1 = Math.floor(bx.x1 / this.cs);
      const iz0 = Math.floor(bx.z0 / this.cs), iz1 = Math.floor(bx.z1 / this.cs);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = this.key(ix, iz);
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push(i);
        }
      }
    });
  }

  private key(ix: number, iz: number) {
    return (ix + 256) * 1024 + (iz + 256);
  }

  private collect(x0: number, z0: number, x1: number, z1: number, out: number[]) {
    out.length = 0;
    this.sid++;
    const ix0 = Math.floor(x0 / this.cs), ix1 = Math.floor(x1 / this.cs);
    const iz0 = Math.floor(z0 / this.cs), iz1 = Math.floor(z1 / this.cs);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const l = this.grid.get(this.key(ix, iz));
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const i = l[k];
          if (this.stamp[i] !== this.sid) {
            this.stamp[i] = this.sid;
            out.push(i);
          }
        }
      }
    }
  }

  /** fills `out` with indices of boxes overlapping the AABB; returns count */
  overlapBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[]): number {
    this.collect(x0, z0, x1, z1, this.cand);
    out.length = 0;
    const b = this.b;
    for (let k = 0; k < this.cand.length; k++) {
      const i = this.cand[k];
      const o = i * 6;
      if (x1 > b[o] + E && x0 < b[o + 3] - E && y1 > b[o + 1] + E && y0 < b[o + 4] - E && z1 > b[o + 2] + E && z0 < b[o + 5] - E) out.push(i);
    }
    return out.length;
  }

  anyOverlap(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    return this.overlapBox(x0, y0, z0, x1, y1, z1, this.tmpB) > 0;
  }

  /** surface heights of boxes under a footprint */
  topsIn(x0: number, z0: number, x1: number, z1: number, out: number[]) {
    this.collect(x0, z0, x1, z1, this.cand);
    out.length = 0;
    const b = this.b;
    for (let k = 0; k < this.cand.length; k++) {
      const o = this.cand[k] * 6;
      if (x1 > b[o] && x0 < b[o + 3] && z1 > b[o + 2] && z0 < b[o + 5]) out.push(b[o + 4]);
    }
  }

  /** is there a box top at height ~h covering point (x,z)? */
  supported(x: number, z: number, h: number): boolean {
    if (h < 0.001) return true;
    this.collect(x - 0.01, z - 0.01, x + 0.01, z + 0.01, this.cand);
    const b = this.b;
    for (let k = 0; k < this.cand.length; k++) {
      const o = this.cand[k] * 6;
      if (x >= b[o] && x <= b[o + 3] && z >= b[o + 2] && z <= b[o + 5] && Math.abs(b[o + 4] - h) < 0.02) return true;
    }
    return false;
  }

  private bodyOverlap(bd: Body, x: number, y: number, z: number, out: number[]) {
    return this.overlapBox(x - bd.r, y, z - bd.r, x + bd.r, y + bd.h, z + bd.r, out);
  }

  moveBody(bd: Body, dt: number) {
    const dist = Math.max(Math.abs(bd.vx), Math.abs(bd.vz), Math.abs(bd.vy)) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.3));
    const h = dt / n;
    bd.wasGround = bd.onGround;
    bd.onGround = false;
    bd.landVy = 0;
    bd.hitWall = false;
    for (let i = 0; i < n; i++) {
      this.moveH(bd, true, bd.vx * h);
      this.moveH(bd, false, bd.vz * h);
      this.moveV(bd, bd.vy * h);
    }
    if (bd.wasGround && !bd.onGround && bd.vy <= 0) this.snapDown(bd);
  }

  private moveH(bd: Body, isX: boolean, d: number) {
    if (d === 0) return;
    if (isX) bd.x += d;
    else bd.z += d;
    const list = this.tmpA;
    if (!this.bodyOverlap(bd, bd.x, bd.y, bd.z, list)) return;
    const b = this.b;
    if (bd.vy <= 0.5) {
      let top = -1e9;
      for (let k = 0; k < list.length; k++) top = Math.max(top, b[list[k] * 6 + 4]);
      const rise = top - bd.y;
      if (rise > 0 && rise <= STEP_H) {
        const oy = bd.y;
        const ny = top + 0.002;
        if (!this.bodyOverlap(bd, bd.x, ny, bd.z, this.tmpB)) {
          bd.y = ny;
          bd.stepDy += oy - ny;
          if (bd.vy < 0) bd.vy = 0;
          return;
        }
      }
    }
    bd.hitWall = true;
    for (let k = 0; k < list.length; k++) {
      const o = list[k] * 6;
      if (!(bd.x + bd.r > b[o] + E && bd.x - bd.r < b[o + 3] - E && bd.y + bd.h > b[o + 1] + E && bd.y < b[o + 4] - E && bd.z + bd.r > b[o + 2] + E && bd.z - bd.r < b[o + 5] - E)) continue;
      if (isX) {
        if (d > 0) bd.x = b[o] - bd.r - 0.001;
        else bd.x = b[o + 3] + bd.r + 0.001;
        bd.vx = 0;
      } else {
        if (d > 0) bd.z = b[o + 2] - bd.r - 0.001;
        else bd.z = b[o + 5] + bd.r + 0.001;
        bd.vz = 0;
      }
    }
  }

  private land(bd: Body) {
    bd.onGround = true;
    if (bd.vy < bd.landVy) bd.landVy = bd.vy;
    bd.vy = 0;
  }

  private moveV(bd: Body, d: number) {
    if (d === 0) return;
    bd.y += d;
    if (bd.y < 0) {
      bd.y = 0;
      this.land(bd);
      return;
    }
    const list = this.tmpA;
    if (!this.bodyOverlap(bd, bd.x, bd.y, bd.z, list)) return;
    const b = this.b;
    if (d < 0) {
      let top = -1e9;
      for (let k = 0; k < list.length; k++) top = Math.max(top, b[list[k] * 6 + 4]);
      bd.y = top;
      this.land(bd);
    } else {
      let bot = 1e9;
      for (let k = 0; k < list.length; k++) bot = Math.min(bot, b[list[k] * 6 + 1]);
      bd.y = bot - bd.h - 0.001;
      if (bd.vy > 0) bd.vy = 0;
    }
  }

  private snapDown(bd: Body) {
    const ny = bd.y - STEP_H;
    const list = this.tmpA;
    if (this.bodyOverlap(bd, bd.x, Math.max(0, ny), bd.z, list)) {
      const b = this.b;
      let top = -1;
      for (let k = 0; k < list.length; k++) {
        const t = b[list[k] * 6 + 4];
        if (t <= bd.y + 0.001) top = Math.max(top, t);
      }
      if (top >= 0 && top > ny - 0.001) {
        bd.stepDy += bd.y - top;
        bd.y = top;
        bd.onGround = true;
        bd.vy = 0;
        return;
      }
    }
    if (bd.y > 0 && bd.y <= STEP_H) {
      bd.stepDy += bd.y;
      bd.y = 0;
      bd.onGround = true;
      bd.vy = 0;
    }
  }

  /** returns wall normal (nx,nz) if a wall is within `dist` of the body, else null */
  probeWall(bd: Body, dist: number, out: { nx: number; nz: number }): boolean {
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      if (this.bodyOverlap(bd, bd.x + dx * dist, bd.y + 0.2, bd.z + dz * dist, this.tmpB)) {
        out.nx = -dx;
        out.nz = -dz;
        return true;
      }
    }
    return false;
  }

  /** ray vs world using the uniform grid; returns t or Infinity. Includes the y=0 ground plane. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, hit?: RayHit): number {
    let best = maxT;
    let bnx = 0, bny = 0, bnz = 0;
    const b = this.b;
    const cs = this.cs;
    const sid = ++this.sid;
    let cx = Math.floor(ox / cs), cz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = stepX !== 0 ? Math.abs(cs / dx) : Infinity;
    const tdz = stepZ !== 0 ? Math.abs(cs / dz) : Infinity;
    let tmx = stepX > 0 ? ((cx + 1) * cs - ox) / dx : stepX < 0 ? (cx * cs - ox) / dx : Infinity;
    let tmz = stepZ > 0 ? ((cz + 1) * cs - oz) / dz : stepZ < 0 ? (cz * cs - oz) / dz : Infinity;
    let guard = 0;
    let t = 0;
    while (t <= best && guard++ < 400) {
      const list = this.grid.get(this.key(cx, cz));
      if (list) {
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (this.stamp[i] === sid) continue;
          this.stamp[i] = sid;
          const o = i * 6;
          let tmin = 0, tmax = best, axis = -1, sgn = 0;
          if (Math.abs(dx) < 1e-9) {
            if (ox < b[o] || ox > b[o + 3]) continue;
          } else {
            let t1 = (b[o] - ox) / dx, t2 = (b[o + 3] - ox) / dx;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tmin) { tmin = t1; axis = 0; sgn = dx > 0 ? -1 : 1; }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }
          if (Math.abs(dy) < 1e-9) {
            if (oy < b[o + 1] || oy > b[o + 4]) continue;
          } else {
            let t1 = (b[o + 1] - oy) / dy, t2 = (b[o + 4] - oy) / dy;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tmin) { tmin = t1; axis = 1; sgn = dy > 0 ? -1 : 1; }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }
          if (Math.abs(dz) < 1e-9) {
            if (oz < b[o + 2] || oz > b[o + 5]) continue;
          } else {
            let t1 = (b[o + 2] - oz) / dz, t2 = (b[o + 5] - oz) / dz;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tmin) { tmin = t1; axis = 2; sgn = dz > 0 ? -1 : 1; }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) continue;
          }
          if (axis < 0) continue;
          if (tmin < best) {
            best = tmin;
            bnx = axis === 0 ? sgn : 0;
            bny = axis === 1 ? sgn : 0;
            bnz = axis === 2 ? sgn : 0;
          }
        }
      }
      if (tmx < tmz) { t = tmx; cx += stepX; tmx += tdx; }
      else { t = tmz; cz += stepZ; tmz += tdz; }
      if (t > best) break;
      if (cx < -64 || cx > 64 || cz < -64 || cz > 64) break;
    }
    if (dy < -1e-9 && oy > 0) {
      const t = -oy / dy;
      if (t < best) { best = t; bnx = 0; bny = 1; bnz = 0; }
    }
    if (best >= maxT) return Infinity;
    if (hit) { hit.nx = bnx; hit.ny = bny; hit.nz = bnz; }
    return best;
  }
}

export function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = 0;
  let tmax = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return -1;
    } else {
      let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** ray vs sphere, returns t>=0 or -1 */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}
