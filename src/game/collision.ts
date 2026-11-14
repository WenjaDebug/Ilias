import * as THREE from 'three';

/**
 * Very small collision world made of axis-aligned boxes.
 * Everything solid in the level (houses, walls, crates, stairs, the horse's legs)
 * registers one or more boxes here. Characters are vertical capsules (radius + height).
 */
export interface Collider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** climbable ledges: the player can mantle onto the top of this box */
  climbable: boolean;
  /** a box turned about the vertical axis (tables, carts, lying jars …): min/max are then only its
   *  envelope, the real footprint is the half extents hw × hd around (cx, cz), turned by the angle (c = cos, s = sin) */
  turn?: { cx: number; cz: number; c: number; s: number; hw: number; hd: number };
  /** a sloped walking surface (a flight of stairs): its top rises linearly along `axis` from y0 at
   *  coordinate `a` to y1 at `b`; below the slope it is solid down to min.y */
  ramp?: { axis: 'x' | 'z'; a: number; b: number; y0: number; y1: number };
}

/** the top of a box at (x, z): the slope's height for a ramp, max.y for everything else */
export function topAt(b: Collider, x: number, z: number): number {
  const r = b.ramp;
  if (!r) return b.max.y;
  const c = r.axis === 'x' ? x : z;
  const t = Math.max(0, Math.min(1, (c - r.a) / (r.b - r.a)));
  return r.y0 + (r.y1 - r.y0) * t;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _mn = new THREE.Vector3();
const _mx = new THREE.Vector3();

/** (x, z) in the box's own frame */
function toLocal(t: NonNullable<Collider['turn']>, x: number, z: number): [number, number] {
  const dx = x - t.cx, dz = z - t.cz;
  return [dx * t.c - dz * t.s, dx * t.s + dz * t.c];
}

/** is (x, z) within the box's footprint, grown by margin? */
export function inFootprint(b: Collider, x: number, z: number, margin = 0): boolean {
  if (x + margin < b.min.x || x - margin > b.max.x || z + margin < b.min.z || z - margin > b.max.z) return false;
  if (!b.turn) return true;
  const [lx, lz] = toLocal(b.turn, x, z);
  return Math.abs(lx) <= b.turn.hw + margin && Math.abs(lz) <= b.turn.hd + margin;
}

export class CollisionWorld {
  boxes: Collider[] = [];

  add(min: THREE.Vector3, max: THREE.Vector3, climbable = true): Collider {
    const c = { min: min.clone(), max: max.clone(), climbable };
    this.boxes.push(c);
    return c;
  }

  addBox(cx: number, cz: number, w: number, d: number, y0: number, y1: number, climbable = true) {
    return this.add(
      new THREE.Vector3(cx - w / 2, y0, cz - d / 2),
      new THREE.Vector3(cx + w / 2, y1, cz + d / 2),
      climbable,
    );
  }

  /**
   * A flight of stairs as a smooth slope: footprint x0..x1 × z0..z1, its top rising from y0 at the end where
   * `axis` = a to y1 where it = b, solid below down to `base`. Walking up it is continuous – no step snapping.
   */
  addRamp(x0: number, x1: number, z0: number, z1: number, axis: 'x' | 'z', a: number, b: number, y0: number, y1: number, base: number) {
    const c = this.add(new THREE.Vector3(x0, base, z0), new THREE.Vector3(x1, Math.max(y0, y1), z1), false);
    c.ramp = { axis, a, b, y0, y1 };
    return c;
  }

  /** a box of w (along its own x) × d, turned by rot about the vertical axis – the same rotation as a
   *  mesh's rotateY(rot), so the collision hugs a table or cart that stands askew */
  addTurnedBox(cx: number, cz: number, w: number, d: number, rot: number, y0: number, y1: number, climbable = true) {
    const c = Math.cos(rot), s = Math.sin(rot);
    if (Math.abs(s) < 1e-3 || Math.abs(c) < 1e-3) {
      const sw = Math.abs(s) < 1e-3;
      return this.addBox(cx, cz, sw ? w : d, sw ? d : w, y0, y1, climbable);
    }
    const ex = (Math.abs(c) * w + Math.abs(s) * d) / 2, ez = (Math.abs(s) * w + Math.abs(c) * d) / 2;
    const b = this.add(new THREE.Vector3(cx - ex, y0, cz - ez), new THREE.Vector3(cx + ex, y1, cz + ez), climbable);
    // rotateY(rot) maps local (x, z) to (x c + z s, −x s + z c); toLocal applies the inverse
    b.turn = { cx, cz, c, s, hw: w / 2, hd: d / 2 };
    return b;
  }

  /** standing on a flight of stairs (a ramp collider) at (x, y, z)? */
  onRamp(x: number, y: number, z: number): boolean {
    for (const b of this.boxes) {
      if (!b.ramp || x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (Math.abs(topAt(b, x, z) - y) < 0.2) return true;
    }
    return false;
  }

  /** Highest walkable surface under (x,z) that is at or below maxY (with radius tolerance). */
  groundHeight(x: number, z: number, maxY: number, radius = 0.25): number {
    let best = 0;
    for (const b of this.boxes) {
      if (!inFootprint(b, x, z, radius)) continue;
      const top = b.ramp ? topAt(b, Math.max(b.min.x, Math.min(x, b.max.x)), Math.max(b.min.z, Math.min(z, b.max.z))) : b.max.y;
      if (top <= maxY + 1e-3 && top > best) best = top;
    }
    return best;
  }

  /**
   * Push a capsule (feet at pos.y, given height) out of all boxes horizontally.
   * Boxes whose top is within stepHeight of the feet are treated as steps (ignored here,
   * ground snapping lifts the character onto them).
   */
  resolveHorizontal(pos: THREE.Vector3, radius: number, height: number, stepHeight: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (pos.y + height <= b.min.y || pos.y + stepHeight >= b.max.y) continue;
        // a slope only blocks where its surface (at the nearest point of its footprint) is out of step reach
        if (b.ramp && pos.y + stepHeight >= topAt(b, Math.max(b.min.x, Math.min(pos.x, b.max.x)), Math.max(b.min.z, Math.min(pos.z, b.max.z)))) continue;
        if (b.turn) {
          if (this.pushTurned(b, pos, radius)) hit = true;
          continue;
        }
        // closest point on box (XZ) to the circle centre
        const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        } else {
          // centre inside the box: push out along the smallest axis
          const pushes = [
            { v: pos.x - b.min.x + radius, ax: 'x', s: -1 },
            { v: b.max.x - pos.x + radius, ax: 'x', s: 1 },
            { v: pos.z - b.min.z + radius, ax: 'z', s: -1 },
            { v: b.max.z - pos.z + radius, ax: 'z', s: 1 },
          ].sort((a, c) => a.v - c.v)[0];
          if (pushes.ax === 'x') pos.x += pushes.s * pushes.v;
          else pos.z += pushes.s * pushes.v;
        }
      }
    }
    return hit;
  }

  /** resolveHorizontal for a turned box: the same push, done in the box's own frame */
  private pushTurned(b: Collider, pos: THREE.Vector3, radius: number): boolean {
    const t = b.turn!;
    if (pos.x + radius < b.min.x || pos.x - radius > b.max.x || pos.z + radius < b.min.z || pos.z - radius > b.max.z) return false;
    let [lx, lz] = toLocal(t, pos.x, pos.z);
    const qx = Math.max(-t.hw, Math.min(lx, t.hw)), qz = Math.max(-t.hd, Math.min(lz, t.hd));
    let dx = lx - qx, dz = lz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return false;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      lx += (dx / d) * (radius - d);
      lz += (dz / d) * (radius - d);
    } else {
      const px = t.hw - Math.abs(lx) + radius, pz = t.hd - Math.abs(lz) + radius;
      if (px < pz) lx += Math.sign(lx || 1) * px;
      else lz += Math.sign(lz || 1) * pz;
    }
    // back to the world frame (inverse of toLocal)
    pos.x = t.cx + lx * t.c + lz * t.s;
    pos.z = t.cz - lx * t.s + lz * t.c;
    return true;
  }

  /** Ceiling above the head (lowest box bottom above feet that overlaps). */
  ceiling(pos: THREE.Vector3, radius: number, fromY: number): number {
    let best = Infinity;
    for (const b of this.boxes) {
      if (b.ramp || !inFootprint(b, pos.x, pos.z, radius)) continue;
      if (b.min.y >= fromY && b.min.y < best) best = b.min.y;
    }
    return best;
  }

  /**
   * Find a ledge the player can mantle onto: a climbable box in front of the player
   * whose top is between minRise and maxRise above the feet, with free space above it.
   */
  findLedge(pos: THREE.Vector3, dir: THREE.Vector3, radius: number, minRise: number, maxRise: number): THREE.Vector3 | null {
    const probe = new THREE.Vector3(pos.x + dir.x * (radius + 0.45), 0, pos.z + dir.z * (radius + 0.45));
    let bestTop = -Infinity;
    let found: Collider | null = null;
    for (const b of this.boxes) {
      if (!b.climbable || b.ramp) continue;
      if (!inFootprint(b, probe.x, probe.z)) continue;
      const rise = b.max.y - pos.y;
      if (rise < minRise || rise > maxRise) continue;
      if (b.max.y > bestTop) {
        bestTop = b.max.y;
        found = b;
      }
    }
    if (!found) return null;
    // target point: a bit onto the top surface
    const target = new THREE.Vector3(pos.x + dir.x * (radius + 0.7), found.max.y, pos.z + dir.z * (radius + 0.7));
    // clamp inside the box top
    target.x = Math.max(found.min.x + 0.2, Math.min(found.max.x - 0.2, target.x));
    target.z = Math.max(found.min.z + 0.2, Math.min(found.max.z - 0.2, target.z));
    // something sitting on the ledge (e.g. a higher wall) blocks it
    for (const b of this.boxes) {
      if (b === found) continue;
      if (!inFootprint(b, target.x, target.z)) continue;
      if (b.min.y < found.max.y + 1.7 && b.max.y > found.max.y + 0.05) return null;
    }
    return target;
  }

  /** Ray vs all boxes. Returns distance to the first hit or Infinity. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = maxDist;
    let any = false;
    for (const b of this.boxes) {
      const t = b.turn ? this.rayTurned(b, origin, dir) : b.ramp ? this.rayRamp(b, origin, dir, best) : rayBox(origin, dir, b.min, b.max);
      if (t !== null && t < best) {
        best = t;
        any = true;
      }
    }
    return any ? best : Infinity;
  }

  /** ray vs the solid part of a slope: march through its box and stop where the ray dips below the surface */
  private rayRamp(b: Collider, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    const inside = origin.x >= b.min.x && origin.x <= b.max.x && origin.z >= b.min.z && origin.z <= b.max.z && origin.y >= b.min.y && origin.y <= b.max.y;
    const t0 = inside ? 0 : rayBox(origin, dir, b.min, b.max);
    if (t0 === null || t0 > maxDist) return null;
    for (let k = 0; k <= 40; k++) {
      const t = t0 + k * 0.15;
      if (t > maxDist) return null;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (x < b.min.x - 1e-3 || x > b.max.x + 1e-3 || z < b.min.z - 1e-3 || z > b.max.z + 1e-3 || y < b.min.y - 1e-3 || y > b.max.y + 1e-3) return null;
      if (y <= topAt(b, x, z)) return t;
    }
    return null;
  }

  private rayTurned(b: Collider, origin: THREE.Vector3, dir: THREE.Vector3): number | null {
    if (rayBox(origin, dir, b.min, b.max) === null && !(origin.x >= b.min.x && origin.x <= b.max.x && origin.z >= b.min.z && origin.z <= b.max.z)) return null;
    const t = b.turn!;
    const [ox, oz] = toLocal(t, origin.x, origin.z);
    _o.set(ox, origin.y, oz);
    _d.set(dir.x * t.c - dir.z * t.s, dir.y, dir.x * t.s + dir.z * t.c);
    _mn.set(-t.hw, b.min.y, -t.hd);
    _mx.set(t.hw, b.max.y, t.hd);
    return rayBox(_o, _d, _mn, _mx);
  }

  /** Line of sight between two points (true = nothing in between). */
  visible(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return true;
    dir.divideScalar(len);
    return this.raycast(a, dir, len - 0.05) === Infinity;
  }
}

export function rayBox(o: THREE.Vector3, d: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[ax]) < 1e-9) {
      if (o[ax] < min[ax] || o[ax] > max[ax]) return null;
    } else {
      let t1 = (min[ax] - o[ax]) / d[ax];
      let t2 = (max[ax] - o[ax]) / d[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : null;
}
