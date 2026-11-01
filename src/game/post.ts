import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  clamp,
  convertToTexture,
  diffuseColor,
  dot,
  exp,
  float,
  int,
  interleavedGradientNoise,
  ivec2,
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  property,
  renderOutput,
  rtt,
  screenCoordinate,
  screenUV,
  smoothstep,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import GodraysNode from 'three/addons/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import type { AaMode } from './types';

/**
 * HDR post-processing for the WebGPU renderer, authored as a single TSL node graph.
 *
 * Three's WebGPURenderer compiles this graph to WGSL on WebGPU and to GLSL on its
 * automatic WebGL2 fallback, so the game no longer ships hand-written shader pairs
 * (and the old ANGLE/D3D X3577 warnings from the custom `isnan()` sanitiser are gone:
 * HDR values are kept finite structurally with clamps instead).
 *
 * Chain: scene MRT pass → GTAO + SSR (exact view normals / packed metalness+roughness /
 * diffuse from the same MRT pass — no half-res normal texture and no self-reflection
 * march from an approximate G-buffer) → TRAA → shadow-aware Godrays → DoF → viewmodel
 * overlay composite → Bloom → analytic flare → chromatic aberration → sharpen →
 * grade/vignette/grain → output transform → FXAA/SMAA on display-referred pixels.
 */

/**
 * Width of the flare data texture. This is an allocation size, not the old
 * five-source quality cap: at the highest coloured-light tier the engine
 * submits every unoccluded in-frustum emitter it derives (the largest
 * shipped/procedural levels produce roughly half this many grouped runs).
 */
export const FLARE_DATA_CAPACITY = 1024;

export interface FlareSourceParam {
  /** projected emitter centre in UV space */
  uv: THREE.Vector2;
  color: THREE.Color;
  /** already includes distance, screen-position and geometric-occlusion falloffs */
  strength: number;
  /** apparent emitter radius in vertical UV units */
  radius: number;
  /** ring-ghost scale */
  ring: number;
}

export interface PostParams {
  bloom: number;
  rays: number;
  sunUv: THREE.Vector2;
  /** Sun-flare visibility (0..1), including geometric occlusion and a screen-edge falloff. */
  sunVis: number;
  /**
   * Sun-shaft availability from sun elevation/intensity and a mild scattering
   * phase factor. Deliberately independent of whether the solar disc is in
   * frame or visible from the camera: GodraysNode samples the shadow map for
   * the geometry actually in view, so walls and towers can cast shafts even
   * when the disc itself is off-screen or behind another wall.
   */
  rayStrength: number;
  rayColor: THREE.Color;
  /** active point flares for tower lights, grouped neon segments, lamps and pads */
  flares: readonly FlareSourceParam[];
  vignette: number;
  aberration: number;
  grain: number;
  time: number;
  /** DoF focal distance in metres */
  focusDist: number;
  /** DoF strength 0..1 (a live uniform, so moving the slider does not rebuild the graph) */
  dof: number;
  flare: number;
  sharpen: number;
  /** colour grade amount, 0 = classic look */
  grade: number;
  /** kept for API compatibility; MRT pass no longer needs a hide-list */
  exclude: THREE.Object3D[];
}

export interface PostOptions {
  aa: AaMode;
  ssaaScale: number;
  bloom: boolean;
  bloomQuality: 0 | 1 | 2;
  godRays: boolean;
  raysQuality: 0 | 1 | 2;
  ao: 0 | 1 | 2;
  ssr: 0 | 1 | 2;
  /** depth-of-field strength, 0 = off */
  dof: number;
  /** shadow-aware Godrays need a shadow-casting sun */
  shadows: boolean;
  /**
   * The renderer's shadow-map filter type. GodraysNode captures the sun shadow
   * depth texture when its material is first built, and Three recreates that
   * texture when the filter type changes, so the post graph must rebuild too.
   */
  shadowType: THREE.ShadowMapType;
  flare: boolean;
  chromatic: boolean;
  sharpen: boolean;
  colorGrade: boolean;
}

// TSL node expressions are intentionally handled dynamically: the generated node
// classes expose swizzles/operators at runtime that the .d.ts surface only models
// loosely, and threading the exact generic node types through every composition
// step adds noise without changing the generated shader.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynNode = any;

