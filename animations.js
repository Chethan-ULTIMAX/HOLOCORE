/**
 * HOLOCORE — animations.js
 * -----------------------------------------------------------------------------
 * Small, dependency-free animation helpers used for camera moves, panel
 * transitions and UI feedback. Everything is driven by the main loop's delta
 * time, so it stays smooth and pauses correctly when the tab is hidden.
 */

export const ease = {
  linear: t => t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: t => 1 - Math.pow(1 - t, 5),
  outBack: t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: t => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
};

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential smoothing factor. */
export const dampFactor = (lambda, dt) => 1 - Math.exp(-lambda * dt);

/** Smoothly approach a target. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, dampFactor(lambda, dt));
}

/**
 * Tiny tween manager. Call update(dt) once per frame.
 */
export class Animator {
  constructor() {
    this.items = new Set();
  }

  /**
   * @param {object} options
   * @param {number} options.duration seconds
   * @param {(t:number)=>void} options.onUpdate receives eased 0..1
   * @param {()=>void} [options.onComplete]
   * @param {(t:number)=>number} [options.easing]
   */
  add({ duration = 0.6, onUpdate, onComplete, easing = ease.outCubic, delay = 0 }) {
    const item = {
      t: -delay,
      duration: Math.max(0.0001, duration),
      onUpdate,
      onComplete,
      easing
    };
    this.items.add(item);
    return () => this.items.delete(item);
  }

  update(dt) {
    for (const item of [...this.items]) {
      item.t += dt;
      if (item.t < 0) continue;
      const raw = clamp(item.t / item.duration, 0, 1);
      try {
        item.onUpdate?.(item.easing(raw), raw);
      } catch (error) {
        console.error("[HOLOCORE] tween failed", error);
        this.items.delete(item);
        continue;
      }
      if (raw >= 1) {
        this.items.delete(item);
        item.onComplete?.();
      }
    }
  }

  get size() {
    return this.items.size;
  }
}

/** Briefly add a class to an element (CSS handles the animation). */
export function flash(element, className = "flash", duration = 600) {
  if (!element) return;
  element.classList.remove(className);
  // Force reflow so the animation can restart.
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), duration);
}

/** Animate a numeric value into an element's text content. */
export function countTo(element, from, to, duration = 500, format = v => String(Math.round(v))) {
  if (!element) return;
  const start = performance.now();
  const step = now => {
    const t = clamp((now - start) / duration, 0, 1);
    element.textContent = format(lerp(from, to, ease.outCubic(t)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * A critically damped spring, useful for reticles and follow cursors.
 */
export class Spring {
  constructor(value = 0, { stiffness = 120, damping = 18 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  setTarget(target) {
    this.target = target;
  }

  snap(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  update(dt) {
    const dtClamped = Math.min(dt, 0.05);
    const force = (this.target - this.value) * this.stiffness;
    this.velocity += force * dtClamped;
    this.velocity *= Math.exp(-this.damping * dtClamped);
    this.value += this.velocity * dtClamped;
    return this.value;
  }
}

/** Promise that resolves after N animation frames. */
export function nextFrames(count = 1) {
  return new Promise(resolve => {
    const step = remaining => {
      if (remaining <= 0) resolve();
      else requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}
