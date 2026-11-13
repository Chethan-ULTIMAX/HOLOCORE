/**
 * HOLOCORE — calibration.js
 * -----------------------------------------------------------------------------
 * Per-user pinch calibration (§9).
 *
 * WHY THIS EXISTS
 *
 * The pinch thresholds are two numbers in settings: `pinchThreshold` (how close
 * the pads must be before a pinch is recognised) and `pinchRelease` (how far they
 * must separate before it is released). They were chosen from one pair of hands
 * on one webcam.
 *
 * Raw pinch strength is normalised by palm size, which removes most of the
 * variation between hands — but not all of it. Thumb length relative to palm
 * span, how the user habitually holds a "pinch", camera distance and even
 * lighting all move the measured value. A user whose relaxed pinch reads 0.70
 * finds nothing ever engages at a 0.62 threshold; a user whose open hand reads
 * 0.50 finds everything engages the moment they raise it.
 *
 * WHAT IT MEASURES
 *
 * Two poses, in this order:
 *
 *   1. an open hand, relaxed, fingers apart
 *   2. a deliberate pinch, pads together
 *
 * From the raw pinch strength recorded in each, it fits a pair of thresholds
 * between the two distributions. Nothing here needs a browser: it is pure maths
 * over recorded samples, which is what makes it testable.
 *
 * WHAT IT REFUSES TO DO
 *
 * It returns a reasoned refusal instead of thresholds when the data cannot
 * support a decision — too few samples, a noisy hold, or two poses that overlap
 * so much that no threshold separates them. Committing thresholds from bad data
 * is worse than leaving the previous ones in place: the user would get a gesture
 * engine that is confidently wrong, with no indication why.
 */

/** Defaults, used when calibration cannot produce anything better. */
export const DEFAULT_THRESHOLDS = Object.freeze({ threshold: 0.62, release: 0.44 });

/** How long each pose is held, in milliseconds. */
export const POSE_DURATION_MS = 2500;

/** Fewest samples per pose that can describe a pose at all (~0.7 s at 30 fps). */
export const MIN_SAMPLES = 20;

/** Largest acceptable sample deviation within one pose, in raw strength units. */
export const MAX_DEVIATION = 0.09;

/**
 * Smallest acceptable gap between the open mean and the pinched mean.
 *
 * Below this the two poses are not distinguishable — usually because the user
 * was already pinching while "showing an open hand".
 */
export const MIN_SEPARATION = 0.25;

/** How far the thresholds sit from the open hand, as a fraction of the gap. */
const THRESHOLD_FRACTION = 0.42;
const RELEASE_FRACTION = 0.60;

/** The two poses, in the order the user is asked to hold them. */
export const POSES = Object.freeze([
  {
    id: "open",
    label: "Open hand",
    instruction: "Hold your hand open and relaxed, fingers apart",
    detail: "Palm towards the camera. Do not pinch."
  },
  {
    id: "pinch",
    label: "Pinch",
    instruction: "Now pinch — thumb and index fingertip together",
    detail: "Hold it lightly, the way you would to grab something."
  }
]);

/**
 * Mean and sample standard deviation of a list of numbers.
 *
 * @param {number[]} values
 * @returns {{count:number, mean:number, deviation:number}}
 */
export function summarise(values) {
  const samples = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  const count = samples.length;
  if (!count) return { count: 0, mean: 0, deviation: 0 };

  const mean = samples.reduce((sum, v) => sum + v, 0) / count;
  const deviation = count > 1
    ? Math.sqrt(samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (count - 1))
    : 0;
  return { count, mean, deviation };
}

/** Discard the first fifth of a hold: the hand is still arriving. */
function settleWindow(values) {
  const list = Array.isArray(values) ? values : [];
  if (list.length < 10) return list;
  return list.slice(Math.floor(list.length * 0.2));
}

/**
 * Fit pinch thresholds from the two recorded poses.
 *
 * Returns `{ok: true, threshold, release, ...}` or
 * `{ok: false, reason, message}` — never a partial result.
 *
 * @param {{open:number[], pinch:number[]}} capture raw strengths per pose
 * @param {{current?:{threshold:number, release:number}}} [options]
 */
