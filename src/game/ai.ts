import type { Fighter } from './fighter';
import type { Nav } from './nav';
import type { World } from './world';
import { DIFF_PARAMS, type Difficulty, type WeaponId } from './types';

export interface PickupLite {
  x: number;
  y: number;
  z: number;
  type: 'health' | 'armor';
  active: boolean;
}

export interface AICtx {
  world: World;
  nav: Nav;
  fighters: Fighter[];
  time: number;
  diff: { react: number; aimErr: number; fireMul: number; dmgMul: number; speedMul: number; turn: number; hear: number };
  gravity: number;
  speedMul: number;
  insta: boolean;
  pickups: PickupLite[];
  isEnemy(a: Fighter, b: Fighter): boolean;
  fire(f: Fighter, target: Fighter, weapon: WeaponId): void;
  mode?: string;
  hill?: { x: number; z: number; r: number };
  ctf?: { flags: { x: number; z: number; team: number; baseX: number; baseZ: number }[] };
  bountyId?: number;
}

const TAU = Math.PI * 2;
function angDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const FIRE: Record<WeaponId, { interval: number; burstMin: number; burstVar: number }> = {
  rifle: { interval: 0.115, burstMin: 3, burstVar: 5 },
  shotgun: { interval: 0.95, burstMin: 1, burstVar: 1 },
  rail: { interval: 1.3, burstMin: 1, burstVar: 1 },
  rocket: { interval: 1.4, burstMin: 1, burstVar: 1 },
};

function pickWeapon(c: AICtx, dist: number): WeaponId {
  if (c.insta) return 'rail';
  const r = Math.random();
  if (dist < 9) return r < 0.7 ? 'shotgun' : 'rifle';
  if (dist < 30) return r < 0.65 ? 'rifle' : r < 0.82 ? 'rocket' : 'rail';
  return r < 0.55 ? 'rifle' : 'rail';
}

function scan(c: AICtx, f: Fighter) {
  const ai = f.ai!;
  const b = f.body;
  let best: Fighter | null = null;
  let bd = 1e9;
  const ex = b.x, ey = b.y + 1.5, ez = b.z;
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
  for (const e of c.fighters) {
    if (e === f || !e.alive || !c.isEnemy(f, e)) continue;
    const dx = e.body.x - b.x, dz = e.body.z - b.z, dy = e.body.y + 1.1 - ey;
    const d = Math.hypot(dx, dz);
    if (d > 80) continue;
    const alerted = c.time - e.lastShotT < 1.2 && d < 45;
    if (!alerted && d > 7 && (dx * fx + dz * fz) / (d || 1) < 0) continue;
    const d3 = Math.hypot(d, dy) || 0.01;
    if (d3 >= bd) continue;
    if (c.world.raycast(ex, ey, ez, dx / d3, dy / d3, dz / d3, d3 - 0.3) !== Infinity) continue;
    best = e;
    bd = d3;
  }
  if (best) {
    if (ai.target !== best) {
      ai.target = best;
      ai.reactT = c.diff.react * (0.7 + Math.random() * 0.7);
      ai.path = [];
    }
    ai.canSee = true;
    ai.seenT = c.time;
    ai.lastX = best.body.x;
    ai.lastY = best.body.y;
    ai.lastZ = best.body.z;
  } else {
    ai.canSee = false;
    if (ai.target && c.time - ai.seenT > 4) {
      ai.target = null;
      ai.path = [];
    }
  }
}

function ensurePath(c: AICtx, f: Fighter, gx: number, gy: number, gz: number, force = false) {
  const ai = f.ai!;
  if (!force && ai.path.length && ai.pathIdx < ai.path.length && ai.repathT > 0) return;
  if (ai.repathT > 0 && !force && ai.path.length === 0 && ai.repathT > 0.5) return;
  const b = f.body;
  const s = c.nav.nearest(b.x, b.y, b.z);
  const g = c.nav.nearest(gx, gy, gz);
  const p = c.nav.path(s, g);
  ai.path = p ?? [];
  ai.pathIdx = p && p.length > 1 ? 1 : p ? p.length : 0;
  ai.repathT = 1.0 + Math.random() * 0.8;
}

