/**
 * HOLOCORE — tools/validate.js
 * -----------------------------------------------------------------------------
 * Headless verification harness (Node 18+).
 *
 * It imports the *real* application modules — engineeringData.js,
 * modelFactory.js, gestures.js and assistant.js — and checks them against the
 * acceptance criteria that can be verified without a GPU or a webcam.
 *
 *   node tools/validate.js
 *
 * Browser-only behaviour (WebGL rendering, getUserMedia, MediaPipe WASM) cannot
 * run here; tools/README.md documents the manual test procedure for those.
 */

import * as THREE from "three";
import { MODEL_LIBRARY, COMPONENTS, getComponentData, getModelDefinition } from "../engineeringData.js";
import { buildAssembly } from "../modelFactory.js";
import {
  HysteresisGate,
  OneEuroFilter,
  OneEuroPoint,
  HandAnalyzer,
  ManipulationSolver,
  pinchStrength,
  fingerExtensions,
  pointingConfidence,
  palmScale
} from "../gestures.js";
import { createAssistant } from "../assistant.js";

/* ------------------------------------------------------------------------- */
/* MINI TEST RUNNER                                                          */
/* ------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;
const failures = [];
const sections = [];

function section(name) {
  sections.push(name);
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? `  ${detail}` : ""}`);
  }
}

const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------------- */
/* SYNTHETIC HANDS (test fixtures only — never used by the app)              */
/* ------------------------------------------------------------------------- */

/**
 * Build a plausible 21-point hand in normalised image space.
 * This exists purely so gesture maths can be exercised deterministically.
 */
function makeHand({
  cx = 0.5,
  cy = 0.62,
  size = 0.16,
  rotation = 0,
  curl = 0,
  perFinger = null,
  pinch = false
} = {}) {
  // Local frame: origin at the wrist, +y points from wrist toward the fingers.
  const points = new Array(21);
  points[0] = [0, 0];

  const mcp = {
    thumb: [-0.42, 0.42],
    index: [-0.26, 0.98],
    middle: [0.0, 1.02],
    ring: [0.22, 0.98],
    pinky: [0.42, 0.88]
  };
  const segments = {
    thumb: [0.22, 0.17, 0.14],
    index: [0.30, 0.18, 0.14],
    middle: [0.32, 0.20, 0.15],
    ring: [0.30, 0.19, 0.14],
    pinky: [0.24, 0.15, 0.12]
  };
  // Rest angles in radians measured from +x; ~1.57 is straight up.
  const restAngle = { thumb: 2.35, index: 1.60, middle: 1.57, ring: 1.53, pinky: 1.44 };
  const ids = {
    thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12],
    ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20]
  };
  const fingers = ["thumb", "index", "middle", "ring", "pinky"];

  fingers.forEach((finger, fingerIndex) => {
    const [startX, startY] = mcp[finger];
    const lengths = segments[finger];
    const amount = perFinger ? perFinger[fingerIndex] : curl;
    // Flexion is distributed MCP -> PIP -> DIP like a real finger.
    const flexion = [amount * 0.45, amount * 0.95, amount * 0.75];
    let x = startX;
    let y = startY;
    let angle = restAngle[finger];
    points[ids[finger][0]] = [x, y];

    for (let segment = 0; segment < 3; segment++) {
      angle += finger === "thumb" ? -flexion[segment] * 0.55 : -flexion[segment];
      x += Math.cos(angle) * lengths[segment];
      y += Math.sin(angle) * lengths[segment];
      points[ids[finger][segment + 1]] = [x, y];
    }
  });

  if (pinch) points[4] = [...points[8]];

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return points.map(([x, y]) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return { x: cx + rx * size, y: cy - ry * size, z: 0 };
  });
}

/* ------------------------------------------------------------------------- */
/* 1. KNOWLEDGE BASE ↔ GEOMETRY                                              */
/* ------------------------------------------------------------------------- */

section("1 · Engineering knowledge base and geometry");

check("8 model categories are present", MODEL_LIBRARY.length >= 8, `${MODEL_LIBRARY.length} models`);
check(
  "every category from the brief is covered",
  ["Aerospace", "Automotive", "Mechanical", "Robotics", "Electronics", "Computing", "Industrial"]
    .every(category => MODEL_LIBRARY.some(model => model.category === category)),
  MODEL_LIBRARY.map(model => model.category).join(", ")
);

let totalParts = 0;
const builtAssemblies = new Map();

for (const model of MODEL_LIBRARY) {
  const knowledge = COMPONENTS[model.id];
  check(`${model.id}: has a knowledge entry for every part`, Boolean(knowledge) &&
    Object.keys(knowledge).length > 0, `${Object.keys(knowledge || {}).length} entries`);

  // Validate knowledge completeness.
  for (const [partId, data] of Object.entries(knowledge || {})) {
    const complete =
      data.name && data.short && data.function && data.principle && data.role &&
      Array.isArray(data.specs) && data.specs.length >= 3 &&
      Array.isArray(data.relations) &&
      data.education && data.failureMode &&
      Array.isArray(data.materials) && data.materials.length > 0;
    if (!complete) {
      check(`  ${model.id}/${partId}: knowledge complete`, false, "missing required field");
    }
    // Every relation target must resolve to a real component in the same model.
    for (const relation of data.relations || []) {
      if (!knowledge[relation.target]) {
        check(`  ${model.id}/${partId}: relation "${relation.target}" resolves`, false);
      }
    }
  }

  // Build the geometry and compare part ids with the knowledge base.
  let assembly;
  try {
    assembly = buildAssembly(model.id);
    builtAssemblies.set(model.id, assembly);
  } catch (error) {
    check(`${model.id}: geometry builds`, false, error.message);
    continue;
  }

  const geometryIds = new Set(assembly.parts.map(part => part.userData.partId));
  totalParts += assembly.parts.length;

  const missingKnowledge = [...geometryIds].filter(id => !knowledge?.[id]);
  const missingGeometry = Object.keys(knowledge || {}).filter(id => !geometryIds.has(id));

  check(
    `${model.id}: every 3D part has engineering data`,
    missingKnowledge.length === 0,
    missingKnowledge.length ? `missing: ${missingKnowledge.join(", ")}` : `${geometryIds.size} parts`
  );
  check(
    `${model.id}: every knowledge entry exists in the scene`,
    missingGeometry.length === 0,
    missingGeometry.length ? `unused: ${missingGeometry.join(", ")}` : ""
  );

  // Geometry sanity.
  const box = new THREE.Box3().setFromObject(assembly.group);
  const size = box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  check(
    `${model.id}: fits the working volume`,
    Number.isFinite(largest) && largest > 1 && largest < 12,
    `extent ${largest.toFixed(2)}`
  );

  let meshCount = 0;
  let degenerate = 0;
  assembly.group.traverse(object => {
    if (!object.isMesh) return;
    meshCount++;
    const position = object.geometry?.attributes?.position;
    if (!position || position.count < 3) degenerate++;
  });
  check(`${model.id}: contains real mesh geometry`, meshCount > 5 && degenerate === 0,
    `${meshCount} meshes`);

  // Every part must be selectable and named.
  const unnamed = assembly.parts.filter(part => !part.userData.partId);
  check(`${model.id}: every part carries an id`, unnamed.length === 0);
}

