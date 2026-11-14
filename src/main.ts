import * as THREE from 'three';
import './style.css';
import { loadTrees, loadMounts } from './world/props';
import { buildLevel } from './world/level';
import { createSky, loadSkyMap } from './world/sky';
import { Post } from './fx/post';
import { Input } from './game/input';
import { Game } from './game/game';
import { fmtTime } from './ui/hud';
import { loadHorseModel } from './world/horse';
import { loadCharacterBase, loadHeroBase, loadGuardBase, loadHelenaBase, loadGear, makeStatue, Character } from './game/characters';
import { loadingManager } from './world/textures';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const quality = params.get('q') === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(quality);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.info.autoReset = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x120805, 0.024);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

const moonDir = new THREE.Vector3(-0.45, 0.55, -0.7);
const sky = createSky(moonDir);
scene.add(sky);
scene.add(new THREE.HemisphereLight(0x6a4434, 0x1a0c06, 0.95));

const loadingBar = document.getElementById('loading-bar')!;
const loadingEl = document.getElementById('loading')!;
const titleEl = document.getElementById('title')!;
const endEl = document.getElementById('end')!;
const pauseEl = document.getElementById('pause')!;

let texProgress = 0, modelProgress = 0, heroProgress = 0;
const setProgress = () => (loadingBar.style.width = `${Math.round((texProgress * 0.5 + modelProgress * 0.15 + heroProgress * 0.35) * 100)}%`);
loadingManager.onProgress = (_u, loaded, total) => {
  texProgress = loaded / total;
  setProgress();
};
const texturesDone = new Promise<void>((res) => (loadingManager.onLoad = () => res()));

