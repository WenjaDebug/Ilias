import * as THREE from 'three';
import { Character } from './characters';
import { CollisionWorld } from './collision';
import { Guard } from './guards';
import { Fire } from '../fx/fire';
import { radialSprite } from '../world/textures';
import type { Audio } from './audio';
import type { Level } from '../world/level';

/**
 * The storm of Troy: once the gate stands open the Greek army pours in and meets the Trojans in the
 * gate square and the streets. The soldiers here are lightweight – no perception, no stealth – but
 * they fight with the Mixamo clips (cuts, spinning strikes, blocks, flinches, five deaths), so the
 * duels read as real fights. Odysseus is never their target: he walks past the chaos.
 */

type Side = 'greek' | 'trojan';
type SoldierState = 'advance' | 'duel' | 'recover' | 'dying' | 'dead';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const DEATHS = ['death', 'death2', 'death3', 'death4', 'fall'];

export class Soldier {
  readonly char: Character;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  hp = 100;
  state: SoldierState = 'advance';
  foe: Soldier | null = null;
  /** where he is heading while not fighting, after the waypoints of `route` (the gate for the Greeks) */
  readonly goal = new THREE.Vector3();
  route: THREE.Vector3[] = [];
  private speed = 0;
  private swingT = 1 + Math.random() * 1.5;
  /** seconds until the current swing lands on the foe (<0: none pending) */
  private hitAt = -1;
  private swings = 0;
  private recoverT = 0;
  dyingT = 0;
  /** seconds since death (bodies are tidied away by age) */
  deadFor = 0;
  readonly radius = 0.36;
  /** how fast he closes in: some run, some stride */
  readonly pace: number;
  /** some soldiers keep the shield up more than others */
  readonly guard: number;
  blockT = 0;
  /** seconds of pushing against something without getting anywhere */
  private stuckT = 0;
  /** an enemy on the far side of a wall: ignored for a while so the soldier doesn't press against the house */
  private shun: Soldier | null = null;
  private shunT = 0;
  /** route round houses on the guards' nav grid (straight line when it is clear) */
  private path: THREE.Vector3[] = [];
  private pathT = 0;
  private readonly pathGoal = new THREE.Vector3(1e9, 0, 0);

  constructor(readonly side: Side, at: THREE.Vector3, yaw: number, variant: number, private world: CollisionWorld) {
    this.char = new Character(side === 'greek' ? 'greek' : 'guard', variant);
    this.pos.copy(at);
    this.goal.copy(at);
    this.yaw = yaw;
    this.pace = 2.4 + Math.random() * 2.0;
    this.guard = 0.3 + Math.random() * 0.4;
    this.sync();
  }

  get alive() {
    return this.state !== 'dying' && this.state !== 'dead';
  }

  sync() {
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
  }