type BloomNodeT = ReturnType<typeof bloom>;
type GodraysNodeT = GodraysNode;
type GtaoNodeT = ReturnType<typeof ao>;
type SsrNodeT = ReturnType<typeof ssr>;

/**
 * GodraysNode always samples the directional shadow map with `.compare()`, but
 * Three's VSM setup deliberately leaves `DepthTexture.compareFunction = null`
 * because the VSM filter itself does not use hardware comparison. The WGSL
 * builder then treats that nearest-filtered depth texture as unfilterable,
 * omits its `sampler_comparison` binding, and still emits
 * `textureSampleCompare(..., nodeUniformN_sampler, ...)` — an unresolved
 * sampler. Configure the already-created shadow depth texture just before the
 * Godrays quad is rendered (the scene pass has run by then), so PCF and VSM
 * both expose the comparison sampler Godrays requires.
 */
class ShadowCompareGodraysNode extends GodraysNode {
  private shadowLight: THREE.DirectionalLight;
  private shadowRenderer: THREE.WebGPURenderer;

  constructor(
    depthNode: DynNode,
    camera: THREE.Camera,
    light: THREE.DirectionalLight,
    renderer: THREE.WebGPURenderer,
  ) {
    super(depthNode, camera, light);
    this.shadowLight = light;
    this.shadowRenderer = renderer;
  }

