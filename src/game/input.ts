/**
 * Keyboard + mouse input. Uses pointer lock when available (click into the game),
 * and falls back to "hold right/left mouse and drag to look" if pointer lock is blocked
 * (e.g. inside an embedded preview).
 */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // keys that went down this frame
  mouseDX = 0;
  mouseDY = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  lmbReleased = false;
  rmbPressed = false;
  locked = false;
  private dragging = false;
  sensitivity = 0.0022;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        this.requestLock();
        this.dragging = true;
      }
      if (e.button === 0) {
        this.lmb = true;
        this.lmbPressed = true;
      }
      if (e.button === 2) {
        this.rmb = true;
        this.rmbPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.lmb = false;
        this.lmbReleased = true;
      }
      if (e.button === 2) this.rmb = false;
      if (!this.lmb && !this.rmb) this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
    });
  }

  requestLock() {
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* pointer lock not allowed here – drag-to-look fallback */
    }
  }

  down(code: string) {
    return this.keys.has(code);
  }
  hit(code: string) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.lmbPressed = this.lmbReleased = this.rmbPressed = false;
  }
}
