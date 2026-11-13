import * as THREE from "three";
import { DragPlane } from "./dragPlane.js";
import { palmSpan } from "./handCoordinates.js";

/**
 * HOLOCORE — gestures.js
 * -----------------------------------------------------------------------------
 * Pure gesture recognition and continuous hand signals.
 *
 * Nothing in this file touches the DOM, Three.js, or the camera, so the whole
 * interaction model can be exercised headlessly (see tools/validate.js).
 *
 * Landmark indices follow the MediaPipe hand model (21 points, wrist = 0).
 */

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];

/* ------------------------------------------------------------------------- */
/* GEOMETRY                                                                  */
/* ------------------------------------------------------------------------- */

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Hand size reference that is stable regardless of finger pose.
 * Averages two independent palm spans so a single noisy landmark cannot
 * swing the normalisation (which would disturb every threshold downstream).
 */
export function palmScale(lm) {
  const wristToMiddle = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
  const indexToPinky = dist(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP]);
  const s = (wristToMiddle + indexToPinky * 1.15) / 2;
  return s > 1e-6 ? s : 1e-6;
}

/** Unit vector from wrist to middle-finger knuckle (image space). */
export function handAxis(lm) {
  const dx = lm[LM.MIDDLE_MCP].x - lm[LM.WRIST].x;
  const dy = lm[LM.MIDDLE_MCP].y - lm[LM.WRIST].y;
  const len = Math.hypot(dx, dy) || 1e-6;
  return { x: dx / len, y: dy / len };
}

/** Palm centre in image space. */
export function palmCenter(lm) {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0, y = 0;
  for (const id of ids) { x += lm[id].x; y += lm[id].y; }
  return { x: x / ids.length, y: y / ids.length };
}

/**
 * How extended each finger is, 0..1.
 *
 * Measured as chord / chain length: the straight-line distance from knuckle to
 * tip divided by the sum of the segment lengths. This ratio is ~1.0 for a
 * straight finger and collapses toward 0.3 as the finger curls, and — unlike a
 * projection onto the palm axis — it does not change when the whole hand is
 * rotated in the image.
 */
export function fingerExtensions(lm) {
  const straightness = (a, b, c, tip) => {
    const chain =
      dist(lm[a], lm[b]) + dist(lm[b], lm[c]) + dist(lm[c], lm[tip]);
    if (chain < 1e-6) return 0;
    return dist(lm[a], lm[tip]) / chain;
  };

  const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

  return {
    // Calibrated against forward-kinematic hand poses: open ≈ 1.00,
    // half-curl ≈ 0.92, fist ≈ 0.59, tight fist ≈ 0.32.
    thumb: norm(straightness(LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP), 0.68, 0.97),
    index: norm(straightness(LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP), 0.55, 0.965),
    middle: norm(straightness(LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP), 0.55, 0.965),
    ring: norm(straightness(LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP), 0.55, 0.965),
    pinky: norm(straightness(LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP), 0.55, 0.965)
  };
}

/**
 * Pinch strength 0..1 (1 = fingertips touching).
 * Distance between thumb tip and index tip, normalised by palm size.
 */
export function pinchStrength(lm) {
  const s = palmScale(lm);
  const d = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / s;
  // Measured against real hands: ≈ 0.95 fingertip-to-fingertip open,
  // ≈ 0.30 for a relaxed pinch, ≈ 0.0 when the pads touch.
  return Math.max(0, Math.min(1, 1 - (d - 0.10) / (1.05 - 0.10)));
}

/**
 * Pointing: index extended, middle/ring/pinky curled.
 * Returns 0..1 confidence.
 */
export function pointingConfidence(lm) {
  const e = fingerExtensions(lm);
  const curled = (e.middle + e.ring + e.pinky) / 3;
  return Math.max(0, Math.min(1, e.index * (1 - curled) * 1.6));
}

/** Open palm: all four long fingers extended. */
export function openPalmConfidence(lm) {
  const e = fingerExtensions(lm);
  return (e.index + e.middle + e.ring + e.pinky) / 4;
}

/** Fist: all long fingers curled. */
export function fistConfidence(lm) {
  const e = fingerExtensions(lm);
  const avg = (e.index + e.middle + e.ring + e.pinky) / 4;
  return Math.max(0, Math.min(1, 1 - avg * 1.35));
}

/**
 * Thumbs-up: thumb extended, other fingers curled, thumb tip above knuckles
 * in image space (y down, so "above" means smaller y).
 */
export function thumbsUpConfidence(lm) {
  const e = fingerExtensions(lm);
  const others = (e.index + e.middle + e.ring + e.pinky) / 4;
  const above = lm[LM.THUMB_TIP].y < lm[LM.THUMB_MCP].y - palmScale(lm) * 0.35;
  return Math.max(0, Math.min(1, e.thumb * (1 - others) * 1.5 * (above ? 1 : 0.25)));
}

/** Index fingertip position in image space (normalised 0..1). */
export function indexTip(lm) {
  return { x: lm[LM.INDEX_TIP].x, y: lm[LM.INDEX_TIP].y, z: lm[LM.INDEX_TIP].z || 0 };
}

