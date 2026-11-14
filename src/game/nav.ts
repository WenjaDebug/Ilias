import * as THREE from 'three';
import { CollisionWorld, inFootprint } from './collision';

/**
 * Coarse navigation grid for the guards: a cell is open when its centre and a ring of points around it
 * are free of anything a walking man would run into. A* over the open cells gives a route; the guard then
 * cuts corners wherever the straight line is clear (string pulling), so he never walks into a wall.
 */
export class NavGrid {
  readonly open: Uint8Array;
  constructor(
    private world: CollisionWorld,
    readonly x0: number,
    readonly z0: number,
    readonly nx: number,
    readonly nz: number,
    readonly cell: number,
    inStreets: (x: number, z: number) => boolean,
  ) {
    this.open = new Uint8Array(nx * nz);
    const r = 0.45;
    const probes: [number, number][] = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
        if (!inStreets(cx, cz)) continue;
        let ok = true;
        for (const [dx, dz] of probes) if (this.blockedAt(cx + dx, cz + dz)) { ok = false; break; }
        if (ok) this.open[i + j * nx] = 1;
      }
    }
  }

  /** something between knee and head height standing here? */
  private blockedAt(x: number, z: number) {
    for (const b of this.world.boxes) {
      if (!inFootprint(b, x, z)) continue;
      if (b.min.y < 1.2 && b.max.y > 0.6) return true;
    }
    return false;
  }

  private cellOf(p: THREE.Vector3): [number, number] {
    return [
      THREE.MathUtils.clamp(Math.floor((p.x - this.x0) / this.cell), 0, this.nx - 1),
      THREE.MathUtils.clamp(Math.floor((p.z - this.z0) / this.cell), 0, this.nz - 1),
    ];
  }

  private nearestOpen(i: number, j: number): [number, number] {
    if (this.open[i + j * this.nx]) return [i, j];
    for (let rad = 1; rad < 4; rad++) {
      for (let a = -rad; a <= rad; a++) {
        for (let b = -rad; b <= rad; b++) {
          const x = i + a, y = j + b;
          if (x < 0 || y < 0 || x >= this.nx || y >= this.nz) continue;
          if (this.open[x + y * this.nx]) return [x, y];
        }
      }
    }
    return [i, j];
  }

  /** straight line at waist height clear of walls (checked along three parallel rays)? */
  clear(a: THREE.Vector3, b: THREE.Vector3, radius = 0.4) {
    const d = _d.subVectors(b, a).setY(0);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    const side = _s.set(-d.z, 0, d.x);
    for (const k of [-radius, 0, radius]) {
      _a.set(a.x + side.x * k, 0.9, a.z + side.z * k);
      if (this.world.raycast(_a, d, len) < len) return false;
    }
    return true;
  }

  /** route from `from` to `to` as world points (the start is not included); empty when `to` is in reach */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const [si, sj] = this.nearestOpen(...this.cellOf(from));
    const [ti, tj] = this.nearestOpen(...this.cellOf(to));
    const n = this.nx * this.nz;
    const start = si + sj * this.nx, goal = ti + tj * this.nx;
    if (start === goal) return [to.clone()];
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const openList: number[] = [start];
    const f = new Float32Array(n).fill(Infinity);
    const h = (c: number) => {
      const dx = (c % this.nx) - ti, dz = Math.floor(c / this.nx) - tj;
      return Math.hypot(dx, dz);
    };
    g[start] = 0;
    f[start] = h(start);
    let found = false;
    let iter = 0;
    while (openList.length && iter++ < 20000) {
      // pick the cheapest (the lists are short enough for a scan)
      let bi = 0;
      for (let k = 1; k < openList.length; k++) if (f[openList[k]] < f[openList[bi]]) bi = k;
      const c = openList[bi];
      openList[bi] = openList[openList.length - 1];
      openList.pop();
      if (c === goal) { found = true; break; }
      closed[c] = 1;
      const ci = c % this.nx, cj = Math.floor(c / this.nx);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          if (!a && !b) continue;
          const x = ci + a, y = cj + b;
          if (x < 0 || y < 0 || x >= this.nx || y >= this.nz) continue;
          const nc = x + y * this.nx;
          if (!this.open[nc] || closed[nc]) continue;
          // no cutting through the corner between two blocked cells
          if (a && b && (!this.open[ci + a + cj * this.nx] || !this.open[ci + (cj + b) * this.nx])) continue;
          const cost = g[c] + (a && b ? 1.414 : 1);
          if (cost < g[nc]) {
            g[nc] = cost;
            f[nc] = cost + h(nc);
            came[nc] = c;
            if (!openList.includes(nc)) openList.push(nc);
          }
        }
      }
    }
    if (!found) return [];
    const cells: number[] = [];
    for (let c = goal; c !== -1 && c !== start; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => new THREE.Vector3(this.x0 + ((c % this.nx) + 0.5) * this.cell, 0, this.z0 + (Math.floor(c / this.nx) + 0.5) * this.cell));
    pts.push(to.clone());
    // string pulling: from each point, jump to the furthest later point that is in clear line
    const out: THREE.Vector3[] = [];
    let cur = from;
    let idx = 0;
    while (idx < pts.length) {
      let best = idx;
      for (let k = pts.length - 1; k > idx; k--) {
        if (this.clear(cur, pts[k])) { best = k; break; }
      }
      out.push(pts[best]);
      cur = pts[best];
      idx = best + 1;
    }
    return out;
  }
}

const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3();
