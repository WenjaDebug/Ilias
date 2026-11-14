import * as THREE from 'three';
import { Level, GuardSpawn } from '../world/level';
import { LightPool } from '../fx/fire';
import { Post } from '../fx/post';
import { Player } from './player';
import { Guard } from './guards';
import { ThirdPersonCamera } from './camera';
import { Input } from './input';
import { arrowSpeed, ARROW_GRAVITY, Arrows, ArrowHit, raycastGuards } from './arrows';
import { Audio } from './audio';
import { HUD } from '../ui/hud';
import { bowMesh, arrowBundleMesh, Character } from './characters';
import { Storm } from './finale';

type Phase = 'title' | 'intro' | 'play' | 'dead' | 'end';
type Step = 'guards' | 'bow' | 'alley' | 'plaza' | 'alleyB' | 'ambush' | 'toGate' | 'toPalace' | 'key' | 'bolt' | 'gatekey' | 'winch' | 'storm' | 'tower' | 'hector' | 'helena' | 'done';
/** the finale's state, kept in the snapshot so a death puts it back */
interface FinaleState {
  unlocked: boolean;
  boltT: number;
  boltDone: boolean;
  gateKey: boolean;
  doorOpen: boolean;
  winchT: number;
  gateOpen: boolean;
  hectorIntro: boolean;
}
/** the last son of Priam in the tower: Helena's husband after Paris fell (Odyssey 8.517); one name for every text */
export const BOSS = 'Deiphobos';
const GATE_X = 22;
/** the bolt's centre x for a push progress t: 1.9 m of the 6 m beam start in the east tower's socket, and at
 *  t = 1 it has slid all the way in, its west end flush with the tower face – nothing is left hanging in the
 *  passage when the leaves swing open */
const BOLT_SLIDE = 4.12;
const boltX = (t: number) => GATE_X + 1.4 + t * BOLT_SLIDE;
/** the capstan: total turn of the drum over the whole winding (≈1.5 rounds, ~0.7 rad/s), where he holds a bar */
const WINCH_TURN = 9.1, CAP_GRIP = 1.12, CAP_BEHIND = 0.5;
/** routes the panicking Trojans run (toward the gate, away from the palace) */
const PANIC_ROUTES: [number, number][][] = [
  [[76, 60], [40, 60], [26, 62], [20, 72]],
  [[82, 10], [81.8, 16.6], [82.5, 26], [65.2, 27.5], [65.2, 36], [67, 44], [66, 56], [40, 60], [22, 66]],
  [[92, -2], [83, 6], [81.8, 16.6], [82.5, 26], [65.2, 27.5], [65.2, 36], [67, 44]],
  [[62, 48], [60, 60], [40, 60], [24, 64], [20, 72]],
  [[65.2, 28], [65.2, 36], [67, 44], [64, 58], [44, 60]],
];

/** the runs to the gate square when the gate has fallen (upper town through alley B, the lower town, the palace forecourt) */
const RUSH_ROUTES: [number, number][][] = [
  [[13, 26], [13, 36], [13.5, 43], [15, 48], [22, 50], [22, 58], [23, 61]],
  [[82, 10], [81.8, 16.6], [82.5, 26], [65.2, 27.5], [65.2, 36], [67, 44], [66, 56], [40, 60], [24, 61]],
  [[76, 60], [56, 59], [40, 60], [24, 61]],
];

interface Snapshot {
  id: string;
  spawn: THREE.Vector3;
  yaw: number;
  step: Step;
  hasBow: boolean;
  hasKey: boolean;
  arrows: number;
  dead: Map<string, { pos: THREE.Vector3; yaw: number }>;
  bowOnGround: boolean;
  ambushDone: boolean;
  finale: FinaleState;
}

const REINFORCEMENT_POINTS = [
  new THREE.Vector3(-28, 0, 10), new THREE.Vector3(32, 0, 18), new THREE.Vector3(-6, 0, 38),
  new THREE.Vector3(28, 0, -38), new THREE.Vector3(-28, 0, -46), new THREE.Vector3(16, 0, -14),
  new THREE.Vector3(20, 0, 38),
];

/** Ties everything together: intro, objectives, stealth rules, combat, checkpoints. */
export class Game {
  phase: Phase = 'title';
  step: Step = 'guards';
  readonly player: Player;
  guards: Guard[] = [];
  /** characters that only stand and animate (previews; later the Greek army) */
  extras: Character[] = [];
  readonly cam: ThirdPersonCamera;
  readonly arrows: Arrows;
  readonly audio = new Audio();
  readonly hud = new HUD();
  private lightPool: LightPool;
  private moon: THREE.DirectionalLight;
  private introT = 0;
  /** intro time at which Odysseus reached the bottom of the rope (100 = still climbing) */
  private introDescEnd = 100;
  private ropeDropT = 0;
  private rope = { started: false, y: 0, grip: [0, 0] as [number, number], move: -1, moveT: 0, from: 0, to: 0 };
  private deadT = 0;
  private droppedBow: THREE.Group | null = null;
  private swingQueued = 0;
  private defectors = 0;
  /** a silent takedown in progress */
  private tk: { g: Guard; t: number; from: THREE.Vector3; to: THREE.Vector3; yaw: number; struck: boolean; dur: number; strike: number } | null = null;
  /** the city's guards were sent to the gate (once the gate is open) */
  private cityRushed = false;
  /** debug: how often the shield check had to push a foe back */
  shieldPushes = 0;
  /** arrow bundles dropped by dead guards, waiting to be picked up */
  private droppedArrows: { mesh: THREE.Group; n: number }[] = [];
  private reached = new Set<string>();
  private snapshot!: Snapshot;
  private alarmCooldown = 0;
  private reinforceTimer = 0;
  private reinforcements = 0;
  private ambushDone = false;
  private damageFlash = 0;
  private detections = 0;
  /** speedrun clock: game time since the start (runs through deaths and cinematics, stops while paused);
   *  runs started from a chapter don't count for the best time */
  runTime = 0;
  ranked = true;
  bestTime: number | null = null;
  paused = false;
  readonly danger = { detection: 0, alert: false };
  /** seconds of slow motion left (head shots) */
  private hitstop = 0;
  // ---- the finale ----
  private fin: FinaleState = { unlocked: false, boltT: 0, boltDone: false, gateKey: false, doorOpen: false, winchT: 0, gateOpen: false, hectorIntro: false };
  private storm: Storm;
  private helena: Character | null = null;
  /** a cinematic in progress: the camera is scripted, Odysseus stands still */
  private cine: { kind: 'gate' | 'hector' | 'end'; t: number; dur: number } | null = null;
  private captainTimer = -1;
  private gateKeyMesh: THREE.Object3D | null = null;
  private doorT = 0;
  private gateT = 0;
  private bellT = -1;
  private bellRing = 0;
  private waves = 0;
  private grindT = 0;
  /** which of the capstan's four bars Odysseus took hold of (-1: none yet) */
  private capBar = -1;
  private runnerT = 4;
  private runners = 0;
  private heavyHint = false;
  private hemi: THREE.HemisphereLight | null = null;
  private readonly fogBase = new THREE.Color();
  private readonly hemiBase = new THREE.Color();
  private hemiBaseIntensity = 1;