  private turnToward(yaw: number, dt: number, rate: number) {
    let d = ((yaw - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    const step = Math.min(Math.abs(d), rate * dt);
    this.yaw += Math.sign(d) * step;
    return d;
  }

  /** a blow from `from` lands: parried with the shield or taken on the body */
  receive(from: Soldier, audio: Audio, loud: number) {
    if (!this.alive) return;
    const c = this.char;
    if (Math.random() < this.guard && this.hitAt < 0) {
      // caught on the shield: a short block, the attacker is held off a moment
      c.playClip('block', 0.55);
      this.blockT = 0.55;
      if (loud > 0) audio.blocked();
      return;
    }
    this.hp -= 30 + Math.random() * 15;
    if (this.hp <= 0) {
      this.die(from.pos, audio, loud);
      return;
    }
    c.playClip('hit', 0.5);
    this.hitAt = -1;
    if (loud > 0) audio.swordHit();
  }

  die(_from: THREE.Vector3 | null, audio: Audio, loud: number) {
    if (!this.alive) return;
    this.state = 'dying';
    this.dyingT = 0;
    this.foe = null;
    this.char.attack = 0;
    this.char.playClip(DEATHS[Math.floor(Math.random() * DEATHS.length)], 1.7, true);
    if (loud > 0) setTimeout(() => audio.bodyFall(), 500);
  }

  update(dt: number, soldiers: Soldier[], audio: Audio, playerPos: THREE.Vector3) {
    const c = this.char;
    // how much of this soldier's noise reaches the player (sounds are only played close by)
    const loud = this.pos.distanceToSquared(playerPos) < 18 * 18 ? 1 : 0;
    if (this.state === 'dying') {
      this.dyingT += dt;
      c.play('idle');
      c.update(dt);
      if (this.dyingT > 1.2) c.dropGear();
      if (this.dyingT >= 1.7) this.state = 'dead';
      this.sync();
      c.clampGround(this.pos.y);
      return;
    }
    if (this.state === 'dead') {
      this.deadFor += dt;
      c.update(dt * 0.2);
      this.sync();
      c.clampGround(this.pos.y);
      return;
    }

    this.blockT = Math.max(0, this.blockT - dt);
    let moveSpeed = 0;
    let target: THREE.Vector3 | null = null;

    if (this.foe && !this.foe.alive) {
      this.foe = null;
      this.state = 'recover';
      this.recoverT = 0.6 + Math.random() * 1.2;
      this.swingT = 1 + Math.random();
    }

    if (this.state === 'recover') {
      this.recoverT -= dt;
      if (this.recoverT <= 0) this.state = 'advance';
    }

    if (this.state === 'advance' || this.state === 'recover') {
      // the nearest enemy within reach becomes the foe (two may gang up on one)
      let best: Soldier | null = null, bestD = 14 * 14;
      for (const o of soldiers) {
        if (o === this || o.side === this.side || !o.alive) continue;
        if (o === this.shun && this.shunT > 0) continue;
        if (o.foe && o.foe !== this && o.foe.alive && o.foe.foe === o) {
          // already in a duel: only join if the pair is close and nobody else has
          const others = soldiers.filter((s) => s !== this && s.alive && s.side === this.side && s.foe === o).length;
          if (others >= 1) continue;
        }
        const d = o.pos.distanceToSquared(this.pos);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (!best) {
        // nobody close: march on the nearest enemy anywhere instead of standing about in the street
        let far = Infinity;
        for (const o of soldiers) {
          if (o === this || o.side === this.side || !o.alive || (o === this.shun && this.shunT > 0)) continue;
          const d = o.pos.distanceToSquared(this.pos);
          if (d < far) {
            far = d;
            best = o;
          }
        }
        if (best) bestD = far;
      }
      if (best) {
        this.foe = best;
        if (!best.foe || !best.foe.alive) best.foe = this;
        const d = Math.sqrt(bestD);
        if (d < 1.75) {
          this.state = 'duel';
        } else {
          target = best.pos;
          moveSpeed = Math.min(this.pace, 1.2 + (d - 1.75) * 1.4);
        }
      } else {
        if (this.route.length && _a.subVectors(this.route[0], this.pos).setY(0).length() < 1.5) this.route.shift();
        const to = this.route.length ? this.route[0] : this.goal;
        const d = _a.subVectors(to, this.pos).setY(0).length();
        if (d > 0.8) {
          target = to;
          moveSpeed = Math.min(this.pace, 1.0 + d * 0.8);
        }
      }
    }

    if (this.state === 'duel') {
      const f = this.foe;
      if (!f || !f.alive) {
        this.state = 'recover';
        this.recoverT = 0.8;
      } else {
        const d = _a.subVectors(f.pos, this.pos).setY(0).length();
        const err = this.turnToward(Math.atan2(f.pos.x - this.pos.x, f.pos.z - this.pos.z), dt, 6);
        if (d > 2.2) {
          target = f.pos;
          moveSpeed = 1.6;
        } else if (d < 1.0) {
          // too close: a half step back
          target = _b.copy(this.pos).addScaledVector(_c.subVectors(this.pos, f.pos).setY(0).normalize(), 1);
          moveSpeed = 0.8;
        }
        this.swingT -= dt;
        if (this.swingT <= 0 && this.hitAt < 0 && this.blockT <= 0 && Math.abs(err) < 0.5 && d < 2.4 && !c.clipDriven) {
          this.swings++;
          const spin = this.swings % 4 === 0;
          const dur = spin ? 1.3 : 0.95;
          c.playClip(spin ? (Math.random() < 0.5 ? 'attack' : 'attack2') : 'slash', dur);
          this.hitAt = dur * 0.5;
          this.swingT = dur + 0.4 + Math.random() * 1.4;
          if (loud > 0 && Math.random() < 0.6) audio.swordSwing();
          if (loud > 0 && Math.random() < 0.12) audio.shout();
        }
        if (this.hitAt >= 0) {
          this.hitAt -= dt;
          if (this.hitAt < 0 && d < 2.6) f.receive(this, audio, loud);
        }
      }
    }

    // movement with a little separation so the melee doesn't collapse into one spot
    this.speed += (moveSpeed - this.speed) * Math.min(1, dt * 4);
    if (this.speed < 0.05) this.speed = 0;
    this.shunT -= dt;
    _d.copy(this.pos);
    // round the houses, not into them: follow the nav grid whenever the straight line is blocked
    if (target && Guard.nav && _b.subVectors(target, this.pos).setY(0).length() > 1.6) {
      this.pathT -= dt;
      if (this.pathT <= 0 || this.pathGoal.distanceToSquared(target) > 4) {
        this.pathT = 0.8 + Math.random() * 0.3;
        this.pathGoal.copy(target);
        this.path = Guard.nav.clear(this.pos, target) ? [] : Guard.nav.findPath(this.pos, target);
      }
      while (this.path.length > 1 && _b.subVectors(this.path[0], this.pos).setY(0).length() < 0.8) this.path.shift();
      if (this.path.length) target = this.path[0];
    } else this.path.length = 0;
    if (target && this.speed > 0.01) {
      const dir = _b.subVectors(target, this.pos).setY(0);
      if (dir.lengthSq() > 1e-4) {
        dir.normalize();
        for (const o of soldiers) {
          if (o === this || !o.alive) continue;
          const away = _c.subVectors(this.pos, o.pos).setY(0);
          const ad = away.length();
          if (ad < 1.1 && ad > 0.001) dir.addScaledVector(away.divideScalar(ad), (1.1 - ad) * 1.6);
        }
        dir.normalize();
        const remaining = this.state === 'duel' ? 0 : this.turnToward(Math.atan2(dir.x, dir.z), dt, 5);
        const facing = Math.max(0.2, Math.cos(remaining));
        this.pos.addScaledVector(dir, this.speed * facing * dt);
        this.world.resolveHorizontal(this.pos, this.radius, 1.8, 0.52);
        this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.52, 0.2);
      }
      // pressing against a house (the enemy or the goal is behind it): give up on that enemy for a while,
      // or take the detour over the square
      const moved = _d.sub(this.pos).setY(0).length();
      if (this.speed > 0.6 && moved < this.speed * dt * 0.3) this.stuckT += dt;
      else this.stuckT = 0;
      if (this.stuckT > 1.0) {
        this.stuckT = 0;
        if (this.foe && this.state !== 'duel') {
          this.shun = this.foe;
          this.shunT = 6;
          if (this.foe.foe === this) this.foe.foe = null;
          this.foe = null;
        } else if (!this.foe) {
          this.route.unshift(SQUARE.clone().add(_c.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 3)));
        }
      }
    } else {
      this.stuckT = 0;
    }
    if (this.speed > 0.1) c.playGait(this.speed);
    else c.play('idle');
    c.update(dt);
    this.sync();
  }
}

/** a burning roof: flames, a glow and a slow column of smoke */
class Blaze {
  readonly fire: Fire;
  readonly smoke: THREE.Sprite[] = [];
  private t = Math.random() * 5;
  constructor(readonly site: FireSite, scene: THREE.Scene, smokeTex: THREE.Texture) {
    this.fire = new Fire(site.size, 50);
    this.fire.group.position.set(site.x, site.y, site.z);
    scene.add(this.fire.group);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x30221a, transparent: true, opacity: 0, depthWrite: false }));
      s.position.set(site.x, site.y, site.z);
      scene.add(s);
      this.smoke.push(s);
    }
  }
  update(dt: number, wind: number) {
    this.t += dt;
    const n = this.smoke.length;
    for (let i = 0; i < n; i++) {
      const s = this.smoke[i];
      const life = 7;
      const k = ((this.t + (i / n) * life) % life) / life;
      s.position.set(this.site.x + k * k * wind * 6 + Math.sin(this.t * 0.7 + i) * 0.4, this.site.y + 1 + k * 9, this.site.z + Math.cos(this.t * 0.5 + i * 2) * 0.4);
      const sz = this.site.size * (1.5 + k * 5);
      s.scale.set(sz, sz, 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.35 * Math.sin(k * Math.PI);
    }
  }
}