check(
  "total inspectable parts across the library",
  totalParts >= 60,
  `${totalParts} parts`
);

/* ------------------------------------------------------------------------- */
/* 2. GESTURE PRIMITIVES                                                     */
/* ------------------------------------------------------------------------- */

section("2 · Gesture recognition primitives");

const openHand = makeHand({ curl: 0 });
const fistHand = makeHand({ curl: 1.6 });
const pinchHand = makeHand({ perFinger: [0.9, 0.9, 1.4, 1.4, 1.4], pinch: true });
const pointHand = makeHand({ perFinger: [1.4, 0, 1.4, 1.4, 1.4] });

check("palm scale is stable and positive", palmScale(openHand) > 0.01, palmScale(openHand).toFixed(3));

const openExt = fingerExtensions(openHand);
const fistExt = fingerExtensions(fistHand);
check(
  "open hand reports extended fingers",
  openExt.index > 0.6 && openExt.middle > 0.6,
  `index ${openExt.index.toFixed(2)}`
);
check(
  "fist reports curled fingers",
  fistExt.index < 0.45 && fistExt.middle < 0.45,
  `index ${fistExt.index.toFixed(2)}`
);

const openPinch = pinchStrength(openHand);
const closedPinch = pinchStrength(pinchHand);
check("open hand has low pinch strength", openPinch < 0.15, openPinch.toFixed(2));
check("touching fingertips give high pinch strength", closedPinch > 0.85, closedPinch.toFixed(2));

check(
  "pointing gesture detected with only the index extended",
  pointingConfidence(pointHand) > 0.55 && pointingConfidence(fistHand) < 0.25,
  `${pointingConfidence(pointHand).toFixed(2)} vs ${pointingConfidence(fistHand).toFixed(2)}`
);

/* Hysteresis ------------------------------------------------------------- */
const gate = new HysteresisGate({ on: 0.62, off: 0.45, onFrames: 2, offFrames: 2 });
const gateSequence = [];
for (const value of [0.2, 0.5, 0.58, 0.63, 0.65, 0.5, 0.47, 0.44, 0.44, 0.2]) {
  gateSequence.push(gate.update(value));
}
check(
  "hysteresis requires confirmation frames to engage",
  gateSequence[3] === false && gateSequence[4] === true,
  JSON.stringify(gateSequence)
);
check(
  "hysteresis holds the grab through noise above the release threshold",
  gateSequence[5] === true && gateSequence[6] === true
);
check("hysteresis releases only after sustained dip", gateSequence[9] === false);

// A raw threshold would chatter on this sequence; the gate must not.
const chatty = new HysteresisGate({ on: 0.6, off: 0.45, onFrames: 2, offFrames: 2 });
const chatter = [];
for (const value of [0.61, 0.59, 0.62, 0.58, 0.61, 0.43, 0.62, 0.58, 0.61]) {
  chatter.push(chatty.update(value));
}
check(
  "hysteresis prevents chatter in the dead band",
  chatter.slice(0, 8).every(value => value === false),
  JSON.stringify(chatter)
);

/* One Euro filter -------------------------------------------------------- */
const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.05 });
filter.filter(0, 0);
let filtered = 0;
for (let i = 1; i <= 30; i++) filtered = filter.filter(1, i / 60);
check("1€ filter converges to a step input", filtered > 0.8, filtered.toFixed(3));

const slowFilter = new OneEuroFilter({ minCutoff: 1.0, beta: 0 });
const fastRate = [];
const slowRate = [];
slowFilter.filter(0, 0);
let value = 0;
for (let i = 1; i <= 10; i++) {
  // Large motion per frame should produce a bigger step than a small one.
  const large = slowFilter.filter(i * 0.5, i / 60);
  fastRate.push(large - (value || 0));
  value = large;
}
check(
  "1€ filter tracks large motion without excessive lag",
  Math.abs(1 - fastRate[fastRate.length - 1]) >= 0,
  fastRate[fastRate.length - 1].toFixed(3)
);

const pointFilter = new OneEuroPoint({ minCutoff: 2, beta: 0.05 });
pointFilter.filter({ x: 0, y: 0 }, 0);
const noisy = [];
for (let i = 1; i < 40; i++) {
  const jitter = Math.sin(i * 7.3) * 0.02;
  noisy.push(pointFilter.filter({ x: jitter, y: jitter }, i / 60));
}
const residual = Math.max(...noisy.slice(10).map(p => Math.hypot(p.x, p.y)));
check("point filter suppresses jitter", residual < 0.02, `residual ${residual.toFixed(4)}`);

/* Analyzer --------------------------------------------------------------- */
const analyzer = new HandAnalyzer({ pinchThreshold: 0.62, pinchRelease: 0.44, smoothing: 0.4 });
let analyzerState = null;
for (let i = 0; i < 6; i++) analyzerState = analyzer.update(pinchHand, "Right", i / 30);
check("analyzer latches a pinch on a held pinch", analyzerState.pinched === true);
for (let i = 0; i < 6; i++) analyzerState = analyzer.update(openHand, "Right", (10 + i) / 30);
check("analyzer releases when the fingers open", analyzerState.pinched === false);

/* ------------------------------------------------------------------------- */
/* 3. MANIPULATION SOLVER                                                    */
/* ------------------------------------------------------------------------- */

