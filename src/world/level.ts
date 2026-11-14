import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld, inFootprint } from '../game/collision';
import { Fire } from '../fx/fire';
import { NavGrid } from '../game/nav';
import type { Collider } from '../game/collision';
import { planks, makeMaterial, worldUVBox, pbrMaterial } from './textures';
import { createHorse, Horse } from './horse';
import { TreeSpec, MountSpec } from './props';

/**
 * Level 1: "Die Nacht des Pferdes".
 * Lower town of Troy at night after the victory feast. Layout (X east, Z south, metres):
 *
 *   z -84..-66  temple terrace (north)
 *   z -64..-32  horse square, the horse stands at (0,-50)
 *   z -32..-4   winding main alley with dead-end side alleys and a courtyard
 *   z  -4..28   feast plaza – sleeping guards around a dying fire
 *   z  28..64   alley to the gate square, the city wall and gate beyond (z ≈ 70)
 *   x  36..104  east of the gate square: the lower town (torch patrols), alleys north to the
 *               palace forecourt and the palace itself (door, hall, corridor, the captain's chamber with the key)
 */

export type Rect = [number, number, number, number]; // x0, z0, x1, z1

export interface GuardSpawn {
  pos: THREE.Vector3;
  facing: number; // yaw, 0 = facing +Z
  mode: 'stand' | 'sleep' | 'patrol';
  patrol?: THREE.Vector3[];
  hasBow?: boolean;
  /** wears a quiver: drops a few arrows when killed */
  quiver?: boolean;
  /** carries a burning torch (lights him and his surroundings; can be shot out) */
  torch?: boolean;
  kind?: 'guard' | 'captain' | 'hector';
  /** sleepers: which way the body lies (1 = head toward his local -X); random by default */
  lieSide?: 1 | -1;
  /** a panic runner of the finale: runs the patrol route once at full speed and is gone at its end */
  rush?: boolean;
  id: string;
}

export interface StatueSpec {
  x: number;
  z: number;
  rot: number;
  /** top of the pedestal */
  y: number;
}

export interface Level {
  group: THREE.Group;
  world: CollisionWorld;
  nav: NavGrid;
  fires: Fire[];
  horse: Horse;
  guards: GuardSpawn[];
  /** where the "end of this version" trigger is */
  endTrigger: THREE.Box3;
  /** entering this box makes the guard round the corner come out */
  ambushTrigger: THREE.Box3;
  /** checkpoint volumes */
  checkpoints: { id: string; box: THREE.Box3; spawn: THREE.Vector3; yaw: number }[];
  plazaTrigger: THREE.Box3;
  gate: THREE.Object3D;
  /** the gate key on the captain's table */
  key: THREE.Object3D;
  /** the window at the west end of the palace front: the quiet way in */
  cratesPoint: THREE.Vector3;
  /** where the compass points while the key is still in the palace */
  palacePoint: THREE.Vector3;
  gatePoint: THREE.Vector3;
  /** marble warriors to put on their pedestals once the guard model is loaded */
  statues: StatueSpec[];
  /** trees to load from the Blender GLBs (world/props.ts) */
  trees: TreeSpec[];
  /** movable models (gate leaves, bolt, winch …) to clone onto their mounts (world/props.ts) */
  mounts: MountSpec[];
  /** every house block: roof centre, size and height (the fire of the finale starts on the roofs) */
  roofs: { x: number; z: number; w: number; d: number; h: number }[];
  /** the closed gate's collider (removed when it opens) */
  gateBox: Collider;
  /** the great bolt across the inside of the gate (slides east into the tower), its padlock */
  bolt: THREE.Group;
  padlock: THREE.Group;
  /** the gatehouse beside the east tower: its door (pivot, swings open), door collider, the winch and the bell */
  gatehouse: { door: THREE.Group; doorBox: Collider; winch: THREE.Group; winchPoint: THREE.Vector3; bell: THREE.Group; bellPoint: THREE.Vector3; doorPoint: THREE.Vector3 };
  /** the palace tower: entering its top floor starts the duel; where the tower door is */
  hectorTrigger: THREE.Box3;
  towerDoorPoint: THREE.Vector3;
  /** Helena stands here at the balcony, and the end camera flies out over the city from the balcony */
  helenaPoint: THREE.Vector3;
  balconyPoint: THREE.Vector3;
}

const CELL = 4;
const X0 = -56, X1 = 104, Z0 = -64, Z1 = 68;

// walkable rectangles (streets, squares)
const MAIN: Rect[] = [
  [-20, -64, 20, -32], // horse square
  [-4, -32, 0, -20], // alley A1
  [-4, -24, 4, -20], // jog
  [0, -24, 4, -4], // alley A3
  [-20, -4, 24, 28], // feast plaza
  [12, 28, 16, 52], // alley B
  [12, 48, 24, 52], // jog
  [20, 48, 24, 60], // alley B2
  [8, 56, 36, 68], // gate square
  // east: lower town and the way up to the palace
  [36, 58, 60, 62], // street east from the gate square
  [58, 44, 80, 64], // lower-town square (well, torch patrols)
  [66, 28, 70, 44], // alley north
  [66, 24, 86, 28], // bend east
  [82, 8, 86, 24], // alley north 2
  [70, -16, 100, 8], // palace forecourt
  [74, -44, 100, -16], // palace court (inside the compound wall; the east wall sits in the last cell)
];
const SIDE: Rect[] = [
  [-16, -28, -4, -24], // side alley west, dead end
  [4, -16, 12, -12], // side alley east...
  [12, -20, 20, -8], // ...into a little courtyard
  [-32, -48, -20, -44], // off the horse square, west
  [20, -40, 32, -36], // off the horse square, east
  [-32, 8, -20, 12], // off the plaza, west
  [24, 16, 36, 20], // off the plaza, east
  [-8, 28, -4, 40], // off the plaza, south
  [16, 36, 24, 40], // little niche from alley B
  [60, 36, 66, 40], // dead end off the alley north
  [86, 14, 94, 18], // dead end off alley north 2
  [48, 52, 58, 56], // nook off the street east
];

/** cells kept free of houses: the palace tower and the yard under its balcony */
const RESERVED: Rect[] = [[84, -60, 104, -44]];
/** blocks under the rooftop route (west of the main alley, horse square → plaza) share one roof height */
const ROOF_ROUTE: Rect[] = [[-12, -32, -4, -4]];
const ROOF_H = 4.5;

export function inStreets(x: number, z: number) {
  return inRects(x, z, MAIN) || inRects(x, z, SIDE);
}

function inRects(x: number, z: number, rects: Rect[]) {
  return rects.some(([a, b, c, d]) => x >= a && x < c && z >= b && z < d);
}

