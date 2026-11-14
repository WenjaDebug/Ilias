import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Fire } from '../fx/fire';

/**
 * Animated humanoid characters.
 *
 * Odysseus is the Meshy-generated rigged model (models/odysseus.glb + walk/run clips).
 * PLACEHOLDER BODY (guards): the rigged body comes from three.js' example "Soldier.glb"
 * (Idle / Walk / Run). It is re-coloured and dressed with procedurally built ancient gear
 * (round shields, spears, crested helmets, sword, bow). It will be replaced by our own
 * Meshy-generated Odysseus and Trojan guard models; the rest of the code only talks to
 * the Character class, so the swap is local to this file.
 */

let base: { scene: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

export async function loadCharacterBase(url: string, onProgress?: (p: number) => void) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  base = { scene: gltf.scene, animations: gltf.animations };
}

/** Meshy-generated Odysseus: rigged model (idle pose) + separately exported walk / run clips */
let hero: { scene: THREE.Group; animations: Record<'idle' | 'walk' | 'run', THREE.AnimationClip>; extra: Record<string, THREE.AnimationClip> } | null = null;

/** one-shot clips (Mixamo, converted with tools/blender/mixamo2glb.py to models/anim-<name>.glb) */
const EXTRA_CLIPS = ['attack', 'slash', 'attack2', 'block', 'blockidle', 'combatidle', 'crouchidle', 'sneak', 'roll', 'hit', 'death', 'death2', 'fall', 'draw', 'shoot', 'jump', 'climb', 'run2', 'death3', 'death4', 'swalk', 'sheathe', 'unsheathe', 'turn', 'walkstart', 'push', 'impact', 'impact2', 'drawarrow', 'aimhold', 'gslash', 'slash3', 'jog', 'stairs', 'takedown'];
/** clips that only drive the upper body (played over the gait, so the legs keep walking) */
const UPPER_CLIPS = new Set(['sheathe', 'unsheathe', 'drawarrow', 'aimhold']);
const UPPER_BONES = ['Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];
/** clips that cycle (locomotion-like) rather than play once */
const LOOP_CLIPS = new Set(['sneak', 'crouchidle', 'combatidle', 'blockidle', 'run2', 'swalk', 'push', 'jog', 'stairs']);

/** Meshy-generated Trojan guard (crested helmet, muscle cuirass, red chiton): same skeleton as Odysseus */
let guardBase: { scene: THREE.Group; animations: Record<'idle' | 'walk' | 'run', THREE.AnimationClip> } | null = null;
/** Helena (Meshy, same skeleton as the hero, so she moves with his clips) */
let helenaBase: THREE.Group | null = null;

export async function loadGuardBase(baseUrl: string, onProgress?: (p: number) => void) {
  const loader = new GLTFLoader();
  const parts = [`${baseUrl}guard.glb`, `${baseUrl}guard-walk.glb`, `${baseUrl}guard-run.glb`];
  const done = [0, 0, 0];
  const [model, walk, run] = await Promise.all(
    parts.map((u, i) =>
      loader.loadAsync(u, (e) => {
        if (e.total) {
          done[i] = e.loaded / e.total;
          onProgress?.((done[0] * 8 + done[1] + done[2]) / 10);
        }
      }),
    ),
  );
  const pick = (g: { animations: THREE.AnimationClip[] }) => g.animations[0];
  guardBase = { scene: model.scene, animations: { idle: pick(model), walk: pick(walk), run: pick(run) } };
}

export async function loadHelenaBase(baseUrl: string) {
  const g = await new GLTFLoader().loadAsync(`${baseUrl}helena.glb`);
  helenaBase = g.scene;
}

export async function loadHeroBase(baseUrl: string, onProgress?: (p: number) => void) {
  const loader = new GLTFLoader();
  const parts = [`${baseUrl}odysseus.glb`, `${baseUrl}odysseus-walk.glb`, `${baseUrl}odysseus-run.glb`];
  const done = [0, 0, 0];
  const [model, walk, run] = await Promise.all(
    parts.map((u, i) =>
      loader.loadAsync(u, (e) => {
        if (e.total) {
          done[i] = e.loaded / e.total;
          onProgress?.((done[0] * 8 + done[1] + done[2]) / 10);
        }
      }),
    ),
  );
  const pick = (g: { animations: THREE.AnimationClip[] }) => g.animations[0];
  const extra: Record<string, THREE.AnimationClip> = {};
  const results = await Promise.allSettled(EXTRA_CLIPS.map((n) => loader.loadAsync(`${baseUrl}anim-${n}.glb`)));
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const clip = pick(r.value);
    // rotations only: the hips stay where the locomotion put them, no root motion
    clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'Hips.position');
    // the jog and the stair run carry root motion (the hips travel forward / climb a flight): take out the
    // straight-line drift so the clip loops in place and only its bounce is left
    if (EXTRA_CLIPS[i] === 'jog' || EXTRA_CLIPS[i] === 'stairs') {
      for (const t of clip.tracks) {
        if (t.name !== 'Hips.position') continue;
        const n = t.times.length, T = t.times[n - 1] - t.times[0];
        for (let c = 0; c < 3; c++) {
          const d = t.values[(n - 1) * 3 + c] - t.values[c];
          for (let k = 0; k < n; k++) t.values[k * 3 + c] -= (d * (t.times[k] - t.times[0])) / (T || 1);
        }
      }
    }
    if (UPPER_CLIPS.has(EXTRA_CLIPS[i])) clip.tracks = clip.tracks.filter((t) => UPPER_BONES.some((b) => t.name === `${b}.quaternion`));
    clip.resetDuration();
    extra[EXTRA_CLIPS[i]] = clip;
  });
  hero = { scene: model.scene, animations: { idle: pick(model), walk: pick(walk), run: pick(run) }, extra };
}

export type Kind = 'odysseus' | 'guard' | 'captain' | 'greek' | 'helena' | 'hector';

const bronze = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, metalness: 0.85, roughness: 0.35 });
const darkBronze = new THREE.MeshStandardMaterial({ color: 0x4a3018, metalness: 0.8, roughness: 0.45 });
const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
const quiverMat = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.9 });
const fletchMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.8, emissive: 0x201a10 });
const leather = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.9 });
const crestMat = new THREE.MeshStandardMaterial({ color: 0x5a0e08, roughness: 1 });
const linen = new THREE.MeshStandardMaterial({ color: 0xa08868, roughness: 0.95, side: THREE.DoubleSide });
const steel = new THREE.MeshStandardMaterial({ color: 0x9a8a78, metalness: 0.9, roughness: 0.3 });
const linenWhite = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.95 });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 });
const skinOdysseus = 0x8a5a3e, skinGuard = 0x7e5238, skinCaptain = 0x946a4a;
const cloakMat = new THREE.MeshStandardMaterial({ color: 0x6a1410, roughness: 0.95, side: THREE.DoubleSide });
const greyHair = new THREE.MeshStandardMaterial({ color: 0x9a9088, roughness: 1 });
const gold = new THREE.MeshStandardMaterial({ color: 0xc8962a, metalness: 0.9, roughness: 0.3 });

/** quilted linen cuirass (linothorax) with a shoulder yoke, worn over the torso */
function linothorax(mat: THREE.Material, r = 0.215, h = 0.42) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, h, 16, 1, true), mat);
  // the quilting: a few horizontal bands
  for (let i = 0; i < 2; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * (1 - i * 0.03) + 0.002, 0.004, 4, 24), leather);
    band.rotation.x = Math.PI / 2;
    band.position.y = -h * 0.3 + i * h * 0.35;
    g.add(band);
  }
  for (const x of [-1, 1]) {
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.16), mat);
    yoke.position.set(x * 0.13, h * 0.5, 0.02);
    g.add(yoke);
  }
  g.add(body);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** leather strips hanging from the belt */
function pteruges(n = 12, r = 0.22, len = 0.26) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.075, len, 0.012), leather);
    strip.position.set(Math.sin(a) * r, -len / 2, Math.cos(a) * r);
    strip.rotation.y = a;
    strip.rotation.x = -0.12;
    strip.castShadow = true;
    g.add(strip);
  }
  const belt = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 24), leather);
  belt.rotation.x = Math.PI / 2;
  g.add(belt);
  return g;
}

function cuff(r: number, h: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, h, 12, 1, true), mat);
  m.castShadow = true;
  return m;
}

function beardAndHair(mat: THREE.Material = hairMat, beardLen = 0.09) {
  const g = new THREE.Group();
  const beard = new THREE.Mesh(new THREE.BoxGeometry(0.11, beardLen, 0.075), mat);
  beard.position.set(0, -0.03 - (beardLen - 0.09) / 2, 0.085);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
  hair.position.set(0, 0.055, -0.01);
  hair.scale.set(1, 0.9, 1.05);
  g.add(beard, hair);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** the red wool cloak of the gate captain (and Hector's long one), modelled in Blender (tools/blender/cloak.py) */
function woolCloak(long: boolean): THREE.Object3D {
  if (gear) return (long ? gear.cloakLong : gear.cloak).clone();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(long ? 0.7 : 0.62, long ? 1.25 : 0.95, 1, 3), cloakMat);
  m.castShadow = true;
  return m;
}

/** a readable face for a character without a helmet: eyes with whites, brows, a nose */
function face(browMat: THREE.Material) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: skinCaptain, roughness: 0.75 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), white);
    eye.position.set(sx * 0.037, 0.078, 0.118);
    eye.scale.set(1.25, 0.8, 0.6);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 6), dark);
    pupil.position.set(sx * 0.037, 0.076, 0.13);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.009, 0.014), browMat);
    brow.position.set(sx * 0.039, 0.108, 0.122);
    brow.rotation.z = sx * 0.18;
    g.add(eye, pupil, brow);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 5), skin);
  nose.rotation.x = Math.PI / 2 + 0.25;
  nose.position.set(0, 0.05, 0.14);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.03), skin);
  lid.position.set(0, 0.095, 0.12);
  g.add(nose, lid);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Odysseus' shield and sword modelled in Blender (tools/blender/gear.py → models/shield.glb, sword.glb) */
let gear: { shield: THREE.Group; sword: THREE.Group; helmet: THREE.Group; cloak: THREE.Group; cloakLong: THREE.Group } | null = null;

export async function loadGear(baseUrl: string) {
  const loader = new GLTFLoader();
  const [sh, sw, hm, ck, cl] = await Promise.all(['shield', 'sword', 'helmet', 'cloak', 'cloak_long'].map((n) => loader.loadAsync(`${baseUrl}${n}.glb`)));
  const prep = (g: THREE.Group) => {
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return g;
  };
  gear = { shield: prep(sh.scene), sword: prep(sw.scene), helmet: prep(hm.scene), cloak: prep(ck.scene), cloakLong: prep(cl.scene) };
}

