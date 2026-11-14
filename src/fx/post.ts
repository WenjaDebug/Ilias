import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Cinematic look: bloom on the fires, warm grading, vignette, subtle film grain and
 * chromatic fringe at the edges. Grading runs after tone mapping (OutputPass).
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    vignette: { value: 1.15 },
    grain: { value: 0.045 },
    damage: { value: 0 },
    fade: { value: 0 },
    aimZoom: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, vignette, grain, damage, fade, aimZoom;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + time * 7.13) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // slight chromatic aberration at the edges
      vec2 off = c * r2 * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // warm, crushed grade: lift shadows toward deep brown, push highlights to amber
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(0.040, 0.017, 0.011);
      vec3 hiTint = vec3(1.06, 0.92, 0.74);
      col = col * mix(vec3(1.0), hiTint, smoothstep(0.2, 0.9, l)) + shadowTint * (1.0 - smoothstep(0.0, 0.25, l));
      // gentle S-curve
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
      // vignette (stronger while aiming)
      float v = 1.0 - smoothstep(0.25, 0.85, sqrt(r2) * (vignette + aimZoom * 0.35));
      col *= mix(0.3, 1.0, v);
      // damage pulse
      col = mix(col, vec3(0.35, 0.0, 0.0), damage * (1.0 - v * 0.6) * 0.7);
      // film grain
      col += (rand(vUv * 1000.0) - 0.5) * grain;
      col *= 1.0 - fade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }
}
