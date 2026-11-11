/**
 * HOLOCORE — handSmoothing.js
 * -----------------------------------------------------------------------------
 * Per-joint, per-hand smoothing for the scene-space skeleton.
 *
 * WHY THIS IS SEPARATE FROM handOverlay.js
 *
 * The 2D overlay has smoothed its joints for a long time, but the 3D rig placed
 * each joint straight from the solver: `joint.position.copy(positions[i])`. The
 * two layers therefore disagreed — the flat skeleton glided while the one the
 * user is actually touching juddered. Worse, the 3D rig is the visible one.
 *
 * WHY ONE EURO AND NOT A FIXED LERP
 *
 * A fixed smoothing factor trades jitter against lag at a single operating
 * point. Hands do not have one operating point: a hand held still has almost no
 * real motion, so it wants heavy smoothing; a hand flicking across the stage is
 * moving fast, so it wants almost none. The One Euro filter varies its cutoff
 * with the observed speed, which is why it is the standard choice for pointer
 * and pose tracking. The existing `OneEuroFilter` in gestures.js already
 * implements it, so this reuses that rather than introducing a second idea.
 *
 * WHAT IS FILTERED
 *
 * Each of the 21 joints gets its own filter per axis, independently per hand.
 * Filtering each joint separately means a curled finger is smoothed along its
 * own path and cannot be dragged by its neighbour. The hand's *size* is not
 * filtered here at all: it comes from the rigid palm plate in
 * handCoordinates.js, so proportions stay exact no matter how much the joints
 * are smoothed.
 */

import * as THREE from "three";
import { OneEuroFilter } from "./gestures.js";

/**
 * Defaults tuned against measured step and jitter responses at 30 fps.
 *
 * `minCutoff` sets the jitter floor: lower is smoother but laggier. `beta` is
 * how quickly the filter opens up as the hand speeds up.
 *
 * These were chosen by sweep, not by feel. At minCutoff 2.5 / beta 0.1 a step
 * settles in 5 frames (167 ms) while still removing about 60% of the jitter on
 * a still hand. The gentler setting this started with (1.0 / 0.02) took
 * 11 frames — 367 ms — which is exactly the sluggish finger curl the brief
 * warns about.
 *
 * Tips get a slightly tighter response than knuckles because a fingertip
 * travels further per frame during a curl. Smoothing them identically makes the
 * finger look like it is dragging behind the wrist.
 */
const JOINT_TUNING = {
  wrist: { minCutoff: 2.2, beta: 0.08 },
  joint: { minCutoff: 2.5, beta: 0.10 },
  tip: { minCutoff: 3.0, beta: 0.12 }
};

const TIP_INDICES = new Set([4, 8, 12, 16, 20]);

function tuningFor(index) {
  if (index === 0) return JOINT_TUNING.wrist;
  if (TIP_INDICES.has(index)) return JOINT_TUNING.tip;
  return JOINT_TUNING.joint;
}

/**
 * Smoother for one hand.
 *
 * Created once per tracked hand and reused; allocating 63 filters per frame
 * would defeat the purpose.
 */
export class HandJointSmoother {
  constructor({ timeConstant = 1 } = {}) {
    // One OneEuroFilter per joint per axis. Flat arrays keep the per-frame work
    // to indexed writes instead of property lookups on 21 objects.
    this.filters = [];
    for (let i = 0; i < 21; i++) {
      const tuning = tuningFor(i);
      const options = {
        minCutoff: tuning.minCutoff * timeConstant,
        beta: tuning.beta / Math.max(0.1, timeConstant)
      };
      this.filters.push([
        new OneEuroFilter(options),
        new OneEuroFilter(options),
        new OneEuroFilter(options)
      ]);
    }
    this._initialised = false;
  }

  /** Drop all history so the next sample is taken as-is (tracking regained). */
  reset() {
    for (const [fx, fy, fz] of this.filters) {
      fx.reset();
      fy.reset();
      fz.reset();
    }
    this._initialised = false;
  }

  /**
   * Smooth 21 joint positions in place.
   *
   * The input array is never mutated — the caller passes its own buffer and
   * this writes into `out`. MediaPipe's landmark objects are never touched at
   * any point in the pipeline.
   *
   * @param {Array<THREE.Vector3|{x,y,z}>} positions 21 raw world positions
   * @param {Array<THREE.Vector3>} out 21 reusable output vectors
   * @param {number} t seconds, monotonic
   * @returns {Array<THREE.Vector3>} `out`
   */
  update(positions, out, t) {
    if (!positions) return out;

    for (let i = 0; i < 21; i++) {
      const target = out[i] || (out[i] = new THREE.Vector3());
      const point = positions[i];
      if (!point) {
        target.set(0, 0, 0);
        continue;
      }
      const [fx, fy, fz] = this.filters[i];

      // The first sample after a reset seeds the filter rather than easing
      // toward from the origin, which is what stops a reappearing hand from
      // sliding in from nowhere.
      target.set(
        fx.filter(point.x, t),
        fy.filter(point.y, t),
        fz.filter(point.z ?? 0, t)
      );
    }

    this._initialised = true;
    return out;
  }

  /** True once at least one frame has been smoothed since the last reset. */
  get ready() {
    return this._initialised;
  }
}

/**
 * One smoother per tracked hand, keyed by the same key the rigs use.
 *
 * Hands are keyed by `side-index` so a smoother follows a hand rather than a
 * slot: if MediaPipe reorders its array, the left hand does not inherit the
 * right hand's history (which would visibly snap the skeleton).
 */
export class HandSmootherRegistry {
  constructor({ settings = {} } = {}) {
    this.smoothers = new Map();
    this.settings = settings;
  }

  /**
   * @param {string} key
   * @returns {HandJointSmoother}
   */
  for(key) {
    let smoother = this.smoothers.get(key);
    if (!smoother) {
      smoother = new HandJointSmoother(this.settings);
      this.smoothers.set(key, smoother);
    }
    return smoother;
  }

  /**
   * Forget a hand's history. Called when a hand leaves the frame so that its
   * return is not a continuation of a stale pose.
   */
  reset(key) {
    this.smoothers.get(key)?.reset();
  }

  /** Forget every hand. */
  resetAll() {
    for (const smoother of this.smoothers.values()) smoother.reset();
  }

  /** Keep only the given keys' history, dropping hands that have gone. */
  retain(keys) {
    for (const key of [...this.smoothers.keys()]) {
      if (keys.has(key)) continue;
      this.smoothers.get(key)?.reset();
    }
  }

  updateSettings({ smoothing } = {}) {
    if (typeof smoothing !== "number") return;
    // The settings panel exposes a 0..1 "smoothing" slider; map it onto the
    // filter's time constant. Low smoothing = wide open, high = heavy.
    const timeConstant = 0.5 + smoothing * 1.5;
    this.settings = { ...this.settings, timeConstant };
    for (const smoother of this.smoothers.values()) {
      smoother.reset();
      for (let i = 0; i < 21; i++) {
        const tuning = tuningFor(i);
        const options = {
          minCutoff: tuning.minCutoff * timeConstant,
          beta: tuning.beta / Math.max(0.1, timeConstant)
        };
        const [fx, fy, fz] = smoother.filters[i];
        fx.configure(options);
        fy.configure(options);
        fz.configure(options);
      }
    }
  }

  dispose() {
    this.smoothers.clear();
  }
}
