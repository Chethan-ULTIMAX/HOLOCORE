# HOLOCORE

**A spatial engineering workspace for inspecting, exploding and manipulating 3D mechanical assemblies.**

HOLOCORE runs entirely in the browser. It ships eight procedurally generated engineering
assemblies — a launch vehicle, a turbojet, an inline-4 engine, a gear train, a 6-axis robot,
a PCB, a CPU package and a wind turbine — each split into individually inspectable parts with
real engineering notes. You can orbit it with the mouse, grab parts with your hand via webcam,
or ask the built-in assistant questions about what you are looking at.

No build step. No CDN. No network required at runtime.

---

## Quick start

```bash
git clone https://github.com/Chethan-ULTIMAX/HOLOCORE.git
cd HOLOCORE
npm install          # three + jsdom (jsdom is only needed for the test harnesses)
npm start            # serves on http://localhost:8000
```

Open <http://localhost:8000>. Allow the camera when prompted if you want gesture control.

> **The camera needs a secure context.** `http://localhost` counts as secure; a plain
> `http://192.168.x.x` address does not. The app detects this and disables gesture
> tracking with an explanation rather than failing silently.
> If WebGL is unavailable the app still loads: the library, inspector, assistant and all
> non-3D controls work, and the status bar reports exactly why 3D is off.

| Command | What it does |
| --- | --- |
| `npm start` | Static server on port 8000, bound to `0.0.0.0` |
| `npm run validate` | 206 headless checks: data, geometry, gestures, solver, assistant, wiring, 3D workspace |
| `npm run validate:ui` | 44 jsdom checks of the DOM and interface behaviour |
| `npm run validate:boot` | 23 jsdom checks of the full application boot path |
| `npm run validate:all` | All three harnesses |
| `npm run preview` | Renders the eight assemblies to `tools/preview/*.png` |
| `npm run preview:parts` | Same, but each part in its own colour (`*-parts.png`) |

---

## The model library

Every assembly is built from parametric geometry at load time — there are no `.glb` files to
download. Assemblies are authored as **engineering cutaways**: casings are half-shells, engine
blocks are open-fronted, and lids are cut back, so the parts that matter are visible instead
of buried inside an opaque box.

| Model | Category | Parts | What the cutaway exposes |
| --- | --- | --- | --- |
| Astra-9 Launch Vehicle | Aerospace | 13 | Interstage truss, thrust structure, turbopump, gimbal |
| Single-Spool Turbojet | Aerospace | 11 | Compressor stages, annular combustor, turbine stages, shaft |
| Inline-4 Automotive Engine | Automotive | 13 | Liners, pistons, rods, crank, valve train, cams |
| Spur Gear Train | Mechanical | 8 | Three meshing gears, bearings, oil circuit, inspection cover |
| 6-Axis Industrial Robot | Robotics | 9 | Harmonic drive, shoulder/elbow joints, wrist stack, harness |
| Control Board (PCB) | Electronics | 9 | MCU, buck converter, crystal, headers, antenna, LEDs |
| CPU Package | Computing | 7 | Die, TIM layer, LGA pads, decoupling caps, retention frame |
| Utility Wind Turbine | Industrial | 10 | Gearbox, generator, yaw drive, pitch actuators, hub |

Each part carries a name, category, function, working principle, role in the system, specs,
materials, related parts, failure mode and teaching notes. The assistant, the inspector and
the "learn" drawer all read from that single knowledge base (`engineeringData.js`).

---

## Interaction

### Mouse

Orbit (drag), zoom (wheel), select (click). Buttons for explode, isolate, focus, reset.

### Hand tracking

Press <kbd>C</kbd> or click **Enable camera**. MediaPipe HandLandmarker runs locally in the
browser (WASM + model are vendored) and produces 21 landmarks per hand, 30×/second.

| Gesture | Result |
| --- | --- |
| Pinch (thumb + index touch) | Grab the object under your pinch and move it |
| Two-handed pinch | Scale and rotate the object |
| Open palm, then push | Framing mode: reframe the assembly |

Gestures are gated behind a hysteresis threshold and a One Euro filter, so the object does not
jitter or re-grab while your hand is half-open. A grab captures a reference frame on the frame
it starts, which is why the object never jumps to your fingertip.

### Keyboard

<kbd>C</kbd> camera · <kbd>L</kbd> panels · <kbd>F</kbd> fullscreen · <kbd>S</kbd> settings ·
<kbd>A</kbd> assistant · <kbd>R</kbd> reset view · <kbd>E</kbd> explode · <kbd>I</kbd> isolate ·
<kbd>G</kbd> grid · <kbd>?</kbd> help · arrows move · <kbd>Q</kbd>/<kbd>W</kbd> depth ·
<kbd>Z</kbd>/<kbd>X</kbd> roll

### Assistant

Ask questions in the input at the bottom right: *"what cools the turbine blades"*,
*"why does the gear train need an idler"*, *"compare the die and the TIM layer"*. The assistant
matches your question against the model's own knowledge base and can select a part or load a
model in response. It is **retrieval over authored data, not a language model** — it cannot
answer questions outside the 80 documented parts, and it says so when it cannot.

