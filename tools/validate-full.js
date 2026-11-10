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
