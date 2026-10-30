import * as THREE from 'three';
import type { WeaponId } from './types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  auto: boolean;
  interval: number;
  dmg: number;
  headMul: number;
  pellets: number;
  spread: number;
  bloom: number;
  mag: number;
  reload: number;
  range: number;
  recoil: number;
  kick: number;
  shake: number;
  color: number;
  pierce: number;
  speed: number;
  splash: number;
  tracer: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: { id: 'rifle', name: 'PULSE-R', auto: true, interval: 0.095, dmg: 20, headMul: 2, pellets: 1, spread: 0.005, bloom: 0.0022, mag: 30, reload: 1.45, range: 240, recoil: 0.0065, kick: 0.6, shake: 0.09, color: 0x2de2ff, pierce: 1, speed: 0, splash: 0, tracer: 0.035 },
  shotgun: { id: 'shotgun', name: 'SCATTER', auto: false, interval: 0.72, dmg: 12, headMul: 1.5, pellets: 9, spread: 0.05, bloom: 0, mag: 6, reload: 1.9, range: 70, recoil: 0.03, kick: 1.4, shake: 0.4, color: 0xff8a3c, pierce: 1, speed: 0, splash: 0, tracer: 0.02 },
  rail: { id: 'rail', name: 'RAILGUN', auto: false, interval: 1.05, dmg: 90, headMul: 2, pellets: 1, spread: 0, bloom: 0, mag: 4, reload: 1.7, range: 400, recoil: 0.045, kick: 1.8, shake: 0.5, color: 0xff2d95, pierce: 3, speed: 0, splash: 0, tracer: 0.09 },
  rocket: { id: 'rocket', name: 'NOVA-RPG', auto: false, interval: 0.85, dmg: 110, headMul: 1, pellets: 1, spread: 0.002, bloom: 0, mag: 4, reload: 2.0, range: 300, recoil: 0.04, kick: 1.6, shake: 0.45, color: 0xffe14d, pierce: 1, speed: 36, splash: 5.5, tracer: 0 },
};

export const WEAPON_ORDER: WeaponId[] = ['rifle', 'shotgun', 'rail', 'rocket'];

export interface ViewModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  flash: THREE.Mesh;
}

let flashTex: THREE.CanvasTexture | null = null;
function getFlashTex() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,230,150,0.9)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  g.fillStyle = 'rgba(255,240,200,0.9)';
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 4);
    g.fillRect(-4, -62, 8, 124);
  }
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}

export function buildViewModel(id: WeaponId): ViewModel {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23253a, roughness: 0.45, metalness: 0.7 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x3d4166, roughness: 0.5, metalness: 0.5 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x14141f, roughness: 0.9 });
  const acc = new THREE.MeshBasicMaterial({ color: WEAPONS[id].color, toneMapped: false });
  const mk = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
    return mesh;
  };
  let muzzleZ = -0.75;
  if (id === 'rifle') {
    mk(0.08, 0.1, 0.55, 0, 0, -0.1, dark);
    mk(0.045, 0.045, 0.36, 0, 0.012, -0.5, mid);
    mk(0.06, 0.16, 0.09, 0, -0.12, -0.02, mid, 0.18);
    mk(0.06, 0.09, 0.2, 0, -0.012, 0.28, mid);
    mk(0.025, 0.04, 0.12, 0, 0.07, -0.18, dark);
    mk(0.084, 0.014, 0.32, 0, 0.03, -0.12, acc);
    mk(0.07, 0.1, 0.12, 0.0, -0.1, 0.14, glove);
    mk(0.075, 0.08, 0.14, -0.01, -0.06, -0.36, glove);
    muzzleZ = -0.72;
  } else if (id === 'shotgun') {
    mk(0.09, 0.1, 0.5, 0, 0, -0.05, dark);
    mk(0.04, 0.04, 0.62, -0.026, 0.02, -0.5, mid);
    mk(0.04, 0.04, 0.62, 0.026, 0.02, -0.5, mid);
    mk(0.1, 0.07, 0.2, 0, -0.045, -0.4, mid);
    mk(0.065, 0.1, 0.26, 0, -0.02, 0.32, mid);
    mk(0.094, 0.014, 0.3, 0, 0.056, -0.05, acc);
    mk(0.07, 0.1, 0.12, 0, -0.1, 0.12, glove);
    mk(0.08, 0.08, 0.14, 0, -0.06, -0.4, glove);
    muzzleZ = -0.84;
  } else if (id === 'rail') {
    mk(0.07, 0.08, 0.95, 0, 0, -0.2, dark);
    mk(0.03, 0.03, 0.9, 0, 0.055, -0.22, mid);
    for (let i = 0; i < 4; i++) mk(0.12, 0.12, 0.035, 0, 0, -0.3 - i * 0.16, acc);
    mk(0.06, 0.14, 0.1, 0, -0.1, 0.08, mid, 0.15);
    mk(0.07, 0.09, 0.2, 0, -0.01, 0.32, mid);
    mk(0.07, 0.1, 0.12, 0, -0.1, 0.1, glove);
    mk(0.075, 0.08, 0.14, 0, -0.05, -0.45, glove);
    muzzleZ = -0.72 - 0.22;
  } else {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.85, 8), dark);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.02, -0.25);
    group.add(tube);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.14, 8), acc);
    cone.rotation.x = Math.PI / 2;
    cone.position.set(0, 0.02, -0.72);
    group.add(cone);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.1, 8), mid);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, 0.02, 0.2);
    group.add(back);
    mk(0.05, 0.16, 0.08, 0, -0.1, -0.05, mid, 0.1);
    mk(0.06, 0.04, 0.2, 0, 0.1, -0.2, mid);
    mk(0.07, 0.1, 0.12, 0, -0.14, -0.02, glove);
    mk(0.075, 0.08, 0.14, 0, -0.08, -0.4, glove);
    muzzleZ = -0.85;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, muzzleZ);
  group.add(muzzle);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ map: getFlashTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: id === 'rail' ? 0xff6fb5 : id === 'rifle' ? 0xaaf0ff : 0xffffff }),
  );
  flash.position.set(0, 0.015, muzzleZ - 0.06);
  flash.visible = false;
  group.add(flash);
  return { group, muzzle, flash };
}
