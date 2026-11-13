/**
 * Measure the tracking profiles and print the table the constants were chosen
 * from. Run with `node tools/tuneProfiles.mjs`.
 *
 * This exists so the profile numbers are reproducible rather than asserted.
 */
import { OneEuroFilter } from "../gestures.js";
import { measureProfile, TRACKING_PROFILES, profileFilterOptions } from "../trackingProfiles.js";

// Wrist tuning, the base every joint scales from.
const BASE = { minCutoff: 2.5, beta: 0.10 };

const make = options => new OneEuroFilter(options);
const optionsFor = profile => profileFilterOptions(profile, BASE);

console.log("profile      step   stepMs  settleMs  overshoot  jitter   sweepErr  driftErr");
console.log("─".repeat(78));
for (const id of Object.keys(TRACKING_PROFILES)) {
  const m = measureProfile(make, optionsFor, id);
  console.log(
    id.padEnd(12),
    String(m.stepFrames).padStart(4),
    m.stepMs.toFixed(0).padStart(7),
    (Number.isFinite(m.settlingMs) ? m.settlingMs.toFixed(0) : "inf").padStart(9),
    m.overshoot.toFixed(4).padStart(10),
    m.stillJitter.toFixed(4).padStart(8),
    m.sweepError.toFixed(4).padStart(9),
    m.driftError.toFixed(4).padStart(9)
  );
}