  constructor(
    private scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    readonly level: Level,
    readonly input: Input,
    readonly post: Post,
  ) {
    Guard.nav = level.nav;
    this.player = new Player(level.world);
    scene.add(this.player.char.root);
    this.cam = new ThirdPersonCamera(camera, level.world);
    this.arrows = new Arrows(scene, level.world);
    this.lightPool = new LightPool(scene, 10, 1);

    this.moon = new THREE.DirectionalLight(0x8a9ac0, 0.95);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -38;
    sc.right = sc.top = 38;
    sc.near = 1;
    sc.far = 160;
    this.moon.shadow.bias = -0.0008;
    this.moon.shadow.normalBias = 0.04;
    scene.add(this.moon, this.moon.target);

    this.spawnGuards(level.guards, new Map());
    this.storm = new Storm(scene, level, this.audio);
    // a Trojan of the storm who sees Odysseus close by turns on him: he becomes a guard (shield game, max two attackers)
    this.storm.onDefect = (pos, yaw) => {
      if (this.phase !== 'play' || this.cine || this.guards.filter((g) => g.alive && g.alerted && g.pos.distanceTo(this.player.pos) < 12).length >= 2) return false;
      const g = new Guard({ id: `storm-t-${++this.defectors}`, pos: pos.clone(), facing: yaw, mode: 'stand' }, this.level.world);
      g.alarm(this.player.pos);
      g.shouted = false;
      this.scene.add(g.char.root);
      this.guards.push(g);
      return true;
    };
    this.hemi = (scene.children.find((o) => (o as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight) ?? null;
    if (scene.fog) this.fogBase.copy(scene.fog.color);
    if (this.hemi) {
      this.hemiBase.copy(this.hemi.color);
      this.hemiBaseIntensity = this.hemi.intensity;
    }
    // Helena waits on the tower balcony, looking out over the city
    try {
      const h = new Character('helena');
      h.root.position.copy(level.helenaPoint);
      h.root.rotation.y = -Math.PI / 2 + 0.3;
      h.play('idle');
      scene.add(h.root);
      this.extras.push(h);
      this.helena = h;
    } catch {
      this.helena = null;
    }
    this.snapshot = this.makeSnapshot('start', new THREE.Vector3(0, level.horse.platformTop, -48.5), 0);
  }

  // ---------------- setup / checkpoints ----------------

  private spawnGuards(spawns: GuardSpawn[], dead: Map<string, { pos: THREE.Vector3; yaw: number }>) {
    for (const g of this.guards) {
      g.char.root.removeFromParent();
      if (g.torch) {
        g.torch.group.removeFromParent();
        const i = this.level.fires.indexOf(g.torch);
        if (i >= 0) this.level.fires.splice(i, 1);
      }
    }
    this.guards = [];
    for (const s of spawns) {
      const g = new Guard(s, this.level.world);
      const d = dead.get(s.id);
      if (d) {
        g.pos.copy(d.pos);
        g.yaw = d.yaw;
        g.state = 'dead';
        if (!g.char.clipDriven) g.char.lie = 1;
        g.bowDropped = true;
        g.arrowsDropped = true;
        g.update(0, { pos: this.player.pos, alive: true, crouched: true, speed: 0 }, 0, []);
      }
      this.scene.add(g.char.root);
      if (g.torch) {
        this.scene.add(g.torch.group);
        this.level.fires.push(g.torch);
        if (d) g.torch.lit = false;
      }
      this.guards.push(g);
    }
  }

  private makeSnapshot(id: string, spawn: THREE.Vector3, yaw: number): Snapshot {
    const dead = new Map<string, { pos: THREE.Vector3; yaw: number }>();
    for (const g of this.guards) if (!g.alive && !g.id.startsWith('reinf') && !g.id.startsWith('storm-t')) dead.set(g.id, { pos: g.pos.clone(), yaw: g.yaw });
    return {
      id, spawn: spawn.clone(), yaw, step: this.step, hasBow: this.player.hasBow, hasKey: this.player.hasKey, arrows: this.player.arrows,
      dead, bowOnGround: !!this.droppedBow, ambushDone: this.ambushDone, finale: { ...this.fin },
    };
  }

  /** put the gate, the gatehouse and the storm into the state the finale flags describe */
  private applyFinale() {
    const f = this.fin, lv = this.level, world = lv.world;
    lv.padlock.visible = !f.unlocked;
    lv.bolt.position.x = boltX(f.boltT);
    const drum = lv.gatehouse.winch.getObjectByName('drum');
    if (drum) drum.rotation.y = f.winchT * WINCH_TURN;
    this.capBar = -1;
    lv.gatehouse.door.rotation.y = f.doorOpen ? -1.9 : 0;
    this.doorT = f.doorOpen ? 1 : 0;
    const db = world.boxes.indexOf(lv.gatehouse.doorBox);
    if (f.doorOpen && db >= 0) world.boxes.splice(db, 1);
    if (!f.doorOpen && db < 0) world.boxes.push(lv.gatehouse.doorBox);
    const gb = world.boxes.indexOf(lv.gateBox);
    if (f.gateOpen && gb >= 0) world.boxes.splice(gb, 1);
    if (!f.gateOpen && gb < 0) world.boxes.push(lv.gateBox);
    this.gateT = f.gateOpen ? 1 : 0;
    this.setGateLeaves(this.gateT);
    this.storm.reset();
    this.cityRushed = false;
    if (f.gateOpen) {
      this.storm.start();
      this.storm.advanceFire(this.step === 'storm' ? 3 : 12);
    }
    if (this.gateKeyMesh) {
      this.gateKeyMesh.removeFromParent();
      this.gateKeyMesh = null;
    }
    this.captainTimer = -1;
    this.bellT = -1;
    this.waves = f.winchT > 0.6 ? 2 : f.winchT > 0.2 ? 1 : 0;
    this.runners = 0;
    this.runnerT = 4;
    this.cine = null;
  }

  private setGateLeaves(open: number) {
    const k = open * open * (3 - 2 * open);
    const l = this.level.gate.getObjectByName('gateLeft'), r = this.level.gate.getObjectByName('gateRight');
    // inward (toward the city): the open leaves lie flat along the tower faces
    if (l) l.rotation.y = 1.62 * k;
    if (r) r.rotation.y = -1.62 * k;
  }

  private restoreSnapshot() {
    const s = this.snapshot;
    this.tk = null;
    this.player.forceSword = false;
    this.arrows.clear();
    for (const d of this.droppedArrows) d.mesh.removeFromParent();
    this.droppedArrows = [];
    this.spawnGuards(this.level.guards, s.dead);
    this.reinforcements = 0;
    this.step = s.step;
    this.ambushDone = s.ambushDone;
    this.fin = { ...s.finale };
    this.applyFinale();
    // the gate captain is not one of the level's guards: after a death past the bolt he must come back
    // (or, if he had already fallen, his key must lie where he fell), else the gatehouse stays shut for good
    if (this.fin.boltDone && !this.fin.gateKey) {
      const dc = s.dead.get('gate-captain');
      if (dc) this.dropGateKey(dc.pos, dc.yaw);
      else this.captainTimer = 1.5;
    }
    this.hud.show(true);
    this.player.hasBow = s.hasBow;
    this.player.hasKey = s.hasKey;
    this.level.key.visible = !s.hasKey;
    this.player.arrows = Math.max(s.arrows, s.hasBow ? 6 : 0);
    this.player.weapon = 'sword';
    this.player.hp = 100;
    this.player.alive = true;
    this.player.crouched = true;
    this.player.teleport(s.spawn, s.yaw);
    this.cam.snapBehind(s.yaw);
    if (s.bowOnGround && !this.droppedBow) this.dropBow(this.guards.find((g) => g.hasBow)!);
    if (!s.bowOnGround && this.droppedBow) {
      this.droppedBow.removeFromParent();
      this.droppedBow = null;
    }
    this.refreshObjective();
  }

  // ---------------- flow ----------------

  start(skipIntro = false, checkpoint?: string) {
    this.audio.start();
    this.hud.show(skipIntro || !!checkpoint);
    this.runTime = 0;
    this.ranked = !checkpoint;
    if (skipIntro || checkpoint) {
      this.phase = 'play';
      this.player.controlEnabled = true;
      this.player.teleport(this.snapshot.spawn, 0);
      this.player.crouched = true;
      this.cam.snapBehind(0);
      this.level.horse.hatch.rotation.z = -1.9;
      this.level.horse.rope.visible = true;
      if (checkpoint) this.jumpToCheckpoint(checkpoint);
      this.refreshObjective();
      return;
    }
    this.phase = 'intro';
    this.introT = 0;
    this.introDescEnd = 100;
    this.rope.started = false;
    this.player.controlEnabled = false;
    const hp = this.level.horse.group.localToWorld(this.level.horse.hatchPoint.clone());
    this.player.teleport(hp.add(new THREE.Vector3(0, -0.2, 0)), 0);
    this.player.char.root.visible = false;
    this.hud.say('Troja, in der Nacht nach dem Siegesfest. Die Trojaner haben das hölzerne Pferd in ihre Stadt gezogen …', 5.5);
  }

  /** debug / testing: jump straight to a later checkpoint (?cp=plaza) */
  private jumpToCheckpoint(id: string) {
    for (const g of this.guards) if (g.id.startsWith('horse')) g.kill();
    for (const g of this.guards) if (g.id.startsWith('horse')) g.state = 'dead';
    this.player.hasBow = true;
    this.player.arrows = 18;
    const cp = this.level.checkpoints.find((c) => c.id === id);
    if (!cp) return;
    this.step = id === 'alley' ? 'alley' : id === 'plaza' ? 'plaza' : id === 'alley-b' ? 'alleyB' : id === 'gate2' ? 'key' : id === 'tower' ? 'tower' : 'toPalace';
    if (this.step === 'toPalace' || this.step === 'key' || this.step === 'tower') this.reached.add('gate-locked');
    if (this.step === 'key' || this.step === 'tower') {
      // chapter III / IV: the key is in hand, the captain is dead
      this.player.hasKey = true;
      this.level.key.visible = false;
      for (const g of this.guards) if (g.id === 'captain') g.kill();
    }
    if (this.step === 'tower') {
      this.fin = { unlocked: true, boltT: 1, boltDone: true, gateKey: true, doorOpen: true, winchT: 1, gateOpen: true, hectorIntro: false };
      this.reached.add('gate2');
      this.applyFinale();
    }
    this.reached.add(id);
    this.player.teleport(cp.spawn, cp.yaw);
    this.cam.snapBehind(cp.yaw);
    this.snapshot = this.makeSnapshot(id, cp.spawn, cp.yaw);
  }

  private updateIntro(dt: number) {
    this.introT += dt;
    const t = this.introT;
    const horse = this.level.horse;
    const end = Math.min(this.introDescEnd, 30) + 1.1; // control handed over shortly after landing
    const hatchWorld = horse.group.localToWorld(horse.hatchPoint.clone());
    // camera: low under the horse, looking up at the belly, then sweeping behind Odysseus
    if (t < end) {
      // slow push-in from the side of the horse, low, looking up at the belly hatch
      const a = Math.min(1, Math.max(0, (t - 1) / 6));
      const camPos = new THREE.Vector3(7.5 - a * 2.5, 1.6 + a * 0.4, -44.5 - a * 1.5);
      this.camera.position.copy(camPos);
      const look = new THREE.Vector3().lerpVectors(hatchWorld, this.player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), Math.min(1, Math.max(0, (t - 4.4) / 1.8)));
      this.camera.lookAt(look);
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
    }
    // the screen fades in from black while the caption runs
    this.post.grade.uniforms.fade.value = Math.max(0, 1 - Math.max(0, t - 1.2) / 2.0);
    // hatch swings open, the rope drops and uncoils
    if (t > 3.2) {
      const k = Math.min(1, (t - 3.2) / 0.6);
      horse.hatch.rotation.z = -1.9 * (1 - Math.pow(1 - k, 3));
      if (!horse.rope.visible && k > 0.3) {
        horse.rope.visible = true;
        horse.rope.scale.y = 0.02;
        this.ropeDropT = 0;
        this.audio.hatch();
      }
      if (horse.rope.visible) {
        // the coil falls under its own weight (accelerating), then the loose end swings out and settles
        this.ropeDropT += dt;
        const fall = Math.min(1, this.ropeDropT / 0.9);
        horse.rope.scale.y = Math.max(0.02, fall * fall * (3 - 2 * fall) * 0.6 + fall * fall * 0.4);
        const after = Math.max(0, this.ropeDropT - 0.9);
        horse.rope.rotation.x = 0.22 * Math.exp(-after * 1.6) * Math.sin(after * 5.5) * (fall >= 1 ? 1 : 0) + 0.08 * (1 - fall);
      }
    }
    // Odysseus lets himself down the rope hand over hand, drops the last bit and lands crouched
    const ropeTop = horse.group.localToWorld(horse.rope.position.clone());
    const p = this.player, c = p.char;
    if (t > 4.2 && t < end) {
      c.root.visible = true;
      // hangs on the -X side of the rope, facing it
      const side = new THREE.Vector3(-0.24, 0, 0.04);
      const feetLow = horse.platformTop + 0.6;
      const r = this.rope;
      if (!r.started) {
        r.started = true;
        // he comes out of the hatch legs first: the body is still inside the belly, the hands hold the
        // rope at its very top, and he slides down until his arms have their reach, then goes hand under hand
        r.y = ropeTop.y - 0.9;
        r.grip = [ropeTop.y - 0.06, ropeTop.y - 0.32];
        r.move = -1;
      }
      const ropeAt = (y: number, out: THREE.Vector3) => out.set(ropeTop.x, y, ropeTop.z);
      if (this.introDescEnd > 99) {
        // slow, controlled descent: the body lowers while the hands hold; the higher hand then lets go
        // and grips again below the other one (hand under hand)
        const shoulder = r.y + 1.45;
        if (r.move < 0) {
          const hi = r.grip[0] > r.grip[1] ? 0 : 1;
          const lo = 1 - hi;
          // lower only while both arms still have reach; otherwise move the upper hand down
          if (r.grip[hi] - shoulder > 0.52 || r.grip[lo] - shoulder > 0.38) {
            r.move = hi;
            r.moveT = 0;
            r.from = r.grip[hi];
            r.to = r.grip[lo] - 0.3;
            this.audio.ropeGrip();
          } else {
            r.y = Math.max(feetLow, r.y - dt * 0.62);
          }
        } else {
          r.moveT += dt / 0.32;
          const k = Math.min(1, r.moveT);
          r.grip[r.move] = r.from + (r.to - r.from) * (k * k * (3 - 2 * k));
          r.y = Math.max(feetLow, r.y - dt * 0.15); // keeps sliding a little
          if (k >= 1) r.move = -1;
        }
        // the rope swings slightly under the moving weight
        const sway = Math.sin(t * 2.3) * 0.012;
        horse.rope.rotation.z = sway;
        p.pos.set(ropeTop.x + side.x, r.y, ropeTop.z + side.z);
        c.ropeHang = Math.min(1, c.ropeHang + dt * 5);
        c.air = 0;
        c.setSword(false); // both hands on the rope, the sword stays on the hip
        c.crouch = 0;
        // grip points (the moving hand comes off the rope a little on its way down)
        const g = c.ropeGrip ?? (c.ropeGrip = { hands: [new THREE.Vector3(), new THREE.Vector3()], feet: [new THREE.Vector3(), new THREE.Vector3()] });
        for (const hIdx of [0, 1]) {
          const h = ropeAt(r.grip[hIdx], g.hands[hIdx]);
          h.x += hIdx === 0 ? 0.0 : 0.0;
          if (r.move === hIdx) {
            const off = Math.sin(Math.min(1, r.moveT) * Math.PI) * 0.12;
            h.x += side.x * off * 2;
            h.z += (hIdx === 0 ? 1 : -1) * off;
          }
        }
        // feet: the rope runs between the insteps, knees drawn up a little
        ropeAt(r.y + 0.32, g.feet[0]).add(new THREE.Vector3(-0.05, 0, 0.06));
        ropeAt(r.y + 0.2, g.feet[1]).add(new THREE.Vector3(-0.05, 0, -0.06));
        if (r.y <= feetLow + 1e-3 && r.move < 0) this.introDescEnd = t;
      } else {
        // lets go: short drop, knees give way on the sledge
        const ft = t - this.introDescEnd;
        const y = Math.max(horse.platformTop, feetLow - 0.5 * 18 * ft * ft);
        p.pos.set(ropeTop.x + side.x, y, ropeTop.z + side.z);
        c.ropeHang = Math.max(0, c.ropeHang - dt * 10);
        if (c.ropeHang <= 0) c.ropeGrip = null;
        const landed = y <= horse.platformTop + 0.01;
        c.air += ((landed ? 0 : 1) - c.air) * Math.min(1, dt * 14);
        c.crouch += ((landed ? 0.85 : 0.2) - c.crouch) * Math.min(1, dt * 12);
        horse.rope.rotation.z *= Math.max(0, 1 - dt * 2);
        if (landed && !this.reached.has('landed')) {
          this.reached.add('landed');
          this.audio.land();
          this.cam.shake = 0.5;
        }
      }
      p.yaw = Math.atan2(-side.x, -side.z);
      c.play('idle');
      c.update(dt);
      p.sync();
    }
    if (t > 5.0 && !this.reached.has('line1')) {
      this.reached.add('line1');
      this.hud.say('Odysseus: Leise jetzt. Die beiden Wachen dort vorn dürfen keinen Laut mehr von sich geben.', 5);
    }
    if (t >= end) {
      this.phase = 'play';
      c.ropeGrip = null;
      this.player.controlEnabled = true;
      this.player.crouched = true;
      c.ropeHang = 0;
      c.air = 0;
      this.player.teleport(new THREE.Vector3(this.player.pos.x, horse.platformTop, this.player.pos.z), 0);
      this.cam.snapBehind(0);
      this.post.grade.uniforms.fade.value = 0;
      this.hud.show(true);
      this.snapshot = this.makeSnapshot('start', this.player.pos, 0);
      this.refreshObjective();
    }
  }

  /** where the next goal of the current step is (for the compass) */
  private compassGoal(): { p: THREE.Vector3; label: string } | null {
    const lv = this.level, pp = this.player.pos;
    const guard = (id: string) => this.guards.find((g) => g.id === id && g.alive);
    const inTower = pp.x > 90 && pp.x < 102 && pp.z > -58 && pp.z < -44.4;
    switch (this.step) {
      case 'guards': {
        const g = ['horse-l', 'horse-r'].map(guard).filter((x): x is Guard => !!x).sort((a, b) => a.pos.distanceTo(pp) - b.pos.distanceTo(pp))[0];
        return g ? { p: g.pos, label: 'Wache' } : null;
      }
      case 'bow':
        return this.droppedBow ? { p: this.droppedBow.getWorldPosition(_c), label: 'Bogen' } : null;
      case 'alley':
        return { p: _c.set(2, 0, -6), label: 'Festplatz' };
      case 'plaza':
        return { p: _c.set(14, 0, 30), label: 'Gasse' };
      case 'alleyB': {
        const g = guard('alley-b');
        return g ? { p: g.pos, label: 'Wache' } : { p: _c.set(14, 0, 46), label: 'Gasse' };
      }
      case 'ambush': {
        const g = guard('corner');
        return g ? { p: g.pos, label: 'Angreifer' } : null;
      }
      case 'toGate':
      case 'key':
        return { p: lv.gatePoint, label: 'Tor' };
      case 'toPalace': {
        const inForecourt = pp.x > 70 && pp.x < 100 && pp.z > -16 && pp.z < 8;
        return pp.z < -16 && pp.x > 74 && pp.x < 100 ? { p: _c.set(86, 0, -40), label: 'Kammer' } : { p: lv.palacePoint, label: inForecourt ? 'Palasttür' : 'Palast' };
      }
      case 'bolt':
        return { p: _c.set(GATE_X, 0, 66.5), label: 'Riegel' };
      case 'gatekey': {
        const g = guard('gate-captain');
        if (g) return { p: g.pos, label: 'Torhauptmann' };
        return this.gateKeyMesh ? { p: this.gateKeyMesh.position, label: 'Schlüssel' } : { p: lv.gatehouse.doorPoint, label: 'Torhaus' };
      }
      case 'winch':
        return this.fin.doorOpen ? { p: lv.gatehouse.winchPoint, label: 'Winde' } : { p: lv.gatehouse.doorPoint, label: 'Torhaus' };
      case 'storm':
      case 'tower': {
        if (pp.y > 12.5) return { p: lv.balconyPoint, label: BOSS }; // the hall and the balcony
        if (!inTower) {
          const inPalace = pp.x > 74 && pp.x < 100 && pp.z < -16;
          return inPalace ? { p: lv.towerDoorPoint, label: 'Turmtür' } : { p: lv.palacePoint, label: 'Palast' };
        }
        // inside the tower: to the foot of the next flight, then round the landing
        if (pp.x > 99.35 && pp.z < -49.5) return { p: _c.set(100.45, 0, -56.2), label: 'Treppe' };
        if (pp.x > 97.2 && pp.z < -49.5) return { p: _c.set(98.25, 0, -48.6), label: 'Treppe' };
        return { p: _c.set(100.45, 0, -48.6), label: 'Treppe' };
      }
      case 'hector': {
        const g = guard('hector');
        return g ? { p: g.pos, label: BOSS } : null;
      }
      case 'helena':
        return this.helena ? { p: this.helena.root.position, label: 'Helena' } : null;
      default:
        return null;
    }
  }

  private refreshObjective() {
    const o: Record<Step, string> = {
      guards: 'Schalte die zwei Wachen vor dem Pferd lautlos aus – schleiche dich von hinten an (E)',
      bow: 'Nimm den Bogen der toten Wache an dich (E)',
      alley: 'Schleiche durch die Gasse nach Süden zum Festplatz',
      plaza: 'Überquere den Festplatz, ohne die Schlafenden zu wecken',
      alleyB: 'Erledige die Wache in der Gasse',
      ambush: 'Besiege den Angreifer',
      toGate: 'Folge der Gasse zum Torplatz',
      toPalace: 'Das Tor ist verriegelt. Hol den Schlüssel aus dem Palast – der Hauptmann schläft in seiner Kammer neben ihm',
      key: 'Du hast den Schlüssel. Zurück zum Tor',
      bolt: 'Schieb den Riegel aus dem Tor (E gedrückt halten) – und wehr ab, wer dich dabei stört',
      gatekey: 'Das Tor hängt an Ketten. Der Torhauptmann hat den Schlüssel zum Torhaus',
      winch: 'Ins Torhaus neben dem Ostturm – dreh die Winde, bis das Tor offen steht',
      storm: 'Das Heer ist in der Stadt. Zurück zum Palast (Kompass) – durch Halle und Gang zur Kammer des Hauptmanns, dahinter die Tür zum Turm',
      tower: `Steig den Turm hinauf. Auf jeder Etage warten Wachen – ${BOSS} ganz oben`,
      hector: `Besiege ${BOSS}`,
      helena: `${BOSS} ist gefallen. Geh zu Helena`,
      done: '',
    };
    this.hud.setObjective(o[this.step]);
  }

  // ---------------- per frame ----------------

  update(dt: number) {
    const input = this.input;
    if (this.phase === 'title' || this.paused) return;
    _dt = dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.28;
    }
    if (this.phase !== 'end') this.runTime += _dt;
    if (this.phase === 'intro') {
      this.updateIntro(dt);
      this.updateWorld(dt);
      return;
    }

    for (const c of this.extras) c.update(dt);
    if (this.phase === 'play' || this.phase === 'dead') {
      // nobody can hurt him while a cinematic plays, nor in the second after it
      if (this.cine) this.player.invuln = Math.max(this.player.invuln, 1.5);
      this.player.update(dt, input, this.cam);
      this.updateTakedown(dt);
      this.cam.aim += ((this.player.aiming ? 1 : 0) - this.cam.aim) * Math.min(1, dt * 10);
      if (this.cine) this.updateCinematic(dt);
      else this.cam.update(dt, this.player.pos, this.player.char.crouch, input.mouseDX, input.mouseDY, input.sensitivity);
    }

    if (this.phase === 'play' && !this.cine && !this.tk) {
      this.handleWeapons(dt);
      this.handleInteractions();
      this.handleTriggers();
    }
    if (this.phase === 'play') this.updateFinale(dt);

    this.updateGuards(dt);
    this.updateWorld(dt);

    // death
    if (this.phase === 'play' && !this.player.alive) {
      this.phase = 'dead';
      this.deadT = 0;
      this.player.controlEnabled = false;
      this.hud.say('Odysseus ist gefallen. Zurück zum letzten Checkpoint …', 3);
      this.player.char.lie = 0;
      this.player.char.playClip(Math.random() < 0.5 ? 'death' : 'death2', 1.8, true);
    }
    if (this.phase === 'dead') {
      this.deadT += dt;
      if (!this.player.char.clipDriven) this.player.char.lie = Math.min(1, this.deadT * 2);
      this.post.grade.uniforms.fade.value = Math.min(1, Math.max(0, (this.deadT - 1.2) / 1.2));
      if (this.deadT > 2.8) {
        this.restoreSnapshot();
        this.player.char.stopClip();
        this.player.char.lie = 0;
        this.phase = 'play';
        this.player.controlEnabled = true;
        this.post.grade.uniforms.fade.value = 0;
      }
    }

    // hud
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    this.post.grade.uniforms.damage.value = Math.max(this.damageFlash, this.player.alive ? (1 - this.player.hp / 100) * 0.35 : 0.6);
    this.post.grade.uniforms.aimZoom.value = this.cam.aim;
    this.hud.update(dt, {
      hp: this.player.hp, stamina: this.player.stamina, blocking: this.player.blocking, arrows: this.player.arrows, hasBow: this.player.hasBow, weapon: this.player.weapon,
      aiming: this.player.aiming, detection: this.danger.detection, alert: this.danger.alert, noise: this.player.noise, draw: this.player.drawTime, spread: this.player.aimSpread,
    });
    this.hud.setTimer(this.runTime, this.bestTime, this.ranked);
  }

