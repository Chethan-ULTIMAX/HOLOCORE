/**
 * HOLOCORE — handDepth.js
 * -----------------------------------------------------------------------------
 * A calibrated, deliberately-activated depth signal for moving an object
 * towards and away from the camera.
 *
 * WHY NOT USE THE LANDMARK Z
 *
 * MediaPipe reports a z for every landmark, and it is tempting to read that as
 * "distance in front of the camera". It is not. The value is relative, scaled by
 * the hand's apparent size, and it changes when the hand rotates as much as when
 * it moves. Feeding it into a transform is what made objects lurch forward and
 * back when the user merely turned their hand.
 *
 * `worldLandmarks` are better (metres, roughly hand-centred) but still relative
 * to the wrist, so they carry no absolute distance either.
 *
 * WHAT IS ACTUALLY MEASURABLE
 *
 * Apparent size. A hand at arm's length covers fewer pixels than the same hand
 * held closer, and the ratio is a good proxy for the distance ratio. That is
 * what `palmSpan` measures and what this module turns into travel.
 *
 * THE RULES THAT MAKE IT USABLE
 *
 *  1. A reference pose is captured when the gesture activates. Everything is
 *     relative to that, so no two users need the same arm length or the same
 *     camera distance, and the object never jumps when the gesture starts.
 *  2. A dead zone absorbs the noise in the size estimate, which is the dominant
 *     error term. Without it the object jitters constantly.
 *  3. Sensitivity is user-tunable through the existing depthSensitivity setting,
 *     so a small hand movement can produce a large or small travel.
 *  4. The signal is smoothed before use.
 *  5. Travel is clamped, so a mis-detected hand cannot fling the object out of
 *     the workspace.
 *  6. Activation is deliberate. A slightly different hand shape is not enough;
 *     the user has to hold the pose.
 *  7. Losing tracking resets the reference, because the next hand seen may be at
 *     a completely different distance.
 *
 * This is deliberately NOT the only way to move in depth: the gizmo's Z axis is
 * exact and always available. This exists for hands-free work.
 */

/** Reference size is measured over the palm, which barely changes when fingers curl. */
export const DEPTH_MODE = {
  /** Relative change in apparent palm size that produces no movement at all. */
  deadZone: 0.045,
  /**
   * Apparent-size ratio at which the gesture is considered fully extended.
   * 1.9 means "appears almost twice as large as the reference", which is roughly
   * a hand moving from arm's length to half that.
   */
  fullScale: 1.0,
  /** Travel, in world units, at full extension with sensitivity 1. */
  maxTravel: 6,
  /** Smoothing cutoff for the size signal. Low: size is noisy, not fast. */
  minCutoff: 1.1,
  beta: 0.02,
  /** Frames the pose must be held before depth engages. */
  activationFrames: 6
};

/**
 * Convert an apparent-size ratio into signed travel.
 *
 * Pure, so the behaviour can be asserted without a hand or a camera.
 *
 * @param {number} ratio current palm span divided by the reference span (1 = same)
 * @param {object} [options]
 * @param {number} [options.deadZone=DEPTH_MODE.deadZone]
 * @param {number} [options.maxTravel=DEPTH_MODE.maxTravel]
 * @param {number} [options.sensitivity=1]
 * @param {boolean} [options.invert=false] flip the direction
 * @returns {{travel:number, strength:number, engaged:boolean}} travel in world
 *          units, 0..1 strength for HUD display, and whether the dead zone was
 *          cleared
 */
export function ratioToTravel(ratio, options = {}) {
  const {
    deadZone = DEPTH_MODE.deadZone,
    maxTravel = DEPTH_MODE.maxTravel,
    sensitivity = 1,
    invert = false
  } = options;

  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { travel: 0, strength: 0, engaged: false };
  }

  // Signed distance from "unchanged", so both directions work.
  const signed = ratio - 1;
  const magnitude = Math.abs(signed);

  if (magnitude <= deadZone) {
    return { travel: 0, strength: 0, engaged: false };
  }

  // Remap so the dead zone edge is 0 and fullScale-plus is 1. The subtraction
  // is what prevents a step at the edge of the dead zone.
  const usable = magnitude - deadZone;
  const span = Math.max(1e-6, DEPTH_MODE.fullScale);
  const normalised = Math.min(1, usable / span);

  // Ease-out: small deliberate movements produce most of the travel, so the user
  // does not have to reach absurdly to cross the stage.
  const eased = Math.sqrt(normalised);

  const direction = signed > 0 ? 1 : -1;
  const travel = direction * eased * maxTravel * sensitivity * (invert ? -1 : 1);

  return { travel, strength: eased, engaged: true };
}

/**
 * Per-hand depth state.
 *
 * Owned by the caller rather than held in module scope: two hands must not share
 * a reference size, or one hand moves while the other sits still.
 */