/** Odysseus' hoplon: a bronze-faced round shield with a boar emblem and a meander (Greek key) rim */
function heroShield(r: number) {
  const g = new THREE.Group();
  g.userData.r = r / 0.34;
  if (gear) {
    // modelled face-up (Blender +Z → glTF +Y) at radius 0.34; the face points along +Z here
    const s = gear.shield.clone();
    s.rotation.x = Math.PI / 2;
    s.scale.setScalar(r / 0.34);
    g.add(s);
    return g;
  }
  const face = new THREE.MeshStandardMaterial({ color: 0x6a4420, metalness: 0.8, roughness: 0.4 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 0.07, 36), face);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  // slightly domed centre
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), face);
  dome.scale.set(1, 0.35, 1);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = 0.03 - r * 0.8 * 0.35 * 0.95;
  g.add(dome);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.028, 8, 40), bronze);
  g.add(rim);
  // meander: short raised bars alternating along the rim band
  const key: THREE.BufferGeometry[] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * 0.86;
    const seg = new THREE.BoxGeometry(0.022, r * 0.1, 0.012);
    seg.translate(0, rr, 0.045);
    seg.rotateZ(a);
    key.push(seg);
    const seg2 = new THREE.BoxGeometry(r * 0.12, 0.018, 0.012);
    seg2.translate(0, rr + (i % 2 ? 0.045 : -0.045), 0.045);
    seg2.rotateZ(a + Math.PI / n);
    key.push(seg2);
  }
  g.add(new THREE.Mesh(mergeGeometries(key), gold));
  for (const rr of [r * 0.74, r * 0.98]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.008, 6, 48), gold);
    ring.position.z = 0.042;
    g.add(ring);
  }
  // the boar: body, head with snout, ears, tusks, legs, bristle ridge – flat relief in bronze/gold
  const boar = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), gold);
  body.scale.set(1.5, 0.95, 0.35);
  boar.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), gold);
  head.scale.set(1.2, 1, 0.35);
  head.position.set(0.2, -0.015, 0);
  boar.add(head);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.09, 8), gold);
  snout.rotation.z = Math.PI / 2 + 0.3;
  snout.scale.set(1, 1, 0.5);
  snout.position.set(0.3, -0.05, 0);
  boar.add(snout);
  for (const [dx, dy] of [[0.26, -0.075], [0.3, -0.085]]) {
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.035, 5), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.5 }));
    tusk.position.set(dx, dy, 0.012);
    tusk.rotation.z = -0.6;
    boar.add(tusk);
  }
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 5), gold);
  ear.position.set(0.17, 0.07, 0);
  ear.rotation.z = -0.4;
  boar.add(ear);
  for (const [lx, lean] of [[-0.11, 0.35], [-0.05, -0.2], [0.07, 0.3], [0.13, -0.25]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.11, 6), gold);
    leg.position.set(lx, -0.13, 0);
    leg.rotation.z = lean;
    leg.scale.z = 0.5;
    boar.add(leg);
  }
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 4), gold);
    b.position.set(-0.14 + i * 0.045, 0.1 + Math.sin(i / 6 * Math.PI) * 0.03, 0);
    b.rotation.z = -0.3 + i * 0.05;
    boar.add(b);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 5, 10, Math.PI * 1.3), gold);
  tail.position.set(-0.19, 0.03, 0);
  boar.add(tail);
  boar.position.z = 0.075;
  boar.scale.setScalar(r / 0.34);
  g.add(boar);
  // inside: leather lining, arm band and hand grip
  const lining = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.01, 30), leather);
  lining.rotation.x = Math.PI / 2;
  lining.position.z = -0.04;
  g.add(lining);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function roundShield(r: number, mat: THREE.Material) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 28), mat);
  disc.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 28), bronze);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
  boss.rotation.x = Math.PI / 2;
  boss.position.z = 0.03;
  g.add(disc, rim, boss);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function spear() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 2.4, 6), wood);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.32, 6), steel);
  tip.position.y = 1.35;
  g.add(shaft, tip);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc4c0b4, metalness: 0.9, roughness: 0.25, emissive: 0x0c0a08 });
/** leaf-shaped bronze-age short sword (xiphos): blade with a midrib, bronze guard, wrapped grip, pommel */
function sword() {
  const g = new THREE.Group();
  if (gear) {
    g.add(gear.sword.clone());
    return g;
  }
  // blade outline (half, mirrored) – widest a third up, tapering to the point
  const pts: [number, number][] = [[0.012, 0], [0.026, 0.05], [0.034, 0.16], [0.028, 0.32], [0.016, 0.41], [0, 0.47]];
  const shape = new THREE.Shape();
  shape.moveTo(-pts[0][0], 0);
  for (const [x, y] of pts) shape.lineTo(x, y);
  for (let i = pts.length - 2; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.012, bevelSegments: 2 });
  bladeGeo.translate(0, 0.09, -0.002);
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  // a raised midrib down the blade, both sides
  for (const sz of [-1, 1]) {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.009, 0.36, 5), bladeMat);
    rib.position.set(0, 0.28, sz * 0.006);
    rib.scale.z = 0.5;
    g.add(rib);
  }
  // crossguard: a bronze bar with volutes curling at the ends, and a flared bronze collar
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.016, 0.022), gold);
  guard.position.y = 0.085;
  for (const sx of [-1, 1]) {
    const vol = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.004, 5, 10), gold);
    vol.position.set(sx * 0.047, 0.09, 0);
    g.add(vol);
  }
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.013, 0.02, 10), bronze);
  collar.position.y = 0.1;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.45 }));
  grip.position.y = 0.035;
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0145, 0.0025, 4, 12), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.012 + i * 0.026;
    g.add(ring);
  }
  // a lobed bronze pommel with a rivet
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), gold);
  pommel.scale.set(1.3, 0.6, 0.8);
  pommel.position.y = -0.012;
  const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 5), bronze);
  rivet.position.y = -0.027;
  g.add(blade, guard, collar, grip, pommel, rivet);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** a closed fist (the Meshy rig has no finger bones): replaces the flat hand when gripping */
const fistSkin = new THREE.MeshStandardMaterial({ color: 0xb4836a, roughness: 0.75 });
function fist(mirror: number) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), fistSkin);
  palm.scale.set(1.0, 0.95, 0.8);
  palm.position.y = 0.04;
  g.add(palm);
  // knuckle ridge on the back of the hand
  for (let i = 0; i < 4; i++) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), fistSkin);
    k.position.set((i - 1.5) * 0.02, 0.07, -0.012);
    g.add(k);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 3, 6), fistSkin);
  thumb.position.set(mirror * 0.04, 0.045, 0.02);
  thumb.rotation.z = mirror * 0.9;
  g.add(thumb);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** pull the string of a bowMesh() back by `d` (0 = slack, 1 = full draw, ~0.5 m) */
export function setBowDraw(bow: THREE.Object3D, d: number) {
  const s = bow.getObjectByName('string');
  if (!s) return;
  const back = d * 0.52;
  const len = Math.hypot(0.6, back);
  const ang = Math.atan2(back, 0.6);
  s.children.forEach((h, i) => {
    h.scale.y = len;
    h.rotation.x = (i === 0 ? Math.PI : 0) + (i === 0 ? ang : -ang);
  });
}

export function bowMesh() {
  const g = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, 0, 0.32), new THREE.Vector3(0, 0.6, 0));
  const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 5), wood);
  // the string is two halves meeting at the nock, so it folds into a V when drawn (see setBowDraw)
  const string = new THREE.Group();
  string.name = 'string';
  for (const sgn of [1, -1]) {
    const half = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 3), linen);
    half.geometry.translate(0, 0.5, 0);
    half.position.y = sgn * 0.6;
    half.scale.y = 0.6;
    half.rotation.x = sgn > 0 ? Math.PI : 0;
    string.add(half);
  }
  g.add(limb, string);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** a leather quiver with a few arrows showing, worn on the back */
export function quiverMesh(arrows = 4) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.5, 10, 1), quiverMat);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 6, 12), bronze);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.25;
  g.add(tube, lip);
  for (let i = 0; i < arrows; i++) {
    const a = (i / arrows) * Math.PI * 2;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.32, 4), wood);
    shaft.position.set(Math.cos(a) * 0.025, 0.36, Math.sin(a) * 0.025);
    const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.004), fletchMat);
    fletch.position.set(Math.cos(a) * 0.025, 0.47, Math.sin(a) * 0.025);
    fletch.rotation.y = a;
    g.add(shaft, fletch);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** a small bundle of arrows lying on the ground (dropped by a dead guard) */
export function arrowBundleMesh(n: number) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 4), wood);
    shaft.rotation.z = Math.PI / 2;
    shaft.rotation.y = (i - (n - 1) / 2) * 0.18;
    shaft.position.set(0, 0.02, i * 0.04);
    const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.004), fletchMat);
    fletch.position.set(-0.3, 0.035, i * 0.04);
    fletch.rotation.y = shaft.rotation.y;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4), bronze);
    head.rotation.z = -Math.PI / 2;
    head.position.set(0.37, 0.02, i * 0.04);
    g.add(shaft, fletch, head);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function helmet(crest: boolean) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), bronze);
  dome.scale.set(1, 1.15, 1.12);
  const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.14, 0.12, 14, 1, true, Math.PI * 0.35, Math.PI * 1.3), bronze);
  cheek.position.y = -0.06;
  g.add(dome, cheek);
  if (crest) {
    // horsehair brush: short tufts following the dome from brow to nape, longer at the back
    for (let i = 0; i < 9; i++) {
      const a = -0.35 + (i / 8) * 1.75; // angle from the front over the top to the back
      const h = 0.06 + i * 0.012;
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.05), crestMat);
      const r = 0.165;
      tuft.position.set(0, Math.cos(a) * r * 1.15 + h * 0.45, -Math.sin(a) * r * 1.1);
      tuft.rotation.x = a * 0.9;
      g.add(tuft);
    }
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function kilt(color: number) {
  const m = linen.clone();
  m.color.setHex(color);
  const k = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.38, 14, 1, true), m);
  k.castShadow = true;
  return k;
}

export type MoveAnim = 'idle' | 'walk' | 'run' | 'sprint' | 'sneak' | 'crouchidle' | 'blockidle' | 'swalk' | 'combatidle' | 'push' | 'stairs';
/** what to play when a rig lacks one of the extra loops */
const FALLBACK: Record<MoveAnim, 'idle' | 'walk' | 'run'> = { idle: 'idle', walk: 'walk', run: 'run', sprint: 'run', sneak: 'walk', crouchidle: 'idle', blockidle: 'idle', swalk: 'walk', combatidle: 'idle', push: 'walk', stairs: 'run' };
export type AttackKind = 'overhead' | 'slash' | 'thrust';

