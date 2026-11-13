# HOLOCORE — second upgrade pass

Branch: `arena/95168c29-holocore`, branched from `36a5863` on `main`.
Nothing here is merged to `main`; nothing was force-pushed.

This is the second pass over the same application. The first pass's report is
[`implementation-report.md`](implementation-report.md) and still describes what
that pass changed. This document covers only what changed here, and separates
what was **measured** from what was reasoned about.

Throughout: a measurement is something a program printed, on this machine,
against this commit. Anything that needed a browser, a webcam, a GPU or a
microphone is marked **unverified here** and listed in §H.

---

## A · Summary

Fifteen commits. The theme is that the hand pipeline was correct in the middle
and wrong at the edges: the filters, the solver and the renderer each did
something sensible, but the timestamps fed to them were wrong, the identities
they keyed on did not exist, and several features were unreachable from the UI.

The three defects with the largest user-visible effect:

| # | Defect | Measured effect |
|---|---|---|
| 1 | Milliseconds divided by 1000 twice before reaching the skeleton filters | **1 452 ms** real settling against **198 ms** after; the filter believed it ran at 1 000 Hz instead of 30.3 Hz |
| 2 | Two-hand movement used fixed world axes | In Left view a leftward two-hand drag moved the object towards the camera instead of left: `(x 0.62, z 0.00)` before, `(x 0.00, z −0.74)` after |
| 3 | Two-hand rotation trusted MediaPipe's array order | The same physical motion produced `−0.540` rad with the array in one order and `+0.900` rad reversed; `−0.540` for both after |

A fourth is worth naming because it was invisible for a different reason: the
Calibrate button threw `ReferenceError` on every press, because it assigned to
`hoverLock`, a binding that has never existed. No test called it, so no test
noticed. That class of defect now has a static check (§E, §15).

Each of these three was worse than the commit that fixed it claimed. The
timestamp commit described the double conversion correctly but did not measure
it; the two-hand commit said the rotation "flips by roughly 180 degrees", and it
does not — the frame that observes a reorder captures its reference angle between
the *opposite* pair of hands, so the reported rotation is measured against the
wrong pair for the rest of the gesture. That is 1.44 rad in the measurement
above: large and wrong, but not a flip. The commit messages are left as written;
the numbers in this report are what was actually measured.

---

## B · Tracking latency (§2)

### B.1 The timestamp was converted twice — `08c4ea7`

`startLoop()` converts the browser's millisecond clock to seconds once.
`processHands()` then divided by 1000 again before handing `now` to the skeleton
smoothers. Every filter in the chain was therefore told that samples 1 ms apart
were 1 ms apart, when the camera delivers them every 33 ms.

Measured by stepping a `OneEuroFilter` with the real base settings
(`minCutoff 2.2`, `beta 0.08`) and recording samples-to-90%:

| Case | Samples to settle | Wall-clock at 30 fps | Filter's believed rate |
|---|---|---|---|
| Correct: 33 ms stamps per 33 ms sample | 6 | **198 ms** | 30.3 Hz |
| Double-converted: 1 ms stamps per 33 ms sample | 44 | **1 452 ms** | 1 000 Hz |

The filter's *own* clock reported 44 ms in the broken case. It was not slow; it
was being lied to. This is the difference between "smoothing costs 200 ms" and
"the hands lag by a second and a half".

### B.2 Analysis ran once per display frame — `82b556b`

On a 120 Hz display the same 30 Hz observation was filtered four times, each with
a different display timestamp. That inflated the frequency estimate and made
smoothing machine-dependent. Analysis now runs once per camera observation and
duplicate display frames reuse the result (`state.analyzedSeq`).

### B.3 A slider that ran backwards — `82f82c9`

The old "smoothing" slider mapped its value onto `minCutoff` such that *more*
smoothing meant *less* filtering. It has been replaced by three named profiles
whose names are backed by measurement, produced by `node tools/tuneProfiles.mjs`:

| profile | step | stepMs | settleMs | overshoot | jitter | sweepErr | driftErr |
|---|---|---|---|---|---|---|---|
| responsive | 7 | 233 | 300 | 0.0000 | 0.0007 | 0.0126 | 0.0016 |
| balanced | 9 | 300 | 400 | 0.0000 | 0.0005 | 0.0281 | 0.0037 |
| precision | 10 | 333 | 467 | 0.0000 | 0.0004 | 0.0366 | 0.0050 |

The ordering is asserted, not the constants: a later retune cannot silently
invert the profiles. Two real tuning defects were caught by these assertions
during the first draft of the Precision profile — 667 ms settling and 4.3 × 10⁻⁵
overshoot — and were fixed by retuning, not by loosening the test.

### B.4 Per-observation cost, measured — `801525f`

Hover picking raycast the playground and the assembly twice per display frame,
including during drags where the result was discarded. Now guarded three ways:
skipped during a transform, skipped inside a 0.004 NDC dead band (~2.5 px), and
invalidated when the playground's prop set changes.

Measured by counting real `workspace.raycast` calls through the real pipeline:

| Situation | Raycasts |
|---|---|
| Pointer repeating the same position, 7 frames | 1 |
| Pointer jittering inside the dead band, 6 frames | 0 |
| Pointer making a real reach | 1 |
| During a drag, 6 frames | 0 |

---

## C · Correctness and identity (§4, §6)

### C.1 Hands had no identity — `7335607`

Three separate keying defects, all of which reduced a two-hand scene to one hand:

- analysers were keyed by the *handedness label*, so both hands shared one
  filter history whenever MediaPipe reported the same label twice, and a hand
  that lost its label got a new analyser;
- skeleton rigs were keyed by `side + array index`, so a reordered array reused
  the wrong rig's smoothing history;
- the depth path read `hand.key`, which never existed, so every hand resolved to
  `hand-0`.

`handIdentity.js` assigns a stable key per physical hand by greedily matching a
velocity-predicted palm centre (landmark 9) across frames, with a handedness
bonus and a 12-frame TTL so a hand that leaves briefly does not lose its history.

### C.2 Palm size reacted to rotation — `7335607`

Depth and gesture normalisation used a 3D palm span, which changes as the palm
turns. Measured on the same hand flat and rotated: 2D span **0.0647 → 0.0647**
(rotation-invariant), 3D span **0.0647 → 0.0695**. Gesture sizing now uses the
2D span; the 3D span is kept only where true depth is wanted.

### C.3 The controller lock never let go — `08c4ea7`

The lock was re-assigned on every update, so a hand that was merely hovering
claimed the controller permanently and the other hand could never take over. It
is now taken only by a real transform and released when the gesture ends — and,
from `2ff4d3b`, cleared by `_release()` as well, so it cannot outlive the gesture
that owned it.

---

## D · Setup, reach and honesty (§9, §10, §11, §14)

### D.1 Pinch calibration — `02d9a02`

The pinch thresholds were two constants chosen from one pair of hands. New
`calibration.js` records an open hand and a deliberate pinch, then fits a
threshold and a release value between the measured means.

It refuses rather than guesses. Three refusals, each with a sentence the user can
act on: `too-few-samples`, `too-noisy`, `poses-overlap`. A refusal leaves the
existing thresholds untouched; committing thresholds from bad data would leave a
gesture engine that is confidently wrong with no explanation.

Measured on synthetic poses: open 0.88 / pinch 0.24 produces threshold 0.611 and
release 0.483; the same fits applied to a weaker-signal hand (open 0.62 / pinch
0.18) produce 0.435 — a hardcoded pair would fail that assertion.

### D.2 Which hand drives — `d1e5479`

Four roles now exist (automatic, left, right, either). A role is not a filter:
excluded hands are still tracked, drawn and available for two-hand gestures; the
role only decides who holds the reticle. Two rules matter more than the menu — an
in-progress grab outranks the role, and a hand with an unknown handedness still
competes at reduced weight, because MediaPipe reports "Unknown" for hands it is
otherwise tracking confidently.

The solver narrows to eligible hands *before* applying its pinch preference, and
`pickPointer` now uses the same function instead of a private scoring loop that
could return a hand the solver had just excluded.

Configuration warnings were added for slider combinations that are legal but
self-defeating (detection confidence above tracking confidence; detection at 0.9;
one hand tracked while two-hand gestures exist). Each has a one-click fix.

### D.3 Views reachable from the keyboard — `3fa06a2`

Seven standard views existed; only three had shortcuts. All seven now do, from a
single map that also drives the tooltips. Fixing the tooltips exposed an
off-by-one: the digit was derived from the character's ASCII code, so `$` (36)
advertised "Shift+32".

### D.4 Tracking loss — `2ff4d3b`

A loss released the grab and every captured frame but left `activeKey` set, so
the controller lock named a hand that was no longer in the frame. The lock now
clears with the gesture. A loss also raises one toast with the likely cause and a
recovery raises a brief confirmation, instead of changing a status chip colour
and leaving the user to infer "the app has stopped working".

---

## E · What now prevents this happening again

### E.1 Diagnostics (§8) — `cb19af8`

The panel could say whether geometry was on screen but not whether hand data was
arriving, current or sane, so a frozen skeleton and a stationary hand looked
identical. It now reports nine live tracking values, two of which exist
specifically because of defects found in this pass: identity (missing keys are the
fingerprint of the §4.2 class) and observation lag (analysis falling behind the
camera reads as "the hands feel late" long before the frame rate drops).

### E.2 Static audit (§15) — `ae2bf6a`

`tools/audit.mjs` runs inside `validate:all --strict` and checks for calls to
functions defined nowhere, DOM ids `index.html` does not declare, and settings
keys the store does not have — the three shapes of the historical defects above.

Two bugs in the audit itself are worth recording, because both made it silently
useless rather than noisy. It blanked string literals before the DOM-id check ran,
so every `$("...")` had already had its id erased and the checker reported clean;
and it reported line numbers from a stripped copy whose length had changed. Both
are fixed, and the detectors are now proven to fire against injected bad input in
section 2k rather than merely reporting "clean".