  override updateBefore(frame: Parameters<THREE.Node['updateBefore']>[0]) {
    const depthTexture = this.shadowLight.shadow.map?.depthTexture;
    if (depthTexture?.compareFunction === null) {
      depthTexture.compareFunction = this.shadowRenderer.reversedDepthBuffer
        ? THREE.GreaterEqualCompare
        : THREE.LessEqualCompare;
    }
    return super.updateBefore(frame);
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class PostPipeline {
  private renderer: THREE.WebGPURenderer;
  private pipeline: THREE.RenderPipeline;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private sun: THREE.DirectionalLight;
  private opts: PostOptions;
  private graphKey = '';

  private scenePass: DynNode = null;
  private overlayPass: DynNode = null;
  private bloomNode: BloomNodeT | null = null;
  private godNode: GodraysNodeT | null = null;
  private gtaoNode: GtaoNodeT | null = null;
  private ssrNode: SsrNodeT | null = null;
  private godBaseDensity = 0;
  private godBaseSteps = 0;
  private godBaseResolution = 0.4;
  private disposables: { dispose?: () => void }[] = [];

  private emptyOverlay = new THREE.Scene();
  private blackBg = new THREE.Color(0x000000);
  private w = 1;
  private h = 1;

  // dynamic per-frame uniforms (created once, re-referenced on graph rebuilds)
  private uSunUv = uniform(new THREE.Vector2(0.5, 0.5));
  private uSunVis = uniform(0);
  private uRayColor = uniform(new THREE.Color(1, 1, 1));
  private uFlareColor = uniform(new THREE.Color(1, 1, 1));
  private uFlare = uniform(0);
  // Flare sources travel through a tiny data texture and a dynamic shader
  // loop instead of a fixed set of unrolled uniforms. Rows are position,
  // colour/strength, and radius/ring. Lower quality tiers still cap how many
  // active sources the engine submits; the highest tier submits all that
  // survived frustum + raycast-visibility filtering.
  private flareData = new Float32Array(FLARE_DATA_CAPACITY * 3 * 4);
  private flareDataTex = new THREE.DataTexture(
    this.flareData,
    FLARE_DATA_CAPACITY,
    3,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  private uFlareCount = uniform(0, 'int');
  private uAspect = uniform(1);
  private uVignette = uniform(0);
  private uGrain = uniform(0);
  private uGrade = uniform(0);
  private uTime = uniform(0);
  private uFocus = uniform(18);
  private uBokeh = uniform(1);
  private uAberration = uniform(0);
  private uSharpness = uniform(2);

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: PostOptions,
    sun: THREE.DirectionalLight,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.opts = { ...opts };
    this.emptyOverlay.background = this.blackBg;
    this.flareDataTex.minFilter = THREE.NearestFilter;
    this.flareDataTex.magFilter = THREE.NearestFilter;
    this.flareDataTex.generateMipmaps = false;
    this.flareDataTex.needsUpdate = true;
    this.pipeline = new THREE.RenderPipeline(renderer);
    // The graph ends with an explicit renderOutput() so FXAA/SMAA can run on
    // display-referred pixels after tone mapping instead of on linear HDR.
    this.pipeline.outputColorTransform = false;
    this.buildGraph();
  }

  /** Both SSR tiers share the coherent mirror/blur graph; only these live fields differ. */
  private configureSsr(node: SsrNodeT, q: number) {
    node.resolutionScale = q === 1 ? 0.45 : 0.72;
    node.maxDistance.value = q === 1 ? 28 : 52;
    node.thickness.value = q === 1 ? 0.5 : 0.55;
    node.quality.value = q === 1 ? 0.58 : 0.9;
    node.intensity.value = q === 1 ? 0.46 : 0.56;
    node.screenEdgeFade.value = 0.2;
    node.mirrorBias.value = 0;
  }

  setOptions(opts: PostOptions) {
    this.opts = { ...opts };
    if (this.keyOf(opts) !== this.graphKey) {
      this.buildGraph();
      return;
    }
    // Live-valued options excluded from the graph key: these are plain
    // resolution-scale/uniform fields that their nodes re-read in
    // updateBefore every frame, so dragging the SSAA slider (or flipping
    // Bloom/AO/SSR quality) must not rebuild the whole node graph per step.
    if (this.scenePass && opts.aa === 'ssaa') {
      this.scenePass.setResolutionScale(Math.min(2.5, Math.max(1, opts.ssaaScale)));
    }
    if (this.bloomNode) {
      this.bloomNode.setResolutionScale([0.34, 0.45, 0.55][opts.bloomQuality]);
    }
    if (this.gtaoNode && opts.ao > 0) {
      // GTAONode re-reads resolutionScale in setSize every frame and
      // rebuilds only its own material when the sample count changes.
      this.gtaoNode.resolutionScale = opts.ao === 1 ? 0.45 : 0.65;
      this.gtaoNode.samples.value = opts.ao === 1 ? 10 : 20;
    }
    if (this.ssrNode && opts.ssr > 0) {
      // SSRNode re-reads resolutionScale in updateBefore and consumes the
      // rest as uniforms, so Balanced↔Quality is a live change now that both
      // tiers use the same non-stochastic shader variant.
      this.configureSsr(this.ssrNode, opts.ssr);
    }
  }

  setSize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.uAspect.value = this.w / this.h;
    // No per-node setSize: PassNode/GTAO/SSR/Godrays/TRAA/DoF/Bloom all size
    // themselves from the drawing buffer (or their input texture) inside
    // updateBefore every frame. Calling setSize manually is not just
    // redundant — BloomNode.setSize dereferences blur materials that only
    // exist after its first setup(), so a pre-first-render resize crashes.
  }

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    overlay: THREE.Scene | null,
    overlayCam: THREE.Camera,
    p: PostParams,
  ) {
    if (this.scenePass) {
      this.scenePass.scene = scene;
      this.scenePass.camera = camera;
    }
    if (this.overlayPass) {
      this.overlayPass.scene = overlay ?? this.emptyOverlay;
      this.overlayPass.camera = overlayCam;
      // The pipeline always samples the overlay, but an absent viewmodel only
      // needs its cleared black/depth=1 result. Rendering that at 2% scale
      // gives the composite the same mask without a full-screen clear.
      this.overlayPass.setResolutionScale(overlay ? 1 : 0.02);
    }

    // dynamic uniforms / node parameters
    (this.uSunUv.value as THREE.Vector2).copy(p.sunUv);
    this.uSunVis.value = clamp01(p.sunVis);
    this.uVignette.value = Math.max(0, p.vignette);
    this.uGrain.value = Math.max(0, p.grain);
    this.uGrade.value = clamp01(p.grade);
    this.uTime.value = p.time;
    this.uFocus.value = Math.max(0.6, p.focusDist);
    this.uBokeh.value = 0.65 + clamp01(p.dof) * 3;
    this.uFlare.value = Math.max(0, p.flare);
    (this.uFlareColor.value as THREE.Color).copy(p.rayColor);
    const flareCount = Math.min(p.flares.length, FLARE_DATA_CAPACITY);
    this.uFlareCount.value = flareCount;
    if (flareCount > 0) {
      const row = FLARE_DATA_CAPACITY * 4;
      for (let i = 0; i < flareCount; i++) {
        const src = p.flares[i];
        const o = i * 4;
        this.flareData[o] = src.uv.x;
        this.flareData[o + 1] = src.uv.y;
        this.flareData[o + 2] = src.uv.x;
        this.flareData[o + 3] = src.uv.y;
        this.flareData[row + o] = src.color.r;
        this.flareData[row + o + 1] = src.color.g;
        this.flareData[row + o + 2] = src.color.b;
        this.flareData[row + o + 3] = clamp01(src.strength);
        this.flareData[row * 2 + o] = Math.min(0.25, Math.max(0.008, src.radius));
        this.flareData[row * 2 + o + 1] = clamp01(src.ring);
        this.flareData[row * 2 + o + 2] = 0;
        this.flareData[row * 2 + o + 3] = 0;
      }
      // Projected positions move with the camera, so the data texture is
      // refreshed whenever any local flare is active — but only the active
      // columns of each row. (Capacity stays 1024: a large procedural arena
      // derives >512 static emitters, and the highest tier's contract is
      // "no count cap", so halving the texture would silently re-cap it.)
      this.flareDataTex.clearUpdateRanges();
      this.flareDataTex.addUpdateRange(0, flareCount * 4);
      this.flareDataTex.addUpdateRange(row, flareCount * 4);
      this.flareDataTex.addUpdateRange(row * 2, flareCount * 4);
      this.flareDataTex.needsUpdate = true;
    }
    // PostParams.aberration is in UV-offset units (~0.001-0.016); the official
    // node's strength is roughly "percent of screen" — rescale to match.
    this.uAberration.value = Math.min(0.38, Math.max(0, p.aberration) * 32);
    // SharpenNode: 0 = strongest, 2 = off. Keep the usable range away from
    // the crunchy end; this is meant to restore TAA/FXAA detail, not outline it.
    this.uSharpness.value = Math.min(2, Math.max(0.45, 2 - Math.max(0, p.sharpen) * 1.7));

    if (this.bloomNode) this.bloomNode.strength.value = Math.max(0, p.bloom) * 0.55;
    if (this.godNode) {
      const amt = Math.max(0, p.rays) * clamp01(p.rayStrength);
      this.godNode.density.value = this.godBaseDensity * amt;
      this.godNode.maxDensity.value = 0.24 * Math.min(1, amt);
      // The march loop bound and target scale are live, but they now collapse
      // only when the effect itself is effectively off (slider at zero or the
      // sun too low to contribute). An off-screen or camera-occluded disc no
      // longer disables the march: the shadow map still describes which
      // parts of the visible air column are sunlit.
      const active = amt > 0.001;
      this.godNode.raymarchSteps.value = active ? this.godBaseSteps : 1;
      this.godNode.resolutionScale = active ? this.godBaseResolution : 0.04;
      (this.uRayColor.value as THREE.Color).copy(p.rayColor).multiplyScalar(1.15);
    }

    // The viewmodel pass needs a known (black) background so depth can mask the
    // opaque weapon while transparent muzzle glow still composites additively.
    const oldBg = overlay ? overlay.background : null;
    if (overlay) overlay.background = this.blackBg;
    try {
      this.pipeline.render();
    } finally {
      if (overlay) overlay.background = oldBg;
    }
  }

