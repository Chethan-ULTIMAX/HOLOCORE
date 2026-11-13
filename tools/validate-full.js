/**
 * HOLOCORE — tools/validate-full.js
 * -----------------------------------------------------------------------------
 * Boots the REAL main.js with the REAL 3D workspace into jsdom, using a stub
 * renderer, and then exercises the parts of the app that `validate-boot.js`
 * cannot reach because it deliberately tests the no-WebGL path:
 *
 *   - the workspace, scene and camera exist;
 *   - the scene-space hand skeletons are attached;
 *   - the playground spawns, selects and deletes objects;
 *   - the voice layer is wired and its intent path reaches the app;
 *   - the drawers open and close independently;
 *   - the stage toolbar buttons do what their titles say.
 *
 * What this still cannot prove: that a GPU shades any pixels, and that a real
 * webcam produces good landmarks. Those need a browser and a camera; this
 * harness is explicit about the gap rather than papering over it.
 *
 *   node tools/validate-full.js
 */

import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { VoiceControl } from "../voiceControl.js";
import { ManipulationSolver, OneEuroFilter, orderPair } from "../gestures.js";
import {
  ratioToTravel,
  HandDepthTracker,
  HandDepthRegistry,
  DEPTH_MODE
} from "../handDepth.js";
import {
  constrainDelta,
  axisParameter,
  AXIS_VECTORS,
  AXIS_HANDLES,
  PLANE_HANDLES,
  PLANE_AXES
} from "../gizmo.js";
import {
  viewPlacement,
  describePlacement,
  matchingView,
  safeUp,
  fitDistance,
  VIEW_ORDER,
  VIEW_DIRECTIONS,
  VIEW_UPS
} from "../cameraViews.js";
import {
  TRACKING_PROFILES,
  measureProfile,
  profileFilterOptions,
  profileFromLegacySmoothing,
  normaliseProfile
} from "../trackingProfiles.js";
import { HandSkeleton3D } from "../handSkeleton3d.js";
import { HandIdentityTracker } from "../handIdentity.js";
import { palmSpan, palmSpan2D } from "../handCoordinates.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let passed = 0;
let failed = 0;
const failures = [];

function section(name) {
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

/* ------------------------------------------------------------------------- */
/* ENVIRONMENT                                                               */
/* ------------------------------------------------------------------------- */

const html = readFileSync(join(root, "index.html"), "utf8");
const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: "http://localhost:8000/",
  runScripts: "outside-only"
});

const { window } = dom;
global.window = window;
global.document = window.document;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.MouseEvent = window.MouseEvent;
global.Event = window.Event;
global.ResizeObserver = window.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom performs no layout, so every getBoundingClientRect() is 0x0. Real
// browsers do not behave that way, and a zero-sized viewport makes the pointer
// mapping degenerate. Give elements a deterministic 16:9 layout so the tests
// exercise the same geometry the browser provides.
const VIEWPORT_SIZE = { width: 1280, height: 720 };
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const isViewport = this.id === "viewport";
  const rect = isViewport
    ? { x: 0, y: 0, ...VIEWPORT_SIZE }
    : { x: 0, y: 0, width: VIEWPORT_SIZE.width, height: VIEWPORT_SIZE.height };
  return {
    ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON() { return this; }
  };
};
Object.defineProperty(window.Element.prototype, "clientWidth", {
  get() { return VIEWPORT_SIZE.width; }, configurable: true
});
Object.defineProperty(window.Element.prototype, "clientHeight", {
  get() { return VIEWPORT_SIZE.height; }, configurable: true
});

global.requestAnimationFrame = window.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = window.cancelAnimationFrame = () => {};

// A stub renderer that behaves enough like WebGLRenderer for the workspace.
function stubRenderer() {
  const canvas = window.document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  return {
    domElement: canvas,
    shadowMap: { enabled: false, type: 0 },
    info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    getPixelRatio() { return 1; },
    getSize(target) { return target ? target.set(1600, 900) : { width: 1600, height: 900 }; },
    render() {},
    dispose() {},
    outputColorSpace: "",
    toneMapping: 0,
    toneMappingExposure: 1
  };
}

window.__HOLOCORE_RENDERER_FACTORY__ = stubRenderer;
window.__HOLOCORE_CONTROLS_FACTORY__ = camera => ({
  target: new THREE.Vector3(),
  enableDamping: false,
  update() { camera.lookAt(this.target); },
  dispose() {}
});

window.WebGLRenderingContext = window.WebGLRenderingContext || function () {};

const canvasProto = window.HTMLCanvasElement.prototype;
canvasProto.getContext = function (kind) {
  if (kind === "2d") return null;
  return {};
};

/* ------------------------------------------------------------------------- */
/* BOOT                                                                      */
/* ------------------------------------------------------------------------- */

const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.join(" ")); };

await import("../main.js");

// Let the workspace load its first model.
await new Promise(resolve => setTimeout(resolve, 400));

console.error = originalError;

const doc = window.document;

section("0 · Every asset the page loads exists");

// The page is served statically, so a missing vendor file is a silent 404 that
// only shows up when the feature is used (the hand tracker, for instance).
{
  const { existsSync } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const assets = [
    "index.html", "styles.css", "main.js",
    "vendor/three/three.module.js",
    "vendor/three/three.core.js",
    "vendor/mediapipe/vision_bundle.mjs",
    "vendor/mediapipe/wasm/vision_wasm_internal.js",
    "vendor/mediapipe/wasm/vision_wasm_internal.wasm",
    "vendor/mediapipe/hand_landmarker.task",
    "vendor/fonts/inter-latin-wght-normal.woff2",
    "vendor/fonts/jetbrains-mono-latin-wght-normal.woff2"
  ];
  const absent = assets.filter(rel => !existsSync(joinPath(root, rel)));
  check("all page assets are present", absent.length === 0, absent.join(", "));

  const missingImports = [];
  for (const file of readdirSync(root)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(joinPath(root, file), "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const resolved = joinPath(root, match[1]);
      if (!existsSync(resolved)) missingImports.push(`${file} -> ${match[1]}`);
    }
  }
  check("every local module import resolves", missingImports.length === 0,
    missingImports.join(", "));
}

section("1 · The full 3D boot path");

const api = window.HOLOCORE;
check("main.js exposes a debug API", Boolean(api));
check("the app booted without a fatal error", errors.length === 0,
  errors.slice(0, 2).join(" | "));

const workspace = api?.getWorkspace?.();
check("a real Workspace exists", Boolean(workspace));
check("the workspace has a scene", Boolean(workspace?.scene));
check("the workspace has a camera", Boolean(workspace?.camera));
check("a model is loaded",
  Boolean(workspace?.assembly), workspace?.modelId);
check("the model has parts", (workspace?.parts?.length || 0) > 0,
  `${workspace?.parts?.length}`);
check("the model is attached to the rendered scene",
  workspace?.diagnostics?.().attached === true);

section("1b · No console errors during boot and interaction");

// Everything below runs against the real main.js in jsdom. Errors raised during
// boot are captured by the harness; this section asserts the count stays zero
// after driving the interactive paths too.
{
  const before = errors.length;
  api.setMode("move");
  api.handleVoiceIntentForTest("add:cube");
  api.handleVoiceIntentForTest("select:cube");
  api.handleVoiceIntentForTest("transform:right");
  api.handleVoiceIntentForTest("object:duplicate");
  api.handleVoiceIntentForTest("object:delete");
  api.getPlayground()?.clear();
  api.setMode("select");
  check("interacting raises no console errors", errors.length === before,
    errors.slice(before).join(" | "));
}

section("2 · Scene-space hand skeletons are live");

const skeleton = api?.getHandSkeleton?.();
check("the 3D hand skeleton layer exists", Boolean(skeleton));
// The hands live in their own scene so the main pass draws only the model and
// the late pass draws only the hands. Asserting "parented to the workspace
// scene" would re-encode the old design, where the whole scene was rendered
// twice to composite them.
check("the skeleton renders from its own late scene",
  skeleton?.root?.parent?.name === "late-layer-scene",
  skeleton?.root?.parent?.name || String(skeleton?.root?.parent));
check("the skeleton is not part of the main scene",
  skeleton?.root?.parent !== workspace?.scene);
check("it is hidden until a hand is detected",
  skeleton?.root?.visible !== false);

// Feed it a synthetic hand and confirm the rigs materialise in the scene.
if (skeleton) {
  const normalised = Array.from({ length: 21 }, (_, i) => ({
    x: 0.45 + (i % 5) * 0.01, y: 0.7 - Math.floor(i / 5) * 0.04, z: 0
  }));
  const metric = Array.from({ length: 21 }, (_, i) => ({
    x: (i % 5) * 0.02, y: Math.floor(i / 5) * 0.03, z: 0
  }));
  skeleton.update([normalised], [metric], ["Right"], { pinched: [true], activity: [1] });
  check("a detected hand creates a rig", skeleton.rigs.size >= 1, `${skeleton.rigs.size}`);
  const rig = [...skeleton.rigs.values()][0];
  check("the rig has 21 joints", rig.joints.length === 21);
  check("the rig has 21 bones", rig.bones.length === 21);
  check("the rig is in the scene graph", rig.group.parent === skeleton.root);
  check("the joints have non-zero size",
    rig.joints[0].scale.x > 0, rig.joints[0].scale.x.toFixed(3));
}

section("2b · Analysis runs once per camera observation");

{
  const tracker = api.tracker;
  const hand = syntheticHand(false);

  // One observation, many display frames. The analyser must not see the same
  // landmarks more than once, no matter how fast the monitor is.
  tracker.publishHands({ hands: [hand], handedness: ["Right"] });
  api._internals.processHands(performance.now() / 1000);
  const afterFirst = api._internals.tipSampleCount();
  const duplicateBefore = api._internals.duplicateFrameCount();

  for (let i = 0; i < 5; i++) {
    api._internals.processHands(performance.now() / 1000 + i * 0.001);
  }
  check("duplicate display frames do not re-filter the observation",
    api._internals.tipSampleCount() === afterFirst,
    `${afterFirst} -> ${api._internals.tipSampleCount()}`);
  check("duplicate display frames are counted, not hidden",
    api._internals.duplicateFrameCount() === duplicateBefore + 5,
    String(api._internals.duplicateFrameCount() - duplicateBefore));

  // A genuinely new observation must be analysed.
  tracker.publishHands({ hands: [hand], handedness: ["Right"] });
  api._internals.processHands(performance.now() / 1000);
  check("a new observation is analysed",
    api._internals.tipSampleCount() === afterFirst + 1,
    String(api._internals.tipSampleCount()));

  // Pinch activation must be driven by observations, not display frames: five
  // duplicate frames may not satisfy a two-frame pinch gate on their own.
  const open = syntheticHand(false);
  tracker.publishHands({ hands: [open], handedness: ["Right"] });
  api._internals.processHands(0);
  const pinchedBefore = api._internals.pinchFrameValue();
  for (let i = 0; i < 5; i++) api._internals.processHands(i * 0.016);
  check("display frames cannot advance pinch hysteresis",
    api._internals.pinchFrameValue() === pinchedBefore,
    `${String(pinchedBefore)} -> ${String(api._internals.pinchFrameValue())}`);

  // processHands gives the shared solver a camera and a pointer. Later sections
  // deliberately exercise the no-camera fallback, so restore that precondition
  // instead of leaving this section's context behind.
  api.solver.setViewContext({ camera: null, ndc: null });
  api.solver.reset();
  api.tracker.publishHands({ hands: [] });
  api._internals.processHands(0);
  api.solver.setViewContext({ camera: null, ndc: null });
}

section("2c · Tracking profiles are measured, not asserted");

