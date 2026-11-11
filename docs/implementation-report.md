# HOLOCORE — hand-control improvement pass

Branch: `arena/79b5a57d-holocore`, branched from `d644068` on `main`.
Nothing here is merged to `main`; nothing was force-pushed.

This was an improvement pass on the existing application, not a rebuild. The
architecture, Three.js, MediaPipe, the voice system, the skeleton's neon-cyan
identity, the model library, the inspector, the sidebars and the local dev setup
are all still the ones that were there before.

---

## What was actually wrong

Five things made hand control feel like "a 3D app that reacts to hands" rather
than a place to work:

1. **The skeleton was mirrored.** A right hand was drawn as a left hand.
2. **Nothing decided which hand was in charge.** Two hands produced an
   order-dependent result, and two open palms triggered a scale gesture.
3. **Dragging used fixed world axes.** In Top view, dragging up moved the object
   towards the camera, where it visibly did nothing.
4. **There was no honest way to move in depth.** Landmark `z` was being treated
   as a distance, which is what made objects lurch forward and back when a hand
   merely rotated.
5. **Camera framing was fixed.** Every view assumed the origin.

## What was done, in phase order

Phase order follows the brief: correctness, then gestures, then camera, then
manipulation, then polish, then regression.

### Phase 1 — correctness (§2) `aa27f86`

`handCoordinates.js` is now the single coordinate contract. Mirroring is applied
once, to metric offsets, and never to the anchor. 80 numerical checks across 9
sections.

### Phase 2 — gestures (§7, §8, §10)

- **§8 smoothing** `e1c6dc0` — `handSmoothing.js`: a One Euro filter per joint per
  axis per hand, 21 joints × 3 axes. Tuned by measurement, not by feel: settled on
  wrist 2.2/0.08, joint 2.5/0.10, tip 3.0/0.12, reaching 90% of a step in 4
  frames (133 ms) at 30 fps with roughly half the jitter. Cost ≈ 0.03 ms/frame.
- **§7 active hand** `32bff69` — `resolveActiveHand()` is the one rule, shared by
  the solver and by `pickPointer()`. A locked hand keeps the role so a drag can
  never swap hands mid-gesture; a pinching hand wins over a hovering one;
  otherwise the first tracked hand only ever hovers. Two open palms no longer
  grab: two-hand mode requires `bothPinched || deliberate frame pose`. SCALE and
  EXPLODE remain genuinely two-handed.
- **§10 idle animation** `e23090c` — the spin stops while manipulating or
  selected and resumes from where it stopped, without a snap. Found and fixed a
  real leak: hover gestures were marking the object as "manipulating", freezing
  every idle animation.

### Phase 3 — camera (§3) `4b5c106`

`cameraViews.js` is pure maths so it can be asserted numerically.
Seven presets, smooth transitions, and correct up vectors: Top uses world −Z and
Bottom uses +Z, so both are level plan views. Pointing a camera straight down with
the default up of `(0,1,0)` makes the view direction parallel to up, the camera
basis collapses, and OrbitControls rolls arbitrarily — `safeUp()` guards it. Up is
interpolated alongside position so the model does not roll during a move.

Presets frame the selection, else the model; a prop parked at x=3 is centred, not
the model behind it. OrbitControls keep working, and the indicator clears as soon
as the user orbits freely.

The controller is a **cube net**, not a 3D-transformed cube. The first version
overlaid seven transformed faces, which put the ISO button on top of FRONT and
made the front face unclickable — found by rendering it.

### Phase 4 — manipulation (§4, §5, §6)

- **§4 camera-relative dragging** `75eaf70` — a grab captures the camera basis,
  the grab depth and the grab point; every later frame converts pointer movement
  into that captured screen frame. Right is right on screen: +X in Front, +X in
  Top, +Z in Left, correct at any orbited angle. The basis is captured once, so
  moving the camera mid-drag cannot slide the object under the hand. The old
  fixed-multiplier path survives only as a documented fallback for callers with
  no camera.
- **§5 gizmo** `87feac5` — three axis handles and three plane handles on the
  selection. Expressed as rays, not DOM events, so mouse and hand run the
  identical constraint code. Axis drags solve closest approach of the pointer ray
  to the axis line; plane drags intersect the coordinate plane. A ray parallel to
  the axis is refused rather than producing a huge number. Constant on-screen
  size, hidden with no selection, picks taken in the capture phase ahead of
  OrbitControls.
- **§6 depth** `8f92dff` — apparent palm size, not landmark z. Relative,
  calibrated at activation, with a dead zone, sensitivity wired to the existing
  `depthSensitivity`, smoothing, clamping, deliberate six-frame activation on an
  open palm, and a reset on tracking loss. Per-hand state, so two hands do not
  share a reference.

### Phase 5 — performance (§11) `5f06215`

