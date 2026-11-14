import * as THREE from 'three';
import { CollisionWorld } from './collision';

/** Third-person orbit camera with over-the-shoulder aiming and wall collision. */
export class ThirdPersonCamera {
  yaw = 0; // 0 = looking toward +Z
  pitch = 0.18;
  aim = 0; // 0..1 blend into over-the-shoulder aim
  private dist = 4.3;
  shake = 0;
  readonly target = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private first = true;

  constructor(readonly camera: THREE.PerspectiveCamera, private world: CollisionWorld) {}

  /** direction the camera looks (full 3D) */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt: number, focus: THREE.Vector3, crouch: number, mouseDX: number, mouseDY: number, sens: number) {
    const s = sens * (1 - this.aim * 0.45);
    this.yaw -= mouseDX * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch + mouseDY * s, -0.9, 1.1);

    const headY = 1.75 - crouch * 0.45;
    this.target.set(focus.x, focus.y + headY, focus.z);
    if (this.first) {
      this.smoothed.copy(this.target);
      this.first = false;
    }
    // follow vertically with a little lag (smooth over steps/landing), horizontally tight
    this.smoothed.x = this.target.x;
    this.smoothed.z = this.target.z;
    this.smoothed.y += (this.target.y - this.smoothed.y) * Math.min(1, dt * 12);

    const fwd = this.forward(_f);
    const right = _r.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const shoulder = THREE.MathUtils.lerp(0.8, 0.95, this.aim);
    const dist = THREE.MathUtils.lerp(this.dist, 2.3, this.aim);
    const pivot = _p.copy(this.smoothed).addScaledVector(right, shoulder);
    pivot.y += this.aim * 0.1;
    const want = _w.copy(pivot).addScaledVector(fwd, -dist);

    // pull in when a wall is between the pivot and the camera
    const dir = _d.subVectors(want, pivot);
    const len = dir.length();
    dir.divideScalar(len);
    const hit = this.world.raycast(pivot, dir, len + 0.3);
    const finalLen = hit === Infinity ? len : Math.max(0.3, hit - 0.3);
    this.camera.position.copy(pivot).addScaledVector(dir, finalLen);
    if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const a = this.shake * this.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(_l.copy(this.camera.position).add(fwd));
    this.camera.fov = THREE.MathUtils.lerp(62, 48, this.aim);
    this.camera.updateProjectionMatrix();
  }

  snapBehind(yaw: number) {
    this.yaw = yaw;
    this.pitch = 0.18;
    this.first = true;
  }
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3();