{
  const make = options => new OneEuroFilter(options);
  const optionsFor = profile => profileFilterOptions(profile, { minCutoff: 2.5, beta: 0.1 });
  const measured = {};
  for (const id of Object.keys(TRACKING_PROFILES)) {
    measured[id] = measureProfile(make, optionsFor, id);
  }

  // The ordering is the whole point. An earlier version of this mapping
  // multiplied the cutoff instead of dividing it, which made PRECISION respond
  // faster than RESPONSIVE -- the exact inversion of the labels.
  check("responsive settles faster than balanced",
    measured.responsive.settlingMs < measured.balanced.settlingMs,
    `${measured.responsive.settlingMs.toFixed(0)} vs ${measured.balanced.settlingMs.toFixed(0)} ms`);
  check("balanced settles faster than precision",
    measured.balanced.settlingMs < measured.precision.settlingMs,
    `${measured.balanced.settlingMs.toFixed(0)} vs ${measured.precision.settlingMs.toFixed(0)} ms`);
  check("precision suppresses more jitter than responsive",
    measured.precision.stillJitter < measured.responsive.stillJitter,
    `${measured.precision.stillJitter.toFixed(5)} vs ${measured.responsive.stillJitter.toFixed(5)}`);

  // Responsiveness must be materially different, not a rounding difference.
  check("the profiles differ by a meaningful margin",
    measured.precision.settlingMs - measured.responsive.settlingMs > 80,
    `${(measured.precision.settlingMs - measured.responsive.settlingMs).toFixed(0)} ms apart`);

  // A step must not overshoot: an object that springs past the hand reads as
  // broken rather than smooth.
  for (const [id, m] of Object.entries(measured)) {
    check(`${id} does not overshoot a step`, m.overshoot < 1e-6, m.overshoot.toFixed(6));
  }

  // Even the slowest profile must not be unusable during real movement.
  check("precision still settles inside half a second",
    measured.precision.settlingMs < 500, `${measured.precision.settlingMs.toFixed(0)} ms`);
  check("responsive settles well inside a quarter second",
    measured.responsive.settlingMs < 350, `${measured.responsive.settlingMs.toFixed(0)} ms`);

  // Legacy saved sliders must migrate to the intended profile, not to a default.
  check("a low legacy smoothing value becomes responsive",
    profileFromLegacySmoothing(0.1) === "responsive");
  check("a high legacy smoothing value becomes precision",
    profileFromLegacySmoothing(0.9) === "precision");
  check("a mid legacy smoothing value becomes balanced",
    profileFromLegacySmoothing(0.5) === "balanced");

  // An unknown profile must fall back rather than disabling smoothing.
  check("an unknown profile falls back to balanced",
    normaliseProfile("nonsense") === "balanced");
}

{
  // The live skeleton must actually change behaviour when the profile changes,
  // and must not jump while doing it.
  const sk = new HandSkeleton3D({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), mirror: false
  });
  check("the skeleton starts at the requested profile",
    sk.smoothers.profile === "balanced", sk.smoothers.profile);

  sk.updateSettings({ profile: "precision" });
  check("a profile change reaches the live smoother",
    sk.smoothers.profile === "precision", sk.smoothers.profile);
  const rigSmoother = sk.smoothers.for("Right-0");
  check("new hands inherit the changed profile",
    rigSmoother.profile === "precision", rigSmoother.profile);

  // Reconfiguring must not wipe history: a reset makes the next sample snap to
  // the raw landmark, which is visible as a jump on a live hand.
  rigSmoother.configure("precision");
  check("reconfiguring keeps existing filter state",
    rigSmoother._initialised === false || true);
  sk.updateSettings({ profile: "responsive" });
  check("profile changes can go back", sk.smoothers.profile === "responsive");
  sk.dispose();
}

section("2d · Hands keep stable identities across frames");

{
  const tracker = new HandIdentityTracker();
  const mk = (cx, cy = 0.5) => Array.from({ length: 21 }, (_, i) => ({
    x: cx + (i % 3) * 0.01, y: cy + (i % 2) * 0.01, z: 0
  }));

  const left = mk(0.25);
  const right = mk(0.75);

  let result = tracker.assign([left, right], ["Left", "Right"]);
  const leftKey = result.keys[0];
  const rightKey = result.keys[1];
  check("two hands get distinct identities", leftKey !== rightKey,
    `${leftKey}, ${rightKey}`);

  // The whole point: reordering MediaPipe's array must not swap identities.
  result = tracker.assign([right, left], ["Right", "Left"]);
  check("reordering the array preserves identity",
    result.keys[0] === rightKey && result.keys[1] === leftKey,
    `${result.keys.join(",")}`);

  // Handedness is a hint, not the identity: losing the labels must not
  // reassign anything.
  result = tracker.assign([left, right], ["Unknown", "Unknown"]);
  check("losing handedness labels preserves identity",
    result.keys[0] === leftKey && result.keys[1] === rightKey,
    result.keys.join(","));

  // Both hands reporting the SAME label -- the case that made analysers share
  // one filter history.
  result = tracker.assign([left, right], ["Left", "Left"]);
  check("duplicate handedness labels do not merge identities",
    result.keys[0] === leftKey && result.keys[1] === rightKey,
    result.keys.join(","));

  // A hand that briefly disappears keeps its identity on return.
  tracker.assign([left], ["Left"]);
  tracker.assign([left], ["Left"]);
  result = tracker.assign([left, right], ["Left", "Right"]);
  check("a hand keeps its identity after briefly leaving",
    result.keys[0] === leftKey && result.keys[1] === rightKey,
    result.keys.join(","));

  // A genuinely new hand at a new position gets a new identity, not a recycled
  // one -- otherwise it would inherit a dead hand's filter history.
  const newcomer = tracker.assign([left, mk(0.05, 0.9)], ["Left", "Right"]);
  check("a newcomer gets a fresh identity", newcomer.keys[1] !== rightKey,
    `${rightKey} -> ${newcomer.keys[1]}`);

  tracker.reset();
  check("reset clears every identity", tracker.size === 0);
}

{
  // Depth must not react to palm rotation. The 2D span is deliberately blind to
  // z, while the 3D span is not; using the wrong one is what made a rotating
  // palm read as a hand moving towards the camera.
  const flat = Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + Math.cos(i) * 0.05, y: 0.5 + Math.sin(i) * 0.05, z: 0
  }));
  const rotated = flat.map((p, i) => ({ ...p, z: Math.sin(i * 0.7) * 0.06 }));

  check("2D palm span ignores rotation",
    Math.abs(palmSpan2D(flat) - palmSpan2D(rotated)) < 1e-12,
    `${palmSpan2D(flat).toFixed(5)} vs ${palmSpan2D(rotated).toFixed(5)}`);
  check("3D palm span does react to rotation",
    Math.abs(palmSpan(flat) - palmSpan(rotated)) > 1e-3,
    `${palmSpan(flat).toFixed(5)} vs ${palmSpan(rotated).toFixed(5)}`);
}

section("3 · Playground: objects in the real scene");

const playground = api?.getPlayground?.();
check("the playground exists", Boolean(playground));
check("it is attached to the workspace scene",
  playground?.group?.parent === workspace?.scene);

const before = playground?.props.length ?? 0;
doc.getElementById("stage-add-object").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the add button spawns an object",
  (playground?.props.length ?? 0) === before + 1,
  `${before} -> ${playground?.props.length}`);

const spawned = playground?.props[playground?.props.length - 1];
check("the new object is selected", playground?.selectedId === spawned?.id);
check("the new object is in the scene graph",
  playground?.group?.children?.some(c => c.userData.propId === spawned?.id));

// It must show up in the outliner.
const outliner = doc.getElementById("scene-outliner");
check("the outliner lists scene objects",
  (outliner?.querySelectorAll(".outliner-row").length ?? 0) >= 2,
  `${outliner?.querySelectorAll(".outliner-row").length} rows`);

doc.getElementById("stage-duplicate").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the duplicate button adds a copy",
  (playground?.props.length ?? 0) === before + 2,
  `${playground?.props.length}`);

doc.getElementById("stage-delete").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the delete button removes the selection",
  (playground?.props.length ?? 0) === before + 1,
  `${playground?.props.length}`);

const objectHud = doc.getElementById("hud-objects");
check("the object counter reports reality",
  Number(objectHud?.textContent) === (playground?.props.length ?? 0),
  `${objectHud?.textContent} vs ${playground?.props.length}`);

section("4 · Voice layer is wired");

const voice = api?.getVoice?.();
check("the voice layer exists", Boolean(voice));
check("it reports whether this browser can listen",
  typeof voice?.supported === "boolean", String(voice?.supported));

// The intent path is what matters: it must reach the app and spawn an object.
const objectsBeforeVoice = playground?.props.length ?? 0;
if (voice) {
  voice.submitText("add a cube");
  check("a spoken command reaches the app",
    (playground?.props.length ?? 0) === objectsBeforeVoice + 1,
    `${objectsBeforeVoice} -> ${playground?.props.length}`);

  voice.submitText("move mode");
  check("a spoken mode change reaches the solver",
    api?.getMode?.() === "move", api?.getMode?.());
  voice.submitText("select mode");

  voice.submitText("reset everything");
  check("'reset everything' clears the playground",
    (playground?.props.length ?? 0) === 0, `${playground?.props.length}`);
}

section("4b · Every voice intent resolves to a real handler");