export function buildLevel(scene: THREE.Scene): Level {
  const group = new THREE.Group();
  scene.add(group);
  const world = new CollisionWorld();
  const fires: Fire[] = [];
  const rand = mulberry(1234);

  // walls: warm clay plaster (two variants), stone for temple & city wall, cobbles, dried mud, old wood
  const plasterMat = pbrMaterial('clay_plaster', { color: 0xe0b890 });
  const plasterMat2 = pbrMaterial('plastered_stone_wall', { color: 0xd0a078 });
  const stoneMat = pbrMaterial('large_sandstone_blocks', { color: 0xd8b890 });
  const pavingMat = pbrMaterial('cobblestone_large_01', { color: 0xb09078 });
  const dirtMat = pbrMaterial('brown_mud_dry');
  const woodMat = pbrMaterial('medieval_wood', { color: 0xa08060 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0605, roughness: 1 });

  // ---------- ground ----------
  const groundGeo = new THREE.PlaneGeometry(240, 260, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  const guv = groundGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 80, guv.getY(i) * 86);
  const ground = new THREE.Mesh(groundGeo, pavingMat);
  ground.receiveShadow = true;
  group.add(ground);
  // dirt in the side alleys
  const dirtGeos: THREE.BufferGeometry[] = [];
  for (const [a, b, c, d] of SIDE) {
    const g = new THREE.PlaneGeometry(c - a, d - b);
    g.rotateX(-Math.PI / 2);
    g.translate((a + c) / 2, 0.01, (b + d) / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (c - a) / 3, uv.getY(i) * (d - b) / 3);
    dirtGeos.push(g);
  }
  const dirtMesh = new THREE.Mesh(mergeGeometries(dirtGeos), dirtMat);
  dirtMesh.receiveShadow = true;
  group.add(dirtMesh);

  // ---------- houses (fill every non-walkable cell, merged into blocks) ----------
  const nx = (X1 - X0) / CELL, nz = (Z1 - Z0) / CELL;
  const used: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    used.push([]);
    for (let j = 0; j < nz; j++) {
      const cx = X0 + i * CELL + CELL / 2, cz = Z0 + j * CELL + CELL / 2;
      used[i].push(inRects(cx, cz, MAIN) || inRects(cx, cz, SIDE));
    }
  }
  const walkable = used.map((r) => r.slice());
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (inRects(X0 + i * CELL + CELL / 2, Z0 + j * CELL + CELL / 2, RESERVED)) used[i][j] = true;
  const roofs: Level['roofs'] = [];
  const houseGeos: THREE.BufferGeometry[][] = [[], []];
  const trimGeos: THREE.BufferGeometry[] = [];
  const woodGeos: THREE.BufferGeometry[] = [];
  const darkGeos: THREE.BufferGeometry[] = [];
  const windowGeos: THREE.BufferGeometry[] = [];
  const isWalk = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && walkable[i][j];

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (used[i][j]) continue;
      // grow a rectangle up to 3x3 cells
      let w = 1, d = 1;
      const maxW = 1 + Math.floor(rand() * 3), maxD = 1 + Math.floor(rand() * 3);
      while (w < maxW && i + w < nx && !used[i + w][j]) w++;
      outer: while (d < maxD && j + d < nz) {
        for (let k = 0; k < w; k++) if (used[i + k][j + d]) break outer;
        d++;
      }
      for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) used[i + a][j + b] = true;

      const x0 = X0 + i * CELL, z0 = Z0 + j * CELL;
      const W = w * CELL, D = d * CELL;
      // does this block touch a street? interior blocks can stay low and simple
      let touches = false;
      for (let a = -1; a <= w; a++) for (let b = -1; b <= d; b++) if (isWalk(i + a, j + b)) touches = true;
      let h = touches ? 4 + Math.floor(rand() * 4) : 5 + Math.floor(rand() * 3);
      // the rooftop route keeps one level so it can be walked without jumping
      if (ROOF_ROUTE.some(([a, b, c, d]) => x0 < c && x0 + W > a && z0 < d && z0 + D > b)) h = ROOF_H;
      addHouse(x0, z0, W, D, h, touches, i, j, w, d);
    }
  }

  function addHouse(x0: number, z0: number, W: number, D: number, h: number, touches: boolean, ci: number, cj: number, cw: number, cd: number) {
    const cx = x0 + W / 2, cz = z0 + D / 2;
    // slight inset so neighbouring blocks read as separate houses
    const inset = 0.08;
    const g = new THREE.BoxGeometry(W - inset, h, D - inset);
    worldUVBox(g, W, h, D, 4);
    g.translate(cx, h / 2, cz);
    houseGeos[rand() < 0.5 ? 0 : 1].push(g);
    world.addBox(cx, cz, W - inset, D - inset, 0, h, true);
    roofs.push({ x: cx, z: cz, w: W, d: D, h });

    // roof parapet, sometimes with stepped merlons
    const ph = 0.35, pt = 0.25;
    const stepped = touches && rand() < 0.35;
    const edges: [number, number, number, number][] = [
      [cx, z0 + pt / 2, W, pt], [cx, z0 + D - pt / 2, W, pt],
      [x0 + pt / 2, cz, pt, D], [x0 + W - pt / 2, cz, pt, D],
    ];
    for (const [ex, ez, ew, ed] of edges) {
      const pg = new THREE.BoxGeometry(ew, ph, ed);
      worldUVBox(pg, ew, ph, ed, 4);
      pg.translate(ex, h + ph / 2, ez);
      trimGeos.push(pg);
      world.addBox(ex, ez, ew, ed, h, h + ph, true);
      if (stepped) {
        const len = Math.max(ew, ed);
        const n = Math.floor(len / 1.6);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          const mx = ew > ed ? ex + t * len : ex;
          const mz = ew > ed ? ez : ez + t * len;
          // stepped merlon: two stacked blocks
          for (const [sw, sh, sy] of [[0.8, 0.45, 0], [0.45, 0.4, 0.45]] as const) {
            const mg = new THREE.BoxGeometry(ew > ed ? sw : pt + 0.02, sh, ew > ed ? pt + 0.02 : sw);
            mg.translate(mx, h + ph + sy + sh / 2, mz);
            trimGeos.push(mg);
          }
        }
      }
    }

    if (!touches) return;
    // facade details on faces that front a street
    const faces: { side: 'n' | 's' | 'w' | 'e'; open: boolean }[] = [
      { side: 'n', open: rangeWalk(ci, cj - 1, cw, 1) },
      { side: 's', open: rangeWalk(ci, cj + cd, cw, 1) },
      { side: 'w', open: rangeWalk(ci - 1, cj, 1, cd) },
      { side: 'e', open: rangeWalk(ci + cw, cj, 1, cd) },
    ];
    for (const f of faces) {
      if (!f.open) continue;
      const along = f.side === 'n' || f.side === 's' ? W : D;
      const normal = f.side === 'n' ? [0, -1] : f.side === 's' ? [0, 1] : f.side === 'w' ? [-1, 0] : [1, 0];
      const faceX = f.side === 'w' ? x0 : f.side === 'e' ? x0 + W : cx;
      const faceZ = f.side === 'n' ? z0 : f.side === 's' ? z0 + D : cz;
      const place = (t: number, y: number, ww: number, hh: number, depth: number, list: THREE.BufferGeometry[], out = 0.02) => {
        const horizontal = f.side === 'n' || f.side === 's';
        const geo = new THREE.BoxGeometry(horizontal ? ww : depth, hh, horizontal ? depth : ww);
        const px = horizontal ? faceX + t : faceX + normal[0] * (out - depth / 2 + 0.001);
        const pz = horizontal ? faceZ + normal[1] * (out - depth / 2 + 0.001) : faceZ + t;
        geo.translate(px, y, pz);
        list.push(geo);
      };
      // door with a lintel and stone jambs, sometimes a cloth awning on two poles
      if (rand() < 0.7) {
        const t = (rand() - 0.5) * (along - 2.4);
        place(t, 1.05, 1.1, 2.1, 0.1, darkGeos);
        place(t, 2.2, 1.5, 0.18, 0.25, woodGeos, 0.12); // lintel
        for (const sgn of [-1, 1]) place(t + sgn * 0.62, 1.05, 0.14, 2.1, 0.08, trimGeos, 0.05);
        place(t, 0.03, 1.4, 0.06, 0.5, trimGeos, 0.25); // threshold step
      }
      // a stone plinth along the foot of the wall and a cornice under the parapet
      place(0, 0.3, along - 0.3, 0.6, 0.08, trimGeos, 0.08);
      place(0, h - 0.12, along + 0.2, 0.24, 0.22, trimGeos, 0.12);
      // windows: small openings in wooden frames with a sill, some shuttered, a few warmly lit
      const nWin = Math.floor(along / 3.5);
      let balconyDone = false;
      for (let k = 0; k < nWin; k++) {
        if (rand() < 0.35) continue;
        const t = ((k + 0.5) / nWin - 0.5) * along;
        const y = h > 5 ? 3.6 + rand() * 0.6 : 2.9;
        place(t, y, 0.55, 0.7, 0.1, rand() < 0.18 ? windowGeos : darkGeos);
        place(t, y + 0.42, 0.8, 0.1, 0.16, woodGeos, 0.08); // lintel
        place(t, y - 0.42, 0.8, 0.07, 0.2, woodGeos, 0.1); // sill
        const r = rand();
        if (r < 0.4) {
          // open shutters either side
          for (const sgn of [-1, 1]) place(t + sgn * 0.44, y, 0.3, 0.74, 0.05, woodGeos, 0.05);
        } else if (r < 0.55 && h > 5 && !balconyDone && along > 5) {
          // a small wooden balcony: deck on two brackets, posts and a rail
          balconyDone = true;
          place(t, y - 0.55, 2.0, 0.12, 0.9, woodGeos, 0.9);
          for (const sgn of [-0.7, 0.7]) place(t + sgn, y - 0.8, 0.14, 0.4, 0.7, darkGeos, 0.7);
          for (const sgn of [-0.95, 0.95]) place(t + sgn, y - 0.05, 0.08, 0.9, 0.08, woodGeos, 0.86);
          place(t, y + 0.35, 2.0, 0.08, 0.08, woodGeos, 0.86);
          place(t, y - 0.15, 2.0, 0.05, 0.05, woodGeos, 0.86);
        }
        // ground-floor window with a wooden grille on larger houses
        if (h > 5 && rand() < 0.35) {
          place(t, 1.7, 0.5, 0.6, 0.1, darkGeos);
          for (const o of [-0.12, 0.12]) place(t + o, 1.7, 0.05, 0.62, 0.05, woodGeos, 0.03);
        }
      }
      // protruding roof beams (vigas)
      if (rand() < 0.6) {
        const n = Math.floor(along / 1.2);
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n - 0.5) * along;
          place(t, h - 0.35, 0.16, 0.16, 0.9, woodGeos, 0.5);
        }
      }
    }
  }
  function rangeWalk(i: number, j: number, w: number, d: number) {
    for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) if (isWalk(i + a, j + b)) return true;
    return false;
  }

  const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // ---------- temple terrace in the north ----------
  const templeGeos: THREE.BufferGeometry[] = [];
  const box = (list: THREE.BufferGeometry[], cx: number, cy: number, cz: number, w: number, h: number, d: number, tile = 4) => {
    const g = new THREE.BoxGeometry(w, h, d);
    worldUVBox(g, w, h, d, tile);
    g.translate(cx, cy, cz);
    list.push(g);
  };
  // stepped podium: 8 steps of 0.4m from z=-64 northward
  for (let s = 0; s < 8; s++) {
    const top = (s + 1) * 0.4;
    const zFront = -64 - s * 0.5;
    box(templeGeos, 0, top / 2, (zFront + -86) / 2, 44 - s * 0.2, top, -86 - zFront);
    world.addBox(0, (zFront - 86) / 2, 44 - s * 0.2, -86 - zFront + 0.001, 0, top, true);
  }
  const podTop = 3.2;
  // columns
  for (let k = 0; k < 8; k++) {
    const x = -15.75 + k * 4.5;
    const col = new THREE.CylinderGeometry(0.75, 0.85, 8, 16, 1);
    const cuv = col.attributes.uv as THREE.BufferAttribute;
    for (let q = 0; q < cuv.count; q++) cuv.setXY(q, cuv.getX(q) * 1.5, cuv.getY(q) * 2);
    col.translate(x, podTop + 4, -70);
    templeGeos.push(col);
    box(templeGeos, x, podTop + 0.2, -70, 2.0, 0.4, 2.0);
    box(templeGeos, x, podTop + 8.2, -70, 2.0, 0.4, 2.0);
    world.addBox(x, -70, 1.5, 1.5, podTop, podTop + 8, false);
  }
  box(templeGeos, 0, podTop + 9.2, -74, 38, 1.6, 10); // architrave & roof slab
  box(templeGeos, 0, podTop + 5, -79, 36, 10, 1.5); // back wall
  box(templeGeos, -18.3, podTop + 5, -74.5, 1.4, 10, 9); // side walls
  box(templeGeos, 18.3, podTop + 5, -74.5, 1.4, 10, 9);
  world.addBox(0, -79, 36, 1.5, podTop, podTop + 10, false);
  world.addBox(-18.3, -74.5, 1.4, 9, podTop, podTop + 10, false);
  world.addBox(18.3, -74.5, 1.4, 9, podTop, podTop + 10, false);
  box(darkGeos, 0, podTop + 2.2, -78.2, 3.2, 4.4, 0.2); // dark temple doorway
  addMerged(templeGeos, stoneMat);

  // ---------- city wall + gate in the south ----------
  const wallGeos: THREE.BufferGeometry[] = [];
  const wallZ = 70, wallH = 11, wallT = 4;
  const gateX = 22, gateW = 7;
  for (const [a, c] of [[-60, gateX - gateW / 2 - 3], [gateX + gateW / 2 + 3, 60]] as const) {
    box(wallGeos, (a + c) / 2, wallH / 2, wallZ, c - a, wallH, wallT);
    world.addBox((a + c) / 2, wallZ, c - a, wallT, 0, wallH, false);
    // stepped crenellations
    for (let x = a + 1; x < c - 1; x += 2.2) {
      box(wallGeos, x, wallH + 0.5, wallZ - 1.6, 1.2, 1.0, 0.8);
      box(wallGeos, x, wallH + 1.3, wallZ - 1.6, 0.7, 0.6, 0.8);
    }
  }
  // gate towers
  for (const sx of [-1, 1]) {
    const tx = gateX + sx * (gateW / 2 + 1.5);
    box(wallGeos, tx, 7.5, wallZ - 1, 5, 15, 8);
    world.addBox(tx, wallZ - 1, 5, 8, 0, 15, false);
    for (let k = -1; k <= 1; k++) {
      box(wallGeos, tx + k * 1.6, 15.5, wallZ - 4.6, 1.1, 1.0, 0.8);
      box(wallGeos, tx + k * 1.6, 16.3, wallZ - 4.6, 0.6, 0.6, 0.8);
    }
  }
  box(wallGeos, gateX, wallH + 1.5, wallZ - 1, gateW + 2, 3, 6); // lintel over the gate
  // the gatehouse: a tall block over the gate with a relief band, bigger towers with a battlement walk
  box(wallGeos, gateX, wallH + 3.5, wallZ - 1, gateW + 6, 4, 7);
  for (let k = -2; k <= 2; k++) {
    box(wallGeos, gateX + k * 2.2, wallH + 5.9, wallZ - 4.6, 1.2, 1.0, 0.8);
    box(wallGeos, gateX + k * 2.2, wallH + 6.7, wallZ - 4.6, 0.7, 0.6, 0.8);
  }
  // relief band over the gate (a row of shields and spears, in stone)
  for (let k = -3; k <= 3; k++) {
    const disc = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 14);
    disc.rotateX(Math.PI / 2);
    disc.translate(gateX + k * 1.4, wallH + 3.5, wallZ - 4.55);
    wallGeos.push(disc);
  }
  box(wallGeos, gateX, wallH + 1.1, wallZ - 4.55, gateW + 5, 0.3, 0.3);
  box(wallGeos, gateX, wallH + 5.1, wallZ - 4.55, gateW + 5, 0.3, 0.3);
  // flanking guardians: two stone lions on plinths beside the gate
  for (const sx of [-1, 1]) {
    const bx = gateX + sx * (gateW / 2 + 1.5), bz = wallZ - 6.7; // in front of the towers, clear of the gatehouse
    // the moulded marble plinth and the seated lion both come from Blender (tools/blender/lion.py); placed below
    world.addBox(bx, bz, 1.9, 3.1, 0, 1.2, true);
  }
  addMerged(wallGeos, stoneMat);
  // the gate: two heavy oak leaves from Blender (tools/blender/gateleaf.py), hung on pivots at the towers;
  // the right leaf is the same model mirrored
  const gate = new THREE.Group();
  const mounts: MountSpec[] = [];
  // the leaves hang at the edges of the 5 m passage between the towers and swing INTO the city, so the
  // open leaves lie along the tower faces and stay in view (the model is 3.5 m wide: scaled to 2.5 m)
  const passage = 5;
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(gateX + sx * passage / 2, 0, wallZ - 1.5);
    mounts.push({ model: 'gate_leaf', parent: pivot, scaleX: -sx * (passage / 2 / 3.5) });
    pivot.name = sx < 0 ? 'gateLeft' : 'gateRight';
    gate.add(pivot);
  }
  group.add(gate);
  const gateBox = world.addBox(gateX, wallZ - 1.5, gateW, 0.6, 0, wallH, false);
  // the bolt: a 6 m beam at chest height resting in the brackets on the inside of both leaves, locked
  // with a padlock at its west end; the game slides it east into the tower wall once the lock is off
  const bolt = new THREE.Group();
  bolt.position.set(gateX + 1.4, 1.3, wallZ - 1.5 - 0.25 - 0.22);
  mounts.push({ model: 'bolt', parent: bolt });
  group.add(bolt);
  const padlock = new THREE.Group();
  padlock.position.set(gateX - 1.0, 1.3, wallZ - 1.5 - 0.25 - 0.5);
  mounts.push({ model: 'padlock', parent: padlock });
  group.add(padlock);
  // the gatehouse: a little house against the east tower (tools/blender/gatehouse.py: plaster walls on a
  // stone base, a tiled roof, a shuttered window) where the winch that lifts the gate stands; its door
  // faces the square, barred – the gate captain has its key. The model carries the look, these boxes the collision.
  const ghX0 = 29.5, ghX1 = 36, ghZ0 = 61.5, ghZ1 = 68, ghH = 5.2, ghT = 0.5;
  const ghDoorX = 32.5, ghDoorW = 1.6;
  const gw = (x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = ghH) => world.addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y0, y1, false);
  gw(ghX0, ghDoorX - ghDoorW / 2, ghZ0, ghZ0 + ghT); // north wall, west of the door
  gw(ghDoorX + ghDoorW / 2, ghX1, ghZ0, ghZ0 + ghT);
  gw(ghDoorX - ghDoorW / 2, ghDoorX + ghDoorW / 2, ghZ0, ghZ0 + ghT, 3.0, ghH); // lintel
  gw(ghX1 - ghT, ghX1, ghZ0, ghZ1); // east
  gw(ghX0, ghX1, ghZ1 - ghT, ghZ1); // south (against the city wall)
  gw(ghX0, ghX0 + ghT, ghZ0, 65); // west, up to the tower
  world.addBox((ghX0 + ghX1) / 2, (ghZ0 + ghZ1) / 2, ghX1 - ghX0 + 0.9, ghZ1 - ghZ0 + 0.9, ghH, ghH + 2.3, false); // the roof's volume
  const ghDoor = new THREE.Group();
  ghDoor.position.set(ghDoorX - ghDoorW / 2, 0, ghZ0 + ghT / 2);
  mounts.push({ model: 'door', parent: ghDoor, position: [ghDoorW / 2, 0, 0] });
  group.add(ghDoor);
  const ghDoorBox = world.addBox(ghDoorX, ghZ0 + ghT / 2, ghDoorW, 0.3, 0, 3.0, false);
  const winch = new THREE.Group();
  // the capstan (tools/blender/gate.py): Odysseus pushes one of its bars and walks it round; its chain
  // runs west to a pulley on the tower wall
  winch.position.set(32.95, 0, 65.0);
  mounts.push({ model: 'winch', parent: winch });
  group.add(winch);
  world.addBox(32.95, 65.0, 0.95, 0.95, 0, 1.0, false);
  // the alarm bell on its gallows, outside beside the door
  const bell = new THREE.Group();
  bell.position.set(35.2, 0, 60.4);
  bell.rotation.y = -0.4;
  mounts.push({ model: 'bell', parent: bell });
  group.add(bell);
  world.addBox(35.2, 60.4, 0.8, 0.8, 0, 2.6, false);
  const gatehouse = { door: ghDoor, doorBox: ghDoorBox, winch, winchPoint: new THREE.Vector3(32.95, 0, 65.0), bell, bellPoint: new THREE.Vector3(35.2, 0, 60.4), doorPoint: new THREE.Vector3(ghDoorX, 0, ghZ0 - 0.8) };

  // ---------- outer bounds (invisible) ----------
  world.addBox(0, Z0 - 30, 300, 2, 0, 50, false);
  world.addBox(X0 - 2, 0, 2, 300, 0, 50, false);
  world.addBox(X1 + 2, 0, 2, 300, 0, 50, false);

  // Blender props (world/props.ts instances them): every entry is a model placed at (x, y, z), turned by rot
  const trees: TreeSpec[] = [];
  trees.push({ kind: 'gatehouse', x: (ghX0 + ghX1) / 2, y: 0, z: (ghZ0 + ghZ1) / 2, scale: 1, rot: 0 }); // the gatehouse model over its collision boxes
  const prop = (kind: TreeSpec['kind'], x: number, y: number, z: number, scale: number, rot = 0, scaleX?: number) => trees.push({ kind, x, y, z, scale, rot, scaleX });
  // the socket in the east tower's flank that the bolt slides into (tools/blender/gate.py)
  prop('boltslot', gateX + passage / 2, 1.3, wallZ - 1.5 - 0.25 - 0.22, 1.0, 0);

  // ---------- crates, stairs & clutter (also routes onto the roofs) ----------
  /** a planked crate (Blender, tools/blender/feast.py), s metres on a side */
  const crate = (x: number, z: number, s = 1.1, y = 0, rot = 0) => {
    prop('crate', x, y, z, s, rot);
    world.addTurnedBox(x, z, s, s, rot, y, y + s, true);
  };
  /** a wooden footbridge between two roofs across an alley (along z), resting on the parapets */
  const plankBridge = (x: number, z0: number, z1: number, y: number) => {
    const len = z1 - z0, cz = (z0 + z1) / 2, w = 1.5;
    for (const bx of [x - w / 2 + 0.1, x + w / 2 - 0.1]) box(woodGeos, bx, y - 0.1, cz, 0.18, 0.2, len + 0.4, 2);
    const n = Math.floor(len / 0.34);
    for (let k = 0; k < n; k++) box(woodGeos, x, y + 0.03, z0 + 0.17 + k * (len / n), w, 0.06, 0.3, 2);
    // a rope rail on one side
    box(woodGeos, x + w / 2, y + 0.9, cz, 0.06, 0.06, len, 2);
    for (const rz of [z0 + 0.2, z1 - 0.2]) box(woodGeos, x + w / 2, y + 0.45, rz, 0.08, 0.9, 0.08, 2);
    world.addBox(x, cz, w, len + 0.4, y - 0.2, y + 0.06, true);
  };
  // exterior stairs onto a roof: a run of steps against a wall
  const stairs = (x: number, z: number, dirX: number, dirZ: number, n: number, width = 1.2) => {
    for (let s = 0; s < n; s++) {
      const top = (s + 1) * 0.45;
      const px = x + dirX * s * 0.55, pz = z + dirZ * s * 0.55;
      const w = dirX !== 0 ? 0.56 : width, d = dirZ !== 0 ? 0.56 : width;
      box(houseGeos[0], px, top / 2, pz, w, top, d);
      world.addBox(px, pz, w, d, 0, top, true);
    }
  };
  // horse square: crates & stairs near the edges, leading to rooftops
  crate(-18.4, -60.4); crate(-17.2, -60.6, 0.9); crate(-18.3, -60.5, 0.9, 1.1);
  crate(18.4, -34.5); crate(18.3, -35.7, 1.0); crate(17.2, -34.6, 0.8);
  stairs(-19.3, -36, 0, -1, 9);
  // the rooftop route: stairs up from the horse square, over the roofs west of the main alley (a plank
  // bridge crosses the side alley), stairs down to the plaza – a quiet way past the alley guards
  stairs(-13.4, -32.7, 1, 0, 10);
  stairs(-13.4, -3.3, 1, 0, 10);
  plankBridge(-6, -28.2, -23.8, ROOF_H + 0.35);
  crate(-3.4, -30.5); crate(3.3, -10.0); crate(3.4, -6.5, 0.9); crate(3.4, -6.5, 0.8, 0.9);
  crate(-15.4, -27.4); crate(-14.3, -27.5, 0.9); crate(-15.3, -27.4, 0.9, 1.1);
  crate(19.2, -19.2); crate(19.3, -9.0); crate(18.2, -9.2, 0.9);
  stairs(-19.3, 26.5, 0, -1, 10);
  crate(23.3, -3.3); crate(22.2, -3.2, 0.9); crate(23.3, -3.3, 0.9, 1.1);
  crate(15.4, 33); crate(15.3, 44.5); crate(12.6, 44.6, 0.9);
  crate(-30.6, 11.3); crate(35.3, 19.3); crate(-7.4, 39.3);

  // ---------- street dressing: barrels, carts, stalls, hay, trees, statues, banners (also cover) ----------
  const ironMat2 = new THREE.MeshStandardMaterial({ color: 0x241c18, metalness: 0.7, roughness: 0.5 });
  const ironGeos: THREE.BufferGeometry[] = [];
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.55 });
  const marbleGeos: THREE.BufferGeometry[] = [];
  const statues: StatueSpec[] = [];
  // barrels, carts, wheelbarrows and amphorae come from Blender (tools/blender/props.py); only footprints here
  const barrel = (x: number, z: number, y = 0, lying = false) => {
    const rot = rand() * 6.28;
    trees.push({ kind: 'barrel', x, y: y + (lying ? 0.38 : 0), z, scale: 1, rot, lie: lying });
    if (lying) world.addTurnedBox(x, z, 0.95, 0.7, rot, y, y + 0.76, true);
    else world.addBox(x, z, 0.7, 0.7, y, y + 0.95, true);
  };
  /** a painted vase (Blender krater / hydria) standing on the ground, solid */
  const vase = (kind: 'krater' | 'hydria', x: number, z: number, scale: number, rot: number) => {
    trees.push({ kind, x, y: 0, z, scale, rot });
    const r = (kind === 'krater' ? 0.27 : 0.2) * scale, h = (kind === 'krater' ? 0.57 : 0.51) * scale;
    world.addBox(x, z, 2 * r, 2 * r, 0, h, true);
  };
  const cart = (x: number, z: number, rot: number) => {
    trees.push({ kind: 'cart', x, z, scale: 1, rot });
    world.addTurnedBox(x, z, 1.8, 2.4, rot, 0, 1.3, true);
  };
  const barrow = (x: number, z: number, rot: number) => {
    trees.push({ kind: 'wheelbarrow', x, z, scale: 1, rot });
    world.addTurnedBox(x, z, 0.8, 1.9, rot, 0, 0.7, true);
  };
  /** a market stall with a striped awning (Blender, tools/blender/feast.py); cloth is unused now */
  const stall = (x: number, z: number, rot: number, _cloth?: THREE.BufferGeometry[]) => {
    prop('stall', x, 0, z, 1, rot);
    world.addTurnedBox(x, z, 2.6, 1.2, rot, 0, 0.9, true);
  };
  /** a tied straw bale (Blender, tools/blender/feast.py) */
  const hay = (x: number, z: number, rot = 0) => {
    prop('hay', x, 0, z, 1, rot);
    world.addTurnedBox(x, z, 1.2, 0.8, rot, 0, 0.7, true);
  };
  // trees: only the footprint is recorded here, the Blender meshes are loaded by world/props.ts
  const cypress = (x: number, z: number, h = 7) => {
    trees.push({ kind: 'cypress', x, z, scale: h / 7, rot: rand() * Math.PI * 2 });
    world.addBox(x, z, 0.5, 0.5, 0, 2, false);
  };
  const olive = (x: number, z: number, s = 1) => {
    trees.push({ kind: 'olive', x, z, scale: s, rot: rand() * Math.PI * 2 });
    world.addBox(x, z, 0.7, 0.7, 0, 1.8, false);
  };
  /** a marble pedestal (Blender, tools/blender/statue.py): square with mouldings for statues, a fluted
   *  pillar for the busts; returns the top height */
  const pedestal = (x: number, z: number, h: number, w = 0.9, rot = 0) => {
    const square = w >= 1;
    const sc = square ? h / 1.3 : h / 1.4;
    prop(square ? 'pedestal' : 'pillar', x, 0, z, sc, rot);
    const foot = (square ? 1.6 : 0.6) * sc;
    world.addTurnedBox(x, z, foot, foot, rot, 0, h, true);
    return h;
  };
  /** a marble horse (Blender) on a pedestal; the model looks along −Z, so rot = π faces the square */
  const horseStatue = (x: number, z: number, rot: number, h = 1.3) => {
    pedestal(x, z, h, 1.3, rot);
    prop('horse', x, h, z, 0.82, rot);
  };
  const bust = (x: number, z: number, rot: number, h = 1.4) => {
    pedestal(x, z, h, 0.6, rot);
    prop('bust', x, h + 0.02, z, 1.25, rot);
  };
  /** a pedestal; the marble warrior on top comes from the guard model (main.ts, makeStatue) */
  const statue = (x: number, z: number, rot: number, h = 1.1) => {
    pedestal(x, z, h, 1.3, rot);
    statues.push({ x, z, rot, y: h });
  };
  const banner = (x: number, z: number, rot: number, cloth: THREE.BufferGeometry[], h = 3.2) => {
    const pole = new THREE.CylinderGeometry(0.04, 0.05, h, 6);
    pole.translate(x, h / 2, z);
    woodGeos.push(pole);
    const arm = new THREE.BoxGeometry(0.9, 0.05, 0.05);
    arm.rotateY(rot);
    arm.translate(x, h - 0.1, z);
    woodGeos.push(arm);
    const c = new THREE.PlaneGeometry(0.8, 2.2, 1, 4);
    c.translate(0, -1.1, 0);
    c.rotateY(rot);
    c.translate(x, h - 0.15, z);
    cloth.push(c);
    world.addBox(x, z, 0.2, 0.2, 0, 2, false);
  };
  const clothGeos: THREE.BufferGeometry[] = [];
  const clothGeos2: THREE.BufferGeometry[] = [];

  // horse square: cypresses and statues flank the temple steps; carts and barrels give cover near the walls
  for (const x of [-17.5, 17.5]) for (const z of [-60, -52, -44]) cypress(x, z, 6 + rand() * 2);
  horseStatue(-9, -61.5, Math.PI + 0.4); horseStatue(9, -61.5, Math.PI - 0.4);
  cart(-14, -48, 0.4); cart(15, -55, -2.6);
  barrel(-11.5, -37.5); barrel(-10.8, -38.3); barrel(-11.2, -37.9, 0.95); barrel(12, -47, 0, true);
  hay(-16, -36, 0.5); hay(17, -42, -0.3);
  for (const x of [-12, 12]) banner(x, -63.3, 0, clothGeos2, 4);
  // main alley: barrels and a cart to duck behind
  barrel(-3.3, -22.2); barrel(-2.6, -22.6); barrel(3.4, -16.5, 0, true);
  cart(2.2, -8.5, 0.1);
  barrow(-3.4, -11.2, 2.4);
  // feast plaza: market stalls along the edges, hay, barrels, carts
  stall(-15, 0, 0.1, clothGeos2); stall(-11.5, 0.3, 0.1, clothGeos);
  stall(20, 10, Math.PI / 2, clothGeos); stall(20, 14, Math.PI / 2, clothGeos2);
  stall(-6, 26, Math.PI, clothGeos2); stall(6, 26.3, Math.PI, clothGeos);
  cart(-13, 12, 1.3); cart(14, 24, -0.8); barrow(6, 26, 0.6); barrow(-15, 2, -1.9);
  barrel(-4, 8); barrel(-3.3, 8.7); barrel(-3.6, 8.3, 0.95); barrel(8, 2.5, 0, true); barrel(16, 6); barrel(16.6, 6.5);
  hay(-17, 24, 0.2); hay(22, 2, 0.7); hay(0, -2, 0.1);
  olive(-17.5, 11.2, 1.1); olive(21.5, -2, 0.95); // (the first one away from the torch at (-19.75, 16), which blew it out)
  vase('krater', -13.2, 1.6, 1.3, 0.3); vase('hydria', -9.9, 1.4, 1.2, 1.1); vase('krater', 18.6, 11.2, 1.4, 2.0);
  for (const [x, z] of [[-19, 6], [-19, 18], [23, 6], [23, 18]]) banner(x, z, Math.PI / 2, clothGeos2, 3.6);
  // alley B and the gate square: barrels, a cart, hay
  barrel(12.6, 36); barrel(13.3, 36.6); cart(13.5, 58, -0.5); barrel(10, 60); barrel(10.7, 60.6); hay(33, 66, 0.3);
  // lower town: cover around the well and along the street
  cart(64, 50, 0.9); barrow(68, 57, -0.4); cart(75, 47, -0.3); barrel(72, 61); barrel(72.7, 61.6); barrel(60, 61, 0, true); hay(78, 52, 0.4);
  stall(50, 60.5, Math.PI, clothGeos); stall(44, 60.5, Math.PI, clothGeos2);
  olive(62, 46.5, 1.05); olive(71, 45.5, 0.9);
  barrel(66.6, 30.2); barrel(67.2, 30.9); cart(78, 27, Math.PI / 2); barrel(83.4, 16); barrel(83.4, 20, 0, true);
  // palace forecourt: cypresses, statues of kings, carts, barrels
  for (const x of [72, 98]) for (const z of [-12, -4, 4]) cypress(x, z, 7 + rand() * 2);
  statue(80, -13, 0, 1.4); statue(92, -13, 0, 1.4);
  bust(74.5, -2, 0.4); bust(97.5, -2, -0.4);
  for (const lx of [82.4, 89.6]) prop('lion', lx, 4.3, -15.5, 3.2, 0);
  olive(75, 6.5, 1.1); olive(95, 6.5, 1.0);
  cart(75, 2, 0.6); barrow(96, -2, 1.1); barrel(94, 4); barrel(94.7, 4.6); barrel(94.3, 4.3, 0.95); hay(88, 6, 0.2); barrel(78, -8, 0, true);
  // cover to sneak up on the palace door: along the west side a chain of crates, hay, a stall and a cart
  // (low enough to hide a crouching man, close enough to dash between), on the east side crates and hay;
  // the door guards see the open middle of the court well, the flanks only in pieces
  crate(76.4, 6.2, 1.1, 0, 0.2); crate(76.6, 7.3, 0.9, 0, -0.1); crate(76.45, 6.25, 0.8, 1.1, 0.4);
  hay(76.8, -1.6, 1.4); hay(76.7, -2.9, 1.6);
  crate(76.5, -5.3, 1.1, 0, 0.1); crate(75.4, -5.5, 0.9, 0, 0.5);
  stall(74.8, -9.5, Math.PI / 2);
  cart(77.2, -12.4, 1.75);
  crate(96.2, 1.2, 1.1, 0, -0.2); crate(97.2, 1.0, 0.9, 0, 0.3); crate(96.25, 1.2, 0.8, 1.1, 0.1);
  hay(96.4, -5.5, 1.5); hay(96.3, -6.8, 1.45);
  crate(95.8, -10.6, 1.1, 0, 0.25); barrel(97, -10.2); barrel(96.9, -11.1);
  addMerged(marbleGeos, marbleMat);
  addMerged(ironGeos, ironMat2, false);

  // feast plaza: long tables, amphorae, the dying feast fire
  /** a long trestle table (Blender, tools/blender/feast.py; 5 m model stretched to len) with benches
   *  along both sides and what is left of the feast on it; every piece has its own turned collision box */
  const tableGeo = (x: number, z: number, len: number, rot: number) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    // local (lx, lz) → world, the same turn as the model's
    const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * sn, z - lx * sn + lz * c];
    prop('table', x, 0, z, 1, rot, len / 5);
    world.addTurnedBox(x, z, len, 1.0, rot, 0, 0.84, true);
    for (const side of [-1, 1]) {
      const [bx, bz] = at(side * 0.15, side * 0.82);
      prop('bench', bx, 0, bz, 1, rot, (len - 1.2) / 4);
      world.addTurnedBox(bx, bz, len - 1.2, 0.34, rot, 0, 0.45, true);
    }
    for (let k = 0; k < Math.floor(len / 1.8); k++) {
      const lx = -len / 2 + 0.9 + k * 1.8 + (rand() - 0.5) * 0.3;
      const [tx, tz] = at(lx, (rand() - 0.5) * 0.15);
      prop('tableware', tx, 0.84, tz, 1, rot + (rand() < 0.5 ? 0 : Math.PI));
    }
  };
  tableGeo(-8, 4, 6, 0.1);
  tableGeo(10, 18, 7, -0.2);
  tableGeo(-10, 20, 5, Math.PI / 2 + 0.15);
  tableGeo(14, 2, 5, 0.3);

  // amphorae and pithoi (Blender), scattered over the feast plaza and a few corners
  const addAmphora = (x: number, z: number, fallen = false) => {
    const kind = rand() < 0.3 ? 'pithos' : 'amphora';
    const scale = 0.9 + rand() * 0.3;
    const r = (kind === 'pithos' ? 0.37 : 0.275) * scale, h = (kind === 'pithos' ? 0.8 : 1.23) * scale;
    const rot = rand() * 6.28;
    trees.push({ kind, x, y: fallen ? r : 0, z, scale, rot, lie: fallen });
    // solid: a jar is something you walk round (or step over when it lies)
    if (fallen) world.addTurnedBox(x, z, h, 2 * r * 0.85, rot, 0, 2 * r, true);
    else world.addBox(x, z, 2 * r, 2 * r, 0, h, true);
  };
  for (let k = 0; k < 26; k++) {
    const a = rand() * Math.PI * 2, r = 4 + rand() * 12;
    addAmphora(2 + Math.cos(a) * r * 1.3, 12 + Math.sin(a) * r, rand() < 0.4);
  }
  for (const [x, z] of [[-17, -40], [-16.4, -40.5], [16.8, -58], [17.3, -57.2], [2.8, -15], [-2.9, -28], [13, -18], [14, -17.5]]) addAmphora(x, z, rand() < 0.3);

  // garlands of cloth strung across the plaza & alleys (festival)
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x5a1a12, roughness: 0.9, side: THREE.DoubleSide });
  const clothMat2 = new THREE.MeshStandardMaterial({ color: 0xb8903a, roughness: 0.9, side: THREE.DoubleSide });
  const ropeGeos: THREE.BufferGeometry[] = [];
  const garland = (a: THREE.Vector3, b: THREE.Vector3, sag = 1.2) => {
    // the line itself: a sagging rope between the two anchors
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
    }
    ropeGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.04, 6, false));
    // an anchor that doesn't reach a wall gets a wooden mast, so the line never hangs from thin air
    for (const p of [a, b]) {
      const held = world.boxes.some((bx) => inFootprint(bx, p.x, p.z, 0.35) && bx.max.y >= p.y - 0.3);
      if (held) continue;
      const mast = new THREE.CylinderGeometry(0.06, 0.09, p.y + 0.5, 8);
      mast.translate(p.x, (p.y + 0.5) / 2, p.z);
      woodGeos.push(mast);
      const knob = new THREE.SphereGeometry(0.1, 8, 6);
      knob.translate(p.x, p.y + 0.5, p.z);
      woodGeos.push(knob);
      world.addBox(p.x, p.z, 0.25, 0.25, 0, 2.5, false);
    }
    const n = 14;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const p = new THREE.Vector3().lerpVectors(a, b, t + 0.5 / n);
      p.y -= Math.sin((t + 0.5 / n) * Math.PI) * sag;
      const g = new THREE.PlaneGeometry(0.35, 0.5);
      g.translate(0, -0.25, 0);
      g.rotateY(Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2);
      g.translate(p.x, p.y, p.z);
      clothGeos.push(g);
    }
  };
  garland(new THREE.Vector3(-20, 5.5, 2), new THREE.Vector3(24, 5.5, 8));
  garland(new THREE.Vector3(-20, 5, 20), new THREE.Vector3(24, 6, 14));
  garland(new THREE.Vector3(-4, 4.5, -18), new THREE.Vector3(4, 4.5, -16), 0.5);
  garland(new THREE.Vector3(12, 4.5, 40), new THREE.Vector3(16, 4.5, 41), 0.4);
  garland(new THREE.Vector3(-20, 6, -44), new THREE.Vector3(20, 6, -40), 1.6);
  addMerged(clothGeos, clothMat, false);
  addMerged(clothGeos2, clothMat2, false);
  addMerged(ropeGeos, new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 1 }), false);

  // ---------- fires ----------
  const brazierMat = new THREE.MeshStandardMaterial({ color: 0x2a201a, metalness: 0.6, roughness: 0.5 });
  const brazierGeo = (() => {
    const bowl = new THREE.CylinderGeometry(0.5, 0.25, 0.35, 14, 1, true);
    bowl.translate(0, 1.35, 0);
    const stem = new THREE.CylinderGeometry(0.06, 0.08, 1.2, 8);
    stem.translate(0, 0.6, 0);
    const feet = [0, 1, 2].map((k) => {
      const f = new THREE.BoxGeometry(0.06, 0.05, 0.7);
      f.translate(0, 0.03, 0.3);
      f.rotateY((k * Math.PI * 2) / 3);
      return f;
    });
    return mergeGeometries([bowl, stem, ...feet]);
  })();
  const brazier = (x: number, z: number, size = 0.9, intensity = 45) => {
    const b = new THREE.Mesh(brazierGeo, brazierMat);
    b.position.set(x, 0, z);
    group.add(b);
    const f = new Fire(size, intensity);
    f.group.position.set(x, 1.4, z);
    group.add(f.group);
    fires.push(f);
    world.addBox(x, z, 0.5, 0.5, 0, 1.5, false);
    return f;
  };
  /** distance from (x,z) along the sconce arm (local -Z) to the first solid box at height y, or Infinity */
  const wallBehind = (x: number, z: number, yaw: number, y: number) => {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    let best = Infinity;
    for (const b of world.boxes) {
      if (b.min.y > y || b.max.y < y) continue;
      // slab test in 2D
      let t0 = 0, t1 = best;
      for (const [o, d, lo, hi] of [[x, dx, b.min.x, b.max.x], [z, dz, b.min.z, b.max.z]] as [number, number, number, number][]) {
        if (Math.abs(d) < 1e-6) {
          if (o < lo || o > hi) { t0 = 1; t1 = 0; break; }
          continue;
        }
        let ta = (lo - o) / d, tb = (hi - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 < best && t0 >= 0) best = t0;
    }
    return best;
  };
  const torch = (x: number, z: number, yaw: number, y = 2.8, intensity = 22) => {
    const d = wallBehind(x, z, yaw, y);
    if (d < 1.2) {
      // wall sconce: cup plus an iron arm long enough to reach the wall
      const cup = new THREE.CylinderGeometry(0.22, 0.1, 0.2, 10, 1, true);
      const arm = new THREE.BoxGeometry(0.05, 0.05, d + 0.15);
      arm.translate(0, -0.12, -(d + 0.15) / 2 + 0.05);
      const plate = new THREE.BoxGeometry(0.22, 0.3, 0.04);
      plate.translate(0, -0.12, -d + 0.01);
      const s = new THREE.Mesh(mergeGeometries([cup, arm, plate]), brazierMat);
      s.position.set(x, y, z);
      s.rotation.y = yaw;
      s.castShadow = true;
      group.add(s);
    } else {
      // free-standing: an iron torch pole with a tripod foot
      const cup = new THREE.CylinderGeometry(0.22, 0.1, 0.2, 10, 1, true);
      const pole = new THREE.CylinderGeometry(0.035, 0.05, y - 0.1, 8);
      pole.translate(0, -(y - 0.1) / 2 - 0.05, 0);
      const parts: THREE.BufferGeometry[] = [cup, pole];
      for (let k = 0; k < 3; k++) {
        const f = new THREE.BoxGeometry(0.05, 0.05, 0.55);
        f.translate(0, -y + 0.03, 0.25);
        f.rotateY((k * Math.PI * 2) / 3);
        parts.push(f);
      }
      const s = new THREE.Mesh(mergeGeometries(parts), brazierMat);
      s.position.set(x, y, z);
      s.castShadow = true;
      group.add(s);
      world.addBox(x, z, 0.3, 0.3, 0, 1.2, false);
    }
    const f = new Fire(0.45, intensity);
    f.group.position.set(x, y + 0.05, z);
    group.add(f.group);
    fires.push(f);
    return f;
  };

  // horse square: the two guards stand in a pool of light in front of the horse
  brazier(-6, -40, 1.0, 70);
  brazier(6, -41, 1.0, 70);
  brazier(-15, -58, 0.8, 40);
  brazier(15, -36, 0.8, 35);
  torch(-6, -63.75, 0, 4.3, 30);
  torch(6, -63.75, 0, 4.3, 30);
  // main alley
  torch(-3.75, -29, Math.PI / 2, 2.8, 18);
  torch(3.75, -12, -Math.PI / 2, 2.8, 18);
  torch(16, -19.75, 0, 2.8, 14); // courtyard
  // feast plaza: the dying fire + braziers
  const feastFire = new Fire(1.3, 55);
  feastFire.group.position.set(2, 0.1, 12);
  group.add(feastFire.group);
  fires.push(feastFire);
  const logs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const l = new THREE.CylinderGeometry(0.12, 0.14, 1.8, 6);
    l.rotateZ(Math.PI / 2 - 0.25);
    l.rotateY((k / 7) * Math.PI * 2);
    l.translate(2, 0.3, 12);
    logs.push(l);
  }
  const stones: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const s = new THREE.DodecahedronGeometry(0.3, 0);
    s.translate(2 + Math.cos(a) * 1.3, 0.15, 12 + Math.sin(a) * 1.3);
    stones.push(s);
  }
  addMerged(logs, makeMaterial(planks(31), { color: 0x2a1810 }));
  addMerged(stones, stoneMat);
  world.addBox(2, 12, 2.2, 2.2, 0, 0.5, false);
  brazier(-16, -1, 0.8, 30);
  brazier(20, 25, 0.8, 30);
  torch(-19.75, 16, Math.PI / 2, 3, 16);
  // alley B and gate square
  torch(15.75, 45, -Math.PI / 2, 2.8, 18); // lights the alley guard, not the approach
  torch(23.75, 54, -Math.PI / 2, 2.8, 16);
  brazier(12.5, 59, 1.0, 60); // (away from the lions and the gatehouse, which the old spots sat inside)
  brazier(31.5, 57.5, 1.0, 60);
  torch(gateX - gateW / 2 - 0.2, wallZ - 5.2, Math.PI, 5, 40);
  torch(gateX + gateW / 2 + 0.2, wallZ - 5.2, Math.PI, 5, 40);
  // the marble lions (seated, facing the city) on their plinths, and fire bowls on the tower battlements
  for (const sx of [-1, 1]) {
    prop('plinth', gateX + sx * (gateW / 2 + 1.5), 0, wallZ - 6.7, 1.0, 0);
    prop('lionstatue', gateX + sx * (gateW / 2 + 1.5), 1.2, wallZ - 6.7, 1.0, sx * 0.15);
    const tx = gateX + sx * (gateW / 2 + 1.5);
    prop('brazier', tx, 15.0, wallZ - 2.4, 1.0, 0);
    const f = new Fire(1.3, 50);
    f.group.position.set(tx, 15.9, wallZ - 2.4);
    group.add(f.group);
    fires.push(f);
  }
  // the Greek camp on the plain outside: campfires seen through the open gate (sprites only, far from the light pool)
  for (const [cx, cz, cs] of [[8, 92, 1.6], [24, 99, 1.8], [40, 93, 1.5], [-6, 106, 1.4], [52, 108, 1.6], [28, 116, 1.9], [12, 124, 1.5]]) {
    const f = new Fire(cs, 30);
    f.group.position.set(cx, 0.4, cz);
    group.add(f.group);
    fires.push(f);
  }
  torch(36 - 0.3, 64.5, -Math.PI / 2, 2.8, 16); // gatehouse, outside beside the door
  torch(32.6, 68 - 0.55, Math.PI, 2.8, 16); // inside the gatehouse, over the winch
  // lower town: wall torches around the square (all of them can be shot out)
  torch(57.75, 50, Math.PI / 2, 3, 22).shootable = true;
  torch(80.25, 58, -Math.PI / 2, 3, 22).shootable = true;
  torch(72, 64.25, Math.PI, 3, 20).shootable = true;
  torch(62, 43.75, 0, 3, 18).shootable = true;
  torch(65.75, 36, Math.PI / 2, 2.8, 14).shootable = true;
  torch(84, 27.75, Math.PI, 2.8, 14).shootable = true;
  torch(81.75, 12, Math.PI / 2, 2.8, 14).shootable = true;
  // palace forecourt and court
  torch(83, -15.4, 0, 3.2, 26).shootable = true;
  torch(89, -15.4, 0, 3.2, 26).shootable = true;

  // ---------- lower town square: a well ----------
  const wellGeos: THREE.BufferGeometry[] = [];
  const wellRing = new THREE.CylinderGeometry(1.3, 1.4, 0.9, 16, 1, true);
  wellRing.translate(69, 0.45, 54);
  wellGeos.push(wellRing);
  box(wellGeos, 69, 0.05, 54, 2.9, 0.1, 2.9);
  for (const sx of [-1, 1]) box(woodGeos, 69 + sx * 1.1, 1.3, 54, 0.14, 2.6, 0.14);
  box(woodGeos, 69, 2.6, 54, 2.5, 0.14, 0.14);
  addMerged(wellGeos, stoneMat);
  world.addBox(69, 54, 2.8, 2.8, 0, 0.9, true);
  crate(61.4, 45.4); crate(62.5, 45.3, 0.9); crate(78.6, 62.6); crate(77.5, 62.5, 0.9); crate(78.5, 62.6, 0.9, 1.1);
  crate(84.4, 9.4); crate(85.5, 23.2, 0.9); crate(71.5, 6.6);

  // ---------- the palace: a real building – entrance hall, corridor, the captain's chamber, a window round the side ----------
  // The whole building is modelled in Blender (tools/blender/citadel.py → palace_bldg.glb: walls, linings, chequer
  // floors, beamed ceilings, the upper storey with its gable roof, corner towers, door, steps, the captain's kline
  // and the key table). Here only its collision and its lights live; every collider matches a piece of the model.
  const PX0 = 74, PX1 = 98, PZ0 = -44, PZ1 = -16, PH = 6.7, PT = 0.8;
  const doorX = 86, doorW = 3.2;
  prop('palace_bldg', 0, 0, 0, 1, 0);
  world.addBox((PX0 + PX1) / 2, (PZ0 + PZ1) / 2, PX1 - PX0, PZ1 - PZ0, 0, 0.05, true); // the marble floor, 5 cm over the street
  /** a solid wall piece given by its extent (x0..x1, z0..z1, y0..y1) */
  const pw = (x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = PH) => {
    world.addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y0, y1, false);
  };
  const S0 = PZ1 - PT / 2, S1 = PZ1 + PT / 2; // south wall extent in z
  // south wall with the door (open, 4 m high) and a window at the west end (sill 1 m, a climb)
  const winX0 = 76.8, winX1 = 78.4;
  pw(PX0 - PT / 2, winX0, S0, S1);
  world.addBox((winX0 + winX1) / 2, PZ1, winX1 - winX0, PT, 0, 1.0, true); // under the window: climbable sill
  pw(winX0, winX1, S0, S1, 2.9, PH); // over the window
  pw(winX1, doorX - doorW / 2, S0, S1);
  pw(doorX - doorW / 2, doorX + doorW / 2, S0, S1, 4.0, PH); // lintel over the open door
  pw(doorX + doorW / 2, PX1 + PT / 2, S0, S1);
  // the three marble steps up to the door (outside, in front of it)
  for (let st = 0; st < 3; st++) world.addBox(doorX, S1 + 0.175 + st * 0.35, doorW + 2 - st * 0.4, 0.35, 0, 0.12 * (st + 1), true);
  // north wall, with the door into the tower at its east end
  const TDX = 93.0, TDW = 1.6;
  pw(PX0 - PT / 2, TDX - TDW / 2, PZ0 - PT / 2, PZ0 + PT / 2);
  pw(TDX + TDW / 2, PX1 + PT / 2, PZ0 - PT / 2, PZ0 + PT / 2);
  pw(TDX - TDW / 2, TDX + TDW / 2, PZ0 - PT / 2, PZ0 + PT / 2, 3.0, PH); // lintel
  pw(PX0 - PT / 2, PX0 + PT / 2, PZ0, PZ1); // west
  pw(PX1 - PT / 2, PX1 + PT / 2, PZ0, PZ1); // east
  // interior: the entrance hall (x 80..92), store room west (x 75..79.6) with the window, guard room east (92.8..97),
  // the corridor north (x 84.6..87.4, z -37.5..-27) and the captain's chamber at the back (z -43.2..-37.5)
  const HZ0 = -27, CZ0 = -37.5;
  pw(79.6, 80.4, HZ0, -22); pw(79.6, 80.4, -19.6, S0); pw(79.6, 80.4, -22, -19.6, 3.2, PH); // store room | hall
  pw(92.0, 92.8, HZ0, -21.6); pw(92.0, 92.8, -19.0, S0); pw(92.0, 92.8, -21.6, -19.0, 3.2, PH); // hall | guard room
  pw(PX0, 84.6, CZ0, HZ0); // solid mass west of the corridor
  pw(87.4, PX1, CZ0, HZ0); // solid mass east of the corridor
  pw(PX0, PX1, PZ0, PZ1, 4.2, PH); // ceiling / roof mass over everything
  pw(PX0 + 0.4, PX1 - 0.4, -43.7, -30.9, PH, 11.5); // the upper storey
  // Ionic columns (tools/blender/palace.py) in the entrance hall and in the chamber
  for (const [x, z] of [[82.5, -24], [89.5, -24], [82.5, -19.5], [89.5, -19.5], [79, -40.5], [93, -40.5]]) {
    prop('column', x, 0, z, 1.0, 0);
    world.addBox(x, z, 0.85, 0.85, 0, 4.2, false);
  }
  // the captain's kline (head at its west end) and the key table
  world.addBox(85, -41.8, 2.3, 1.3, 0, 0.55, true);
  world.addBox(85 - 1.15, -41.8, 0.12, 1.3, 0, 1.0, false); // the headrest
  barrel(76.3, -25.6); barrel(77.1, -26.0); barrel(76.7, -25.8, 0.95); hay(78.4, -25.6, 0.3);
  // torches inside; a torch beside the window outside as the hint for the second way in
  torch(PX0 + PT / 2 + 0.05, -22, Math.PI / 2, 2.8, 14); // store room
  torch(80.4 + 0.05, -24.5, Math.PI / 2, 3.0, 18); // hall west wall
  torch(92.0 - 0.05, -24.5, -Math.PI / 2, 3.0, 18); // hall east wall
  torch(84.6 + 0.05, -32.5, Math.PI / 2, 2.8, 14); // corridor
  torch(82, PZ0 + PT / 2 + 0.05, 0, 3.0, 20); // chamber north wall
  torch(90, PZ0 + PT / 2 + 0.05, 0, 3.0, 20);
  torch(winX1 + 0.9, S1 + 0.05, 0, 3.0, 18); // outside, beside the window
  // the front: torches either side of the door, fire bowls flanking the steps – the palace glows out of the night
  torch(doorX - 2.5, S1 + 0.05, 0, 3.2, 22);
  torch(doorX + 2.5, S1 + 0.05, 0, 3.2, 22);
  for (const bx of [doorX - 4.2, doorX + 4.2]) {
    prop('brazier', bx, 0, S1 + 1.4, 1.0, 0);
    const f = new Fire(0.9, 34);
    f.group.position.set(bx, 1.05, S1 + 1.4);
    group.add(f.group);
    fires.push(f);
    world.addBox(bx, S1 + 1.4, 0.7, 0.7, 0, 1.1, false);
  }
  // corner towers at the back with fire bowls burning on top (seen from the whole lower town)
  for (const tx of [PX0 + 1.6, PX1 - 1.6]) {
    world.addBox(tx, PZ0 + 1.6, 4.2, 4.2, 0, 14, false);
    const f = new Fire(1.6, 60);
    f.group.position.set(tx, 14.45, PZ0 + 1.6);
    group.add(f.group);
    fires.push(f);
  }
  const hallFloor = 0.05;
  world.addBox(88.2, -41.2, 2.2, 1.0, hallFloor, hallFloor + 0.84, true);
  const keyGroup = new THREE.Group();
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xc89a3a, metalness: 0.9, roughness: 0.3, emissive: 0x3a2808 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 8), keyMat);
  shaft.rotation.z = Math.PI / 2;
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 16), keyMat);
  bow.position.x = -0.18;
  const bit1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.02), keyMat);
  bit1.position.set(0.1, -0.045, 0);
  const bit2 = bit1.clone();
  bit2.position.x = 0.15;
  keyGroup.add(shaft, bow, bit1, bit2);
  keyGroup.position.set(88.2, 0.88 + 0.04, -41.2);
  keyGroup.rotation.y = 0.5;
  keyGroup.traverse((o) => (o.castShadow = true));
  group.add(keyGroup);

  // ---------- the palace tower: three guarded floors and the hall on top, with a balcony over the city ----------
  // Modelled in Blender (citadel.py → tower_bldg.glb). 12 × 13.6 m; a wide dog-leg stair in the east bay: flight A
  // (2.1 m wide) climbs north along the east wall, a landing across the bay, flight B (2.1 m) climbs back south,
  // a spine wall between them; balustrades on the open sides. The flights are smooth slopes for walking.
  const TX0 = 90, TX1 = 102, TZ0 = -58, TZ1 = -44.4, TT = 0.5;
  const IX0 = TX0 + TT, IX1 = TX1 - TT, IZ0 = TZ0 + TT, IZ1 = TZ1 - TT;
  const F1 = 4.5, F2 = 9.0, F3 = 13.5, TROOF = 18.0;
  const FL = [0, F1, F2, F3];
  const WX0 = 97.2, WSP0 = 99.3, WSP1 = 99.4, WX1 = IX1, SZF = -49.5, SZL = -54.0;
  const BAL0 = -52.4, BAL1 = -47.6;
  prop('tower_bldg', 0, 0, 0, 1, 0);
  world.addBox((IX0 + IX1) / 2, (IZ0 + IZ1) / 2, IX1 - IX0, IZ1 - IZ0, 0, 0.05, true); // ground-floor marble, 5 cm over the street
  const tw = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, climbable = false) =>
    world.addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y0, y1, climbable);
  // walls: south (shared with the palace, door at TDX), east, north, west (with the balcony doorway on top)
  tw(TX0, TDX - TDW / 2, TZ1 - TT, TZ1, 0, TROOF);
  tw(TDX + TDW / 2, TX1, TZ1 - TT, TZ1, 0, TROOF);
  tw(TDX - TDW / 2, TDX + TDW / 2, TZ1 - TT, TZ1, 3.0, TROOF);
  tw(TX1 - TT, TX1, TZ0, TZ1, 0, TROOF);
  tw(TX0, TX1, TZ0, TZ0 + TT, 0, TROOF);
  tw(TX0, TX0 + TT, TZ0, BAL0, 0, TROOF);
  tw(TX0, TX0 + TT, BAL1, TZ1, 0, TROOF);
  tw(TX0, TX0 + TT, BAL0, BAL1, 0, F3);
  tw(TX0, TX0 + TT, BAL0, BAL1, F3 + 3.6, TROOF);
  tw(TX0, TX1, TZ0, TZ1, TROOF, TROOF + 0.3); // roof
  const Ay = (z: number, base: number) => base + 2.25 * Math.max(0, Math.min(1, (SZF - z) / (SZF - SZL)));
  const By = (z: number, base: number) => base + 2.25 + 2.25 * Math.max(0, Math.min(1, (z - SZL) / (SZF - SZL)));
  for (let i = 1; i <= 3; i++) {
    // floor slabs with the hole over the stair bay; a rail along the hole's west edge
    tw(IX0, WX0, IZ0, IZ1, FL[i] - 0.3, FL[i], true);
    tw(WX0, IX1, SZF, IZ1, FL[i] - 0.3, FL[i], true);
    tw(WX0 - 0.17, WX0 - 0.03, IZ0, SZF, FL[i], FL[i] + 1.0);
  }
  tw(WSP1, WX1, SZF - 0.1, SZF + 0.06, F3, F3 + 1.0); // top floor: over the foot of the last flight A
  for (let i = 0; i < 3; i++) {
    const base = FL[i];
    const under = (y: number) => (i === 0 ? 0 : y - 0.45);
    // flight A up north, the landing, flight B back south
    world.addRamp(WSP1, WX1, SZL, SZF, 'z', SZF, SZL, base, base + 2.25, under(base));
    tw(WX0, WX1, IZ0, SZL, under(base + 2.25), base + 2.25, true);
    world.addRamp(WX0, WSP0, SZL, SZF, 'z', SZL, SZF, base + 2.25, base + 4.5, under(base + 2.25));
    // the spine wall between the flights (1 m over flight B), the newel post at its south end
    for (let s = 0; s < 9; s++) {
      const za = SZL + ((SZF - SZL) * s) / 9, zb = SZL + ((SZF - SZL) * (s + 1)) / 9;
      tw(WSP0, WSP1, za, zb, i === 0 ? 0 : Ay(zb, base) - 0.45, By(zb, base) + 1.08);
    }
    tw(WSP0 - 0.12, WSP1 + 0.12, SZF - 0.12, SZF + 0.12, Ay(SZF, base), By(SZF, base) + 1.2);
    // balustrade on B's open west side and along the landing's west edge
    for (let s = 0; s < 6; s++) {
      const za = SZL + ((SZF - SZL) * s) / 6, zb = SZL + ((SZF - SZL) * (s + 1)) / 6;
      tw(WX0, WX0 + 0.15, za, zb, By(za, base) - 0.5, By(zb, base) + 1.0);
    }
    tw(WX0, WX0 + 0.15, IZ0, SZL, base + 2.25, base + 3.25);
  }
  // the rooms: Ionic columns, the meander frieze under the ceiling, trophies, a torch on every floor
  for (let i = 0; i < 3; i++) {
    const F = FL[i];
    for (const pz of [-55.0, -47.4]) {
      prop('column', 93.85, F, pz, 1.0, 0);
      world.addBox(93.85, pz, 0.85, 0.85, F, F + 4.2, false);
    }
    for (let x = IX0 + 1.2; x < WX0 - 0.8; x += 2) prop('frieze', x, F + 3.4, IZ0, 1.0, Math.PI);
    for (let z = IZ0 + 1.2; z < IZ1 - 0.8; z += 2) prop('frieze', IX0, F + 3.4, z, 1.0, -Math.PI / 2);
    prop('trophy', IX0 + 0.02, F + 2.0, -51.2, 0.9, -Math.PI / 2);
    torch(IX0 + 0.05, -47.0, Math.PI / 2, F + 2.6, 22);
    torch(IX0 + 0.05, -55.5, Math.PI / 2, F + 2.6, 16);
  }
  // the hall on top: four columns, a mosaic floor, the throne against the south wall, the frieze all round,
  // trophies, braziers either side of the balcony doorway, red cloth on the walls
  for (const [px, pz] of [[92.2, -55.6], [95.6, -55.6], [92.2, -46.8], [95.6, -46.8]]) {
    prop('column', px, F3, pz, 1.0, 0);
    world.addBox(px, pz, 0.85, 0.85, F3, F3 + 4.2, false);
  }
  prop('mosaic', 94.0, F3 + 0.005, -51.2, 1.0, 0);
  prop('throne', 94.0, F3, IZ1 - 0.75, 1.0, 0);
  world.addBox(94.0, IZ1 - 0.75, 1.5, 1.3, F3, F3 + 0.34, true);
  world.addBox(94.0, IZ1 - 0.95, 0.95, 0.9, F3, F3 + 2.0, false);
  for (let x = IX0 + 1.2; x < IX1 - 0.8; x += 2) prop('frieze', x, F3 + 3.4, IZ0, 1.0, Math.PI);
  for (let x = IX0 + 1.2; x < IX1 - 0.8; x += 2) if (Math.abs(x - TDX) > 1.2) prop('frieze', x, F3 + 3.4, IZ1, 1.0, 0);
  for (let z = IZ0 + 1.2; z < IZ1 - 0.8; z += 2) if (z < BAL0 - 1.2 || z > BAL1 + 1.2) prop('frieze', IX0, F3 + 3.4, z, 1.0, -Math.PI / 2);
  for (let z = SZF + 1.0; z < IZ1 - 0.8; z += 2) prop('frieze', IX1, F3 + 3.4, z, 1.0, Math.PI / 2);
  prop('trophy', 94.0, F3 + 2.0, IZ0 + 0.02, 0.9, Math.PI);
  prop('trophy', IX1 - 0.02, F3 + 2.0, -46.6, 0.9, Math.PI / 2);
  for (const pz of [BAL0 - 1.0, BAL1 + 1.0]) {
    prop('brazier', IX0 + 0.8, F3, pz, 0.9, 0);
    const f = new Fire(0.7, 20); // (kept low: four fires in one room washed the cinematic out)
    f.group.position.set(IX0 + 0.8, F3 + 0.95, pz);
    group.add(f.group);
    fires.push(f);
    world.addBox(IX0 + 0.8, pz, 0.7, 0.7, F3, F3 + 1.1, false);
  }
  const towerCloth: THREE.BufferGeometry[] = [];
  for (const zz of [-56.2, -54.6]) {
    const c = new THREE.PlaneGeometry(1.2, 3.0, 1, 4);
    c.rotateY(Math.PI / 2);
    c.translate(IX0 + 0.04, F3 + 2.0, zz);
    towerCloth.push(c);
  }
  addMerged(towerCloth, new THREE.MeshStandardMaterial({ color: 0x6a1410, roughness: 0.9, side: THREE.DoubleSide }), false);
  // the balcony over the yard west of the tower: a marble floor on four piers, balustrade on three sides,
  // fire bowls at its outer corners
  const BX0 = 84.4, BX1 = TX0, BZ0 = -56.6, BZ1 = -45.4;
  tw(BX0, BX1, BZ0, BZ1, F3 - 0.45, F3, true);
  for (const [px, pz] of [[85.0, -56.0], [85.0, -46.0], [87.6, -56.0], [87.6, -46.0]]) world.addBox(px, pz, 1.2, 1.2, 0, F3 - 0.6, false);
  tw(BX0 + 0.05, BX0 + 0.35, BZ0, BZ1, F3, F3 + 1.1);
  tw(BX0, BX1, BZ0 + 0.05, BZ0 + 0.35, F3, F3 + 1.1);
  tw(BX0, BX1, BZ1 - 0.35, BZ1 - 0.05, F3, F3 + 1.1);
  for (const zz of [BZ0 + 0.9, BZ1 - 0.9]) {
    prop('brazier', BX0 + 0.9, F3, zz, 0.9, 0);
    const f = new Fire(0.8, 26);
    f.group.position.set(BX0 + 0.9, F3 + 0.95, zz);
    group.add(f.group);
    fires.push(f);
    world.addBox(BX0 + 0.9, zz, 0.7, 0.7, F3, F3 + 1.1, false);
  }
  const hectorTrigger = new THREE.Box3(new THREE.Vector3(IX0, F3 - 0.4, IZ0), new THREE.Vector3(IX1, F3 + 3, IZ1));
  const towerDoorPoint = new THREE.Vector3(TDX, 0, PZ0 + 1.2);
  const helenaPoint = new THREE.Vector3(BX0 + 1.6, F3, BZ0 + 1.8);
  const balconyPoint = new THREE.Vector3(BX0 + 1.6, F3, (BZ0 + BZ1) / 2);

  // ---------- merge facade geometry ----------
  addMerged(houseGeos[0], plasterMat);
  addMerged(houseGeos[1], plasterMat2);
  addMerged(trimGeos, plasterMat2);
  addMerged(woodGeos, woodMat);
  addMerged(darkGeos, darkMat, false);
  addMerged(windowGeos, new THREE.MeshStandardMaterial({ color: 0x1a0a04, emissive: 0xff7a30, emissiveIntensity: 0.6 }), false);

  // ---------- the horse ----------
  const horse = createHorse(world, new THREE.Vector3(0, 0, -50));
  group.add(horse.group);

  // ---------- guards ----------
  const guards: GuardSpawn[] = [
    // the two guards in front of the horse, backs turned to it, watching the square
    { id: 'horse-l', pos: new THREE.Vector3(-3.2, 0, -41.5), facing: 0.15, mode: 'stand', hasBow: true },
    { id: 'horse-r', pos: new THREE.Vector3(3.4, 0, -42.5), facing: -0.2, mode: 'stand' },
    // sleepers on the feast plaza
    { id: 'sleep-1', pos: new THREE.Vector3(-3, 0, 9), facing: 1.2, mode: 'sleep' },
    { id: 'sleep-2', pos: new THREE.Vector3(6, 0, 15.5), facing: -2.0, mode: 'sleep' },
    { id: 'sleep-3', pos: new THREE.Vector3(-7, 0, 6.2), facing: 0.3, mode: 'sleep' },
    { id: 'sleep-4', pos: new THREE.Vector3(10, 0, 20.2), facing: 2.6, mode: 'sleep' },
    { id: 'sleep-6', pos: new THREE.Vector3(15, 0, 4), facing: 0.8, mode: 'sleep' },
    // round 14: a third more Trojans, spread thin – sleepers in corners, single posts on the way
    { id: 'sq-sleep', pos: new THREE.Vector3(13.5, 0, -37.5), facing: 2.2, mode: 'sleep' },
    { id: 'sleep-7', pos: new THREE.Vector3(-15.5, 0, 22.5), facing: -0.6, mode: 'sleep' },
    // one guard still awake, pacing at the plaza's far side – shoot him from the shadows
    {
      id: 'plaza-patrol', pos: new THREE.Vector3(20, 0, 21), facing: -Math.PI / 2, mode: 'patrol',
      patrol: [new THREE.Vector3(20, 0, 21), new THREE.Vector3(6, 0, 22), new THREE.Vector3(-8, 0, 20), new THREE.Vector3(6, 0, 22)],
    },
    // alley B ambush: one guard watches the alley (shoot him), a second waits round the corner
    // in the niche – out of any bow line – and comes out to fight once you push on
    { id: 'alley-b', pos: new THREE.Vector3(14, 0, 47), facing: Math.PI, mode: 'stand', quiver: true },
    { id: 'corner', pos: new THREE.Vector3(22.5, 0, 38.2), facing: -Math.PI / 2, mode: 'stand', quiver: true },
    // lower town: two torch patrols circle the well, a sleeper in a doorway
    // (the round goes between the carts, the well, the hay and the barrels – no waypoint sits on any of them)
    {
      id: 'u-patrol-1', pos: new THREE.Vector3(60, 0, 47.5), facing: Math.PI / 2, mode: 'patrol', torch: true,
      patrol: [new THREE.Vector3(60, 0, 47.5), new THREE.Vector3(69, 0, 47.5), new THREE.Vector3(72.5, 0, 49.8), new THREE.Vector3(76.5, 0, 49.8), new THREE.Vector3(76.5, 0, 58), new THREE.Vector3(69, 0, 60.5), new THREE.Vector3(61, 0, 59)],
    },
    {
      id: 'u-patrol-2', pos: new THREE.Vector3(76.5, 0, 58), facing: -Math.PI / 2, mode: 'patrol', torch: true,
      patrol: [new THREE.Vector3(76.5, 0, 58), new THREE.Vector3(76.5, 0, 49.8), new THREE.Vector3(72.5, 0, 49.8), new THREE.Vector3(69, 0, 47.5), new THREE.Vector3(60, 0, 47.5), new THREE.Vector3(61, 0, 59), new THREE.Vector3(69, 0, 60.5)],
    },
    { id: 'gate-sleep', pos: new THREE.Vector3(11.5, 0, 63.5), facing: 0.9, mode: 'sleep' },
    { id: 'street-post', pos: new THREE.Vector3(55, 0, 59.4), facing: Math.PI / 2 + 0.3, mode: 'stand', quiver: true },
    { id: 'u-sleep-2', pos: new THREE.Vector3(63.5, 0, 45.8), facing: -2.4, mode: 'sleep' },
    { id: 'u-sleep-1', pos: new THREE.Vector3(59.5, 0, 57), facing: 1.4, mode: 'sleep' },
    // the alley north: one guard at its mouth, one at the top – shoot or sneak past
    { id: 'alley-n-1', pos: new THREE.Vector3(66, 0, 42.5), facing: 0, mode: 'stand', quiver: true },
    { id: 'alley-n-2', pos: new THREE.Vector3(82.5, 0, 10.8), facing: 0, mode: 'stand', hasBow: true },
    { id: 'n2-sleep', pos: new THREE.Vector3(82.9, 0, 21.5), facing: 3.0, mode: 'sleep' },
    { id: 'fore-sleep', pos: new THREE.Vector3(72.5, 0, 5.5), facing: 1.0, mode: 'sleep' },
    // forecourt: a torch patrol in front of the palace door
    {
      id: 'fore-patrol', pos: new THREE.Vector3(79.3, 0, -8), facing: Math.PI / 2, mode: 'patrol', torch: true,
      patrol: [new THREE.Vector3(79.3, 0, -8), new THREE.Vector3(93, 0, -8), new THREE.Vector3(93, 0, -2.5), new THREE.Vector3(78, 0, -2.5)],
    },
    // the palace: two guards at the door, one in the hall facing the door, one in the corridor, a sleeper in the guard room, the captain
    // the door guards face the forecourt: the way in leads past them through the cover of carts and statues
    { id: 'palace-door-l', pos: new THREE.Vector3(84.0, 0, -13.6), facing: -0.25, mode: 'stand' },
    { id: 'palace-door-r', pos: new THREE.Vector3(88.0, 0, -13.6), facing: 0.25, mode: 'stand', quiver: true },
    { id: 'palace-hall', pos: new THREE.Vector3(86, 0, -25.5), facing: Math.PI, mode: 'stand' },
    { id: 'palace-corridor', pos: new THREE.Vector3(86, 0, -34), facing: Math.PI, mode: 'stand', quiver: true },
    { id: 'palace-store', pos: new THREE.Vector3(77.2, 0, -20.5), facing: 1.2, mode: 'sleep' },
    { id: 'palace-sleep-1', pos: new THREE.Vector3(95, 0, -23), facing: -1.9, mode: 'sleep' },
    { id: 'captain', pos: new THREE.Vector3(85.9, 0.55, -41.8), facing: 0, mode: 'sleep', kind: 'captain', lieSide: 1 },
    // the tower: two guards on the ground floor, two or three on each floor above (clear of the stair bay),
    // the last of Priam's sons on the balcony at the top
    { id: 'tower-0', pos: new THREE.Vector3(95.6, 0, -47.6), facing: 0.4, mode: 'stand', quiver: true },
    { id: 'tower-0b', pos: new THREE.Vector3(92.4, 0, -52.0), facing: -Math.PI / 2 + 0.3, mode: 'patrol', patrol: [new THREE.Vector3(92.4, 0, -52.0), new THREE.Vector3(92.4, 0, -56.0), new THREE.Vector3(96.0, 0, -56.0)] },
    { id: 'tower-1a', pos: new THREE.Vector3(95.5, 4.5, -56.0), facing: Math.PI * 0.75, mode: 'stand' },
    { id: 'tower-1b', pos: new THREE.Vector3(92.0, 4.5, -46.5), facing: -2.0, mode: 'patrol', patrol: [new THREE.Vector3(92.0, 4.5, -46.5), new THREE.Vector3(92.0, 4.5, -53.0)] },
    { id: 'tower-1c', pos: new THREE.Vector3(100.6, 4.5, -46.4), facing: Math.PI, mode: 'stand', quiver: true },
    { id: 'tower-2a', pos: new THREE.Vector3(92.0, 9.0, -50.5), facing: Math.PI / 2, mode: 'stand', quiver: true },
    { id: 'tower-2b', pos: new THREE.Vector3(95.6, 9.0, -56.2), facing: 0.3, mode: 'stand' },
    { id: 'tower-2c', pos: new THREE.Vector3(95.8, 9.0, -45.8), facing: -2.4, mode: 'patrol', patrol: [new THREE.Vector3(95.8, 9.0, -45.8), new THREE.Vector3(100.6, 9.0, -45.8)] },
    { id: 'hector', pos: new THREE.Vector3(86.6, 13.5, -51.0), facing: -Math.PI / 2, mode: 'stand', kind: 'hector' },
  ];

  const endTrigger = new THREE.Box3(new THREE.Vector3(18, -1, 54), new THREE.Vector3(26, 5, 60));
  const plazaTrigger = new THREE.Box3(new THREE.Vector3(-4, -1, -8), new THREE.Vector3(8, 5, -2));
  const checkpoints = [
    { id: 'alley', box: new THREE.Box3(new THREE.Vector3(-5, -1, -31), new THREE.Vector3(1, 5, -27)), spawn: new THREE.Vector3(-2, 0, -29), yaw: 0 },
    { id: 'plaza', box: new THREE.Box3(new THREE.Vector3(-1, -1, -10), new THREE.Vector3(5, 5, -6)), spawn: new THREE.Vector3(2, 0, -8), yaw: 0 },
    { id: 'alley-b', box: new THREE.Box3(new THREE.Vector3(11, -1, 29), new THREE.Vector3(17, 5, 33)), spawn: new THREE.Vector3(15.4, 0, 32.9), yaw: 0 },
    { id: 'unterstadt', box: new THREE.Box3(new THREE.Vector3(38, -1, 57), new THREE.Vector3(43, 5, 63)), spawn: new THREE.Vector3(40, 0, 60), yaw: Math.PI / 2 },
    { id: 'forecourt', box: new THREE.Box3(new THREE.Vector3(82, -1, 3), new THREE.Vector3(87, 5, 8)), spawn: new THREE.Vector3(84, 0, 6), yaw: Math.PI },
    // the finale: back at the gate with the key, inside the city after the gate opened, at the tower door
    { id: 'gate2', box: new THREE.Box3(new THREE.Vector3(14, -1, 56), new THREE.Vector3(30, 5, 64)), spawn: new THREE.Vector3(22, 0, 58), yaw: 0 },
    { id: 'tower', box: new THREE.Box3(new THREE.Vector3(91.5, -1, -43.5), new THREE.Vector3(94.5, 5, -40.5)), spawn: new THREE.Vector3(93, 0, -41.5), yaw: Math.PI },
  ];

  const ambushTrigger = new THREE.Box3(new THREE.Vector3(11, -1, 33.5), new THREE.Vector3(17, 6, 52));
  const nav = new NavGrid(world, X0, Z0, (X1 - X0) / 2, (Z1 - Z0) / 2, 2, inStreets);
  return {
    group, world, nav, trees, statues, fires, horse, guards, endTrigger, checkpoints, plazaTrigger, gate, ambushTrigger, key: keyGroup,
    palacePoint: new THREE.Vector3(86, 0, -14), cratesPoint: new THREE.Vector3(77.6, 0, -14.5), gatePoint: new THREE.Vector3(gateX, 0, 60),
    mounts, roofs, gateBox, bolt, padlock, gatehouse, hectorTrigger, towerDoorPoint, helenaPoint, balconyPoint,
  };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
