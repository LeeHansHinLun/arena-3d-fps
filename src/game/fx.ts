import * as THREE from 'three';

/** Pooled instanced cubes: sparks, debris, dust, gibs. One draw call. */
export class Particles {
  mesh: THREE.InstancedMesh;
  max: number;
  cap: number;
  n = 0;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array; size: Float32Array;
  grav: Float32Array; drag: Float32Array;
  cr: Float32Array; cg: Float32Array; cb: Float32Array;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene, max = 1000) {
    this.max = max;
    this.cap = max;
    const a = () => new Float32Array(max);
    this.px = a(); this.py = a(); this.pz = a();
    this.vx = a(); this.vy = a(); this.vz = a();
    this.life = a(); this.maxLife = a(); this.size = a();
    this.grav = a(); this.drag = a();
    this.cr = a(); this.cg = a(); this.cb = a();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), max);
    this.mesh.setColorAt(0, this.col.setRGB(1, 1, 1));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 18, drag = 1.2) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.grav[i] = grav; this.drag[i] = drag;
    this.col.setHex(color);
    this.cr[i] = this.col.r; this.cg[i] = this.col.g; this.cb[i] = this.col.b;
  }

  /** radial burst. `mult` should already be factored into count by the caller. */
  burst(x: number, y: number, z: number, count: number, speed: number, color: number, size: number, life: number, grav = 18, up = 0.4, nx = 0, ny = 0, nz = 0, bias = 0) {
    for (let k = 0; k < count; k++) {
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1 + up;
      let dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      dx += nx * bias; dy += ny * bias; dz += nz * bias;
      const sp = speed * (0.35 + Math.random() * 0.8);
      this.spawn(x, y, z, dx * sp, dy * sp, dz * sp, life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), color, grav);
    }
  }

  update(dt: number) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
          this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
          this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l]; this.size[i] = this.size[l];
          this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l];
          this.cr[i] = this.cr[l]; this.cg[i] = this.cg[l]; this.cb[i] = this.cb[l];
        }
        continue;
      }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dr; this.vz[i] *= dr;
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.04 && this.vy[i] < 0) {
        this.py[i] = 0.04;
        this.vy[i] *= -0.35;
        this.vx[i] *= 0.7; this.vz[i] *= 0.7;
      }
    }
    const d = this.dummy;
    const col = this.col;
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(1, this.life[i] / (this.maxLife[i] * 0.45));
      const s = this.size[i] * k;
      d.position.set(this.px[i], this.py[i], this.pz[i]);
      d.scale.set(s, s, s);
      d.rotation.set(this.px[i] * 3, this.py[i] * 2, this.pz[i] * 3);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      col.setRGB(this.cr[i], this.cg[i], this.cb[i]);
      this.mesh.setColorAt(i, col);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/** Additive streaks for bullets and beams. Fading is done by darkening instance colour. */
