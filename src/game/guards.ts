import * as THREE from 'three';
import { Fire } from '../fx/fire';
import { Character } from './characters';
import { CollisionWorld } from './collision';
import { GuardSpawn } from '../world/level';
import { NavGrid } from './nav';

export type GuardState = 'stand' | 'patrol' | 'sleep' | 'waking' | 'suspicious' | 'search' | 'alert' | 'dying' | 'dead';

/**
 * Trojan guard. Sleeps, stands watch or patrols. Notices Odysseus by sight (light, distance,
 * crouching) and by noise. Once alerted he shouts – waking every sleeper nearby – and attacks.
 */
export class Guard {
  readonly char: Character;
  readonly pos = new THREE.Vector3();
  yaw: number;
  state: GuardState;
  awareness = 0; // 0..1 detection meter
  hp = 100;
  hasBow: boolean;
  bowDropped = false;
  /** wears a quiver and drops arrows on death */
  quiver = false;
  arrowsDropped = false;
  readonly id: string;
  private patrol: THREE.Vector3[];
  private patrolIdx = 0;
  private wait = 0;
  readonly lastKnown = new THREE.Vector3();
  private searchTimer = 0;
  private wakeTimer = 0;
  private wakeMeter = 0;
  attackTimer = 0;
  private attackWindup = 0;
  /** true during the visible wind-up of a strike (the block hint waits for this) */
  get windingUp() {
    return this.attackWindup > 0;
  }
  private swings = 0;
  dyingT = 0;
  /** set when this guard just raised the alarm (game reads & clears) */
  shouted = false;
  /** set when his strike lands on the player this frame */
  strikeLanded = false;
  spawn: GuardSpawn;
  /** held by Odysseus' silent takedown until the killing stroke */
  seized = false;
  readonly radius = 0.38;
  private speed = 0;
  private homeYaw: number;
  /** turning is eased through an angular velocity so he never snaps */
  private yawVel = 0;
  private lookTarget = 0;
  private readonly knock = new THREE.Vector3();
  private stagger = 0;
  /** the step back after a blow rang off the raised shield – the shield stays up meanwhile */
  private recoil = 0;
  private scanPhase = Math.random() * 10;
  /** hand torch (a Fire the level keeps in its list; its light follows the hand) */
  torch: Fire | null = null;
  /** the game hands out at most two engagement slots: only engaged guards close in and strike */
  engaged = false;
  /** another guard stands between him and Odysseus: he holds his spear and waits for a gap */
  blocked = false;
  private holdSide = Math.random() < 0.5 ? 1 : -1;
  private lunge = 0;
  /** route finding (set once by the game) */
  static nav: NavGrid | null = null;
  /** how many men are already fighting Odysseus close by (set by the game each frame) */
  static engaged = 0;
  private path: THREE.Vector3[] = [];
  private pathT = 0;
  private readonly pathGoal = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private stuckT = 0;
  private detourT = 0;
  private readonly detour = new THREE.Vector3();

  /** Hector: more life, heavier blows, parries, an unblockable strike every third swing */
  get boss() {
    return this.spawn.kind === 'hector';
  }
  /** set while the boss winds up his heavy (unblockable) strike */
  heavy = false;
  private circleT = 0;
  private circleDir = 0;
  /** the shield is up: blows ring off it. He lowers it half a second before his own strike */
  shieldUp = false;
  /** set when a blow just hit the raised shield (the game reads & clears it) */
  shieldHit = false;
  /** set the moment he lowers the shield to strike (the game reads & clears it: the "now!" hint) */
  opened = false;
  private impacts = 0;
  /** short recovery after his own strike: the shield stays down, the opening to hit him */
  private recover = 0;
  /** a panic runner that reached the end of his route: the game removes him */
  gone = false;
  /** wakes Hector into the fight (set by the game after the cinematic) */
  roused = false;

