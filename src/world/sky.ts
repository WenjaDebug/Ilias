import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/** Night sky dome: blue-black zenith, ember-red glow at the horizon (the city's fires), stars, drifting fire-lit clouds and a veiled moon. */
export function createSky(moonDir: THREE.Vector3): THREE.Mesh {
  // the real night sky (Poly Haven HDRI, CC0) is blended in once loaded: stars and the Milky Way
  // from the scan, the city's ember glow and smoke from the shader
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { moonDir: { value: moonDir.clone().normalize() }, time: { value: 0 }, skyMap: { value: null as THREE.Texture | null }, skyMix: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 moonDir;
      uniform float time;
      uniform sampler2D skyMap;
      uniform float skyMix;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // night gradient: blue-black zenith, a smoky violet middle, the burning city's ember glow low down
        vec3 zenith = vec3(0.004, 0.006, 0.016);
        vec3 mid = vec3(0.020, 0.014, 0.024);
        vec3 horizon = vec3(0.21, 0.07, 0.022);
        float glow = 1.0 - smoothstep(-0.02, 0.22, h);
        vec3 col = mix(mid, horizon, glow);
        col = mix(col, zenith, smoothstep(0.18, 0.75, h));
        // stars and the Milky Way from the scanned sky, procedural pinpoints on top
        float starMask = smoothstep(0.04, 0.3, h);
        if (skyMix > 0.0) {
          vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, asin(clamp(h, -1.0, 1.0)) / 3.1415927 + 0.5);
          vec3 hdr = texture2D(skyMap, uv).rgb;
          col += hdr * 0.11 * skyMix * starMask;
        }
        vec3 sp = floor(d * 420.0);
        float s = hash(sp);
        float star = step(0.9978, s) * starMask * (0.65 + 0.35 * sin(time * 1.7 + s * 100.0));
        col += vec3(0.85, 0.82, 0.78) * star * 0.55;
        // the moon, half veiled
        float md = dot(d, moonDir);
        vec3 moon = vec3(0.75, 0.74, 0.78) * smoothstep(0.9993, 0.9996, md);
        vec3 halo = vec3(0.07, 0.07, 0.085) * pow(max(md, 0.0), 260.0) + vec3(0.03, 0.03, 0.04) * pow(max(md, 0.0), 18.0);
        // clouds: two drifting layers projected on a high ceiling; their bellies glow with the fires near
        // the horizon, their edges catch the moon, toward the zenith they are dark smoke against the stars
        float cover = 0.0;
        vec3 cloudCol = vec3(0.0);
        if (h > -0.02) {
          vec2 cp = d.xz / (h + 0.12);
          vec2 wind = vec2(time * 0.006, time * 0.0025);
          float n1 = fbm(cp * 0.55 + wind);
          float n2 = fbm(cp * 1.4 - wind * 1.6 + vec2(4.0, 2.0));
          float c = n1 * 0.75 + n2 * 0.35;
          cover = smoothstep(0.5, 0.82, c) * (1.0 - smoothstep(0.8, 1.0, h)) * smoothstep(-0.02, 0.06, h);
          float dens = smoothstep(0.55, 1.0, c);
          vec3 belly = mix(vec3(0.028, 0.026, 0.036), vec3(0.26, 0.09, 0.032), glow * 0.9 + 0.1 * (1.0 - h));
          vec3 lit = vec3(0.20, 0.20, 0.24) * pow(max(md, 0.0), 4.0) * (1.0 - dens * 0.6) + vec3(0.03, 0.03, 0.04) * (1.0 - dens);
          cloudCol = belly * (1.0 - dens * 0.55) + lit;
        }
        col = mix(col + moon + halo, cloudCol + halo * 0.5, cover);
        if (h < 0.0) col = mix(horizon, vec3(0.02, 0.008, 0.005), smoothstep(0.0, -0.15, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

/** load the HDRI and hand it to the sky shader and, prefiltered, to the scene as environment light */
export async function loadSkyMap(url: string, sky: THREE.Mesh, scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const tex = await new RGBELoader().loadAsync(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping;
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u.skyMap.value = tex;
  u.skyMix.value = 1;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.environmentIntensity = 0.04;
  pmrem.dispose();
}