export class Tracers {
  mesh: THREE.InstancedMesh;
  max = 48;
  n = 0;
  sx = new Float32Array(48); sy = new Float32Array(48); sz = new Float32Array(48);
  ex = new Float32Array(48); ey = new Float32Array(48); ez = new Float32Array(48);
  life = new Float32Array(48); maxLife = new Float32Array(48); thick = new Float32Array(48);
  cr = new Float32Array(48); cg = new Float32Array(48); cb = new Float32Array(48);
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      this.max,
    );
    this.mesh.setColorAt(0, this.col.setRGB(0, 0, 0));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  add(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, color: number, thick: number, life: number) {
    const i = this.n < this.max ? this.n++ : 0;
    this.sx[i] = sx; this.sy[i] = sy; this.sz[i] = sz;
    this.ex[i] = ex; this.ey[i] = ey; this.ez[i] = ez;
    this.life[i] = life; this.maxLife[i] = life; this.thick[i] = thick;
    this.col.setHex(color);
    this.cr[i] = this.col.r; this.cg[i] = this.col.g; this.cb[i] = this.col.b;
  }

  update(dt: number) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          this.sx[i] = this.sx[l]; this.sy[i] = this.sy[l]; this.sz[i] = this.sz[l];
          this.ex[i] = this.ex[l]; this.ey[i] = this.ey[l]; this.ez[i] = this.ez[l];
          this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l]; this.thick[i] = this.thick[l];
          this.cr[i] = this.cr[l]; this.cg[i] = this.cg[l]; this.cb[i] = this.cb[l];
        }
      }
    }
    const d = this.dummy;
    for (let i = 0; i < this.n; i++) {
      const dx = this.ex[i] - this.sx[i], dy = this.ey[i] - this.sy[i], dz = this.ez[i] - this.sz[i];
      const len = Math.hypot(dx, dy, dz) || 0.001;
      this.v.set(dx / len, dy / len, dz / len);
      this.q.setFromUnitVectors(this.z, this.v);
      const f = this.life[i] / this.maxLife[i];
      const th = this.thick[i] * (0.4 + f * 0.6);
      d.position.set((this.sx[i] + this.ex[i]) / 2, (this.sy[i] + this.ey[i]) / 2, (this.sz[i] + this.ez[i]) / 2);
      d.quaternion.copy(this.q);
      d.scale.set(th, th, len);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.col.setRGB(this.cr[i] * f, this.cg[i] * f, this.cb[i] * f);
      this.mesh.setColorAt(i, this.col);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/** Bullet-hole / scorch decals in a ring buffer */
export class Decals {
  mesh: THREE.InstancedMesh;
  max = 64;
  idx = 0;
  filled = 0;
  private dummy = new THREE.Object3D();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private z = new THREE.Vector3(0, 0, 1);
  private n = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      this.max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, this.col.setRGB(0, 0, 0));
    scene.add(this.mesh);
  }

  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number) {
    const i = this.idx;
    this.idx = (this.idx + 1) % this.max;
    this.filled = Math.min(this.max, this.filled + 1);
    this.n.set(nx, ny, nz);
    this.q.setFromUnitVectors(this.z, this.n);
    this.q2.setFromAxisAngle(this.z, Math.random() * 6.28);
    this.q.multiply(this.q2);
    const d = this.dummy;
    d.position.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    d.quaternion.copy(this.q);
    d.scale.set(size, size, size);
    d.updateMatrix();
    this.mesh.setMatrixAt(i, d.matrix);
    this.mesh.setColorAt(i, this.col.setRGB(0, 0, 0));
    this.mesh.count = this.filled;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.idx = 0;
    this.filled = 0;
    this.mesh.count = 0;
  }
}

/** Expanding fireball + shockwave ring pool */
export class Blasts {
  private items: { sphere: THREE.Mesh; ring: THREE.Mesh; t: number; dur: number; r: number; active: boolean }[] = [];
  constructor(scene: THREE.Scene, count = 8) {
    const sg = new THREE.IcosahedronGeometry(1, 1);
    const rg = new THREE.RingGeometry(0.82, 1, 28);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mk = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const sphere = new THREE.Mesh(sg, mk());
      const ring = new THREE.Mesh(rg, mk());
      sphere.visible = ring.visible = false;
      sphere.frustumCulled = ring.frustumCulled = false;
      scene.add(sphere, ring);
      this.items.push({ sphere, ring, t: 0, dur: 0.5, r: 1, active: false });
    }
  }
  add(x: number, y: number, z: number, radius: number, color: number, dur = 0.55, ringOnly = false) {
    const it = this.items.find((i) => !i.active) ?? this.items[0];
    it.active = true;
    it.t = 0;
    it.dur = dur;
    it.r = radius;
    it.sphere.position.set(x, y, z);
    it.ring.position.set(x, Math.max(0.06, y - 0.5), z);
    (it.sphere.material as THREE.MeshBasicMaterial).color.setHex(color);
    (it.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    it.sphere.visible = !ringOnly;
    it.ring.visible = true;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const p = it.t / it.dur;
      if (p >= 1) {
        it.active = false;
        it.sphere.visible = it.ring.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3);
      it.sphere.scale.setScalar(it.r * (0.25 + 0.75 * e));
      (it.sphere.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.85;
      it.ring.scale.setScalar(it.r * (0.2 + 1.5 * e));
      (it.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.8;
    }
  }
  dispose() {
    for (const it of this.items) {
      it.sphere.geometry.dispose();
      it.ring.geometry.dispose();
      (it.sphere.material as THREE.Material).dispose();
      (it.ring.material as THREE.Material).dispose();
    }
    this.items = [];
  }

  clear() {
    for (const it of this.items) {
      it.active = false;
      it.sphere.visible = it.ring.visible = false;
    }
  }
}