export interface FireSite {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** the gate square and the streets behind it, where the fighting happens */
const GATE = new THREE.Vector3(22, 0, 72);
const SQUARE = new THREE.Vector3(22, 0, 61);
/** where the Trojans come from to meet the Greeks */
const TROJAN_POINTS = [new THREE.Vector3(22, 0, 50), new THREE.Vector3(14, 0, 46), new THREE.Vector3(40, 0, 60), new THREE.Vector3(10, 0, 62), new THREE.Vector3(50, 0, 60), new THREE.Vector3(14, 0, 34)];
/** through the gate first, then into the square */
const GATE_INSIDE = new THREE.Vector3(22, 0, 65);
/** spots the Greeks fan out to once inside */
const GREEK_GOALS = [new THREE.Vector3(14, 0, 62), new THREE.Vector3(30, 0, 62), new THREE.Vector3(22, 0, 56), new THREE.Vector3(22, 0, 50), new THREE.Vector3(40, 0, 60), new THREE.Vector3(12, 0, 58), new THREE.Vector3(32, 0, 58), new THREE.Vector3(48, 0, 60)];

export class Storm {
  soldiers: Soldier[] = [];
  private t = 0;
  private spawnT = 0;
  /** time of the next Greek squad at the gate */
  private nextSquad = 6;
  private greeks = 0;
  private trojans = 0;
  private blazes: Blaze[] = [];
  private nextFire = 0;
  private sites: FireSite[];
  private smokeTex: THREE.Texture;
  /** soft ember glows over the burning quarters, not fogged, so the fire shows from the palace balcony */
  private glows: THREE.Sprite[] = [];
  private glowT = 0;
  private shoutT = 0;
  /** 0..1 how far the city has gone up in flames */
  burning = 0;
  /** total Greeks that come through the gate */
  readonly greekTotal = 60;
  private readonly trojanTotal = 30;
  readonly fires: Fire[] = [];
  /** living soldiers at once (M-chip budget) */
  private readonly cap = 44;

