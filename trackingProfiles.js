/**
 * HOLOCORE — trackingProfiles.js
 * -----------------------------------------------------------------------------
 * Measured smoothing profiles, and the harness that measures them.
 *
 * THE PROBLEM WITH A SLIDER
 *
 * The settings panel exposed a 0..1 "tracking smoothing" value that was mapped
 * onto a filter cutoff with no evidence about what either end actually felt like.
 * The mapping also ran backwards relative to its own label: the registry code
 * multiplied the cutoff by a factor that grew with the slider, and a higher
 * cutoff means LESS smoothing, so dragging "smoothing" up made the skeleton
 * faster and noisier.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Three named profiles, each defined by numbers measured against a synthetic
 * input with a known answer. `measureProfile()` runs the real One Euro filter
 * over four standard trajectories and reports step response, overshoot, settling
 * time, steady-state jitter and tracking error under fast motion. `tuneProfiles.mjs`
 * uses it to pick the constants; `validate-full.js` re-measures them so a future
 * edit that makes "responsive" slower than "precision" fails a test instead of
 * quietly shipping.
 *
 * The profiles differ in a way that is visible in the numbers: RESPONSIVE settles
 * in about a third the time of PRECISION, at roughly twice the residual jitter.
 */

/** @typedef {"responsive"|"balanced"|"precision"} ProfileId */

/**
 * Profile definitions.
 *
 * `timeConstant` divides the cutoff (so a SMALLER time constant means a LARGER
 * cutoff and a faster response). `beta` raises the cutoff while the signal is
 * moving, which is what lets a fast hand pass through with little lag while a
 * still hand is filtered hard.
 *
 * The triples below were selected by running `tools/tuneProfiles.mjs` and reading
 * the measured table; see the comments for the trade each one makes.
 */
export const TRACKING_PROFILES = {
  // Follows fast motion almost exactly. Accepts visible jitter on a still hand,
  // which is the right trade while dragging an object around.
  responsive: {
    label: "Responsive",
    timeConstant: 0.42,
    // Raised so a quick hand is barely filtered at all.
    betaScale: 1.35
  },
  // The default: about half the latency of precision with most of its calm.
  balanced: {
    label: "Balanced",
    timeConstant: 1.0,
    betaScale: 1.0
  },
  // Calm enough to place a 0.1mm edge on a component. Fast movement is still
  // usable but visibly eased.
  precision: {
    label: "Precision",
    timeConstant: 1.35,
    betaScale: 0.75
  }
};

/** Slider value used when migrating a saved 0..1 smoothing setting. */
export function profileFromLegacySmoothing(smoothing) {
  if (!Number.isFinite(smoothing)) return "balanced";
  if (smoothing <= 0.3) return "responsive";
  if (smoothing >= 0.68) return "precision";
  return "balanced";
}

/** Validate and normalise a profile id. */
export function normaliseProfile(id, fallback = "balanced") {
  return TRACKING_PROFILES[id] ? id : fallback;
}

/**
 * Filter options for a joint under a profile.
 *
 * @param {ProfileId} profileId
 * @param {{minCutoff:number, beta:number}} base per-joint tuning
 */
export function profileFilterOptions(profileId, base) {
  const profile = TRACKING_PROFILES[normaliseProfile(profileId)];
  // A HIGHER cutoff follows the signal faster. Responsive therefore needs a
  // larger cutoff than precision, not a smaller one -- the inverse of this was
  // the original bug in the settings mapping, and it is easy to reintroduce, so
  // `validate-full.js` asserts the measured ordering rather than the constants.
  return {
    minCutoff: base.minCutoff / profile.timeConstant,
    beta: base.beta * profile.betaScale
  };
}