  constructor(spawn: GuardSpawn, private world: CollisionWorld) {
    this.spawn = spawn;
    this.id = spawn.id;
    this.char = new Character(spawn.kind ?? 'guard', [...spawn.id].reduce((a, c) => a + c.charCodeAt(0), 0));
    if (this.boss) {
      this.hp = 330;
      this.char.setSword(false); // drawn in the cinematic
    }
    if (spawn.torch) this.torch = this.char.addTorch();
    this.pos.copy(spawn.pos);
    this.yaw = spawn.facing;
    this.homeYaw = spawn.facing;
    this.state = spawn.mode;
    this.hasBow = !!spawn.hasBow;
    this.quiver = !!spawn.quiver || this.hasBow;
    if (this.quiver && spawn.kind !== 'captain') this.char.addQuiver();
    this.patrol = spawn.patrol ?? [];
    if (this.state === 'sleep') {
      this.char.lie = 1;
      // he lies along his local X: the head goes to -lieSide. A fixed side (the captain on his kline) or the
      // side with room for his body, never into a wall or off a bed
      if (spawn.lieSide) this.char.lieSide = spawn.lieSide;
      else {
        const cx = Math.cos(this.yaw), cz = -Math.sin(this.yaw);
        const room = (sgn: number) => this.world.visible(_b.set(this.pos.x, this.pos.y + 0.35, this.pos.z), _c.set(this.pos.x - sgn * cx * 1.8, this.pos.y + 0.35, this.pos.z - sgn * cz * 1.8));
        const a = room(1), b = room(-1);
        this.char.lieSide = a && b ? (Math.random() < 0.5 ? 1 : -1) : a ? 1 : b ? -1 : 1;
      }
    }
    this.sync();
  }