  private updateWorld(dt: number) {
    for (const f of this.level.fires) f.update(dt, this.camera);
    const focus = this.phase === 'intro' ? this.camera.position : this.player.pos;
    this.lightPool.update(this.level.fires, focus);
    // moon shadow box follows the player
    this.moon.target.position.set(this.player.pos.x, 0, this.player.pos.z + 6);
    this.moon.position.set(this.player.pos.x - 30, 60, this.player.pos.z - 40);
    this.arrows.update(dt, this.guards, this.level.fires, (h) => this.onArrowHit(h), () => {
      this.audio.torchOut();
      this.hud.toast('Fackel gelöscht', 1.2);
    });
    // the compass under the objective: always points at the next goal, with the distance
    const goal = this.phase === 'play' && !this.cine ? this.compassGoal() : null;
    if (goal) {
      const pp = this.player.pos;
      const rel = Math.atan2(goal.p.x - pp.x, goal.p.z - pp.z) - this.cam.yaw;
      this.hud.setCompass(-rel, goal.label, Math.hypot(goal.p.x - pp.x, goal.p.z - pp.z));
    } else this.hud.setCompass(null);
    // audio bed
    let fireNear = 0;
    for (const f of this.level.fires) fireNear = Math.max(fireNear, f.illuminationAt(this.player.pos) * 0.03);
    this.audio.update(dt, fireNear, this.danger.alert ? 1 : this.danger.detection, this.phase === 'play' && this.player.onGround ? this.player.speed / 3 : 0, this.player.sprinting, this.player.crouched);
    // music: a quiet ancient tune while sneaking; it stops the moment a fight is on – except in the
    // finale, where the lyre plays on, lower and driven, through everything
    const finale = this.fin.gateOpen || this.cine !== null;
    this.audio.storm = finale ? 1 : 0;
    this.audio.setMusic(this.phase === 'play' && (!this.danger.alert || finale) ? 1 : 0);
    // the burning city tints the night: fog and sky light go ember-orange as the fire spreads
    const burn = this.storm.burning;
    if (this.scene.fog) this.scene.fog.color.copy(this.fogBase).lerp(_col.setHex(0x3a160a), burn * 0.7);
    if (this.hemi) {
      this.hemi.color.copy(this.hemiBase).lerp(_col.setHex(0xa0502a), burn * 0.6);
      this.hemi.intensity = this.hemiBaseIntensity * (1 + burn * 0.5);
    }
    if (this.droppedBow) this.droppedBow.rotation.y += dt * 0.6;
  }