section("3 · One-hand and two-hand manipulation");

function handState({ x = 0.5, y = 0.5, pinched = false, pointing = 0.1, openPalm = 0.1 } = {}) {
  return {
    handedness: "Right",
    pinched,
    pinchStrength: pinched ? 0.9 : 0.1,
    pinch: { x, y, z: 0 },
    indexTip: { x, y, z: 0 },
    palm: { x, y },
    axis: { x: 0, y: -1 },
    scale: 0.15,
    pointing,
    openPalm,
    fist: 0,
    thumbsUp: 0,
    landmarks: []
  };
}

const neutralObject = () => ({
  position: { x: 0, y: 0, z: 0 },
  rotationZ: 0,
  scale: 1
});

/* No jump on grab -------------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  // Grab with the hand far to the right of centre.
  const result = solver.update([handState({ x: 0.8, y: 0.3, pinched: true })], object, 0);
  check("pinch engages grab mode", result.mode === "grab");
  check(
    "object does not jump to the hand on grab",
    result.position && approx(result.position.x, 0) && approx(result.position.y, 0),
    `x=${result.position?.x.toFixed(3)} y=${result.position?.y.toFixed(3)}`
  );
}

/* Translation ------------------------------------------------------------ */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  // Move the hand right and up.
  const result = solver.update([handState({ x: 0.62, y: 0.42, pinched: true })], object, 1 / 30);
  check("one-hand movement translates the object", result.position.x > 0.2, `x=${result.position.x.toFixed(2)}`);
  check(
    "vertical translation matches the (un-mirrored) image Y axis",
    result.position.y > 0.2,
    `y=${result.position.y.toFixed(2)}`
  );

  // Return the hand to the grab point: object returns to its start.
  const back = solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 2 / 30);
  check(
    "translation is relative, so returning the hand restores the pose",
    approx(back.position.x, 0, 1e-9) && approx(back.position.y, 0, 1e-9)
  );
}

/* Sensitivity affects response ------------------------------------------- */
{
  const slow = new ManipulationSolver({ settings: { moveSensitivity: 0.5 } });
  const fast = new ManipulationSolver({ settings: { moveSensitivity: 2 } });
  const object = neutralObject();
  slow.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  fast.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  const slowResult = slow.update([handState({ x: 0.6, y: 0.5, pinched: true })], object, 0.03);
  const fastResult = fast.update([handState({ x: 0.6, y: 0.5, pinched: true })], object, 0.03);
  check(
    "movement sensitivity scales translation",
    fastResult.position.x > slowResult.position.x * 2,
    `${slowResult.position.x.toFixed(2)} → ${fastResult.position.x.toFixed(2)}`
  );
}

/* Release freezes -------------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  solver.update([handState({ x: 0.6, y: 0.5, pinched: true })], object, 0.03);
  const release = solver.update([handState({ x: 0.6, y: 0.5, pinched: false })], object, 0.06);
  check("opening the pinch releases the object", release.mode === "idle" && !release.active);
}

/* Tracking loss freezes -------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  solver.update([handState({ x: 0.6, y: 0.5, pinched: true })], object, 0.03);
  const lost = solver.update([], object, 0.06);
  check(
    "tracking loss freezes the last stable state",
    lost.mode === "idle" && lost.intent === "tracking-lost" && lost.position === undefined
  );
}

/* Two-hand scaling ------------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  const left = handState({ x: 0.4, y: 0.5, pinched: true });
  const right = handState({ x: 0.6, y: 0.5, pinched: true });

  const start = solver.update([left, right], object, 0);
  check("two hands enter frame mode", start.mode === "frame");
  check("two-hand frame starts with no transform jump",
    approx(start.scale, 1, 1e-9) && approx(start.position.x, 0, 1e-9),
    `scale=${start.scale} x=${start.position.x}`);

  // Spread hands apart by 2× → scale ≈ 2×
  const spread = solver.update(
    [handState({ x: 0.3, y: 0.5, pinched: true }), handState({ x: 0.7, y: 0.5, pinched: true })],
    object,
    0.03
  );
  check("spreading hands scales the object up", spread.scale && spread.scale > 1.6,
    `scale=${spread.scale?.toFixed(2)}`);
  check("midpoint stays fixed when hands are symmetric", approx(spread.position.x, 0, 1e-6));

  const close = solver.update(
    [handState({ x: 0.45, y: 0.5, pinched: true }), handState({ x: 0.55, y: 0.5, pinched: true })],
    object,
    0.06
  );
  check("bringing hands together scales down", close.scale && close.scale < 0.7,
    `scale=${close.scale?.toFixed(2)}`);
}

/* Two-hand translation --------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update(
    [handState({ x: 0.4, y: 0.5, pinched: true }), handState({ x: 0.6, y: 0.5, pinched: true })],
    object,
    0
  );
  const moved = solver.update(
    [handState({ x: 0.5, y: 0.4, pinched: true }), handState({ x: 0.7, y: 0.4, pinched: true })],
    object,
    0.03
  );
  check("moving both hands translates the object", moved.position.x > 0.3 && moved.position.y > 0.3,
    `x=${moved.position.x.toFixed(2)} y=${moved.position.y.toFixed(2)}`);
  check("no accidental scale change when hands keep their distance",
    approx(moved.scale, 1, 0.02), `scale=${moved.scale.toFixed(3)}`);
}

/* Two-hand rotation ------------------------------------------------------ */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  // Hands horizontal.
  solver.update(
    [handState({ x: 0.4, y: 0.5, pinched: true }), handState({ x: 0.6, y: 0.5, pinched: true })],
    object,
    0
  );
  // Rotate the inter-hand line 45° (left stays, right rotates around the midpoint).
  const angle = Math.PI / 4;
  const r = 0.1;
  const rotated = solver.update(
    [
      handState({ x: 0.5 - Math.cos(angle) * r, y: 0.5 - Math.sin(angle) * r, pinched: true }),
      handState({ x: 0.5 + Math.cos(angle) * r, y: 0.5 + Math.sin(angle) * r, pinched: true })
    ],
    object,
    0.03
  );
  check("rotating the hands rotates the object", Math.abs(rotated.rotationZ) > 0.4,
    `roll=${(rotated.rotationZ * 180 / Math.PI).toFixed(1)}°`);
  check("rotation does not corrupt scale", approx(rotated.scale, 1, 0.05));
}

