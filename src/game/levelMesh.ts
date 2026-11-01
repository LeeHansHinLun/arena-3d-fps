import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  normalWorldGeometry,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  varying,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box, LevelData, Theme } from './levels';
import { mulberry32 } from './levels';

const CORNERS: [number, number, number][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // +x
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -x
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // +y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // -y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // -z
];
const NORMALS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SHADE = [0.9, 0.9, 1, 0.55, 0.82, 0.82];

export function boxesGeometry(boxes: Box[], tile: number, inflate = 0, jitter = 0.05): THREE.BufferGeometry {
  const n = boxes.length;
  const pos = new Float32Array(n * 72);
  const nor = new Float32Array(n * 72);
  const uv = new Float32Array(n * 48);
  const col = new Float32Array(n * 72);
  const idx = new Uint32Array(n * 36);
  const c = new THREE.Color();
  const r = mulberry32(99);
  let v = 0;
  let ii = 0;
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    const X = [b.x0 - inflate, b.x1 + inflate];
    const Y = [b.y0 - inflate, b.y1 + inflate];
    const Z = [b.z0 - inflate, b.z1 + inflate];
    c.setHex(b.color);
    const jit = 1 + (r() - 0.5) * 2 * jitter;
    for (let f = 0; f < 6; f++) {
      const base = v;
      for (let k = 0; k < 4; k++) {
        const cn = CORNERS[f][k];
        const x = X[cn[0]], y = Y[cn[1]], z = Z[cn[2]];
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        nor[v * 3] = NORMALS[f][0]; nor[v * 3 + 1] = NORMALS[f][1]; nor[v * 3 + 2] = NORMALS[f][2];
        const s = SHADE[f] * jit;
        col[v * 3] = c.r * s; col[v * 3 + 1] = c.g * s; col[v * 3 + 2] = c.b * s;
        if (f < 2) { uv[v * 2] = z / tile; uv[v * 2 + 1] = y / tile; }
        else if (f < 4) { uv[v * 2] = x / tile; uv[v * 2 + 1] = z / tile; }
        else { uv[v * 2] = x / tile; uv[v * 2 + 1] = y / tile; }
        v++;
      }
      idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2;
      idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function gridTextures(aniso: number) {
  const S = 128;
  const a = document.createElement('canvas');
  a.width = a.height = S;
  const g = a.getContext('2d')!;
  g.fillStyle = '#d8d8e8';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,30' : '255,255,255'},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 10, 2 + Math.random() * 10);
  }
  g.fillStyle = '#f2f2fb';
  g.fillRect(8, 8, S - 16, S - 16);
  g.globalAlpha = 0.22;
  g.fillStyle = '#6b6b95';
  g.fillRect(0, 0, S, 7);
  g.fillRect(0, S - 7, S, 7);
  g.fillRect(0, 0, 7, S);
  g.fillRect(S - 7, 0, 7, S);
  g.globalAlpha = 0.5;
  g.fillStyle = '#4a4a78';
  g.fillRect(0, 0, S, 2);
  g.fillRect(0, 0, 2, S);
  const map = new THREE.CanvasTexture(a);
  const e = document.createElement('canvas');
  e.width = e.height = S;
  const h = e.getContext('2d')!;
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  h.fillStyle = '#fff';
  h.fillRect(0, 0, S, 3);
  h.fillRect(0, 0, 3, S);
  h.globalAlpha = 0.25;
  h.fillRect(0, 6, S, 2);
  h.fillRect(6, 0, 2, S);
  const emi = new THREE.CanvasTexture(e);
  // Dedicated *soft* bump heightfield. Reusing the binary emissive grid as a bump map
  // gives derivative-based bump mapping a 0→1 height step at every tile seam; at grazing
  // angles that can degenerate the perturbed normal (and any resulting NaN then gets
  // smeared across the frame by bloom). A smooth, wrap-continuous height ramp is safe.
  const bcv = document.createElement('canvas');
  bcv.width = bcv.height = S;
  const bp = bcv.getContext('2d')!;
  bp.fillStyle = '#808080';
  bp.fillRect(0, 0, S, S);
  const seam = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const gr = bp.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, '#2c2c2c');
    gr.addColorStop(1, '#808080');
    bp.fillStyle = gr;
    bp.fillRect(rx, ry, rw, rh);
  };
  seam(0, 0, 12, 0, 0, 0, 12, S);
  seam(S, 0, S - 12, 0, S - 12, 0, 12, S);
  seam(0, 0, 0, 12, 0, 0, S, 12);
  seam(0, S, 0, S - 12, 0, S - 12, S, 12);
  const bump = new THREE.CanvasTexture(bcv);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.colorSpace = THREE.NoColorSpace;
  bump.anisotropy = aniso;
  // Roughness variation in the green channel (Three's roughnessMap convention):
  // panel centres are a little smoother than their worn seams, so sun, fixture
  // spots and SSR break up across a face instead of behaving like one uniform
  // slab. This avoids the old trick of making the whole arena metallic just to
  // get visible reflections.
  const rcv = document.createElement('canvas');
  rcv.width = rcv.height = S;
  const rp = rcv.getContext('2d')!;
  rp.fillStyle = '#9c9c9c';
  rp.fillRect(0, 0, S, S);
  rp.fillStyle = '#828282';
  rp.fillRect(8, 8, S - 16, S - 16);
  for (let i = 0; i < 180; i++) {
    rp.fillStyle = `rgba(${Math.random() < 0.5 ? '40,40,40' : '235,235,235'},${Math.random() * 0.11})`;
    rp.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 12, 2 + Math.random() * 12);
  }
  rp.globalAlpha = 0.85;
  rp.fillStyle = '#c8c8c8';
  rp.fillRect(0, 0, S, 7);
  rp.fillRect(0, S - 7, S, 7);
  rp.fillRect(0, 0, 7, S);
  rp.fillRect(S - 7, 0, 7, S);
  rp.globalAlpha = 1;
  rp.fillStyle = '#dedede';
  rp.fillRect(0, 0, S, 2);
  rp.fillRect(0, 0, 2, S);
  const rough = new THREE.CanvasTexture(rcv);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.colorSpace = THREE.NoColorSpace;
  rough.anisotropy = aniso;
  for (const t of [map, emi]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
  }
  return { map, emi, bump, rough };
}