  /** 0..1 how visible Odysseus is: light falling on him, crouching, moving */
  private playerVisibility() {
    const p = _v.copy(this.player.pos);
    p.y += 1.0;
    let light = 0.12; // moonlight
    for (const f of this.level.fires) light += f.illuminationAt(p);
    let vis = 1 - Math.exp(-light * 0.9);
    if (this.player.crouched) vis *= this.player.speed < 0.3 ? 0.6 : 0.8; // crouching helps a little, keeping still more; cover is what hides him
    if (this.player.speed > 0.5) vis = Math.min(1, vis + (this.player.sprinting ? 0.25 : 0.08));
    return Math.max(0.06, Math.min(1, vis));
  }

  private updateGuards(dt: number) {
    const vis = this.playerVisibility();
    const p = this.player;
    // noise: continuous (footsteps) vs one-shot events are both in player.noise; footstep noise is dt-scaled
    if (p.noise > 0 && this.phase === 'play') {
      const continuous = p.onGround && p.speed > 0.3 && p.attackTimer <= 0;
      for (const g of this.guards) g.hearNoise(p.pos, p.noise, continuous ? dt : 1);
    }
    // engagement slots: the two nearest alerted guards press the attack, the rest hold back
    const alerted = this.guards.filter((g) => g.alive && g.alerted).sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos));
    alerted.forEach((g, i) => (g.engaged = i < 2));
    let detection = 0;
    let alert = false;
    // standing guards are solid: he can't walk through one, he slides around him
    for (const g of this.guards) {
      if (!g.alive || g.asleep) continue;
      const dx = p.pos.x - g.pos.x, dz = p.pos.z - g.pos.z;
      const d = Math.hypot(dx, dz), min = 0.35 + g.radius;
      if (d >= min || d < 1e-4 || Math.abs(p.pos.y - g.pos.y) > 1.2) continue;
      p.pos.x += (dx / d) * (min - d);
      p.pos.z += (dz / d) * (min - d);
    }
    Guard.engaged = this.guards.filter((o) => o.alive && o.alerted && o.pos.distanceTo(p.pos) < 12).length;
    for (const g of this.guards) {
      g.update(dt, { pos: p.pos, alive: p.alive && this.phase === 'play' && !this.cine, crouched: p.crouched, speed: p.speed }, vis, this.guards);
      if (g.alive && !g.asleep) detection = Math.max(detection, g.awareness);
      if (g.alerted) alert = true;
      if (g.shouted) {
        g.shouted = false;
        this.raiseAlarm(g);
      }
      if (g.strikeLanded && this.phase === 'play' && !this.cine) this.guardStrike(g);
      // the first time a soldier winds up to strike nearby, explain the shield
      if (g.opened) {
        g.opened = false;
        if (this.openHints < 3 && this.phase === 'play' && g.pos.distanceTo(p.pos) < 4) {
          this.openHints++;
          this.hud.toast('Er senkt den Schild – jetzt zuschlagen!', 1.0);
        }
      }
      if (g.windingUp && g.alive && this.blockHints < 2 && this.phase === 'play' && g.pos.distanceTo(p.pos) < 4.5) {
        this.blockHints++;
        this.hud.say('Schild: <b>rechte Maustaste</b> gedrückt halten und den Gegner anschauen – so prallt sein Hieb ab. Danach sofort zuschlagen.', 5);
      }
      if (g.state === 'dead' && g.hasBow && !g.bowDropped) this.dropBow(g);
      if (g.state === 'dead' && g.quiver && !g.arrowsDropped) this.dropArrows(g);
    }
    this.danger.detection = detection;
    this.danger.alert = alert;
    // in a fight the two shields may touch but never pass through each other: a foe facing him keeps a
    // minimum distance (after his lunge too); the guard gives way, Odysseus is only nudged a little
    for (const g of this.guards) {
      if (!g.alive || g.asleep || !g.alerted || Math.abs(p.pos.y - g.pos.y) > 1.2) continue;
      const dx = g.pos.x - p.pos.x, dz = g.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz), min = g.boss ? 1.35 : 1.2;
      if (d >= min || d < 1e-4) continue;
      const push = min - d;
      g.pos.x += (dx / d) * push * 0.8;
      g.pos.z += (dz / d) * push * 0.8;
      this.level.world.resolveHorizontal(g.pos, g.radius, 1.8, 0.52);
      p.pos.x -= (dx / d) * push * 0.2;
      p.pos.z -= (dz / d) * push * 0.2;
      g.sync();
    }
    // …and measured on the real shields in their current pose: shield against shield, and each
    // shield against the other fighter's body (a vertical capsule); any overlap pushes the foe back
    const rP = p.char.shieldSphere(_shP);
    for (const g of this.guards) {
      if (!g.alive || !g.alerted || g.seized || Math.abs(p.pos.y - g.pos.y) > 1.2) continue;
      const dx = g.pos.x - p.pos.x, dz = g.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      const rG = g.char.shieldSphere(_shG);
      let over = 0;
      if (rP > 0 && rG > 0) {
        // discs: a sphere a little smaller than the rim, they may touch
        const sep = _shP.distanceTo(_shG), need = (rP + rG) * 0.82;
        if (sep < need) {
          // how far the foe must step back along the line between them to clear it
          const along = (_shG.x - _shP.x) * nx + (_shG.z - _shP.z) * nz;
          const lat2 = Math.max(0, sep * sep - along * along);
          over = Math.max(over, Math.sqrt(Math.max(0, need * need - lat2)) - along);
        }
      }
      // his shield into Odysseus' body, Odysseus' shield into his
      const body = 0.26;
      if (rG > 0) {
        const h = Math.hypot(_shG.x - p.pos.x, _shG.z - p.pos.z);
        if (h < rG * 0.7 + body) over = Math.max(over, rG * 0.7 + body - h);
      }
      if (rP > 0) {
        const h = Math.hypot(_shP.x - g.pos.x, _shP.z - g.pos.z);
        if (h < rP * 0.7 + body) over = Math.max(over, rP * 0.7 + body - h);
      }
      if (over <= 0.002) continue;
      over = Math.min(over, 0.5);
      g.pos.x += nx * over * 0.85;
      g.pos.z += nz * over * 0.85;
      this.level.world.resolveHorizontal(g.pos, g.radius, 1.8, 0.52);
      p.pos.x -= nx * over * 0.15;
      p.pos.z -= nz * over * 0.15;
      g.sync();
      this.shieldPushes++;
    }

    // escalation: while the alarm is up, more soldiers come out of the side streets
    this.alarmCooldown = Math.max(0, this.alarmCooldown - dt);
    if (alert && this.phase === 'play') {
      this.reinforceTimer -= dt;
      const scripted = this.step === 'bolt' || this.step === 'gatekey' || this.step === 'winch' || this.fin.gateOpen;
      if (this.reinforceTimer <= 0 && this.reinforcements < 2 && !scripted) {
        this.reinforceTimer = 25;
        this.spawnReinforcement();
      }
    } else this.reinforceTimer = Math.min(this.reinforceTimer, 6);
  }

  private raiseAlarm(from: Guard) {
    if (this.alarmCooldown <= 0) {
      this.audio.shout();
      this.hud.toast('Alarm! Die Wachen sind geweckt', 3);
      this.detections++;
    }
    this.alarmCooldown = 3;
    for (const g of this.guards) {
      if (g === from || !g.alive) continue;
      // once the gate has fallen it is every man for himself: only the men right beside him join in
      if (g.pos.distanceTo(from.pos) < (this.fin.gateOpen ? 4 : 16)) g.alarm(this.player.pos);
    }
  }

  private spawnReinforcement() {
    const p = this.player.pos;
    const candidates = REINFORCEMENT_POINTS
      .filter((q) => q.distanceTo(p) > 12 && q.distanceTo(p) < 45)
      .filter((q) => !this.level.world.visible(_a.set(q.x, 1.6, q.z), _b.set(p.x, p.y + 1.4, p.z)) || q.distanceTo(p) > 25)
      .sort((a, b) => a.distanceTo(p) - b.distanceTo(p));
    const at = candidates[0];
    if (!at) return;
    const g = new Guard({ id: `reinf-${this.reinforcements}`, pos: at.clone(), facing: 0, mode: 'stand' }, this.level.world);
    g.alarm(p);
    g.shouted = false;
    this.scene.add(g.char.root);
    this.guards.push(g);
    this.reinforcements++;
  }

  /** how often the shield hint has been shown (twice at most) */
  private blockHints = 0;
  private shieldHints = 0;
  private openHints = 0;

  private guardStrike(g: Guard) {
    const p = this.player;
    const toGuard = _a.subVectors(g.pos, p.pos).setY(0).normalize();
    const facing = _b.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (g.heavy) {
      // the boss's heavy blow goes through the shield; only a dodge (F) saves him
      if (p.damage(30)) {
        this.audio.hurt();
        this.damageFlash = 1;
        this.cam.shake = 0.9;
        this.hud.toast('Der schwere Hieb bricht durch den Schild – ausweichen (F)!', 2.5);
      }
      return;
    }
    const dmg = g.boss ? 22 : 15;
    if (p.blocking && facing.dot(toGuard) > 0.3) {
      this.audio.blocked();
      // the boss's blows land hard even on the shield: the screen jolts and time catches for a beat
      this.cam.shake = g.boss ? 0.8 : 0.25;
      if (g.boss) this.hitstop = Math.max(this.hitstop, 0.09);
      // the shield stops about three blows in four; the fourth slips past the rim for half damage
      if (p.absorbBlow() && Math.random() < 0.75) return;
      this.hud.toast(p.stamina <= 0.001 ? 'Der Schildarm gibt nach – kurz ausweichen' : 'Der Hieb rutscht am Schild vorbei', 1.6);
      if (p.damage(8)) {
        this.audio.hurt();
        this.damageFlash = 0.5;
        this.cam.shake = 0.4;
      }
      return;
    }
    if (p.blocking) this.hud.toast('Der Hieb kam von der Seite – dem Gegner zuwenden', 2);
    if (p.damage(dmg)) {
      this.audio.hurt();
      this.damageFlash = 0.8;
      this.cam.shake = 0.6;
    }
  }

  // ---------------- player actions ----------------

  private pendingSwing = -1;

  private handleWeapons(dt: number) {
    const p = this.player, input = this.input;
    if (this.pendingSwing >= 0) {
      this.pendingSwing -= dt;
      if (this.pendingSwing < 0) this.resolveSwing();
    }
    // bow
    if (p.weapon === 'bow' && p.hasBow) {
      if (p.aiming && input.lmbPressed && p.arrows > 0) this.audio.bowDraw();
      if (p.aiming && input.lmbReleased) {
        if (p.arrows > 0) {
          // the arrow leaves Odysseus' hand and flies to whatever is under the crosshair
          const fwd = this.cam.forward(_a);
          const camPos = this.camera.position;
          const wall = this.level.world.raycast(camPos, fwd, 140);
          const foe = raycastGuards(camPos, fwd, Math.min(wall, 140), this.guards);
          const reach = Math.min(wall, foe ?? Infinity, 140);
          const target = _c.copy(camPos).addScaledVector(fwd, reach);
          const origin = _b.set(p.pos.x + Math.sin(p.yaw) * 0.35, p.pos.y + 1.45 - p.char.crouch * 0.4, p.pos.z + Math.cos(p.yaw) * 0.35);
          // don't shoot from inside a wall when standing against one
          if (reach < 1.6) origin.copy(camPos).addScaledVector(fwd, 0.5);
          const power = Math.max(0.3, p.drawTime);
          const dir = aimArrow(origin, target, arrowSpeed(power), p.aimSpread, _d);
          this.arrows.fire(origin, dir, power);
          p.arrows--;
          p.noise = Math.max(p.noise, 2);
          this.audio.bowRelease();
          p.char.bowRecoil = 1;
          this.cam.shake = 0.12;
          if (p.arrows === 0) this.hud.toast('Keine Pfeile mehr – nimm das Schwert (1)');
        }
        p.relaxBow();
      }
      return;
    }
    // sword: a click during the last moments of a swing or its pause is kept and swung when it may
    if (input.lmbPressed) this.swingQueued = 0.35;
    else this.swingQueued = Math.max(0, this.swingQueued - dt);
    if (this.swingQueued > 0 && p.attackCooldown <= 0) {
      this.swingQueued = 0;
      // a silent takedown takes priority over a noisy swing
      const target = this.takedownTarget();
      if (target) return this.takedown(target);
      // soft lock: swing toward a nearby foe in front of the camera, stepping in if he is a bit away
      const foe = this.swingTarget();
      const yaw = foe ? Math.atan2(foe.pos.x - p.pos.x, foe.pos.z - p.pos.z) : this.cam.yaw;
      const dist = foe ? foe.pos.distanceTo(p.pos) : 0;
      const lunge = foe ? THREE.MathUtils.clamp((dist - 1.3) * 5, 0, 4.5) : 1.5;
      if (p.startAttack(yaw, lunge)) {
        this.audio.swordSwing();
        this.pendingSwing = p.strikeMoment;
      }
    }
  }

  /** the living guard closest to the crosshair within sword reach */
  private swingTarget(): Guard | null {
    const p = this.player;
    const fwd = _a.set(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    let best: Guard | null = null, bestScore = -Infinity;
    for (const g of this.guards) {
      if (!g.alive) continue;
      const to = _b.subVectors(g.pos, p.pos).setY(0);
      const d = to.length();
      if (d > 3.2 || Math.abs(g.pos.y - p.pos.y) > 1) continue;
      const cos = to.normalize().dot(fwd);
      if (cos < 0.3) continue;
      const score = cos * 2 - d * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  private resolveSwing() {
    const p = this.player;
    const fwd = _a.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    for (const g of this.guards) {
      if (!g.alive) continue;
      const to = _b.subVectors(g.pos, p.pos).setY(0);
      const d = to.length();
      if (d > 2.3 || to.normalize().dot(fwd) < 0.3) continue;
      if (g.unaware && g.isBehind(p.pos)) {
        this.takedown(g);
        return;
      }
      const killed = g.hit(40, p.pos);
      if (g.shieldHit) {
        g.shieldHit = false;
        this.audio.blocked();
        this.cam.shake = g.boss ? 0.55 : 0.3;
        if (this.shieldHints < 3) {
          this.shieldHints++;
          this.hud.toast('Sein Schild! Warte, bis er ihn senkt – dann zuerst zuschlagen', 2.2);
        }
        return;
      }
      if (g.parried) {
        g.parried = false;
        this.audio.blocked();
        this.cam.shake = 0.2;
        this.hud.toast(`${BOSS} pariert – triff ihn, gleich nachdem er zugeschlagen hat`, 2);
        return;
      }
      this.audio.swordHit();
      this.cam.shake = 0.35;
      this.hud.hitMarker();
      if (killed) for (const o of this.guards) if (o !== g) o.witness(g.pos);
      return;
    }
  }

  private takedownTarget(): Guard | null {
    const p = this.player;
    for (const g of this.guards) {
      if (!g.alive || !g.unaware) continue;
      const d = _a.subVectors(g.pos, p.pos).setY(0).length();
      if (d > (g.asleep ? 1.9 : 1.8)) continue;
      if (Math.abs(g.pos.y - p.pos.y) > 0.8) continue;
      if (g.asleep || g.isBehind(p.pos)) return g;
    }
    return null;
  }

  /**
   * Silent takedown: Odysseus steps in behind the man (or beside the sleeper's chest), raises the
   * sword two-handed and drives it down ("Great Sword Casting" clip). The victim is held still until
   * the stroke; he dies at that moment.
   */
  private takedown(g: Guard) {
    if (this.tk) return;
    const p = this.player;
    // without the clip: the old instant kill
    if (!p.char.hasClip('takedown')) return this.finishTakedown(g);
    g.seized = true;
    const fwd = _a.set(Math.sin(g.yaw), 0, Math.cos(g.yaw));
    const aim = new THREE.Vector3();
    const to = new THREE.Vector3();
    if (g.asleep) {
      // he lies on his side: the chest is ~0.85 m from his feet; Odysseus kneels in front of or behind it
      const side = -g.char.lieSide * 0.85;
      aim.set(g.pos.x + side * Math.cos(g.yaw), p.pos.y, g.pos.z - side * Math.sin(g.yaw));
      const a1 = aim.clone().addScaledVector(fwd, 0.9), a2 = aim.clone().addScaledVector(fwd, -0.9);
      to.copy(a1.distanceToSquared(p.pos) < a2.distanceToSquared(p.pos) ? a1 : a2);
    } else {
      aim.set(g.pos.x, p.pos.y, g.pos.z);
      to.copy(aim).addScaledVector(fwd, -0.95);
    }
    to.y = p.pos.y;
    this.level.world.resolveHorizontal(to, p.radius, 1.8, 0.52);
    // a sleeper gets the great downward thrust; a man on his feet a quick cut from behind
    const lying = g.asleep;
    const dur = lying ? TK_DUR : TK_STAND_DUR, strike = lying ? TK_STRIKE : TK_STAND_STRIKE;
    this.tk = { g, t: 0, from: p.pos.clone(), to, yaw: Math.atan2(aim.x - to.x, aim.z - to.z), struck: false, dur, strike };
    p.controlEnabled = false;
    p.forceSword = true;
    p.attackTimer = 0;
    p.crouched = false;
    p.char.playClip(lying ? 'takedown' : 'slash', lying ? TK_DUR : TK_STAND_CLIP);
    this.hud.setPrompt(null);
    this.audio.swordSwing();
  }

  private updateTakedown(dt: number) {
    const tk = this.tk;
    if (!tk) return;
    const p = this.player;
    tk.t += dt;
    const k = Math.min(1, tk.t / 0.35);
    const e = k * k * (3 - 2 * k);
    p.pos.x = tk.from.x + (tk.to.x - tk.from.x) * e;
    p.pos.z = tk.from.z + (tk.to.z - tk.from.z) * e;
    p.vel.set(0, p.vel.y, 0);
    p.yaw = lerpYaw(p.yaw, tk.yaw, Math.min(1, dt * 14));
    if (!tk.struck && tk.t >= tk.strike) {
      tk.struck = true;
      this.finishTakedown(tk.g);
    }
    if (tk.t >= tk.dur || !p.alive) this.endTakedown();
  }

  private endTakedown() {
    if (!this.tk) return;
    if (!this.tk.struck && this.tk.g.alive) this.tk.g.seized = false;
    this.tk = null;
    this.player.forceSword = false;
    if (this.player.alive && !this.cine) this.player.controlEnabled = true;
  }

  private finishTakedown(g: Guard) {
    const p = this.player;
    if (!this.tk) p.yaw = Math.atan2(g.pos.x - p.pos.x, g.pos.z - p.pos.z);
    g.kill(p.pos);
    for (const o of this.guards) if (o !== g) o.witness(g.pos);
    this.audio.takedown();
    setTimeout(() => this.audio.bodyFall(), 450);
    this.cam.shake = 0.35;
    // a takedown is quiet but not silent
    for (const o of this.guards) o.hearNoise(g.pos, 3.0, 1);
  }

  private dropArrows(g: Guard) {
    g.arrowsDropped = true;
    // the bow guard's own quiver comes with the bow
    if (g.hasBow && !this.player.hasBow) return;
    const n = 2 + Math.floor(Math.random() * 2);
    const mesh = arrowBundleMesh(n);
    mesh.position.set(g.pos.x + 0.5, 0.0, g.pos.z - 0.4);
    mesh.rotation.y = g.yaw + 0.8;
    this.scene.add(mesh);
    this.droppedArrows.push({ mesh, n });
  }

  private dropBow(g: Guard) {
    g.bowDropped = true;
    if (this.player.hasBow || this.droppedBow) return;
    const b = bowMesh();
    b.position.set(g.pos.x + 0.6, 0.12, g.pos.z + 0.3);
    b.rotation.set(0, 0, Math.PI / 2);
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.9 }));
    quiver.rotation.z = Math.PI / 2;
    quiver.position.set(0.3, -0.05, 0.25);
    b.add(quiver);
    // soft glint so it can be found in the dark
    const glint = new THREE.PointLight(0xffc080, 1.2, 3, 2);
    glint.position.y = 0.5;
    b.add(glint);
    this.scene.add(b);
    this.droppedBow = b;
  }

  private nearbyArrows() {
    const p = this.player;
    for (const d of this.droppedArrows) if (d.mesh.position.distanceTo(_a.set(p.pos.x, 0, p.pos.z)) < 1.5) return d;
    return null;
  }

  private handleInteractions() {
    const p = this.player, input = this.input;
    let prompt: string | null = null;
    const target = this.takedownTarget();
    if (target) {
      prompt = `<b>E</b> ${target.asleep ? 'Lautlos töten (schläft)' : 'Lautlos von hinten töten'}`;
      if (input.hit('KeyE')) this.takedown(target);
    } else if (this.droppedBow && this.droppedBow.position.distanceTo(_a.set(p.pos.x, 0.12, p.pos.z)) < 1.6) {
      prompt = '<b>E</b> Bogen und Köcher aufheben';
      if (input.hit('KeyE')) {
        this.droppedBow.removeFromParent();
        this.droppedBow = null;
        p.hasBow = true;
        p.arrows = 18;
        p.switchWeapon('bow', true);
        this.audio.pickup();
        this.hud.say('Ein Bogen und achtzehn Pfeile. Taste 2 für den Bogen, rechte Maustaste zielen, linke spannen und loslassen.', 6);
        if (this.step === 'bow') {
          this.step = 'alley';
          this.refreshObjective();
        }
      }
    } else if ((prompt = this.finalePrompt()) !== null) {
      /* handled in finalePrompt (the finale's keys and levers win over stray arrows) */
    } else if (p.hasBow && this.nearbyArrows()) {
      const d = this.nearbyArrows()!;
      prompt = `<b>E</b> ${d.n} Pfeile aufheben`;
      if (input.hit('KeyE')) {
        d.mesh.removeFromParent();
        this.droppedArrows.splice(this.droppedArrows.indexOf(d), 1);
        p.arrows = Math.min(24, p.arrows + d.n);
        this.audio.pickup();
        this.hud.toast(`${d.n} Pfeile (${p.arrows})`);
      }
    } else if (this.level.key.visible && this.level.key.position.distanceTo(_a.set(p.pos.x, this.level.key.position.y, p.pos.z)) < 1.9) {
      prompt = '<b>E</b> Den Torschlüssel nehmen';
      if (input.hit('KeyE')) {
        this.level.key.visible = false;
        p.hasKey = true;
        this.audio.pickup();
        this.step = 'key';
        this.hud.say('Odysseus: Der Schlüssel des Tores. Jetzt zurück – leise, der Hauptmann schläft noch.', 5);
        this.refreshObjective();
        this.snapshot = this.makeSnapshot('key', p.pos, p.yaw);
        this.hud.toast('Checkpoint gespeichert');
      }
    } else if (p.weapon === 'bow' && !p.aiming && p.hasBow) prompt = '<b>Rechte Maustaste</b> zielen';
    else if (p.weapon === 'sword' && !p.blocking && this.guards.some((g) => g.alive && g.engaged && g.pos.distanceTo(p.pos) < 6))
      prompt = '<b>Rechte Maustaste</b> Schild heben · <b>Linke Maustaste</b> schlagen';
    this.hud.setPrompt(this.tk ? null : prompt);
  }

  private handleTriggers() {
    const p = this.player.pos;
    if (this.step === 'guards') {
      const remaining = this.guards.filter((g) => g.id.startsWith('horse') && g.alive).length;
      if (remaining === 0) {
        this.step = this.player.hasBow ? 'alley' : 'bow';
        this.hud.say(this.player.hasBow ? 'Der Weg ist frei.' : 'Beide Wachen sind still. Einer von ihnen trug einen Bogen …', 4);
        this.refreshObjective();
      }
    }
    for (const cp of this.level.checkpoints) {
      if (cp.id === 'gate2' || cp.id === 'tower') continue; // the finale's checkpoints are tied to its steps (below)
      if (this.reached.has(cp.id) || !cp.box.containsPoint(p)) continue;
      this.reached.add(cp.id);
      if (cp.id === 'plaza' && (this.step === 'alley' || this.step === 'bow' || this.step === 'guards')) this.step = 'plaza';
      if (cp.id === 'alley-b') this.step = 'alleyB';
      this.snapshot = this.makeSnapshot(cp.id, cp.spawn, cp.yaw);
      this.hud.toast('Checkpoint gespeichert');
      this.refreshObjective();
      if (cp.id === 'plaza') this.hud.say('Der Festplatz. Überall schlafen Trojaner. Bleib geduckt (C), halte Abstand – und hüte dich vor der Wache auf der anderen Seite.', 7);
      if (cp.id === 'alley-b') this.hud.say('Eine Wache steht in der Gasse. Ein Pfeil aus dem Dunkeln – oder ein Kampf.', 5);
      if (cp.id === 'unterstadt') this.hud.say('Die Unterstadt. Wachen gehen mit Fackeln um den Brunnen. Ein Pfeil löscht eine Fackel – im Dunkeln sehen sie dich kaum.', 7);
      if (cp.id === 'forecourt') this.hud.say('Der Palast. Zwei Wachen am Tor, drinnen weitere im Gang. Entweder durch das Tor – oder leise durch das Fenster links neben der Fackel (Leertaste davor). Der Hauptmann schläft in der hintersten Kammer, der Schlüssel liegt auf seinem Tisch.', 10);
    }
    // ambush round the corner in alley B
    const corner = this.guards.find((g) => g.id === 'corner');
    const alleyGuard = this.guards.find((g) => g.id === 'alley-b');
    if (!this.ambushDone && corner && corner.alive && (this.level.ambushTrigger.containsPoint(p) || (alleyGuard && !alleyGuard.alive && this.step === 'alleyB'))) {
      this.ambushDone = true;
      corner.alarm(this.player.pos);
      corner.shouted = false;
      this.audio.shout();
      this.step = 'ambush';
      this.hud.say('Hinter der Ecke! Linksklick schlagen, rechte Maustaste blocken, F ausweichen.', 5);
      this.refreshObjective();
    }
    if (this.step === 'alleyB' && alleyGuard && !alleyGuard.alive && corner && !corner.alive) this.step = 'toGate';
    if (this.step === 'ambush' && corner && !corner.alive) {
      this.step = (alleyGuard && alleyGuard.alive) ? 'alleyB' : 'toGate';
      this.hud.say('Odysseus: Weiter. Das Tor kann nicht mehr weit sein.', 4);
      this.refreshObjective();
    }
    if (this.level.endTrigger.containsPoint(p) && this.phase === 'play' && !this.player.hasKey) {
      if (!this.reached.has('gate-locked')) {
        this.reached.add('gate-locked');
        this.step = 'toPalace';
        this.hud.say('Verriegelt. Ein Schloss so groß wie ein Schild – und der Schlüssel? Beim Hauptmann der Wache, im Palast oberhalb der Unterstadt. Er schläft in seiner Kammer – hinter Tor, Halle und Gang.', 7);
        this.refreshObjective();
        this.snapshot = this.makeSnapshot('gate', p, this.player.yaw);
      }
    }
    for (const cp of this.level.checkpoints) {
      // the finale's checkpoints are tied to its steps rather than to the first crossing of a box
      if (cp.id === 'gate2' && this.step === 'key' && !this.reached.has('gate2') && cp.box.containsPoint(p)) {
        this.reached.add('gate2');
        this.snapshot = this.makeSnapshot('gate2', cp.spawn, cp.yaw);
        this.hud.toast('Checkpoint gespeichert');
        this.hud.say('Odysseus: Da ist das Schloss. Erst der Schlüssel – dann der Riegel. Das wird nicht leise.', 5);
      }
      if (cp.id === 'tower' && this.step === 'storm' && cp.box.containsPoint(p)) {
        this.step = 'tower';
        this.refreshObjective();
        this.snapshot = this.makeSnapshot('tower', cp.spawn, cp.yaw);
        this.hud.toast('Checkpoint gespeichert');
        this.hud.say(`Odysseus: Der Turm. Drei Etagen voller Wachen – und oben wartet ${BOSS}, Priamos' Sohn. Bei ihm ist Helena.`, 5);
      }
    }
    if ((this.step === 'tower' || this.step === 'storm') && !this.fin.hectorIntro && this.level.hectorTrigger.containsPoint(p)) this.startHector();
  }

  // ---------------- the finale ----------------

  /** the E prompts of the finale (lock, bolt, gatehouse key and door, winch, Helena); null when none applies */
  private finalePrompt(): string | null {
    const p = this.player, input = this.input, lv = this.level, f = this.fin;
    const near = (x: number, z: number, r: number) => Math.hypot(p.pos.x - x, p.pos.z - z) < r;
    if (this.step === 'key' && p.hasKey && near(lv.padlock.position.x, lv.padlock.position.z, 2.4)) {
      if (input.hit('KeyE')) this.unlockGate();
      return '<b>E</b> Das Schloss aufschließen';
    }
    const atBolt = Math.abs(p.pos.z - 66.6) < 2.4 && p.pos.x > lv.bolt.position.x - 6 && p.pos.x < lv.bolt.position.x + 2;
    if ((this.step === 'bolt' || this.step === 'gatekey') && !f.boltDone && atBolt) {
      if (input.down('KeyE') && p.onGround && !p.aiming) {
        f.boltT = Math.min(1, f.boltT + dt_(this) / 10);
        lv.bolt.position.x = boltX(f.boltT);
        // hands on the west end of the beam, he shoves it east along the gate; at 100 % the beam's west end
        // has just cleared the west leaf and he stands in the passage, never in the tower
        const k = Math.min(1, dt_(this) * 6);
        p.pos.x += (lv.bolt.position.x - 3.0 - 0.55 - p.pos.x) * k;
        p.pos.z += (67.7 - p.pos.z) * k;
        p.yaw += (Math.PI / 2 - p.yaw) * 0.2;
        p.pushing = true;
        this.grindT -= dt_(this);
        if (this.grindT <= 0) {
          this.grindT = 0.45;
          this.audio.grind();
          p.noise = Math.max(p.noise, 6);
        }
        if (f.boltT >= 1) this.boltOut();
      }
      return `<b>E</b> halten: den Riegel schieben (${Math.round(f.boltT * 100)} %)`;
    }
    if (this.gateKeyMesh && near(this.gateKeyMesh.position.x, this.gateKeyMesh.position.z, 1.8)) {
      if (input.hit('KeyE')) {
        this.gateKeyMesh.removeFromParent();
        this.gateKeyMesh = null;
        f.gateKey = true;
        this.audio.pickup();
        this.hud.say('Odysseus: Der Schlüssel zum Torhaus. Die Winde wartet.', 4);
        if (f.boltDone) this.step = 'winch';
        this.refreshObjective();
      }
      return '<b>E</b> Den Torhaus-Schlüssel nehmen';
    }
    if ((this.step === 'gatekey' || this.step === 'winch' || this.step === 'bolt') && !f.doorOpen && near(lv.gatehouse.doorPoint.x, lv.gatehouse.doorPoint.z, 2.0)) {
      if (!f.gateKey) return 'Verschlossen – der Torhauptmann trägt den Schlüssel';
      if (input.hit('KeyE')) {
        f.doorOpen = true;
        this.audio.creak();
        const i = lv.world.boxes.indexOf(lv.gatehouse.doorBox);
        if (i >= 0) lv.world.boxes.splice(i, 1);
      }
      return '<b>E</b> Das Torhaus aufschließen';
    }
    if (this.step === 'winch' && f.doorOpen && f.boltDone && !f.gateOpen && near(lv.gatehouse.winchPoint.x, lv.gatehouse.winchPoint.z, 2.0)) {
      if (input.down('KeyE') && p.onGround) {
        if (this.bellT < 0) {
          // the first turn of the drum rattles the chains over the whole square: the alarm bell rings
          this.bellT = 0;
          this.hud.say('Die Ketten rasseln über den ganzen Platz. Irgendwo schlägt eine Glocke.', 4);
        }
        f.winchT = Math.min(1, f.winchT + dt_(this) / 13);
        // the capstan: he leans into one of its four bars and walks it round, the drum turning with him
        const c = lv.gatehouse.winchPoint;
        const drumA = f.winchT * WINCH_TURN;
        if (this.capBar < 0) {
          // take the bar nearest to where he stands
          const pa = Math.atan2(-(p.pos.z - c.z), p.pos.x - c.x);
          let best = 0, bd = 9;
          for (let k = 0; k < 4; k++) {
            const d = Math.abs(Math.atan2(Math.sin(pa - drumA - k * Math.PI / 2), Math.cos(pa - drumA - k * Math.PI / 2)));
            if (d < bd) { bd = d; best = k; }
          }
          this.capBar = best;
        }
        const drum = lv.gatehouse.winch.getObjectByName('drum');
        if (drum) drum.rotation.y = drumA;
        const a = drumA + this.capBar * Math.PI / 2;
        // along the bar to the worn grip, half a step behind it (the bar moves on in +a)
        const ca = Math.cos(a), sa = Math.sin(a);
        const tx = c.x + CAP_GRIP * ca + CAP_BEHIND * sa, tz = c.z - CAP_GRIP * sa + CAP_BEHIND * ca;
        const k = Math.min(1, dt_(this) * 8);
        p.pos.x += (tx - p.pos.x) * k;
        p.pos.z += (tz - p.pos.z) * k;
        const yawT = a + Math.PI;
        p.yaw += Math.atan2(Math.sin(yawT - p.yaw), Math.cos(yawT - p.yaw)) * Math.min(1, dt_(this) * 10);
        p.pushing = true;
        this.grindT -= dt_(this);
        if (this.grindT <= 0) {
          this.grindT = 0.7;
          this.audio.creak();
          p.noise = Math.max(p.noise, 8);
        }
        if (f.winchT > 0.2 && this.waves < 1) this.spawnWave(1);
        if (f.winchT > 0.6 && this.waves < 2) this.spawnWave(2);
        if (f.winchT >= 1) this.openGate();
      }
      return `<b>E</b> halten: die Winde drehen (${Math.round(f.winchT * 100)} %)`;
    }
    if (this.step === 'helena' && this.helena && near(this.helena.root.position.x, this.helena.root.position.z, 2.4)) {
      if (input.hit('KeyE')) this.startEnd();
      return '<b>E</b> Zu Helena';
    }
    return null;
  }

  private unlockGate() {
    const f = this.fin;
    f.unlocked = true;
    this.level.padlock.visible = false;
    this.audio.unlock();
    this.step = 'bolt';
    this.refreshObjective();
    this.hud.say('Odysseus: Offen. Und jetzt der Riegel – ein ganzer Baum. Das dauert, und es wird laut.', 5);
    this.captainTimer = 2.5;
  }

  private boltOut() {
    const f = this.fin;
    f.boltDone = true;
    this.audio.bodyFall();
    this.cam.shake = 0.4;
    this.hud.say('Der Riegel ist draußen – doch das Tor rührt sich nicht. Es hängt an Ketten. Die Winde muss im Torhaus neben dem Ostturm stehen.', 7);
    this.step = f.gateKey ? 'winch' : 'gatekey';
    this.refreshObjective();
    this.snapshot = this.makeSnapshot('bolt', this.player.pos, this.player.yaw);
    this.hud.toast('Checkpoint gespeichert');
  }

  /** the gatehouse key lies beside the fallen gate captain */
  private dropGateKey(pos: THREE.Vector3, yaw: number) {
    const k = this.level.key.clone();
    k.visible = true;
    k.position.set(pos.x + 0.5, pos.y + 0.08, pos.z + 0.3);
    k.rotation.set(Math.PI / 2, 0, yaw);
    this.scene.add(k);
    this.gateKeyMesh = k;
  }

  /** the gate captain and a guard come out of the gatehouse the moment the beam starts to move */
  private spawnGateCaptain() {
    const p = this.player.pos;
    const specs: GuardSpawn[] = [
      { id: 'gate-captain', pos: new THREE.Vector3(32.5, 0, 60.2), facing: Math.PI, mode: 'stand', kind: 'captain' },
      { id: 'gate-guard', pos: new THREE.Vector3(34.5, 0, 59), facing: Math.PI, mode: 'stand', quiver: true },
    ];
    for (const sp of specs) {
      const g = new Guard(sp, this.level.world);
      g.alarm(p);
      g.shouted = false;
      this.scene.add(g.char.root);
      this.guards.push(g);
    }
    this.audio.shout();
    this.hud.say('Hinter dir! Der Torhauptmann und seine Wache – aus dem Torhaus.', 4);
    this.hud.toast('Alarm!', 2);
  }

  private spawnWave(n: number) {
    this.waves = n;
    const p = this.player.pos;
    const at = n === 1 ? [[14, 57], [30, 56]] : [[22, 50], [38, 60]];
    at.forEach(([x, z], i) => {
      const g = new Guard({ id: `wave-${n}-${i}`, pos: new THREE.Vector3(x, 0, z), facing: 0, mode: 'stand', quiver: i === 0 }, this.level.world);
      g.alarm(p);
      g.shouted = false;
      this.scene.add(g.char.root);
      this.guards.push(g);
    });
    this.audio.shout();
    this.hud.toast(n === 1 ? 'Wachen kommen auf den Platz!' : 'Noch mehr Wachen!', 2.5);
  }

  private openGate() {
    const f = this.fin;
    f.gateOpen = true;
    f.winchT = 1;
    const i = this.level.world.boxes.indexOf(this.level.gateBox);
    if (i >= 0) this.level.world.boxes.splice(i, 1);
    this.cine = { kind: 'gate', t: 0, dur: 11.5 };
    this.player.controlEnabled = false;
    this.hud.show(false);
    this.hud.setPrompt(null);
    this.audio.creak();
  }

  private startHector() {
    const f = this.fin;
    f.hectorIntro = true;
    const h = this.guards.find((g) => g.id === 'hector');
    if (!h || !h.alive) return;
    this.cine = { kind: 'hector', t: 0, dur: 6.5 };
    this.player.controlEnabled = false;
    this.hud.show(false);
    this.hud.setPrompt(null);
    this.step = 'hector';
  }

  private startEnd() {
    this.cine = { kind: 'end', t: 0, dur: 16 };
    this.player.controlEnabled = false;
    this.hud.show(false);
    this.hud.setPrompt(null);
    this.player.switchWeapon('sword', true);
    this.player.char.setSword(false);
  }

  private updateCinematic(dt: number) {
    const c = this.cine!, cam = this.camera, lv = this.level, p = this.player;
    c.t += dt;
    const k = Math.min(1, c.t / c.dur);
    if (c.kind === 'gate') {
      // from the square, low, looking at the gate: the leaves swing out, the horn sounds, the Greeks run in
      this.gateT = THREE.MathUtils.clamp((c.t - 0.8) / 4.5, 0, 1);
      this.setGateLeaves(this.gateT);
      const drift = Math.min(1, c.t / c.dur);
      // from the west side of the square (the alley south of it is walled in), slowly closing in
      cam.position.set(GATE_X - 8 + drift * 2.5, 2.3 + drift * 1.2, 56.5 + drift * 2);
      cam.lookAt(GATE_X, 4.5, 70);
      if (c.t > 1.0 && !this.reached.has('horn')) {
        this.reached.add('horn');
        this.audio.horn();
      }
      if (c.t > 4.6 && !this.reached.has('roar')) {
        // the leaves stand open: now the host comes up from the plain
        this.reached.add('roar');
        this.audio.roar();
        this.storm.start();
      }
      if (c.t > 6.0 && !this.reached.has('gateline')) {
        this.reached.add('gateline');
        this.hud.say('Das Heer der Achaier! Zehn Jahre vor diesen Mauern – und jetzt strömen sie hindurch.', 5);
      }
      if (c.t > 6.5) {
        this.grindT -= dt;
        if (this.grindT <= 0) {
          this.grindT = 0.9;
          this.audio.shout();
        }
      }
      if (k >= 1) {
        this.cine = null;
        p.controlEnabled = true;
        this.hud.show(true);
        this.step = 'storm';
        this.refreshObjective();
        this.hud.say(`Odysseus: Fort von hier, bevor die Griechen mich für einen Trojaner halten. Zum Palast – zu ${BOSS}. Bei ihm ist Helena.`, 6);
        const cp = lv.checkpoints.find((x) => x.id === 'gate2')!;
        this.snapshot = this.makeSnapshot('storm', cp.spawn, Math.PI);
        this.hud.toast('Checkpoint gespeichert');
      }
    } else if (c.kind === 'hector') {
      const h = this.guards.find((g) => g.id === 'hector');
      // from the doorway: Hector on the balcony, his back to us, the burning city beyond – he turns
      const spot = lv.balconyPoint;
      cam.position.set(spot.x + 7.0 - k * 3.2, spot.y + 1.7 - k * 0.2, spot.z + 0.3 - k * 0.5);
      cam.lookAt(spot.x - 0.8, spot.y + 1.35, spot.z);
      if (h && c.t > 1.2 && !this.reached.has('hectorturn')) {
        this.reached.add('hectorturn');
        h.char.playClip('turn', 1.1);
      }
      if (h && c.t > 1.2 && c.t < 2.4) {
        const q = Math.min(1, (c.t - 1.2) / 1.1);
        h.yaw = -Math.PI / 2 + Math.PI * (q * q * (3 - 2 * q));
        h.sync();
      }
      if (c.t > 2.6 && !this.reached.has('hectorline')) {
        this.reached.add('hectorline');
        this.hud.say(`${BOSS}: Odysseus, der Listenreiche. Mit deinem Pferd hast du Troja verbrannt. Meine Brüder Hektor und Paris sind tot – Helena bekommst du nicht. Komm und hol sie dir.`, 6);
      }
      // he draws his sword as he speaks: the Mixamo unsheathe, the blade changes hands halfway through
      if (h && c.t > 3.7 && !this.reached.has('hectordraw')) {
        this.reached.add('hectordraw');
        h.char.playUpper('unsheathe', 1.2);
      }
      if (h && c.t > 4.3 && !this.reached.has('hectorsword')) {
        this.reached.add('hectorsword');
        h.char.setSword(true);
      }
      if (k >= 1) {
        this.cine = null;
        p.controlEnabled = true;
        this.hud.show(true);
        if (h) {
          h.roused = true;
          h.alarm(p.pos);
          h.shouted = false;
          h.char.setSword(true);
        }
        this.refreshObjective();
        this.audio.shout();
        this.snapshot = this.makeSnapshot('hector', new THREE.Vector3(95.5, 13.5, -48.2), -Math.PI / 2);
      }
    } else {
      // the end: Helena comes to him; the camera leaves the balcony and rises out over the burning city
      const h = this.helena;
      if (h && c.t > 0.6 && !this.reached.has('helenawalk')) {
        this.reached.add('helenawalk');
        h.playClip('walkstart', 1.9);
      }
      if (h && c.t > 0.6 && c.t < 2.5) {
        const q = Math.min(1, (c.t - 0.6) / 1.9);
        const to = _a.subVectors(p.pos, h.root.position).setY(0);
        const d = to.length();
        h.root.rotation.y = Math.atan2(to.x, to.z);
        if (d > 1.1) h.root.position.addScaledVector(to.normalize(), Math.min(d - 1.1, dt * 0.6 * (1 - q * 0.5)));
      }
      // historically she does not walk free: Menelaos takes her back to Sparta, and she goes because nothing is left
      if (c.t > 2.6 && !this.reached.has('odyline')) {
        this.reached.add('odyline');
        this.hud.say('Odysseus: Helena. Menelaos wartet unten am Strand. Du kehrst nach Sparta zurück.', 3.6);
      }
      if (c.t > 6.4 && !this.reached.has('helenaline')) {
        this.reached.add('helenaline');
        this.hud.say(`Helena: Paris ist tot, ${BOSS} ist tot, Troja brennt. Ich gehe mit dir – nicht, weil ich will. Weil mir nichts anderes bleibt.`, 5.2);
      }
      if (c.t > 11.8 && !this.reached.has('endline')) {
        this.reached.add('endline');
        this.hud.say('Odysseus: Troja ist gefallen. Jetzt beginnt der Weg nach Hause.', 4);
      }
      const b = lv.balconyPoint;
      const e = Math.min(1, Math.max(0, (c.t - 3.5) / (c.dur - 3.5)));
      const ee = e * e * (3 - 2 * e);
      cam.position.set(b.x + 2.5 - ee * 34, b.y + 1.6 + ee * 22, b.z + 1.5 + ee * 40);
      const lx = THREE.MathUtils.lerp(b.x - 1, GATE_X + 8, ee), ly = THREE.MathUtils.lerp(b.y + 1.3, 6, ee), lz = THREE.MathUtils.lerp(b.z, 60, ee);
      cam.lookAt(lx, ly, lz);
      this.post.grade.uniforms.fade.value = Math.max(0, (c.t - (c.dur - 2.5)) / 2.5);
      if (k >= 1) {
        this.cine = null;
        this.phase = 'end';
        this.step = 'done';
        this.hud.setPrompt(null);
        this.onEnd?.({ seconds: this.runTime, alarms: this.detections, ranked: this.ranked });
      }
    }
    cam.fov = 48;
    cam.updateProjectionMatrix();
  }

  /** timers of the finale that run outside the prompts: the captain, the bell, the door, the storm, the runners */
  private updateFinale(dt: number) {
    const f = this.fin, lv = this.level, p = this.player;
    if (this.captainTimer >= 0) {
      this.captainTimer -= dt;
      if (this.captainTimer < 0) this.spawnGateCaptain();
    }
    // the gatehouse key falls from the captain's belt
    const gc = this.guards.find((g) => g.id === 'gate-captain');
    if (gc && gc.state === 'dead' && !f.gateKey && !this.gateKeyMesh) {
      this.dropGateKey(gc.pos, gc.yaw);
      this.hud.say('Der Torhauptmann ist gefallen. Da – ein Schlüssel an seinem Gürtel.', 4);
    }
    if (this.gateKeyMesh) this.gateKeyMesh.rotation.z += dt * 0.8;
    // the gatehouse door swings open
    if (f.doorOpen && this.doorT < 1) {
      this.doorT = Math.min(1, this.doorT + dt / 1.2);
      lv.gatehouse.door.rotation.y = -1.9 * this.doorT * this.doorT * (3 - 2 * this.doorT);
    }
    // the alarm bell: rung for a while once the winch starts, the bell itself swinging
    if (this.bellT >= 0 && this.bellT < 14) {
      this.bellT += dt;
      this.bellRing -= dt;
      if (this.bellRing <= 0) {
        this.bellRing = 1.15;
        this.audio.bell();
      }
      const bell = lv.gatehouse.bell.getObjectByName('bell');
      if (bell) bell.rotation.z = Math.sin(this.bellT * 5.5) * 0.35 * Math.max(0, 1 - this.bellT / 14);
    }
    // the storm and the panic in the streets
    if (f.gateOpen) {
      this.storm.update(dt, p.pos);
      // the gate has fallen: every Trojan in the streets who is not already after Odysseus runs to the gate
      // (palace and tower keep their men); at the gate they join the battle
      if (!this.cityRushed) {
        this.cityRushed = true;
        for (const g of this.guards) {
          if (!g.alive || g.boss || g.id.startsWith('tower') || g.id === 'captain' || (g.pos.x > 72 && g.pos.z < -15)) continue;
          // a man already fighting him right here stays on him
          if (g.alerted && g.pos.distanceTo(p.pos) < 8) continue;
          const route = this.routeToGate(g.pos);
          if (route) g.rushTo(route);
        }
      }
      for (const g of this.guards) {
        if (!g.gone) continue;
        g.char.root.removeFromParent();
        if (g.torch) {
          g.torch.group.removeFromParent();
          const i = this.level.fires.indexOf(g.torch);
          if (i >= 0) this.level.fires.splice(i, 1);
        }
        if (g.alive) this.storm.joinTrojan(g.pos, g.yaw);
      }
      this.guards = this.guards.filter((g) => !g.gone);
      this.runners = this.guards.filter((g) => g.spawn.rush && g.alive).length;
      this.runnerT -= dt;
      if (this.runnerT <= 0 && this.runners < 4 && (this.step === 'storm' || this.step === 'tower') && this.guards.length < 40) {
        this.runnerT = 7 + Math.random() * 5;
        this.spawnRunners();
      }
      if (this.storm.burning > 0.1 && !this.reached.has('burnline') && p.pos.z < 30) {
        this.reached.add('burnline');
        this.hud.say('Hinter dir steigt Rauch auf. Die Stadt brennt.', 4);
      }
    }
    // Hector's heavy strike: explain it the first time he winds up
    const h = this.guards.find((g) => g.id === 'hector');
    if (h && h.heavy && !this.heavyHint) {
      this.heavyHint = true;
      this.hud.say(`${BOSS} holt weit aus – dieser Hieb geht durch den Schild. Ausweichen (F)!`, 3.5);
    }
    if (h && !h.alive && this.step === 'hector') {
      this.step = 'helena';
      this.refreshObjective();
      this.hud.say(`Odysseus: Es ist vorbei, ${BOSS}. – Helena.`, 5);
      this.snapshot = this.makeSnapshot('helena', new THREE.Vector3(92.5, 13.5, -50.5), -Math.PI / 2);
    }
  }

  /**
   * A street route from `from` to the square inside the gate: the nearest reachable waypoint of one of
   * the known runs, then the rest of it (the coarse nav grid does not join the quarters through the
   * narrow alleys, these runs do). Null when he cannot get there (the horse square, the palace).
   */
  private routeToGate(from: THREE.Vector3): THREE.Vector3[] | null {
    const nav = this.level.nav;
    let best: THREE.Vector3[] | null = null, bestCost = Infinity;
    for (const r of RUSH_ROUTES) {
      let rest = 0;
      for (let k = r.length - 1; k >= 0; k--) {
        const w = _a.set(r[k][0], 0, r[k][1]);
        if (k < r.length - 1) rest += Math.hypot(r[k + 1][0] - r[k][0], r[k + 1][1] - r[k][1]);
        const d = Math.hypot(w.x - from.x, w.z - from.z);
        if (d + rest >= bestCost) continue;
        if (!nav.clear(from, w) && !nav.findPath(from, w).length) continue;
        bestCost = d + rest;
        best = r.slice(k).map(([x, z]) => new THREE.Vector3(x + (Math.random() - 0.5) * 1.2, 0, z + (Math.random() - 0.5) * 1.2));
      }
    }
    return best;
  }

  /** a knot of Trojans runs down a street toward the gate; they only fight if they run straight into him */
  private spawnRunners() {
    const p = this.player.pos;
    const routes = PANIC_ROUTES.map((r) => r.map(([x, z]) => new THREE.Vector3(x, 0, z)))
      .filter((r) => r[0].distanceTo(p) > 16 && r.some((w) => w.distanceTo(p) < 36));
    const route = routes[Math.floor(Math.random() * routes.length)];
    if (!route) return;
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const start = route[0].clone().add(_a.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      const g = new Guard({ id: `run-${this.runners + i}-${Math.floor(Math.random() * 1e6)}`, pos: start, facing: 0, mode: 'patrol', rush: true, patrol: route, torch: Math.random() < 0.4 }, this.level.world);
      this.scene.add(g.char.root);
      if (g.torch) {
        this.scene.add(g.torch.group);
        this.level.fires.push(g.torch);
      }
      this.guards.push(g);
    }
  }

  onEnd?: (stats: { seconds: number; alarms: number; ranked: boolean }) => void;

  private onArrowHit(h: ArrowHit) {
    if (!h.guard) {
      this.audio.arrowHitWall();
      for (const g of this.guards) g.hearNoise(h.point, 4.5, 1);
      return;
    }
    const g = h.guard;
    this.audio.arrowHitFlesh();
    this.hud.hitMarker();
    if (h.headshot || g.unaware) {
      g.kill(_a.copy(h.point).addScaledVector(h.dir, -3));
      setTimeout(() => this.audio.bodyFall(), 400);
      for (const o of this.guards) if (o !== g) o.witness(g.pos);
      this.hud.toast(h.headshot ? 'Kopftreffer' : 'Lautlos ausgeschaltet', 1.5);
      if (h.headshot) {
        // a beat of slow motion and a heavier marker make the head shot register
        this.hitstop = 0.3;
        this.hud.hitMarker(true);
      }
    } else {
      g.hit(70, this.player.pos);
    }
  }
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _col = new THREE.Color();
/** the takedown clip, played over 3 s; the blade comes down at 1.38 s */
const TK_DUR = 3.0, TK_STRIKE = 1.38;
/** standing victim: the plain cut (slash clip over 0.9 s, the blade lands at 0.54 s), free again at 1.0 s */
const TK_STAND_CLIP = 0.9, TK_STAND_STRIKE = 0.54, TK_STAND_DUR = 1.0;
function lerpYaw(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const _shP = new THREE.Vector3(), _shG = new THREE.Vector3();
/** the frame's dt inside the prompt handler (set each update) */
let _dt = 1 / 60;
const dt_ = (_g: Game) => _dt;

/**
 * Launch direction so that an arrow of `speed` hits `target` despite its drop (the low arc), with a random
 * deviation inside a cone of `spread` radians. Falls back to a straight shot when the target is out of range.
 */
function aimArrow(origin: THREE.Vector3, target: THREE.Vector3, speed: number, spread: number, out: THREE.Vector3) {
  const dx = target.x - origin.x, dz = target.z - origin.z, dy = target.y - origin.y;
  const D = Math.hypot(dx, dz);
  const v2 = speed * speed, g = ARROW_GRAVITY;
  const disc = v2 * v2 - g * (g * D * D + 2 * dy * v2);
  if (D > 0.5 && disc > 0) {
    const theta = Math.atan((v2 - Math.sqrt(disc)) / (g * D));
    out.set((dx / D) * Math.cos(theta), Math.sin(theta), (dz / D) * Math.cos(theta));
  } else out.subVectors(target, origin).normalize();
  // scatter: rotate around a random axis perpendicular to the direction
  const ang = Math.sqrt(Math.random()) * spread;
  if (ang > 1e-4) {
    const axis = new THREE.Vector3(0, 1, 0).cross(out);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize().applyAxisAngle(out, Math.random() * Math.PI * 2);
    out.applyAxisAngle(axis, ang);
  }
  return out;
}