  dispose() {
    this.disposeGraph();
    this.flareDataTex.dispose();
    this.pipeline.dispose();
  }

  /* ------------------------------------------------------------ graph setup */

  private keyOf(o: PostOptions): string {
    // Only graph-shape options belong here. ssaaScale, bloomQuality and the
    // AO/SSR quality tiers are applied live in setOptions (see there); only
    // AO/SSR on/off changes the graph shape (both SSR tiers now compile the
    // same non-stochastic mirror/blur variant).
    return [
      o.aa,
      o.bloom ? 1 : 0,
      o.godRays ? 1 : 0,
      o.raysQuality,
      o.ao > 0 ? 1 : 0,
      o.ssr > 0 ? 1 : 0,
      o.dof > 0.001 ? 1 : 0,
      o.shadows ? 1 : 0,
      o.shadowType,
      o.flare ? 1 : 0,
      o.chromatic ? 1 : 0,
      o.sharpen ? 1 : 0,
      o.colorGrade ? 1 : 0,
    ].join('|');
  }

  private disposeGraph() {
    for (let i = this.disposables.length - 1; i >= 0; i--) {
      try {
        this.disposables[i].dispose?.();
      } catch {
        /* node disposal is best-effort during settings rebuilds */
      }
    }
    this.disposables = [];
    this.bloomNode = null;
    this.godNode = null;
    this.gtaoNode = null;
    this.ssrNode = null;
  }