async function boot() {
  const level = buildLevel(scene);
  await Promise.all([
    loadCharacterBase(`${import.meta.env.BASE_URL}models/Soldier.glb`, (p) => {
      modelProgress = p;
      setProgress();
    }),
    loadHeroBase(`${import.meta.env.BASE_URL}models/`, (p) => {
      heroProgress = p;
      setProgress();
    }),
    loadGuardBase(`${import.meta.env.BASE_URL}models/`).catch(() => undefined),
    loadGear(`${import.meta.env.BASE_URL}models/`),
    loadHelenaBase(`${import.meta.env.BASE_URL}models/`).catch(() => undefined),
    loadSkyMap(`${import.meta.env.BASE_URL}textures/night_sky_2k.hdr`, sky, scene, renderer).catch(() => undefined),
    loadTrees(level.group, level.trees, `${import.meta.env.BASE_URL}models/`),
    loadMounts(level.mounts, `${import.meta.env.BASE_URL}models/`).catch((e) => console.warn('mounts', e)),
    loadHorseModel(level.horse, `${import.meta.env.BASE_URL}models/horse.glb`).catch(() => undefined),
    texturesDone,
  ]);
  // marble warriors on the forecourt pedestals: the guard model frozen in two different stances
  level.statues.forEach((s, i) => {
    try {
      const st = makeStatue(i % 2 ? 'blockidle' : 'combatidle', 0.4 + i * 0.3, i);
      st.position.set(s.x, s.y, s.z);
      st.rotation.y = s.rot;
      st.scale.setScalar(1.25);
      level.group.add(st);
    } catch {
      /* no guard model: the pedestal stays empty */
    }
  });
  const input = new Input(canvas);
  const post = new Post(renderer, scene, camera);
  const game = new Game(scene, camera, level, input, post);
  (window as unknown as { __game: Game }).__game = game;
  // collider view (?boxes, or the B key in the game): every collision box as a wireframe – green = ledge one
  // can step onto, red = solid – to find "invisible" obstacles
  let boxView: THREE.Group | null = null;
  const toggleBoxes = () => {
    if (!boxView) {
      boxView = new THREE.Group();
      for (const b of level.world.boxes) {
        const col = b.climbable ? 0x44ff66 : 0xff4444;
        if (b.turn) {
          // a turned footprint: draw the real oriented box, not its axis-aligned envelope
          const t = b.turn, h = b.max.y - b.min.y;
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(t.hw * 2, h, t.hd * 2)), new THREE.LineBasicMaterial({ color: col }));
          e.position.set(t.cx, (b.min.y + b.max.y) / 2, t.cz);
          e.rotation.y = Math.atan2(t.s, t.c);
          boxView.add(e);
        } else boxView.add(new THREE.Box3Helper(new THREE.Box3(b.min, b.max), col));
      }
      scene.add(boxView);
    } else boxView.visible = !boxView.visible;
  };
  if (params.has('boxes')) toggleBoxes();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyB' && !e.repeat) toggleBoxes();
  });

  // first frame: compile all shaders before the title screen shows
  camera.position.set(6, 3, -36);
  camera.lookAt(0, 5, -50);
  renderer.compile(scene, camera);
  loadingEl.classList.add('hidden');
  titleEl.classList.remove('hidden');
  post.grade.uniforms.fade.value = 0.35;

  // ?greeks: three Achaean soldiers stand on the plaza (look preview for the finale)
  if (params.has('greeks')) {
    [[0.6, -3.2, 0.3], [2.2, -2.6, 0], [3.8, -3.3, -0.3]].forEach(([x, z, yaw], i) => {
      const c = new Character('greek', i);
      c.root.position.set(x, 0, z);
      c.root.rotation.y = yaw;
      c.play('idle');
      scene.add(c.root);
      game.extras.push(c);
    });
    const h = new Character('helena');
    h.root.position.set(5.6, 0, -2.2);
    h.root.rotation.y = -0.4;
    h.play('idle');
    scene.add(h.root);
    game.extras.push(h);
  }
  const skip = params.has('skip');
  let cp = params.get('cp') ?? undefined;
  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    titleEl.classList.add('hidden');
    input.requestLock();
    game.start(skip, cp);
  };
  // chapter select on the title screen; a click anywhere else starts from the beginning
  titleEl.querySelectorAll<HTMLButtonElement>('.chapters button').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      cp = b.dataset.cp || undefined;
      begin();
    }),
  );
  titleEl.addEventListener('click', () => begin());
  if (params.has('autostart')) begin();

  // best time: kept in this browser only (a run from a chapter doesn't count)
  const BEST_KEY = 'odysseus-bestzeit';
  try {
    const b = parseFloat(localStorage.getItem(BEST_KEY) ?? '');
    if (b > 0) game.bestTime = b;
  } catch {
    /* storage blocked: no best time */
  }
  game.onEnd = (s) => {
    document.exitPointerLock?.();
    let line = `Deine Zeit ${fmtTime(s.seconds)}`;
    if (!s.ranked) line += ' · Kapitelstart, zählt nicht für die Bestzeit';
    else if (game.bestTime === null || s.seconds < game.bestTime) {
      if (game.bestTime !== null) line += ` · Neue Bestzeit! (vorher ${fmtTime(game.bestTime)})`;
      else line += ' · Erste Bestzeit!';
      game.bestTime = s.seconds;
      try {
        localStorage.setItem(BEST_KEY, String(s.seconds));
      } catch {
        /* storage blocked */
      }
    } else line += ` · Bestzeit ${fmtTime(game.bestTime)}`;
    endEl.querySelector('.stats')!.textContent = `${line} · Alarm ausgelöst: ${s.alarms}×`;
    endEl.classList.remove('hidden');
  };

  // pause when the pointer lock is released with Escape
  let wasLocked = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (wasLocked && !locked && game.phase === 'play') {
      game.paused = true;
      pauseEl.classList.remove('hidden');
    }
    wasLocked = locked;
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && game.phase === 'play') {
      game.paused = !game.paused;
      pauseEl.classList.toggle('hidden', !game.paused);
    }
  });
  pauseEl.addEventListener('click', () => {
    game.paused = false;
    pauseEl.classList.add('hidden');
    input.requestLock();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
  });

  const fpsEl = document.getElementById('fps')!;
  if (debug) fpsEl.classList.remove('hidden');
  let frames = 0, acc = 0;
  const clock = new THREE.Clock();
  // title screen: slow orbit around the horse
  let titleT = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    if (game.phase === 'title') {
      titleT += dt;
      const a = titleT * 0.05 + 0.6;
      camera.position.set(Math.sin(a) * 16, 4 + Math.sin(titleT * 0.2) * 0.5, -50 + Math.cos(a) * 16);
      camera.lookAt(0, 5.5, -50);
      for (const f of level.fires) f.update(dt, camera);
      (game as unknown as { lightPool: { update: (f: unknown, p: THREE.Vector3) => void } }).lightPool.update(level.fires, camera.position);
    }
    game.update(dt);
    input.endFrame();
    (sky.material as THREE.ShaderMaterial).uniforms.time.value += dt;
    sky.position.copy(camera.position);
    renderer.info.reset();
    post.render(dt);
    if (debug) {
      frames++;
      acc += dt;
      if (acc > 0.5) {
        fpsEl.textContent = `${Math.round(frames / acc)} fps · ${renderer.info.render.calls} draws · ${Math.round(renderer.info.render.triangles / 1000)}k tris`;
        frames = 0;
        acc = 0;
      }
    }
  });
}

boot().catch((e) => {
  console.error(e);
  loadingEl.querySelector('.hint')!.textContent = 'Fehler beim Laden: ' + e.message;
});