/** direction of a limb in character space (+Z forward, +Y up); x is multiplied by the right-hand sign */
type Dir = [number, number, number];
interface ArmPose {
  upper: Dir;
  fore: Dir;
  hand: Dir;
}
const ARM_IDLE: ArmPose = { upper: [0.12, -0.95, 0.05], fore: [0.05, -0.95, 0.2], hand: [0, -0.9, 0.4] };
const POSES: Record<AttackKind, { windup: ArmPose; strike: ArmPose; follow: ArmPose; twist: [number, number, number]; lean: [number, number, number]; off: ArmPose }> = {
  // sword raised high behind the head, cut down and across to the left hip, body folding forward
  overhead: {
    windup: { upper: [0.55, 0.6, -0.5], fore: [0.05, 0.9, -0.4], hand: [-0.25, 0.8, -0.5] },
    strike: { upper: [0.1, -0.3, 0.95], fore: [-0.2, -0.3, 0.9], hand: [-0.35, -0.5, 0.75] },
    follow: { upper: [-0.3, -0.75, 0.55], fore: [-0.65, -0.55, 0.5], hand: [-0.75, -0.5, 0.4] },
    twist: [0.5, -0.45, -0.75],
    lean: [-0.15, 0.3, 0.45],
    off: { upper: [0.55, -0.45, 0.45], fore: [0.2, 0.1, 0.95], hand: [0.1, 0.2, 0.95] },
  },
  // horizontal cut: wound up over the right shoulder, swept across, ending far on the left
  slash: {
    windup: { upper: [0.9, 0.15, -0.4], fore: [0.65, 0.45, -0.6], hand: [0.55, 0.3, -0.75] },
    strike: { upper: [0.35, -0.1, 0.9], fore: [0.05, 0.05, 1], hand: [-0.1, 0.05, 1] },
    follow: { upper: [-0.7, -0.25, 0.65], fore: [-0.9, -0.1, 0.4], hand: [-0.95, -0.1, 0.3] },
    twist: [0.7, -0.3, -0.85],
    lean: [-0.05, 0.2, 0.3],
    off: { upper: [0.6, -0.5, 0.35], fore: [0.3, -0.1, 0.95], hand: [0.2, 0, 1] },
  },
  // spear pulled back past the hip, driven forward, arm fully extended
  thrust: {
    windup: { upper: [0.6, -0.4, -0.65], fore: [0.3, -0.15, -0.95], hand: [0.1, 0.05, -1] },
    strike: { upper: [0.25, -0.3, 0.92], fore: [0, -0.05, 1], hand: [0, 0.05, 1] },
    follow: { upper: [0.15, -0.2, 0.97], fore: [-0.05, 0, 1], hand: [-0.05, 0.05, 1] },
    twist: [0.35, -0.55, -0.6],
    lean: [-0.15, 0.3, 0.35],
    off: { upper: [0.7, -0.55, 0.3], fore: [0.3, -0.2, 0.9], hand: [0.2, -0.1, 0.95] },
  },
};

const easeOutQ = (t: number) => 1 - (1 - t) * (1 - t);
const easeInQ = (t: number) => t * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

const _shScale = new THREE.Vector3();

export class Character {
  readonly root = new THREE.Group(); // positioned at the feet, yaw applied here
  readonly body: THREE.Object3D; // the skinned model (for poses like lying down)
  readonly mixer: THREE.AnimationMixer;
  private actions: Partial<Record<MoveAnim, THREE.AnimationAction>> & Record<'idle' | 'walk' | 'run', THREE.AnimationAction>;
  /** one-shot clip actions (hero only) and the one currently playing */
  private clips: Record<string, THREE.AnimationAction> = {};
  private oneShot: { action: THREE.AnimationAction; end: number; hold: boolean; name: string } | null = null;
  /** an upper-body clip (sheathing the sword …) blended over the gait */
  private upperShot: { action: THREE.AnimationAction; end: number; name: string } | null = null;
  /** 1 while the bow is carried in the left hand without aiming (the arm hangs out a little so the bow clears the body) */
  carryBow = 0;
  /** the guard's loose gear, laid on the ground when he dies */
  private spear: THREE.Object3D | null = null;
  private shieldObj: THREE.Object3D | null = null;
  private gearDropped = false;
  private shieldOnBack: THREE.Object3D | null = null;
  private current: MoveAnim = 'idle';
  private bones: Record<string, THREE.Bone> = {};
  // procedural overlays, 0..1
  crouch = 0;
  aim = 0; // bow raised
  draw = 0; // bow string pulled
  /** where the arrow goes (world, unit) – the player sets it from the camera while aiming */
  readonly aimDir = new THREE.Vector3(0, 0, 1);
  /** how far the Mixamo draw clip has come: from the quiver (BOW_START) to the arrow on the string
   *  (BOW_NOCKED) to full draw (1) */
  private bowPhase = BOW_START;
  private bowHold = 0;
  private lastRecoil = 0;
  attack = 0; // sword swing phase (0 = none, 0..1 runs the swing)
  attackKind: AttackKind = 'overhead';
  block = 0;
  flinch = 0; // 1 right after being hit, decays
  lie = 0; // 0 standing, 1 lying on the ground (sleep / dead)
  lieSide = 1;
  /** head turned toward something (radians, relative to the body) */
  lookYaw = 0;
  lookPitch = 0;
  /** body lean while turning (radians, positive = leaning to the character's left) */
  lean = 0;
  /** airborne (jump / fall): legs tucked, arms out */
  air = 0;
  /** hanging on a rope, climbing down hand over hand (phase advances with ropePhase) */
  ropeHang = 0;
  ropePhase = 0;
  /** world-space grip points while on the rope: hands on the rope, feet pinching it */
  ropeGrip: { hands: [THREE.Vector3, THREE.Vector3]; feet: [THREE.Vector3, THREE.Vector3] } | null = null;
  bow: THREE.Group | null = null;
  private bowOnBack: THREE.Group | null = null;
  private swordInHand: THREE.Group | null = null;
  private swordOnHip: THREE.Group | null = null;
  /** closed fists (hero only): shown instead of the open hand while gripping sword / rope */
  private fists: Partial<Record<'Left' | 'Right', THREE.Group>> = {};
  fistLeft = false;
  fistRight = false;
  /** climbing over a ledge: 0..1 progress (0 = none) */
  mantle = 0;
  private mantleDip = 0;
  /** right hand flung back after the bow string is released; decays */
  bowRecoil = 0;
  readonly headHeight = 1.65;
  /** +1 if the character's right hand is at +X in root space, -1 otherwise */
  /** +1 or −1: the sign of the character's right in root space (model rest orientation) */
  rs = 1;
  /** true when the body is the Meshy Odysseus (it already wears its own armour) */
  private hero = false;
  /** a Meshy-rigged body (Odysseus or the Trojan guard) rather than the Soldier placeholder */
  private meshy = false;
  /** ground speed at which the run clip's feet don't slide */
  private natRun = 2.7;
  private natSprint = 2.6;
  private hipAvg: number | null = null;
  private clock = 0;
  /** pure mixer pose of every bone, restored before the next mixer step (overlays never accumulate) */
  private snapshot: { bone: THREE.Bone; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];