  /** Materialise a node expression into a texture where an effect needs random access. */
  private tex(node: DynNode): DynNode {
    const t = convertToTexture(node);
    if (t !== node) this.disposables.push(t as { dispose?: () => void });
    return t;
  }

  private buildGraph() {
    this.disposeGraph();
    const o = this.opts;
    this.graphKey = this.keyOf(o);

    // Normals are an SSR-only attachment: GTAO reconstructs its normals from
    // depth (exact on this game's flat-shaded faces), because transparent
    // shells overwrite auxiliary MRT data — with MRT normals, surfaces seen
    // through volumetric cones lost their AO in a cone-shaped patch.
    const needNormal = o.ssr > 0;
    const needVelocity = o.aa === 'taa';
    const needMaterial = o.ssr > 0;

    // --- beauty pass (MRT only for the buffers the enabled effects consume)
    const scenePass = pass(this.scene, this.camera, { samples: o.aa === 'native' ? 4 : 0 });
    // SSAA has exactly one supersampling site per path: here, via the pass
    // resolution scale when the pipeline exists; Engine.resize supersamples
    // the drawing buffer itself only when there is no pipeline. resize()
    // also folds this scale into its 8192px target-fit clamp.
    if (o.aa === 'ssaa') scenePass.setResolutionScale(Math.min(2.5, Math.max(1, o.ssaaScale)));
    const outputs: Record<string, DynNode> = { output };
    if (needNormal) outputs.normal = normalView;
    if (needVelocity) outputs.velocity = velocity;
    if (needMaterial) {
      // Metalness/roughness packed into one attachment instead of two RGBA16F
      // targets. Placeholder-backed property nodes give unlit/basic materials
      // (which never assign Roughness/Metalness) sane defaults instead of an
      // uninitialised shader variable.
      const safeMetalness = property('float', 'Metalness', float(0));
      const safeRoughness = property('float', 'Roughness', float(1));
      outputs.material = vec2(safeMetalness, safeRoughness);
      outputs.diffuse = diffuseColor;
    }
    if (Object.keys(outputs).length > 1) scenePass.setMRT(mrt(outputs));
    // WebGPU only guarantees maxColorAttachmentBytesPerSample = 32, but five
    // default RGBA16F attachments cost 40 — that is a hard validation error
    // on the full Reference combo (not fixable via requiredLimits, which
    // adapters capped at 32 would reject at device creation). Note that the
    // limit uses WebGPU's *render target pixel byte cost*, not raw texel
    // storage: RGBA8Unorm costs 8 here despite storing 4 bytes. Keep the
    // two-channel material data in RG8 (cost 2), giving beauty 8 (RGBA16F)
    // + velocity 4 (RG16F) + material 2 (RG8) + diffuse 8 (RGBA8) + normal
    // 8 (RGBA16F) = 30, safely below the guaranteed limit.
    if (needVelocity) {
      const t = scenePass.getTexture('velocity');
      t.format = THREE.RGFormat; t.type = THREE.HalfFloatType; t.needsUpdate = true;
    }
    if (needMaterial) {
      const m = scenePass.getTexture('material');
      m.format = THREE.RGFormat; m.type = THREE.UnsignedByteType; m.needsUpdate = true;
      const d = scenePass.getTexture('diffuse');
      d.format = THREE.RGBAFormat; d.type = THREE.UnsignedByteType; d.needsUpdate = true;
    }
    this.scenePass = scenePass;
    this.disposables.push(scenePass);

    const beauty = scenePass.getTextureNode();
    const depthTex = scenePass.getTextureNode('depth');
    const normalTex = needNormal ? scenePass.getTextureNode('normal') : null;

    let color: DynNode = beauty;
    let rgb: DynNode = beauty.rgb;
    let litChanged = false;

    // --- GTAO (exact MRT normals when available; depth-reconstructed otherwise)
    if (o.ao > 0) {
      const gtao = ao(depthTex, null as unknown as DynNode, this.camera);
      gtao.resolutionScale = o.ao === 1 ? 0.45 : 0.65;
      gtao.samples.value = o.ao === 1 ? 10 : 20;
      gtao.radius.value = 0.78;
      gtao.thickness.value = 0.9;
      gtao.scale.value = 1.05;
      gtao.useTemporalFiltering = o.aa === 'taa';
      this.gtaoNode = gtao;
      this.disposables.push(gtao);
      const aoF = gtao.getTextureNode().r;
      rgb = rgb.mul(mix(float(1), aoF, 0.82));
      litChanged = true;
    }

    // --- SSR (official marcher fed by exact MRT material data, tuned to metres)
    if (o.ssr > 0 && normalTex) {
      const matTex = scenePass.getTextureNode('material');
      const diffTex = scenePass.getTextureNode('diffuse');
      const q = o.ssr;
      // Deliberately non-stochastic at BOTH tiers. SSRNode's stochastic mode
      // traces one randomly GGX-scattered ray per pixel per frame and expects
      // a downstream temporal/spatial denoiser (plus a CDF-backed equirect
      // environment for misses); this pipeline has neither. At the level
      // material's effective roughness (~0.4–0.68) that made "Quality" a
      // moving one-sample fuzz — visibly worse than Balanced — and produced a
      // patchy, differently coloured disc on the floor around the camera,
      // where scattered rays from near-nadir floor pixels randomise between
      // skyward misses and nearby hits. Quality therefore scales the same
      // coherent mirror-ray + roughness-blur path that already looked right:
      // higher resolution, more march steps and longer range (configureSsr).
      // Runtime SSRNode samples this as a texture; its .d.ts types it as vec3.
      const ssrNode = ssr(beauty, depthTex, normalTex as DynNode, {
        stochastic: false,
        metalnessNode: matTex.r,
        roughnessNode: matTex.g,
        diffuseNode: diffTex,
        reflectNonMetals: true,
        binaryRefine: true,
        camera: this.camera,
      });
      this.ssrNode = ssrNode;
      this.configureSsr(ssrNode, q);
      ssrNode.screenEdgeFadeBlack = true;
      this.disposables.push(ssrNode);
      rgb = rgb.add((ssrNode as DynNode).rgb);
      litChanged = true;
    }

    if (litChanged) color = vec4(rgb, 1);

    // --- temporal AA (official TRAA with the real velocity buffer)
    if (o.aa === 'taa') {
      const velocityTex = scenePass.getTextureNode('velocity');
      const taa = traa(this.tex(color), depthTex, velocityTex, this.camera);
      this.disposables.push(taa as unknown as { dispose?: () => void });
      color = taa;
    }

    // --- shadow-aware volumetric sun shafts
    if (o.godRays && o.shadows) {
      const q = o.raysQuality;
      const god = new ShadowCompareGodraysNode(depthTex, this.camera, this.sun, this.renderer);
      // Quality 0 is the UI's Fast tier, not "off" (that is o.godRays). The
      // densities are deliberately below the old values: GodraysNode adds
      // in-scatter along every view ray, so the previous 0.55–0.75 base with
      // a 0.6 cap read as full-screen fog rather than local shafts.
      this.godBaseSteps = [20, 32, 48][q];
      god.raymarchSteps.value = this.godBaseSteps;
      this.godBaseResolution = [0.32, 0.42, 0.52][q];
      god.resolutionScale = this.godBaseResolution;
      god.distanceAttenuation.value = 1.25;
      this.godBaseDensity = [0.2, 0.3, 0.38][q];
      god.density.value = 0;
      god.maxDensity.value = 0;
      this.godNode = god;
      this.disposables.push(god);
      const blurred = bilateralBlur(god.getTextureNode(), float(1), [1, 1.5, 2][q], 0.3);
      this.disposables.push(blurred as unknown as { dispose?: () => void });
      color = depthAwareBlend(this.tex(color), blurred.getTextureNode(), depthTex, this.camera, {
        blendColor: this.uRayColor as DynNode,
        edgeRadius: 2,
        edgeStrength: 1.6,
      });
    }

    // --- depth of field (world only; the viewmodel is composited afterwards)
    if (o.dof > 0.001) {
      const dofNode = dof(this.tex(color), scenePass.getViewZNode(), this.uFocus as DynNode, 30, this.uBokeh as DynNode);
      this.disposables.push(dofNode as unknown as { dispose?: () => void });
      color = dofNode;
    }

    // --- viewmodel overlay: depth-masked replace + additive transparent glow
    const overlayPass = pass(this.emptyOverlay, this.camera, {
      samples: o.aa === 'native' || o.aa === 'taa' ? 4 : 0,
    });
    this.overlayPass = overlayPass;
    this.disposables.push(overlayPass);
    const oTex = overlayPass.getTextureNode();
    const oDepth = overlayPass.getTextureNode('depth');
    const mask = oDepth.r.lessThan(0.9999).select(float(1), float(0));
    const overRgb = oTex.rgb;
    color = vec4(mix(color.rgb, overRgb, mask).add(overRgb.mul(float(1).sub(mask))), 1);

    // Keep HDR finite by construction before the bloom mip chain (no isnan tests).
    color = vec4(clamp(color.rgb, vec3(0), vec3(64)), 1);

    // --- bloom (quality 0 is Fast, not off; o.bloom carries the on/off state)
    if (o.bloom) {
      const b = bloom(color, 0.45, 0.42, 0.88);
      b.setResolutionScale([0.34, 0.45, 0.55][o.bloomQuality]);
      this.bloomNode = b;
      this.disposables.push(b);
      color = color.add(b);
    }

    // --- analytic lens flare (same art direction as the old final pass, in TSL)
    if (o.flare) {
      // Local sources are accumulated in a half-resolution RTT: their halos
      // and ghosts are smooth, and this is what makes a dynamic loop over
      // potentially dozens of unoccluded emitters at the highest tier viable.
      // The sun keeps its full-resolution three-ghost/streak pattern.
      const localFlare = rtt(vec4(this.localFlaresRgb(), 1), null, null, {
        type: THREE.HalfFloatType,
        resolutionScale: 0.5,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      this.disposables.push(localFlare as unknown as { dispose?: () => void });
      color = vec4(color.rgb.add(this.sunFlareRgb()).add(localFlare.rgb), 1);
    }

    // --- chromatic aberration + sharpen (HDR, before the output transform)
    if (o.chromatic) {
      color = chromaticAberration(this.tex(color), this.uAberration as DynNode, vec2(0.5, 0.5) as DynNode, float(1.05) as DynNode);
    }
    if (o.sharpen) {
      const sh = sharpen(this.tex(color), this.uSharpness as DynNode, true);
      this.disposables.push(sh as unknown as { dispose?: () => void });
      color = sh;
    }

    // --- grade / vignette / grain, then tone map + output colour space
    let graded: DynNode = clamp(color.rgb, vec3(0), vec3(64));
    if (o.colorGrade) {
      const lum = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      graded = mix(vec3(lum), graded, float(1).add(this.uGrade.mul(0.45)));
      graded = graded.sub(0.35).mul(float(1).add(this.uGrade.mul(0.1))).add(0.35);
      graded = clamp(graded, vec3(0), vec3(64));
    }
    const v = screenUV.sub(0.5);
    graded = graded.mul(clamp(float(1).sub(dot(v, v).mul(this.uVignette).mul(1.25)), 0, 1));
    const noise = interleavedGradientNoise(screenCoordinate.xy.add(this.uTime.mul(61.7)));
    graded = graded.add(noise.sub(0.5).mul(this.uGrain));

    let display: DynNode = renderOutput(vec4(graded, 1));
    if (o.aa === 'fxaa') display = fxaa(this.tex(display));
    else if (o.aa === 'smaa') display = smaa(this.tex(display));

    this.pipeline.outputNode = display;
    this.pipeline.needsUpdate = true;
  }

  /** Sun ghosts/streaks; strength already carries engine-side geometric occlusion. */
  private sunFlareRgb(): DynNode {
    const aspUv = vec2(screenUV.x.mul(this.uAspect), screenUV.y);
    const sunAsp = vec2(this.uSunUv.x.mul(this.uAspect), this.uSunUv.y);
    const mirAsp = vec2(float(1).sub(this.uSunUv.x).mul(this.uAspect), float(1).sub(this.uSunUv.y));

    const ringDist = abs(length(aspUv.sub(mirAsp)).sub(0.42));
    let acc: DynNode = float(1).sub(smoothstep(0, 0.22, ringDist)).mul(0.16);

    const ghosts: [number, number, number][] = [
      [0.25, 0.05, 0.1],
      [0.47, 0.095, 0.075],
      [0.69, 0.14, 0.05],
    ];
    for (const [t, r, a] of ghosts) {
      const gp = mix(sunAsp, mirAsp, t);
      acc = acc.add(float(1).sub(smoothstep(r * 0.25, r, length(aspUv.sub(gp)))).mul(a));
    }

    const streak = exp(abs(screenUV.y.sub(this.uSunUv.y)).mul(-90))
      .mul(exp(abs(screenUV.x.sub(this.uSunUv.x)).mul(-3)))
      .mul(0.11);
    acc = acc.add(streak);

    // The solar disc is orders of magnitude brighter than any lamp, but in
    // game terms its full ghost chain quickly becomes the whole image. Keep
    // the sun pattern itself at 42% so the shared flare slider can use a
    // sensible range for both the sun and comparatively subtle local lights.
    return this.uFlareColor.mul(acc).mul(this.uFlare).mul(this.uSunVis).mul(0.42);
  }

  /**
   * Dynamic accumulation of every active local flare source. Each source is
   * an ordinary projected point: a grouped neon segment contributes exactly
   * one circular halo/ghost chain, never a line-shaped flare. The loop bound
   * is the live active count, not a fixed unrolled source count.
   */
  private localFlaresRgb(): DynNode {
    const compute = Fn(() => {
      const aspUv = vec2(screenUV.x.mul(this.uAspect), screenUV.y).toVar();
      const acc = vec3(0).toVar();

      Loop(this.uFlareCount as DynNode, ({ i }: { i: DynNode }) => {
        const position = textureLoad(this.flareDataTex, ivec2(i, int(0)));
        const colorStrength = textureLoad(this.flareDataTex, ivec2(i, int(1)));
        const shape = textureLoad(this.flareDataTex, ivec2(i, int(2)));

        const a = vec2(position.x.mul(this.uAspect), position.y);
        const radius = clamp(shape.x, float(0.008), float(0.25));
        const srcAcc = float(0).toVar();

        const q = length(aspUv.sub(a)).div(radius);
        srcAcc.addAssign(exp(q.mul(q).mul(-1.8)).mul(0.14));

        const mirror = vec2(this.uAspect.sub(a.x), float(1).sub(a.y));
        const ghosts: [number, number, number][] = [
          [0.34, 1.05, 0.11],
          [0.62, 1.65, 0.07],
        ];
        for (const [t, rScale, amp] of ghosts) {
          const ghost = mix(a, mirror, t);
          const r = radius.mul(rScale);
          srcAcc.addAssign(float(1).sub(smoothstep(r.mul(0.25), r, length(aspUv.sub(ghost)))).mul(amp));
        }

        const ringDist = abs(length(aspUv.sub(mirror)).sub(0.3));
        srcAcc.addAssign(float(1).sub(smoothstep(0, 0.16, ringDist)).mul(0.04).mul(shape.y));

        acc.addAssign(colorStrength.rgb.mul(srcAcc).mul(this.uFlare).mul(colorStrength.a));
      });

      return acc;
    });
    return compute();
  }
}