The palm plate allocated a new `BufferGeometry` per hand per frame and disposed
the old one: 60 GPU buffer allocations a second for a six-vertex fan whose size
never changes. It is now built once and mutated in place, with normals computed
analytically from the palm plane. There are checks proving the geometry is
identical after 60 animated frames while its contents still follow the hand.

## Files changed, and why

| File | Change | Reason |
|---|---|---|
| `handCoordinates.js` | **new** | Single coordinate contract. Mirroring applied once, to offsets. |
| `handSmoothing.js` | **new** | Per-joint One Euro filtering, time-aware. §8. |
| `cameraViews.js` | **new** | Pure view maths: directions, ups, framing distance, matching. §3. |
| `dragPlane.js` | **new** | Camera-relative drag plane with a frozen camera basis. §4. |
| `gizmo.js` | **new** | XYZ gizmo, ray-driven so both input devices share it. §5. |
| `handDepth.js` | **new** | Calibrated palm-size depth gesture. §6. |
| `gestures.js` | patched | `resolveActiveHand`, `orderByActive`, two-hand gating, `_translateTo`, per-hand `size`. §4, §7, §9. |
| `handSkeleton3d.js` | patched | Smoothers, `updateSettings`, reusable palm geometry and scratch vectors. §8, §11. |
| `modelManager.js` | patched | `framingBounds`/`setView`/`activeView`/`centreOnSelection`, camera up interpolation, gizmo plumbing, capture-phase pointer handling. §3, §5. |
| `main.js` | patched | View cube wiring and shortcuts, camera+pointer into the solver, gizmo sync and drag for mouse and hand, depth gesture driver, `videoSize` fallback. §3–§6. |
| `playground.js` | patched | Idle spin yields to the user and resumes without a jump. §10. |
| `index.html` | +22 | View cube markup. §3. |
| `styles.css` | +118 | View cube styling, active state, small-screen rules. §3, §12. |
| `tools/validate.js` | +178 | Sections 3x (active hand) and 19b (no per-frame allocation). |
| `tools/validate-anatomy.js` | **new** | 80 numerical anatomy checks. |
| `tools/validate-full.js` | +693 | Sections 5q/5r/5s/5t and a real layout for the harness. |
| `tools/fixtures/hands.mjs` | **new** | Asymmetric synthetic hands in both MediaPipe spaces. |
| `tools/visual/layout-preview.mjs` | +69 | Draws the view cube so layout can be seen, not just asserted. |
| `package.json` | +6 | `validate:anatomy` in the chain; `@napi-rs/canvas` for the preview tools. |

`voiceControl.js`, `chimes.js`, `animations.js`, `engineeringData.js`,
`modelFactory.js` and `store.js` were **not touched**.

## Test results

```
ALL 497 CHECKS PASSED  across 23 sections
ALL 80 ANATOMY CHECKS PASSED
ALL 100 UI CHECKS PASSED
ALL 48 BOOT CHECKS PASSED
ALL 295 FULL-STACK CHECKS PASSED
```

Baseline before this pass: 476 / 100 / 48 / 161. So **+21, +80 new suite, +147**
checks, none of them edits to existing assertions to make failures disappear.

## Bugs found by tests, not by inspection

- The depth gesture's armed branch never reported `active`, so travel would never
  have been applied.
- `videoSize()` returned 0×0 before the first video frame, collapsing the
  cover-fit and mapping every landmark to one corner of the screen.
- The drag pointer came from the first tracked hand rather than the controlling
  one, so with both hands up the object moved by the wrong amount.
- Hover gestures marked the object as manipulating, freezing all idle animation.
- The gizmo's isometric face covered the front face, making it unclickable.

## Honest disclosure

**Not tested, and cannot be here:** real webcam input, MediaPipe inference in a
browser, GPU rendering, audio output, and real pointer/touch events. This
environment has none of them (`playwright install chromium` fails). MediaPipe and
Web Speech also need `localhost` or HTTPS, and voice needs Chrome or Edge.

**What was tested instead:** the real `main.js` booted in jsdom against the real
3D workspace, driven through the real `processHands` with synthetic landmarks;
numeric assertions over every new module; and rendered previews of the layout and
the skeletons, inspected by eye.

`docs/manual-verification.md` is the checklist for the parts that need a human.

## Remaining limitations

- An axis pointing straight at the camera cannot be dragged from that angle; the
  handle refuses instead of flinging the object.
- Depth by hand is a relative proxy that needs a deliberate pose, and it moves
  playground props only.
- No orthographic camera: optional per the brief, and the hand projection assumes
  perspective.
- Smoothing costs about 100 ms of latency by design.

## Definition of done

The work is complete against the brief's phases: correctness, gestures, camera,
manipulation, polish, regression. Every item is implemented, every suite is green,
and the parts that need a webcam are named above rather than claimed.