/** Thumb-index pinch point in image space. */
export function pinchPoint(lm) {
  return {
    x: (lm[LM.THUMB_TIP].x + lm[LM.INDEX_TIP].x) / 2,
    y: (lm[LM.THUMB_TIP].y + lm[LM.INDEX_TIP].y) / 2,
    z: ((lm[LM.THUMB_TIP].z || 0) + (lm[LM.INDEX_TIP].z || 0)) / 2
  };
}

/* ------------------------------------------------------------------------- */
/* HYSTERESIS                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Binary threshold with separate rising/falling thresholds so a signal
 * sitting near the boundary cannot chatter.
 */
export class HysteresisGate {
  constructor({ on = 0.62, off = 0.45, initial = false, onFrames = 1, offFrames = 1 }) {
    this.onThreshold = on;
    this.offThreshold = off;
    this.onFrames = Math.max(1, onFrames);
    this.offFrames = Math.max(1, offFrames);
    this.state = initial;
    this._onCount = 0;
    this._offCount = 0;
  }

  setThresholds(on, off) {
    this.onThreshold = on;
    this.offThreshold = Math.min(off, on - 0.01);
  }

  /** Feed one sample; returns the debounced boolean state. */
  update(value) {
    if (this.state) {
      if (value < this.offThreshold) {
        this._offCount++;
        if (this._offCount >= this.offFrames) {
          this.state = false;
          this._offCount = 0;
          this._onCount = 0;
        }
      } else {
        this._offCount = 0;
      }
    } else {
      if (value > this.onThreshold) {
        this._onCount++;
        if (this._onCount >= this.onFrames) {
          this.state = true;
          this._onCount = 0;
          this._offCount = 0;
        }
      } else {
        this._onCount = 0;
      }
    }
    return this.state;
  }

  reset(state = false) {
    this.state = state;
    this._onCount = 0;
    this._offCount = 0;
  }
}

/* ------------------------------------------------------------------------- */
/* ONE EURO FILTER (adaptive noise reduction with low lag)                   */
/* ------------------------------------------------------------------------- */

/**
 * 1€ filter: heavy smoothing when slow, light smoothing when fast, so
 * accuracy is high at rest and lag is low during deliberate motion.
 */
