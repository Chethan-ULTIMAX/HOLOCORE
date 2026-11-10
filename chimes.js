/**
 * HOLOCORE — chimes.js
 * -----------------------------------------------------------------------------
 * Synthesised UI audio, via the Web Audio API.
 *
 * Ported from the `main` branch's `VoiceController`, which bundled a small
 * oscillator synth into the speech-recognition class. It is worth keeping: a
 * short tone on grab, release, spawn and command makes the gesture loop feel
 * physically responsive in a way that visual feedback alone does not.
 *
 * Pulled out of the voice layer because the sounds are not about voice — they
 * fire on hand gestures, object spawns and errors too. `main` had to reach into
 * its voice controller to play a grab click, which coupled two unrelated
 * systems.
 *
 * Everything here degrades silently: browsers block audio until a user
 * gesture, and a failed chime must never interrupt interaction.
 */

/** How loud each cue is relative to the others. */
const MASTER_GAIN = 0.9;

export const CHIME_TYPES = ["command", "listen", "spawn", "grab", "release", "error"];

export class Chimes {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this._ctx = null;
    this._failed = false;
  }

  get isSupported() {
    if (typeof window === "undefined") return false;
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /** Lazily create/resume the context; returns null when audio is unavailable. */
  _context() {
    if (this._failed || typeof window === "undefined") return null;
    if (!this._ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this._ctx = new AudioCtx();
      } catch {
        this._failed = true;
        return null;
      }
    }
    // Browsers start suspended until a gesture; resuming is not an error.
    if (this._ctx.state === "suspended") {
      this._ctx.resume?.().catch(() => {});
    }
    return this._ctx;
  }

  /**
   * Play one cue.
   *
   * @param {"command"|"listen"|"spawn"|"grab"|"release"|"error"} type
   */
  play(type = "command") {
    if (!this.enabled) return false;
    const ctx = this._context();
    if (!ctx) return false;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      // Each cue is a short frequency envelope plus a matching gain envelope.
      const shape = SHAPES[type] || SHAPES.command;
      osc.type = shape.wave;
      osc.frequency.setValueAtTime(shape.from, now);
      for (const [offset, freq] of shape.ramp || []) {
        osc.frequency.exponentialRampToValueAtTime(freq, now + offset);
      }
      gain.gain.setValueAtTime(shape.startGain ?? 0.001, now);
      gain.gain.linearRampToValueAtTime(shape.peak * MASTER_GAIN, now + shape.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);

      osc.start(now);
      osc.stop(now + shape.duration + 0.01);
      return true;
    } catch {
      // Autoplay policies, a closed context, or no audio device. Never throw.
      return false;
    }
  }
}

/**
 * The cues themselves.
 *
 * Kept as data rather than a switch so the voice layer, the gesture layer and
 * the playground can all fire them by name. The note choices are the ones the
 * `main` branch tuned by ear: D5→A5 for a confirmed command, a rising triangle
 * for listening, a three-step arpeggio for a spawn, a low square latch for a
 * grab and a small triangle lift for a release.
 */
const SHAPES = {
  command: {
    wave: "sine", from: 587.33, ramp: [[0.08, 880]],
    peak: 0.09, attack: 0.02, duration: 0.22
  },
  listen: {
    wave: "triangle", from: 740, ramp: [[0.06, 1108.73]],
    peak: 0.07, attack: 0.015, duration: 0.18
  },
  spawn: {
    wave: "sine", from: 440, ramp: [[0.06, 659.25], [0.16, 1318.5]],
    peak: 0.12, attack: 0.02, duration: 0.35
  },
  grab: {
    wave: "square", from: 220, ramp: [[0.04, 110]],
    startGain: 0.04, peak: 0.04, attack: 0.004, duration: 0.05
  },
  release: {
    wave: "triangle", from: 320, ramp: [[0.03, 480]],
    startGain: 0.03, peak: 0.03, attack: 0.004, duration: 0.045
  },
  error: {
    wave: "sawtooth", from: 280, ramp: [[0.09, 210]],
    peak: 0.06, attack: 0.02, duration: 0.22
  }
};

/** A single shared instance; audio contexts are expensive and must be reused. */
let shared = null;

export function chimes(options) {
  if (!shared) shared = new Chimes(options);
  else if (options && typeof options.enabled === "boolean") shared.enabled = options.enabled;
  return shared;
}