  constructor(private scene: THREE.Scene, private level: Level, private audio: Audio) {
    this.smokeTex = radialSprite('rgba(40,28,22,0.9)', 'rgba(40,28,22,0)', 64);
    // the fire starts at the gate and eats its way north; every fourth site lies in the western quarter
    // (horse square, plaza), which is what Hector's balcony looks out on
    const site = (r: { x: number; z: number; w: number; d: number; h: number }): FireSite => ({ x: r.x + (Math.random() - 0.5) * r.w * 0.5, y: r.h + 0.1, z: r.z + (Math.random() - 0.5) * r.d * 0.5, size: 1.2 + Math.random() * 1.2 });
    const byGate = level.roofs
      .filter((r) => r.z > -40)
      .map(site)
      .sort((a, b) => Math.hypot(a.x - GATE.x, a.z - GATE.z) - Math.hypot(b.x - GATE.x, b.z - GATE.z))
      .filter((_, i) => i % 3 === 0);
    const west = level.roofs
      .filter((r) => r.z <= -30 && r.x < 40)
      .map(site)
      .sort(() => Math.random() - 0.5);
    this.sites = [];
    for (let i = 0; this.sites.length < 26 && (byGate.length || west.length); i++) {
      const w = i % 4 === 3 ? west.shift() : byGate.shift();
      if (w) this.sites.push(w);
    }
    const glowTex = radialSprite('rgba(255,120,40,0.55)', 'rgba(255,90,30,0)', 64);
    for (let i = 0; i < this.sites.length; i++) {
      const site = this.sites[i];
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      g.position.set(site.x, site.y + 6, site.z);
      g.scale.setScalar(22 + site.size * 6);
      scene.add(g);
      this.glows.push(g);
    }
  }

  /** the gate is open: the first wave is already running in */
  start() {
    this.t = 0;
    // the first squad bursts in as one mass, ranks of four
    for (let i = 0; i < 20; i++) this.spawnGreek(Math.floor(i / 4) * 0.4);
    for (let i = 0; i < 8; i++) this.spawnTrojan();
    this.nextFire = 6;
    this.nextSquad = 4;
  }