export interface LevelObjects {
  group: THREE.Group;
  main: THREE.Mesh;
  dispose: () => void;
  update: (t: number, cam: THREE.Vector3, sunDir: THREE.Vector3) => void;
  applyTheme: (th: Theme) => void;
  sky: THREE.Mesh;
  sun: THREE.Mesh;
  pads: THREE.Group[];
  /** world position of the sun disc centre (kept in sync by update) — god rays/flare project this exact point */
  sunPos: THREE.Vector3;
  /** merged volumetric light cones, or null when the level defines none */
  cones: THREE.Mesh | null;
  /** objects that must be hidden while rendering normal/depth G-buffers (sky, sun, additive shells…) */
  noGBuffer: THREE.Object3D[];
  setVolumetric: (q: 0 | 1 | 2) => void;
  setAnisotropy: (n: number) => void;
  /**
   * reflective=true lowers roughness/raises metalness so SSR + IBL have something
   * to reflect. envIntensity is lowered while SSR is active so the PMREM fill does
   * not double-count the screen-space reflection layer.
   */
  setSurface: (reflective: boolean, envIntensity?: number) => void;
}

/**
 * Cheap volumetric cone in TSL: brightest looking through the middle of the shaft,
 * fading down its length. One node graph serves WebGPU (WGSL) and the WebGL2
 * fallback, so there is no hand-maintained GLSL/WGSL pair. Every term is clamped
 * before use — this is an additive HDR pass feeding bloom.
 */
function createConeMaterial() {
  const intensity = uniform(1);
  const vT = varying(attribute('aT', 'float'));
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const rim = clamp(abs(dot(normalize(normalWorldGeometry), viewDir)), 0, 1);
  // A soft silhouette term hides the cone's hard shell edge against the room,
  // which is what made the old shell read as a solid object at glancing angles.
  const body = pow(rim, 1.45).mul(smoothstep(0, 0.38, rim));
  const fade = pow(clamp(float(1).sub(vT), 0, 1), 1.35);
  const breathe = float(0.9).add(
    sin(
      time.mul(1.3)
        .add(positionWorld.x.mul(0.31))
        .add(positionWorld.y.mul(0.77))
        .add(positionWorld.z.mul(0.27)),
    ).mul(0.1),
  );
  const col = clamp(clamp(vertexColor().rgb, vec3(0), vec3(4)).mul(body).mul(fade).mul(breathe).mul(intensity), vec3(0), vec3(4));

  // Plain (unlit) NodeMaterial rather than MeshBasicNodeMaterial: the basic
  // material's setupNormal() ignores normalNode. Transparent shells still
  // overwrite auxiliary MRT attachments in a single-pass MRT pipeline (there
  // is no per-material opt-out), so write a floor-like world-up normal:
  // GTAO no longer consumes MRT normals at all (it reconstructs from depth),
  // and SSR seen through a cone then approximates the floor reflection under
  // it — cones hang over floors — instead of a cone-shaped hole in the
  // reflections. The visible shell shading above uses the real geometric
  // world normal, unaffected by this.
  const material = new THREE.NodeMaterial();
  material.colorNode = vec4(col, 1);
  material.normalNode = vec3(0, 1, 0).transformDirection(cameraViewMatrix);
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.toneMapped = false;
  return { material, intensity };
}