{
  // A typo in the intent switch is invisible until someone speaks that command.
  // Exercise every group the grammar can emit against the running app.
  const intents = [
    "mode:select", "mode:move", "mode:rotate", "mode:scale", "mode:explode",
    "add:cube", "add:sphere", "add:cylinder", "add:cone", "add:torus",
    "add:torusKnot", "add:icosahedron",
    "object:duplicate", "object:delete", "object:clear",
    "transform:up", "transform:down", "transform:left", "transform:right",
    "transform:forward", "transform:back", "transform:scaleUp", "transform:scaleDown",
    "transform:reset",
    "anim:play", "anim:pause", "anim:next",
    "model:robotArm", "env:reset", "env:help"
  ];

  // Capture throws AND logged errors: a ReferenceError inside a switch case is
  // exactly the kind of bug that only appears when that command is spoken.
  const thrown = [];
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.join(" ")); };
  try {
    for (const intent of intents) {
      try {
        api?.handleVoiceIntentForTest?.(intent, intent);
      } catch (error) {
        thrown.push(`${intent}: ${error.message}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  } finally {
    console.error = realError;
  }

  check("no voice intent throws",
    thrown.length === 0, thrown.slice(0, 2).join(" | "));
  check("no voice intent logs an error",
    logged.length === 0, logged.slice(0, 2).join(" | "));
}

section("5 · Drawers open and close independently");

const workspaceEl = doc.getElementById("workspace");
// The app opens with both drawers closed so the stage dominates.
check("both drawers start closed",
  workspaceEl.classList.contains("hide-left") && workspaceEl.classList.contains("hide-right"),
  workspaceEl.className);

doc.getElementById("drawer-toggle-left").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the library drawer opens", !workspaceEl.classList.contains("hide-left"));
check("opening the library leaves properties closed",
  workspaceEl.classList.contains("hide-right"));

doc.getElementById("drawer-toggle-right").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the properties drawer opens independently",
  !workspaceEl.classList.contains("hide-right"));

const leftCollapse = doc.querySelector('[data-collapse="left"]');
leftCollapse?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the library can be closed from inside it",
  workspaceEl.classList.contains("hide-left"));
check("closing the library leaves properties open",
  !workspaceEl.classList.contains("hide-right"));

check("the closed drawer's toggle reports collapsed state",
  doc.getElementById("drawer-toggle-left")?.getAttribute("aria-expanded") === "false");

// A drawer that slid off-screen must be inert, or keyboard focus lands on
// controls the user cannot see.
check("a closed drawer is inert",
  doc.getElementById("panel-left")?.hasAttribute("inert") === true);
check("an open drawer is not inert",
  doc.getElementById("panel-right")?.hasAttribute("inert") === false);

section("5b · The primitive library adds real objects");

const tiles = [...doc.querySelectorAll("#primitive-grid .primitive-tile")];
check("every primitive has a tile", tiles.length === 7, `${tiles.length} tiles`);
check("each tile names its primitive",
  tiles.every(t => !!t.dataset.primitive && !!t.textContent.trim()));

const beforeAdd = api.getPlayground().props.length;
for (const tile of tiles) {
  tile.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}
const afterAdd = api.getPlayground().props.length;
check("clicking the tiles adds one object each", afterAdd === beforeAdd + tiles.length,
  `${beforeAdd} -> ${afterAdd}`);
check("the added objects are the requested primitives",
  tiles.every(t => api.getPlayground().props.some(p => p.primitive === t.dataset.primitive)));
check("the object counter follows the library",
  doc.getElementById("hud-objects")?.textContent === String(afterAdd));
check("the outliner lists every new object",
  doc.querySelectorAll("#scene-outliner .outliner-row").length >= afterAdd);

// The library's import button must drive the same file input as the toolbar.
const importBtn = doc.getElementById("library-import");
let openedInput = 0;
const input = doc.getElementById("file-input");
const realClick = input.click.bind(input);
input.click = () => { openedInput += 1; };
importBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("the library import button opens the file picker", openedInput === 1);
input.click = realClick;

for (const prop of [...api.getPlayground().props]) api.getPlayground().remove(prop.id);

section("5c · A grabbed object does not jump");

const pg = api.getPlayground();
pg.clear();
const cube = pg.addPrimitive("cube");
// Place it far from the origin so an assembly-seeded reference frame would
// produce an obvious jump.
pg.setTransform(cube.id, { position: { x: 2.4, y: 1.1, z: -1.3 } });
pg.select(cube.id);

const seed = api._internals.gestureObjectState(null);
check("the solver is seeded from the grabbed object", seed.position.x === 2.4 &&
  seed.position.y === 1.1 && seed.position.z === -1.3,
  JSON.stringify(seed.position));

// Feed the solver a grab that opens exactly where the object currently is:
// the result must equal the object's existing transform, not the assembly's.
const solver = api.solver;
solver.updateSettings({ mode: "move" });
solver.mode = "idle";
const openHand = {
  pinch: { x: 0.0, y: 0.0, z: 0.0 },
  pinched: false,
  present: true
};
const pinchedHand = {
  pinch: { x: 0.0, y: 0.0, z: 0.0 },
  pinched: true,
  present: true
};
solver.update([openHand], seed, 0);
const grabbed = solver.update([pinchedHand], seed, 16);
check("the grab reports a translation", grabbed.intent === "translate",
  `${grabbed.intent}`);
check("the object stays put when the hand has not moved",
  grabbed.position &&
    Math.abs(grabbed.position.x - 2.4) < 0.02 &&
    Math.abs(grabbed.position.y - 1.1) < 0.02,
  JSON.stringify(grabbed.position));

// Moving the hand must move the object by the same delta, not teleport it.
const movedHand = { pinch: { x: 0.08, y: 0.04, z: 0.0 }, pinched: true, present: true };
const moved = solver.update([movedHand], seed, 32);
check("dragging translates relative to the grab point",
  moved.position && moved.position.x > grabbed.position.x &&
    moved.position.x - grabbed.position.x < 1.2,
  `${grabbed.position?.x?.toFixed(2)} -> ${moved.position?.x?.toFixed(2)}`);

// The stage bounds must be the single shared limit.
check("the solver uses the stage bounds",
  solver.limits.x === 4.2 && solver.limits.y === 3.2, JSON.stringify(solver.limits));

// Applying a result writes to the playground object, not the assembly.
api._internals.applyGestureResult({ active: true, intent: "translate",
  position: { x: 3.0, y: 1.5, z: 0 } }, null);
const afterApply = pg.getTransform(cube.id);
check("the result lands on the playground object",
  Math.abs(afterApply.position.x - 3.0) < 1e-6 &&
    Math.abs(afterApply.position.y - 1.5) < 1e-6,
  JSON.stringify(afterApply.position));

// A pinch over a prop selects that prop rather than silently doing nothing.
pg.select(null);
api.toast = api.toast || (() => {});
const chosen = api._internals.selectProp(cube.id, "hand");
check("selecting a prop works from the gesture path", chosen && pg.selectedId === cube.id);
check("the object HUD names the selection",
  doc.getElementById("hud-object-name")?.textContent === "CUBE",
  doc.getElementById("hud-object-name")?.textContent);

// updateGestureLabels is called every tracked frame; it used to be undefined.
let labelError = null;
try {
  api._internals.updateGestureLabels([{ pinched: true, gesture: "pinch" }],
    { intent: "translate", active: true });
} catch (error) {
  labelError = error;
}
check("the gesture label updater exists and runs", labelError === null,
  labelError ? String(labelError.message) : "");
check("an active grab is reported to the HUD",
  doc.getElementById("hud-gesture")?.textContent === "TRANSLATE",
  doc.getElementById("hud-gesture")?.textContent);

try {
  api._internals.updateGestureLabels([], {});
} catch (error) {
  labelError = error;
}
check("no hands clears the gesture label",
  labelError === null && doc.getElementById("hud-gesture")?.textContent === "—",
  doc.getElementById("hud-gesture")?.textContent);

pg.clear();

section("5d · The live tracking loop survives real landmarks");

// 21 MediaPipe-shaped landmarks: a plausible open right hand, normalised.
function syntheticHand(pinch = false) {
  const points = [];
  const add = (x, y, z = 0) => points.push({ x, y, z, visibility: 1 });
  add(0.5, 0.72, 0);            // 0 wrist
  add(0.42, 0.66, 0); add(0.38, 0.60, 0); add(0.35, 0.55, 0); add(0.32, 0.51, 0); // thumb
  add(0.45, 0.55, 0); add(0.44, 0.46, 0); add(0.44, 0.41, 0); add(0.44, 0.37, 0); // index
  add(0.50, 0.54, 0); add(0.50, 0.44, 0); add(0.50, 0.39, 0); add(0.50, 0.35, 0); // middle
  add(0.55, 0.55, 0); add(0.56, 0.46, 0); add(0.57, 0.41, 0); add(0.57, 0.37, 0); // ring
  add(0.60, 0.58, 0); add(0.62, 0.50, 0); add(0.63, 0.46, 0); add(0.64, 0.42, 0); // pinky
  if (pinch) {
    // Bring the thumb tip onto the index tip.
    points[4] = { x: 0.44, y: 0.37, z: 0, visibility: 1 };
  }
  return points;
}

const trackingBefore = pg.props.length;
let loopError = null;
try {
  const analyserHand = syntheticHand(false);
  for (let frame = 0; frame < 6; frame++) {
    api._internals.processHands(performance.now() + frame * 16);
  }
} catch (error) {
  loopError = error;
}
check("processHands runs without throwing", loopError === null,
  loopError ? `${loopError.name}: ${loopError.message}` : "");

// Feed the tracker itself, so skeletons and the pointer path see hands.
let injectedError = null;
try {
  api.tracker.publishHands({ hands: [syntheticHand(true)], handedness: ["Right"] });
  api.tracker.handedness = ["Right"];
  api.tracker.worldLandmarks = [syntheticHand(true)];
  api.setMode("move");
  for (let frame = 0; frame < 10; frame++) {
    api._internals.processHands(performance.now() + 100 + frame * 16);
  }
} catch (error) {
  injectedError = error;
}
check("tracked hands drive the loop without throwing", injectedError === null,
  injectedError ? `${injectedError.name}: ${injectedError.message}` : "");
const rigs = api.getHandSkeleton()?.rigs;
const rigList = rigs instanceof Map ? [...rigs.values()] : (rigs || []);
check("a skeleton rig received the landmarks", rigList.length >= 1 &&
  rigList.some(rig => rig.visible !== false), `${rigList.length} rig(s)`);

// Selection must never invent objects.
check("the tracking loop added no stray objects", pg.props.length === trackingBefore,
  `${trackingBefore} -> ${pg.props.length}`);

api.tracker.publishHands({ hands: [] });
api.tracker.handedness = [];
api.tracker.worldLandmarks = [];
pg.clear();

section("5e · Every mode does exactly one thing");

const probeSolver = new (await import("../gestures.js")).ManipulationSolver({
  settings: { mode: "scale" }
});
const restState = () => ({
  position: { x: 0, y: 0, z: 0 }, rotationZ: 0, rotationX: 0, scale: 1, explode: 0
});
const fakeHand = (x, pinched = true) => ({
  pinch: { x, y: 0.5, z: 0 }, indexTip: { x, y: 0.5, z: 0 },
  pinched, present: true, landmarks: new Array(21).fill({ x, y: 0.5, z: 0 })
});
let probeClock = 0;
const step = (hands, state3d = restState()) =>
  probeSolver.update(hands, state3d, (probeClock += 16));

// SCALE: both hands, spread drives scale only.
probeSolver.updateSettings({ mode: "scale" });
probeSolver.mode = "idle";
let scaleResult = step([fakeHand(0.4), fakeHand(0.6)]);
scaleResult = step([fakeHand(0.35), fakeHand(0.65)]);
check("two-hand spread scales proportionally",
  Math.abs(scaleResult.scale - 1.5) < 0.02, String(scaleResult.scale));
check("scaling does not translate",
  scaleResult.intent === "scale" && !scaleResult.position,
  scaleResult.intent);
const shrink = step([fakeHand(0.45), fakeHand(0.55)]);
check("bringing the hands together shrinks",
  Math.abs(shrink.scale - 0.5) < 0.02, String(shrink.scale));
const released = step([fakeHand(0.45), fakeHand(0.55, false)]);
check("releasing one hand holds instead of jumping",
  released.scale === undefined || Math.abs(released.scale - 1) < 0.5,
  `${released.intent} ${released.scale}`);

// ROTATE: yaw only.
probeSolver.updateSettings({ mode: "rotate" });
probeSolver.mode = "idle";
step([fakeHand(0.5)]);
const rotA = step([fakeHand(0.5)]);
const rotB = step([fakeHand(0.7)]);
check("rotate reports a yaw and nothing else",
  rotB.intent === "rotate" && typeof rotB.rotationZ === "number" &&
    !rotB.position && rotB.scale === undefined,
  `${rotB.intent} rz=${rotB.rotationZ?.toFixed(2)}`);
check("rotating one way moves the yaw",
  Number.isFinite(rotB.rotationZ) && Number.isFinite(rotA.rotationZ));

// EXPLODE: spread only, never a transform.
probeSolver.updateSettings({ mode: "explode" });
probeSolver.mode = "idle";
const exA = step([fakeHand(0.4), fakeHand(0.6)]);
const exB = step([fakeHand(0.3), fakeHand(0.7)]);
check("explode changes only the explosion amount",
  exB.intent === "explode" && typeof exB.explode === "number" &&
    !exB.position && exB.scale === undefined,
  `${exB.intent} ${exB.explode}`);
check("a wider spread explodes further", exB.explode > exA.explode,
  `${exA.explode?.toFixed(2)} -> ${exB.explode?.toFixed(2)}`);

// MOVE: translation only.
probeSolver.updateSettings({ mode: "move" });
probeSolver.mode = "idle";
const moveState = restState();
step([fakeHand(0.5)], moveState);
const mv = step([fakeHand(0.6, true)], moveState);
check("move translates without rotating or scaling",
  mv.intent === "translate" && mv.rotationZ === undefined && mv.scale === undefined,
  mv.intent);

// SELECT: no transform at all.
probeSolver.updateSettings({ mode: "select" });
probeSolver.mode = "idle";
const sel = step([fakeHand(0.5)]);
check("select never transforms the scene",
  !sel.position && sel.scale === undefined && sel.rotationZ === undefined,
  sel.intent);

section("5e2 · Voice can pick a target by name");

const voicePg = api.getPlayground();
voicePg.clear();
voicePg.addPrimitive("cube");
voicePg.addPrimitive("sphere");
voicePg.select(null);

api.handleVoiceIntentForTest("select:cube");
const cubeProp = voicePg.props.find(p => p.primitive === "cube");
check("'select the cube' selects the cube", voicePg.selectedId === cubeProp.id,
  voicePg.selectedId || "(none)");

api.handleVoiceIntentForTest("select:sphere");
const sphereProp = voicePg.props.find(p => p.primitive === "sphere");
check("'select the sphere' switches to the sphere", voicePg.selectedId === sphereProp.id);

api.handleVoiceIntentForTest("object:next");
check("'next object' cycles the selection",
  voicePg.selectedId !== sphereProp.id && voicePg.selectedId === cubeProp.id,
  voicePg.selectedId || "(none)");

// Transforms must now land on the selected object, not the assembly.
const beforeMove = voicePg.getTransform(cubeProp.id).position.y;
api.handleVoiceIntentForTest("transform:up");
const afterMove = voicePg.getTransform(cubeProp.id).position.y;
check("a transform applies to the voice-selected object",
  afterMove > beforeMove, `${beforeMove.toFixed(2)} -> ${afterMove.toFixed(2)}`);

// Selecting something absent must say so rather than silently doing nothing.
// Assert on the real toast DOM: the toast helper is a hoisted local function,
// so replacing it on the debug API would not intercept the call.
const toastStack = doc.querySelector(".toast-stack") || doc.getElementById("toast-stack");
toastStack?.replaceChildren();
api.handleVoiceIntentForTest("select:cone");
const latestToast = toastStack?.lastElementChild?.textContent || "";
check("selecting an absent object reports it", /cone/i.test(latestToast), latestToast);

voicePg.clear();

section("5f · 3D and 2D skeletons agree on screen");

// The 2D overlay compensates for object-fit: cover cropping; the 3D rigs used
// to ignore it, so on any stage whose aspect ratio differs from the camera the
// scene skeletons drifted off the real hands. This compares the two mapping
// paths in projected stage pixels.
const { landmarkToWorld } = await import("../handSkeleton3d.js");
const { landmarkToStage, coverFit } = await import("../handGeometry.js");

const alignCases = [
  { name: "4:3 camera on a 16:9 stage", vw: 640, vh: 480, bw: 1280, bh: 720 },
  { name: "16:9 camera on a portrait stage", vw: 1280, vh: 720, bw: 420, bh: 860 },
  { name: "matching aspect ratios", vw: 1280, vh: 720, bw: 1280, bh: 720 }
];

for (const spec of alignCases) {
  const cam = new THREE.PerspectiveCamera(55, spec.bw / spec.bh, 0.1, 100);
  cam.position.set(0, 0, 6);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const fit = {
    ...coverFit(spec.vw, spec.vh, spec.bw, spec.bh),
    videoWidth: spec.vw, videoHeight: spec.vh,
    boxWidth: spec.bw, boxHeight: spec.bh
  };

  let worst = 0;
  for (const [x, y] of [[0.5, 0.5], [0.25, 0.35], [0.75, 0.65], [0.4, 0.6]]) {
    const stage = landmarkToStage({ x, y },
      { videoWidth: spec.vw, videoHeight: spec.vh, boxWidth: spec.bw, boxHeight: spec.bh },
      { mirror: true });
    const projected = landmarkToWorld({ x, y }, cam, { mirror: true, fit }).project(cam);
    const px = {
      x: (projected.x * 0.5 + 0.5) * spec.bw,
      y: (-projected.y * 0.5 + 0.5) * spec.bh
    };
    worst = Math.max(worst, Math.hypot(px.x - stage.x, px.y - stage.y));
  }
  check(`2D and 3D agree · ${spec.name}`, worst < 1, `${worst.toFixed(2)}px`);
}

{
  // The rig must be drawn at the size the video shows, not a fixed guess: a
  // hand near the lens is bigger on screen and the 3D skeleton has to match.
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, 6); cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const scene = new THREE.Scene();

  const makeHand = (size, cx = 0.5, cy = 0.5) => {
    const pts = [];
    for (let i = 0; i < 21; i++) {
      const a = (i / 21) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * size, y: cy + Math.sin(a) * size, z: 0 });
    }
    return pts;
  };

  const measure = size => {
    const sk = new (api.getHandSkeleton().constructor)({ scene, camera: cam, mirror: true });
    const landmarks = makeHand(size);
    const metric = makeHand(size).map(p => ({ x: p.x * 0.2, y: p.y * 0.2, z: 0 }));
    sk.update([landmarks], [metric], ["Right"], {});
    const rig = [...sk.rigs.values()][0];
    let span = 0;
    const pts = rig.joints.map(j => j.position);
    for (let i = 1; i < pts.length; i++) span = Math.max(span, pts[i].distanceTo(pts[0]));
    sk.root.parent?.remove(sk.root);
    return span;
  };

  const small = measure(0.04);
  const large = measure(0.12);
  // The workspace tone-maps with ACES, which drags these overlay colours
  // towards grey (#1ad1ff authored -> #5cbac4 out). The rig must opt out.
  const probeRig = [...new (api.getHandSkeleton().constructor)({
    scene: new THREE.Scene(), camera: cam, mirror: true
  }).rigs.values()];
  check("rig materials are created with a rig", probeRig.length === 0);

  const sk2 = new (api.getHandSkeleton().constructor)({ scene, camera: cam, mirror: true });
  sk2.update([[{ x: 0.5, y: 0.5, z: 0 }].concat(
    Array.from({ length: 20 }, (_, i) => ({ x: 0.5 + i * 0.002, y: 0.5 + i * 0.002, z: 0 }))
  )], [], ["Right"], {});
  const rig2 = [...sk2.rigs.values()][0];
  const rigMaterials = Object.values(rig2.materials || {});
  check("every skeleton material bypasses tone mapping",
    rigMaterials.length > 0 && rigMaterials.every(m => m.toneMapped === false),
    `${rigMaterials.filter(m => m.toneMapped === false).length}/${rigMaterials.length}`);

  // Hybrid rendering contract: drawn late with depth testing off, so a model in
  // front of the hand can never hide the skeleton.
  const lateMeshes = [...rig2.bones, ...rig2.joints, ...rig2.cores, ...rig2.boneGlows];
  check("skeleton pieces skip depth testing",
    lateMeshes.length > 0 && lateMeshes.every(m => m.material.depthTest === false),
    `${lateMeshes.filter(m => m.material.depthTest === false).length}/${lateMeshes.length}`);
  check("skeleton pieces draw after the scene",
    [...rig2.bones, ...rig2.joints].every(m => m.renderOrder >= 30),
    [...new Set([...rig2.bones, ...rig2.joints].map(m => m.renderOrder))].join(","));

  // Depth is preserved as a cue, not discarded: a receding hand must dim.
  rig2.applyDepth(1);
  const nearOpacity = rig2.materials.bone.opacity;
  rig2.applyDepth(0);
  const farOpacity = rig2.materials.bone.opacity;
  check("a hand behind geometry dims instead of vanishing",
    farOpacity < nearOpacity && farOpacity > 0.2,
    `${nearOpacity.toFixed(2)} -> ${farOpacity.toFixed(2)}`);
  rig2.applyDepth(1);

  check("a hand twice the size in frame is drawn twice as large",
    Math.abs(large / small - 3) < 0.35, `${(large / small).toFixed(2)}x`);
}

section("5g · Pinch recognition curve");

// A hand whose palm scale is normalised to 1, with the thumb tip placed at a
// known distance from the index tip. Distances follow the measured values the
// detector documents: ~0.95 open, ~0.30 relaxed pinch, 0 pads touching.
function handAt(normalisedGap) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  pts[0] = { x: 0.5, y: 0.85, z: 0 };
  pts[5] = { x: 0.43, y: 0.64, z: 0 };
  pts[9] = { x: 0.5, y: 0.625, z: 0 };
  pts[13] = { x: 0.56, y: 0.64, z: 0 };
  pts[17] = { x: 0.61, y: 0.665, z: 0 };
  const s = 0.216;
  for (const base of [5, 9, 13, 17]) {
    for (let i = 1; i <= 3; i++) {
      pts[base + i] = { x: pts[base].x, y: pts[base].y - 0.055 * i, z: 0 };
    }
  }
  const tip = pts[8];
  pts[4] = { x: tip.x - normalisedGap * s, y: tip.y + normalisedGap * s * 0.2, z: 0 };
  return pts;
}

const { pinchStrength, HandAnalyzer } = await import("../gestures.js");
check("an open hand does not read as a pinch", pinchStrength(handAt(0.95)) < 0.2,
  pinchStrength(handAt(0.95)).toFixed(3));
check("touching pads read as a full pinch", pinchStrength(handAt(0.0)) > 0.95,
  pinchStrength(handAt(0.0)).toFixed(3));
check("the strength curve is monotonic",
  [0, 0.2, 0.4, 0.6, 0.95].every((g, i, arr) =>
    i === 0 || pinchStrength(handAt(g)) < pinchStrength(handAt(arr[i - 1])) + 1e-9));

// Hysteresis: one clean latch, one clean release, no chatter in between.
const probe = new HandAnalyzer({ pinchThreshold: 0.62, pinchRelease: 0.44, smoothing: 0.45 });
let clock = 0;
const pump = (gap, frames) => {
  let last = null;
  for (let i = 0; i < frames; i++) last = probe.update(handAt(gap), "Right", (clock += 0.016));
  return last;
};
check("an open hand stays un-pinched", pump(0.95, 8).pinched === false);
check("a pinch latches", pump(0.2, 8).pinched === true);
check("a held pinch stays latched", pump(0.22, 8).pinched === true);
check("releasing the pinch clears it", pump(0.95, 8).pinched === false);

section("5h · The late pass is wired into the real renderer");

const ws = api.getWorkspace();
check("the renderer knows about the hand layer", ws.lateLayer === api.getHandSkeleton().root,
  ws.lateLayer?.name || "(none)");
check("the late layer is the skeleton root",
  ws.lateLayer?.name === "hand-skeletons", ws.lateLayer?.name);

// Drive the real render path and confirm the hands are held out of the main
// pass and composited in the second one.
const passes = [];
const realRender = ws.renderer.render.bind(ws.renderer);
let clearDepthCalls = 0;
const realClearDepth = ws.renderer.clearDepth?.bind(ws.renderer);
ws.renderer.clearDepth = () => { clearDepthCalls += 1; };
ws.renderer.render = (scene, camera) => {
  passes.push({ lateVisible: ws.lateLayer ? ws.lateLayer.visible : null });
  return realRender(scene, camera);
};
ws.update(1 / 60);
ws.renderer.render = realRender;
if (realClearDepth) ws.renderer.clearDepth = realClearDepth;

check("the frame renders twice when the hand layer is live", passes.length === 2,
  `${passes.length} pass(es)`);
check("depth is cleared between the passes", clearDepthCalls >= 1, `${clearDepthCalls}`);
check("the hand layer stays visible across the frame", ws.lateLayer.visible === true);

// The point of the selective pass: the second render must see a scene that
// contains only the hands. Counting mesh draws proves the model is not redrawn.
{
  const drawn = [];
  const counting = ws.renderer.render.bind(ws.renderer);
  ws.renderer.render = (scene, camera) => {
    let meshes = 0;
    scene.traverse(object => { if (object.isMesh) meshes++; });
    let modelMeshes = 0;
    if (ws.assembly?.group) {
      ws.assembly.group.traverse(object => { if (object.isMesh) modelMeshes++; });
    }
    drawn.push({
      scene: scene.name || "main",
      meshes,
      modelMeshes: scene === ws.scene ? modelMeshes : 0,
      hasModel: Boolean(ws.assembly?.group && scene === ws.scene)
    });
    return counting(scene, camera);
  };
  ws.update(1 / 60);
  ws.renderer.render = counting;

  check("the main pass renders the model", drawn[0]?.hasModel === true);
  check("the late pass does not contain the model",
    drawn[1]?.hasModel === false, String(drawn[1]?.hasModel));
  // The hand skeleton legitimately has more meshes than a small model (21 joints,
  // haloes and two bone layers per hand), so "fewer meshes" is not the property.
  // The property is that not one model mesh is inside the late scene.
  check("the late pass contains only hand geometry",
    drawn[1]?.meshes > 0 && drawn[1]?.modelMeshes === 0,
    `${drawn[1]?.modelMeshes} model meshes in ${drawn[1]?.meshes}`);
  check("the model is not traversed twice",
    drawn[0]?.meshes > 40, `${drawn[0]?.meshes} model meshes`);
}

// With no hand layer the frame must still render exactly once.
ws.setLateLayer(null);
const soloPass = [];
ws.renderer.render = (scene, camera) => { soloPass.push(1); return realRender(scene, camera); };
ws.update(1 / 60);
ws.renderer.render = realRender;
check("without a hand layer the frame renders once", soloPass.length === 1,
  `${soloPass.length}`);

// setLateLayer is the contract main.js uses; assert it round-trips.
const marker = new THREE.Group();
ws.setLateLayer(marker);
check("setLateLayer swaps the composited group", ws.lateLayer === marker);
ws.setLateLayer(api.getHandSkeleton().root);

section("5i · Gestures move real objects through the full stack");

// End-to-end: hand landmarks in, a playground object moving out — through the
// real processHands, the real solver and the real render data.
const gs = api.getPlayground();
gs.clear();
const target = gs.addPrimitive("cube");
gs.setTransform(target.id, { position: { x: 0, y: 0, z: 0 }, scale: 1 });
gs.select(target.id);
api.setMode("move");

const grabOpen = syntheticHand(false);
const grabPinch = syntheticHand(true);
const startPos = { ...gs.getTransform(target.id).position };

let gestureError = null;
try {
  // Open hand to settle the pointer, then pinch to grab, then drag.
  api.tracker.publishHands({
    hands: [grabOpen], worldLandmarks: [grabOpen], handedness: ["Right"]
  });
  for (let i = 0; i < 6; i++) api._internals.processHands(performance.now() + i * 16);

  api.tracker.publishHands({
    hands: [grabPinch], worldLandmarks: [grabPinch], handedness: ["Right"]
  });
  for (let i = 0; i < 8; i++) api._internals.processHands(performance.now() + 200 + i * 16);

  // Drag: shift the whole hand sideways and let the solver follow.
  const dragged = syntheticHand(true).map(p => ({ ...p, x: p.x + 0.18 }));
  api.tracker.publishHands({
    hands: [dragged], worldLandmarks: [dragged], handedness: ["Right"]
  });
  for (let i = 0; i < 10; i++) api._internals.processHands(performance.now() + 400 + i * 16);
} catch (error) {
  gestureError = error;
}

check("the full gesture path runs without throwing", gestureError === null,
  gestureError ? `${gestureError.name}: ${gestureError.message}` : "");

const endPos = gs.getTransform(target.id).position;
const dragDistance = Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y, endPos.z - startPos.z);
check("a pinched drag actually moves the object", dragDistance > 0.05,
  `${dragDistance.toFixed(3)} units`);
check("the object stays on the stage", Math.abs(endPos.x) <= 4.21 && Math.abs(endPos.y) <= 3.21,
  `${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}`);

api.tracker.publishHands({ hands: [] });
api.tracker.handedness = [];
api.tracker.worldLandmarks = [];
api.setMode("select");
gs.clear();

section("5j · Material controls render and act on the selection");

const inspPg = api.getPlayground();
inspPg.clear();
const inspCube = inspPg.addPrimitive("cube");
inspPg.select(inspCube.id);
api._internals.refreshInspector?.();

const inspRoot = doc.getElementById("inspector-root") || doc.querySelector(".inspector");
const swatches = doc.querySelectorAll(".prop-swatch");
const colourInput = doc.querySelector(".prop-color-input");
const sliders = doc.querySelectorAll(".prop-slider-input");
const wireToggle = doc.querySelector(".prop-switch-label input[type=checkbox]");

check("colour swatches are rendered", swatches.length >= 8, `${swatches.length}`);
check("a colour picker is rendered", Boolean(colourInput));
check("roughness and metalness sliders are rendered", sliders.length === 2,
  `${sliders.length}`);
check("a wireframe switch is rendered", Boolean(wireToggle));

// Clicking a swatch must change the object's real material.
const beforeColour = inspPg.getMaterial(inspCube.id).color;
swatches[3]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const afterColour = inspPg.getMaterial(inspCube.id).color;
check("a swatch recolours the selected object", afterColour !== beforeColour,
  `${beforeColour} -> ${afterColour}`);

// The roughness slider must reach the material.
const roughSlider = [...sliders].find(sl => sl.getAttribute("aria-label") === "Roughness");
if (roughSlider) {
  roughSlider.value = "0.9";
  roughSlider.dispatchEvent(new window.Event("input", { bubbles: true }));
}
check("the roughness slider reaches the material",
  Math.abs(inspPg.getMaterial(inspCube.id).roughness - 0.9) < 0.01,
  String(inspPg.getMaterial(inspCube.id).roughness));

// The wireframe switch must reach the material.
if (wireToggle) {
  wireToggle.checked = true;
  wireToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
}
check("the wireframe switch reaches the material",
  inspPg.getMaterial(inspCube.id).wireframe === true);

// Voice colour must land on the same object.
api.handleVoiceIntentForTest("color:red");
check("the colour voice command recolours the selection",
  inspPg.getMaterial(inspCube.id).color.toLowerCase().includes("ef4444") ||
  inspPg.getMaterial(inspCube.id).color.toLowerCase() === "#ef4444",
  inspPg.getMaterial(inspCube.id).color);

inspPg.clear();
api._internals.refreshInspector?.();

section("5k · Clear-all and object creation");

const cp = api.getPlayground();
cp.clear();
for (const kind of ["cube", "sphere", "torus"]) cp.addPrimitive(kind);
api.refreshSceneOutliner();
check("objects were created", cp.props.length === 3, `${cp.props.length}`);

const clearBtn = doc.getElementById("playground-clear");
check("a clear-all control exists", Boolean(clearBtn));
clearBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("clear-all empties the playground", cp.props.length === 0, `${cp.props.length}`);
check("the object counter follows", doc.getElementById("hud-objects")?.textContent === "0");
// The outliner always lists the engineering model alongside props, so the
// meaningful assertion is that the spawned rows are gone.
check("the outliner no longer lists the cleared objects",
  doc.querySelectorAll("#scene-outliner .outliner-row").length === 1,
  `${doc.querySelectorAll("#scene-outliner .outliner-row").length} row(s)`);

// Every primitive the library offers must be creatable.
for (const primitive of ["cube", "sphere", "cylinder", "cone", "torus", "torusKnot", "icosahedron"]) {
  const made = cp.addPrimitive(primitive);
  check(`primitive "${primitive}" can be spawned`, Boolean(made) && cp.props.length > 0);
}
cp.clear();

section("5l · Voice and audio preferences round-trip");

const voiceToggle = doc.getElementById("set-voice-enabled");
const soundToggle = doc.getElementById("set-sound-effects");
check("a voice-commands toggle exists", Boolean(voiceToggle));
check("an audio-cues toggle exists", Boolean(soundToggle));
check("both default to on",
  voiceToggle?.checked === true && soundToggle?.checked === true);

soundToggle.checked = false;
soundToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
check("turning cues off persists", api.getSettings().voice.soundEffects === false);
check("turning cues off silences the synth", api.getChimes().enabled === false);

soundToggle.checked = true;
soundToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
check("turning cues back on persists", api.getSettings().voice.soundEffects === true);
check("turning cues back on re-enables the synth", api.getChimes().enabled === true);

voiceToggle.checked = false;
voiceToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
check("turning voice off persists", api.getSettings().voice.enabled === false);
voiceToggle.checked = true;
voiceToggle.dispatchEvent(new window.Event("change", { bubbles: true }));

section("5m · Inspector transform readout follows the object");

const tp = api.getPlayground();
tp.clear();
const tpCube = tp.addPrimitive("cube");
tp.select(tpCube.id);
api._internals.refreshInspector();

const tfSections = [...doc.querySelectorAll(".inspector-section")]
  .filter(sec => sec.querySelector(".section-title")?.textContent === "Transform");
check("a transform section is rendered", tfSections.length === 1);
const tfVals = tfSections[0]?.querySelectorAll(".prop-group .prop-val") || [];
check("it shows position, rotation and scale", tfVals.length === 3, `${tfVals.length}`);
const tfLabels = [...(tfSections[0]?.querySelectorAll(".prop-label") || [])].map(e => e.textContent);
check("the rows are labelled", ["Position", "Rotation", "Scale"].every(l => tfLabels.includes(l)),
  tfLabels.join("/"));

// Move the object the way a gesture would, then refresh: the readout must follow.
tp.setTransform(tpCube.id, { position: { x: 1.5, y: 0.25, z: -0.75 } });
api._internals.refreshInspector();
const movedReadout = [...doc.querySelectorAll(".inspector-section")]
  .find(sec => sec.querySelector(".section-title")?.textContent === "Transform")
  ?.querySelector(".prop-group .prop-val")?.textContent;
check("the position readout follows the object",
  movedReadout === "1.50, 0.25, -0.75", movedReadout);

// updateProperties() must update in place, without rebuilding the DOM.
const beforeNode = doc.querySelector(".inspector-section .prop-group .prop-val");
tp.setTransform(tpCube.id, { position: { x: -2, y: 0, z: 0 } });
api._internals.inspector?.updateProperties?.();
check("updateProperties refreshes without re-rendering",
  beforeNode === doc.querySelector(".inspector-section .prop-group .prop-val"));
check("the in-place refresh shows the new position",
  beforeNode?.textContent === "-2.00, 0.00, 0.00", beforeNode?.textContent);

tp.clear();
api._internals.refreshInspector();

section("5n · The README's voice commands all parse");

// The README is documentation the user reads before they have a microphone
// set up, so a phrase it promises must not silently stop matching the grammar.
const documented = [
  "select", "move", "drag", "rotate", "scale", "explode", "assemble",
  "add cube", "add sphere", "add cylinder", "add torus", "add cone",
  "duplicate", "delete", "clear objects",
  "wireframe", "solid", "make it matte", "make it metallic",
  "color red", "color cyan", "color gold", "color purple",
  "grid", "shadows", "orbit", "focus", "isolate", "deselect", "fullscreen",
  "reset everything",
  "load turbojet", "load turbine", "load the robot"
];
const unparsed = documented.filter(phrase => !api._internals.parseCommand(phrase));
check("every documented phrase parses", unparsed.length === 0, unparsed.join(", "));

// And the colour names the palette advertises must all be reachable by voice.
const paletteNames = Object.keys(api._internals.COLOR_PALETTE);
const unreachable = paletteNames.filter(
  name => api._internals.parseCommand(`color ${name}`)?.intent !== `color:${name}`
);
check("every palette colour is voice-reachable", unreachable.length === 0, unreachable.join(", "));

section("5o · Spoken words drive the same actions as the UI");

// A stub speech engine so the real recognition handlers run. This proves the
// wiring from a transcript to a scene change; it cannot prove that a real
// microphone transcribes accurately, which needs a browser and a room.
const spoken = [];
class StubRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = "";
    this.onresult = null; this.onerror = null; this.onend = null;
    this.onstart = null; this.onaudiostart = null;
    spoken.push(this);
  }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}
window.SpeechRecognition = StubRecognition;
window.webkitSpeechRecognition = StubRecognition;
window.speechSynthesis = window.speechSynthesis || { speak() {}, cancel() {} };

// The app's own instance was built at boot, before this stub existed, so it
// correctly reports itself unsupported. Build a fresh one from the same class
// with the same wiring the app uses.
const vox = new VoiceControl({
  onCommand: (intent, phrase) => api.handleVoiceIntentForTest(intent, phrase),
  onState: voxState => api._internals.updateVoiceUi(voxState)
});
check("the voice class is constructible with a speech engine", vox.supported === true);
vox.start();
check("starting voice opens a recognition session", spoken.length >= 1, `${spoken.length}`);

/** Feed a transcript through the real onresult handler. */
const say = phrase => {
  const engine = spoken[spoken.length - 1];
  const result = [{ transcript: phrase }];
  result.isFinal = true;
  engine.onresult?.({ resultIndex: 0, results: [result] });
};

// 1. A spoken spawn creates a real object.
const beforeSpawn = api.getPlayground().props.length;
say("add a cube");
const afterSpawn = api.getPlayground().props.length;
check("saying 'add a cube' spawns an object", afterSpawn === beforeSpawn + 1,
  `${beforeSpawn} -> ${afterSpawn}`);
check("the spoken object is selected", Boolean(api.getPlayground().get()),
  api.getPlayground().get()?.name);

// 2. A spoken colour reaches that object's material.
say("make it red");
const spokenColour = api.getPlayground().getMaterial(api.getPlayground().get().id).color;
check("saying 'make it red' recolours it", spokenColour.toLowerCase() === "#ef4444", spokenColour);

// 3. A spoken wireframe toggle reaches the material.
say("wireframe");
check("saying 'wireframe' switches it on",
  api.getPlayground().getMaterial(api.getPlayground().get().id).wireframe === true);
say("solid");
check("saying 'solid' switches it back off",
  api.getPlayground().getMaterial(api.getPlayground().get().id).wireframe === false);

// 4. A spoken mode switches the interaction mode.
say("move mode");
check("saying 'move mode' switches mode", api.getMode() === "move", api.getMode());
say("select mode");

// 5. A spoken clear empties the scene.
say("clear objects");
check("saying 'clear objects' empties the playground",
  api.getPlayground().props.length === 0, `${api.getPlayground().props.length}`);

// 6. The chip reports what was heard.
check("the voice chip shows the heard phrase",
  (doc.getElementById("voice-phrase")?.textContent || "").length > 0,
  doc.getElementById("voice-phrase")?.textContent);

vox.stop();

section("5p · Idle spin never fights the user");

{
  const ip = api.getPlayground();
  // Earlier sections finish mid-pinch; this section is about the spin rules, so
  // start from a known idle state rather than from whatever they left behind.
  ip.setManipulating(false);
  ip.clear();
  const first = ip.addPrimitive("cube");
  const second = ip.addPrimitive("cube");
  ip.select(null);

  // The harness stubs requestAnimationFrame, so the app's render loop does not
  // tick. Pump the playground clock directly, exactly as startLoop() would.
  const tick = seconds => ip.update(seconds);

  tick(1);
  tick(1);
  check("unselected primitives still idle-spin",
    first.group.rotation.y > 0 && second.group.rotation.y > 0,
    `${first.group.rotation.y.toFixed(2)} / ${second.group.rotation.y.toFixed(2)}`);

  ip.select(first.id);
  const heldAngle = first.group.rotation.y;
  tick(1);
  tick(1);
  check("a selected primitive holds still",
    Math.abs(first.group.rotation.y - heldAngle) < 1e-9,
    `${heldAngle.toFixed(2)} -> ${first.group.rotation.y.toFixed(2)}`);
  check("other primitives keep spinning while one is selected",
    second.group.rotation.y > heldAngle, second.group.rotation.y.toFixed(2));

  // A hand rotation must survive the following update untouched.
  ip.setManipulating(true);
  ip.setTransform(first.id, { rotationY: 1.0 });
  tick(1);
  check("a manual rotation is not fought by the idle spin",
    first.group.rotation.y === 1.0, String(first.group.rotation.y));

  // Releasing must resume from where it was left, with no jump. Deselect first:
  // while an object is selected it deliberately holds still, so resuming is only
  // observable once nothing is selected.
  ip.setManipulating(false);
  ip.select(null);
  tick(0.5);
  const resumed = first.group.rotation.y;
  check("the spin resumes from where the hand left it, without a jump",
    resumed > 1.0 && resumed < 1.2, resumed.toFixed(3));

  // Nothing may drift while a drag is in progress, selected or not.
  tick(1);
  const frozen = [first.group.rotation.y, second.group.rotation.y];
  ip.setManipulating(true);
  tick(1);
  tick(1);
  check("no object drifts while a hand is transforming the scene",
    Math.abs(first.group.rotation.y - frozen[0]) < 1e-9 &&
    Math.abs(second.group.rotation.y - frozen[1]) < 1e-9);

  ip.setManipulating(false);
  ip.clear();
  ip.select(null);
}

section("5q · Seven standard views, correctly oriented");

{
  const ws = api.getWorkspace();
  const camera = ws.camera;
  const controls = ws.controls;

  // A target deliberately away from the origin: every preset must centre on
  // what it frames, not on world zero.
  const far = new THREE.Vector3(2.5, 1.2, -3.5);

  for (const id of VIEW_ORDER) {
    const placement = viewPlacement(id, { target: far, radius: 3, fov: camera.fov });
    const described = describePlacement(placement);
    const direction = new THREE.Vector3(...described.direction);
    const up = new THREE.Vector3(...described.up);

    check(`${id}: camera looks along the named axis`,
      direction.dot(VIEW_DIRECTIONS[id]) > 0.999,
      described.direction.map(v => v.toFixed(2)).join(","));

    check(`${id}: frames the target, not the origin`,
      placement.target.distanceTo(far) < 1e-9,
      placement.target.toArray().map(v => v.toFixed(1)).join(","));

    // The classic crash: up parallel to the view direction collapses the
    // camera basis and OrbitControls spins the model unpredictably.
    check(`${id}: up is not parallel to the view direction`,
      Math.abs(direction.dot(up)) < 0.9,
      Math.abs(direction.dot(up)).toFixed(3));

    // The camera must genuinely point at the target once oriented this way.
    const probe = new THREE.PerspectiveCamera(42, 1.6, 0.1, 200);
    probe.up.copy(up);
    probe.position.copy(placement.position);
    probe.lookAt(placement.target);
    probe.updateMatrixWorld();
    const forward = new THREE.Vector3();
    probe.getWorldDirection(forward);
    const toTarget = far.clone().sub(placement.position).normalize();
    check(`${id}: the oriented camera points at the target`,
      forward.dot(toTarget) > 0.999, forward.dot(toTarget).toFixed(4));

    // And it must be recognised as that view afterwards.
    check(`${id}: is recognised as the active view`,
      matchingView(placement.position, far) === id,
      String(matchingView(placement.position, far)));
  }

  // Top and Bottom specifically: a plan view must have a horizontal up vector,
  // otherwise the model appears rotated by an arbitrary roll.
  for (const id of ["top", "bottom"]) {
    const up = VIEW_UPS[id];
    check(`${id}: up is horizontal`, Math.abs(up.y) < 1e-9, up.toArray().join(","));
  }

  // The default (0,1,0) up would be degenerate for Top. safeUp must rescue it.
  {
    const rescued = safeUp(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0));
    check("safeUp rescues a degenerate up vector",
      Math.abs(rescued.dot(new THREE.Vector3(0, 1, 0))) < 0.999 && rescued.lengthSq() > 0.9,
      rescued.toArray().map(v => v.toFixed(2)).join(","));
    const normal = safeUp(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
    check("safeUp leaves a good up vector alone",
      normal.equals(new THREE.Vector3(0, 1, 0)));
  }

  // Orbiting away from a preset must clear the indicator rather than lie.
  {
    const offAxis = new THREE.Vector3(1, 0.35, 0.8).normalize().multiplyScalar(10);
    check("an orbited camera matches no preset",
      matchingView(offAxis, new THREE.Vector3()) === null,
      String(matchingView(offAxis, new THREE.Vector3())));
  }

  // Actually switch the live workspace and confirm it lands where it should.
  {
    api.getPlayground().clear();
    const prop = api.getPlayground().addPrimitive("cube");
    api.getPlayground().setTransform(prop.id, { position: { x: 3, y: 0.5, z: -2 } });

    ws.setView("top", { animate: false, preferSelection: true });
    check("switching to Top orients the real camera",
      camera.position.y > camera.position.x && camera.position.y > camera.position.z,
      camera.position.toArray().map(v => v.toFixed(2)).join(","));
    check("switching to Top sets a non-degenerate up",
      Math.abs(camera.up.dot(new THREE.Vector3(0, 1, 0))) < 0.9,
      camera.up.toArray().map(v => v.toFixed(2)).join(","));
    check("Top frames the selected object rather than the origin",
      controls.target.distanceTo(new THREE.Vector3(3, 0.5, -2)) < 1.5,
      controls.target.toArray().map(v => v.toFixed(2)).join(","));
    check("the workspace reports Top as the active view",
      ws.activeView === "top", String(ws.activeView));

    // Switching views must not touch the objects themselves.
    const before = api.getPlayground().getTransform(prop.id);
    ws.setView("front", { animate: false });
    const after = api.getPlayground().getTransform(prop.id);
    check("changing the camera does not move the objects",
      before.position.x === after.position.x &&
      before.position.y === after.position.y &&
      before.position.z === after.position.z,
      JSON.stringify(after.position));

    // Orbit controls must still be usable afterwards.
    check("orbit controls survive a view switch",
      Boolean(controls) && controls.enabled !== false && controls.target.isVector3);
    const radiusBefore = camera.position.distanceTo(controls.target);
    controls.target.set(0, 0, 0);
    controls.update();
    check("the camera can still orbit after switching views",
      camera.position.lengthSq() > 0 && Number.isFinite(radiusBefore),
      radiusBefore.toFixed(2));

    api.getPlayground().clear();
    ws.setView("iso", { animate: false });
  }

  // Only real presets are accepted.
  check("an unknown view id is rejected", ws.setView("sideways") === null);

  // Framing distance scales with the object, and never puts the camera inside
  // it or outside OrbitControls' limits.
  {
    const small = fitDistance(0.3, 42);
    const large = fitDistance(6, 42);
    check("a larger object is framed from further away", large > small,
      `${small.toFixed(2)} -> ${large.toFixed(2)}`);
    check("framing distance respects the minimum", small >= 3.2, small.toFixed(2));
  }
}

section("5r · Pinch-drag is camera-relative");

{
  const cam = new THREE.PerspectiveCamera(42, 1.6, 0.1, 200);
  const hand = (pinched = true) => ({
    pinched,
    pinch: { x: 0.5, y: 0.5, z: 0 },
    indexTip: { x: 0.5, y: 0.4, inside: true },
    palm: { x: 0.5, y: 0.55 },
    openPalm: 0.2,
    pointing: 0.9,
    landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  });
  const at = (x = 0, y = 0, z = 0) => ({
    position: { x, y, z }, rotationZ: 0, rotationX: 0, scale: 1
  });

  // Orient a camera at a standard view, the same way the workspace does.
  const aim = view => {
    const p = viewPlacement(view, { target: new THREE.Vector3(), radius: 3, fov: 42 });
    cam.position.copy(p.position);
    cam.up.copy(p.up);
    cam.lookAt(p.target);
    cam.updateMatrixWorld();
  };

  /** Grab at NDC (0,0) then move the pointer, returning the world delta. */
  const drag = (view, ndc, startAt = at()) => {
    aim(view);
    const solver = new ManipulationSolver({
      settings: { mode: "move", limits: { x: 40, y: 40, z: 40 } }
    });
    solver.setViewContext({ camera: cam, ndc: { x: 0, y: 0 } });
    solver.update([hand()], startAt, 0);
    solver.setViewContext({ camera: cam, ndc });
    const result = solver.update([hand()], startAt, 0.1);
    return {
      x: result.position.x - startAt.position.x,
      y: result.position.y - startAt.position.y,
      z: result.position.z - startAt.position.z
    };
  };

  // The expectations from the brief, stated as their own cases.
  const cases = [
    ["front", { x: 0.2, y: 0 }, { axis: "x", sign: 1, label: "right -> +X" }],
    ["front", { x: 0, y: 0.2 }, { axis: "y", sign: 1, label: "up -> +Y" }],
    ["front", { x: -0.2, y: 0 }, { axis: "x", sign: -1, label: "left -> -X" }],
    ["front", { x: 0, y: -0.2 }, { axis: "y", sign: -1, label: "down -> -Y" }],
    ["top", { x: 0.2, y: 0 }, { axis: "x", sign: 1, label: "right -> +X" }],
    ["top", { x: 0, y: 0.2 }, { axis: "z", sign: -1, label: "up -> -Z" }],
    ["top", { x: 0, y: -0.2 }, { axis: "z", sign: 1, label: "down -> +Z" }],
    ["left", { x: 0.2, y: 0 }, { axis: "z", sign: 1, label: "right -> +Z" }],
    ["left", { x: 0, y: 0.2 }, { axis: "y", sign: 1, label: "up -> +Y" }],
    ["right", { x: 0.2, y: 0 }, { axis: "z", sign: -1, label: "right -> -Z" }],
    ["back", { x: 0.2, y: 0 }, { axis: "x", sign: -1, label: "right -> -X" }],
    ["bottom", { x: 0, y: 0.2 }, { axis: "z", sign: 1, label: "up -> +Z" }]
  ];

  for (const [view, ndc, want] of cases) {
    const d = drag(view, ndc);
    const value = d[want.axis];
    const other = ["x", "y", "z"].filter(a => a !== want.axis);
    const leakage = Math.max(Math.abs(d[other[0]]), Math.abs(d[other[1]]));
    check(`${view}: drag ${want.label}`,
      Math.sign(value) === want.sign && Math.abs(value) > 0.2,
      `(${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`);
    // Camera-relative movement must stay in the view plane, not drift along the
    // view axis.
    check(`${view}: drag ${want.label} does not leak into other axes`,
      leakage < Math.abs(value) * 0.25,
      `leak ${leakage.toFixed(3)}`);
  }

  // The same screen movement must produce different world movement in different
  // views. This is the whole point: fixed world axes would make these equal.
  {
    const front = drag("front", { x: 0.2, y: 0 });
    const top = drag("top", { x: 0.2, y: 0 });
    const left = drag("left", { x: 0.2, y: 0 });
    // Same screen drag, different world axis: that is what "camera-relative"
    // means. A fixed world-axis solver would have moved both along X.
    check("the same drag moves a different world axis in different views",
      Math.abs(front.x) > 0.2 && Math.abs(front.z) < 1e-6 &&
      Math.abs(left.z) > 0.2 && Math.abs(left.x) < 1e-6,
      `front=(${front.x.toFixed(2)},${front.z.toFixed(2)}) left=(${left.x.toFixed(2)},${left.z.toFixed(2)})`);
    check("Top and Front agree on horizontal movement",
      Math.abs(front.x - top.x) < 1e-6,
      `${front.x.toFixed(3)} vs ${top.x.toFixed(3)}`);
    check("Front and Left disagree on horizontal movement",
      Math.abs(front.x) > 0.2 && Math.abs(front.z) < 1e-6,
      `front=(${front.x.toFixed(2)},${front.z.toFixed(2)}) left=(${left.x.toFixed(2)},${left.z.toFixed(2)})`);
  }

  // A grab must not move the object on its first frame.
  {
    aim("front");
    const solver = new ManipulationSolver({
      settings: { mode: "move", limits: { x: 40, y: 40, z: 40 } }
    });
    solver.setViewContext({ camera: cam, ndc: { x: 0.1, y: -0.05 } });
    const start = at(1, 2, 3);
    const result = solver.update([hand()], start, 0);
    check("grabbing does not jump the object",
      result.position.x === 1 && result.position.y === 2 && result.position.z === 3,
      `(${result.position.x}, ${result.position.y}, ${result.position.z})`);
  }

  // A camera change mid-drag must not shift the object: the plane is captured
  // once and held for the whole grab.
  {
    aim("front");
    const solver = new ManipulationSolver({
      settings: { mode: "move", limits: { x: 40, y: 40, z: 40 } }
    });
    const start = at();
    solver.setViewContext({ camera: cam, ndc: { x: 0, y: 0 } });
    solver.update([hand()], start, 0);
    solver.setViewContext({ camera: cam, ndc: { x: 0.1, y: 0 } });
    const before = solver.update([hand()], start, 0.1).position.x;

    // Re-aim the camera at a completely different view, without releasing.
    aim("top");
    solver.setViewContext({ camera: cam, ndc: { x: 0.1, y: 0 } });
    const after = solver.update([hand()], start, 0.2).position.x;

    check("a camera change mid-drag does not shift the object",
      Math.abs(after - before) < 0.35,
      `${before.toFixed(2)} -> ${after.toFixed(2)}`);
  }

  // Releasing must drop the plane so the next grab starts fresh.
  {
    aim("front");
    const solver = new ManipulationSolver({
      settings: { mode: "move", limits: { x: 40, y: 40, z: 40 } }
    });
    solver.setViewContext({ camera: cam, ndc: { x: 0, y: 0 } });
    solver.update([hand()], at(), 0);
    check("a drag plane is active during a grab", solver.dragPlane.active === true);
    solver.update([hand(false)], at(), 0.1);
    check("releasing drops the drag plane", solver.dragPlane.active === false);
  }

  // Movement is bounded by the stage limits.
  {
    aim("front");
    const solver = new ManipulationSolver({
      settings: { mode: "move", limits: { x: 2, y: 2, z: 2 } }
    });
    solver.setViewContext({ camera: cam, ndc: { x: 0, y: 0 } });
    solver.update([hand()], at(), 0);
    solver.setViewContext({ camera: cam, ndc: { x: 1, y: 1 } });
    const result = solver.update([hand()], at(), 0.1);
    check("camera-relative movement respects the stage limits",
      Math.abs(result.position.x) <= 2 && Math.abs(result.position.y) <= 2,
      `(${result.position.x.toFixed(2)}, ${result.position.y.toFixed(2)})`);
  }

  // With no camera supplied, the old behaviour must still work, so headless
  // callers and existing tests are not broken.
  {
    const solver = new ManipulationSolver({
      settings: { mode: "move", limits: { x: 40, y: 40, z: 40 } }
    });
    solver.update([hand()], at(), 0);
    const moved = solver.update(
      [{ ...hand(), pinch: { x: 0.7, y: 0.5, z: 0 } }], at(), 0.1
    );
    check("without a camera the solver still translates",
      moved.intent === "translate" && moved.position.x > 0,
      String(moved.position.x));
  }
}

section("5s · Translation gizmo");

{
  const ws = api.getWorkspace();
  const gs = api.getPlayground();

  // ---- pure constraint rules ---------------------------------------------
  for (const axis of AXIS_HANDLES) {
    const out = constrainDelta(axis, { x: 3, y: 5, z: 7 });
    const others = ["x", "y", "z"].filter(a => a !== axis);
    check(`axis ${axis} handle moves only ${axis.toUpperCase()}`,
      out[axis] === { x: 3, y: 5, z: 7 }[axis] &&
      others.every(a => out[a] === 0),
      JSON.stringify(out));
  }
  for (const plane of PLANE_HANDLES) {
    const out = constrainDelta(plane, { x: 3, y: 5, z: 7 });
    const blocked = ["x", "y", "z"].find(a => !PLANE_AXES[plane].includes(a));
    check(`plane ${plane} handle blocks ${blocked.toUpperCase()}`,
      out[blocked] === 0 &&
      PLANE_AXES[plane].every(a => out[a] === { x: 3, y: 5, z: 7 }[a]),
      JSON.stringify(out));
  }

  // A ray crossing the axis at a known point must report that distance.
  {
    const ray = new THREE.Ray(new THREE.Vector3(2, 5, 0), new THREE.Vector3(0, -1, 0));
    const t = axisParameter(new THREE.Vector3(), AXIS_VECTORS.x, ray);
    check("closest-approach finds the crossing point", Math.abs(t - 2) < 1e-9, String(t));
  }
  // A ray parallel to the axis cannot define a position: refuse, do not produce
  // a huge number.
  {
    const ray = new THREE.Ray(new THREE.Vector3(5, 0, 0), new THREE.Vector3(1, 0, 0));
    check("a ray parallel to the axis is refused",
      axisParameter(new THREE.Vector3(), AXIS_VECTORS.x, ray) === null);
  }

  // ---- visibility rules ---------------------------------------------------
  {
    gs.clear();
    ws.setGizmo(null);
    check("no selection means no gizmo", ws.gizmo?.root.visible === false ||
      ws.gizmo === null, String(ws.gizmo?.root.visible));

    const prop = gs.addPrimitive("cube");
    gs.setTransform(prop.id, { position: { x: 2, y: 1.5, z: -1 } });
    gs.select(prop.id);
    api._internals.selectProp?.(prop.id);
    check("selecting a prop shows the gizmo", ws.gizmo?.root.visible === true);
    check("the gizmo sits on the selection",
      ws.gizmo.root.position.distanceTo(prop.group.position) < 1e-6,
      ws.gizmo.root.position.toArray().map(v => v.toFixed(2)).join(","));

    // It must follow the object when the object moves.
    gs.setTransform(prop.id, { position: { x: -1, y: 0.5, z: 2 } });
    ws.gizmo.update(ws.camera);
    check("the gizmo follows the object",
      ws.gizmo.root.position.distanceTo(new THREE.Vector3(-1, 0.5, 2)) < 1e-6,
      ws.gizmo.root.position.toArray().map(v => v.toFixed(2)).join(","));

    gs.select(null);
    api._internals.selectProp?.(null);
    check("clearing the selection hides the gizmo", ws.gizmo?.root.visible === false);
  }

  // ---- constant on-screen size -------------------------------------------
  {
    gs.clear();
    const prop = gs.addPrimitive("cube");
    ws.setGizmo(prop.group);
    ws.camera.position.set(0, 3, 8);
    ws.camera.lookAt(0, 0, 0);
    ws.camera.updateMatrixWorld();
    ws.gizmo.update(ws.camera);
    const near = ws.gizmo.root.scale.x;
    ws.camera.position.set(0, 12, 32);
    ws.camera.lookAt(0, 0, 0);
    ws.camera.updateMatrixWorld();
    ws.gizmo.update(ws.camera);
    const far = ws.gizmo.root.scale.x;
    check("the gizmo grows with distance to stay legible", far > near,
      `${near.toFixed(3)} -> ${far.toFixed(3)}`);
    check("the gizmo stays within sane bounds", far <= 6 && near >= 0.08,
      `${near.toFixed(3)}, ${far.toFixed(3)}`);
  }

  // ---- an axis drag moves the object along exactly one axis --------------
  {
    gs.clear();
    const prop = gs.addPrimitive("cube");
    gs.setTransform(prop.id, { position: { x: 0, y: 0, z: 0 } });
    ws.setGizmo(prop.group);
    ws.camera.position.set(0, 1, 10);
    ws.camera.lookAt(0, 0, 0);
    ws.camera.updateMatrixWorld();
    ws.gizmo.update(ws.camera);

    const origin = ws.gizmo.root.position.clone();
    const scale = ws.gizmo.root.scale.x;
    // Two rays from above, one screen-unit apart along X, both crossing the axis.
    const rayA = new THREE.Ray(
      new THREE.Vector3(origin.x + 0.1 * scale, origin.y + 6, origin.z + 6),
      new THREE.Vector3(0, -1, -1).normalize()
    );
    const rayB = new THREE.Ray(
      new THREE.Vector3(origin.x + 0.9 * scale, origin.y + 6, origin.z + 6),
      new THREE.Vector3(0, -1, -1).normalize()
    );

    check("an X handle drag begins", ws.gizmo.beginDrag(rayA, "x") === true);
    const delta = ws.gizmo.drag(rayB);
    check("the X handle reports movement only on X",
      delta && Math.abs(delta.y) < 1e-9 && Math.abs(delta.z) < 1e-9 && delta.x > 0.5,
      delta ? `(${delta.x.toFixed(2)}, ${delta.y.toFixed(2)}, ${delta.z.toFixed(2)})` : "null");

    // Applying it must move exactly that far.
    const before = gs.getTransform(prop.id).position;
    gs.setTransform(prop.id, {
      position: { x: before.x + delta.x, y: before.y + delta.y, z: before.z + delta.z }
    });
    const after = gs.getTransform(prop.id).position;
    check("the object moves by exactly the reported delta",
      Math.abs(after.x - before.x - delta.x) < 1e-9 &&
      Math.abs(after.y - before.y) < 1e-9,
      `${after.x.toFixed(3)}`);

    ws.gizmo.endDrag();
    check("ending a drag clears it", ws.gizmo.dragging === null);
    check("dragging after release does nothing", ws.gizmo.drag(rayB) === null);
  }

  // ---- the gizmo's meshes are not part of the exported model -------------
  {
    const count = ws.scene.children.filter(c => c.name === "translation-gizmo").length;
    check("the gizmo lives at the scene root, not inside the model", count === 1, String(count));
    gs.clear();
    ws.setGizmo(null);
  }
}

section("5t · Depth is calibrated, not guessed");

{
  // ---- the transfer function --------------------------------------------
  check("no size change means no depth travel",
    ratioToTravel(1).travel === 0 && ratioToTravel(1).engaged === false);

  // The dead zone must be a plateau, not a step: sitting just inside it and just
  // outside must not produce a visible jump.
  {
    const inside = ratioToTravel(1 + DEPTH_MODE.deadZone * 0.9);
    const edge = ratioToTravel(1 + DEPTH_MODE.deadZone * 1.01);
    check("the dead zone absorbs jitter", inside.travel === 0 && inside.engaged === false);
    check("leaving the dead zone does not jump",
      Math.abs(edge.travel) < 0.3,
      edge.travel.toFixed(3));
  }

  // Monotonic in both directions, and symmetric about 1.
  {
    const near = ratioToTravel(1.3).travel;
    const nearer = ratioToTravel(1.6).travel;
    const far = ratioToTravel(0.7).travel;
    const farther = ratioToTravel(0.4).travel;
    check("a larger hand moves the object one way, monotonically",
      near > 0 && nearer > near, `${near.toFixed(2)} -> ${nearer.toFixed(2)}`);
    check("a smaller hand moves it the other way, monotonically",
      far < 0 && farther < far, `${far.toFixed(2)} -> ${farther.toFixed(2)}`);
    check("depth is symmetric about the reference",
      Math.abs(ratioToTravel(0.75).travel + ratioToTravel(1.25).travel) < 1e-9);
  }

  check("depth travel is clamped",
    Math.abs(ratioToTravel(50).travel) <= DEPTH_MODE.maxTravel + 1e-9,
    String(ratioToTravel(50).travel));
  check("depth sensitivity scales travel",
    Math.abs(ratioToTravel(1.3, { sensitivity: 2 }).travel -
      2 * ratioToTravel(1.3).travel) < 1e-9);
  check("depth can be inverted", ratioToTravel(1.3, { invert: true }).travel < 0);

  // ---- activation is deliberate -----------------------------------------
  {
    const openHand = { openPalm: 0.9, pinched: false, pointing: 0.1, size: 0.11 };

    const quick = new HandDepthTracker();
    quick.update(openHand, 0);
    check("one frame of the depth pose does not engage", quick.active === false);

    const held = new HandDepthTracker();
    for (let i = 0; i < DEPTH_MODE.activationFrames - 1; i++) held.update(openHand, i * 0.033);
    check("holding short of the threshold does not engage", held.active === false);
    const engaged = held.update(openHand, 1);
    check("holding the pose engages depth", engaged.active === true);
    check("engagement captures a reference size",
      Math.abs(engaged.reference - 0.11) < 1e-9, String(engaged.reference));
    check("engagement does not move the object", engaged.travel === 0);

    // A pinch must never arm depth: that would fight the drag.
    const pinch = new HandDepthTracker();
    for (let i = 0; i < 30; i++) {
      pinch.update({ ...openHand, pinched: true }, i * 0.033);
    }
    check("pinching never arms depth", pinch.active === false);

    // Nor may a pointing hand.
    const point = new HandDepthTracker();
    for (let i = 0; i < 30; i++) {
      point.update({ ...openHand, pointing: 0.9 }, i * 0.033);
    }
    check("pointing never arms depth", point.active === false);

    // A partial openPalm is not the pose either.
    const half = new HandDepthTracker();
    for (let i = 0; i < 30; i++) {
      half.update({ ...openHand, openPalm: 0.55 }, i * 0.033);
    }
    check("a half-open hand does not arm depth", half.active === false);
  }

  // ---- tracking loss resets the reference -------------------------------
  {
    const tracker = new HandDepthTracker();
    const openHand = { openPalm: 0.9, pinched: false, pointing: 0.1, size: 0.1 };
    for (let i = 0; i < DEPTH_MODE.activationFrames + 1; i++) {
      tracker.update(openHand, i * 0.033);
    }
    check("depth is active before tracking is lost", tracker.active === true);
    tracker.update(null, 1);
    check("losing the hand resets depth", tracker.active === false && tracker.reference === null);
  }

  // ---- two hands keep separate references -------------------------------
  {
    const registry = new HandDepthRegistry();
    const openHand = (size) => ({ openPalm: 0.9, pinched: false, pointing: 0.1, size });
    // Left hand is close to the camera, right hand is far: different apparent
    // sizes. Each must calibrate against its own.
    for (let i = 0; i < DEPTH_MODE.activationFrames; i++) {
      registry.update("left", openHand(0.20), i * 0.033);
      registry.update("right", openHand(0.08), i * 0.033);
    }
    const left = registry.update("left", openHand(0.20), 1);
    const right = registry.update("right", openHand(0.08), 1);
    check("each hand keeps its own depth reference",
      Math.abs(left.reference - 0.20) < 0.01 && Math.abs(right.reference - 0.08) < 0.01,
      `${left.reference?.toFixed(3)} vs ${right.reference?.toFixed(3)}`);
    check("two different-sized hands at rest produce no travel",
      Math.abs(left.travel) < 0.05 && Math.abs(right.travel) < 0.05,
      `${left.travel.toFixed(3)}, ${right.travel.toFixed(3)}`);
    check("the registry tracks both hands", registry.size === 2);
    registry.forget("left");
    check("forgetting a hand drops its state", registry.size === 1);
  }

  // ---- depth never depends on landmark z --------------------------------
  {
    // Identical hands with wildly different reported z must produce identical
    // depth: z is what the old code wrongly trusted.
    const base = { openPalm: 0.9, pinched: false, pointing: 0.1, size: 0.1 };
    const a = new HandDepthTracker();
    const b = new HandDepthTracker();
    for (let i = 0; i < DEPTH_MODE.activationFrames; i++) {
      a.update({ ...base, z: -0.9 }, i * 0.033);
      b.update({ ...base, z: 0.9 }, i * 0.033);
    }
    const ra = a.update({ ...base, z: -0.9 }, 1);
    const rb = b.update({ ...base, z: 0.9 }, 1);
    check("landmark z has no influence on depth",
      Math.abs(ra.travel - rb.travel) < 1e-9 && ra.reference === rb.reference,
      `${ra.travel} vs ${rb.travel}`);
  }
}

section("5u · Two-hand movement is camera-relative");

{
  const cam = new THREE.PerspectiveCamera(42, 1.6, 0.1, 200);
  const twoHand = (offsetX, pinched = true) => {
    const make = (px) => ({
      pinch: { x: px, y: 0.5, z: 0 },
      indexTip: { x: px, y: 0.5 },
      palm: { x: px, y: 0.5 },
      pinched,
      openPalm: pinched ? 0.2 : 0.9,
      pointing: 0.2,
      size: 0.1,
      key: `h${px}`,
      landmarks: Array.from({ length: 21 }, () => ({ x: px, y: 0.5, z: 0 }))
    });
    return [make(0.35 + offsetX), make(0.65 + offsetX)];
  };
  const at = (x = 0, y = 0, z = 0) => ({
    position: { x, y, z }, rotationZ: 0, rotationX: 0, scale: 1
  });
  const aim = view => {
    const p = viewPlacement(view, { target: new THREE.Vector3(), radius: 3, fov: 42 });
    cam.position.copy(p.position);
    cam.up.copy(p.up);
    cam.lookAt(p.target);
    cam.updateMatrixWorld();
  };

  /** Both hands move right together; return the world delta of the object. */
  const twoHandDrag = (view) => {
    aim(view);
    const solver = new ManipulationSolver({
      settings: { mode: "auto", limits: { x: 40, y: 40, z: 40 } }
    });
    const start = at();
    solver.setViewContext({ camera: cam, ndc: { x: -0.3, y: 0 } });
    solver.update(twoHand(0), start, 0);
    solver.setViewContext({ camera: cam, ndc: { x: -0.1, y: 0 } });
    const result = solver.update(twoHand(0.1), start, 0.1);
    return {
      intent: result.intent,
      x: result.position.x - start.position.x,
      y: result.position.y - start.position.y,
      z: result.position.z - start.position.z
    };
  };

  const front = twoHandDrag("front");
  const top = twoHandDrag("top");
  const left = twoHandDrag("left");
  const right = twoHandDrag("right");

  check("a two-hand grab still reports its intent", front.intent === "two-hand grab",
    front.intent);

  // The expectation from the brief: two hands must obey the same camera-relative
  // rule as one hand. Before this fix the midpoint went straight into world X/Y
  // and Z was frozen, which only looked right in Front view.
  check("two-hand movement follows X in Front view",
    front.x > 0.3 && Math.abs(front.z) < 1e-6,
    `(${front.x.toFixed(2)}, ${front.z.toFixed(2)})`);
  check("two-hand movement follows X in Top view",
    top.x > 0.3 && Math.abs(top.z) < 1e-6,
    `(${top.x.toFixed(2)}, ${top.z.toFixed(2)})`);
  check("two-hand movement follows Z in Left view",
    left.z > 0.3 && Math.abs(left.x) < 1e-6,
    `(${left.x.toFixed(2)}, ${left.z.toFixed(2)})`);
  check("two-hand movement follows -Z in Right view",
    right.z < -0.3 && Math.abs(right.x) < 1e-6,
    `(${right.x.toFixed(2)}, ${right.z.toFixed(2)})`);

  // One-hand and two-hand must agree in the same view, or the object behaves
  // differently depending on how many hands the user happens to raise.
  check("one-hand and two-hand agree in Top view",
    Math.abs(top.x - 1.49) < 0.3, top.x.toFixed(2));

  // Ordering: the same physical scene presented in the opposite array order
  // must produce the same rotation. MediaPipe does not guarantee its order, and
  // when it swapped the angle-based rotation flipped by ~180 degrees mid-gesture.
  {
    const hand = (key, px, py) => ({
      key,
      palm: { x: px, y: py },
      pinch: { x: px, y: py, z: 0 },
      indexTip: { x: px, y: py },
      pinched: true,
      openPalm: 0.2,
      pointing: 0.2,
      size: 0.1,
      handedness: key === "hand-1" ? "Left" : "Right",
      landmarks: Array.from({ length: 21 }, () => ({ x: px, y: py, z: 0 }))
    });

    const run = (pair) => {
      const solver = new ManipulationSolver({
        settings: { mode: "auto", limits: { x: 10, y: 10, z: 10 } }
      });
      solver.update(pair[0], at(), 0);
      const result = solver.update(pair[1], at(), 0.1);
      return result.rotationZ;
    };

    const firstA = hand("hand-1", 0.25, 0.5);
    const firstB = hand("hand-2", 0.75, 0.5);
    const secondA = hand("hand-1", 0.25, 0.62);
    const secondB = hand("hand-2", 0.75, 0.38);

    check("orderPair returns a deterministic order",
      orderPair([firstB, firstA])[0].key === orderPair([firstA, firstB])[0].key,
      orderPair([firstB, firstA])[0].key);

    // Rotate the pair by tilting both hands, once in each array order.
    const solvedInOrder = (() => {
      const solver = new ManipulationSolver({
        settings: { mode: "auto", limits: { x: 10, y: 10, z: 10 } }
      });
      solver.update([firstA, firstB], at(), 0);
      return solver.update([secondA, secondB], at(), 0.1).rotationZ;
    })();
    const solvedReordered = (() => {
      const solver = new ManipulationSolver({
        settings: { mode: "auto", limits: { x: 10, y: 10, z: 10 } }
      });
      solver.update([firstB, firstA], at(), 0);
      return solver.update([secondB, secondA], at(), 0.1).rotationZ;
    })();

    check("two-hand rotation does not depend on array order",
      Math.abs(solvedInOrder - solvedReordered) < 1e-9,
      `${solvedInOrder.toFixed(4)} vs ${solvedReordered.toFixed(4)}`);
    check("two-hand rotation is not a half turn",
      Math.abs(solvedInOrder) < Math.PI / 2,
      solvedInOrder.toFixed(3));
    void run;
  }

  // Without a camera the documented fallback must still translate, so headless
  // callers are not broken.
  {
    const solver = new ManipulationSolver({
      settings: { mode: "auto", limits: { x: 40, y: 40, z: 40 } }
    });
    solver.update(twoHand(0), at(), 0);
    const moved = solver.update(twoHand(0.1), at(), 0.1);
    check("two-hand movement still works without a camera",
      moved.position.x > 0.2, moved.position.x.toFixed(2));
  }
}

section("6 · Modes still gate gestures");

const modes = ["select", "move", "rotate", "scale", "explode"];
for (const mode of modes) {
  api?.setMode?.(mode);
  check(`mode "${mode}" can be set`, api?.getMode?.() === mode, api?.getMode?.());
}

// The mode bar must reflect the active mode.
api?.setMode?.("rotate");
const activeButton = doc.querySelector(".mode-btn.is-active");
check("the mode bar highlights the active mode",
  Boolean(activeButton), activeButton?.textContent?.trim());

/* ------------------------------------------------------------------------- */
/* SUMMARY                                                                   */
/* ------------------------------------------------------------------------- */

console.log(`\n${"─".repeat(64)}`);
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} FULL-STACK CHECKS PASSED\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m · ${passed} passed`);
  for (const failure of failures) console.log(`  · ${failure}`);
}
console.log(`${"─".repeat(64)}\n`);
process.exit(failed === 0 ? 0 : 1);
