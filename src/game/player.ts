import * as THREE from 'three';
import { Character } from './characters';
import { CollisionWorld } from './collision';
import { Input } from './input';
import { ThirdPersonCamera } from './camera';

export type Weapon = 'sword' | 'bow';
/** duration of one sword swing in seconds (wind-up, strike, recovery) */
export const ATTACK_TIME = 0.6;
/** the pause after a swing before the next one can start: no spamming, timing matters */
export const ATTACK_PAUSE = 0.2;

/** Odysseus: movement, crouching, climbing onto ledges, weapons and the noise he makes. */
export class Player {
  readonly char: Character;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  onGround = true;
  crouched = false;
  sprinting = false;
  /** set by the game for the frame while he shoves the gate's bolt or cranks the winch */
  pushing = false;
  hp = 100;
  alive = true;
  hasBow = false;
  hasKey = false;
  arrows = 0;
  weapon: Weapon = 'sword';
  /** a weapon change in progress (the sword is drawn / sheathed by a clip before it swaps) */
  private switching: { to: Weapon; t: number; dur: number; swapAt: number; swapped: boolean } | null = null;
  aiming = false;
  drawTime = 0;
  /** loudest noise made this frame (radius in metres) */
  noise = 0;
  /** horizontal speed (m/s) */
  speed = 0;
  controlEnabled = false;
  attackTimer = 0;
  /** the sword is in his hand whatever the chosen weapon (silent takedown) */
  forceSword = false;
  onStairs = false;
  attackCooldown = 0;
  private attackYaw = 0;
  private lunge = 0;
  private swingCount = 0;
  private lastSwingAt = -10;
  private clock = 0;
  /** seconds the bow has been raised without interruption (the aim settles over ~2 s) */
  aimTime = 0;
  /** current cone of inaccuracy in radians (shown by the crosshair, applied to the arrow) */
  aimSpread = 0.05;
  /** after a shot (or when every button is up) the bow is lowered; a new press raises it again */
  private bowRelaxed = false;
  /** knees give way on landing, proportional to the fall */
  private landDip = 0;
  blocking = false;
  /** 0..1: the shield arm tires while blocking and with every blow it takes; empty = the shield drops */
  stamina = 1;
  private staminaBroken = false;
  private wasBlocking = false;
  dodgeTimer = 0;
  private dodgeDir = new THREE.Vector3();
  invuln = 0;
  /** seconds since the last hit; health slowly returns after a while without damage */
  sinceHurt = 0;
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private fallStartY = 0;
  readonly radius = 0.35;
  readonly height = 1.75;

  constructor(private world: CollisionWorld) {
    this.char = new Character('odysseus');
  }

  get busy() {
    return !!this.mantle;
  }

  teleport(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.mantle = null;
    this.fallStartY = p.y;
    this.sync();
  }