export function buildLevelObjects(level: LevelData, aniso: number): LevelObjects {
  const group = new THREE.Group();
  const th = level.theme;
  const tex = gridTextures(aniso);
  const floorColor = th.ground;
  const floor: Box = { x0: -level.w / 2, x1: level.w / 2, z0: -level.d / 2, z1: level.d / 2, y0: -1, y1: 0, color: floorColor };
  const geo = boxesGeometry([floor, ...level.boxes], 4);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tex.map, emissiveMap: tex.emi, emissive: new THREE.Color(th.accent), emissiveIntensity: 0.6,
    roughness: 1.05, roughnessMap: tex.rough, metalness: 0.06,
    // soft panel-seam bump so seams catch the sun (near-free detail; see gridTextures
    // for why this is a dedicated smooth heightfield rather than the emissive grid)
    bumpMap: tex.bump, bumpScale: 0.16,
  });
  const main = new THREE.Mesh(geo, mat);
  main.castShadow = true;
  main.receiveShadow = true;
  main.frustumCulled = false;
  group.add(main);

  const gGeo = boxesGeometry(level.glow, 4, 0, 0);
  const gMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glow = new THREE.Mesh(gGeo, gMat);
  glow.frustumCulled = false;
  group.add(glow);
  const hGeo = boxesGeometry(level.glow, 4, 0.12, 0);
  const hMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(hGeo, hMat);
  halo.frustumCulled = false;
  group.add(halo);

  // The box colors are baked into the vertex colors at build time, so keep the originals around:
  // a theme change has to re-derive them instead of leaving the old palette in the arena.
  const baseMain = (geo.getAttribute('color') as THREE.BufferAttribute).array.slice() as Float32Array;
  const baseGlow = (gGeo.getAttribute('color') as THREE.BufferAttribute).array.slice() as Float32Array;
  const baseHalo = (hGeo.getAttribute('color') as THREE.BufferAttribute).array.slice() as Float32Array;
  let curTheme = th;
  let totalHueShift = 0;
  const hslTmp = { h: 0, s: 0, l: 0 };
  const colTmp = new THREE.Color();
  const hueOf = (hex: number) => {
    colTmp.setHex(hex);
    colTmp.getHSL(hslTmp);
    return hslTmp.h;
  };
  const wrapHue = (h: number) => {
    h %= 1;
    if (h > 0.5) h -= 1;
    if (h < -0.5) h += 1;
    return h;
  };
  const recolor = (mesh: THREE.Mesh, base: Float32Array, shift: number) => {
    const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      colTmp.setRGB(base[i], base[i + 1], base[i + 2]);
      colTmp.getHSL(hslTmp);
      colTmp.setHSL((hslTmp.h + shift + 1) % 1, hslTmp.s, hslTmp.l);
      arr[i] = colTmp.r;
      arr[i + 1] = colTmp.g;
      arr[i + 2] = colTmp.b;
    }
    attr.needsUpdate = true;
  };

  // outer ground
  const outerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(th.fog).multiplyScalar(0.6) });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), outerMat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.4;
  group.add(outer);

  // distant silhouettes
  const r = mulberry32(31);
  const sil: Box[] = [];
  const R0 = Math.max(level.w, level.d) / 2 + 60;
  const sc = new THREE.Color(th.fog).lerp(new THREE.Color(th.skyBottom), 0.15).multiplyScalar(0.55).getHex();
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + r() * 0.1;
    const rad = R0 + r() * 120;
    const w = 10 + r() * 22;
    const h = 14 + r() * 70 * (0.4 + r());
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    sil.push({ x0: x - w / 2, x1: x + w / 2, z0: z - w / 2, z1: z + w / 2, y0: -2, y1: h, color: sc });
  }
  const silMesh = new THREE.Mesh(boxesGeometry(sil, 50, 0, 0.2), new THREE.MeshBasicMaterial({ vertexColors: true }));
  silMesh.frustumCulled = false;
  group.add(silMesh);

  // sky dome
  const sg = new THREE.SphereGeometry(700, 24, 16);
  const cols = new Float32Array(sg.attributes.position.count * 3);
  const top = new THREE.Color(th.skyTop);
  const bot = new THREE.Color(th.skyBottom);
  const fog = new THREE.Color(th.fog);
  const tmp = new THREE.Color();
  for (let i = 0; i < sg.attributes.position.count; i++) {
    const y = sg.attributes.position.getY(i) / 700;
    if (y >= 0) tmp.copy(bot).lerp(top, Math.pow(Math.min(1, y * 1.4), 0.65));
    else tmp.copy(bot).lerp(fog, Math.min(1, -y * 3));
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  sg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // sun disc with retro slits
  const sc2 = document.createElement('canvas');
  sc2.width = sc2.height = 256;
  const sctx = sc2.getContext('2d')!;
  const gr = sctx.createLinearGradient(0, 20, 0, 236);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.5, '#' + new THREE.Color(th.discColor).getHexString());
  gr.addColorStop(1, '#' + new THREE.Color(th.accent).getHexString());
  sctx.fillStyle = gr;
  sctx.beginPath();
  sctx.arc(128, 128, 110, 0, Math.PI * 2);
  sctx.fill();
  sctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) sctx.fillRect(0, 130 + i * 16, 256, 2 + i * 1.6);
  const sunTex = new THREE.CanvasTexture(sc2);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false, toneMapped: false }),
  );
  sun.renderOrder = -9;
  sun.frustumCulled = false;
  group.add(sun);
  const sunPos = new THREE.Vector3();

  // starfield shell (follows the sky dome; opacity follows how dark the theme sky is)
  const starGeo = new THREE.BufferGeometry();
  {
    const sr = mulberry32(4242);
    const N = 700;
    const sp = new Float32Array(N * 3);
    const sc3 = new Float32Array(N * 3);
    const cTint = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // random point on the upper hemisphere
      const a = sr() * Math.PI * 2;
      const y = 0.08 + sr() * 0.92;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      sp[i * 3] = Math.cos(a) * rad * 675;
      sp[i * 3 + 1] = y * 675;
      sp[i * 3 + 2] = Math.sin(a) * rad * 675;
      cTint.setHSL(0.62 + sr() * 0.12, sr() * 0.5, 0.75 + sr() * 0.25).multiplyScalar(0.5 + sr() * 0.5);
      sc3[i * 3] = cTint.r; sc3[i * 3 + 1] = cTint.g; sc3[i * 3 + 2] = cTint.b;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(sc3, 3));
  }
  const starMat = new THREE.PointsMaterial({ size: 1.9, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  group.add(stars);
  const starOpacity = (theme: Theme) => {
    const c = new THREE.Color(theme.skyTop);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return Math.max(0.12, Math.min(0.9, 1 - lum * 3.2));
  };
  starMat.opacity = starOpacity(th);

  // pads
  const pads: THREE.Group[] = [];
  const padFx: { beam: THREE.Mesh; inn: THREE.Mesh; beamMat: THREE.MeshBasicMaterial }[] = [];
  const padColors: { mat: THREE.MeshBasicMaterial; hex: number }[] = [];
  const discGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.12, 14);
  const innerGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.16, 14);
  const beamGeo = new THREE.CylinderGeometry(1.3, 1.5, 9, 14, 1, true);
  for (const p of level.pads) {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const dMat = new THREE.MeshBasicMaterial({ color: p.color, toneMapped: false });
    const bMat = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const d = new THREE.Mesh(discGeo, dMat);
    d.position.y = 0.06;
    const inn = new THREE.Mesh(innerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    inn.position.y = 0.07;
    const beam = new THREE.Mesh(beamGeo, bMat);
    beam.position.y = 4.5;
    beam.name = 'beam';
    inn.name = 'inner';
    g.add(d, inn, beam);
    group.add(g);
    pads.push(g);
    padFx.push({ beam, inn, beamMat: bMat });
    padColors.push({ mat: dMat, hex: p.color }, { mat: bMat, hex: p.color });
  }

  // volumetric light cones (merged into a single draw call)
  let cones: THREE.Mesh | null = null;
  let coneIntensity: { value: number } | null = null;
  if (level.cones && level.cones.length) {
    const parts: THREE.BufferGeometry[] = [];
    const cc = new THREE.Color();
    for (const cn of level.cones) {
      const g = new THREE.CylinderGeometry(cn.r0, cn.r1, cn.h, 18, 1, true);
      g.translate(0, -cn.h / 2, 0); // apex (top) at origin, shaft opening downwards
      const count = g.attributes.position.count;
      const col = new Float32Array(count * 3);
      const aT = new Float32Array(count);
      cc.setHex(cn.color).multiplyScalar(cn.intensity * 0.55);
      for (let i = 0; i < count; i++) {
        col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
        aT[i] = -g.attributes.position.getY(i) / cn.h;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
      g.translate(cn.x, cn.y, cn.z);
      parts.push(g);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (merged) {
      const cone = createConeMaterial();
      coneIntensity = cone.intensity;
      cones = new THREE.Mesh(merged, cone.material);
      cones.frustumCulled = false;
      cones.renderOrder = 5;
      group.add(cones);
    }
  }

  const noGBuffer: THREE.Object3D[] = [sky, sun, stars, halo];
  if (cones) noGBuffer.push(cones);
  for (const p of padFx) noGBuffer.push(p.beam);

  const update = (t: number, cam: THREE.Vector3, sunDir: THREE.Vector3) => {
    sky.position.copy(cam);
    stars.position.copy(cam);
    // cone animation uses the TSL `time` node, updated by the renderer itself
    // the disc sits exactly on the sun direction so the light, disc, god rays and flare all agree
    sun.position.set(cam.x + sunDir.x * 480, cam.y + sunDir.y * 480, cam.z + sunDir.z * 480);
    sunPos.copy(sun.position);
    sun.lookAt(cam);
    // Direct references instead of a name lookup through every pad group on
    // each update (the intro camera calls this every frame).
    for (let i = 0; i < padFx.length; i++) {
      const p = padFx[i];
      const s = 0.5 + 0.5 * Math.sin(t * 4 + i);
      p.beamMat.opacity = 0.12 + 0.14 * s;
      p.beam.scale.set(1 + 0.08 * s, 1, 1 + 0.08 * s);
      p.inn.scale.setScalar(0.8 + 0.25 * s);
    }
  };

  const applyTheme = (nt: Theme) => {
    mat.emissive.setHex(nt.accent);
    starMat.opacity = starOpacity(nt);
    outerMat.color.setHex(nt.fog).multiplyScalar(0.6);
    // rotate the baked box/glow palette with the theme accent so the arena matches the new sky
    totalHueShift = wrapHue(totalHueShift + wrapHue(hueOf(nt.accent) - hueOf(curTheme.accent)));
    recolor(main, baseMain, totalHueShift);
    recolor(glow, baseGlow, totalHueShift);
    recolor(halo, baseHalo, totalHueShift);
    for (const pc of padColors) {
      colTmp.setHex(pc.hex);
      colTmp.getHSL(hslTmp);
      colTmp.setHSL((hslTmp.h + totalHueShift + 1) % 1, hslTmp.s, hslTmp.l);
      pc.mat.color.copy(colTmp);
    }
    curTheme = nt;
    const nTop = new THREE.Color(nt.skyTop);
    const nBot = new THREE.Color(nt.skyBottom);
    const nFog = new THREE.Color(nt.fog);
    const cAttr = sg.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < sg.attributes.position.count; i++) {
      const y = sg.attributes.position.getY(i) / 700;
      if (y >= 0) tmp.copy(nBot).lerp(nTop, Math.pow(Math.min(1, y * 1.4), 0.65));
      else tmp.copy(nBot).lerp(nFog, Math.min(1, -y * 3));
      cAttr.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    cAttr.needsUpdate = true;

    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, 256, 256);
    const nGr = sctx.createLinearGradient(0, 20, 0, 236);
    nGr.addColorStop(0, '#ffffff');
    nGr.addColorStop(0.5, '#' + new THREE.Color(nt.discColor).getHexString());
    nGr.addColorStop(1, '#' + new THREE.Color(nt.accent).getHexString());
    sctx.fillStyle = nGr;
    sctx.beginPath();
    sctx.arc(128, 128, 110, 0, Math.PI * 2);
    sctx.fill();
    sctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) sctx.fillRect(0, 130 + i * 16, 256, 2 + i * 1.6);
    sunTex.needsUpdate = true;
  };

  const dispose = () => {
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mt = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mt) (Array.isArray(mt) ? mt : [mt]).forEach((x) => x.dispose());
    });
    tex.map.dispose();
    tex.emi.dispose();
    tex.bump.dispose();
    tex.rough.dispose();
    sunTex.dispose();
  };

  const setVolumetric = (q: 0 | 1 | 2) => {
    if (!cones || !coneIntensity) return;
    cones.visible = q > 0;
    coneIntensity.value = q === 2 ? 1.2 : 0.85;
  };
  const setAnisotropy = (n: number) => {
    if (tex.map.anisotropy === n) return;
    tex.map.anisotropy = n;
    tex.emi.anisotropy = n;
    tex.bump.anisotropy = n;
    tex.rough.anisotropy = n;
    tex.map.needsUpdate = true;
    tex.emi.needsUpdate = true;
    tex.bump.needsUpdate = true;
    tex.rough.needsUpdate = true;
  };
  const setSurface = (reflective: boolean, envIntensity = 0.85) => {
    // These are multipliers for the roughness map (.51–.87): reflective mode
    // gives roughly .40–.68 across a panel. Keeping metalness modest preserves
    // coloured diffuse light, which the old whole-arena 0.38 metalness muted.
    mat.roughness = reflective ? 0.78 : 1.05;
    mat.metalness = reflective ? 0.22 : 0.06;
    mat.envMapIntensity = reflective ? envIntensity : 1;
  };

  return { group, main, dispose, update, applyTheme, sky, sun, pads, sunPos, cones, noGBuffer, setVolumetric, setAnisotropy, setSurface };
}