  private spawnGreek(delay = 0) {
    if (this.greeks >= this.greekTotal) return;
    const i = this.greeks++;
    const at = _a.set(GATE.x + (Math.random() - 0.5) * 4, 0, GATE.z + 5 + delay * 4 + Math.random() * 2);
    const s = new Soldier('greek', at, Math.PI, i, this.level.world);
    s.route = [GATE_INSIDE.clone().add(_b.set((Math.random() - 0.5) * 3, 0, 0))];
    s.goal.copy(GREEK_GOALS[i % GREEK_GOALS.length]).add(_b.set((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
    this.scene.add(s.char.root);
    this.soldiers.push(s);
  }

  private spawnTrojan() {
    if (this.trojans >= this.trojanTotal) return;
    const i = this.trojans++;
    const p = TROJAN_POINTS[i % TROJAN_POINTS.length];
    const at = _a.set(p.x + (Math.random() - 0.5) * 2, 0, p.z + (Math.random() - 0.5) * 2);
    const s = new Soldier('trojan', at, 0, 10 + i, this.level.world);
    // the alleys: B (x 12–16) up to the jog at z 50, then B2 (x 20–24) down into the square
    if (p.z < 56) s.route = p.x < 20 ? [new THREE.Vector3(14, 0, 50), new THREE.Vector3(22, 0, 50), new THREE.Vector3(22, 0, 58)] : [new THREE.Vector3(22, 0, 58)];
    s.goal.copy(SQUARE).add(_b.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 4));
    this.scene.add(s.char.root);
    this.soldiers.push(s);
  }

  /** a guard of the city who ran to the gate joins the battle there as a Trojan soldier */
  joinTrojan(pos: THREE.Vector3, yaw: number) {
    const s = new Soldier('trojan', pos, yaw, 30 + this.joined++, this.level.world);
    s.goal.copy(SQUARE).add(_b.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 4));
    this.scene.add(s.char.root);
    this.soldiers.push(s);
  }
  private joined = 0;

  get alive() {
    return this.soldiers.filter((s) => s.alive).length;
  }

  /** a Trojan of the storm who spots Odysseus up close leaves the melee and goes for him (the game makes him a guard) */
  onDefect?: (pos: THREE.Vector3, yaw: number) => boolean;
  private defectT = 0;

  update(dt: number, playerPos: THREE.Vector3) {
    this.t += dt;
    this.defectT -= dt;
    if (this.onDefect && this.defectT <= 0) {
      this.defectT = 0.5;
      for (const s of this.soldiers) {
        if (!s.alive || s.side !== 'trojan' || s.state === 'duel') continue;
        const d = s.pos.distanceTo(playerPos);
        if (d > 3 || Math.abs(s.pos.y - playerPos.y) > 1.5) continue;
        // a Greek closer than Odysseus keeps him busy
        if (s.foe && s.foe.alive && s.foe.pos.distanceTo(s.pos) < d) continue;
        if (!this.level.world.visible(_a.set(s.pos.x, s.pos.y + 1.6, s.pos.z), _b.set(playerPos.x, playerPos.y + 1.2, playerPos.z))) continue;
        if (!this.onDefect(s.pos, s.yaw)) break;
        // one at a time: the battle around him goes on, it does not all turn on him
        this.defectT = 5;
        s.char.root.removeFromParent();
        this.soldiers.splice(this.soldiers.indexOf(s), 1);
        break;
      }
    }
    // waves: more and more Greeks, Trojans trickling in to meet them, as long as the budget allows
    // the Greeks come in squads – eight or so men at once through the gate, not one by one
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.5;
      const alive = this.alive;
      const greeksAlive = this.soldiers.filter((s) => s.alive && s.side === 'greek').length;
      const trojansAlive = alive - greeksAlive;
      const room = this.cap - alive;
      if (this.greeks < this.greekTotal && room >= 6 && greeksAlive <= trojansAlive + 14 && this.t > this.nextSquad) {
        const n = Math.min(8, room - 2, this.greekTotal - this.greeks);
        for (let i = 0; i < n; i++) this.spawnGreek(Math.floor(i / 4) * 0.45);
        this.nextSquad = this.t + 4.5;
      }
      if (this.trojans < this.trojanTotal && trojansAlive < greeksAlive && this.alive < this.cap) {
        this.spawnTrojan();
        if (this.alive < this.cap && trojansAlive + 1 < greeksAlive - 2) this.spawnTrojan();
      }
    }
    for (const s of this.soldiers) s.update(dt, this.soldiers, this.audio, playerPos);
    // the living are solid: Odysseus can't walk through a soldier, he is pushed aside (and the soldier gives a little)
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const dx = playerPos.x - s.pos.x, dz = playerPos.z - s.pos.z;
      const d = Math.hypot(dx, dz), min = 0.35 + s.radius;
      if (d >= min || d < 1e-4 || Math.abs(playerPos.y - s.pos.y) > 1.2) continue;
      const push = min - d;
      playerPos.x += (dx / d) * push * 0.75;
      playerPos.z += (dz / d) * push * 0.75;
      s.pos.x -= (dx / d) * push * 0.25;
      s.pos.z -= (dz / d) * push * 0.25;
    }
    // bodies: the oldest go once they are out of sight and there are many
    const dead = this.soldiers.filter((s) => s.state === 'dead');
    if (dead.length > 14) {
      const old = dead.sort((a, b) => b.deadFor - a.deadFor)[0];
      if (old.deadFor > 8 && old.pos.distanceTo(playerPos) > 20) {
        old.char.root.removeFromParent();
        this.soldiers.splice(this.soldiers.indexOf(old), 1);
      }
    }
    // a war cry now and then from the melee
    this.shoutT -= dt;
    if (this.shoutT <= 0) {
      this.shoutT = 2 + Math.random() * 4;
      const near = this.soldiers.some((s) => s.alive && s.pos.distanceTo(playerPos) < 30);
      if (near) this.audio.shout();
    }
    // the fire spreads
    this.nextFire -= dt;
    if (this.nextFire <= 0 && this.blazes.length < this.sites.length) {
      this.nextFire = 5 + Math.random() * 5;
      const b = new Blaze(this.sites[this.blazes.length], this.scene, this.smokeTex);
      this.blazes.push(b);
      this.fires.push(b.fire);
      this.level.fires.push(b.fire);
    }
    this.burning = this.blazes.length / this.sites.length;
    const wind = 0.6;
    for (const b of this.blazes) b.update(dt, wind);
    this.updateGlows(dt);
  }