  constructor(readonly kind: Kind, readonly variant = 0) {
    if (!base) throw new Error('character base not loaded');
    const useHero = (kind === 'odysseus' || kind === 'greek') && hero !== null;
    const useHelena = kind === 'helena' && helenaBase !== null && hero !== null;
    const useGuard = !useHero && !useHelena && kind !== 'odysseus' && kind !== 'greek' && kind !== 'helena' && guardBase !== null;
    const meshy = useHero || useGuard || useHelena;
    this.hero = useHero;
    this.meshy = meshy;
    const model = SkeletonUtils.clone(useHero ? hero!.scene : useHelena ? helenaBase! : useGuard ? guardBase!.scene : base.scene) as THREE.Group;
    this.body = model;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        if (useHero) {
          const hm = kind === 'greek' ? (m.material as THREE.MeshStandardMaterial).clone() : (m.material as THREE.MeshStandardMaterial);
          hm.side = THREE.FrontSide;
          hm.envMapIntensity = 1;
          if (kind === 'greek') {
            // the Achaeans wear the hero's cut in other, dustier linen: grey-white, ochre, faded blue
            const tints = [0xbcb8b0, 0xd0b070, 0x8898b0, 0xc8b8a0];
            hm.color.setHex(tints[variant % tints.length]);
            m.material = hm;
          }
        } else if (useHelena) {
          const hm = m.material as THREE.MeshStandardMaterial;
          hm.side = THREE.FrontSide;
          hm.envMapIntensity = 1;
        } else if (useGuard) {
          // every guard gets his own tint so a squad doesn't look cloned: chiton and bronze vary a little
          const hm = (m.material as THREE.MeshStandardMaterial).clone();
          hm.side = THREE.FrontSide;
          hm.envMapIntensity = 1;
          const tints = [0xffffff, 0xd8ccc0, 0xe8d2b8, 0xc8c4c8];
          hm.color.setHex(kind === 'captain' ? 0xe0c8a0 : kind === 'hector' ? 0xf4dca8 : tints[variant % tints.length]);
          m.material = hm;
        } else if (o.name.includes('visor')) o.visible = false;
        else {
          // the placeholder's sci-fi armour texture is dropped: plain skin, the gear is built on top
          const src = m.material as THREE.MeshStandardMaterial;
          const mat = src.clone();
          mat.map = null;
          mat.color.setHex(kind === 'odysseus' ? skinOdysseus : kind === 'captain' ? skinCaptain : skinGuard);
          mat.roughness = 0.85;
          mat.metalness = 0;
          m.material = mat;
        }
      }
      if ((o as THREE.Bone).isBone) this.bones[o.name.replace('mixamorig', '').replace(':', '')] = o as THREE.Bone;
    });
    if (meshy) {
      // Meshy skeleton: Hips > Spine02 > Spine01 > Spine > (neck, shoulders) – the spine names run
      // upside down compared with Mixamo, so map them to the names the rest of this file uses
      const raw = { ...this.bones };
      this.bones.Spine = raw.Spine02;
      this.bones.Spine1 = raw.Spine01;
      this.bones.Spine2 = raw.Spine;
      this.bones.Neck = raw.neck;
    }
    // the placeholder faces -Z (turn it so the character faces +Z at yaw 0); the Meshy model already faces +Z
    model.rotation.y = meshy ? 0 : Math.PI;
    const holder = new THREE.Group();
    holder.add(model);
    this.root.add(holder);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => base!.animations.find((a) => a.name === n)!;
    // the Meshy guard shares the Odysseus skeleton, so he moves with the hero's clips (the guard's own
    // walk/run cycles from Meshy looked mechanical next to them)
    const meshyAnims = useHero || useHelena ? hero!.animations : useGuard ? (hero ? hero.animations : guardBase!.animations) : null;
    this.actions = meshyAnims
      ? {
          idle: this.mixer.clipAction(meshyAnims.idle),
          walk: this.mixer.clipAction(meshyAnims.walk),
          run: this.mixer.clipAction(meshyAnims.run),
        }
      : {
          idle: this.mixer.clipAction(clip('Idle')),
          walk: this.mixer.clipAction(clip('Walk')),
          run: this.mixer.clipAction(clip('Run')),
        };
    for (const a of Object.values(this.actions)) {
      a.play();
      a.setEffectiveWeight(0);
    }
    // the Mixamo clips were retargeted to the Odysseus rig; the guard's rest pose differs by a few degrees only
    if (meshy && hero) {
      for (const [n, clip] of Object.entries(hero.extra)) {
        const a = this.mixer.clipAction(clip);
        if (LOOP_CLIPS.has(n)) {
          a.play();
          a.setEffectiveWeight(0);
          if (n === 'sneak' || n === 'crouchidle' || n === 'blockidle' || n === 'swalk' || n === 'combatidle' || n === 'push' || n === 'stairs') this.actions[n] = a;
        } else {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
        }
        this.clips[n] = a;
      }
    }
    // measured stance speeds of the feet (clipspeed): Meshy walk 1.5 m/s, Meshy run 5.2 m/s,
    // Mixamo Sword and Shield Run 3.6 m/s, Sword and Shield Walk 1.25 m/s. The Meshy run is a
    // flat-out sprint, so it is the sprint; the Mixamo run is the everyday run. Each clip plays
    // near its own rate, otherwise the feet slide and the stride reads as stomping in place.
    if (meshy) this.natRun = 5.2;
    if (meshy && this.clips.run2) {
      this.actions.sprint = this.actions.run;
      this.actions.run = this.clips.run2;
      this.natRun = 3.6;
      this.natSprint = 5.2;
    }
    // the Mixamo jog (stance speed 2.3 m/s) is the everyday run of Odysseus and every soldier
    if (meshy && this.clips.jog) {
      this.actions.run = this.clips.jog;
      this.natRun = 2.3;
    }
    this.actions.idle.setEffectiveWeight(1);
    this.mixer.update(Math.random() * 3);

    // which way is "right" in root space (depends on the model's rest orientation)
    this.root.updateWorldMatrix(true, true);
    const ra = this.bones.RightArm, la = this.bones.LeftArm;
    if (ra && la) {
      const r = ra.getWorldPosition(new THREE.Vector3()), l = la.getWorldPosition(new THREE.Vector3());
      this.rs = r.x - l.x >= 0 ? 1 : -1;
    }

    this.dress();
  }

  private attach(boneName: string, obj: THREE.Object3D, pos: [number, number, number], rot: [number, number, number]) {
    const bone = this.bones[boneName];
    if (!bone) return;
    bone.add(obj);
    // bones live in centimetre space (scale 0.01 on the model root) – compensate
    obj.scale.setScalar(100);
    obj.position.set(pos[0] * 100, pos[1] * 100, pos[2] * 100);
    obj.rotation.set(rot[0], rot[1], rot[2]);
  }

  /**
   * Attach `obj` to a bone with its orientation given in character space (x right, y up, z forward,
   * at the rest pose): `objA` (object local axis) is turned onto `worldA`, `objB` as close as possible
   * onto `worldB`; `offset` is in character space too (metres). Independent of the rig's bone axes.
   */
  private attachOriented(boneName: string, obj: THREE.Object3D, offset: Dir, objA: Dir, worldA: Dir, objB: Dir, worldB: Dir) {
    const bone = this.bones[boneName];
    if (!bone) return;
    this.root.updateWorldMatrix(true, true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const toW = (d: Dir) => new THREE.Vector3(d[0] * this.rs, d[1], d[2]).applyQuaternion(rootQ);
    const basis = (a: THREE.Vector3, b: THREE.Vector3) => {
      const x = a.clone().normalize();
      const z = new THREE.Vector3().crossVectors(x, b).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      return new THREE.Matrix4().makeBasis(x, y, z);
    };
    const want = basis(toW(worldA), toW(worldB)); // world frame
    const have = basis(new THREE.Vector3(...objA), new THREE.Vector3(...objB)); // object frame
    const worldRot = new THREE.Quaternion().setFromRotationMatrix(want.multiply(have.invert()));
    const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
    bone.add(obj);
    obj.scale.setScalar(100);
    obj.quaternion.copy(boneQ.clone().invert().multiply(worldRot));
    obj.position.copy(toW(offset).applyQuaternion(boneQ.clone().invert()).multiplyScalar(100));
  }

  private dress() {
    if ((this.kind === 'odysseus' || this.kind === 'greek') && this.hero) {
      // the model brings armour, beard and greaves; only the gear that changes is added
      for (const side of ['Left', 'Right'] as const) {
        const f = fist(side === 'Left' ? -1 : 1);
        // sits where the hand bone is (forearm length), oriented with the forearm
        const len = this.bones[side + 'Hand']?.position.y ?? 25;
        this.attach(side + 'ForeArm', f, [0, len / 100 - 0.01, 0], [0, 0, 0]);
        f.visible = false;
        this.fists[side] = f;
      }
      this.swordInHand = sword();
      // the grip lies across the fist, the blade pointing out past the thumb
      this.fists.Right!.add(this.swordInHand);
      this.swordInHand.position.set(0, 0.04, 0.0);
      this.swordInHand.rotation.set(0.75, 0, 0);
      this.swordOnHip = sword();
      this.attach('Hips', this.swordOnHip, [0.21, -0.03, -0.07], [Math.PI * 0.96, 0.2, 0.4]);
      this.swordOnHip.visible = false;
      this.shieldOnBack = heroShield(0.34);
      this.attach('Spine1', this.shieldOnBack, [0, 0.02, -0.19], [0, Math.PI, 0]);
      this.shieldObj = heroShield(0.36);
      // held a hand's width off the forearm so the closed fist sits behind the grip, not through the face
      this.attachOriented('LeftForeArm', this.shieldObj, [-0.17, -0.12, 0.055], [0, 0, 1], [-1, 0, 0.35], [0, 1, 0], [0, 1, 0]);
      this.shieldObj.visible = false;
      this.bowOnBack = bowMesh();
      this.bowOnBack.visible = false;
      this.attach('Spine1', this.bowOnBack, [0.05, 0.05, -0.16], [0, 0, 0.6]);
      if (this.kind === 'greek') {
        // a Greek soldier: bronze Corinthian helmet (Blender), sword drawn, shield on the arm
        if (gear) {
          const helm = gear.helmet.clone();
          this.attachOriented('Head', helm, [0, 0.085, 0.015], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 1]);
        }
        this.fistRight = true;
        this.fistLeft = true;
        this.setSword(true);
      }
    } else if (this.kind === 'odysseus') {
      this.attach('RightHand', sword(), [0, 0.08, 0.02], [0, 0, 0]);
      const sh = heroShield(0.34);
      this.attach('Spine2', sh, [0, 0.0, -0.17], [0, Math.PI, 0]);
      this.attach('Spine1', linothorax(linenWhite), [0, 0.1, 0.01], [0, 0, 0]);
      this.attach('Hips', pteruges(), [0, 0.02, 0], [0, 0, 0]);
      this.attach('Hips', kilt(0x9a8060), [0, -0.12, 0], [0, 0, 0]);
      this.attach('Head', beardAndHair(), [0, 0.06, 0.01], [0, 0, 0]);
      for (const side of ['Left', 'Right']) {
        this.attach(side + 'ForeArm', cuff(0.062, 0.15, bronze), [0, 0.15, 0], [0, 0, 0]);
        this.attach(side + 'Leg', cuff(0.095, 0.28, bronze), [0, 0.24, 0], [0, 0, 0]);
      }
      // bow slung across the back once picked up
      this.bowOnBack = bowMesh();
      this.bowOnBack.visible = false;
      this.attach('Spine1', this.bowOnBack, [0.05, 0.05, -0.16], [0, 0, 0.6]);
    } else if (this.kind === 'helena') {
      /* she wears what Meshy gave her; nothing to add */
    } else if (this.kind === 'captain' && !this.meshy) {
      // the captain: no helmet but a gold band, grey beard, bronze muscle cuirass, red cloak, sword
      this.body.scale.multiplyScalar(1.06);
      this.attach('Head', beardAndHair(greyHair, 0.16), [0, 0.06, 0.01], [0, 0, 0]);
      this.attach('Head', face(greyHair), [0, 0.06, 0.01], [0, 0, 0]);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 6, 20), gold);
      band.rotation.x = Math.PI / 2;
      this.attach('Head', band, [0, 0.1, 0], [0, 0, 0]);
      this.attach('Spine1', linothorax(bronze, 0.225, 0.42), [0, 0.1, 0.01], [0, 0, 0]);
      this.attach('Hips', pteruges(12, 0.23, 0.26), [0, 0.02, 0], [0, 0, 0]);
      this.attach('Hips', kilt(0x3a1410), [0, -0.12, 0], [0, 0, 0]);
      this.attach('Spine1', woolCloak(false), [0, -0.2, -0.2], [0.12, 0, 0]);
      this.attach('RightHand', sword(), [0, 0.08, 0.02], [0, 0, 0]);
      for (const side of ['Left', 'Right']) this.attach(side + 'Leg', cuff(0.095, 0.26, bronze), [0, 0.24, 0], [0, 0, 0]);
    } else if (this.meshy) {
      // the Meshy guard brings helmet, cuirass, chiton and greaves; the captain is a head taller
      if (this.kind === 'hector') {
        // Hector: a head taller than any guard, a long crimson cloak, sword and the great round shield
        this.body.scale.multiplyScalar(1.12);
        this.attachOriented('Spine1', woolCloak(true), [0, -0.4, -0.2], [0, 1, 0], [0, 1, -0.1], [0, 0, 1], [0, 0, -1]);
        const blade = sword();
        this.spear = blade;
        this.attachOriented('RightHand', blade, [0.02, -0.05, 0.04], [0, 1, 0], [0.1, -1, 0.45], [0, 0, 1], [1, 0, 0]);
        // the sword hangs sheathed at his hip until he draws it before the duel (Mixamo unsheathe)
        this.swordInHand = blade;
        this.swordOnHip = sword();
        this.attach('Hips', this.swordOnHip, [0.21, -0.03, -0.07], [Math.PI * 0.96, 0.2, 0.4]);
        this.swordOnHip.visible = false;
        this.shieldObj = heroShield(0.5);
        this.attachOriented('LeftForeArm', this.shieldObj, [-0.1, -0.12, 0.03], [0, 0, 1], [-1, 0, 0.35], [0, 1, 0], [0, 1, 0]);
      } else if (this.kind === 'captain') {
        this.body.scale.multiplyScalar(1.06);
        this.attachOriented('Spine1', woolCloak(false), [0, -0.25, -0.2], [0, 1, 0], [0, 1, -0.12], [0, 0, 1], [0, 0, -1]);
        this.spear = sword();
        this.attachOriented('RightHand', this.spear, [0.02, -0.05, 0.04], [0, 1, 0], [0.1, -1, 0.45], [0, 0, 1], [1, 0, 0]);
      } else {
        // spear upright in the right fist, the shield on the left forearm facing outward
        this.spear = spear();
        this.shieldObj = heroShield(0.42);
        this.attachOriented('RightHand', this.spear, [0.03, 0.0, 0.05], [0, 1, 0], [0, 1, 0.04], [0, 0, 1], [0, 0, 1]);
        this.attachOriented('LeftForeArm', this.shieldObj, [-0.1, -0.12, 0.03], [0, 0, 1], [-1, 0, 0.35], [0, 1, 0], [0, 1, 0]);
      }
    } else {
      this.attach('Head', helmet(true), [0, 0.09, 0.01], [0, 0, 0]);
      this.attach('RightHand', spear(), [0, 0.05, 0.02], [0, 0, 0]);
      const sh = roundShield(0.45, darkBronze);
      this.attach('LeftForeArm', sh, [0, 0.12, 0.1], [Math.PI / 2, 0, 0]);
      // bronze cuirass; tunic colour varies a little from guard to guard
      this.attach('Spine1', linothorax(this.variant % 3 === 0 ? bronze : darkBronze, 0.22, 0.4), [0, 0.1, 0.01], [0, 0, 0]);
      this.attach('Hips', pteruges(10, 0.23, 0.22), [0, 0.02, 0], [0, 0, 0]);
      const tunics = [0x4a1a12, 0x3a2a1a, 0x5a2416, 0x2e2a2a];
      this.attach('Hips', kilt(tunics[this.variant % tunics.length]), [0, -0.12, 0], [0, 0, 0]);
      for (const side of ['Left', 'Right']) this.attach(side + 'Leg', cuff(0.095, 0.26, darkBronze), [0, 0.24, 0], [0, 0, 0]);
    }
  }

  /**
   * The shield carried on the arm as a bounding sphere in world space (centre written to `out`);
   * returns its radius, 0 when no shield is in hand. Used to keep two fighters' shields from
   * passing through each other.
   */
  shieldSphere(out: THREE.Vector3): number {
    const s = this.shieldObj;
    if (!s || !s.visible || this.gearDropped || !s.parent) return 0;
    s.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(s.matrixWorld);
    const scale = _shScale.setFromMatrixScale(s.matrixWorld).x;
    return 0.34 * scale * (s.userData.r ?? 1);
  }

  /** the dead guard's spear and shield slip out of his hands and lie on the ground beside him */
  /**
   * Dropped gear comes to rest on the ground under it, never in it (a shield that fell onto a kerb or
   * a step); `groundAt` gives the floor height at a point.
   */
  settleGear(groundAt: (x: number, z: number) => number) {
    if (!this.gearDropped) return;
    this.root.updateWorldMatrix(true, true);
    for (const o of [this.shieldObj, this.spear]) {
      if (!o || o.parent !== this.root || !o.visible) continue;
      _box.setFromObject(o);
      const c = _box.getCenter(_v6);
      const lift = groundAt(c.x, c.z) + 0.01 - _box.min.y;
      if (Math.abs(lift) > 0.003) o.position.y += lift;
    }
  }

  dropGear() {
    if (this.gearDropped) return;
    this.gearDropped = true;
    const side = this.rs;
    if (this.shieldObj) {
      this.root.attach(this.shieldObj);
      this.shieldObj.position.set(-side * 0.75, 0.035, 0.25 + Math.random() * 0.3);
      this.shieldObj.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2); // face up, flat on its rim
    }
    if (this.spear) {
      this.root.attach(this.spear);
      this.spear.position.set(side * (0.55 + Math.random() * 0.2), 0.03, -0.3);
      this.spear.rotation.set(Math.PI / 2 - 0.02, (Math.random() - 0.5) * 0.8, 0);
    }
  }

  /** freeze the figure in a frame of a clip (statues) */
  freezePose(clip: string, time: number) {
    if (!this.playClip(clip, 1, true)) return;
    for (let t = 0; t < time; t += 1 / 30) this.update(1 / 30);
  }

  /** a burning hand torch in the left hand; the Fire is returned so the level can light it */
  addQuiver() {
    this.attach('Spine1', quiverMesh(), [0.13, -0.04, -0.14], [0.35, 0, -0.35]);
  }

  addTorch() {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.55, 6), wood);
    stick.castShadow = true;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.12, 8), leather);
    head.position.y = 0.3;
    const g = new THREE.Group();
    g.add(stick, head);
    g.name = 'torch';
    this.attach('LeftHand', g, [0, 0.12, 0.03], [0, 0, 0]);
    const fire = new Fire(0.4, 18);
    fire.shootable = true;
    return fire;
  }

  /** world position of the torch flame (for its Fire, which lives in the scene) */
  torchWorldPos(out: THREE.Vector3) {
    const t = this.bones.LeftHand?.getObjectByName('torch');
    if (!t) return out.copy(this.root.position);
    return t.localToWorld(out.set(0, 0.0038, 0)); // 0.38 m up the stick, in its (×100) local space
  }

  /** sword in the fist or hanging at the hip (hero only) */
  setSword(inHand: boolean) {
    if (!this.swordInHand || !this.swordOnHip) return;
    this.swordInHand.visible = inHand;
    this.swordOnHip.visible = !inHand;
    // the shield comes off the back with the sword and is carried on the left arm
    if (this.shieldOnBack && this.shieldObj && !this.gearDropped) {
      this.shieldOnBack.visible = !inHand;
      this.shieldObj.visible = inHand;
    }
  }

  /** show the bow in the left hand (aiming) or on the back */
  setBow(have: boolean, inHand: boolean) {
    if (!this.bowOnBack) return;
    if (!this.bow) {
      this.bow = bowMesh();
      if (this.fists.Left) {
        // gripped in the left fist like the sword: limbs across the forearm, belly toward the target
        this.fists.Left.add(this.bow);
        this.bow.position.set(0, 0.04, 0);
        this.bow.quaternion.copy(_qBowCarry);
      } else this.attach('LeftHand', this.bow, [0, 0.08, 0.02], [0, Math.PI / 2, 0]);
    }
    this.bowOnBack.visible = have && !inHand;
    this.bow.visible = have && inHand;
  }

  /** world position of a bone (for resting a body on the ground); null when the rig lacks it */
  boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 | null {
    const b = this.bones[name];
    return b ? b.getWorldPosition(out) : null;
  }

  /** stick something (an arrow) to the body so it follows the fall: head or torso bone */
  pinToBody(obj: THREE.Object3D, head: boolean) {
    const bone = (head && this.bones.Head) || this.bones.Spine1 || this.bones.Spine || this.bones.Hips;
    if (!bone) return this.root.attach(obj);
    bone.attach(obj);
    // the hit was found on the collision capsule, which is wider than the body: pull the arrow in so
    // its head sits a hand's width past the bone (the arrow's tip is 0.4 m along its local +Z)
    const bonePos = bone.getWorldPosition(_v0);
    const dir = _v1.set(0, 0, 1).applyQuaternion(obj.getWorldQuaternion(_q0));
    const want = _v2.copy(bonePos).addScaledVector(dir, -0.3);
    obj.position.copy(bone.worldToLocal(want));
  }

  /**
   * pick walk or run for a ground speed and play it at the rate at which the feet stop sliding
   * (the clips cover about 0.8 m/s walking and 1.35 m/s running; faster is scaled, within reason)
   */
  /**
   * Pick the gait for a ground speed. The clip rate follows the speed so the planted foot
   * moves at the ground speed (no sliding). `running` says the owner means to run, so the run
   * cycle plays (slowed) even while gathering speed instead of a walk flashing in first.
   */
  playGait(speed: number, crouched = false, running = false, stairs = false) {
    // on a flight of stairs: the Mixamo stair run (one cycle climbs ~0.47 m, i.e. ~1.5 m along a 1:2 flight)
    if (stairs && !crouched && speed > 0.4 && this.actions.stairs) {
      this.play('stairs', THREE.MathUtils.clamp(speed / 1.5, 0.7, 1.7));
      return;
    }
    if (crouched && this.actions.sneak) {
      // Mixamo crouched walk / crouch idle: the hips are low already, so no procedural crouch on top
      if (speed < 0.25) this.play('crouchidle');
      else this.play('sneak', THREE.MathUtils.clamp(speed / 1.1, 0.7, 1.6));
      return;
    }
    if (speed < 0.25) return this.play('idle');
    const armed = this.actions.swalk && this.kind !== 'helena' && (this.kind !== 'odysseus' || this.fistRight);
    const natWalk = armed ? 1.25 : this.meshy ? 1.5 : 1.76;
    if (crouched || (!running && speed < 2.1)) this.play(armed ? 'swalk' : 'walk', THREE.MathUtils.clamp(speed / natWalk, 0.7, 1.5));
    else if (speed < this.natSprint * 0.82 || !this.actions.sprint) this.play('run', THREE.MathUtils.clamp(speed / this.natRun, 0.62, 1.35));
    else this.play('sprint', THREE.MathUtils.clamp(speed / this.natSprint, 0.8, 1.25));
  }

  /**
   * Play a one-shot clip stretched to `duration` seconds; false when the clip is not available.
   * With `hold` the last frame stays until stopClip() (death).
   */
  hasClip(name: string) {
    return !!this.clips[name];
  }

  playClip(name: string, duration: number, hold = false) {
    const a = this.clips[name];
    if (!a || LOOP_CLIPS.has(name)) return false;
    if (this.oneShot) this.oneShot.action.stop();
    a.reset();
    a.timeScale = a.getClip().duration / duration;
    a.setEffectiveWeight(1);
    a.play();
    this.oneShot = { action: a, end: hold ? Infinity : this.clock + duration, hold, name };
    return true;
  }

  /**
   * Play an upper-body clip (sheathe / unsheathe) over whatever the legs are doing, stretched to
   * `duration` seconds. The mixer normalises weights per bone, so a high weight lets the clip win
   * the arms while the gait keeps the legs. False when the clip is missing.
   */
  playUpper(name: string, duration: number) {
    const a = this.clips[name];
    if (!a || !UPPER_CLIPS.has(name)) return false;
    if (this.upperShot) this.upperShot.action.stop();
    a.reset();
    a.timeScale = a.getClip().duration / duration;
    a.setEffectiveWeight(12);
    a.play();
    this.upperShot = { action: a, end: this.clock + duration, name };
    return true;
  }

  /** the arrow is on the string (the draw clip has passed the nocking) – only then can he draw */
  get bowReady() {
    return !this.clips.drawarrow || this.bowPhase >= BOW_NOCKED - 0.01;
  }

  /** the Mixamo bow clips (Standing Draw Arrow, Standing Aim Overdraw) over the gait: the first is
   *  scrubbed with the draw – an arrow from the quiver, onto the string, back to the cheek – and at full
   *  draw the second holds the aim. Upper body only; the legs keep walking or standing. */
  private driveBowClips(dt: number) {
    const da = this.clips.drawarrow, ah = this.clips.aimhold;
    if (!da || !ah) return;
    // a shot (the recoil jumps up): the next arrow comes out of the quiver again
    if (this.bowRecoil > this.lastRecoil + 0.5 || this.aim < 0.05) this.bowPhase = BOW_START;
    this.lastRecoil = this.bowRecoil;
    const durA = da.getClip().duration;
    if (this.aim >= 0.05) {
      if (this.bowPhase < BOW_NOCKED) this.bowPhase = Math.min(BOW_NOCKED, this.bowPhase + (dt * 1.25) / durA);
      else this.bowPhase += (BOW_NOCKED + (1 - BOW_NOCKED) * this.draw - this.bowPhase) * Math.min(1, dt * 14);
    }
    const full = this.bowPhase > 0.985 ? 1 : 0;
    this.bowHold += (full - this.bowHold) * Math.min(1, dt * 8);
    const w = 12 * this.aim;
    if (!da.isRunning()) {
      da.setLoop(THREE.LoopOnce, 1);
      da.clampWhenFinished = true;
      da.play();
    }
    da.paused = true;
    da.time = Math.min(0.999, this.bowPhase) * durA;
    da.setEffectiveWeight(w * (1 - this.bowHold));
    if (!ah.isRunning()) {
      ah.setLoop(THREE.LoopRepeat, Infinity);
      ah.play();
    }
    ah.setEffectiveWeight(w * this.bowHold);
  }

  /** true while the arms follow an upper-body clip (bow / sword overlays pause then) */
  get armsBusy() {
    return this.upperShot !== null || this.oneShot !== null;
  }

  stopClip(fade = 0.2) {
    if (!this.oneShot) return;
    this.oneShot.action.fadeOut(fade);
    this.oneShot = null;
  }

  /** name of the one-shot clip currently driving the body, or null */
  get clipName() {
    return this.oneShot?.name ?? null;
  }

  /** whether the hero has the Mixamo clip set (crouch, block, hit … come from clips then) */
  get hasClips() {
    return !!this.actions.sneak;
  }

  /** true while a one-shot clip drives the body (procedural attack overlay is skipped then) */
  get clipDriven() {
    return this.oneShot !== null;
  }

  play(anim: MoveAnim, speedScale = 1) {
    if (!this.actions[anim]) anim = FALLBACK[anim];
    this.current = anim;
    const a = this.actions[anim];
    if (a) a.timeScale = speedScale;
  }

  update(dt: number) {
    // crossfade weights toward the current move anim
    if (this.oneShot && this.clock > this.oneShot.end) {
      this.oneShot.action.fadeOut(0.15);
      this.oneShot = null;
    }
    if (this.upperShot && this.clock > this.upperShot.end - 0.25) {
      // ease the arms back to the gait over the clip's last quarter second
      const w = this.upperShot.action.getEffectiveWeight();
      this.upperShot.action.setEffectiveWeight(Math.max(0, w - dt * 48));
      if (this.clock > this.upperShot.end) {
        this.upperShot.action.stop();
        this.upperShot = null;
      }
    }
    for (const [k, a] of Object.entries(this.actions) as [MoveAnim, THREE.AnimationAction][]) {
      const target = k === this.current && !this.oneShot ? 1 : 0;
      if (!a) continue;
      const w = a.getEffectiveWeight();
      a.setEffectiveWeight(w + (target - w) * Math.min(1, dt * (this.oneShot ? 14 : 8)));
    }
    this.flinch = Math.max(0, this.flinch - dt * 3.2);
    this.driveBowClips(dt);
    this.bowRecoil = Math.max(0, this.bowRecoil - dt * 4.5);
    this.clock += dt;
    // the mantle folds the body: crouched at the start, stretched at the top, crouched on arrival
    this.mantleDip = this.mantle > 0 && !this.oneShot ? 0.55 * Math.sin(Math.PI * this.mantle) * (this.mantle < 0.5 ? 0.6 : 1) : 0;
    // the mixer only writes bones whose animated value changed since its last step, so put the
    // previous mixer result back first – otherwise our overlays would pile up frame after frame
    for (const s of this.snapshot) {
      s.bone.quaternion.copy(s.q);
      s.bone.position.copy(s.p);
    }
    this.mixer.update(dt);
    if (!this.snapshot.length) for (const bone of Object.values(this.bones)) this.snapshot.push({ bone, q: new THREE.Quaternion(), p: new THREE.Vector3() });
    for (const s of this.snapshot) {
      s.q.copy(s.bone.quaternion);
      s.p.copy(s.bone.position);
    }
    // the gait cycles bob the hips by 7–10 cm, which reads as stomping: keep half of it (an overlay,
    // so it never accumulates); the average is tracked so the damping is centred on the cycle
    const hips = this.bones.Hips;
    if (hips && !this.oneShot && (this.current === 'walk' || this.current === 'run' || this.current === 'sprint' || this.current === 'swalk')) {
      const y = hips.position.y;
      this.hipAvg = this.hipAvg === null ? y : this.hipAvg + (y - this.hipAvg) * Math.min(1, dt * 2.5);
      // the run bobs hardest (heavy sword-and-shield run): keep only a third of it there
      hips.position.y = this.hipAvg + (y - this.hipAvg) * (this.current === 'run' ? 0.33 : 0.5);
    } else this.hipAvg = null;
    this.applyOverlays();
  }

  /**
   * Nothing goes through the ground: lift the whole figure until its lowest point – any bone, the
   * shield, spear, sword or bow – rests on `floorY`. Called by the owner after it placed the root
   * (dead and sleeping figures, whose limbs and gear would otherwise sink into the dirt).
   */
  clampGround(floorY: number) {
    this.root.updateWorldMatrix(true, true);
    let min = Infinity;
    for (const bone of Object.values(this.bones)) {
      bone.getWorldPosition(_v6);
      if (_v6.y < min) min = _v6.y;
    }
    min -= 0.05; // flesh around the joints
    const dropped = this.gearDropped ? [this.shieldObj, this.spear] : [];
    for (const o of [this.shieldObj, this.spear, this.swordInHand, this.bow, this.bowOnBack, this.shieldOnBack]) {
      if (!o || !o.visible || !o.parent || dropped.includes(o)) continue;
      _box.setFromObject(o);
      if (_box.min.y < min) min = _box.min.y;
    }
    const deficit = floorY - min;
    if (deficit > 0.002) {
      this.root.position.y += deficit;
      this.root.updateWorldMatrix(true, true);
    }
    // dropped shield and spear lie ON the ground: neither sunk in nor hovering, wherever the body ended up
    for (const o of dropped) {
      if (!o || !o.visible || o.parent !== this.root) continue;
      _box.setFromObject(o);
      const gap = _box.min.y - (floorY + 0.004);
      if (Math.abs(gap) > 0.002) {
        o.position.y -= gap / this.root.scale.y;
        o.updateMatrixWorld(true);
      }
    }
  }

  // ---- world-space bone steering -------------------------------------------------------
  // Mixamo bones point along their local +Y. Instead of guessing local rotation axes we turn a
  // bone so that it points along a direction given in character space (+Z forward, +Y up).

  /** character-space direction → world */
  private toWorld(d: Dir, out: THREE.Vector3) {
    return out.set(d[0] * this.rs, d[1], d[2]).normalize().applyQuaternion(this.root.getWorldQuaternion(_q0));
  }

  /**
   * Blend a bone toward pointing along `dir` (character space). `roll` optionally says which
   * world direction the bone's local `rollAxis` should face (e.g. the belly of the bow forward).
   */
  private pointBone(name: string, dir: Dir, blend: number, roll?: THREE.Vector3, rollAxis?: THREE.Vector3) {
    const bone = this.bones[name];
    if (!bone || blend <= 0.001) return;
    const want = this.toWorld(dir, _v0);
    const cur = bone.getWorldQuaternion(_q1);
    const curDir = _v1.set(0, 1, 0).applyQuaternion(cur);
    const delta = _q2.setFromUnitVectors(curDir, want);
    const target = _q3.copy(delta).multiply(cur); // new world rotation
    if (roll && rollAxis) {
      const ax = _v2.copy(rollAxis).applyQuaternion(target);
      ax.addScaledVector(want, -ax.dot(want)).normalize();
      const r = _v3.copy(roll).addScaledVector(want, -roll.dot(want)).normalize();
      const ang = Math.atan2(_v4.crossVectors(ax, r).dot(want), ax.dot(r));
      target.premultiply(_q4.setFromAxisAngle(want, ang));
    }
    const parentQ = bone.parent!.getWorldQuaternion(_q1);
    const local = _q2.copy(parentQ).invert().multiply(target);
    bone.quaternion.slerp(local, Math.min(1, blend));
  }

  private poseArm(side: 'Right' | 'Left', pose: ArmPose, blend: number) {
    const mirror = side === 'Left' ? -1 : 1;
    const m = (d: Dir): Dir => [d[0] * mirror, d[1], d[2]];
    this.pointBone(side + 'Arm', m(pose.upper), blend);
    this.pointBone(side + 'ForeArm', m(pose.fore), blend);
    this.pointBone(side + 'Hand', m(pose.hand), blend);
  }

  private static mixPose(a: ArmPose, b: ArmPose, t: number, out: ArmPose) {
    const mixD = (x: Dir, y: Dir, o: Dir) => {
      o[0] = x[0] + (y[0] - x[0]) * t;
      o[1] = x[1] + (y[1] - x[1]) * t;
      o[2] = x[2] + (y[2] - x[2]) * t;
    };
    mixD(a.upper, b.upper, out.upper);
    mixD(a.fore, b.fore, out.fore);
    mixD(a.hand, b.hand, out.hand);
    return out;
  }

  /** turn a bone so its +Y points along a world direction */
  private pointBoneWorld(name: string, want: THREE.Vector3, blend: number) {
    const bone = this.bones[name];
    if (!bone || blend <= 0.001) return;
    const cur = bone.getWorldQuaternion(_q1);
    const curDir = _v1.set(0, 1, 0).applyQuaternion(cur);
    const target = _q3.copy(_q2.setFromUnitVectors(curDir, _v6.copy(want).normalize())).multiply(cur);
    const parentQ = bone.parent!.getWorldQuaternion(_q1);
    bone.quaternion.slerp(_q2.copy(parentQ).invert().multiply(target), Math.min(1, blend));
  }

  /**
   * Two-bone IK: bend upper/lower so the end bone reaches `target` (world). `pole` is a world
   * point the middle joint (elbow / knee) bends toward.
   */
  private reach(upper: string, lower: string, end: string, target: THREE.Vector3, pole: THREE.Vector3, blend: number) {
    const bu = this.bones[upper], bl = this.bones[lower], be = this.bones[end];
    if (!bu || !bl || !be || blend <= 0.001) return;
    const a = bu.getWorldPosition(_ik0), b = bl.getWorldPosition(_ik1), c = be.getWorldPosition(_ik2);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    const d = _ik3.copy(target).sub(a);
    const dist = THREE.MathUtils.clamp(d.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
    d.normalize();
    // bend direction: toward the pole, perpendicular to the shoulder→target line
    const bend = _ik4.copy(pole).sub(a);
    bend.addScaledVector(d, -bend.dot(d));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
    bend.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const upperDir = _ik5.copy(d).multiplyScalar(cosA).addScaledVector(bend, sinA);
    this.pointBoneWorld(upper, upperDir, blend);
    const elbow = bl.getWorldPosition(_ik1);
    this.pointBoneWorld(lower, _ik5.copy(target).sub(elbow), blend);
  }

  /** rotate a bone in world space around an axis given in character space */
  private rotateBone(name: string, axis: Dir, angle: number) {
    const bone = this.bones[name];
    if (!bone || Math.abs(angle) < 1e-4) return;
    // (the axis is not mirrored by the right-hand sign: a pitch about +X must stay a pitch)
    const ax = _v0.set(axis[0], axis[1], axis[2]).normalize().applyQuaternion(this.root.getWorldQuaternion(_q0));
    const cur = bone.getWorldQuaternion(_q1);
    const target = _q3.setFromAxisAngle(ax, angle).multiply(cur);
    const parentQ = bone.parent!.getWorldQuaternion(_q1);
    bone.quaternion.copy(_q2.copy(parentQ).invert().multiply(target));
  }

  /**
   * After the bow clips: turn the chest so the bow arm points exactly along aimDir (spread over the
   * three spine bones), then keep the draw hand clearly right of the head and behind the cheek, as
   * seen from the camera behind him – never in the face.
   */
  /** debugging: 0 = clip pose only, 1 = + chest turn, 2 = + draw hand */
  static aimLayers = 2;
  private aimFromClips() {
    const a = this.aim;
    if (Character.aimLayers < 1) return;
    // The clip's archer leans over its own hips, which are not used (the legs walk or stand on ours):
    // so turn the chest as a whole until the bow arm lies along aimDir AND the spine stands upright
    // (two-vector frame alignment), a third of the turn on each spine bone.
    const sh = this.boneWorld('LeftArm', _ik6), hand = this.boneWorld('LeftHand', _ik7), head = this.boneWorld('Head', _ik8), hips = this.boneWorld('Hips', _ik9);
    if (sh && hand && head && hips) {
      const a1 = hand.sub(sh).normalize();
      const u1 = head.sub(hips);
      u1.addScaledVector(a1, -u1.dot(a1)).normalize();
      const a2 = _ik10.copy(this.aimDir).normalize();
      const u2 = _ik11.set(0, 1, 0);
      u2.addScaledVector(a2, -u2.dot(a2)).normalize();
      _m1.makeBasis(a1, u1, _ik12.crossVectors(a1, u1));
      _m2.makeBasis(a2, u2, _ik13.crossVectors(a2, u2));
      _m2.multiply(_m1.transpose());
      const full = _q3.setFromRotationMatrix(_m2);
      const part = _q4.identity().slerp(full, a / 3);
      for (const n of ['Spine', 'Spine1', 'Spine2']) this.turnBoneWorld(n, part);
    }
    if (this.bowRecoil > 0.01 || Character.aimLayers < 2) return; // the clip's release follow-through
    const hd = this.boneWorld('Head', _ik9), rh = this.boneWorld('RightHand', _ik10), elbow = this.boneWorld('RightForeArm', _ik11);
    if (!hd || !rh || !elbow) return;
    const right = _ik12.crossVectors(this.aimDir, _yUp).normalize();
    const rel = _ik13.copy(rh).sub(hd);
    const lateral = rel.dot(right), along = rel.dot(this.aimDir);
    const k = a * Math.max(0, (this.bowPhase - BOW_NOCKED) / (1 - BOW_NOCKED));
    const target = _ik14.copy(rh);
    if (lateral < AIM_HAND_SIDE) target.addScaledVector(right, (AIM_HAND_SIDE - lateral) * k);
    if (along > -0.04) target.addScaledVector(this.aimDir, (-0.04 - along) * k);
    if (target.distanceToSquared(rh) < 1e-6) return;
    const pole = elbow.addScaledVector(right, 0.3).addScaledVector(_yUp, 0.15);
    this.reach('RightArm', 'RightForeArm', 'RightHand', target, pole, 1);
  }

  /** turn a bone (and everything below it in the chain) by a world-space rotation */
  private turnBoneWorld(name: string, q: THREE.Quaternion) {
    const bone = this.bones[name];
    if (!bone) return;
    const cur = bone.getWorldQuaternion(_q1);
    const target = _q2.copy(q).multiply(cur);
    const parentQ = bone.parent!.getWorldQuaternion(_q1);
    bone.quaternion.copy(parentQ.invert().multiply(target));
    bone.updateMatrixWorld(true);
  }

  /** procedural pose layers on top of the mixer result */
  private applyOverlays() {
    const b = this.bones;
    const crouch = this.hasClips ? 0 : this.crouch;
    const c = Math.min(1, crouch + (this.attack > 0 && !this.oneShot ? 0.22 * Math.sin(Math.PI * Math.min(1, this.attack / 0.7)) : 0) + this.mantleDip);
    if (c > 0.001 && b.Hips) {
      b.Hips.position.y -= 28 * c; // cm
      b.Spine && (b.Spine.rotation.x += 0.35 * c);
      for (const s of ['Left', 'Right']) {
        const up = b[s + 'UpLeg'], leg = b[s + 'Leg'], foot = b[s + 'Foot'];
        up && up.rotateX(-0.75 * c);
        leg && leg.rotateX(1.2 * c);
        foot && foot.rotateX(-0.4 * c);
      }
    }
    // fists: collapse the hand bone (its skin shrinks to a point) and show the fist mesh instead
    if (this.hero) {
      const rope = this.ropeHang > 0.5;
      const want = { Left: this.fistLeft || rope, Right: this.fistRight || rope };
      for (const side of ['Left', 'Right'] as const) {
        const hand = b[side + 'Hand'], f = this.fists[side];
        if (!hand || !f) continue;
        const on = want[side];
        hand.scale.setScalar(on ? 0.001 : 1);
        f.visible = on;
      }
    }
    // the matrices below must reflect the mixer result and the hip edits above
    this.root.updateWorldMatrix(true, true);

    // Meshy idle is a stiff A-pose: let the arms hang and breathe a little while standing still
    if (this.meshy) {
      // (not while the bow clips drive the arms)
      const iw = this.actions.idle.getEffectiveWeight() * (this.clips.aimhold ? 1 - this.aim : 1);
      if (iw > 0.01) {
        const br = Math.sin(this.clock * 1.7);
        this.rotateBone('Spine1', [1, 0, 0], 0.012 * br * iw);
        this.rotateBone('Spine2', [1, 0, 0], 0.01 * br * iw);
        this.poseArm('Right', { upper: [0.2, -0.95, 0.04], fore: [0.12, -0.9, 0.35], hand: [0.05, -0.9, 0.35] }, iw * 0.9);
        this.poseArm('Left', { upper: [0.2, -0.95, 0.04], fore: [0.12, -0.9, 0.35], hand: [0.05, -0.9, 0.35] }, iw * 0.9);
      }
    }

    // body: lean into turns / acceleration, flinch back when hit
    if (Math.abs(this.lean) > 0.002) this.rotateBone('Spine', [0, 0, 1], this.lean);
    if (this.flinch > 0.01 && !this.oneShot) {
      const f = this.flinch;
      this.rotateBone('Spine', [1, 0, 0], -0.35 * f);
      this.rotateBone('Spine2', [1, 0, 0], -0.2 * f);
      this.rotateBone('Head', [1, 0, 0], -0.25 * f);
    }

    if (this.attack > 0 && !this.oneShot) {
      // wind up (0..0.25), strike (0.25..0.42), follow through (0.42..0.62), recover (0.62..1)
      const t = this.attack;
      const P = POSES[this.attackKind];
      let pose: ArmPose, twist: number, lean: number;
      const mix = (a: number, b: number, k: number) => a + (b - a) * k;
      if (t < 0.25) {
        const k = easeOutQ(t / 0.25);
        pose = Character.mixPose(ARM_IDLE, P.windup, k, _pose);
        twist = P.twist[0] * k;
        lean = P.lean[0] * k;
      } else if (t < 0.42) {
        const k = easeInQ((t - 0.25) / 0.17);
        pose = Character.mixPose(P.windup, P.strike, k, _pose);
        twist = mix(P.twist[0], P.twist[1], k);
        lean = mix(P.lean[0], P.lean[1], k);
      } else if (t < 0.62) {
        const k = easeOutQ((t - 0.42) / 0.2);
        pose = Character.mixPose(P.strike, P.follow, k, _pose);
        twist = mix(P.twist[1], P.twist[2], k);
        lean = mix(P.lean[1], P.lean[2], k);
      } else {
        const k = smooth((t - 0.62) / 0.38);
        pose = Character.mixPose(P.follow, ARM_IDLE, k, _pose);
        twist = P.twist[2] * (1 - k);
        lean = P.lean[2] * (1 - k);
      }
      const w = t < 0.08 ? t / 0.08 : t > 0.88 ? (1 - t) / 0.12 : 1;
      // the whole body takes part: hips and shoulders counter-rotate, the torso folds into the cut
      this.rotateBone('Hips', [0, 1, 0], twist * 0.35 * this.rs * w);
      this.rotateBone('Spine', [0, 1, 0], twist * 0.3 * this.rs * w);
      this.rotateBone('Spine1', [0, 1, 0], twist * 0.45 * this.rs * w);
      this.rotateBone('Spine', [1, 0, 0], lean * 0.6 * w);
      this.rotateBone('Spine1', [1, 0, 0], lean * 0.4 * w);
      // the head stays on the target while the body turns
      this.rotateBone('Head', [0, 1, 0], -twist * 0.8 * this.rs * w);
      this.poseArm('Right', pose, w);
      // the free (shield) arm comes up as a counterweight / guard
      if (this.aim < 0.5 && this.block < 0.5) this.poseArm('Left', P.off, w * 0.85);
    }
    if (this.carryBow > 0.01 && !this.armsBusy) {
      // the bow hangs from the left hand, the arm held a little out so the bow swings clear of the leg;
      // while walking the arm mostly keeps the gait's swing (a frozen arm looked wrong)
      const moving = this.current !== 'idle' && this.current !== 'crouchidle' && this.current !== 'blockidle' ? 0.6 : 0;
      const w = this.carryBow * (1 - this.aim) * (1 - this.block) * (1 - moving);
      this.poseArm('Left', { upper: [0.3, -0.95, 0.1], fore: [0.3, -0.95, 0.22], hand: [0.25, -0.9, 0.3] }, w);
    }

    if (this.block > 0.01 && this.current !== 'blockidle' && !this.armsBusy) {
      // forearm raised across the chest (shield / parry)
      this.poseArm('Left', { upper: [-0.35, -0.3, 0.85], fore: [0.1, 0.9, 0.35], hand: [0.2, 0.95, 0.1] }, this.block);
      this.rotateBone('Spine1', [0, 1, 0], 0.3 * this.rs * this.block);
    }
    if (this.aim > 0.01 && this.clips.aimhold && this.clips.drawarrow) {
      this.aimFromClips();
    } else if (this.aim > 0.01) {
      const a = this.aim;
      // torso turned side-on, bow arm straight at the target, draw hand back to the cheek
      this.rotateBone('Spine1', [0, 1, 0], 0.7 * this.rs * a);
      this.rotateBone('Head', [0, 1, 0], -0.6 * this.rs * a);
      const fwd = this.toWorld([0, 0.05, 1], _v5);
      this.poseArm('Left', { upper: [0.1, 0.1, 0.95], fore: [0, 0.05, 1], hand: [0, 1, 0.05] }, a);
      // roll the bow hand so the bow's belly faces the target (bow is along the hand's +Y, belly at +X)
      this.pointBone('LeftHand', [0, 1, 0.05], a, fwd, _xAxis);
      const d = this.draw;
      // the body settles into the draw: a touch back, the head tilts to the string
      this.rotateBone('Spine', [1, 0, 0], -0.08 * d * a);
      this.rotateBone('Head', [0, 0, 1], -0.12 * d * a * this.rs);
      const rc = this.bowRecoil;
      if (rc > 0.01) {
        // after the release the draw hand snaps back past the ear, then settles
        const k = Math.sin(Math.min(1, rc) * Math.PI * 0.5);
        this.poseArm('Right', { upper: [0.95, 0.3, -0.2], fore: [-0.2, 0.35, -0.9], hand: [-0.3, 0.3, -0.9] }, a * k);
        this.poseArm('Right', { upper: [0.9, 0.15, 0.4], fore: [-0.55, 0.05, 0.85], hand: [-0.7, 0.05, 0.7] }, a * (1 - k));
      } else {
        // the draw hand holds the string: at rest just behind the bow hand, at full draw anchored
        // beside the right cheek on the arrow line – right of the head seen from behind, never in
        // front of the face. Solved as two-bone IK in world space so it also holds when crouched.
        const head = this.boneWorld('Head', _ik6), bowHand = this.boneWorld('LeftHand', _ik7), shoulder = this.boneWorld('RightArm', _ik8);
        if (head && bowHand && shoulder) {
          const right = this.toWorld([1, 0, 0], _ik9), up = this.toWorld([0, 1, 0], _ik10);
          const rest = _ik11.copy(bowHand).addScaledVector(fwd, -0.16).addScaledVector(right, 0.05).addScaledVector(up, -0.02);
          const anchor = _ik12.copy(head).addScaledVector(right, 0.13).addScaledVector(up, 0.03).addScaledVector(fwd, 0.07);
          const target = rest.lerp(anchor, d);
          // the elbow swings out, back and up as the string comes to the cheek
          const pole = _ik13.copy(shoulder).addScaledVector(right, 0.5).addScaledVector(fwd, -0.45 - 0.15 * d).addScaledVector(up, 0.3 + 0.25 * d);
          this.reach('RightArm', 'RightForeArm', 'RightHand', target, pole, a);
          const elbow = this.boneWorld('RightForeArm', _ik9);
          if (elbow) this.pointBoneWorld('RightHand', _ik10.copy(target).sub(elbow), a);
        } else {
          Character.mixPose(AIM_HAND_FRONT, AIM_HAND_ANCHOR, d, _pose);
          this.poseArm('Right', _pose, a);
        }
      }
      if (this.bow) setBowDraw(this.bow, d * a);
    }
    if (this.mantle > 0.001 && !this.oneShot) {
      // hands reach for the ledge, then push down while a knee comes up and over
      const m = this.mantle;
      const reach = m < 0.45 ? 1 : Math.max(0, 1 - (m - 0.45) / 0.3);
      const push = m < 0.3 ? 0 : Math.min(1, (m - 0.3) / 0.3) * Math.max(0, 1 - Math.max(0, m - 0.75) / 0.25);
      const settle = Math.max(0, (m - 0.8) / 0.2);
      for (const side of ['Left', 'Right'] as const) {
        const s = side === 'Left' ? -1 : 1;
        this.poseArm(side, { upper: [s * 0.3, 0.75, 0.6], fore: [s * 0.1, 0.65, 0.75], hand: [s * 0.1, 0.1, 1] }, reach);
        this.poseArm(side, { upper: [s * 0.2, -0.45, 0.85], fore: [s * 0.1, -0.8, 0.6], hand: [s * 0.05, -0.9, 0.4] }, push * (1 - settle));
      }
      this.rotateBone('Spine', [1, 0, 0], 0.45 * (1 - settle));
      // the right knee comes up and over the edge, the left leg trails
      const knee = Math.sin(Math.PI * Math.min(1, m / 0.85));
      this.pointBone('RightUpLeg', [0.2, -0.3, 0.9], knee);
      this.pointBone('RightLeg', [0.1, -0.95, 0.3], knee);
      this.pointBone('LeftUpLeg', [-0.1, -0.9, 0.35], knee * 0.6);
      this.pointBone('LeftLeg', [0, -0.9, -0.45], knee * 0.6);
    }
    if (this.air > 0.01 && !this.oneShot) {
      const a = this.air;
      // mid-air: thighs drawn up, shins trailing, arms out for balance, slight forward lean
      this.rotateBone('Spine', [1, 0, 0], 0.18 * a);
      for (const side of ['Left', 'Right'] as const) {
        const m = side === 'Left' ? -1 : 1;
        this.pointBone(side + 'UpLeg', [m * 0.12, -0.75, 0.55], a * 0.85);
        this.pointBone(side + 'Leg', [m * 0.05, -0.85, -0.5], a * 0.85);
        this.pointBone(side + 'Arm', [m * 0.85, -0.35, -0.15], a * 0.7);
        this.pointBone(side + 'ForeArm', [m * 0.6, 0.1, 0.35], a * 0.7);
      }
    }
    if (this.ropeHang > 0.01) {
      const a = this.ropeHang;
      const g = this.ropeGrip;
      if (g) {
        // hands and feet on the rope (IK): elbows out to the sides, knees forward
        this.rotateBone('Head', [1, 0, 0], -0.25 * a); // looking up at the hands … 
        this.rotateBone('Spine', [1, 0, 0], -0.12 * a); // … hanging slightly back
        for (const [i, side] of (['Left', 'Right'] as const).entries()) {
          const m = side === 'Left' ? -1 : 1;
          const sh = this.bones[side + 'Arm']?.getWorldPosition(_v5);
          if (sh) {
            const pole = this.toWorld([m * 1, -0.6, -0.3], _v4).add(sh);
            this.reach(side + 'Arm', side + 'ForeArm', side + 'Hand', g.hands[i], pole, a);
            this.pointBoneWorld(side + 'Hand', this.toWorld([-m * 0.15, 1, 0.15], _v4), a);
          }
          const hip = this.bones[side + 'UpLeg']?.getWorldPosition(_v5);
          if (hip) {
            const pole = this.toWorld([m * 0.3, 0, 1], _v4).add(hip);
            this.reach(side + 'UpLeg', side + 'Leg', side + 'Foot', g.feet[i], pole, a);
          }
        }
      } else {
        // fallback without grip points: hands above the head, legs bent
        const ph = this.ropePhase * Math.PI * 2;
        const l = Math.sin(ph) * 0.5, r = Math.sin(ph + Math.PI) * 0.5;
        this.poseArm('Left', { upper: [-0.15, 0.85, 0.35 + l * 0.2], fore: [0.1, 0.95, 0.2 - l * 0.15], hand: [0.1, 0.9, -0.3] }, a);
        this.poseArm('Right', { upper: [0.15, 0.85, 0.35 + r * 0.2], fore: [-0.1, 0.95, 0.2 - r * 0.15], hand: [-0.1, 0.9, -0.3] }, a);
        for (const side of ['Left', 'Right'] as const) {
          const m = side === 'Left' ? -1 : 1;
          this.pointBone(side + 'UpLeg', [m * 0.1, -0.7, 0.55], a);
          this.pointBone(side + 'Leg', [-m * 0.15, -0.85, -0.35], a);
        }
      }
    }
    if (Math.abs(this.lookYaw) > 0.002 || Math.abs(this.lookPitch) > 0.002) {
      this.rotateBone('Neck', [0, 1, 0], this.lookYaw * 0.35);
      this.rotateBone('Head', [0, 1, 0], this.lookYaw * 0.65);
      this.rotateBone('Head', [1, 0, 0], this.lookPitch);
    }
    // keep the lowest foot on the ground: crouching and poses pull the feet up otherwise
    const held = !!this.oneShot?.hold;
    if (this.lie < 0.5 && this.air < 0.5 && this.ropeHang < 0.5 && this.mantle <= 0 && b.Hips && !held) {
      this.root.updateWorldMatrix(false, true);
      const rootY = this.root.getWorldPosition(_v0).y;
      let minY = Infinity;
      for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) {
        const bone = b[n];
        if (bone) minY = Math.min(minY, bone.getWorldPosition(_v1).y - rootY);
      }
      if (minY < Infinity) b.Hips.position.y -= (minY - 0.02) * 100 * (1 - this.lie);
    }
    if (this.lie > 0.001) {
      const holder = this.root.children[0];
      holder.rotation.z = this.lieSide * this.lie * Math.PI / 2;
      holder.position.y = this.lie * 0.18;
      holder.position.x = -this.lieSide * this.lie * 0.0;
    } else {
      const holder = this.root.children[0];
      holder.rotation.z = 0;
      holder.position.set(0, 0, 0);
      if (held) {
        // a held clip (death) ends lying down: rest the lowest bone on the ground, whatever the clip's hips did
        this.root.updateWorldMatrix(false, true);
        const rootY = this.root.getWorldPosition(_v0).y;
        let minY = Infinity;
        for (const bone of Object.values(b)) minY = Math.min(minY, bone.getWorldPosition(_v1).y - rootY);
        if (minY < Infinity) holder.position.y = Math.max(-0.5, -(minY - 0.04));
      }
    }
    if (this.bow && this.bow.visible && this.fists.Left) {
      // the bow is oriented in world terms, after every arm overlay: carried, it hangs upright beside the
      // leg whatever the arm does; aiming, the limbs stand vertical (a touch canted) with the belly at the target
      const fistQ = this.fists.Left.getWorldQuaternion(_q1);
      const rootQ = this.root.getWorldQuaternion(_q0);
      // aiming, the bow faces the target, not the body (he stands side-on to it)
      const aimQ = _q3.setFromEuler(_eAim.set(0, Math.atan2(this.aimDir.x, this.aimDir.z), 0));
      const want = _q2.copy(rootQ).multiply(_qBowCarryTilt).slerp(_q4.copy(this.clips.aimhold ? aimQ : rootQ).multiply(_qBowAimCant), this.aim);
      this.bow.quaternion.copy(fistQ.invert().multiply(want));
    }
  }

  setTint(hex: number) {
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material && (m.material as THREE.MeshStandardMaterial).emissive) {
        (m.material as THREE.MeshStandardMaterial).emissive.setHex(hex);
      }
    });
  }
}

