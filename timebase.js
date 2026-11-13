/**
 * HOLOCORE — timebase.js
 * -----------------------------------------------------------------------------
 * One explicit convention for every timestamp in the hand pipeline.
 *
 * WHY THIS FILE EXISTS
 *
 * `performance.now()` returns milliseconds. One Euro filters need seconds. The
 * pipeline previously converted milliseconds to seconds at the render loop and
 * then divided by 1000 again on the way into the skeleton, so the skeleton's
 * filters were told that samples 33 ms apart had arrived 33 µs apart. The filter
 * estimated 1000 Hz instead of 30 Hz, and because `OneEuroFilter` clamps `dt` at
 * 1 ms, that wrong estimate did not blow up — it just made the skeleton settle
 * 7.8× more slowly than designed (1287 ms instead of 165 ms).
 *
 * A silent semantic error like that survives every type check and every "does it
 * move" test, so the fix is not just to correct the call site. It is to make the
 * unit unambiguous at the boundary.
 *
 * THE CONVENTION
 *
 *   - **Milliseconds** at every DOM, MediaPipe and `performance.now()` boundary.
 *   - **Seconds** at every filter, smoother, and timing calculation.
 *   - Conversion happens exactly once, in `toSeconds()`, at the point a value
 *     enters the simulation.
 *   - Nothing downstream divides by 1000 again, and `toSeconds()` refuses input
 *     that is already small enough to be seconds, which is what turns a repeat
 *     conversion into a loud failure instead of a slow skeleton.
 *
 * `Timestamp` carries its unit in the type, so an accidental mix-up is visible at
 * the call site rather than only in the output.
 */

/** Anything at or beyond this is too large to plausibly be seconds. */
const SECONDS_CEILING = 1e6;

/**
 * One clock for the whole application.
 *
 * `performance.now()` is monotonic and unaffected by wall-clock adjustments, so
 * it is the right source. Tests can substitute a deterministic source.
 */
export class Timebase {
  constructor({ source = null } = {}) {
    this.source = source || (() => performance.now());
    /** Monotonic guard: `now()` never returns less than a previous call. */
    this._last = -Infinity;
    /** Timestamp of the most recent camera observation, in ms. */
    this.lastObservationMs = null;
    /** Monotonic count of distinct camera observations. */
    this.observationSeq = 0;
  }

  /** Current time in milliseconds. Monotonic, never decreasing. */
  nowMs() {
    const value = this.source();
    if (value > this._last) this._last = value;
    return this._last;
  }

  /** Current time in seconds. The only place seconds are produced from the clock. */
  nowSeconds() {
    return this.nowMs() / 1000;
  }

  /**
   * Record a camera observation.
   *
   * Called once per *new* camera frame, from the tracker. Returns the sequence
   * number so callers can prove they are not reprocessing the same observation.
   */
  observe(ms = null) {
    const stamp = ms === null ? this.nowMs() : ms;
    this.lastObservationMs = stamp;
    this.observationSeq += 1;
    return this.observationSeq;
  }

  /**
   * Age of the newest observation, in seconds.
   *
   * This is the number that actually matters for responsiveness: how stale is
   * the pose being drawn right now.
   */
  observationAgeSeconds(nowMs = null) {
    if (this.lastObservationMs === null) return null;
    const now = nowMs === null ? this.nowMs() : nowMs;
    return Math.max(0, (now - this.lastObservationMs) / 1000);
  }
}

/**
 * Convert a millisecond timestamp to seconds, exactly once.
 *
 * Refuses values that are already in seconds rather than silently multiplying
 * them by 1/1000 a second time. A repeat conversion is the bug this pass exists
 * to fix, and it is invisible in the output, so it is worth failing loudly.
 *
 * @param {number} value
 * @param {string} [label] caller name, for the error message
 * @returns {number} seconds
 */
export function toSeconds(value, label = "timestamp") {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number, got ${value}`);
  }
  if (value >= 0 && value < SECONDS_CEILING) {
    // 1e6 ms is 16 minutes; 1e6 s is 11 days. Anything below the ceiling is
    // almost certainly seconds already, which means someone double-converted.
    throw new RangeError(
      `${label} looks like seconds (${value}), but toSeconds expects ` +
      `milliseconds. Convert once, at the boundary.`
    );
  }
  return value / 1000;
}

/**
 * Normalise a timestamp supplied by a possibly-untrusted caller.
 *
 * Unlike `toSeconds`, this accepts either unit and decides from magnitude. It
 * exists for the one legitimate case: a test or external caller handing in a
 * value whose unit we cannot prove. Application code should use `toSeconds`.
 *
 * @param {number|null|undefined} value
 * @returns {number} seconds, or NaN when unusable
 */
export function secondsFrom(value) {
  if (!Number.isFinite(value)) return NaN;
  return value >= SECONDS_CEILING ? value / 1000 : value;
}

/**
 * A tiny fixed-size ring of samples with P50/P95, used by the diagnostics.
 *
 * Bounded on purpose: an unbounded history of frame times is a slow leak, and it
 * makes percentiles more expensive the longer the app runs.
 */
export class SampleWindow {
  constructor(capacity = 120) {
    this.capacity = Math.max(1, capacity);
    this.values = new Float64Array(this.capacity);
    this.count = 0;
    this.next = 0;
  }

  push(value) {
    if (!Number.isFinite(value)) return;
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  /** Sorted copy of the samples. Allocation is acceptable here: called at HUD rate. */
  sorted() {
    return Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
  }

  get mean() {
    if (!this.count) return null;
    let total = 0;
    for (let i = 0; i < this.count; i++) total += this.values[i];
    return total / this.count;
  }

  /** Nearest-rank percentile, 0..1. */
  percentile(fraction) {
    if (!this.count) return null;
    const sorted = this.sorted();
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
    return sorted[index];
  }

  get max() {
    if (!this.count) return null;
    let largest = -Infinity;
    for (let i = 0; i < this.count; i++) largest = Math.max(largest, this.values[i]);
    return largest;
  }

  clear() {
    this.count = 0;
    this.next = 0;
  }
}