export class OneEuroFilter {
  constructor({ minCutoff = 1.2, beta = 0.06, dCutoff = 1.0, freq = 30 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.freq = freq;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  static alpha(cutoff, freq) {
    const tau = 1 / (2 * Math.PI * cutoff);
    const te = 1 / freq;
    return 1 / (1 + tau / te);
  }

  configure({ minCutoff, beta }) {
    if (typeof minCutoff === "number") this.minCutoff = minCutoff;
    if (typeof beta === "number") this.beta = beta;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  /** Smooth a scalar. `t` is a timestamp in seconds (optional). */
  filter(value, t = null) {
    if (!Number.isFinite(value)) return this.xPrev ?? 0;
    if (this.xPrev === null || t === null || this.tPrev === null) {
      this.xPrev = value;
      this.dxPrev = 0;
      this.tPrev = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.freq = 1 / dt;
    this.tPrev = t;

    const dx = (value - this.xPrev) * this.freq;
    const aD = OneEuroFilter.alpha(this.dCutoff, this.freq);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuroFilter.alpha(cutoff, this.freq);
    this.xPrev = a * value + (1 - a) * this.xPrev;
    return this.xPrev;
  }
}

/** A 2D point smoother built from two OneEuro filters. */
export class OneEuroPoint {
  constructor(options) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
    this.fz = new OneEuroFilter(options);
  }

  configure(options) {
    this.fx.configure(options);
    this.fy.configure(options);
    this.fz.configure(options);
  }

  reset() {
    this.samples = 0;
    this.fx.reset(); this.fy.reset(); this.fz.reset();
  }

  filter(point, t) {
    this.samples = (this.samples || 0) + 1;
    return {
      x: this.fx.filter(point.x, t),
      y: this.fy.filter(point.y, t),
      z: this.fz.filter(point.z ?? 0, t)
    };
  }
}

/* ------------------------------------------------------------------------- */
/* HAND STATE                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Per-hand signal extraction with its own filters and hysteresis gates.
 * One instance per tracked hand (keyed by handedness).
 */
export class HandAnalyzer {
  constructor(settings = {}) {
    this.settings = {
      pinchThreshold: 0.62,
      pinchRelease: 0.45,
      smoothing: 0.5,
      ...settings
    };
    // Two different physical points must never share filter history. Using one
    // OneEuroPoint for both meant a stationary fingertip was dragged towards the
    // pinch midpoint (and vice versa) on every frame -- measured at 3.3% of the
    // gap per exchange, which reads as a hand that will not hold still.
    this.tipFilter = new OneEuroPoint(this._filterOptions());
    this.pinchFilter = new OneEuroPoint(this._filterOptions());
    this.pinchGate = new HysteresisGate({
      on: this.settings.pinchThreshold,
      off: this.settings.pinchRelease,
      onFrames: 2,
      offFrames: 2
    });
    this.state = null;
  }

  _filterOptions() {
    // smoothing 0..1 maps to cutoff 3.5Hz (responsive) .. 0.6Hz (very smooth)
    const smoothing = Math.max(0, Math.min(1, this.settings.smoothing));
    return { minCutoff: 3.5 - smoothing * 2.9, beta: 0.05 + smoothing * 0.12 };
  }

  updateSettings(settings = {}) {
    const pinchChanged =
      settings.pinchThreshold !== undefined || settings.pinchRelease !== undefined;

    Object.assign(this.settings, settings);

    if (pinchChanged) {
      this.pinchGate.setThresholds(this.settings.pinchThreshold, this.settings.pinchRelease);
    }
    if (settings.smoothing !== undefined) {
      this.tipFilter.configure(this._filterOptions());
      this.pinchFilter.configure(this._filterOptions());
    }
  }

  /**
   * @param landmarks raw 21-point landmarks (normalised image coords)
   * @param handedness "Left" | "Right" | "Unknown"
   * @param t timestamp in seconds
   */
  update(landmarks, handedness, t) {
    const rawPinch = pinchStrength(landmarks);
    const pinched = this.pinchGate.update(rawPinch);
    // Each point keeps its own history and its own timestamp stream.
    const tip = this.tipFilter.filter(indexTip(landmarks), t);
    const pinch = this.pinchFilter.filter(pinchPoint(landmarks), t);
    const palm = palmCenter(landmarks);
    const ext = fingerExtensions(landmarks);

    this.state = {
      handedness,
      landmarks,
      pinched,
      pinchStrength: rawPinch,
      pinch,
      indexTip: tip,
      palm,
      axis: handAxis(landmarks),
      // Apparent palm span. Used as a *relative* depth signal by handDepth.js:
      // a hand held closer appears larger. Never treated as an absolute distance.
      size: palmSpan(landmarks),
      scale: palmScale(landmarks),
      extensions: ext,
      pointing: pointingConfidence(landmarks),
      openPalm: openPalmConfidence(landmarks),
      fist: fistConfidence(landmarks),
      thumbsUp: thumbsUpConfidence(landmarks)
    };
    return this.state;
  }

  reset() {
    this.tipFilter.reset();
    this.pinchFilter.reset();
    this.pinchGate.reset(false);
    this.state = null;
  }
}

/* ------------------------------------------------------------------------- */
/* GESTURE LABEL                                                             */
/* ------------------------------------------------------------------------- */

export function describeGesture(hand, handsCount) {
  if (!hand) return "No hand";
  if (handsCount >= 2) return hand.pinched ? "Two-hand grasp" : "Two-hand frame";
  if (hand.pinched) return "Pinch";
  if (hand.thumbsUp > 0.55) return "Thumbs up";
  if (hand.pointing > 0.6) return "Point";
  if (hand.openPalm > 0.7) return "Open palm";
  if (hand.fist > 0.6) return "Fist";
  return "Tracking";
}


/* ------------------------------------------------------------------------- */
/* MANIPULATION SOLVER                                                       */
/* ------------------------------------------------------------------------- */

const DEFAULTS = {
  moveSensitivity: 1.0,
  rotateSensitivity: 1.0,
  scaleSensitivity: 1.0,
  zSensitivity: 1.0,
  /**
   * Active interaction mode. "auto" preserves the original behaviour (pinch to
   * grab, two hands to frame) and is the default so the mode gate is opt-in.
   * Once the UI sets a real mode, the solver refuses to produce any transform
   * that the mode does not allow — that is the guarantee behind "the selected
   * mode determines exactly what the gesture does".
   */
  mode: "auto",
  /** Scale clamps for SCALE mode. */
  minScale: 0.3,
  maxScale: 3.2,
  /**
   * How far a grab may travel, in world units. The playground widens these to
   * its own stage bounds so a drag does not saturate before the object reaches
   * the visible edge.
   */
  limits: { x: 4.5, y: 3.5, z: 3.5 },
  /** Rotate: radians of yaw per unit of normalised horizontal hand travel. */
  rotateGain: Math.PI * 1.6,
  /** Rotate: radians of pitch per unit of normalised vertical hand travel. */
  rotatePitchGain: Math.PI * 0.9,
  /** Explode: two-hand spread sensitivity. */
  explodeSensitivity: 1.0
};

/**
 * Converts hand signals into object transform deltas.
 *
 * Two modes:
 *  - ONE_HAND: a pinched hand grabs the object and moves it in the camera
 *    plane (x/y) with a small depth term from the pinch point's z.
 *  - TWO_HAND: both hands frame the object. Distance change drives scale,
 *    angle change drives roll, midpoint change drives translation.
 *
 * Stability features: per-hand filters upstream, pinch hysteresis,
 * reference-frame capture on grab (so the object never jumps to the hand),
 * and inertia on release.
 */
/**
 * Decide which hand drives single-hand manipulation.
 *
 * The pointer chose a pinching hand while every solver mode used `hands[0]`,
 * whatever order MediaPipe happened to return. With one hand open and one
 * pinching, the reticle followed the pinch and the object did not move — or,
 * with the array the other way round, both worked. Hand order is not stable
 * across frames, so the behaviour flickered.
 *
 * The rule, in priority order:
 *   1. a hand already locked in (`lockedKey`) keeps the role, so the gesture
 *      cannot swap hands halfway through a drag;
 *   2. a pinching hand, because a pinch is an explicit intent to act;
 *   3. the hand nearest the pointer target, i.e. the one actually aiming;
 *   4. the first tracked hand.
 *
 * @param {Array<object>} hands
 * @param {object} [options]
 * @param {string} [options.lockedKey] key of the hand currently driving
 * @param {Function} [options.keyOf]    hand -> stable key
 * @param {number} [options.minPinchPersistence=2] frames a new pinch must
 *        survive before it can steal the role
 * @returns {{hand: object, index: number, key: string|null}}
 */
/**
 * Intents that represent an object actually being transformed.
 *
 * A hovering hand produces `point`; a settled hand produces `hold` or `none`.
 * None of those may claim the controller lock, because a hand that is merely
 * visible is not in charge of anything.
 */
export const TRANSFORM_INTENTS = new Set([
  "translate", "rotate", "scale", "explode",
  "two-hand grab", "frame", "scale + rotate + translate"
]);

export function resolveActiveHand(hands, { lockedKey = null, keyOf = null, pinchFrames = null } = {}) {
  const list = Array.isArray(hands) ? hands.filter(Boolean) : [];
  if (!list.length) return { hand: null, index: -1, key: null };

  const keyFor = (hand, index) =>
    keyOf ? keyOf(hand, index) : (hand.key ?? hand.handedness ?? `hand-${index}`);

  // 1. A locked hand keeps driving. Losing it entirely is handled by the
  //    caller, which resets the lock when the hand leaves.
  if (lockedKey) {
    const index = list.findIndex((hand, i) => keyFor(hand, i) === lockedKey);
    if (index >= 0) return { hand: list[index], index, key: lockedKey };
  }

  // 2. A pinching hand, preferring the one that has been pinching longest.
  const pinching = [];
  list.forEach((hand, index) => {
    if (!hand.pinched) return;
    const frames = pinchFrames?.get?.(keyFor(hand, index)) ?? Infinity;
    pinching.push({ hand, index, key: keyFor(hand, index), frames });
  });
  if (pinching.length) {
    pinching.sort((a, b) => b.frames - a.frames);
    return pinching[0];
  }

  // 3/4. Nothing is pinching: the first hand is the aiming hand. Hover only,
  //      and hovering never transforms anything.
  return { hand: list[0], index: 0, key: keyFor(list[0], 0) };
}

/**
 * Put the active hand first and keep the rest in their original order.
 *
 * Two-hand modes need both hands but still care which one leads, because the
 * reference frame is captured from the leading hand's pose.
 */
function orderByActive(hands, active) {
  const list = Array.isArray(hands) ? hands.filter(Boolean) : [];
  if (!active?.hand) return list;
  const index = list.indexOf(active.hand);
  if (index <= 0) return list;
  const ordered = list.slice();
  ordered.splice(index, 1);
  ordered.unshift(active.hand);
  return ordered;
}

export class ManipulationSolver {
  constructor(options = {}) {
    this.settings = {
      ...DEFAULTS,
      ...(options.settings || {})
    };
    this._syncLimits();
    this.mode = "idle";       // idle | grab | frame
    this.grab = null;          // { handStart, objectStart }      MOVE
    this.frame = null;         // { distance, angle, mid, ... }    two-hand (auto)
    this.rotationFrame = null; // { handStart, objectStart }      ROTATE
    this.scaleFrame = null;    // { distance, objectStart }       SCALE
    this.explodeFrame = null;  // { distance, start }             EXPLODE
    this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    this.lastHandSeen = 0;
    this.onModeChange = options.onModeChange || null;
    // Which hand is currently driving. Locked for the duration of a grab so a
    // gesture cannot migrate to the other hand mid-drag.
    this.activeKey = null;
    this.activeHand = null;
    /** True only while a transform is in progress; gates the controller lock. */
    this.grabbing = false;
    // Camera-relative translation. The plane is captured once per grab and held
    // for its duration, so a camera nudge mid-drag cannot move the object.
    this.dragPlane = new DragPlane();
    this._dragOut = { x: 0, y: 0, z: 0 };
  }

  updateSettings(settings = {}) {
    Object.assign(this.settings, settings);
    this._syncLimits();
  }

  /**
   * Supply the camera and pointer needed for camera-relative translation.
   *
   * @param {object} context
   * @param {THREE.Camera} context.camera
   * @param {{x:number,y:number}} context.ndc pointer in NDC, or null
   * @param {THREE.Vector3} [context.grabPoint] world position of the grab
   */
  setViewContext({ camera = null, ndc = null } = {}) {
    this.camera = camera || null;
    this.pointerNdc = ndc || null;
  }

  /** `limits` is nested, so a partial override must not drop the other axes. */
  _syncLimits() {
    this.limits = { ...DEFAULTS.limits, ...(this.settings.limits || {}) };
  }

  reset() {
    this.mode = "idle";
    this.activeKey = null;
    this.activeHand = null;
    this.dragPlane.release();
    this.grab = null;
    this.frame = null;
    this.rotationFrame = null;
    this.scaleFrame = null;
    this.explodeFrame = null;
    this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    this._setMode("idle");
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  /** The active mode id ("auto" | "select" | "move" | "rotate" | "scale" | "explode"). */
  get modeId() {
    return this.settings.mode || "auto";
  }

  /**
   * Set the interaction mode. Changing mode mid-gesture releases the current
   * interaction so a half-finished drag can never leak into the next mode.
   */
  setMode(mode, objectState = null) {
    if (mode === this.settings.mode) return this.settings.mode;
    this.settings.mode = mode;
    if (mode !== "auto") {
      // Drop any reference frame captured under the old mode.
      this.grab = null;
      this.frame = null;
      this.explodeFrame = null;
      this.rotationFrame = null;
      this.scaleFrame = null;
      this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
      this._setMode("idle");
      void objectState;
    }
    return this.settings.mode;
  }

  /**
   * Advance the solver.
   * @param hands array of HandAnalyzer states (0..2)
   * @param objectState { position {x,y,z}, rotationZ, rotationX, scale, explode }
   * @param now seconds
   * @returns {{position?:object, rotationZ?:number, rotationX?:number,
   *            scale?:number, explode?:number, mode:string, active:boolean,
   *            intent:string, pointer?:object}}
   */
  update(hands, objectState, now = 0) {
    const state = objectState || {};
    const result = { mode: this.mode, active: false, intent: "none" };

    if (!hands || hands.length === 0) {
      if (this.mode !== "idle") {
        // Freeze the last stable state; drop the grab/frame reference.
        this._release(state);
      }
      // Report the mode *after* the release so callers see the settled state.
      result.mode = this.mode;
      result.intent = "tracking-lost";
      return result;
    }

    this.lastHandSeen = now;

    // One resolved active hand per frame, shared by every mode and reported to
    // the caller so the reticle and the solver can never disagree.
    const keyOf = (hand, index) => hand.key ?? hand.handedness ?? `hand-${index}`;
    const active = resolveActiveHand(hands, {
      lockedKey: this.activeKey,
      keyOf
    });
    this.activeHand = active.hand;

    // The lock has a lifecycle: a real grab takes it, the grab holds it, and
    // releasing gives it back. Assigning it unconditionally on every update --
    // which is what this used to do -- meant a hand that was merely hovering
    // claimed the lock permanently, and the other hand could never take over
    // even after the first hand stopped doing anything at all.
    //
    // `this.grabbing` is true only while a transform is in progress; it is set
    // by the update paths below and cleared by _release().
    if (!this.grabbing) this.activeKey = null;

    const mode = this.modeId;
    let outcome;
    if (mode === "auto") {
      // Two hands only take over in auto mode, and only when they are making a
      // deliberate two-hand gesture. Otherwise the resolved hand drives: a
      // single pinch must still grab even with a second hand in shot, which is
      // the common case of reaching in with one hand while the other rests.
      const twoHand = hands.length >= 2 ? this._updateTwoHand(hands, state) : null;
      outcome = twoHand && twoHand.intent !== "none"
        ? twoHand
        : this._updateOneHand(active.hand || hands[0], state);
    } else {
      outcome = this._updateModal(mode, hands, state, active);
    }

    // A transform in progress owns the lock, so a second pinching hand cannot
    // steal the object mid-drag. Any other outcome leaves it free.
    const transforming = TRANSFORM_INTENTS.has(outcome.intent);
    this.grabbing = transforming;
    if (transforming && active.key) this.activeKey = active.key;
    if (!transforming) this.activeKey = null;

    // Publish the hand that drove this frame. The pointer prefers it, so the
    // reticle is drawn on the hand that is actually moving the object.
    outcome.activeHand = { hand: active.hand, index: active.index, key: active.key };
    return outcome;
  }

  /**
   * Mode-gated update. Every branch produces at most one kind of change, and the
   * `intent` it reports is the only transform the caller is allowed to apply.
   */
  _updateModal(mode, hands, objectState, active = null) {
    // SCALE and EXPLODE are genuinely two-handed: the gesture is the span
    // between both palms, so they keep the full set. Putting the resolved hand
    // first preserves "the pinching hand leads" without hiding the second hand.
    if (mode === "scale" || mode === "explode") {
      const ordered = orderByActive(hands, active);
      return mode === "scale"
        ? this._modeScale(ordered, objectState)
        : this._modeExplode(ordered, objectState);
    }

    // The rest are single-hand: the resolved hand drives, never hands[0].
    const hand = active?.hand || hands[0];
    const single = hand ? [hand] : [];
    switch (mode) {
      case "select": return this._modeSelect(single, objectState);
      case "move": return this._modeMove(single, objectState);
      case "rotate": return this._modeRotate(single, objectState);
      default: return { mode: "idle", active: false, intent: "none" };
    }
  }

  /**
   * Camera-relative translation for the current pointer.
   *
   * Falls back to the old axis mapping only when there is no camera or no
   * pointer (headless callers and the first frame before the reticle exists).
   * The fallback is honest about being a fallback: it maps to world X/Y, which
   * is right for the default three-quarter view and only for that.
   *
   * @returns {{position: object, delta: object, mode: string}}
   */
  _translateTo(hand, objectState) {
    const start = this.grab.objectStart.position;
    const limits = this.limits;

    if (this.camera && this.pointerNdc) {
      // Begin the drag plane on the first frame of the grab, through the point
      // where the object actually is.
      if (!this.dragPlane.active) {
        const grabPoint = new THREE.Vector3(start.x, start.y, start.z);
        this.dragPlane.begin({
          camera: this.camera,
          ndc: this.pointerNdc,
          grabPoint
        });
      }
      const delta = this.dragPlane.delta(this.camera, this.pointerNdc, this._dragTmp ||
        (this._dragTmp = new THREE.Vector3()));
      if (delta) {
        const position = {
          x: clamp(start.x + delta.x, -limits.x, limits.x),
          y: clamp(start.y + delta.y, -limits.y, limits.y),
          z: clamp(start.z + delta.z, -limits.z, limits.z)
        };
        return { position, delta: { x: delta.x, y: delta.y, z: delta.z } };
      }
    }

    // Fallback: fixed world axes, exactly as before.
    const sensitivity = 6.2 * this.settings.moveSensitivity;
    const dx = (hand.pinch.x - this.grab.handStart.x) * sensitivity;
    const dy = -(hand.pinch.y - this.grab.handStart.y) * sensitivity;
    const position = {
      x: clamp(start.x + dx, -limits.x, limits.x),
      y: clamp(start.y + dy, -limits.y, limits.y),
      z: clamp(start.z, -limits.z, limits.z)
    };
    return { position, delta: { x: dx, y: dy, z: 0 }, fallback: true };
  }

  /* ---- SELECT ---------------------------------------------------------- */
  _modeSelect(hands, objectState) {
    const hand = hands[0];
    const result = { mode: "idle", active: false, intent: "none" };

    if (hand.pinched) {
      this._setMode("grab");
      result.active = true;
      result.mode = "grab";
      result.intent = "select";
      // Selection is a discrete event: report the pinch point, apply nothing.
      result.pointer = hand.indexTip || hand.pinch;
      result.selectAt = hand.pinch;
      return result;
    }

    if (this.mode === "grab") this._release(objectState);
    this._setMode("idle");
    result.intent = hand.pointing > 0.5 ? "hover" : "none";
    result.pointer = hand.indexTip;
    // Nothing is transformed in SELECT mode, ever.
    void objectState;
    return result;
  }

  /* ---- MOVE ------------------------------------------------------------ */
  _modeMove(hands, objectState) {
    const hand = hands[0];
    if (!hand.pinched) {
      if (this.mode === "grab") {
        this._release(objectState);
        return { mode: "idle", active: false, intent: "release" };
      }
      this._setMode("idle");
      return { mode: "idle", active: false, intent: "none", pointer: hand.indexTip };
    }

    if (this.mode !== "grab" || !this.grab) {
      this.grab = {
        handStart: { x: hand.pinch.x, y: hand.pinch.y, z: hand.pinch.z },
        objectStart: { position: { ...objectState.position } }
      };
      this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    }
    this._setMode("grab");

    const { position } = this._translateTo(hand, objectState);

    this.velocity.x = position.x - objectState.position.x;
    this.velocity.y = position.y - objectState.position.y;
    this.velocity.z = position.z - (objectState.position.z || 0);

    return { mode: "grab", active: true, intent: "translate", position, pointer: hand.indexTip };
  }

  /* ---- ROTATE ---------------------------------------------------------- */
  _modeRotate(hands, objectState) {
    const hand = hands[0];
    if (!hand.pinched) {
      if (this.mode === "grab") {
        this._release(objectState);
        return { mode: "idle", active: false, intent: "release" };
      }
      this._setMode("idle");
      return { mode: "idle", active: false, intent: "none", pointer: hand.indexTip };
    }

    if (this.mode !== "grab" || !this.rotationFrame) {
      this.rotationFrame = {
        handStart: { x: hand.pinch.x, y: hand.pinch.y },
        objectStart: {
          rotationZ: objectState.rotationZ || 0,
          rotationX: objectState.rotationX || 0
        }
      };
      this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    }
    this._setMode("grab");

    const frame = this.rotationFrame;
    // Horizontal travel yaws the target; vertical travel pitches it. Both are
    // relative to the grabbed frame, so the target never jumps on pinch.
    const yawDelta =
      (hand.pinch.x - frame.handStart.x) * this.settings.rotateGain * this.settings.rotateSensitivity;
    const pitchDelta =
      -(hand.pinch.y - frame.handStart.y) * this.settings.rotatePitchGain * this.settings.rotateSensitivity;

    const rotationZ = frame.objectStart.rotationZ + yawDelta;
    const rotationX = clamp(frame.objectStart.rotationX + pitchDelta, -Math.PI / 2, Math.PI / 2);

    this.velocity.roll = rotationZ - (objectState.rotationZ || 0);

    // ROTATE never emits position or scale.
    return { mode: "grab", active: true, intent: "rotate", rotationZ, rotationX, pointer: hand.indexTip };
  }

  /* ---- SCALE ----------------------------------------------------------- */
  _modeScale(hands, objectState) {
    const both = hands.length >= 2 && hands[0].pinched && hands[1].pinched;

    if (!both) {
      // Two hands are needed to scale, but a single pinched hand must NOT
      // release the grab: the user pinches with one hand, then brings the
      // second one in. Releasing here would abort the gesture mid-way and then
      // snap the scale when the second pinch lands. Wait instead, holding the
      // frame so the scale starts from the pose the user actually grabbed in.
      const waiting = hands.some(hand => hand?.pinched);
      if (waiting) {
        // Arm the gesture: the first pinch commits us to SCALE, and the frame is
        // captured from the pose in force when the *second* hand arrives.
        this._setMode("frame");
        return {
          mode: "frame",
          active: false,
          intent: "hold",
          pointer: hands[0]?.indexTip
        };
      }
      if (this.mode === "frame") {
        this._release(objectState);
        this.scaleFrame = null;
        return { mode: "idle", active: false, intent: "release" };
      }
      this.scaleFrame = null;
      this._setMode("idle");
      return {
        mode: "idle",
        active: false,
        intent: "none",
        pointer: hands[0]?.indexTip
      };
    }

    const [a, b] = hands;
    // Pinch-to-pinch distance is the scale reference; it is stable even when the
    // palms rotate, which palm distance is not.
    const distance = Math.max(0.001, Math.hypot(a.pinch.x - b.pinch.x, a.pinch.y - b.pinch.y));

    if (this.mode !== "frame" || !this.scaleFrame) {
      this.scaleFrame = {
        distance,
        objectStart: { scale: objectState.scale ?? 1 }
      };
      this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    }
    this._setMode("frame");

    // Ratio-based so equal gesture → equal result regardless of hand size.
    const rawRatio = distance / this.scaleFrame.distance;
    const ratio = 1 + (rawRatio - 1) * this.settings.scaleSensitivity;
    const scale = clamp(
      this.scaleFrame.objectStart.scale * ratio,
      this.settings.minScale,
      this.settings.maxScale
    );

    this.velocity.scale = scale - (objectState.scale ?? 1);

    // SCALE never emits position or rotation.
    return { mode: "frame", active: true, intent: "scale", scale };
  }

  /* ---- EXPLODE --------------------------------------------------------- */
  _modeExplode(hands, objectState) {
    const both = hands.length >= 2;
    const current = clamp(objectState.explode ?? 0, 0, 1);

    if (!both) {
      if (this.mode === "frame") {
        this._release(objectState);
        this.explodeFrame = null;
        return { mode: "idle", active: false, intent: "release" };
      }
      this.explodeFrame = null;
      this._setMode("idle");
      return {
        mode: "idle",
        active: false,
        intent: "none",
        pointer: hands[0]?.indexTip
      };
    }

    const [a, b] = hands;
    // Fall back to the pinch/index points when a palm centre is missing: a
    // hand state built from partial landmarks has neither, and dereferencing it
    // threw on every frame.
    const pointOf = hand => hand.palm || hand.pinch || hand.indexTip || null;
    const pa = pointOf(a);
    const pb = pointOf(b);
    if (!pa || !pb) {
      this.explodeFrame = null;
      this._setMode("idle");
      return {
        mode: "idle",
        active: false,
        intent: "none",
        pointer: hands[0]?.indexTip || hands[0]?.pinch
      };
    }
    const distance = Math.max(0.001, Math.hypot(pa.x - pb.x, pa.y - pb.y));

    if (this.mode !== "frame" || !this.explodeFrame) {
      this.explodeFrame = { distance, start: current };
      this._setMode("frame");
    }

    const frame = this.explodeFrame;
    // Spread by 10% of the reference distance → 10% more explosion.
    const ratio = distance / frame.distance;
    const explode = clamp(
      1 - (1 - frame.start) / Math.max(0.05, ratio * this.settings.explodeSensitivity),
      0,
      1
    );

    // EXPLODE never moves, rotates or scales the model.
    return { mode: "frame", active: true, intent: "explode", explode };
  }

  _updateOneHand(hand, objectState) {
    let result = { mode: this.mode, active: false, intent: "none" };

    if (hand.pinched) {
      if (this.mode !== "grab") {
        // Capture a reference frame: object moves relative to the grab point.
        this.frame = null;
        this.grab = {
          handStart: { x: hand.pinch.x, y: hand.pinch.y, z: hand.pinch.z },
          objectStart: {
            position: { ...objectState.position },
            rotationZ: objectState.rotationZ,
            scale: objectState.scale
          }
        };
        this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
        this._setMode("grab");
      }

      this._setMode("grab");
      const { position: target } = this._translateTo(hand, objectState);

      // Track velocity for release inertia (units per second).
      this.velocity.x = target.x - objectState.position.x;
      this.velocity.y = target.y - objectState.position.y;
      this.velocity.z = target.z - (objectState.position.z || 0);

      result.position = target;
      result.active = true;
      result.mode = "grab";
      result.intent = "translate";
      return result;
    }

    if (this.mode === "grab") {
      this._release(objectState);
      return { mode: "idle", active: false, intent: "release" };
    }

    // Hover: pointing selects whatever the index fingertip is over.
    if (hand.pointing > 0.55) {
      result.intent = "point";
      result.pointer = hand.indexTip;
    } else if (hand.openPalm > 0.75) {
      result.intent = "idle";
    }

    this._setMode("idle");
    return result;
  }

  _updateTwoHand(hands, objectState) {
    const [a, b] = hands;

    // Normalise both hands into a common, mirrored image space.
    const mid = { x: (a.palm.x + b.palm.x) / 2, y: (a.palm.y + b.palm.y) / 2 };
    // Use palm distance: robust even when fingers curl independently.
    let distance = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y);
    distance = Math.max(0.06, distance);

    // Roll: angle between the two palms in the image plane.
    const angle = Math.atan2(b.palm.y - a.palm.y, b.palm.x - a.palm.x);

    // Two hands only manipulate when the user is *asking* them to.
    //
    // The activation used to be `a.pinched || b.pinched || distance > 0.16`,
    // which meant simply having two hands in frame while gesturing near each
    // other grabbed the object and started scaling it. Hands are allowed to be
    // in the shot without meaning anything.
    //
    // A deliberate two-hand gesture is one of:
    //   - BOTH hands pinching (an unmistakable two-hand grab), or
    //   - both palms open and held apart, which is the classic "frame" pose.
    // One pinching hand is a one-hand manipulation, never a two-hand frame.
    const bothPinched = a.pinched && b.pinched;
    const framePose = a.openPalm > 0.6 && b.openPalm > 0.6 && distance > 0.16;
    const deliberate = bothPinched || framePose;

    if (!deliberate) {
      if (this.mode === "frame") this._release(objectState);
      this._setMode("idle");
      return { mode: "idle", active: false, intent: "none" };
    }

    const result = {
      mode: "frame",
      active: true,
      intent: bothPinched ? "two-hand grab" : "frame"
    };


    if (this.mode !== "frame" || !this.frame) {
      if (this.mode === "grab") this.grab = null;
      this.frame = {
        distance,
        angle,
        mid,
        objectStart: {
          position: { ...objectState.position },
          rotationZ: objectState.rotationZ,
          scale: objectState.scale
        }
      };
      this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
      this._setMode("frame");
    }

    const ref = this.frame;

    // Scale relative to the frame distance (clamped so noise cannot explode it).
    const rawScaleRatio = distance / ref.distance;
    const scaleRatio = clamp(1 + (rawScaleRatio - 1) * this.settings.scaleSensitivity, 0.25, 4);
    const scale = clamp(ref.objectStart.scale * scaleRatio, 0.3, 3.2);

    // Rotation: shortest-path angle difference.
    let dAngle = angle - ref.angle;
    while (dAngle > Math.PI) dAngle -= Math.PI * 2;
    while (dAngle < -Math.PI) dAngle += Math.PI * 2;
    dAngle = clamp(dAngle, -0.9, 0.9) * this.settings.rotateSensitivity;

    const rotationZ = ref.objectStart.rotationZ + dAngle;

    // Translation from the midpoint, scaled to the viewport.
    const sensitivity = 6.2 * this.settings.moveSensitivity;
    const position = {
      x: clamp(ref.objectStart.position.x + (mid.x - ref.mid.x) * sensitivity, -this.limits.x, this.limits.x),
      y: clamp(ref.objectStart.position.y - (mid.y - ref.mid.y) * sensitivity, -this.limits.y, this.limits.y),
      z: ref.objectStart.position.z
    };

    this.velocity.x = position.x - objectState.position.x;
    this.velocity.y = position.y - objectState.position.y;
    this.velocity.roll = rotationZ - objectState.rotationZ;
    this.velocity.scale = scale - objectState.scale;

    result.position = position;
    result.rotationZ = rotationZ;
    result.scale = scale;
    // Keep the deliberate-gesture label set above; it tells the caller which
    // two-hand gesture was recognised, which the generic description does not.
    return result;
  }

  _release() {
    this.dragPlane.release();
    this.grab = null;
    this.frame = null;
    this.rotationFrame = null;
    this.scaleFrame = null;
    this.explodeFrame = null;
    this._setMode("idle");
  }

  /**
   * Rotational inertia applied after release.
   * @returns {{roll:number, x:number, y:number, scale:number}} deltas to add this frame
   */
  applyInertia(objectState, dt, factor = 0.94) {
    const out = { x: 0, y: 0, roll: 0, scale: 0 };
    if (this.mode !== "idle") return out;
    const v = this.velocity;
    if (
      Math.abs(v.x) < 1e-4 && Math.abs(v.y) < 1e-4 &&
      Math.abs(v.roll) < 1e-5 && Math.abs(v.scale) < 1e-5
    ) {
      return out;
    }
    const decay = Math.pow(factor, dt * 60);
    out.x = v.x * dt * 6;
    out.y = v.y * dt * 6;
    out.roll = v.roll * dt * 6;
    out.scale = v.scale * dt * 6;
    v.x *= decay; v.y *= decay; v.roll *= decay; v.scale *= decay;
    return out;
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export { clamp };