export function fitThresholds(capture, { current = DEFAULT_THRESHOLDS } = {}) {
  const open = summarise(settleWindow(capture?.open));
  const pinch = summarise(settleWindow(capture?.pinch));

  if (open.count < MIN_SAMPLES || pinch.count < MIN_SAMPLES) {
    return {
      ok: false,
      reason: "too-few-samples",
      message: `Only ${Math.min(open.count, pinch.count)} usable samples per pose — ` +
        `hold each pose for the full countdown.`,
      open, pinch
    };
  }

  if (open.deviation > MAX_DEVIATION || pinch.deviation > MAX_DEVIATION) {
    return {
      ok: false,
      reason: "too-noisy",
      message: "Your hand moved too much during the hold. Rest your wrist and try again.",
      open, pinch
    };
  }

  // Pinching must read LOWER than open: strength is 1 when the pads touch.
  if (open.mean - pinch.mean < MIN_SEPARATION) {
    return {
      ok: false,
      reason: "poses-overlap",
      message: "The open and pinched poses looked too similar. Open the hand fully, " +
        "then pinch deliberately.",
      open, pinch, separation: open.mean - pinch.mean
    };
  }

  const gap = open.mean - pinch.mean;
  // Sit closer to the open value than the pinched one: engaging by accident is
  // far more disruptive than having to squeeze slightly harder.
  const threshold = open.mean - gap * THRESHOLD_FRACTION;
  const release = open.mean - gap * RELEASE_FRACTION;

  // Hysteresis must survive rounding, or the gate would chatter. Release stays
  // below the threshold by at least 0.04, which is about the width of one
  // standard deviation of a steady hold.
  const Hysteresis = Math.max(0.04, gap * 0.2);
  const safeRelease = Math.min(release, threshold - Hysteresis);

  return {
    ok: true,
    threshold: round3(threshold),
    release: round3(Math.max(0.05, safeRelease)),
    open,
    pinch,
    separation: gap,
    // How much more confident this is than the defaults, for the UI to show.
    changed: Math.abs(threshold - (current?.threshold ?? 0)) > 0.02 ||
      Math.abs(safeRelease - (current?.release ?? 0)) > 0.02
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * A small state machine for the two-pose capture.
 *
 * Kept separate from the tracker and the DOM so the flow can be tested exactly
 * as it runs: pose order, sample routing, cancellation and completion.
 */
export class CalibrationSession {
  /**
   * @param {{posers?:Array, minSamples?:number, clock?:() => number}} [options]
   */
  constructor({ poses = POSES, minSamples = MIN_SAMPLES, clock } = {}) {
    this.poses = poses;
    this.minSamples = minSamples;
    this.clock = clock || (() => performance.now());
    this.reset();
  }

  reset() {
    this.startedAt = null;
    this.poseIndex = 0;
    this.captures = this.poses.map(() => []);
    this.finished = false;
    this.result = null;
  }

  /** @returns {boolean} */
  get active() {
    return this.startedAt !== null && !this.finished;
  }

  get pose() {
    return this.poses[this.poseIndex] || null;
  }

  /** Begin (or restart) the capture. */
  start() {
    this.reset();
    this.startedAt = this.clock();
    return this.snapshot();
  }

  /** Abandon the capture without producing a result. */
  cancel() {
    this.reset();
    return this.snapshot();
  }

  /**
   * Record one raw pinch strength.
   *
   * @param {number} strength
   * @param {number} [now] clock override, for deterministic tests
   */
  sample(strength, now = null) {
    if (!this.active) return this.snapshot();
    if (Number.isFinite(strength)) {
      const bucket = this.captures[this.poseIndex];
      bucket.push(Math.max(0, Math.min(1, strength)));
      if (bucket.length > 400) bucket.shift();
    }
    const finished = this._advanceIfDue(now);
    if (finished) this._finish();
    return this.snapshot();
  }

  /**
   * Move to the next pose once the current one has enough samples and time.
   * @returns {boolean} true when the last pose has just completed
   */
  _advanceIfDue(now = null) {
    const t = now === null ? this.clock() : now;
    const elapsed = t - this.startedAt;
    const dueFor = POSE_DURATION_MS * (this.poseIndex + 1);
    const enough = this.captures[this.poseIndex].length >= this.minSamples;

    if (!enough || elapsed < dueFor) return false;

    if (this.poseIndex < this.poses.length - 1) {
      this.poseIndex += 1;
      return false;
    }
    return true;
  }

  _finish() {
    this.finished = true;
    const capture = {};
    this.poses.forEach((pose, index) => { capture[pose.id] = this.captures[index]; });
    this.result = fitThresholds(capture);
  }

  /**
   * Everything the UI needs to render the current step.
   *
   * `progress` is per pose, so a bar can fill twice rather than running once
   * across both poses and looking stuck.
   */
  snapshot(now = null) {
    const t = now === null ? this.clock() : now;
    const elapsed = this.startedAt === null ? 0 : t - this.startedAt;
    const poseStart = POSE_DURATION_MS * this.poseIndex;
    const poseElapsed = Math.max(0, Math.min(POSE_DURATION_MS, elapsed - poseStart));

    return {
      active: this.active,
      finished: this.finished,
      pose: this.pose,
      poseIndex: this.poseIndex,
      poseCount: this.poses.length,
      progress: this.startedAt === null ? 0 : poseElapsed / POSE_DURATION_MS,
      overallProgress: this.startedAt === null ? 0 : Math.min(
        1,
        elapsed / (POSE_DURATION_MS * this.poses.length)
      ),
      samples: this.captures[this.poseIndex].length,
      result: this.result
    };
  }
}
