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
    this.fx.reset(); this.fy.reset(); this.fz.reset();
  }

  filter(point, t) {
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
    this.point = new OneEuroPoint(this._filterOptions());
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
      this.point.configure(this._filterOptions());
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
    const tip = this.point.filter(indexTip(landmarks), t);
    const pinch = this.point.filter(pinchPoint(landmarks), t);
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
    this.point.reset();
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
  zSensitivity: 1.0
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
export class ManipulationSolver {
  constructor(options = {}) {
    this.settings = {
      ...DEFAULTS,
      ...(options.settings || {})
    };
    this.mode = "idle";       // idle | grab | frame
    this.grab = null;         // { hand, handStart, objectStart }
    this.frame = null;        // { distance, angle, mid, objectStart }
    this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    this.lastHandSeen = 0;
    this.onModeChange = options.onModeChange || null;
  }

  updateSettings(settings = {}) {
    Object.assign(this.settings, settings);
  }

  reset() {
    this.mode = "idle";
    this.grab = null;
    this.frame = null;
    this.velocity = { x: 0, y: 0, roll: 0, scale: 0 };
    this._setMode("idle");
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  /**
   * Advance the solver.
   * @param hands array of HandAnalyzer states (0..2)
   * @param objectState { position {x,y,z}, rotationZ, scale }
   * @param now seconds
   * @returns {{position?:object, rotationZ?:number, scale?:number, mode:string,
   *            active:boolean, intent:string}}
   */
  update(hands, objectState, now = 0) {
    const result = { mode: this.mode, active: false, intent: "none" };

    if (!hands || hands.length === 0) {
      if (this.mode !== "idle") {
        // Freeze the last stable state; drop the grab/frame reference.
        this._release(objectState);
      }
      // Report the mode *after* the release so callers see the settled state.
      result.mode = this.mode;
      result.intent = "tracking-lost";
      return result;
    }

    this.lastHandSeen = now;

    if (hands.length >= 2) {
      return this._updateTwoHand(hands, objectState);
    }

    return this._updateOneHand(hands[0], objectState);
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
      const sensitivity = 6.2 * this.settings.moveSensitivity;
      const dx = (hand.pinch.x - this.grab.handStart.x) * sensitivity;
      const dy = -(hand.pinch.y - this.grab.handStart.y) * sensitivity;
      const dz = -(hand.pinch.z - this.grab.handStart.z) * sensitivity * 6 * this.settings.zSensitivity;

      const target = {
        x: clamp(this.grab.objectStart.position.x + dx, -4.5, 4.5),
        y: clamp(this.grab.objectStart.position.y + dy, -3.5, 3.5),
        z: clamp(this.grab.objectStart.position.z + dz, -3.5, 3.5)
      };

      // Track velocity for release inertia (units per second).
      this.velocity.x = target.x - objectState.position.x;
      this.velocity.y = target.y - objectState.position.y;

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
    const result = { mode: "frame", active: true, intent: "frame" };

    // Normalise both hands into a common, mirrored image space.
    const mid = { x: (a.palm.x + b.palm.x) / 2, y: (a.palm.y + b.palm.y) / 2 };
    // Use palm distance: robust even when fingers curl independently.
    let distance = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y);
    distance = Math.max(0.06, distance);

    // Roll: angle between the two palms in the image plane.
    const angle = Math.atan2(b.palm.y - a.palm.y, b.palm.x - a.palm.x);

    const shouldFrame = a.pinched || b.pinched || distance > 0.16;

    if (!shouldFrame) {
      if (this.mode === "frame") this._release(objectState);
      this._setMode("idle");
      return { mode: "idle", active: false, intent: "none" };
    }


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
      x: clamp(ref.objectStart.position.x + (mid.x - ref.mid.x) * sensitivity, -4.5, 4.5),
      y: clamp(ref.objectStart.position.y - (mid.y - ref.mid.y) * sensitivity, -3.5, 3.5),
      z: ref.objectStart.position.z
    };

    this.velocity.x = position.x - objectState.position.x;
    this.velocity.y = position.y - objectState.position.y;
    this.velocity.roll = rotationZ - objectState.rotationZ;
    this.velocity.scale = scale - objectState.scale;

    result.position = position;
    result.rotationZ = rotationZ;
    result.scale = scale;
    result.intent = "scale + rotate + translate";
    return result;
  }

  _release() {
    this.grab = null;
    this.frame = null;
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