/* --------------------------------------------------------------- 2D top-down map */
export interface LevelMap {
  canvas: HTMLCanvasElement;
  scale: number; // px per world unit
  offX: number;
  offY: number;
  px: number;
}

const mapCache = new Map<string, LevelMap>();

export function renderLevelMap(level: LevelData, px = 256): LevelMap {
  const key = (level.key ?? level.id) + px;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  const scale = px / Math.max(level.w, level.d);
  canvas.width = Math.round(level.w * scale);
  canvas.height = Math.round(level.d * scale);
  const g = canvas.getContext('2d')!;
  const offX = 0;
  const offY = 0;
  g.fillStyle = '#0c0720';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const floor = new THREE.Color(level.theme.ground).multiplyScalar(1.15);
  g.fillStyle = '#' + floor.getHexString();
  g.fillRect(offX, offY, level.w * scale, level.d * scale);
  const sorted = [...level.boxes].sort((a, b) => a.y1 - b.y1);
  const c = new THREE.Color();
  const hw = level.w / 2, hd = level.d / 2;
  for (const b of sorted) {
    if (b.x0 >= hw || b.x1 <= -hw || b.z0 >= hd || b.z1 <= -hd) continue;
    const t = Math.min(1, b.y1 / Math.max(6, level.maxH * 0.8));
    c.setHex(b.color);
    c.multiplyScalar(0.8 + t * 1.8);
    const x = (Math.max(b.x0, -hw) + hw) * scale + offX;
    const y = (Math.max(b.z0, -hd) + hd) * scale + offY;
    const w = (Math.min(b.x1, hw) - Math.max(b.x0, -hw)) * scale;
    const h = (Math.min(b.z1, hd) - Math.max(b.z0, -hd)) * scale;
    g.fillStyle = '#' + c.getHexString();
    g.fillRect(x, y, w, h);
    if (b.y1 > 2.2) {
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
  for (const p of level.pads) {
    g.fillStyle = '#' + new THREE.Color(p.color).getHexString();
    g.beginPath();
    g.arc((p.x + hw) * scale + offX, (p.z + hd) * scale + offY, Math.max(2, 1.6 * scale), 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#' + new THREE.Color(level.theme.accent).getHexString();
  g.lineWidth = 2;
  g.strokeRect(offX + 1, offY + 1, level.w * scale - 2, level.d * scale - 2);
  const res = { canvas, scale, offX, offY, px };
  mapCache.set(key, res);
  return res;
}