function stepPath(c: AICtx, f: Fighter): { dx: number; dz: number; rise: number; dist: number } | null {
  const ai = f.ai!;
  const b = f.body;
  const nodes = c.nav.nodes;
  while (ai.pathIdx < ai.path.length) {
    const n = nodes[ai.path[ai.pathIdx]];
    if (Math.hypot(n.x - b.x, n.z - b.z) < 0.85 && Math.abs(n.y - b.y) < 1.3) ai.pathIdx++;
    else break;
  }
  if (ai.pathIdx >= ai.path.length) return null;
  const n = nodes[ai.path[ai.pathIdx]];
  const dx = n.x - b.x, dz = n.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  return { dx: dx / d, dz: dz / d, rise: n.y - b.y, dist: d };
}

function newRoamGoal(c: AICtx, f: Fighter) {
  const live = c.pickups.filter((p) => p.active);
  if (c.mode === 'ctf' && c.ctf) {
    if (f.carrying >= 0) {
      const home = c.ctf.flags.find((fl) => fl.team === f.team);
      if (home) { ensurePath(c, f, home.baseX, 0, home.baseZ, true); return; }
    }
    const flag = c.ctf.flags.find((fl) => fl.team !== f.team);
    if (flag) { ensurePath(c, f, flag.x, 0, flag.z, true); return; }
  }
  if (c.mode === 'koth' && c.hill && Math.random() < 0.7) {
    ensurePath(c, f, c.hill.x + (Math.random() - 0.5) * 4, 0, c.hill.z + (Math.random() - 0.5) * 4, true);
    return;
  }
  if (f.hp < 60) {
    const hp = live.filter((p) => p.type === 'health');
    if (hp.length) {
      let best = hp[0], bd = 1e9;
      for (const p of hp) {
        const d = Math.hypot(p.x - f.body.x, p.z - f.body.z);
        if (d < bd) { bd = d; best = p; }
      }
      ensurePath(c, f, best.x, best.y, best.z, true);
      return;
    }
  }
  if (live.length && Math.random() < 0.3) {
    const p = live[Math.floor(Math.random() * live.length)];
    ensurePath(c, f, p.x, p.y, p.z, true);
    return;
  }
  const n = c.nav.nodes[c.nav.randomMain(Math.random)];
  ensurePath(c, f, n.x, n.y, n.z, true);
}