  get alive() {
    return this.state !== 'dead' && this.state !== 'dying';
  }
  get alerted() {
    return this.state === 'alert';
  }
  get asleep() {
    return this.state === 'sleep';
  }
  /** unaware of the player = silent kill possible */
  get unaware() {
    if (this.boss) return false;
    return this.state === 'stand' || this.state === 'patrol' || this.state === 'sleep' || (this.state === 'suspicious' && this.awareness < 0.85);
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.asleep ? 0.3 : 1.6), this.pos.z);
  }
  facingDir(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** where a woken guard takes his stand: his spot, or for a sleeper the open floor beside his bed */
  private post: THREE.Vector3 | null = null;
  private findPost(): THREE.Vector3 {
    const sp = this.spawn.pos;
    if (this.spawn.mode !== 'sleep') return sp.clone();
    const eye = new THREE.Vector3(sp.x, sp.y + 1.0, sp.z);
    let best: THREE.Vector3 | null = null, bestScore = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const r of [1.1, 1.6]) {
        const q = new THREE.Vector3(sp.x + Math.sin(a) * r, 0, sp.z + Math.cos(a) * r);
        q.y = this.world.groundHeight(q.x, q.z, sp.y + 0.6, 0.2);
        if (q.y > sp.y - 0.05 && sp.y > 0.3) continue; // still on the bed
        if (!this.world.visible(eye, _a.set(q.x, q.y + 1.0, q.z))) continue;
        const score = this.reach(q, a) - r * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = q;
        }
      }
    }
    return best ?? sp.clone();
  }

  /** how far one can see from p toward yaw a (up to 8 m) */
  private reach(p: THREE.Vector3, a: number) {
    const eye = _d.set(p.x, p.y + 1.5, p.z);
    let r = 0;
    for (const d of [1, 2, 4, 8]) {
      if (!this.world.visible(eye, _e.set(p.x + Math.sin(a) * d, p.y + 1.5, p.z + Math.cos(a) * d))) break;
      r = d;
    }
    return r;
  }

  /** the yaw with the longest free view from here (ties go to the one nearest his current facing) */
  private openYaw() {
    let best = this.yaw, bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let dy = Math.abs(a - this.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy = Math.PI * 2 - dy;
      const score = this.reach(this.pos, a) - dy * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Is p behind this guard (for silent takedowns)? */
  isBehind(p: THREE.Vector3) {
    const to = _a.subVectors(p, this.pos).setY(0).normalize();
    return to.dot(this.facingDir(_b)) < -0.25;
  }

  /**
   * A noise of the given radius at `at`. `amount` is 1 for a single sound (a landing, a clash)
   * and dt-scaled for continuous noise (footsteps), so walking past is a gamble, not instant.
   */
  hearNoise(at: THREE.Vector3, radius: number, amount = 1) {
    if (this.spawn.rush && this.state === 'patrol' && at.distanceTo(this.pos) > 4) return;
    if (!this.alive || this.state === 'alert') return;
    const d = at.distanceTo(this.pos);
    if (d > radius) return;
    const strength = 1 - d / radius;
    if (this.state === 'sleep') {
      this.wakeMeter += amount * (0.3 + strength * 1.2);
      if (this.wakeMeter >= 1) this.wakeUp(at);
      return;
    }
    if (amount < 1 && strength < 0.35) {
      // faint footsteps at the edge of hearing only make him uneasy
      this.awareness = Math.min(0.5, this.awareness + amount * strength);
      return;
    }
    if (this.state === 'waking') return;
    this.lastKnown.copy(at);
    this.awareness = Math.max(this.awareness, 0.35 + strength * 0.4);
    this.state = 'suspicious';
    this.searchTimer = 6;
  }

  /**
   * The gate has fallen: a guard who is not yet hunting Odysseus leaves his post and runs down the
   * streets to the gate (like the panic runners: he only notices Odysseus up close, and joins the
   * battle at the end of the route).
   */
  rushTo(route: THREE.Vector3[]) {
    if (!this.alive || this.boss) return;
    // a copy: the level's spawn list must stay as it is for the next restart
    this.spawn = { ...this.spawn, rush: true, mode: 'patrol' };
    this.patrol = route;
    this.patrolIdx = 0;
    this.awareness = Math.min(this.awareness, 0.2);
    if (this.state === 'sleep' || this.state === 'waking') {
      this.wakeUp(null);
      return;
    }
    this.state = 'patrol';
  }

  wakeUp(towards: THREE.Vector3 | null) {
    if (this.state !== 'sleep') return;
    this.state = 'waking';
    this.wakeTimer = 1.4;
    if (towards) this.lastKnown.copy(towards);
  }

  alarm(at: THREE.Vector3) {
    if (!this.alive) return;
    if (this.state === 'sleep') {
      this.wakeUp(at);
      this.awareness = 1;
      return;
    }
    if (this.state === 'waking') {
      this.awareness = 1;
      return;
    }
    this.lastKnown.copy(at);
    this.goAlert();
  }

  private goAlert() {
    if (this.state !== 'alert') this.shouted = true;
    this.state = 'alert';
    this.awareness = 1;
    this.searchTimer = 12;
  }

  /**
   * Turn toward `target` with eased angular velocity. `rate` is the top speed (rad/s), `accel`
   * how quickly he gets going. Returns the remaining angle.
   */
  private turnToward(target: number, dt: number, rate: number, accel: number) {
    let d = ((target - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    const wantVel = THREE.MathUtils.clamp(d * 3.5, -rate, rate);
    this.yawVel += (wantVel - this.yawVel) * Math.min(1, dt * accel);
    this.yaw += this.yawVel * dt;
    return d;
  }

  /** Called with how visible the player is (0..1) from this guard's point of view. */
  update(dt: number, player: { pos: THREE.Vector3; alive: boolean; crouched: boolean; speed: number }, visibility: number, guards: Guard[]) {
    this.strikeLanded = false;
    const c = this.char;
    if (this.state === 'dying') {
      if (c.clipDriven) {
        // a Mixamo death clip plays out (held on its last frame); no procedural fall on top
        this.dyingT = Math.min(1, this.dyingT + dt / DEATH_CLIP);
        c.play('idle');
        c.update(dt);
        if (this.dyingT > 0.7) c.dropGear();
      } else {
        this.dyingT = Math.min(1, this.dyingT + dt * 2.2);
        c.lie = easeIn(this.dyingT);
        c.play('idle');
        c.update(dt * (1 - this.dyingT));
      }
      if (this.dyingT >= 1) {
        this.state = 'dead';
        this.settleBody();
      }
      this.sync();
      return;
    }
    if (this.state === 'dead') {
      this.sync();
      return;
    }
    // seized for a silent takedown: he neither sees nor moves until the blade comes down
    if (this.seized) {
      this.speed = 0;
      if (this.state === 'sleep') c.lie = 1;
      else c.play('idle');
      c.update(dt);
      this.sync();
      return;
    }

    const toPlayer = _a.subVectors(player.pos, this.pos);
    const dist = toPlayer.length();

    if (this.state === 'sleep') {
      // too close and not crouching wakes a sleeper
      if (player.alive && dist < 2.3 && !player.crouched && player.speed > 0.3) this.wakeMeter += dt * 1.5;
      else if (player.alive && dist < 1.3 && player.speed > 0.3) this.wakeMeter += dt * 0.35;
      this.wakeMeter = Math.max(0, this.wakeMeter - dt * 0.3);
      if (this.wakeMeter >= 1) this.wakeUp(player.pos);
      c.play('idle', 1);
      c.update(dt * 0.3);
      this.sync();
      return;
    }

    if (this.state === 'waking') {
      this.wakeTimer -= dt;
      c.lie = Math.max(0, this.wakeTimer / 1.4);
      if (this.wakeTimer <= 0) {
        c.lie = 0;
        if (this.awareness >= 1) this.goAlert();
        else if (this.spawn.rush) this.state = 'patrol';
        else {
          this.state = 'suspicious';
          this.awareness = 0.6;
          this.searchTimer = 8;
        }
      }
      c.play('idle');
      c.update(dt);
      this.sync();
      return;
    }

    // ---- perception ----
    let sees = false;
    if (player.alive && dist < 30 && (!this.boss || this.roused)) {
      const fwd = this.facingDir(_b);
      const dir = _c.copy(toPlayer).setY(0).normalize();
      const cos = dir.dot(fwd);
      const fovCos = this.state === 'alert' ? -0.2 : 0.42; // ~130° cone, wider when alert
      if (cos > fovCos || (dist < 0.9 && !player.crouched)) {
        // they see well: a lit man is spotted far off, even crouched; only cover (the sight line to his chest or,
        // crouched, to his shoulders) hides him
        let range = this.state === 'alert' ? 30 : 8 + visibility * 22;
        // runners only turn on him right beside them, and not when he already has his hands full
        if (this.spawn.rush && this.state !== 'alert') range = Guard.engaged >= 3 ? 0 : 3.0;
        if (dist < range && this.world.visible(this.eye(_d), _e.set(player.pos.x, player.pos.y + (player.crouched ? 0.85 : 1.2), player.pos.z))) {
          sees = true;
          const close = 1 - dist / range;
          // far off it takes a few seconds of being in view (time to drop behind cover), up close it is quick
          const rate = (0.15 + close * close * 2.6) * (0.4 + visibility) * (cos > 0.85 ? 1.3 : 0.8) * (this.spawn.rush ? 0.6 : 1);
          this.awareness = Math.min(1, this.awareness + rate * dt);
          this.lastKnown.copy(player.pos);
          // a runner of the fallen city does not stop to wonder: whoever he sees this close he fights
          if (this.spawn.rush && this.state !== 'alert') this.awareness = Math.min(1, this.awareness + dt * 2.5);
          else if (this.state !== 'alert' && this.awareness > 0.3) {
            this.state = 'suspicious';
            this.searchTimer = 7;
          }
        }
      }
    }
    if (!sees && this.state !== 'alert') this.awareness = Math.max(0, this.awareness - dt * 0.12);
    if (this.awareness >= 1 && this.state !== 'alert') this.goAlert();

    // ---- behaviour ----
    let moveTarget: THREE.Vector3 | null = null;
    let moveSpeed = 0;
    switch (this.state) {
      case 'stand':
        this.turnToward(this.homeYaw + Math.sin(performance.now() / 4000 + this.pos.x) * 0.25, dt, 0.8, 2);
        // glances around now and then
        this.lookTarget = Math.sin(performance.now() / 2300 + this.scanPhase) * 0.5;
        break;
      case 'patrol': {
        if (this.patrol.length) {
          const wp = this.patrol[this.patrolIdx];
          if (_f.subVectors(wp, this.pos).setY(0).length() < (this.spawn.rush ? 1.2 : 0.6)) {
            if (this.spawn.rush) {
              // a runner: no pause at the corners, and gone once the route is run
              if (this.patrolIdx >= this.patrol.length - 1) this.gone = true;
              else this.patrolIdx++;
            } else {
              this.wait += dt;
              if (this.wait > 2.5) {
                this.wait = 0;
                this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length;
              }
            }
          } else {
            moveTarget = wp;
            moveSpeed = this.spawn.rush ? 4.2 : 1.3;
          }
        }
        break;
      }
      case 'suspicious':
        this.searchTimer -= dt;
        // turn toward the disturbance, walk over slowly once fairly sure
        this.lookTarget = this.turnToward(Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z), dt, 2.2, 5) * 0.6 + Math.sin(performance.now() / 900 + this.scanPhase) * 0.35;
        if (this.awareness > 0.55 && _f.subVectors(this.lastKnown, this.pos).setY(0).length() > 1.5) {
          moveTarget = this.lastKnown;
          moveSpeed = 1.6;
        }
        if (this.searchTimer <= 0 && this.awareness < 0.2) this.state = this.spawn.mode === 'patrol' ? 'patrol' : 'search';
        break;
      case 'search':
        // a woken sleeper doesn't lie back down: he wanders back to his spot and stands guard
        if (!this.post) this.post = this.findPost();
        if (_f.subVectors(this.post, this.pos).setY(0).length() > 0.8) {
          moveTarget = this.post;
          moveSpeed = 1.2;
        } else {
          // he takes up his post facing the open room or street, never a wall
          this.state = 'stand';
          this.homeYaw = this.openYaw();
        }
        break;
      case 'alert': {
        if (!player.alive) {
          this.state = 'search';
          this.awareness = 0.3;
          break;
        }
        if (!sees) {
          this.searchTimer -= dt;
          if (this.searchTimer <= 0) {
            this.state = 'suspicious';
            this.awareness = 0.8;
            this.searchTimer = 10;
          }
        } else this.searchTimer = 12;
        const target = sees ? player.pos : this.lastKnown;
        const d = _f.subVectors(target, this.pos).setY(0).length();
        const facingErr = this.turnToward(Math.atan2(target.x - this.pos.x, target.z - this.pos.z), dt, 4.5, 10);
        this.lookTarget = facingErr * 0.5;
        // is a comrade in the way? (closer to Odysseus and near the line between us)
        this.blocked = false;
        if (sees) {
          const dir = _g.subVectors(player.pos, this.pos).setY(0).normalize();
          for (const o of guards) {
            if (o === this || !o.alive || o.asleep) continue;
            const rel = _c.subVectors(o.pos, this.pos).setY(0);
            const along = rel.dot(dir);
            if (along <= 0.2 || along >= dist) continue;
            const side = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
            if (side < 0.75) {
              this.blocked = true;
              break;
            }
          }
        }
        // engaged guards close to spear reach; the others hold a ring a few steps back and wait for a gap
        const reach = 1.8;
        const hold = this.engaged && !this.blocked ? reach : 3.4;
        if (this.stagger <= 0 && this.recoil <= 0 && this.attackWindup <= 0) {
          if (d > hold + 0.25) {
            moveTarget = target;
            // a run that eases into a walk over the last metres instead of braking in his face
            moveSpeed = THREE.MathUtils.clamp(1.0 + (d - hold - 0.25) * 1.1, 1.0, 4.6);
          } else if (!this.engaged && d < hold - 0.8 && sees) {
            // too close for a bystander: step back and to the side, out of his comrade's way
            const dir = _g.subVectors(this.pos, player.pos).setY(0).normalize();
            moveTarget = _c.copy(this.pos).addScaledVector(dir, 1.2).addScaledVector(_d.set(-dir.z, 0, dir.x), this.holdSide * 0.9);
            moveSpeed = 1.1;
          } else if (this.blocked && sees && d < hold + 0.25) {
            // sidestep to find a clear line
            const dir = _g.subVectors(player.pos, this.pos).setY(0).normalize();
            moveTarget = _c.copy(this.pos).addScaledVector(_d.set(-dir.z, 0, dir.x), this.holdSide * 1.4);
            moveSpeed = 1.0;
          } else if (sees && this.attackTimer > 0.55 && this.recover <= 0) {
            // between blows he circles: a few slow steps to one side, then the other – never a statue
            this.circleT -= dt;
            if (this.circleT <= 0) {
              this.circleT = 1.2 + Math.random() * 1.8;
              this.circleDir = Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? -1 : 1;
            }
            if (this.circleDir !== 0) {
              const dir = _g.subVectors(player.pos, this.pos).setY(0).normalize();
              moveTarget = _c.copy(this.pos).addScaledVector(_d.set(-dir.z, 0, dir.x), this.circleDir * 1.2).addScaledVector(dir, (d - hold) * 0.6);
              moveSpeed = this.boss ? 1.0 : 0.75;
            }
          }
        }
        // the shield: up whenever he stands against Odysseus, lowered half a second before his own
        // strike and for a moment after it – that is the window to hit him first
        this.attackTimer -= dt;
        this.recover = Math.max(0, this.recover - dt);
        const close = sees && d < hold + 3;
        const wasUp = this.shieldUp;
        const ready = this.engaged && !this.blocked && dist < reach + 1.2;
        this.shieldUp = close && this.stagger <= 0 && this.attackWindup <= 0 && this.recover <= 0 && Math.abs(facingErr) < 1.0 && (!ready || this.attackTimer > 0.45);
        if (wasUp && !this.shieldUp && ready && this.attackWindup <= 0 && this.stagger <= 0) this.opened = true;
        // attack: a long, visible wind-up with a step into the thrust; only with a clear line and squarely facing him
        if (sees && this.engaged && !this.blocked && dist < reach + 0.8 && Math.abs(facingErr) < 0.35 && this.attackTimer <= 0 && this.attackWindup <= 0 && this.stagger <= 0 && this.recoil <= 0) {
          this.attackWindup = GUARD_ATTACK;
          this.lunge = dist > 1.5 ? Math.min(1.1, dist - 1.2) : 0;
          c.attackKind = 'thrust';
          // Mixamo attack clips when available (alternating), else the procedural thrust
          // 'slash' is the plain cut; the spinning 'attack' only every third blow – for Hector that
          // third blow is the heavy one: slower, telegraphed, and it goes through the shield
          this.heavy = this.boss && ++this.swings % 3 === 0;
          if (!this.boss) this.swings++;
          const spin = this.swings % 3 === 0;
          const stretch = this.heavy ? 1.45 : spin ? 1.2 : 1.0;
          if (this.heavy) this.attackWindup = GUARD_ATTACK * 1.45;
          // variety: the plain cut, the sword-and-shield slash and the great two-handed slash in turn
          // (random order); the boss's heavy blow is the great slash, his spin the spinning strike
          const cuts = ['slash', 'slash3', 'gslash'];
          const clip = this.heavy ? (Math.random() < 0.5 ? 'gslash' : 'attack2') : spin ? 'attack' : cuts[Math.floor(Math.random() * cuts.length)];
          if (!c.playClip(clip, GUARD_ATTACK * stretch)) c.playClip('slash', GUARD_ATTACK * stretch);
        }
        if (this.attackWindup > 0) {
          const before = this.attackWindup;
          this.attackWindup -= dt;
          const total = this.heavy ? GUARD_ATTACK * 1.45 : GUARD_ATTACK;
          c.attack = 1 - Math.max(0, this.attackWindup) / total;
          const strikeAt = total * 0.55;
          // the step forward comes with the thrust (between the end of the wind-up and the hit)
          if (this.lunge > 0 && this.attackWindup < GUARD_ATTACK * 0.72 && this.attackWindup > strikeAt - 0.05) {
            const dir = _g.subVectors(player.pos, this.pos).setY(0).normalize();
            this.pos.addScaledVector(dir, (this.lunge / (GUARD_ATTACK * 0.22)) * dt);
            this.world.resolveHorizontal(this.pos, this.radius, 1.8, 0.52);
          }
          if (before > strikeAt && this.attackWindup <= strikeAt && dist < 2.4 && Math.abs(facingErr) < 0.6) this.strikeLanded = true;
          if (this.attackWindup <= 0) {
            c.attack = 0;
            this.lunge = 0;
            this.heavy = false;
            this.attackTimer = (this.boss ? 0.9 : 1.2) + Math.random() * 0.8;
            this.recover = this.boss ? 0.3 : 0.45;
          }
        }
        break;
      }
    }

    if (this.state !== 'alert') this.shieldUp = false;
    // stagger / knock-back after a hit
    this.stagger = Math.max(0, this.stagger - dt);
    this.recoil = Math.max(0, this.recoil - dt);
    if (this.knock.lengthSq() > 1e-4) {
      this.pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.max(0, 1 - dt * 7));
      this.world.resolveHorizontal(this.pos, this.radius, 1.8, 0.52);
      this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.52, 0.2);
    }

    // speed eases in and out instead of jumping
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * (moveSpeed > this.speed ? 4 : 3.5));
    if (this.speed < 0.05) this.speed = 0;
    let turning = 0;
    // route around walls: follow the nav grid when the straight line is not clear
    let steer = moveTarget;
    if (moveTarget && moveSpeed > 0) {
      const far = _f.subVectors(moveTarget, this.pos).setY(0).length() > 1.6;
      if (far && Guard.nav) {
        this.pathT -= dt;
        if (this.pathT <= 0 || this.pathGoal.distanceToSquared(moveTarget) > 2.25) {
          this.pathT = 0.7;
          this.pathGoal.copy(moveTarget);
          this.path = Guard.nav.clear(this.pos, moveTarget) ? [] : Guard.nav.findPath(this.pos, moveTarget);
        }
        while (this.path.length > 1 && _f.subVectors(this.path[0], this.pos).setY(0).length() < 0.7) this.path.shift();
        if (this.path.length) steer = this.path[0];
      }
      // stuck against something the grid does not know (a comrade, a cart)? step aside for a moment
      this.stuckT += dt;
      if (this.stuckT > 0.5) {
        if (this.lastPos.distanceToSquared(this.pos) < 0.12 * 0.12 && this.detourT <= 0) {
          const d = _g.subVectors(steer!, this.pos).setY(0).normalize();
          this.detour.set(-d.z, 0, d.x).multiplyScalar(this.holdSide * 2).add(this.pos);
          this.detourT = 0.7;
          this.holdSide = -this.holdSide;
          this.pathT = 0;
        }
        this.lastPos.copy(this.pos);
        this.stuckT = 0;
      }
    } else {
      this.path.length = 0;
      this.stuckT = 0;
    }
    if (this.detourT > 0) {
      this.detourT -= dt;
      steer = this.detour;
    }
    if (steer && this.speed > 0.01) {
      const dir = _f.subVectors(steer, this.pos).setY(0);
      const d = dir.length();
      if (d > 0.01) {
        dir.divideScalar(d);
        // separation from other guards
        for (const g of guards) {
          if (g === this || !g.alive || g.asleep) continue;
          const away = _g.subVectors(this.pos, g.pos).setY(0);
          const ad = away.length();
          const sep = this.state === 'alert' ? 1.7 : 1.2;
          if (ad < sep && ad > 0.001) dir.addScaledVector(away.divideScalar(ad), (sep - ad) * 1.8);
        }
        dir.normalize();
        // he walks where he looks: the body turns first, the step follows the body
        const remaining = this.turnToward(Math.atan2(dir.x, dir.z), dt, this.state === 'alert' ? 5 : 3, 8);
        const facing = Math.max(0, Math.cos(remaining));
        this.pos.addScaledVector(_g.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), this.speed * facing * dt);
        this.world.resolveHorizontal(this.pos, this.radius, 1.8, 0.52);
        this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.52, 0.2);
        turning = remaining;
      }
    }

    // head leads the turn, body leans into it
    const look = THREE.MathUtils.clamp(this.lookTarget + this.yawVel * 0.25, -0.9, 0.9);
    c.lookYaw += (look - c.lookYaw) * Math.min(1, dt * 6);
    c.lean += (-this.yawVel * 0.06 * Math.min(1, this.speed) - c.lean) * Math.min(1, dt * 5);

    // facing Odysseus he never stands stock-still: shield up (block idle) or the ready stance
    const engaging = this.state === 'alert' && player.alive && dist < 7;
    c.block += ((this.shieldUp && !c.armsBusy ? 1 : 0) - c.block) * Math.min(1, dt * 10);
    if (this.speed > 0.1) c.playGait(this.speed, false, false, this.world.onRamp(this.pos.x, this.pos.y, this.pos.z));
    else if (engaging) c.play(this.shieldUp ? 'blockidle' : 'combatidle');
    else if (Math.abs(this.yawVel) > 0.6 || Math.abs(turning) > 0.5) c.play('walk', 0.55); // shuffling the feet while turning on the spot
    else c.play('idle');
    c.update(dt);
    this.sync();
    // a body on the ground never sinks into it (limbs, shield, spear)
    if (!this.alive || this.asleep) c.clampGround(this.pos.y);
  }

  /** returns true if this killed him */
  /** set when the last blow bounced off Hector's shield (the game reads & clears it) */
  parried = false;

  hit(dmg: number, from: THREE.Vector3): boolean {
    if (!this.alive) return false;
    if (this.shieldUp && _a.subVectors(from, this.pos).setY(0).normalize().dot(this.facingDir(_b)) > 0.2) {
      // the blow rings off the raised shield: he is shoved back a step and his strike is delayed
      if (!this.char.playClip(++this.impacts % 2 ? 'impact' : 'impact2', 0.6)) this.char.flinch = 0.6;
      this.knock.subVectors(this.pos, from).setY(0).normalize().multiplyScalar(this.boss ? 1.0 : 1.9);
      this.recoil = 0.35;
      this.attackTimer = Math.max(this.attackTimer, 0.9);
      this.shieldHit = true;
      this.alarm(from);
      return false;
    }
    if (this.boss && this.attackWindup <= 0 && this.attackTimer <= 0.5 && Math.random() < 0.3) {
      // Hector parries: the blow rings off the shield; he is open right after his own swings
      this.char.playClip('block', 0.45);
      this.parried = true;
      return false;
    }
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.kill(from);
      return true;
    }
    // recoil: flinch, stumble back, the current thrust is broken off
    if (!this.char.playClip('hit', 0.5)) this.char.flinch = 1;
    this.knock.subVectors(this.pos, from).setY(0).normalize().multiplyScalar(this.boss ? 0.8 : 2.4);
    this.stagger = this.boss ? 0.25 : 0.45;
    if (this.attackWindup > 0) {
      this.attackWindup = 0;
      this.char.attack = 0;
      this.attackTimer = 0.9;
    }
    this.alarm(from);
    return false;
  }

  /** `from` is where the killing blow came from: struck from behind he falls forward, from the front backward */
  kill(from?: THREE.Vector3) {
    if (!this.alive) return;
    this.seized = false;
    this.char.attack = 0;
    if (this.torch) this.torch.lit = false; // the torch goes out in the dirt
    if (this.state === 'sleep') {
      this.state = 'dead';
      this.char.lie = 1;
      this.char.dropGear();
    } else {
      this.state = 'dying';
      this.dyingT = 0;
      this.char.lieSide = Math.random() < 0.5 ? 1 : -1;
      const fromBehind = from ? (from.x - this.pos.x) * Math.sin(this.yaw) + (from.z - this.pos.z) * Math.cos(this.yaw) < 0 : Math.random() < 0.5;
      // he falls where there is room: a wall in the way picks a clip that falls another way
      const fwd = this.facingDir(_a);
      const clear = (dx: number, dz: number) => this.world.visible(_b.set(this.pos.x, this.pos.y + 0.7, this.pos.z), _c.set(this.pos.x + dx * 1.9, this.pos.y + 0.3, this.pos.z + dz * 1.9));
      const room: Record<DeathDir, boolean> = { f: clear(fwd.x, fwd.z), b: clear(-fwd.x, -fwd.z), l: clear(fwd.z, -fwd.x) };
      let clip: string | null = null;
      for (const group of fromBehind ? [DEATHS_FORWARD, DEATHS_BACKWARD] : [DEATHS_BACKWARD, DEATHS_FORWARD]) {
        const ok = group.filter((n) => room[DEATH_DIR[n]]);
        if (ok.length) {
          clip = ok[Math.floor(Math.random() * ok.length)];
          break;
        }
      }
      this.char.playClip(clip ?? (fromBehind ? DEATHS_FORWARD : DEATHS_BACKWARD)[0], DEATH_CLIP, true);
    }
  }

  /** a comrade went down in sight: go and look (sleepers and the already alert don't react) */
  /** a body that fell across a step or a slope would sink into it: rest it on the highest ground under head, hips or feet */
  private settleBody() {
    const c = this.char;
    let y = this.pos.y;
    for (const name of ['Head', 'Hips', 'LeftFoot', 'RightFoot']) {
      const w = c.boneWorld(name, _g2);
      if (w) y = Math.max(y, this.world.groundHeight(w.x, w.z, this.pos.y + 0.8, 0.15));
    }
    this.pos.y = y;
    this.sync();
    // the dropped shield and spear lie on the ground, not in it
    this.char.settleGear((x, z) => this.world.groundHeight(x, z, this.pos.y + 0.8, 0.12));
  }

  witness(at: THREE.Vector3) {
    if (!this.alive || this.state === 'sleep' || this.state === 'waking' || this.state === 'alert') return;
    const d = at.distanceTo(this.pos);
    if (d > 22) return;
    const eye = _g.copy(this.pos).setY(this.pos.y + 1.5);
    const body = _g2.copy(at).setY(at.y + 0.6);
    if (!this.world.visible(eye, body)) return this.hearNoise(at, 6, 1);
    this.hearNoise(at, 30, 1);
    this.awareness = Math.max(this.awareness, 0.75);
  }

  sync() {
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    if (this.torch && this.torch.lit) this.char.torchWorldPos(this.torch.group.position);
  }
}

const easeIn = (t: number) => t * t;
/** duration of a guard's spear thrust (wind-up to recovery) */
const GUARD_ATTACK = 1.05;
/** seconds a death clip is stretched to */
const DEATH_CLIP = 1.7;
/** death clips by fall direction: a blow from behind throws him forward, one from the front backward */
const DEATHS_FORWARD = ['death2', 'death4', 'death3'];
const DEATHS_BACKWARD = ['death', 'fall', 'death3'];
type DeathDir = 'f' | 'b' | 'l';
/** which way each death clip falls (death3 goes down on the left side) */
const DEATH_DIR: Record<string, DeathDir> = { death2: 'f', death4: 'f', death: 'b', fall: 'b', death3: 'l' };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _g2 = new THREE.Vector3();
