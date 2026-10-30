import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Screen-space volumetric light scattering, occluded by the depth buffer. */
const RAYS_FS = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 sunUv;
uniform float vis;
uniform float density;
uniform float aspect;
varying vec2 vUv;
const int N = 40;
float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 delta = (vUv - sunUv) * density / float(N);
  vec2 uv = vUv;
  float illum = 0.0;
  float w = 1.0;
  uv -= delta * rnd(vUv * 91.7);
  for (int i = 0; i < N; i++) {
    uv -= delta;
    vec2 c = clamp(uv, 0.001, 0.999);
    float d = texture2D(tDepth, c).x;
    illum += step(0.99995, d) * w;
    w *= 0.965;
  }
  illum /= float(N) * 0.9;
  vec2 dd = (vUv - sunUv) * vec2(aspect, 1.0);
  float glow = exp(-dot(dd, dd) * 12.0);
  gl_FragColor = vec4(vec3(illum * vis * (0.06 + glow * 0.9)), 1.0);
}`;

const FINAL_FS = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tRays;
uniform vec3 rayColor;
uniform float rayAmt;
uniform float vignette;
uniform float aberration;
uniform float grain;
uniform float time;
varying vec2 vUv;
void main(){
  vec2 off = (vUv - 0.5) * aberration;
  vec3 col;
  if (aberration > 0.0001) {
    col.r = texture2D(tColor, vUv + off).r;
    col.g = texture2D(tColor, vUv).g;
    col.b = texture2D(tColor, vUv - off).b;
  } else col = texture2D(tColor, vUv).rgb;
  col += texture2D(tRays, vUv).rgb * rayColor * rayAmt * 0.28;
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * vignette * 1.6;
  if (grain > 0.0) col += (fract(sin(dot(vUv * (time + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * grain;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface PostParams {
  bloom: number;
  rays: number;
  sunUv: THREE.Vector2;
  sunVis: number;
  rayColor: THREE.Color;
  vignette: number;
  aberration: number;
  grain: number;
  time: number;
}

export class PostPipeline {
  private rt: THREE.WebGLRenderTarget;
  private raysRT: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private raysMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;
  private black: THREE.DataTexture;
  private w = 1;
  private h = 1;

  constructor(private renderer: THREE.WebGLRenderer, msaa: boolean) {
    const depth = new THREE.DepthTexture(1, 1);
    depth.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0, depthTexture: depth });
    this.raysRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(128, 128), 0.6, 0.4, 0.95);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.raysMat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: RAYS_FS, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: depth }, sunUv: { value: new THREE.Vector2() }, vis: { value: 0 }, density: { value: 0.9 }, aspect: { value: 1 } },
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: this.rt.texture }, tRays: { value: this.raysRT.texture }, rayColor: { value: new THREE.Color() }, rayAmt: { value: 0 },
        vignette: { value: 0.5 }, aberration: { value: 0 }, grain: { value: 0 }, time: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.finalMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.rt.setSize(w, h);
    this.raysRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.bloom.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.raysMat.uniforms.aspect.value = w / Math.max(1, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, overlay: THREE.Scene | null, overlayCam: THREE.Camera, p: PostParams) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    if (overlay) {
      r.clearDepth();
      r.render(overlay, overlayCam);
    }
    if (p.bloom > 0.01) {
      this.bloom.strength = p.bloom * 0.6;
      this.bloom.render(r, this.rt, this.rt, 0, false);
    }
    const raysOn = p.rays > 0.01 && p.sunVis > 0.01;
    if (raysOn) {
      this.raysMat.uniforms.sunUv.value.copy(p.sunUv);
      this.raysMat.uniforms.vis.value = p.sunVis;
      this.quad.material = this.raysMat;
      r.setRenderTarget(this.raysRT);
      r.render(this.scene, this.cam);
    }
    const u = this.finalMat.uniforms;
    u.tRays.value = raysOn ? this.raysRT.texture : this.black;
    u.rayAmt.value = raysOn ? p.rays : 0;
    u.rayColor.value.copy(p.rayColor);
    u.vignette.value = p.vignette;
    u.aberration.value = p.aberration;
    u.grain.value = p.grain;
    u.time.value = p.time % 100;
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }

  get size() {
    return [this.w, this.h];
  }

  dispose() {
    this.rt.dispose();
    this.raysRT.dispose();
    this.bloom.dispose();
    this.raysMat.dispose();
    this.finalMat.dispose();
    this.black.dispose();
  }
}
