import * as THREE from 'three';
import { flameTexture, radialSprite } from '../world/textures';

/**
 * Fire: animated flame billboards, a flickering point light, rising embers and a glow halo.
 * Used by braziers (fire bowls on stands) and wall torches.
 */

let sharedFlameTex: THREE.Texture | null = null;
let sharedGlowTex: THREE.Texture | null = null;
let sharedEmberTex: THREE.Texture | null = null;

const flameVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const flameFrag = /* glsl */ `
  uniform sampler2D noiseTex;
  uniform float time;
  uniform float seed;
  uniform float intensity;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    float n1 = texture2D(noiseTex, vec2(uv.x * 0.8 + seed, uv.y * 0.6 - time * 1.4)).a;
    float n2 = texture2D(noiseTex, vec2(uv.x * 1.6 - seed, uv.y * 1.2 - time * 2.3)).a;
    float n = n1 * 0.6 + n2 * 0.4;
    // tongue shape: wide at the bottom, narrowing to the top, distorted by noise
    float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.6 * uv.y;
    float width = mix(0.85, 0.05, pow(uv.y, 0.8));
    float body = 1.0 - smoothstep(width * 0.55, width, abs(x));
    float fadeTop = 1.0 - smoothstep(0.35, 1.0, uv.y + (n - 0.5) * 0.5);
    float fadeBottom = smoothstep(0.0, 0.12, uv.y);
    float a = body * fadeTop * fadeBottom * (0.6 + n * 0.8);
    float heat = clamp(a * 1.4 - uv.y * 0.5, 0.0, 1.0);
    vec3 col = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.1, 0.5, heat));
    col = mix(col, vec3(1.0, 0.92, 0.7), smoothstep(0.6, 1.0, heat));
    gl_FragColor = vec4(col * intensity * 2.5 * a, 1.0);
  }
`;

export class Fire {
  readonly group = new THREE.Group();
  /** local position of the light source */
  readonly lightOffset: THREE.Vector3;
  /** current flicker factor (0..~1.1) */
  flicker = 1;
  private flames: THREE.Mesh[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private embers: THREE.Points;
  private emberData: { vel: THREE.Vector3; life: number; max: number }[] = [];
  private glow: THREE.Sprite;
  private baseIntensity: number;
  private seed = Math.random() * 10;
  private t = Math.random() * 100;
  lit = true;
  /** an arrow through the flame puts it out */
  shootable = false;

  constructor(size = 1, lightIntensity = 40) {
    if (!sharedFlameTex) sharedFlameTex = flameTexture();
    if (!sharedGlowTex) sharedGlowTex = radialSprite('rgba(255,150,60,0.55)', 'rgba(255,80,20,0)');
    if (!sharedEmberTex) sharedEmberTex = radialSprite('rgba(255,220,150,1)', 'rgba(255,120,30,0)', 32);

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          noiseTex: { value: sharedFlameTex },
          time: { value: 0 },
          seed: { value: this.seed + i * 1.7 },
          intensity: { value: i === 0 ? 1.0 : 0.7 },
        },
        vertexShader: flameVert,
        fragmentShader: flameFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const w = size * (i === 0 ? 0.8 : 0.6);
      const h = size * (i === 0 ? 1.5 : 1.15);
      const geo = new THREE.PlaneGeometry(w, h);
      geo.translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((i - 1) * 0.12 * size, 0, (i % 2) * 0.08 * size);
      m.renderOrder = 10;
      this.flames.push(m);
      this.mats.push(mat);
      this.group.add(m);
    }

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sharedGlowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55,
    }));
    this.glow.scale.setScalar(size * 3.2);
    this.glow.position.y = size * 0.45;
    this.group.add(this.glow);

    const count = 14;
    const pos = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({
      map: sharedEmberTex, size: 0.09 * Math.max(1, size), color: 0xffb070, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.embers.frustumCulled = false;
    for (let i = 0; i < count; i++) this.emberData.push({ vel: new THREE.Vector3(), life: 0, max: 0 });
    this.group.add(this.embers);

    this.baseIntensity = lightIntensity;
    this.lightOffset = new THREE.Vector3(0, size * 0.6, 0);
  }

  get intensity() {
    return this.lit ? this.baseIntensity * this.flicker : 0;
  }

  lightWorldPos(target: THREE.Vector3) {
    return this.group.localToWorld(target.copy(this.lightOffset));
  }

  /** Approximate light contribution at a world point (used for stealth visibility). */
  illuminationAt(p: THREE.Vector3): number {
    if (!this.lit) return 0;
    const wp = this.lightWorldPos(_v);
    const d2 = Math.max(1, wp.distanceToSquared(p));
    return this.baseIntensity / d2;
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    const visible = this.lit;
    this.group.visible = visible;
    if (!visible) return;
    // layered flicker
    const f = 0.82 + 0.1 * Math.sin(this.t * 13.1 + this.seed) + 0.06 * Math.sin(this.t * 23.7) + 0.05 * Math.sin(this.t * 5.3 + 1.3) + (Math.random() - 0.5) * 0.06;
    this.flicker = f;
    this.glow.material.opacity = 0.4 + 0.15 * f;

    // cylindrical billboard: rotate flames around Y towards the camera
    const camPos = camera.position;
    const wp = this.group.getWorldPosition(_v);
    const ang = Math.atan2(camPos.x - wp.x, camPos.z - wp.z);
    for (let i = 0; i < this.flames.length; i++) {
      this.flames[i].rotation.y = ang + (i - 1) * 0.5;
      this.mats[i].uniforms.time.value = this.t;
    }

    // embers rise and drift
    const attr = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.emberData.length; i++) {
      const e = this.emberData[i];
      e.life -= dt;
      if (e.life <= 0) {
        e.max = e.life = 0.8 + Math.random() * 1.6;
        attr.setXYZ(i, (Math.random() - 0.5) * 0.3, 0.3, (Math.random() - 0.5) * 0.3);
        e.vel.set((Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4);
      } else {
        e.vel.x += Math.sin(this.t * 3 + i) * dt * 0.6;
        attr.setXYZ(i, attr.getX(i) + e.vel.x * dt, attr.getY(i) + e.vel.y * dt, attr.getZ(i) + e.vel.z * dt);
      }
    }
    attr.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();

/**
 * A fixed pool of real PointLights, re-assigned every frame to the fires nearest the camera.
 * Keeps the shader light count constant (no recompiles) and the frame cost bounded,
 * while every fire still shows its flame and glow.
 */
export class LightPool {
  lights: THREE.PointLight[] = [];
  private tmp = new THREE.Vector3();
  constructor(scene: THREE.Scene, count: number, shadowCount: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xff8a3c, 0, 0, 2);
      if (i < shadowCount) {
        l.castShadow = true;
        l.shadow.mapSize.set(512, 512);
        l.shadow.bias = -0.003;
        l.shadow.normalBias = 0.06;
        l.shadow.camera.near = 0.4;
        l.shadow.camera.far = 30;
      }
      scene.add(l);
      this.lights.push(l);
    }
  }

  update(fires: Fire[], focus: THREE.Vector3) {
    const ranked = fires
      .filter((f) => f.lit)
      .map((f) => ({ f, d: f.lightWorldPos(this.tmp).distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const r = ranked[i];
      if (!r) {
        l.intensity = 0;
        continue;
      }
      r.f.lightWorldPos(l.position);
      // fade the farthest pooled lights so swaps are not visible
      const fade = i >= this.lights.length - 2 ? 0.6 : 1;
      l.intensity = r.f.intensity * fade;
    }
  }
}