export class HandDepthTracker {
  constructor({ filter } = {}) {
    /** Reference palm span captured at activation, or null. */
    this.reference = null;
    this.active = false;
    this.heldFrames = 0;
    /** Smoothed apparent size. */
    this.size = null;
    /**
     * @type {{filter:(v:number,t:number)=>number, reset:()=>void}|null}
     * Injected so this file needs no dependency on the filter implementation.
     */
    this.filter = filter || null;
    if (this.filter && typeof this.filter.filter !== "function") {
      // Accept a bare function as well as a filter object; the registry hands
      // over whatever its factory produced, and a plain function is a reasonable
      // thing for a caller to supply.
      const fn = this.filter;
      this.filter = { filter: (value, t) => fn(value, t), reset: () => {} };
    }
  }

  /** Forget everything, e.g. when that hand stops being tracked. */
  reset() {
    this.reference = null;
    this.active = false;
    this.heldFrames = 0;
    this.size = null;
    this.filter?.reset?.();
  }

  /**
   * Whether the deliberate activation pose is being held.
   *
   * The pose is a flat open palm: no pinch, no pointing, and the fingers spread.
   * It is distinct from every manipulation gesture, so it cannot fire by
   * accident mid-drag.
   *
   * @param {object} hand a solver hand state
   * @returns {boolean}
   */
  static poseMatches(hand) {
    if (!hand) return false;
    return Boolean(
      hand.openPalm >= 0.72 &&
      !hand.pinched &&
      (hand.pointing ?? 0) < 0.5
    );
  }

  /**
   * Update with the current hand.
   *
   * @param {object} hand solver hand state (needs `openPalm`, `pinched`, `size`)
   * @param {number} now seconds, for the filter
   * @param {object} [options] forwarded to ratioToTravel
   * @returns {{travel:number, strength:number, engaged:boolean, armed:boolean,
   *            reference:number|null, ratio:number|null}}
   */
  update(hand, now, options = {}) {
    if (!hand) {
      this.reset();
      return {
        travel: 0, strength: 0, engaged: false, armed: false,
        active: false, reference: null, ratio: null
      };
    }

    // Apparent palm span, in whatever units the caller measured. Only ratios
    // matter, so the unit is irrelevant.
    const raw = Number.isFinite(hand.size) ? hand.size : null;
    if (raw === null || raw <= 1e-6) {
      return {
        travel: 0, strength: 0, engaged: false, armed: false,
        active: this.active, reference: this.reference, ratio: null
      };
    }

    this.size = this.filter ? this.filter.filter(raw, now) : raw;

    // Not armed: just count consecutive matching frames. The count is what makes
    // activation deliberate rather than incidental.
    if (!this.active) {
      if (HandDepthTracker.poseMatches(hand)) {
        this.heldFrames += 1;
        if (this.heldFrames >= (options.activationFrames ?? DEPTH_MODE.activationFrames)) {
          this.active = true;
          // Capture the reference from the SMOOTHED size at the moment of
          // activation, so the object does not jump on the first frame.
          this.reference = this.size;
        }
      } else {
        this.heldFrames = 0;
      }
      return {
        travel: 0, strength: 0, engaged: false,
        // `armed` means the pose is being held but depth has not engaged yet;
        // `active` is what a caller must gate on.
        armed: true, active: this.active,
        reference: this.reference, ratio: this.reference ? 1 : null
      };
    }

    // Armed. Hold still and the ratio is 1, so travel is 0.
    if (!this.reference) this.reference = this.size;
    const ratio = this.size / this.reference;
    const result = ratioToTravel(ratio, options);
    return { ...result, armed: true, active: true, reference: this.reference, ratio };
  }
}

/**
 * Registry so each hand axis keeps its own reference and smoothing.
 *
 * Keyed by the same stable hand key the solver uses, so a hand that swaps index
 * after being lost and found again does not inherit a stale reference.
 */
export class HandDepthRegistry {
  constructor({ makeFilter } = {}) {
    /** @type {Map<string, HandDepthTracker>} */
    this.trackers = new Map();
    this.makeFilter = makeFilter || null;
  }

  /**
   * @param {string} key stable hand key
   * @param {object} hand solver hand state
   * @param {number} now seconds
   * @param {object} [options]
   */
  update(key, hand, now, options = {}) {
    if (!key) return null;
    let tracker = this.trackers.get(key);
    if (!tracker) {
      tracker = new HandDepthTracker({
        filter: this.makeFilter ? this.makeFilter() : null
      });
      this.trackers.set(key, tracker);
    }
    return tracker.update(hand, now, options);
  }

  /** Drop a hand that is no longer tracked. */
  forget(key) {
    this.trackers.delete(key);
  }

  /** Drop hands not in `keys`. Called each frame with the tracked set. */
  retain(keys) {
    const keep = new Set(keys);
    for (const key of [...this.trackers.keys()]) {
      if (!keep.has(key)) this.trackers.delete(key);
    }
  }

  reset() {
    for (const tracker of this.trackers.values()) tracker.reset();
    this.trackers.clear();
  }

  get size() {
    return this.trackers.size;
  }
}
