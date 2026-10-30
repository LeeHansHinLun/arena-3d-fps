import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { computeBoxMetrics, type Box, type LevelData } from '@/game/levels';
import { buildLevelObjects, renderLevelMap } from '@/game/levelMesh';
import { Btn, Chip, Modal, Panel, sfx } from './kit';
import { cn } from '@/utils/cn';

interface Hover {
  px: number;
  py: number;
  wx: number;
  wz: number;
  box: Box | null;
  idx: number;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function pickBoxAt(level: LevelData, wx: number, wz: number): { box: Box | null; idx: number } {
  let bestTop = -1;
  let bestBox: Box | null = null;
  let bestIdx = -1;
  for (let i = 0; i < level.boxes.length; i++) {
    const b = level.boxes[i];
    if (wx >= b.x0 && wx <= b.x1 && wz >= b.z0 && wz <= b.z1) {
      // If multiple boxes overlap (e.g. a tier sitting on a wider tier), pick the topmost surface at (wx, wz)
      if (b.y1 > bestTop || (Math.abs(b.y1 - bestTop) < 0.01 && (b.x1 - b.x0) * (b.z1 - b.z0) < ((bestBox?.x1 ?? 999) - (bestBox?.x0 ?? 0)) * ((bestBox?.z1 ?? 999) - (bestBox?.z0 ?? 0)))) {
        bestTop = b.y1;
        bestBox = b;
        bestIdx = i;
      }
    }
  }
  return { box: bestBox, idx: bestIdx };
}

export function MapDetails({ level, onClose }: { level: LevelData; onClose: () => void }) {
  const canvas2d = useRef<HTMLCanvasElement>(null);
  const mount3d = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; z: number }>({ x: 0, z: 0 }); // in world units
  const [hover, setHover] = useState<Hover | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panZ: number; moved: boolean } | null>(null);

  const scale = width / Math.max(level.w, level.d);
  const dispW = Math.round(level.w * scale);
  const dispH = Math.round(level.d * scale);
  const base = useMemo(() => renderLevelMap(level, 640).canvas, [level]);

  // Reset selection/zoom when level changes
  useEffect(() => {
    setSelectedIdx(null);
    setZoom(1);
    setPan({ x: 0, z: 0 });
  }, [level]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setWidth(Math.max(240, Math.min(620, el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedBox = selectedIdx !== null && level.boxes[selectedIdx] ? level.boxes[selectedIdx] : null;
  const selectedMetrics = useMemo(
    () => (selectedBox ? computeBoxMetrics(level, selectedBox) : null),
    [level, selectedBox],
  );
  const hoverMetrics = useMemo(
    () => (hover?.box ? computeBoxMetrics(level, hover.box) : null),
    [level, hover?.box],
  );

  // Aggregate map breakdown for general map info
  const summary = useMemo(() => {
    let towers = 0;
    let platforms = 0;
    let bridges = 0;
    let stairs = 0;
    let cover = 0;
    let walls = 0;
    let footprintArea = 0;
    for (const b of level.boxes) {
      const m = computeBoxMetrics(level, b);
      if (m.kind === 'Perimeter Wall') walls++;
      else {
        footprintArea += m.area;
        if (m.kind === 'Tower / High-Rise') towers++;
        else if (m.kind === 'Platform / Terrace') platforms++;
        else if (m.kind === 'Bridge / Catwalk') bridges++;
        else if (m.kind === 'Stair / Step') stairs++;
        else cover++;
      }
    }
    const totalArea = level.w * level.d;
    const openPct = Math.max(15, Math.min(95, Math.round((1 - Math.min(totalArea * 0.85, footprintArea * 0.65) / totalArea) * 100)));
    return { towers, platforms, bridges, stairs, cover, walls, totalArea, openPct };
  }, [level]);

  // Convert screen pixel coordinates on the viewport to world coordinates (wx, wz)
  const screenToWorld = (px: number, py: number) => {
    const nx = (px - dispW / 2) / (scale * zoom) + pan.x;
    const nz = (py - dispH / 2) / (scale * zoom) + pan.z;
    return { wx: nx, wz: nz };
  };

  // Convert world coordinates (wx, wz) to screen pixel coordinates
  const worldToScreen = (wx: number, wz: number) => {
    return {
      x: (wx - pan.x) * scale * zoom + dispW / 2,
      y: (wz - pan.z) * scale * zoom + dispH / 2,
    };
  };

  // 2D Blueprint rendering
  useEffect(() => {
    if (viewMode !== '2d') return;
    const c = canvas2d.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(dispW * dpr);
    const bh = Math.round(dispH * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#070312';
    g.fillRect(0, 0, dispW, dispH);

    g.save();
    g.translate(dispW / 2 - pan.x * scale * zoom, dispH / 2 - pan.z * scale * zoom);
    g.scale(zoom, zoom);
    g.imageSmoothingEnabled = false;
    g.drawImage(base, -dispW / 2, -dispH / 2, dispW, dispH);

    if (showGrid) {
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1 / zoom;
      const hw = level.w / 2;
      const hd = level.d / 2;
      for (let x = -hw + 10; x < hw; x += 10) {
        g.beginPath();
        g.moveTo(x * scale, -hd * scale);
        g.lineTo(x * scale, hd * scale);
        g.stroke();
      }
      for (let z = -hd + 10; z < hd; z += 10) {
        g.beginPath();
        g.moveTo(-hw * scale, z * scale);
        g.lineTo(hw * scale, z * scale);
        g.stroke();
      }
    }

    // Hovered box outline
    if (hover?.box && hover.idx !== selectedIdx) {
      const b = hover.box;
      g.strokeStyle = 'rgba(45, 226, 255, 0.9)';
      g.lineWidth = 2 / zoom;
      g.strokeRect(b.x0 * scale, b.z0 * scale, (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
    }

    // Selected structure highlight
    if (selectedBox) {
      const b = selectedBox;
      const bx = b.x0 * scale;
      const bz = b.z0 * scale;
      const bw2 = (b.x1 - b.x0) * scale;
      const bd2 = (b.z1 - b.z0) * scale;
      g.fillStyle = 'rgba(255, 225, 77, 0.28)';
      g.fillRect(bx, bz, bw2, bd2);
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 2.5 / zoom;
      g.strokeRect(bx, bz, bw2, bd2);
    }
    g.restore();

    if (hover) {
      g.strokeStyle = '#2de2ff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(hover.px, hover.py, 4, 0, Math.PI * 2);
      g.stroke();
    }
  }, [viewMode, base, dispW, dispH, scale, zoom, pan, level, hover, selectedBox, selectedIdx, showGrid]);

  // 3D Top-Down orthographic view (never clips when zooming)
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    cam: THREE.OrthographicCamera;
    selMesh: THREE.Mesh;
    hovMesh: THREE.LineSegments;
    gridHelper: THREE.GridHelper;
    updateShadowCam: (px: number, pz: number, z: number) => void;
  } | null>(null);

  useEffect(() => {
    if (viewMode !== '3d' || !mount3d.current) return;
    const container = mount3d.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070312);
    const th = level.theme;
    scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, 2.8));
    const dir = new THREE.DirectionalLight(th.lightColor, 3.2);
    dir.position.set(th.sunDir[0] * 80, Math.max(50, th.sunDir[1] * 100), th.sunDir[2] * 80);
    scene.add(dir);

    const levelObjs = buildLevelObjects(level, 4);
    levelObjs.sky.visible = false;
    levelObjs.sun.visible = false;
    scene.add(levelObjs.group);

    // Enable real depth shadows so the top-down view shows proper occlusion between stacked structures
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const camY0 = level.maxH + 150;
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = camY0 + 200;
    dir.shadow.camera.left = -Math.max(level.w, level.d) / 2 - 20;
    dir.shadow.camera.right = Math.max(level.w, level.d) / 2 + 20;
    dir.shadow.camera.top = Math.max(level.w, level.d) / 2 + 20;
    dir.shadow.camera.bottom = -Math.max(level.w, level.d) / 2 - 20;
    dir.shadow.camera.updateProjectionMatrix();
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.04;
    scene.add(dir.target);
    levelObjs.main.castShadow = true;
    levelObjs.main.receiveShadow = true;

    // Helper to update directional light shadow camera to always cover the current view + zoom
    const updateShadowCam = (px: number, pz: number, z: number) => {
      const span = Math.max(level.w, level.d) / 2 / z + 20;
      dir.shadow.camera.left = px - span;
      dir.shadow.camera.right = px + span;
      dir.shadow.camera.top = pz + span;
      dir.shadow.camera.bottom = pz - span;
      dir.shadow.camera.updateProjectionMatrix();
      dir.position.set(px + th.sunDir[0] * 80, Math.max(50, th.sunDir[1] * 100), pz + th.sunDir[2] * 80);
      dir.target.position.set(px, 0, pz);
      dir.target.updateMatrixWorld();
      dir.shadow.needsUpdate = true;
    };
    updateShadowCam(0, 0, 1);

    const gridHelper = new THREE.GridHelper(Math.max(level.w, level.d), Math.round(Math.max(level.w, level.d) / 10), 0x2de2ff, 0x3a2a70);
    gridHelper.position.y = 0.04;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.35;
    scene.add(gridHelper);

    const selGeo = new THREE.BoxGeometry(1, 1, 1);
    const selMat = new THREE.MeshBasicMaterial({
      color: 0xffe14d,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      toneMapped: false,
    });
    const selMesh = new THREE.Mesh(selGeo, selMat);
    selMesh.visible = false;
    selMesh.renderOrder = 20;
    scene.add(selMesh);

    const hovGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const hovMat = new THREE.LineBasicMaterial({ color: 0x2de2ff, depthTest: false, toneMapped: false });
    const hovMesh = new THREE.LineSegments(hovGeo, hovMat);
    hovMesh.visible = false;
    hovMesh.renderOrder = 21;
    scene.add(hovMesh);

    // Orthographic camera positioned well above level.maxH so zooming via frustum never clips tall roofs
    const camY = level.maxH + 150;
    const cam = new THREE.OrthographicCamera(-level.w / 2, level.w / 2, level.d / 2, -level.d / 2, 0.1, camY + 200);
    cam.up.set(0, 0, -1);
    cam.position.set(0, camY, 0);
    cam.lookAt(0, 0, 0);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    threeRef.current = { renderer, scene, cam, selMesh, hovMesh, gridHelper, updateShadowCam };

    return () => {
      threeRef.current = null;
      levelObjs.dispose();
      selGeo.dispose();
      selMat.dispose();
      hovGeo.dispose();
      hovMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [viewMode, level]);

  // Render 3D Top-Down frame whenever camera/selection/hover/size changes
  useEffect(() => {
    const t = threeRef.current;
    if (!t || viewMode !== '3d') return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    t.renderer.setPixelRatio(dpr);
    t.renderer.setSize(dispW, dispH, false);

    const halfW = level.w / 2 / zoom;
    const halfD = level.d / 2 / zoom;
    const camY = level.maxH + 150;
    t.cam.left = -halfW;
    t.cam.right = halfW;
    t.cam.top = halfD;
    t.cam.bottom = -halfD;
    t.cam.near = 0.1;
    t.cam.far = camY + 200;
    t.cam.position.set(pan.x, camY, pan.z);
    t.cam.lookAt(pan.x, 0, pan.z);
    t.cam.updateProjectionMatrix();

    // Keep the directional shadow frustum covering the visible area as we pan/zoom
    t.updateShadowCam(pan.x, pan.z, zoom);

    t.gridHelper.visible = showGrid;

    if (selectedBox && selectedMetrics) {
      t.selMesh.visible = true;
      t.selMesh.position.set(
        (selectedBox.x0 + selectedBox.x1) / 2,
        selectedMetrics.baseY + selectedMetrics.objectHeight / 2,
        (selectedBox.z0 + selectedBox.z1) / 2,
      );
      t.selMesh.scale.set(
        selectedBox.x1 - selectedBox.x0 + 0.12,
        selectedMetrics.objectHeight + 0.12,
        selectedBox.z1 - selectedBox.z0 + 0.12,
      );
    } else {
      t.selMesh.visible = false;
    }

    if (hover?.box && hoverMetrics) {
      const hb = hover.box;
      t.hovMesh.visible = true;
      t.hovMesh.position.set(
        (hb.x0 + hb.x1) / 2,
        hoverMetrics.baseY + hoverMetrics.objectHeight / 2,
        (hb.z0 + hb.z1) / 2,
      );
      t.hovMesh.scale.set(hb.x1 - hb.x0 + 0.16, hoverMetrics.objectHeight + 0.16, hb.z1 - hb.z0 + 0.16);
    } else {
      t.hovMesh.visible = false;
    }

    t.renderer.render(t.scene, t.cam);
  }, [viewMode, dispW, dispH, zoom, pan, level, selectedBox, selectedMetrics, hover, hoverMetrics, showGrid]);

  const clampPan = (nx: number, nz: number, z = zoom) => {
    const maxX = Math.max(0, (level.w / 2) * (1 - 1 / z));
    const maxZ = Math.max(0, (level.d / 2) * (1 - 1 / z));
    return { x: clamp(nx, -maxX, maxX), z: clamp(nz, -maxZ, maxZ) };
  };

  const changeZoom = (nextZoom: number) => {
    const z = clamp(+nextZoom.toFixed(2), 1, 6);
    setZoom(z);
    setPan((p) => clampPan(p.x, p.z, z));
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    changeZoom(zoom * factor);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panZ: pan.z, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
      if (dragRef.current.moved && zoom > 1) {
        const wx = dragRef.current.panX - dx / (scale * zoom);
        const wz = dragRef.current.panZ - dy / (scale * zoom);
        setPan(clampPan(wx, wz));
        return;
      }
    }

    const { wx, wz } = screenToWorld(px, py);
    const { box, idx } = pickBoxAt(level, wx, wz);
    setHover({ px, py, wx, wz, box, idx });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { wx, wz } = screenToWorld(px, py);
    const { box, idx } = pickBoxAt(level, wx, wz);
    sfx.ui();
    if (box && idx >= 0) {
      setSelectedIdx(idx);
    } else {
      // Clicking on open ground clears structure selection and opens general map information
      setSelectedIdx(null);
    }
  };

  void worldToScreen;

  return (
    <Modal onClose={onClose} z={70}>
      <Panel
        title={`Map Inspector · ${level.name}`}
        onClose={onClose}
        className="max-h-[94vh] w-full max-w-5xl"
        right={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { sfx.ui(); setViewMode('2d'); }}
              className={cn('cut-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider', viewMode === '2d' ? 'bg-neon-cyan text-ink' : 'bg-panel2 text-white/70 hover:text-white')}
            >
              2D Blueprint
            </button>
            <button
              type="button"
              onClick={() => { sfx.ui(); setViewMode('3d'); }}
              className={cn('cut-sm px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider', viewMode === '3d' ? 'bg-neon-pink text-white' : 'bg-panel2 text-white/70 hover:text-white')}
            >
              3D Top-Down
            </button>
          </div>
        }
      >
        <div className="nscroll grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1.35fr_1fr]">
          <div ref={wrap} className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-display text-[10px] font-bold uppercase tracking-wider text-white/50">Zoom {zoom.toFixed(1)}×</span>
              <button type="button" onClick={() => changeZoom(zoom * 1.25)} className="cut-sm bg-panel2 px-2 py-0.5 font-display text-xs font-bold text-white hover:bg-neon-cyan hover:text-ink">+</button>
              <button type="button" onClick={() => changeZoom(zoom / 1.25)} className="cut-sm bg-panel2 px-2 py-0.5 font-display text-xs font-bold text-white hover:bg-neon-cyan hover:text-ink">−</button>
              <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, z: 0 }); }} className="cut-sm bg-panel2 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-white/75 hover:text-white">Reset</button>
              <button type="button" onClick={() => setShowGrid((g) => !g)} className="ml-auto font-display text-[10px] font-bold uppercase tracking-wider text-neon-cyan hover:text-white">
                Grid {showGrid ? 'on' : 'off'}
              </button>
            </div>

            <div
              className="relative inline-block max-w-full overflow-hidden bg-ink shadow-[0_0_0_1px_rgba(120,100,220,0.6)]"
              style={{ width: dispW, height: dispH }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { dragRef.current = null; setHover(null); }}
            >
              {viewMode === '2d' ? (
                <canvas ref={canvas2d} style={{ width: dispW, height: dispH }} className="block cursor-crosshair" />
              ) : (
                <div ref={mount3d} style={{ width: dispW, height: dispH }} className="block cursor-crosshair" />
              )}

              {hover && (
                <div className="pointer-events-none absolute left-2 top-2 max-w-[235px] cut-sm bg-ink/95 p-2 text-xs shadow-lg">
                  <div className="font-display text-[10px] font-bold uppercase tracking-widest text-neon-cyan">
                    X {hover.wx.toFixed(1)} · Z {hover.wz.toFixed(1)} m
                  </div>
                  {hover.box && hoverMetrics ? (
                    <>
                      <div className="mt-0.5 font-display text-[11px] font-bold text-neon-yellow">{hoverMetrics.kind}</div>
                      <div className="text-white/75">
                        Base <span className="text-white">{hoverMetrics.baseY.toFixed(1)} m</span> · Height <span className="text-neon-cyan">{hoverMetrics.objectHeight.toFixed(1)} m</span>
                      </div>
                      <div className="text-white/75">
                        Top elevation <span className="text-white">{hoverMetrics.topY.toFixed(1)} m</span> · {hoverMetrics.width}×{hoverMetrics.depth} m
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/45">Click to inspect structure</div>
                    </>
                  ) : (
                    <div className="mt-0.5 text-white/55">Open ground (0.0 m) · Click for map overview</div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.15em] text-white/50">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-[#ffe14d]" /> Selected</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 border border-neon-cyan" /> Hover</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-neon-cyan" /> Jump pads</span>
              <span className="ml-auto text-white/40">Scroll to zoom · Drag to pan · Click structure or ground</span>
            </div>
          </div>

          <div className="flex flex-col justify-between">
            {selectedBox && selectedMetrics ? (
              <div className="fade-in">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-[10px] font-bold uppercase tracking-[0.25em] text-neon-yellow">
                      Structure #{(selectedIdx ?? 0) + 1} of {level.boxes.length}
                    </div>
                    <div className="font-display text-lg font-extrabold uppercase tracking-wider text-white">{selectedMetrics.kind}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { sfx.back(); setSelectedIdx(null); }}
                    className="cut-sm bg-panel2 px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wider text-neon-cyan hover:bg-neon-cyan hover:text-ink"
                  >
                    ← Map overview
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    ['Base height (in-world)', `${selectedMetrics.baseY.toFixed(2)} m`],
                    ['Object height', `${selectedMetrics.objectHeight.toFixed(2)} m`],
                    ['Top elevation', `${selectedMetrics.topY.toFixed(2)} m`],
                    ['Footprint size', `${selectedMetrics.width} × ${selectedMetrics.depth} m`],
                    ['Surface area', `${selectedMetrics.area} m²`],
                    ['Object volume', `${selectedMetrics.volume} m³`],
                    ['Center (X, Z)', `${selectedMetrics.cx}, ${selectedMetrics.cz} m`],
                    ['Under-clearance', selectedMetrics.clearanceUnder > 0 ? `${selectedMetrics.clearanceUnder.toFixed(2)} m` : 'Grounded / Solid'],
                  ].map(([k, v]) => (
                    <div key={k} className="border-b border-line/40 py-1.5">
                      <div className="text-[9px] uppercase tracking-[0.18em] text-white/45">{k}</div>
                      <div className="font-display text-sm font-bold text-white">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 cut-sm bg-panel2/80 p-3 text-xs">
                  <div className="font-display text-[10px] font-bold uppercase tracking-widest text-neon-cyan">Tactical & Traversal</div>
                  <div className="mt-1 font-semibold text-white">{selectedMetrics.traversal}</div>
                  <div className="mt-1 text-white/55">
                    Span X [{selectedBox.x0.toFixed(1)} to {selectedBox.x1.toFixed(1)} m] · Z [{selectedBox.z0.toFixed(1)} to {selectedBox.z1.toFixed(1)} m]
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-4 w-4 border border-white/30" style={{ background: hex(selectedBox.color) }} />
                    <span className="font-display text-[11px] text-white/75">Surface {hex(selectedBox.color)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="fade-in">
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.25em] text-neon-cyan">Arena Overview</div>
                <div className="font-display text-lg font-extrabold uppercase tracking-wider text-white">{level.name}</div>
                <div className="text-xs text-white/55">{level.tagline}</div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip color="#ff2d95">Theme · {level.themeName ?? 'Classic'}</Chip>
                  <Chip color="#2de2ff">Style · {level.styleName ?? 'Standard'}</Chip>
                  {level.id === 'procedural' && <Chip color="#ffe14d">Seed #{level.key?.split('-')[1] ?? '1'}</Chip>}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    ['Dimensions', `${level.w} × ${level.d} m`],
                    ['Total floor area', `${summary.totalArea.toLocaleString()} m²`],
                    ['Open sightline ratio', `${summary.openPct}%`],
                    ['Max elevation', `${level.maxH} m`],
                    ['Total structures', level.boxes.length],
                    ['Jump pads', level.pads.length],
                    ['Towers & high-rises', summary.towers],
                    ['Platforms & terraces', summary.platforms],
                    ['Bridges & catwalks', summary.bridges],
                    ['Stairs & steps', summary.stairs],
                    ['Low cover blocks', summary.cover],
                    ['Neon light strips', level.glow.length],
                  ].map(([k, v]) => (
                    <div key={k as string} className="border-b border-line/40 py-1">
                      <div className="text-[9px] uppercase tracking-[0.18em] text-white/45">{k}</div>
                      <div className="font-display text-sm font-bold text-white">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white/45">Atmosphere & Palette</div>
                  <div className="flex flex-wrap gap-2 text-[10px] text-white/70">
                    {[
                      ['Sky', level.theme.skyTop],
                      ['Horizon', level.theme.skyBottom],
                      ['Fog', level.theme.fog],
                      ['Ground', level.theme.ground],
                      ['Accent', level.theme.accent],
                      ['Secondary', level.theme.accent2],
                    ].map(([label, col]) => (
                      <span key={label as string} className="flex items-center gap-1 bg-panel2 px-2 py-0.5">
                        <span className="h-2.5 w-2.5" style={{ background: hex(col as number) }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-line/50 pt-3">
              <span className="text-[11px] text-white/45">
                {selectedBox ? 'Click open ground to return to arena overview' : 'Click any structure to inspect it'}
              </span>
              <Btn size="sm" variant="cyan" onClick={onClose}>Done</Btn>
            </div>
          </div>
        </div>
      </Panel>
    </Modal>
  );
}
