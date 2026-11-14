import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planks, makeMaterial } from './textures';
import { CollisionWorld } from '../game/collision';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The wooden horse – an original design: a standing, heavy-set horse built from
 * rough boards over a ribbed frame, bound with iron bands, on a wheeled sledge.
 * It faces +Z. Local origin = centre of the sledge on the ground.
 */
export interface Horse {
  group: THREE.Group;
  hatch: THREE.Object3D; // pivot – rotate.x to open
  rope: THREE.Mesh;
  /** local point inside the belly just above the hatch */
  hatchPoint: THREE.Vector3;
  platformTop: number;
}

/** game materials for the GLB's named slots (the Blender file only carries flat colours) */
function horseMaterials() {
  return {
    wood: makeMaterial(planks(5), { color: 0x9a7a5a }),
    darkwood: makeMaterial(planks(17), { color: 0x6a5040 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.7, roughness: 0.55 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xa07a38, metalness: 0.9, roughness: 0.38 }),
    rope: new THREE.MeshStandardMaterial({ color: 0xa88454, roughness: 0.95 }),
  } as Record<string, THREE.Material>;
}

/** Load the Blender-built body into the horse group (the hatch and rope are already there). */
export async function loadHorseModel(horse: Horse, url: string) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const mats = horseMaterials();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.material as THREE.Material).name;
    m.material = mats[name] ?? mats.wood;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  horse.group.add(gltf.scene);
}

export function createHorse(world: CollisionWorld, at: THREE.Vector3, rotY = 0): Horse {
  const { darkwood: darkWood, rope } = horseMaterials();

  const group = new THREE.Group();

  // the body comes from Blender (tools/blender/horse.py → models/horse.glb, see loadHorseModel);
  // only the colliders of the legs and the sledge are set up here
  const platformTop = 1.0;
  const legH = 4.4;
  const legs: [number, number][] = [[-1.05, 2.6], [1.05, 2.6], [-1.05, -2.7], [1.05, -2.7]];
  for (const [lx, lz] of legs) world.addBox(at.x + lx, at.z + lz, 0.55, 0.55, 0, platformTop + legH + 0.5, false);
  const bodyY = platformTop + legH + 1.45;

  // belly hatch: hinged on its -X edge
  const hatchPivot = new THREE.Object3D();
  hatchPivot.position.set(-0.6, bodyY - 1.72, 0.4);
  const hatchPanel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.5), darkWood);
  hatchPanel.position.set(0.6, 0, 0);
  hatchPanel.castShadow = true;
  hatchPivot.add(hatchPanel);
  group.add(hatchPivot);
  // dark interior visible through the opening
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.45), new THREE.MeshBasicMaterial({ color: 0x050302 }));
  hole.rotation.x = Math.PI / 2;
  hole.position.set(0, bodyY - 1.66, 0.4);
  group.add(hole);

  // the climbing rope hangs from the hatch; its origin is the top so it can uncoil (scale.y)
  const ropeLen = bodyY - 1.7 - platformTop;
  // three strands twisted round each other, with a knot every stretch to grip
  const strands: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const pts: THREE.Vector3[] = [];
    const turns = ropeLen / 0.22;
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * turns * Math.PI * 2 + (k * Math.PI * 2) / 3;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.02, -t * ropeLen, Math.sin(a) * 0.02));
    }
    strands.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.019, 6, false));
  }
  for (let y = 0.9; y < ropeLen - 0.4; y += 0.9) {
    const knot = new THREE.TorusGeometry(0.03, 0.022, 6, 10);
    knot.rotateX(Math.PI / 2);
    knot.translate(0, -y, 0);
    strands.push(knot);
  }
  const ropeGeo = mergeGeometries(strands);
  const ropeMesh = new THREE.Mesh(ropeGeo, rope);
  ropeMesh.position.set(0.3, bodyY - 1.7, 0.6);
  ropeMesh.visible = false;
  ropeMesh.castShadow = true;
  group.add(ropeMesh);

  group.position.copy(at);
  group.rotation.y = rotY;
  world.addBox(at.x, at.z, 4.8, 11, 0, platformTop, true);

  return { group, hatch: hatchPivot, rope: ropeMesh, hatchPoint: new THREE.Vector3(0, bodyY - 1.7, 0.4), platformTop };
}
