/** DOM overlay: objective, story captions, prompts, crosshair, health, arrows, detection eye. */
export class HUD {
  private root: HTMLElement;
  private objective: HTMLElement;
  private caption: HTMLElement;
  private prompt: HTMLElement;
  private crosshair: HTMLElement;
  private compass: HTMLElement;
  private timerNow: HTMLElement;
  private timerBest: HTMLElement;
  private hp: HTMLElement;
  private stam: HTMLElement;
  private arrows: HTMLElement;
  private eye: HTMLElement;
  private eyeFill: HTMLElement;
  private noise: HTMLElement;
  private weapon: HTMLElement;
  private captionTimer = 0;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private hitTimer = 0;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="objective"><div class="obj-label">Ziel</div><div class="obj-text"></div>
        <div class="compass"><svg viewBox="0 0 24 24"><path d="M12 2 L19 21 L12 16 L5 21Z" fill="currentColor"/></svg><span class="c-label"></span><span class="c-dist"></span></div></div>
      <div class="timer"><div class="t-now"></div><div class="t-best"></div></div>
      <div class="caption"></div>
      <div class="prompt"></div>
      <div class="toast"></div>
      <div class="crosshair"><span></span></div>
      <div class="eye"><div class="eye-fill"></div><svg viewBox="0 0 48 24"><path d="M2 12 Q24 -6 46 12 Q24 30 2 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="12" r="5" fill="currentColor"/></svg></div>
      <div class="status">
        <div class="hp"><div class="hp-fill"></div></div>
        <div class="stam"><div class="stam-fill"></div></div>
        <div class="row"><span class="weapon"></span><span class="arrows"></span></div>
        <div class="noise"><div class="noise-fill"></div><span>Lärm</span></div>
      </div>`;
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.objective = q('.obj-text');
    this.caption = q('.caption');
    this.prompt = q('.prompt');
    this.crosshair = q('.crosshair');
    this.hp = q('.hp-fill');
    this.stam = q('.stam-fill');
    this.arrows = q('.arrows');
    this.eye = q('.eye');
    this.eyeFill = q('.eye-fill');
    this.noise = q('.noise-fill');
    this.weapon = q('.weapon');
    this.toastEl = q('.toast');
    this.compass = q('.compass');
    this.timerNow = q('.t-now');
    this.timerBest = q('.t-best');
  }

  show(v: boolean) {
    this.root.classList.toggle('cinematic', !v);
    this.root.style.opacity = '1';
  }

  setObjective(t: string) {
    if (this.objective.textContent === t) return;
    this.objective.textContent = t;
    this.objective.parentElement!.classList.remove('flash');
    void this.objective.offsetWidth;
    this.objective.parentElement!.classList.add('flash');
  }

  say(t: string, seconds = 5) {
    this.caption.innerHTML = t;
    this.caption.classList.add('on');
    this.captionTimer = seconds;
  }

  toast(t: string, seconds = 2.5) {
    this.toastEl.textContent = t;
    this.toastEl.classList.add('on');
    this.toastTimer = seconds;
  }

  /** brief flash of the crosshair when a strike or arrow lands */
  hitMarker(head = false) {
    this.crosshair.classList.remove('hit', 'head');
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add('hit');
    if (head) this.crosshair.classList.add('head');
    this.hitTimer = head ? 0.6 : 0.35;
  }

  setPrompt(t: string | null) {
    this.prompt.innerHTML = t ?? '';
    this.prompt.classList.toggle('on', !!t);
  }

  /** the arrow under the objective: direction relative to the view (radians), what it points at, and how far */
  setCompass(rel: number | null, label = '', dist = 0) {
    this.compass.classList.toggle('on', rel !== null);
    if (rel === null) return;
    (this.compass.firstElementChild as HTMLElement).style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    (this.compass.querySelector('.c-label') as HTMLElement).textContent = label;
    (this.compass.querySelector('.c-dist') as HTMLElement).textContent = dist >= 1 ? `${Math.round(dist)} m` : '';
  }

  /** the speedrun clock (top right): this run, the best run so far; chapter runs are marked as not counting */
  setTimer(seconds: number, best: number | null, ranked: boolean) {
    this.timerNow.textContent = fmtTime(seconds, true);
    this.timerBest.textContent = !ranked ? 'Kapitel – zählt nicht' : best !== null ? `Bestzeit ${fmtTime(best)}` : 'Noch keine Bestzeit';
  }

  update(dt: number, s: { hp: number; stamina: number; blocking: boolean; arrows: number; hasBow: boolean; weapon: string; aiming: boolean; detection: number; alert: boolean; noise: number; draw: number; spread: number }) {
    if (this.captionTimer > 0) {
      this.captionTimer -= dt;
      if (this.captionTimer <= 0) this.caption.classList.remove('on');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }
    this.hp.style.width = `${s.hp}%`;
    this.stam.style.width = `${s.stamina * 100}%`;
    this.stam.parentElement!.classList.toggle('low', s.stamina < 0.3);
    this.stam.parentElement!.classList.toggle('active', s.blocking || s.stamina < 0.98);
    this.arrows.textContent = s.hasBow ? `Pfeile ${s.arrows}` : '';
    this.weapon.textContent = s.weapon === 'bow' ? 'Bogen [2]' : 'Schwert [1]';
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.crosshair.classList.remove('hit');
    }
    this.crosshair.classList.toggle('on', s.aiming || this.hitTimer > 0);
    // the four ticks close in as the aim settles (and open up again while walking)
    this.crosshair.style.setProperty('--spread', `${4 + s.spread * 420}px`);
    this.eye.style.opacity = s.detection > 0.02 || s.alert ? '1' : '0.15';
    this.eyeFill.style.transform = `scaleX(${s.alert ? 1 : s.detection})`;
    this.eye.classList.toggle('alert', s.alert);
    this.noise.style.width = `${Math.min(100, (s.noise / 15) * 100)}%`;
  }
}

/** 754.3 s → "12:34" (with tenths "12:34.3") */
export function fmtTime(sec: number, tenths = false) {
  const m = Math.floor(sec / 60), r = sec - m * 60;
  const ss = tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0');
  return `${m}:${ss}`;
}