  private updateGlows(dt: number) {
    this.glowT += dt;
    const lit = this.blazes.length;
    this.glows.forEach((g, i) => {
      // each glow belongs to the blaze of its site; it swells as that roof catches
      const on = lit > i ? 1 : 0;
      const m = g.material as THREE.SpriteMaterial;
      const want = on * (0.16 + 0.05 * Math.sin(this.glowT * 2.3 + i * 1.7)) * Math.min(1, 0.4 + this.burning * 2);
      m.opacity += (want - m.opacity) * Math.min(1, dt * 0.5);
    });
  }

  /** everything back to the start (checkpoint restore) */
  reset() {
    for (const s of this.soldiers) s.char.root.removeFromParent();
    this.soldiers = [];
    this.greeks = this.trojans = 0;
    for (const b of this.blazes) {
      b.fire.group.removeFromParent();
      for (const s of b.smoke) s.removeFromParent();
      const i = this.level.fires.indexOf(b.fire);
      if (i >= 0) this.level.fires.splice(i, 1);
    }
    this.blazes = [];
    this.fires.length = 0;
    this.burning = 0;
    this.t = 0;
    for (const g of this.glows) (g.material as THREE.SpriteMaterial).opacity = 0;
  }

  /** skip ahead: the city already burns this far (checkpoint after the storm) */
  advanceFire(n: number) {
    while (this.blazes.length < Math.min(n, this.sites.length)) {
      const b = new Blaze(this.sites[this.blazes.length], this.scene, this.smokeTex);
      this.blazes.push(b);
      this.fires.push(b.fire);
      this.level.fires.push(b.fire);
    }
    this.burning = this.blazes.length / this.sites.length;
    this.updateGlows(30); // (settles the glows at once)
  }
}