  update(dt: number, input: Input, cam: ThirdPersonCamera) {
    this.noise = 0;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.sinceHurt += dt;
    if (this.alive && this.sinceHurt > 9 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 2.2);

    if (this.mantle) {
      this.updateMantle(dt);
      this.animate(dt);
      return;
    }

    let mx = 0, mz = 0;
    if (this.controlEnabled && this.alive) {
      if (input.down('KeyW')) mz += 1;
      if (input.down('KeyS')) mz -= 1;
      if (input.down('KeyA')) mx += 1;
      if (input.down('KeyD')) mx -= 1;
      if (input.hit('KeyC') || input.hit('ControlLeft')) this.crouched = !this.crouched;
      if (input.hit('Digit1')) this.switchWeapon('sword');
      if (input.hit('Digit2') && this.hasBow) this.switchWeapon('bow');
      if (input.hit('KeyQ') && this.hasBow) this.switchWeapon(this.weapon === 'bow' ? 'sword' : 'bow');
    }
    // the hand reaches the hip part-way through the draw / sheathe clip: that is when the sword moves
    if (this.switching) {
      this.switching.t += dt;
      if (!this.switching.swapped && this.switching.t >= this.switching.swapAt) {
        this.switching.swapped = true;
        this.weapon = this.switching.to;
      }
      if (this.switching.t >= this.switching.dur) this.switching = null;
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    this.sprinting = this.controlEnabled && input.down('ShiftLeft') && mz > 0 && !this.aiming && !this.staminaBroken;
    if (this.sprinting) this.crouched = false;

    // weapons: with the bow, holding either mouse button raises it; the left button draws
    if (!input.rmb && !input.lmb) this.bowRelaxed = false;
    this.aiming = this.controlEnabled && this.alive && this.weapon === 'bow' && this.hasBow && (input.rmb || input.lmb) && !this.bowRelaxed;
    this.blocking = this.controlEnabled && this.alive && this.weapon === 'sword' && input.rmb && this.attackTimer <= ATTACK_TIME * 0.35 && !this.staminaBroken;
    // holding the shield up tires slowly; a blocked blow costs a chunk (see absorbBlow); it recovers when lowered
    if (this.blocking) this.stamina = Math.max(0, this.stamina - dt * 0.12);
    else if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.09);
    else this.stamina = Math.min(1, this.stamina + dt * 0.3);
    if (this.stamina <= 0) this.staminaBroken = true;
    if (this.staminaBroken && this.stamina > 0.35) this.staminaBroken = false;
    // the string is drawn while the left button is held and let go the moment it is released
    // (only once the arrow is on the string – the draw clip takes it from the quiver first)
    if (this.aiming) this.drawTime = input.lmb ? (this.char.bowReady ? Math.min(1, this.drawTime + dt * 1.8) : this.drawTime) : 0;
    if (this.aiming) cam.forward(this.char.aimDir);
    else this.drawTime = 0;
    this.clock += dt;
    // the aim settles the longer the bow is held up; walking widens it, crouching narrows it
    this.aimTime = this.aiming ? this.aimTime + dt : 0;
    {
      const settle = 1 - Math.min(1, this.aimTime / 2);
      let s = 0.01 + settle * 0.045;
      if (this.speed > 0.4) s += 0.025;
      if (this.crouched) s *= 0.65;
      this.aimSpread = s;
    }

    // dodge roll (sword mode): F
    if (this.controlEnabled && input.hit('KeyF') && this.onGround && this.dodgeTimer <= 0) {
      this.dodgeTimer = 0.45;
      this.invuln = 0.4;
      this.char.playClip('roll', 0.65);
      const cy = cam.yaw;
      const dx = len > 0 ? mx : 0, dz = len > 0 ? mz : -1;
      this.dodgeDir.set(Math.sin(cy) * dz + Math.cos(cy) * dx, 0, Math.cos(cy) * dz - Math.sin(cy) * dx).normalize();
      this.noise = Math.max(this.noise, 5);
    }

    // the jog and sprint clips are played near their own pace (2.3 / 5.2 m/s stance speed; the jog a touch quicker);
    // on stairs he runs up at the stair clip's pace
    this.onStairs = this.onGround && this.world.onRamp(this.pos.x, this.pos.y, this.pos.z);
    let speed = this.crouched ? 1.5 : this.sprinting ? 5.0 : 3.0;
    if (this.onStairs) speed = Math.min(speed, this.sprinting ? 3.0 : 2.4);
    if (this.aiming) speed = this.crouched ? 1.2 : 1.8;
    if (this.blocking) speed = 1.6;

    // camera-relative movement
    const cy = cam.yaw;
    const wishX = Math.sin(cy) * mz + Math.cos(cy) * mx;
    const wishZ = Math.cos(cy) * mz - Math.sin(cy) * mx;
    // on the ground he stops much faster than he accelerates (no skating after a landing)
    const accel = this.onGround ? (len > 0.1 ? 14 : 26) : 3;
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      this.vel.x = this.dodgeDir.x * 7.5;
      this.vel.z = this.dodgeDir.z * 7.5;
    } else if (this.attackTimer > 0 && this.onGround) {
      // a short lunge carries the strike forward
      const phase = 1 - this.attackTimer / ATTACK_TIME;
      const lunge = phase > 0.2 && phase < 0.55 ? this.lunge : 0;
      this.vel.x = Math.sin(this.yaw) * lunge;
      this.vel.z = Math.cos(this.yaw) * lunge;
    } else {
      this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * dt);
    }

    // facing: toward movement, toward the camera when aiming/blocking, toward the foe when striking
    if (this.attackTimer > 0) {
      this.yaw = lerpAngle(this.yaw, this.attackYaw, Math.min(1, dt * 11)); // turns into the blow, but no spinning mid-swing
    } else if (this.aiming || this.blocking) {
      this.yaw = lerpAngle(this.yaw, cy, Math.min(1, dt * 14));
    } else if (len > 0.1 && this.dodgeTimer <= 0) {
      this.yaw = lerpAngle(this.yaw, Math.atan2(wishX, wishZ), Math.min(1, dt * 10));
    }

    // jump / mantle
    // Space only jumps; the climbing animation is shelved for now (it fired in front of any wall)
    if (this.controlEnabled && this.alive && input.hit('Space') && this.onGround) {
      this.vel.y = 5.6;
      this.onGround = false;
      this.crouched = false;
      this.char.playClip('jump', 1.1);
    }
    // a jump against a low ledge (crates, low walls up to ~1.3 m) still carries him up onto it,
    // quietly and without a climb pose, so the crate routes stay open
    if (!this.onGround && this.vel.y < 1.5 && len > 0 && this.controlEnabled && input.down('Space')) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const ledge = this.world.findLedge(this.pos, fwd, this.radius, 0.2, 1.3);
      if (ledge) this.mantle = { from: this.pos.clone(), to: ledge, t: 0 };
    }

    // gravity & integration
    this.vel.y -= 18 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.resolveHorizontal(this.pos, this.radius, this.crouched ? 1.2 : this.height, 0.52);
    this.pos.y += this.vel.y * dt;

    const ceil = this.world.ceiling(this.pos, this.radius * 0.8, this.pos.y + 0.5);
    if (this.pos.y + this.height > ceil && this.vel.y > 0) {
      this.pos.y = ceil - this.height;
      this.vel.y = 0;
    }

    const ground = this.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.52, this.radius * 0.6);
    const wasOnGround = this.onGround;
    if (this.pos.y <= ground + (wasOnGround ? 0.25 : 0) && this.vel.y <= 0) {
      if (!wasOnGround) {
        const fall = this.fallStartY - ground;
        // touchdown: the jump pose ends at once so the legs run (or stand) instead of gliding,
        // and without a key held the feet plant and most of the momentum is gone
        if (this.char.clipName === 'jump' || this.char.clipName === 'fall') this.char.stopClip(0.12);
        if (len < 0.1) {
          this.vel.x *= 0.25;
          this.vel.z *= 0.25;
        } else if (fall > 1.5) {
          this.vel.x *= 0.6;
          this.vel.z *= 0.6;
        }
        if (fall > 0.3) this.landDip = THREE.MathUtils.clamp(0.3 + fall * 0.22, 0.35, 0.95);
        if (fall > 1.0) this.noise = Math.max(this.noise, this.crouched ? fall * 1.2 : fall * 2.6);
        if (fall > 7) this.damage(Math.min(100, (fall - 7) * 25));
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
      this.fallStartY = ground;
    } else {
      if (wasOnGround) this.fallStartY = this.pos.y;
      this.onGround = false;
      this.fallStartY = Math.max(this.fallStartY, this.pos.y);
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && this.speed > 0.3) {
      const n = this.crouched ? 1.5 : this.sprinting ? 15 : 5;
      this.noise = Math.max(this.noise, n * Math.min(1, this.speed / speed));
    }

    this.animate(dt);
  }

  private updateMantle(dt: number) {
    const m = this.mantle!;
    m.t += dt / 0.45;
    const t = Math.min(1, m.t);
    // up first, then forward
    const up = Math.min(1, t / 0.6);
    const fwd = Math.max(0, (t - 0.35) / 0.65);
    this.pos.x = THREE.MathUtils.lerp(m.from.x, m.to.x, easeInOut(fwd));
    this.pos.z = THREE.MathUtils.lerp(m.from.z, m.to.z, easeInOut(fwd));
    this.pos.y = THREE.MathUtils.lerp(m.from.y, m.to.y + 0.05, easeOut(up));
    if (t >= 1) {
      this.pos.copy(m.to);
      this.vel.set(0, 0, 0);
      this.onGround = true;
      this.fallStartY = this.pos.y;
      this.mantle = null;
    }
  }

  private animate(dt: number) {
    const c = this.char;
    this.landDip = Math.max(0, this.landDip - dt * 2.4);
    const crouchTarget = this.mantle ? c.crouch : Math.max(this.crouched ? 1 : 0, this.landDip);
    if (!this.mantle) c.crouch += (crouchTarget - c.crouch) * Math.min(1, dt * (this.landDip > 0 ? 16 : 10));
    c.mantle = this.mantle ? Math.min(1, this.mantle.t) : 0;
    const air = !this.onGround && !this.mantle ? 1 : 0;
    c.air += (air - c.air) * Math.min(1, dt * (air ? 9 : 16));
    c.aim += ((this.aiming ? 1 : 0) - c.aim) * Math.min(1, dt * 12);
    const turn = this.aiming ? c.rs * (Math.PI / 2) * (this.speed > 0.4 ? 0.5 : 0.9) : 0;
    this.aimTurn += (turn - this.aimTurn) * Math.min(1, dt * 9);
    c.draw = this.drawTime;
    if (this.blocking && !this.wasBlocking) c.playClip('block', 0.3);
    this.wasBlocking = this.blocking;
    c.block += ((this.blocking ? 1 : 0) - c.block) * Math.min(1, dt * 14);
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      c.attack = 1 - Math.max(0, this.attackTimer) / ATTACK_TIME;
    } else c.attack = 0;
    // the bow is carried in the left hand whenever it is the chosen weapon, on the back otherwise
    c.setBow(this.hasBow, this.weapon === 'bow' && !this.forceSword);
    c.carryBow += ((this.weapon === 'bow' && this.hasBow && !this.aiming ? 1 : 0) - c.carryBow) * Math.min(1, dt * 8);
    c.setSword(this.weapon === 'sword' || this.forceSword);
    c.fistRight = this.weapon === 'sword' || this.aiming || this.forceSword;
    // the left fist closes on the bow's grip or the shield's handle
    c.fistLeft = this.weapon === 'sword' || (this.hasBow && this.weapon === 'bow');

    if (!this.onGround && !this.mantle) c.play('idle');
    else if (this.pushing) c.play('push', 1);
    else if (this.blocking && this.speed < 0.3) c.play('blockidle');
    else c.playGait(this.speed, this.crouched, !this.aiming && !this.blocking, this.onStairs);
    this.pushing = false;
    c.update(dt);
    this.sync();
  }

  /**
   * Change weapon with the draw / sheathe animation: taking the bow out means the sword goes back
   * to the hip first (the hand reaches it mid-clip, then the sword swaps); the sword comes out of
   * the scabbard the same way. Without the clips (placeholder body) the swap is immediate.
   */
  switchWeapon(to: Weapon, instant = false) {
    if (to === this.weapon && !this.switching) return;
    if (this.switching?.to === to) return;
    if (instant || this.aiming || !this.alive) {
      this.switching = null;
      this.weapon = to;
      return;
    }
    const clip = to === 'sword' ? 'unsheathe' : 'sheathe';
    const dur = to === 'sword' ? 1.0 : 1.1;
    if (!this.char.playUpper(clip, dur)) {
      this.weapon = to;
      return;
    }
    // unsheathing: the hand closes on the grip at ~40 % and the blade comes up; sheathing: the blade
    // slides home at ~60 %
    this.switching = { to, t: 0, dur, swapAt: dur * (to === 'sword' ? 0.42 : 0.6), swapped: false };
  }

  /**
   * Start a sword swing toward `yaw`; alternates overhead cuts and side slashes.
   * `lunge` is the forward speed during the strike (closes the gap to a foe).
   */
  startAttack(yaw: number, lunge = 0) {
    if (this.attackCooldown > 0 || !this.alive) return false;
    this.attackTimer = ATTACK_TIME;
    this.attackCooldown = ATTACK_TIME + ATTACK_PAUSE;
    this.attackYaw = yaw;
    this.lunge = lunge;
    // a pause of more than 1.5 s ends the combo; the spinning slash only comes as the fourth blow in a row
    if (this.clock - this.lastSwingAt > 1.5) this.swingCount = 0;
    this.lastSwingAt = this.clock;
    this.swingCount++;
    this.char.attackKind = this.swingCount % 2 ? 'overhead' : 'slash';
    // the Mixamo swings take a little longer than the procedural one; the hit still lands at the same phase
    // 'slash' is the plain cut; 'attack' and 'attack2' are the spinning strikes, kept for the fourth blow of a combo
    const spin = this.swingCount % 4 === 0;
    this.char.playClip(spin ? (this.swingCount % 8 === 0 ? 'attack2' : 'attack') : 'slash', ATTACK_TIME * (spin ? 1.25 : this.swingCount % 2 ? 1.0 : 1.12));
    this.noise = Math.max(this.noise, 9);
    return true;
  }

  /** the strike lands when the swing phase passes this */
  get strikeMoment() {
    return ATTACK_TIME * (1 - 0.4);
  }

  /** lower the bow after a shot; both buttons have to be released before it comes up again */
  relaxBow() {
    this.bowRelaxed = true;
    this.aiming = false;
    this.drawTime = 0;
  }

  /** a blow caught on the shield: costs stamina; returns false when the arm gives way (the hit lands anyway) */
  absorbBlow() {
    this.stamina = Math.max(0, this.stamina - 0.28);
    if (this.stamina <= 0.001) {
      this.staminaBroken = true;
      return false;
    }
    return true;
  }

  damage(amount: number) {
    if (!this.alive || this.invuln > 0) return false;
    this.hp -= amount;
    this.sinceHurt = 0;
    if (!this.char.playClip('hit', 0.5)) this.char.flinch = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return true;
  }

  /** while aiming the body turns side-on to the target like an archer (the bow arm toward it):
   *  all the way when standing, half when walking (the chest turns the rest) */
  private aimTurn = 0;

  sync() {
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw + this.aimTurn;
  }
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