const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yUp = new THREE.Vector3(0, 1, 0);
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _ik14 = new THREE.Vector3();
const _eAim = new THREE.Euler();
/** the draw clip: hand at the quiver at BOW_START, the arrow on the string at BOW_NOCKED (measured) */
const BOW_START = 0.12;
const BOW_NOCKED = 0.74;
/** at full draw the draw hand sits at least this far right of the head, seen along the arrow */
const AIM_HAND_SIDE = 0.24;
// bow in the fist: limbs along the forearm when carried; limbs across it (fist X, vertical) with the belly toward the hand (+Y) when aiming
const _qBowCarry = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
/** aiming: limbs vertical, canted a little to the archer's left, belly toward the target */
const _qBowAimCant = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.2, 'XYZ'));
/** world orientation of the carried bow relative to the body: upright, tilted a little forward and out */
const _qBowCarryTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0, 0.12, 'XYZ'));
/** draw hand at the string beside the bow hand (slack) and at the anchor under the jaw (full draw); X = the character's right */
const AIM_HAND_FRONT: ArmPose = { upper: [-0.1, 0.1, 0.95], fore: [-0.5, 0.1, 0.85], hand: [-0.5, 0.05, 0.85] };
const AIM_HAND_ANCHOR: ArmPose = { upper: [0.55, 0.45, -0.7], fore: [-0.75, 0.4, 0.5], hand: [-0.8, 0.3, 0.5] };
const _v6 = new THREE.Vector3();
const _box = new THREE.Box3();
const _ik0 = new THREE.Vector3(), _ik1 = new THREE.Vector3(), _ik2 = new THREE.Vector3(), _ik3 = new THREE.Vector3(), _ik4 = new THREE.Vector3(), _ik5 = new THREE.Vector3();
const _ik6 = new THREE.Vector3(), _ik7 = new THREE.Vector3(), _ik8 = new THREE.Vector3(), _ik9 = new THREE.Vector3(), _ik10 = new THREE.Vector3(), _ik11 = new THREE.Vector3(), _ik12 = new THREE.Vector3(), _ik13 = new THREE.Vector3();
const _pose: ArmPose = { upper: [0, 0, 0], fore: [0, 0, 0], hand: [0, 0, 0] };

const marble = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.55, metalness: 0 });

/** a marble warrior: the guard model frozen in a frame of a clip, every material swapped for stone */
export function makeStatue(clip: string, time: number, variant = 0): THREE.Group {
  const c = new Character('guard', variant);
  c.update(0.05);
  c.freezePose(clip, time);
  c.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = marble;
  });
  return c.root;
}