export function updateBot(c: AICtx, f: Fighter, dt: number, lod = 0) {
  const ai = f.ai!;
  const b = f.body;
  const base = f.skill && f.skill !== 'auto' ? DIFF_PARAMS[f.skill as Difficulty] : c.diff;
  const fr = f.kind === 'fake' ? f.frustration : 0;
  const pingK = f.kind === 'fake' ? Math.max(0, Math.min(1, (f.ping - 55) / 190)) : 0;
  const dp = { ...base, react: base.react * (1 + pingK * 1.6), aimErr: base.aimErr * (1 + fr * 0.7 + pingK * 0.9), fireMul: base.fireMul * (1 - fr * 0.22), speedMul: base.speedMul * (1 + fr * 0.06) };
  // high-ping fake players occasionally rubber-band / jump around
  if (pingK > 0.35 && Math.random() < dt * pingK * 0.55) {
    const nx = b.x + (Math.random() - 0.5) * 2.4;
    const nz = b.z + (Math.random() - 0.5) * 2.4;
    if (!c.world.anyOverlap(nx - 0.3, b.y + 0.1, nz - 0.3, nx + 0.3, b.y + 1.7, nz + 0.3)) {
      b.x = nx;
      b.z = nz;
    }
  }
  ai.fireCd -= dt;
  ai.reactT -= dt;
  ai.jumpCd -= dt;
  ai.repathT -= dt;
  ai.strafeT -= dt;
  ai.weaponT -= dt;
  ai.scanT -= dt;
  if (ai.burstPause > 0) ai.burstPause -= dt;

  if (ai.target && !ai.target.alive) {
    ai.target = null;
    ai.canSee = false;
    ai.path = [];
  }
  if (ai.scanT <= 0 && lod < 2) {
    ai.scanT = (0.2 + Math.random() * 0.12) * (lod === 1 ? 2.5 : 1);
    scan(c, f);
  }

  const tgt = ai.target;
  const fight = !!tgt && ai.canSee;
  let wx = 0, wz = 0;
  let speed = 6.3 * dp.speedMul * c.speedMul;
  let wantJump = false;
  let desiredYaw = f.yaw;
  let yawRate = 6;

  if (fight && tgt) {
    const dx = tgt.body.x - b.x, dz = tgt.body.z - b.z;
    const dist = Math.hypot(dx, dz) || 1;
    const tx = dx / dist, tz = dz / dist;
    if (ai.weaponT <= 0) {
      ai.weaponT = 1.5 + Math.random() * 1.5;
      ai.weapon = pickWeapon(c, dist);
    }
    const ideal = ai.weapon === 'shotgun' ? 6 : ai.weapon === 'rail' ? 24 : ai.weapon === 'rocket' ? 16 : 13;
    if (ai.strafeT <= 0) {
      ai.strafeT = 0.5 + Math.random() * 1.1;
      ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.3) wantJump = true;
    }
    const fwd = dist > ideal + 3 ? 1 : dist < ideal - 4 ? -0.9 : 0.1;
    wx = -tz * ai.strafeDir * 0.85 + tx * fwd;
    wz = tx * ai.strafeDir * 0.85 + tz * fwd;
    speed *= 0.92;
    desiredYaw = Math.atan2(-dx, -dz);
    yawRate = dp.turn;
    const dy = tgt.body.y + 1.2 - (b.y + 1.5);
    f.pitch += (Math.atan2(dy, dist) - f.pitch) * Math.min(1, dt * 8);

    // shooting
    const yawErr = Math.abs(angDiff(f.yaw, desiredYaw));
    const range = ai.weapon === 'shotgun' ? 20 : 90;
    if (ai.reactT <= 0 && yawErr < 0.22 && ai.fireCd <= 0 && ai.burstPause <= 0 && dist < range) {
      c.fire(f, tgt, ai.weapon);
      const w = FIRE[ai.weapon];
      ai.fireCd = w.interval * dp.fireMul * (0.9 + Math.random() * 0.3);
      if (ai.burstLeft <= 0) ai.burstLeft = w.burstMin + Math.floor(Math.random() * w.burstVar);
      ai.burstLeft--;
      if (ai.burstLeft <= 0) {
        ai.burstPause = (0.25 + Math.random() * 0.55) * dp.fireMul;
        ai.burstLeft = 0;
      }
    }
  } else {
    let goalDone = false;
    if (tgt) {
      // chase last known position
      if (lod === 0 && (ai.repathT <= 0 || !ai.path.length)) ensurePath(c, f, ai.lastX, ai.lastY, ai.lastZ, true);
    } else if ((!ai.path.length || ai.pathIdx >= ai.path.length) && lod < 2) {
      newRoamGoal(c, f);
    }
    const st = stepPath(c, f);
    if (st) {
      wx = st.dx;
      wz = st.dz;
      if (st.rise > 0.6 && st.dist < 1.9) wantJump = true;
      desiredYaw = Math.atan2(-st.dx, -st.dz);
    } else goalDone = true;
    if (goalDone) {
      if (tgt) {
        ai.target = null;
        ai.path = [];
      } else ai.path = [];
    }
  }

  // stuck detection
  ai.stuckT += dt;
  if (ai.stuckT > 0.6) {
    const moved = Math.hypot(b.x - ai.px, b.z - ai.pz);
    if (Math.hypot(wx, wz) > 0.3 && moved < 0.35) {
      ai.stuckN++;
      wantJump = true;
      ai.strafeDir *= -1;
      if (ai.stuckN >= 2) {
        ai.path = [];
        ai.repathT = 0;
        ai.stuckN = 0;
      }
    } else ai.stuckN = 0;
    ai.px = b.x;
    ai.pz = b.z;
    ai.stuckT = 0;
  }

  if (wantJump && b.onGround && ai.jumpCd <= 0) {
    b.vy = 8.8;
    ai.jumpCd = 0.8;
  }

  const len = Math.hypot(wx, wz);
  let dvx = 0, dvz = 0;
  if (len > 0.01) {
    const s = speed * Math.min(1, len);
    dvx = (wx / len) * s;
    dvz = (wz / len) * s;
    if (!fight) desiredYaw = Math.atan2(-wx, -wz);
  }
  const k = b.onGround ? Math.min(1, 14 * dt) : Math.min(1, 2.5 * dt);
  b.vx += (dvx - b.vx) * k;
  b.vz += (dvz - b.vz) * k;
  b.vy -= c.gravity * dt;
  c.world.moveBody(b, dt);
  f.moveSpeed = Math.hypot(b.vx, b.vz);

  const maxTurn = yawRate * dt;
  f.yaw += Math.max(-maxTurn, Math.min(maxTurn, angDiff(f.yaw, desiredYaw)));
}
