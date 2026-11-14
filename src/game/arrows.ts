import * as THREE from 'three';
import { Fire } from '../fx/fire';
import { CollisionWorld } from './collision';
import { Guard } from './guards';

interface Arrow {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  flying: boolean;
  life: number;
}

export interface ArrowHit {
  guard: Guard | null;
  point: THREE.Vector3;
  headshot: boolean;
  /** flight direction at impact */
  dir: THREE.Vector3;
}

/** launch speed for a draw power 0..1 (used by the aim to compensate the arrow's drop) */
export const ARROW_GRAVITY = 4.5;
export function arrowSpeed(power: number) {
  return 36 + power * 44;
}

function arrowMesh() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.75, 4), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8 }));
  shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 4), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, metalness: 0.8, roughness: 0.4 }));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.4;
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.12), new THREE.MeshStandardMaterial({ color: 0xc8b8a0, side: THREE.DoubleSide }));
  fl.rotation.x = Math.PI / 2;
  fl.position.z = -0.32;
  g.add(shaft, tip, fl);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Arrows: ballistic flight, hits on guards (body or head) and sticking into walls. */
export class Arrows {
  private list: Arrow[] = [];
  constructor(private scene: THREE.Scene, private world: CollisionWorld) {}

  fire(from: THREE.Vector3, dir: THREE.Vector3, power: number) {
    const mesh = arrowMesh();
    this.scene.add(mesh);
    const speed = arrowSpeed(power);
    this.list.push({ mesh, pos: from.clone(), vel: dir.clone().multiplyScalar(speed), flying: true, life: 40 });
    if (this.list.length > 40) {
      const old = this.list.shift()!;
      this.scene.remove(old.mesh);
    }
  }

  update(dt: number, guards: Guard[], fires: Fire[], onHit: (h: ArrowHit) => void, onTorch?: (f: Fire) => void) {
    for (const a of this.list) {
      a.life -= dt;
      if (!a.flying) continue;
      const steps = 3;
      const sdt = dt / steps;
      for (let s = 0; s < steps && a.flying; s++) {
        a.vel.y -= ARROW_GRAVITY * sdt; // a bit flatter than real life, so aiming feels fair
        const step = _s.copy(a.vel).multiplyScalar(sdt);
        const len = step.length();
        const dir = _d.copy(step).divideScalar(len);
        // guards (vertical capsules) – head is a sphere at the top
        let best = Infinity, bestGuard: Guard | null = null, head = false;
        for (const g of guards) {
          if (!g.alive) continue;
          const t = segCapsule(a.pos, dir, len, g);
          if (t !== null && t.t < best) {
            best = t.t;
            bestGuard = g;
            head = t.head;
          }
        }
        // a torch flame in the way is put out (the arrow flies on)
        for (const f of fires) {
          if (!f.shootable || !f.lit) continue;
          const fp = f.lightWorldPos(_t);
          const along = THREE.MathUtils.clamp(_u.subVectors(fp, a.pos).dot(dir), 0, len);
          if (_u.copy(a.pos).addScaledVector(dir, along).distanceToSquared(fp) < 0.45 * 0.45) {
            f.lit = false;
            onTorch?.(f);
          }
        }
        const wall = this.world.raycast(a.pos, dir, len);
        const ground = a.pos.y + step.y < 0 ? (0 - a.pos.y) / step.y * len : Infinity;
        const hitT = Math.min(best, wall, ground);
        if (hitT < Infinity) {
          a.pos.addScaledVector(dir, hitT);
          a.flying = false;
          if (bestGuard && best <= wall && best <= ground) {
            // stick into the guard
            a.mesh.position.copy(a.pos);
            a.mesh.lookAt(_l.copy(a.pos).add(a.vel));
            bestGuard.char.pinToBody(a.mesh, head);
            onHit({ guard: bestGuard, point: a.pos.clone(), headshot: head, dir: dir.clone() });
          } else onHit({ guard: null, point: a.pos.clone(), headshot: false, dir: dir.clone() });
        } else a.pos.add(step);
      }
      if (a.mesh.parent === this.scene) {
        a.mesh.position.copy(a.pos);
        if (a.flying) a.mesh.lookAt(_l.copy(a.pos).add(a.vel));
      }
    }
  }

  clear() {
    for (const a of this.list) a.mesh.removeFromParent();
    this.list = [];
  }
}

/** distance along the ray to the first living guard it hits (body or head), or null */
export function raycastGuards(o: THREE.Vector3, d: THREE.Vector3, len: number, guards: Guard[]): number | null {
  let best: number | null = null;
  for (const g of guards) {
    if (!g.alive) continue;
    const t = segCapsule(o, d, len, g);
    if (t !== null && (best === null || t.t < best)) best = t.t;
  }
  return best;
}

function segCapsule(o: THREE.Vector3, d: THREE.Vector3, len: number, g: Guard): { t: number; head: boolean } | null {
  const lying = g.asleep || g.char.lie > 0.5;
  // lying guards: a low box-ish capsule; standing: radius 0.32 from 0.1 to 1.45, head sphere at 1.62
  const headY = lying ? 0.25 : 1.62;
  // head first
  const hc = _h.set(g.pos.x, g.pos.y + headY, g.pos.z);
  const th = raySphere(o, d, hc, 0.16);
  const tb = lying ? raySphere(o, d, _h.set(g.pos.x, g.pos.y + 0.25, g.pos.z), 0.7) : rayCylinder(o, d, g.pos.x, g.pos.z, 0.32, g.pos.y + 0.1, g.pos.y + 1.45);
  let res: { t: number; head: boolean } | null = null;
  if (th !== null && th <= len) res = { t: th, head: true };
  if (tb !== null && tb <= len && (!res || tb < res.t)) res = { t: tb, head: false };
  return res;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, r: number, y0: number, y1: number) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return null;
  const y = o.y + d.y * t;
  return y >= y0 && y <= y1 ? t : null;
}

const _s = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3(), _h = new THREE.Vector3();
const _t = new THREE.Vector3(), _u = new THREE.Vector3();