You can also import your own `.glb`/`.gltf` assembly from the left panel; every mesh becomes an
inspectable part, with generic metadata.

---

## Architecture

```
index.html          shell: panels, modals, canvas, import map
styles.css          interface styling
main.js             boot, wiring, settings, import flow, failure paths
modelManager.js     the 3D workspace: renderer, controls, parts, selection, explode
modelFactory.js     procedural geometry for the eight assemblies
engineeringData.js  the knowledge base (8 models, 80 parts)
gestures.js         landmark analysis, filters, one/two-hand manipulation solver
handTracking.js     camera lifecycle, MediaPipe wrapper
componentInspector.js  the right-hand inspector
assistant.js        entity matching and contextual answers
animations.js       eased transitions
handOverlay.js      landmark skeleton overlay
store.js            tiny observable state container
ui/markdown.js      shared safe markdown renderer
vendor/             three.js, MediaPipe, fonts (pinned, offline)
tools/              test harnesses and the software preview renderer
```

Design rules that are enforced by the harnesses:

- **`modelManager.js` never imports a renderer or controls directly** — they are injected, which
  is what lets the whole workspace be driven headlessly in `tools/validate.js`.
- **`AssemblyBuilder` has two layout conventions.** Parts authored in part-local coordinates get
  centred; cutaway assemblies authored in one shared coordinate space set `absoluteLayout = true`
  so their sub-meshes keep the coordinates they were written at.
- **Positions are animated, not assigned.** `part.position` is a target; `workspace.update(dt)`
  lerps toward it. Nothing teleports.
- **Boot degrades honestly.** Every non-3D control is wired before the WebGL probe, so a GPU
  failure costs you the viewport but not the application.

---

## Verification

Everything in `tools/` runs headlessly in Node — there is **no browser and no GPU in the loop**,
which is both the point and the limitation.

```bash
npm run validate:all      # 206 + 44 + 23 checks
npm run validate          # data, geometry, gestures, solver, assistant, wiring, 3D workspace
```

| Harness | Checks | Covers |
| --- | --- | --- |
| `tools/validate.js` | 206 (8 sections) | Knowledge-base coverage both ways, assembly geometry sanity, gesture primitives against a forward-kinematics fixture, the manipulation solver, assistant retrieval, every element in `index.html` being wired, the real `Workspace` driven through a stub renderer |
| `tools/validate-ui.js` | 44 | DOM behaviour in jsdom: panels, sliders, toasts, keyboard, markdown safety |
| `tools/validate-boot.js` | 23 | The full application boot in jsdom, including the degraded no-WebGL path |
| `tools/render-preview.js` | — | A software rasteriser that renders the *real* scene graph through the *real* camera to PNG |

The preview renderer exists because visual defects do not show up in assertions. It is what
caught the two worst bugs in this codebase:

1. `Object3D.add()` returns the **parent**, so every `group.add(mesh).position.set(...)` was
   silently moving the entire part instead of the mesh. Every cutaway assembly had collapsed.
2. Material colours are stored **linear** by three.js, so writing them straight to 8-bit gave
   black-on-black interiors.

Section 8 of `validate.js` is a regression guard for the first one: it greps for chained
transforms, checks every part for a non-empty and non-coincident bounding box, checks the
launch vehicle stacks without gaps, and checks the turbine rotor spans a disc rather than a
column.

### What is *not* verified

Be clear about this before trusting the green checkmarks:

- **WebGL rendering.** No GPU here. The scene graph, camera math and materials are tested; the
  actual shaded output of the real `WebGLRenderer` is not. `render-preview.js` is a separate
  approximation, not three.js.
- **Camera and hand tracking.** No webcam, and MediaPipe's WASM runtime cannot execute here.
  Gesture *math* is tested against synthetic forward-kinematics hands; whether your webcam
  produces good landmarks is not something this repo can prove.
- **Cross-browser behaviour.** Tested with Node and jsdom only. Safari's webcam permissions and
  iOS gesture handling are untested.
- **The assistant's judgement.** Retrieval is tested for correct part selection on curated
  questions. Whether its prose is *good* is an editorial question, not a test.

---

## Honest limitations

- Assemblies are **procedural approximations**, not CAD. Proportions are chosen to read
  correctly and to teach, not to be manufacturable.
- The knowledge base is written for education. The specs are representative of the class of
  machine, not certified figures for a specific unit.
- Scale is normalised to a 6.2-unit envelope, so "metres" only appear in the written specs.
- No persistence: settings and imports reset on reload.
- Mobile gets the layout but hand tracking is effectively desktop-only.

## Tech

Three.js 0.187 (vendored), MediaPipe Tasks Vision 0.10.14 (vendored), plain ES modules, no
framework and no bundler. Tests use Node's built-in test-free assertion style plus jsdom.

## Licence

No licence file is present; the source is public for reference. Third-party assets in `vendor/`
retain their own licences (three.js — MIT; MediaPipe — Apache 2.0; fonts — as noted in
`vendor/fonts`).