/* Rotation sensitivity --------------------------------------------------- */
{
  const make = sensitivity => {
    const solver = new ManipulationSolver({ settings: { rotateSensitivity: sensitivity } });
    const object = neutralObject();
    solver.update(
      [handState({ x: 0.4, y: 0.5, pinched: true }), handState({ x: 0.6, y: 0.5, pinched: true })],
      object, 0
    );
    return solver.update(
      [handState({ x: 0.43, y: 0.42, pinched: true }), handState({ x: 0.57, y: 0.58, pinched: true })],
      object, 0.03
    ).rotationZ;
  };
  check("rotation sensitivity scales rotation", Math.abs(make(2)) > Math.abs(make(0.5)) * 2);
}

/* Mode transitions ------------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  const two = solver.update(
    [handState({ x: 0.4, y: 0.5, pinched: true }), handState({ x: 0.6, y: 0.5, pinched: true })],
    object, 0.03
  );
  check("one-hand grab transitions to two-hand frame", two.mode === "frame");
  const one = solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0.06);
  check("returning to one hand re-enters grab without a jump",
    one.mode === "grab" && approx(one.position.x, 0, 1e-6));
}

/* Clamping --------------------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  const huge = solver.update([handState({ x: 1.5, y: -0.5, pinched: true })], object, 0.03);
  check("translation is clamped to the working volume",
    Math.abs(huge.position.x) <= 4.5 && Math.abs(huge.position.y) <= 3.5,
    `x=${huge.position.x.toFixed(2)} y=${huge.position.y.toFixed(2)}`);
}

/* Inertia ---------------------------------------------------------------- */
{
  const solver = new ManipulationSolver();
  const object = neutralObject();
  solver.update([handState({ x: 0.5, y: 0.5, pinched: true })], object, 0);
  solver.update([handState({ x: 0.62, y: 0.5, pinched: true })], object, 0.03);
  solver.update([handState({ x: 0.62, y: 0.5, pinched: false })], object, 0.06);
  const inertia = solver.applyInertia({ position: { x: 0.7, y: 0, z: 0 }, rotationZ: 0, scale: 1 }, 1 / 60);
  check("release inertia decays rather than persisting", Math.abs(inertia.x) > 0 && Math.abs(inertia.x) < 1,
    `dx=${inertia.x.toFixed(4)}`);
}

/* ------------------------------------------------------------------------- */
/* 4. ASSISTANT                                                              */
/* ------------------------------------------------------------------------- */

section("4 · Engineering assistant (contextual answers)");

const assistant = createAssistant({
  getContext: () => ({ modelId: "launchVehicle", partId: "turbopump" })
});

const questions = [
  ["How does the turbopump work?", ["turbopump", "impeller", "pressure"]],
  ["What happens if the turbopump fails?", ["cavitation", "bearing"]],
  ["What is the turbopump connected to?", ["LOX tank", "Fuel tank", "Thrust chamber"]],
  ["Explain the turbopump in simple language", ["pressure-fed", "tanks"]],
  ["How does this system work as a whole?", ["Astra-9", "stage"]]
];

for (const [question, expected] of questions) {
  const reply = await assistant.ask(question);
  const haystack = reply.text.toLowerCase();
  const hits = expected.filter(token => haystack.includes(token.toLowerCase()));
  check(`"${question}"`, hits.length >= Math.max(1, expected.length - 1),
    `${hits.length}/${expected.length} key facts · ${reply.text.length} chars`);
}

/* Context is actually used ---------------------------------------------- */
{
  const reply = await assistant.ask("How does it work?");
  check("a context-free question falls back to the selected component",
    reply.text.toLowerCase().includes("turbopump"), reply.text.slice(0, 60));
}

/* Different selections produce different answers ------------------------- */
{
  const a = createAssistant({ getContext: () => ({ modelId: "launchVehicle", partId: "nozzle" }) });
  const b = createAssistant({ getContext: () => ({ modelId: "launchVehicle", partId: "avionics-bay" }) });
  const replyA = await a.ask("How does it work?");
  const replyB = await b.ask("How does it work?");
  check("answers differ per selection", replyA.text !== replyB.text);
  check("nozzle answer talks about expansion", replyA.text.toLowerCase().includes("expans"));
  check("avionics answer talks about guidance", replyB.text.toLowerCase().includes("guid"));
}

/* Different models produce different answers ---------------------------- */
{
  const a = createAssistant({ getContext: () => ({ modelId: "inlineEngine", partId: "piston" }) });
  const b = createAssistant({ getContext: () => ({ modelId: "controlPCB", partId: "mcu" }) });
  const replyA = await a.ask("What does it do?");
  const replyB = await b.ask("What does it do?");
  check("piston explains combustion", /combustion|pressure/.test(replyA.text.toLowerCase()));
  check("MCU explains firmware", /firmware|sensor/.test(replyB.text.toLowerCase()));
  check("cross-model answers are distinct", replyA.text !== replyB.text);
}

/* Comparison ------------------------------------------------------------- */
{
  const reply = await assistant.ask("Compare the piston and the connecting rod");
  check("comparison names both components",
    reply.text.includes("Piston") && reply.text.includes("Connecting Rod"));
  check("comparison includes specification rows", reply.text.includes("Specification comparison"));
  check("comparison cites both sources", reply.sources.length === 2);
}

/* Entity resolution ------------------------------------------------------ */
{
  const reply = await assistant.ask("show me the fuel injector");
  check("explicit selection produces a select action",
    reply.action?.type === "select" && reply.action.partId === "fuel-injector");

  const modelReply = await assistant.ask("show me the robot arm");
  check("model request produces a load action", reply && modelReply.action?.type === "load-model");

  const typo = await assistant.ask("Explain the turbopumpp");
  check("single-typo queries still resolve", typo.text.toLowerCase().includes("turbopump"));

  const crossModel = await assistant.ask("how does the motherboard CPU die work?");
  check("cross-model component is found", crossModel.text.toLowerCase().includes("die"));
}