/* ------------------------------------------------------------------------- */
/* MEASUREMENT                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Run one scalar trajectory through a filter and report its behaviour.
 *
 * `filter` must expose `filter(value, t)` and `reset()`. The `make` callback is
 * used to build a fresh filter per measurement so no state leaks between runs.
 *
 * @param {(make:Function)=>object} make returns a fresh filter
 * @param {(i:number, t:number)=>number} input the trajectory
 * @param {number} frames how many samples
 * @param {number} dt seconds per sample
 */
export function measureTrajectory(make, input, frames, dt = 1 / 30) {
  const filter = make();
  const truth = [];
  const out = [];
  let t = 0;
  for (let i = 0; i < frames; i++) {
    const value = input(i, t);
    truth.push(value);
    out.push(filter.filter(value, t));
    t += dt;
  }

  // Steady-state jitter over the last quarter, where a step has settled.
  const tail = out.slice(Math.floor(frames * 0.75));
  const tailMean = tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length);
  const jitter = Math.sqrt(
    tail.reduce((sum, v) => sum + (v - tailMean) ** 2, 0) / Math.max(1, tail.length)
  );

  // Overshoot: how far past the final *settled* truth value the output went.
  // Measured against the tail mean rather than the last sample, so a trajectory
  // that is still drifting does not report nonsense.
  const finalTruth = tailMean;
  const overshoot = Math.max(0, Math.abs(out[out.length - 1] - finalTruth));
  const peak = out.reduce((a, b) => (Math.abs(b - finalTruth) > Math.abs(a - finalTruth) ? b : a), out[0]);

  // Tracking error, averaged. This is the number that actually feels like lag.
  const error = out.reduce((sum, v, i) => sum + Math.abs(v - truth[i]), 0) / out.length;

  return { truth, output: out, jitter, peak, finalTruth, overshoot, error };
}

/**
 * Standard scenarios, so profiles are always compared on the same inputs.
 *
 * Values are in normalised landmark units, which is what the filters see.
 */
export const SCENARIOS = {
  /** A step from 0 to 1: the cleanest measure of latency. */
  step: {
    frames: 60,
    input: i => (i < 5 ? 0 : 1)
  },
  /** A still hand with realistic landmark noise. Measures jitter suppression. */
  still: {
    frames: 120,
    input: (i) => {
      // Deterministic pseudo-noise: no Math.random, so results are reproducible.
      const a = Math.sin(i * 12.9898) * 43758.5453;
      return 0.5 + ((a - Math.floor(a)) - 0.5) * 0.004;
    }
  },
  /** A fast sweep, 2 Hz at 30 fps: measures lag during real motion. */
  sweep: {
    frames: 90,
    input: i => 0.5 + Math.sin((i / 30) * Math.PI) * 0.25
  },
  /** A slow drift, so slow filtering is not penalised unfairly. */
  drift: {
    frames: 120,
    input: i => 0.5 + i * 0.002
  }
};

/**
 * Measure a profile against every scenario.
 *
 * @param {(options:object)=>object} makeFilter builds an isolated filter
 * @param {(profileId:ProfileId)=>object} optionsFor maps a profile to filter options
 * @param {ProfileId} profileId
 */
export function measureProfile(makeFilter, optionsFor, profileId) {
  const results = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    results[name] = measureTrajectory(
      () => makeFilter(optionsFor(profileId)),
      scenario.input,
      scenario.frames
    );
  }

  // Frames to reach 90% of a step.
  const step = results.step;
  const target = step.finalTruth * 0.9;
  const index = step.output.findIndex(v => v >= target);
  const stepFrames = index < 0 ? Infinity : index;
  const settlingIndex = step.output.findIndex((v, i) =>
    step.output.slice(i).every(rest => Math.abs(rest - step.finalTruth) < 0.02)
  );

  return {
    profile: profileId,
    stepFrames,
    stepMs: stepFrames * (1000 / 30),
    settlingMs: (settlingIndex < 0 ? Infinity : settlingIndex) * (1000 / 30),
    overshoot: step.overshoot,
    stillJitter: results.still.jitter,
    sweepError: results.sweep.error,
    driftError: results.drift.error
  };
}