---

## F · Test results

```
ALL 497 CHECKS PASSED  across 23 sections
ALL 80 ANATOMY CHECKS PASSED
ALL 107 UI CHECKS PASSED
ALL 48 BOOT CHECKS PASSED
ALL 447 FULL-STACK CHECKS PASSED
audit: clean
```

Full-stack was **329** at the start of this pass and is **447** now. New sections:

| Section | Checks | Covers |
|---|---|---|
| 2b | 4 | analysis once per observation |
| 2c | 18 | measured profile ordering |
| 2d | 9 | stable identities, 2D vs 3D span |
| 2e | 7 | hover raycast guards, malformed observations |
| 2f | 8 | diagnostics read from the live pipeline |
| 2g | 20 | calibration fit, refusals, state machine, persistence |
| 2h | 15 | hand roles through the real solver, config warnings |
| 2i | 31 | view shortcuts, hint/key agreement, camera tolerance, up vectors |
| 2j | 11 | tracking loss and recovery |
| 2k | 9 | the audit itself detects injected defects |
| 7 | 7 | a complete session, end to end, asserted non-vacuous |

The 2i count is high because it asserts each of the seven views twice — once as a
shortcut and once as a camera round-trip — plus the up-vector check per view.

Every one of these was written after the code it tests, and several found real
defects rather than confirming assumptions — the controller lock, the calibration
crash, and two tuning faults in the first Precision profile among them.

---

## G · Honest before / after

Only rows backed by a program's output are filled in. "Not measured" means
exactly that: no number was invented to fill the cell.

| Property | Before | After | How it was measured |
|---|---|---|---|
| Skeleton settling after a step (30 fps) | 1 452 ms | **198 ms** | filter step response, `bench` harness, this machine |
| Filter's believed sample rate | 1 000 Hz | **30.3 Hz** | same |
| Two-hand drag, Left view | `x 0.62, z 0.00` | `x 0.00, z −0.74` | solver update, camera on the +X axis |
| Two-hand rotation, array reversed | `+0.900` rad | **`−0.540` rad** | solver update, same physical motion |
| Model meshes redrawn in the late pass | 62 | **0** | section 5h, counting real `render()` calls |
| Hover raycasts, unchanged pointer, 7 frames | 7 | **1** | section 2e, counting real `raycast()` calls |
| Hover raycasts, inside the dead band, 6 frames | 6 | **0** | section 2e |
| Gesture sizing under palm rotation | 0.0647 → 0.0695 | **0.0647 → 0.0647** | section 2d, 2D vs 3D span |
| Views reachable by keyboard | 3 of 7 | **7 of 7** | section 2i |
| Calibrate button | threw on every press | **works** | section 2g |
| Full-stack checks | 329 | **447** | `npm run validate:all` |
| End-to-end drag distance, synthetic session | — | 2.15 units | section 7 |

### Not measured, and why

- **Frame time / FPS under load.** The sandbox has no GPU, so any figure here
  would be a CPU-rendered number that does not describe the user's machine.
- **Subjective tracking latency.** The filter numbers above are a model of the
  smoothing chain, not a stopwatch on a person's hand.
- **MediaPipe inference time.** It needs a browser with WASM and a camera.
- **Gesture recognition accuracy.** Section 5g covers the pinch curve as a
  function; it cannot cover a real hand in real lighting.

---

## H · What is still unverified here

No browser, GPU, webcam, microphone or audio device exists in this environment.
MediaPipe and Web Speech require `localhost` or HTTPS; voice needs Chrome or
Edge. Nothing in this pass was verified against a real camera, and the headless
tests do not validate rendering, only the data fed to it.

`docs/manual-verification.md` remains the checklist for the parts that need a
person. The items this pass adds to it:

1. Calibrate with a real hand. Confirm the fitted thresholds are near the old
   defaults, and that a deliberate "half-pinch" pose is refused rather than
   accepted.
2. Switch to Left-hand mode and confirm the reticle follows the left hand and
   that a two-hand gesture still works with both.
3. Press Shift+4 through Shift+7 and confirm Right, Left, Back and Bottom views.
4. Drag with two hands in Top view; confirm the object follows the hands instead
   of moving towards the camera.
5. Cover the camera for a second and confirm the loss toast, then uncover and
   confirm recovery.
6. Open the diagnostics panel and confirm it does not overlap the view cube.

---

## I · Known limitations

- The drag plane is frozen at gesture start, so a large orbit during a drag keeps
  the original screen basis until the hand is released. That is deliberate — the
  alternative is the object sliding as the camera moves — but it means a drag
  looks slightly off-square after a big camera move.
- View presets are within 7° of their axis; beyond that the indicator reads FREE.
  That is a deliberate trade of label stability against accuracy, and it means a
  small deliberate orbit will not keep the label.
- Calibration fits two poses only. A user whose pinch is asymmetric (thumb-side
  drag) is fitted to the average of their two poses, not to their asymmetry.
- The static audit is a smell detector. It cannot see runtime types, and a clean
  run is not evidence that the application works.
