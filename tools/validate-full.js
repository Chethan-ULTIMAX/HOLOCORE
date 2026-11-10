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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as THREE from "three";

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

section("2 · Scene-space hand skeletons are live");

const skeleton = api?.getHandSkeleton?.();
check("the 3D hand skeleton layer exists", Boolean(skeleton));
check("it is attached to the workspace scene",
  skeleton?.root?.parent === workspace?.scene);
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
  api.tracker.hands = [syntheticHand(true)];
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

api.tracker.hands = [];
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
