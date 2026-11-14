import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { pbrMaterial } from './textures';

/**
 * Vegetation modelled in Blender (tools/blender/trees.py → public/models/cypress.glb, olive.glb).
 * The level only records where a tree stands; the meshes are loaded here and drawn as one
 * InstancedMesh per sub-mesh (trunk, crown), so a dozen trees cost two draw calls per kind.
 */
export type TreeKind = 'cypress' | 'olive' | 'bust' | 'horse' | 'lion' | 'krater' | 'hydria' | 'barrel' | 'amphora' | 'pithos' | 'cart' | 'wheelbarrow' | 'pedestal' | 'pillar' | 'balustrade' | 'brazier' | 'lionstatue' | 'gatehouse' | 'stairs' | 'column' | 'frieze' | 'trophy' | 'throne' | 'mosaic' | 'plinth' | 'boltslot' | 'table' | 'bench' | 'tableware' | 'crate' | 'hay' | 'stall' | 'palace_bldg' | 'tower_bldg';
export interface TreeSpec {
  kind: TreeKind;
  x: number;
  z: number;
  /** uniform scale, 1 = the modelled size (cypress ≈ 7 m, olive ≈ 4.5 m, bust 0.5 m, horse statue 2.5 m, lion head 0.44 m, krater 0.55 m, hydria 0.5 m) */
  scale: number;
  rot: number;
  y?: number;
  /** extra scale along the model's own X (a balustrade stretched to span exactly) */
  scaleX?: number;
  /** tipped over on its side (rolled 90° before the turn); y should then be the prop's radius */
  lie?: boolean;
}

/** Blender trees (tools/blender) and CC0 scans from Poly Haven (polyhaven.com, packed with tools/pack-glb.mjs) */
const files: Record<TreeKind, string> = {
  cypress: 'cypress.glb',
  olive: 'olive.glb',
  bust: 'marble_bust_01.glb',
  horse: 'horse_statue.glb',
  lion: 'lion_head.glb',
  krater: 'krater.glb',
  hydria: 'hydria.glb',
  barrel: 'barrel.glb',
  amphora: 'amphora.glb',
  pithos: 'pithos.glb',
  cart: 'cart.glb',
  wheelbarrow: 'wheelbarrow.glb',
  pedestal: 'pedestal.glb',
  pillar: 'pillar.glb',
  balustrade: 'balustrade.glb',
  brazier: 'brazier.glb',
  lionstatue: 'lion_statue.glb',
  gatehouse: 'gatehouse.glb',
  stairs: 'stairs.glb',
  column: 'column.glb',
  frieze: 'frieze.glb',
  trophy: 'trophy.glb',
  throne: 'throne.glb',
  mosaic: 'mosaic.glb',
  plinth: 'plinth.glb',
  boltslot: 'boltslot.glb',
  table: 'table.glb',
  bench: 'bench.glb',
  tableware: 'tableware.glb',
  crate: 'crate.glb',
  hay: 'hay.glb',
  stall: 'stall.glb',
  // the palace and its tower (tools/blender/citadel.py), modelled in world coordinates: placed once at the origin
  palace_bldg: 'palace_bldg.glb',
  tower_bldg: 'tower_bldg.glb',
};

/** Blender materials named tex_* get the game's tiling PBR stone, plaster and wood (the GLB carries world-space UVs, 4 m per tile) */
const TEX: Record<string, [string, number]> = {
  tex_sandstone: ['large_sandstone_blocks', 0xd8b890],
  tex_sandstone_dark: ['large_sandstone_blocks', 0xa88a68],
  tex_plaster: ['clay_plaster', 0xe8c8a0],
  tex_wood: ['medieval_wood', 0xa08060],
};

/** models that move in the game (gate leaves, the bolt, the winch …): loaded once, cloned onto each mount */
export type MountModel = 'gate_leaf' | 'bolt' | 'padlock' | 'winch' | 'bell' | 'door';
export interface MountSpec {
  model: MountModel;
  /** the group the clone is added to (the game animates the group or named children of the clone) */
  parent: THREE.Object3D;
  position?: [number, number, number];
  rotationY?: number;
  /** -1 mirrors the model (the right-hand gate leaf) */
  scaleX?: number;
}

export async function loadMounts(mounts: MountSpec[], baseUrl: string) {
  const loader = new GLTFLoader();
  const models = [...new Set(mounts.map((m) => m.model))];
  const scenes = await Promise.all(models.map((m) => loader.loadAsync(`${baseUrl}${m}.glb`)));
  mounts.forEach((spec) => {
    const src = scenes[models.indexOf(spec.model)].scene;
    const clone = src.clone(true);
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (spec.position) clone.position.set(...spec.position);
    if (spec.rotationY) clone.rotation.y = spec.rotationY;
    if (spec.scaleX) clone.scale.x = spec.scaleX;
    spec.parent.add(clone);
  });
}

export async function loadTrees(group: THREE.Group, trees: TreeSpec[], baseUrl: string, onProgress?: (p: number) => void) {
  const loader = new GLTFLoader();
  const kinds = (Object.keys(files) as TreeKind[]).filter((k) => trees.some((t) => t.kind === k));
  const done = kinds.map(() => 0);
  const scenes = await Promise.all(
    kinds.map((k, i) =>
      loader.loadAsync(`${baseUrl}${files[k]}`, (e) => {
        if (e.total) {
          done[i] = e.loaded / e.total;
          onProgress?.(done.reduce((a, b) => a + b, 0) / kinds.length);
        }
      }),
    ),
  );
  const m = new THREE.Matrix4();
  kinds.forEach((kind, i) => {
    const list = trees.filter((t) => t.kind === kind);
    scenes[i].scene.updateMatrixWorld(true);
    scenes[i].scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const src = o as THREE.Mesh;
      // bake the node transform into the geometry so instances only need position/rotation/scale
      const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      geo.morphAttributes = {}; // scans may carry morph targets; instances don't animate them
      const srcMat = src.material as THREE.MeshStandardMaterial;
      const tex = TEX[srcMat.name.replace(/\.\d+$/, '')];
      const mat = tex ? pbrMaterial(tex[0], { color: tex[1] }) : srcMat.clone();
      if (kind === 'cypress' || kind === 'olive') {
        mat.roughness = 1;
        mat.metalness = 0;
      }
      // the olive's silver-green is a daylight colour; pull it into the night palette (the leaf quads
      // are two-sided and small, so they need more light than the old solid canopy did)
      if (kind === 'olive') mat.color.multiplyScalar(mat.name === 'olive' ? 0.55 : 0.6);
      if (kind === 'cypress' && mat.name === 'cypress') mat.color.multiplyScalar(0.6);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, j) => {
        const q = t.lie ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.rot, Math.PI / 2, 'YZX')) : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        m.compose(new THREE.Vector3(t.x, t.y ?? 0, t.z), q, new THREE.Vector3(t.scale * (t.scaleX ?? 1), t.scale, t.scale));
        inst.setMatrixAt(j, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      group.add(inst);
    });
  });
}