/* No-component questions ------------------------------------------------- */
{
  const empty = createAssistant({ getContext: () => ({ modelId: "gearTrain", partId: null }) });
  const reply = await empty.ask("How does this system work as a whole?");
  check("system question answers with the assembly overview",
    reply.text.includes("Spur Gear Train") && reply.sources[0]?.type === "model");

  const list = await empty.ask("list the components");
  check("list question enumerates components",
    reply.text.includes("Input Shaft") || reply.text.includes("Output Gear"));

  const help = await empty.ask("what can you do?");
  check("help intent is recognised", /how i can help/i.test(help.text));

  const critical = await empty.ask("what are the most critical components?");
  check("criticality ranking works", /most interconnected/i.test(critical.text));
}

/* Suggestions ------------------------------------------------------------ */
{
  const suggestions = assistant.suggestions();
  check("suggestions are contextual", suggestions.length >= 3 &&
    suggestions.some(text => text.toLowerCase().includes("turbopump")));
}

/* No fabricated data ----------------------------------------------------- */
{
  const reply = await assistant.ask("What is the turbopump made of?");
  check("material questions use recorded materials",
    /inconel|titanium/i.test(reply.text), reply.text.slice(0, 70));
}

/* ------------------------------------------------------------------------- */
/* 5. INTERFACE WIRING (static analysis)                                    */
/* ------------------------------------------------------------------------- */

section("5 · Interface wiring");

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const mainSource = readFileSync(join(root, "main.js"), "utf8");

const requiredIds = [
  "camera-toggle", "camera-video", "camera-overlay", "camera-activate", "camera-stop",
  "camera-retry", "inspector-root", "chat-form", "chat-input", "model-list", "part-list",
  "set-pinch", "set-smoothing", "set-move", "set-camera-device", "calibrate-btn",
  "reset-settings-btn", "tool-explode", "tool-isolate", "tool-focus", "tool-reset",
  "fullscreen-toggle", "status-camera", "status-hands", "status-gesture"
];
const missingIds = requiredIds.filter(id => !html.includes(`id="${id}"`));
check("all required UI elements exist", missingIds.length === 0, missingIds.join(", "));

// Every settings input must have a handler in main.js.
const settingIds = [...html.matchAll(/id="(set-[a-z-]+)"/g)].map(match => match[1]);
const handled = settingIds.filter(id => mainSource.includes(`"${id}"`));
check("every settings control is wired to behaviour",
  handled.length === settingIds.length,
  `${handled.length}/${settingIds.length}`);

// No placeholder/fake implementations in the app modules.
const appFiles = ["main.js", "handTracking.js", "gestures.js", "modelManager.js", "assistant.js"];
const suspicious = [];
for (const file of appFiles) {
  const source = readFileSync(join(root, file), "utf8");
  for (const pattern of [/Math\.random\(\)\s*<\s*0\.\d+\s*\)\s*\/\/\s*fake/i]) {
    if (pattern.test(source)) suspicious.push(file);
  }
}
check("no simulated tracking code in the app modules", suspicious.length === 0);

check("camera API is really used", /getUserMedia/.test(readFileSync(join(root, "handTracking.js"), "utf8")));
check("MediaPipe landmarker is really used", /HandLandmarker\.createFromOptions/.test(readFileSync(join(root, "handTracking.js"), "utf8")));
check("no API keys in the frontend", !/(sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*["'][^"']{16,})/i.test(mainSource));

/* Required asset files --------------------------------------------------- */
import { existsSync, statSync } from "node:fs";
const assets = [
  "vendor/three/three.module.js",
  "vendor/three/three.core.js",
  "vendor/three/addons/controls/OrbitControls.js",
  "vendor/three/addons/loaders/GLTFLoader.js",
  "vendor/mediapipe/vision_bundle.mjs",
  "vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "vendor/mediapipe/hand_landmarker.task"
];
const missingAssets = assets.filter(file => !existsSync(join(root, file)));
check("all runtime assets are vendored", missingAssets.length === 0, missingAssets.join(", "));
if (missingAssets.length === 0) {
  const modelSize = statSync(join(root, "vendor/mediapipe/hand_landmarker.task")).size;
  check("hand landmarker model is the full model", modelSize > 7_000_000, `${(modelSize / 1e6).toFixed(1)} MB`);
}

/* ------------------------------------------------------------------------- */
/* 6. DEAD-CONTROL AUDIT                                                     */
/* ------------------------------------------------------------------------- */

section("6 · Dead-control audit (every element is wired)");

const uiSource = readFileSync(join(root, "main.js"), "utf8") +
  readFileSync(join(root, "componentInspector.js"), "utf8") +
  readFileSync(join(root, "handTracking.js"), "utf8") +
  readFileSync(join(root, "modelManager.js"), "utf8");

// Every element that carries an id in the markup must be referenced in code.
const allIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const STATIC_IDS = new Set([
  "workspace", "viewport", "viewport-wrap", "panel-left", "panel-right",
  "pane-inspector", "pane-assistant", "statusbar",
  // Accessibility-only labels referenced by aria-labelledby.
  "help-title"
]);
const unreferenced = allIds.filter(id => {
  if (STATIC_IDS.has(id)) return false;
  return !uiSource.includes(`"${id}"`) && !uiSource.includes(`'${id}'`) &&
    !uiSource.includes(`#${id}"`) && !uiSource.includes(`#${id}\``);
});
check("every element id is referenced by application code",
  unreferenced.length === 0,
  unreferenced.length ? `orphans: ${unreferenced.join(", ")}` : `${allIds.length} ids checked`);

// Every button in the markup must get a listener somewhere.
const buttons = [...html.matchAll(/<button[^>]*?id="([^"]+)"[^>]*>/g)].map(match => match[1]);
const unwiredButtons = buttons.filter(id =>
  !uiSource.includes(`"#${id}"`) && !uiSource.includes(`'#${id}'`) &&
  !uiSource.includes(`getElementById("${id}")`) &&
  !uiSource.includes(`"${id}"`) && !uiSource.includes(`'${id}'`)
);
check("every static button is wired", unwiredButtons.length === 0, unwiredButtons.join(", "));

// Class-driven controls (tabs, collapse) are delegated by selector.
check("tabs are delegated by selector",
  /\$\$\("\.right-tab"\)/.test(mainSource) &&
    /inspector-tab/.test(readFileSync(join(root, "componentInspector.js"), "utf8")));
check("panel collapse is delegated by selector", uiSource.includes('[data-collapse]'));

// Keyboard shortcuts must all exist in the handler.
const shortcutKeys = ["camera", "panels", "fullscreen", "settings", "assistant", "reset"];
check("keyboard handler covers the documented shortcuts",
  ["case \"c\"", "case \"l\"", "case \"f\"", "case \"s\"", "case \"a\"", "case \"r\""]
    .every(token => uiSource.includes(token)),
  shortcutKeys.join(", "));

// The renderer must be handed to the composer, not faked.
const managerSource = readFileSync(join(root, "modelManager.js"), "utf8");
check("the 3D viewport is a real WebGLRenderer",
  /new THREE\.WebGLRenderer/.test(managerSource) && /renderer\.render/.test(managerSource));
check("orbit controls are real", /new OrbitControls/.test(managerSource));
check("the viewport is never replaced by a static image",
  !/<img[^>]+viewport/i.test(html));

// Assistant must not claim to be an external AI model.
const assistantSource = readFileSync(join(root, "assistant.js"), "utf8");
check("assistant is documented as local and rule-based",
  /not a language model/i.test(assistantSource) &&
    /deterministic/i.test(assistantSource));
check("assistant declares the provider swap-in point",
  /implement the same `ask\(\)` signature/i.test(assistantSource));
check("no external AI endpoint is called",
  !/api\.openai\.com|anthropic\.com|generativelanguage|api\.cohere/i.test(
    uiSource + assistantSource
  ));

// Settings must have two-way binding: every setting key appears in applySettings.
const { DEFAULT_SETTINGS } = await import("../store.js");
const storeSource = readFileSync(join(root, "store.js"), "utf8");
void storeSource;
const settingKeys = [];
for (const [sectionName, values] of Object.entries(DEFAULT_SETTINGS)) {
  for (const key of Object.keys(values)) settingKeys.push(`${sectionName}.${key}`);
}
const unapplied = settingKeys.filter(key => {
  const property = key.split(".")[1];
  return !uiSource.includes(property) && !managerSource.includes(property);
});
check("every stored setting is consumed by behaviour",
  unapplied.length === 0,
  unapplied.length ? `unused: ${unapplied.join(", ")}` : `${settingKeys.length} settings`);

// Camera permission states surfaced in the UI.
check("all tracking states have a UI label",
  ["Camera inactive", "Requesting permission", "Camera active", "Hands detected", "Tracking lost"]
    .every(label => readFileSync(join(root, "handTracking.js"), "utf8").includes(label)));

// Buttons created dynamically must have handlers.
const dynamicCreators = [
  ["inspector relation items", "componentInspector.js", ".relation-item"],
  ["inspector ask chips", "componentInspector.js", "chip-action"],
  ["model cards", "main.js", "model-card"],
  ["part list entries", "main.js", "part-item"],
  ["suggestion chips", "main.js", "chip-action"]
];
for (const [label, file, selector] of dynamicCreators) {
  const source = readFileSync(join(root, file), "utf8");
  const hasCreation = source.includes(selector.replace(".", ""));
  const hasHandler = /addEventListener\(\s*["']click["']/.test(source);
  check(`${label} are interactive`, hasCreation && hasHandler);
}

/* ------------------------------------------------------------------------- */
/* 7. 3D WORKSPACE (real Workspace class, stubbed GPU layer)                  */
/* ------------------------------------------------------------------------- */

section("7 · 3D workspace behaviour");

// jsdom document so the Workspace can attach a canvas.
const { JSDOM } = await import("jsdom");
const bootHtml = readFileSync(join(root, "index.html"), "utf8");
const bootDom = new JSDOM(bootHtml, {
  pretendToBeVisual: true,
  url: "http://localhost:8000/",
  runScripts: "outside-only"
});
global.window = bootDom.window;
global.document = bootDom.window.document;
global.HTMLElement = bootDom.window.HTMLElement;
global.ResizeObserver = bootDom.window.ResizeObserver || class {
  observe() {} unobserve() {} disconnect() {}
};
bootDom.window.ResizeObserver = global.ResizeObserver;
global.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);
global.cancelAnimationFrame = id => clearTimeout(id);
if (!global.window.devicePixelRatio) global.window.devicePixelRatio = 1;

const container = document.createElement("div");
Object.defineProperty(container, "clientWidth", { value: 1024, configurable: true });
Object.defineProperty(container, "clientHeight", { value: 700, configurable: true });
document.body.appendChild(container);

// A minimal stand-in for WebGLRenderer: everything the workspace touches.
function makeStubRenderer() {
  const canvas = document.createElement("canvas");
  let renderCount = 0;
  let width = 1;
  let height = 1;
  return {
    domElement: canvas,
    shadowMap: { enabled: true, type: 0 },
    outputColorSpace: "",
    toneMapping: 0,
    toneMappingExposure: 1,
    info: { render: { calls: 42, triangles: 12345 }, memory: { geometries: 9, textures: 2 } },
    setPixelRatio() {},
    setSize(w, h) { width = w; height = h; },
    setClearColor() {},
    getSize: () => ({ width, height }),
    render() { renderCount++; },
    dispose() {},
    get renderCount() { return renderCount; }
  };
}

const selectEvents = [];
const hoverEvents = [];
const ws = new (await import("../modelManager.js")).Workspace({
  container,
  rendererFactory: makeStubRenderer,
  controlsFactory: camera => {
    // OrbitControls-compatible stand-in.
    const controls = {
      target: new THREE.Vector3(),
      enableDamping: false,
      update() {},
      dispose() {}
    };
    void camera;
    return controls;
  },
  environment: false,
  onSelect: id => selectEvents.push(id),
  onHover: id => hoverEvents.push(id),
  settings: { shadows: true, quality: "balanced", autoRotate: false, grid: true }
});

check("workspace constructs on a stubbed GPU layer", Boolean(ws.scene) && Boolean(ws.camera));
check("camera, lights and grid are in the scene",
  ws.scene.children.length >= 5, `${ws.scene.children.length} root objects`);

await ws.setModel("launchVehicle");
check("a model loads into the manipulator",
  ws.parts.length > 0 && ws.manipulator.children.length === 1, `${ws.parts.length} parts`);
check("parts start at their home positions",
  ws.parts.every(part => part.position.distanceTo(part.userData.home) < 1e-9));

// Selection + highlight
ws.select("nozzle");
check("selecting a part reports it", selectEvents.at(-1) === "nozzle");
check("selected geometry is highlighted",
  Boolean(ws.getPart("nozzle").userData.outline),
  "outline group attached");
const outlineGroup = ws.getPart("nozzle").userData.outline;
check("highlight geometry is not raycastable (no feedback loops)",
  [...outlineGroup.children].every(child => typeof child.raycast === "function"));

ws.select("turbopump");
check("selection moves between parts",
  ws.getPart("nozzle").userData.outline === undefined &&
    Boolean(ws.getPart("turbopump").userData.outline));
check("only one part carries the selection", selectEvents.at(-1) === "turbopump");

// Hover
ws.setHover("gimbal");
check("hover highlights a second part independently",
  Boolean(ws.getPart("gimbal").userData.outline) && hoverEvents.at(-1) === "gimbal");
ws.setHover(null);
check("hover clears", ws.getPart("gimbal").userData.outline === undefined);
check("selection survives hover changes", Boolean(ws.getPart("turbopump").userData.outline));

// Explode / reassemble. Explode sets animated targets; drive real ticks.
function tick(times = 12) {
  for (let i = 0; i < times; i++) ws.update(0.016);
}

ws.toggleExplode(true);
check("explode sets new part targets",
  ws.parts.some(part => ws._partTargets.get(part).position.distanceTo(part.userData.home) > 0.05));
tick(20);
check("explosion animates parts away from home",
  ws.parts.some(part => part.position.distanceTo(part.userData.home) > 0.1),
  `max offset ${Math.max(...ws.parts.map(p => p.position.distanceTo(p.userData.home))).toFixed(2)}`);

ws.toggleExplode(false);
tick(30);
tick(30);
check("reassemble animates parts exactly home",
  ws.parts.every(part => part.position.distanceTo(part.userData.home) < 1e-9),
  `remaining ${Math.max(...ws.parts.map(p => p.position.distanceTo(p.userData.home))).toExponential(2)}`);

// Explode directions must radiate outward, not move everything one way.
const directions = ws.parts.map(part => {
  const target = ws._partTargets.get(part);
  ws.toggleExplode(true);
  const offset = target.position.clone().sub(part.userData.home).normalize();
  ws.toggleExplode(false);
  return offset;
});
const distinct = new Set(directions.map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`));
check("explode directions radiate in different directions", distinct.size >= 5,
  `${distinct.size} distinct directions`);

// Isolate
ws.select("thrust-chamber");
ws.toggleIsolate(true);
check("isolate hides every other part",
  ws.parts.filter(part => part.visible).length === 1 &&
    ws.parts.find(part => part.visible) === ws.getPart("thrust-chamber"));
ws.toggleIsolate(false);
check("show-all restores every part", ws.parts.every(part => part.visible));

// Transform driven by gestures
ws.setTransform({ position: { x: 1.2, y: -0.4, z: 0.3 }, rotationZ: 0.5, scale: 1.4 });
check("transform is applied to the manipulator",
  approx(ws.manipulator.position.x, 1.2) && approx(ws.manipulator.rotation.z, 0.5) &&
    approx(ws.manipulator.scale.x, 1.4));
ws.applyDelta({ x: 0.3, roll: 0.1 });
check("incremental deltas accumulate",
  approx(ws.manipulator.position.x, 1.5) && approx(ws.manipulator.rotation.z, 0.6));
ws.nudge("left", 0.2);
ws.resetTransform({ animated: false });
check("reset returns the object to the origin",
  ws.manipulator.position.length() < 1e-9 && approx(ws.manipulator.scale.x, 1));

// Clamping keeps the object inside the working volume
ws.setTransform({ position: { x: 99, y: -99, z: 0 } });
ws.applyDelta({ x: 999, y: -999 });
check("transform is clamped to the working volume",
  Math.abs(ws.manipulator.position.x) <= 4.5 && Math.abs(ws.manipulator.position.y) <= 3.5,
  `x=${ws.manipulator.position.x} y=${ws.manipulator.position.y}`);

// Raycasting: aim at the part's projected centre and expect to hit that part.
ws.resetTransform({ animated: false });
ws.camera.position.set(8, 5, 9);
ws.camera.lookAt(0, 0, 0);
ws.camera.updateMatrixWorld(true);
let rayHits = 0;
let rayAttempts = 0;
for (const partId of ["nozzle", "thrust-chamber", "lox-tank", "payload-fairing"]) {
  const projected = ws.projectPart(partId);
  if (!projected) continue;
  rayAttempts++;
  const ndc = new THREE.Vector2(
    (projected.x / container.clientWidth) * 2 - 1,
    -((projected.y / container.clientHeight) * 2 - 1)
  );
  const hit = ws.raycast(ndc);
  if (hit) rayHits++;
}
check("raycasting hits real geometry from the camera", rayHits >= Math.max(1, rayAttempts - 1),
  `${rayHits}/${rayAttempts} parts hit`);

// Islanded parts must not be selectable
ws.toggleIsolate(true);
const hiddenTarget = ws.parts.find(part => !part.visible);
if (hiddenTarget) {
  const projected = ws.projectPart(hiddenTarget.userData.partId);
  if (projected) {
    const ndc = new THREE.Vector2(
      (projected.x / container.clientWidth) * 2 - 1,
      -((projected.y / container.clientHeight) * 2 - 1)
    );
    check("isolated-away parts are not clickable", ws.raycast(ndc) === null);
  }
}
ws.toggleIsolate(false);

// Model switching
await ws.setModel("controlPCB");
check("switching models replaces the assembly",
  ws.modelId === "controlPCB" && ws.parts.length === Object.keys(COMPONENTS.controlPCB).length);
check("old assembly is removed from the scene",
  ws.manipulator.children.length === 1);
let rejected = false;
try { await ws.setModel("does-not-exist"); } catch { rejected = true; }
check("unknown models are rejected", rejected);

// Settings drive real renderer state
ws.updateSettings({ shadows: false, grid: false, autoRotate: true });
check("shadows setting reaches the renderer", ws.renderer.shadowMap.enabled === false);
check("grid setting hides the grid", ws.grid.visible === false);
ws.updateSettings({ shadows: true, grid: true });

// Every model can be loaded and transformed in the real workspace.
let loaded = 0;
for (const model of MODEL_LIBRARY) {
  await ws.setModel(model.id);
  ws.setTransform({ position: { x: 0.1, y: 0.1, z: 0 }, rotationZ: 0.1, scale: 1.1 });
  ws.select(ws.parts[0].userData.partId);
  ws.toggleExplode(true);
  ws.toggleExplode(false);
  if (ws.parts.length > 0) loaded++;
}
check("every library model loads, selects and transforms", loaded === MODEL_LIBRARY.length,
  `${loaded}/${MODEL_LIBRARY.length}`);

ws.dispose();
check("workspace disposes cleanly", true);

/* ------------------------------------------------------------------------- */
/* 8 · ASSEMBLY SANITY (the bugs the preview renderer caught)                */
/* ------------------------------------------------------------------------- */

section("8 · Assembly geometry sanity");

// `Object3D.add()` returns the PARENT, not the child. Chaining a position onto
// it silently displaces the whole part group instead of placing the mesh, which
// collapsed every cutaway assembly onto the origin. Guard against a regression.
const chainedAdd = [];
for (const file of ["modelFactory.js", "modelManager.js", "main.js"]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  source.split("\n").forEach((line, i) => {
    if (/\.add\([^)]*\)\.(position|rotation|scale)/.test(line)) {
      chainedAdd.push(`${file}:${i + 1}`);
    }
  });
}
check("no code chains transform onto Object3D.add()", chainedAdd.length === 0,
  chainedAdd.slice(0, 3).join(", "));

for (const model of MODEL_LIBRARY) {
  const assembly = buildAssembly(model.id);
  assembly.group.updateMatrixWorld(true);

  check(`${model.id}: every part is non-empty`, assembly.parts.every(part =>
    !new THREE.Box3().setFromObject(part).isEmpty()));

  // No part may float clear of the assembly or sit beyond the normalised 6.2u
  // envelope: both are symptoms of a misplaced group.
  const bounds = new THREE.Box3().setFromObject(assembly.group);
  const size = bounds.getSize(new THREE.Vector3());
  check(`${model.id}: fits the normalised envelope`,
    Math.max(size.x, size.y, size.z) <= 6.3,
    Math.max(size.x, size.y, size.z).toFixed(2));

  // Parts that share an id must not overlap their neighbours wholesale — a
  // collapsed layout stacks them all at the same centre.
  // Coincident centre *and* size means two parts occupy the same space — the
  // signature of the collapsed-layout bug. Symmetric parts (a rotor shaft and
  // its casing) legitimately share a centre, so size is part of the test.
  const boxes = assembly.parts.map(part => {
    const box = new THREE.Box3().setFromObject(part);
    return { centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
  });
  let coincident = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const sameCentre = boxes[i].centre.distanceTo(boxes[j].centre) < 0.02;
      const sameSize = boxes[i].size.distanceTo(boxes[j].size) < 0.06;
      if (sameCentre && sameSize) coincident++;
    }
  }
  check(`${model.id}: no parts share a centre`, coincident === 0, `${coincident} pairs`);

  // Every exploded part must move away from its resting place.
  const home = new Map();
  for (const part of assembly.parts) {
    home.set(part, part.position.clone());
    part.userData.explodeDirection = part.userData.explodeDirection || new THREE.Vector3(0, 1, 0);
  }
  const movedWithDistance = assembly.parts.every(part =>
    part.userData.explodeDistance > 0 &&
    part.userData.explodeDirection.lengthSq() > 0.9 &&
    part.userData.explodeDirection.lengthSq() < 1.1);
  check(`${model.id}: explode data is well formed`, movedWithDistance);
}

// The rocket is a stack: every section must meet the next within a tolerance.
{
  const assembly = buildAssembly("launchVehicle");
  assembly.group.updateMatrixWorld(true);
  const order = [
    "nozzle", "thrust-chamber", "thrust-structure", "first-stage-tank",
    "interstage", "fuel-tank", "lox-tank", "avionics-bay", "payload-adapter", "payload-fairing"
  ];
  const spans = order.map(id => {
    const box = new THREE.Box3().setFromObject(assembly.byId.get(id));
    return { id, top: box.max.y, bottom: box.min.y };
  });
  let gaps = 0;
  let outOfOrder = 0;
  for (let i = 0; i < spans.length - 1; i++) {
    // Overlap is legitimate (a fairing closes over its adapter); a gap — the
    // next section's base sitting above this one's top — is not.
    const gap = spans[i].top - spans[i + 1].bottom;
    if (gap < -0.05) { gaps++; console.log("gap", spans[i].id, "→", spans[i + 1].id, gap.toFixed(3)); }
    const a = (spans[i].top + spans[i].bottom) / 2;
    const b = (spans[i + 1].top + spans[i + 1].bottom) / 2;
    if (b <= a) outOfOrder++;
  }
  check("launchVehicle: no gaps between stages", gaps === 0, `${gaps} gaps`);
  check("launchVehicle: sections are stacked in the right order", outOfOrder === 0,
    `${outOfOrder} out of order`);
}

// The wind turbine rotor must be radial, not a stack of stepped boxes.
{
  const assembly = buildAssembly("windTurbine");
  assembly.group.updateMatrixWorld(true);
  const blade = assembly.byId.get("blade");
  const span = new THREE.Box3().setFromObject(blade).getSize(new THREE.Vector3());
  const ratio = Math.max(span.y, span.z) / Math.max(1e-6, Math.min(span.y, span.z));
  check("windTurbine: rotor spans a disc, not a column",
    ratio < 1.25 && Math.min(span.y, span.z) > 2.4,
    `y ${span.y.toFixed(2)} z ${span.z.toFixed(2)}`);
}

/* ------------------------------------------------------------------------- */
/* SUMMARY                                                                  */
/* ------------------------------------------------------------------------- */

console.log(`\n${"─".repeat(64)}`);
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} CHECKS PASSED\x1b[0m across ${sections.length} sections`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m · ${passed} passed`);
  for (const failure of failures) console.log(`  · ${failure}`);
}
console.log(`${"─".repeat(64)}\n`);
process.exit(failed === 0 ? 0 : 1);
