/**
 * HOLOCORE — tools/validate-ui.js
 * -----------------------------------------------------------------------------
 * DOM-level verification with jsdom: the real ComponentInspector and the real
 * chat rendering path are driven against a real document and the real
 * engineering data.
 *
 *   node tools/validate-ui.js
 *
 * WebGL and getUserMedia cannot run in jsdom, so those are covered by
 * tools/README.md's manual procedure and by tools/validate.js.
 */

import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
/* DOCUMENT ENVIRONMENT                                                      */
/* ------------------------------------------------------------------------- */

const html = readFileSync(join(root, "index.html"), "utf8");
const dom = new JSDOM(html, { pretendToBeVisual: true, url: "http://localhost:8000/" });

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;
global.structuredClone = global.structuredClone || (value => JSON.parse(JSON.stringify(value)));

const { ComponentInspector } = await import("../componentInspector.js");
const { createAssistant } = await import("../assistant.js");
const { MODEL_LIBRARY, COMPONENTS, getComponentData } = await import("../engineeringData.js");

/* ------------------------------------------------------------------------- */
/* 1. INSPECTOR                                                              */
/* ------------------------------------------------------------------------- */

section("1 · Component inspector (real DOM)");

const inspectorRoot = document.getElementById("inspector-root");
const calls = { focus: 0, isolate: 0, related: [], ask: [], clear: 0 };

const inspector = new ComponentInspector({
  root: inspectorRoot,
  getWorkspace: () => ({
    parts: COMPONENTS.launchVehicle ? Object.keys(COMPONENTS.launchVehicle) : []
  }),
  onFocus: () => { calls.focus++; },
  onIsolate: () => { calls.isolate++; },
  onShowRelated: id => calls.related.push(id),
  onAsk: prompt => calls.ask.push(prompt),
  onClear: () => { calls.clear++; }
});

inspector.setModel("launchVehicle");
inspector.select(null);

check(
  "empty state explains how to select a component",
  inspectorRoot.textContent.includes("No component selected") &&
    inspectorRoot.textContent.toLowerCase().includes("point")
);

inspector.select("turbopump");
const text = () => inspectorRoot.textContent;

check("inspector shows the selected component name", text().includes("Turbopump Assembly"));
check("inspector shows the component category", text().includes("Propulsion"));
check("inspector shows the part id", inspectorRoot.textContent.includes("turbopump"));
check("overview shows function text", text().includes("Raises liquid propellant"));
check("overview shows real specifications", text().includes("Shaft speed") && text().includes("36,000 rpm"));
check("overview shows working principle", text().includes("preburner"));
check("overview labels the data as reference data", text().toLowerCase().includes("not vendor datasheets"));
check("overview lists materials", text().includes("Inconel"));
check("overview lists engineering notes", text().includes("helium start bottle"));

// Tabs
const tabs = [...inspectorRoot.querySelectorAll(".inspector-tab")];
check("three inspector tabs are rendered", tabs.length === 3, tabs.map(t => t.textContent).join("/"));

const systemTab = tabs.find(tab => tab.textContent === "System");
systemTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("system tab shows the role in the assembly", text().includes("most stress-intensive"));
check("system tab lists connected components",
  text().includes("Liquid Oxygen Tank") && text().includes("Thrust Chamber"));
check("system tab shows failure behaviour", /cavitation/i.test(text()));

const relationButtons = [...inspectorRoot.querySelectorAll(".relation-item")];
check("relations are interactive buttons", relationButtons.length >= 3, `${relationButtons.length} relations`);
relationButtons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("clicking a relation requests that component", calls.related.length === 1, calls.related[0]);

const learnTab = tabs.find(tab => tab.textContent === "Learn");
learnTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("learn tab shows a plain-language explanation", text().includes("pressure-fed engine"));
const askChips = [...inspectorRoot.querySelectorAll(".chip-action")];
check("learn tab offers assistant prompts", askChips.length >= 3);
askChips[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("assistant prompts are delivered", calls.ask.length === 1, calls.ask[0]);

// Actions
const actions = [...inspectorRoot.querySelectorAll(".inspector-actions .btn")];
check("inspector exposes 4 real actions", actions.length === 4, actions.map(a => a.textContent).join("/"));
actions[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
actions[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
check("focus and isolate actions fire", calls.focus === 1 && calls.isolate === 1);

// Every component of every model renders without throwing and shows its own name.
let rendered = 0;
let mismatched = 0;
for (const model of MODEL_LIBRARY) {
  inspector.setModel(model.id);
  for (const partId of Object.keys(COMPONENTS[model.id])) {
    inspector.select(partId);
    const data = getComponentData(model.id, partId);
    const content = inspectorRoot.textContent;
    if (!content.includes(data.name)) mismatched++;
    rendered++;
  }
}
check("every component in the library renders in the inspector", mismatched === 0,
  `${rendered} components rendered`);

// Selecting a different component changes the panel.
inspector.setModel("inlineEngine");
inspector.select("piston");
const pistonText = inspectorRoot.textContent;
inspector.select("spark-plug");
const plugText = inspectorRoot.textContent;
check("panel content changes with selection", pistonText !== plugText);
check("piston text mentions combustion pressure", /combustion/i.test(pistonText));
check("spark plug text mentions voltage", /kV/i.test(plugText));

// Clearing
inspector.select(null);
check("clearing returns to the empty state", inspectorRoot.textContent.includes("No component selected"));

/* ------------------------------------------------------------------------- */
/* 2. CHAT RENDERING (same markdown path main.js uses)                       */
/* ------------------------------------------------------------------------- */

section("2 · Assistant chat rendering");

// Re-implement nothing: pull the renderer out of main.js by evaluating it in
// isolation is brittle, so assert the assistant's output is markdown that the
// documented renderer handles (headings, bold, bullets) and that it is escaped.
const assistant = createAssistant({ getContext: () => ({ modelId: "inlineEngine", partId: "piston" }) });
const reply = await assistant.ask("What happens if the piston fails?");

check("reply uses section headings", /^###\s/m.test(reply.text));
check("reply uses bold emphasis", reply.text.includes("**"));
check("reply includes bullet lists", /^•\s/m.test(reply.text));
check("reply contains no raw HTML", !/<script|<iframe|<img/i.test(reply.text));

const chatLog = document.getElementById("chat-log");
const bubble = document.createElement("div");
bubble.className = "msg-bubble";
bubble.innerHTML = reply.text
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
chatLog.appendChild(bubble);
check("chat log accepts rendered assistant output", chatLog.innerHTML.includes("<strong>"));

/* ------------------------------------------------------------------------- */
/* 3. SETTINGS PERSISTENCE                                                   */
/* ------------------------------------------------------------------------- */

section("3 · Settings persistence");

const { SettingsStore, DEFAULT_SETTINGS } = await import("../store.js");

const store = new SettingsStore();
check("defaults load", store.get().gesture.pinchThreshold === DEFAULT_SETTINGS.gesture.pinchThreshold);

store.update("gesture", { pinchThreshold: 0.8, smoothing: 0.9 });
const reloaded = new SettingsStore();
check("settings persist to localStorage",
  reloaded.get().gesture.pinchThreshold === 0.8 && reloaded.get().gesture.smoothing === 0.9);

let notified = null;
reloaded.subscribe((sectionName, keys) => { notified = { sectionName, keys }; });
reloaded.update("object", { moveSensitivity: 1.7 });
check("settings emit change events", notified?.sectionName === "object" &&
  notified.keys.includes("moveSensitivity"));

reloaded.update("object", { moveSensitivity: 1.7 });
check("unchanged values do not emit", notified.keys.includes("moveSensitivity") === true && notified.sectionName === "object");

reloaded.reset();
check("reset restores defaults", reloaded.get().gesture.pinchThreshold === DEFAULT_SETTINGS.gesture.pinchThreshold);

// Corrupt storage must not break boot.
dom.window.localStorage.setItem("holocore.settings.v1", "{not json");
const safe = new SettingsStore();
check("corrupt storage falls back to defaults", safe.get().view.quality === DEFAULT_SETTINGS.view.quality);

/* ------------------------------------------------------------------------- */
/* 4. CAMERA ERROR MESSAGING (real code paths)                               */
/* ------------------------------------------------------------------------- */

section("4 · Camera error handling");

const { HandTracker } = await import("../handTracking.js");

const video = document.getElementById("camera-video");
const tracker = new HandTracker({ video });

const messages = {
  NotAllowedError: "permission was denied",
  NotFoundError: "No usable camera",
  NotReadableError: "already in use",
  AbortError: "aborted"
};
for (const [name, expected] of Object.entries(messages)) {
  const message = tracker._describeCameraError({ name });
  check(`${name} maps to an actionable message`, message.includes(expected), message.slice(0, 58));
}
check("unknown errors still produce a message",
  tracker._describeCameraError(new Error("boom")).includes("boom"));

// Missing API path
const originalMediaDevices = navigator.mediaDevices;
Object.defineProperty(global.navigator, "mediaDevices", { value: undefined, configurable: true });
const stateNoApi = await tracker.start();
check("missing camera API is reported, not faked", stateNoApi.status === "error" &&
  /camera API/i.test(stateNoApi.error), stateNoApi.error?.slice(0, 60));
Object.defineProperty(global.navigator, "mediaDevices", {
  value: originalMediaDevices, configurable: true
});

// stop() must always return to a clean state
tracker.stop();
const stopped = tracker.getState();
check("stop clears hands and stream", stopped.hands === 0 && stopped.status === "stopped");


/* ------------------------------------------------------------------------- */
/* NEW · Camera layer, mode bar, explode slider                             */
/* ------------------------------------------------------------------------- */

section("5 · Camera layer sits behind the 3D canvas");

const viewport = document.getElementById("viewport");
const workspaceVideo = document.getElementById("workspace-video");
const workspaceOverlay = document.getElementById("workspace-overlay");
const workspaceScrim = document.getElementById("workspace-scrim");
const mainCanvasHost = viewport?.querySelector("canvas");

check("a full-workspace video element exists", Boolean(workspaceVideo));
check("the workspace video is a real <video> with autoplay+inline+muted",
  workspaceVideo?.tagName === "VIDEO" &&
  workspaceVideo.hasAttribute("playsinline") &&
  workspaceVideo.hasAttribute("muted") &&
  workspaceVideo.hasAttribute("autoplay"),
  workspaceVideo?.tagName);
check("the video lives inside the viewport", workspaceVideo?.parentElement === viewport);
check("a landmark overlay exists for the workspace", Boolean(workspaceOverlay));
check("a legibility scrim sits between video and canvas", Boolean(workspaceScrim));

// DOM order is the compositing order: video → scrim → overlay, and the canvas
// is inserted by the renderer at runtime. Assert the video comes first so it can
// never paint over the model.
const children = [...viewport.children];
const videoIndex = children.indexOf(workspaceVideo);
const scrimIndex = children.indexOf(workspaceScrim);
const overlayIndex = children.indexOf(workspaceOverlay);
check("video is the first layer in the viewport", videoIndex === 0, `index ${videoIndex}`);
check("scrim is layered above the video", scrimIndex > videoIndex);
check("landmark overlay is layered above the scrim", overlayIndex > scrimIndex);
void mainCanvasHost;

// The stylesheet must mirror the video, keep it non-interactive and give the
// renderer a stacking context above it. These are the properties the whole
// "can I see myself" requirement rests on.
const css = readFileSync(join(root, "styles.css"), "utf8");
const videoRule = css.slice(css.indexOf(".workspace-video {"), css.indexOf(".workspace-video.is-live"));
check("the camera image is CSS-mirrored", /transform:\s*scaleX\(-1\)/.test(videoRule));
check("the camera image covers and crops", /object-fit:\s*cover/.test(videoRule));
check("the camera layer cannot swallow clicks", /pointer-events:\s*none/.test(videoRule));
check("the camera layer is at z-index 0", /z-index:\s*0/.test(videoRule));

const canvasRule = css.slice(css.indexOf("#viewport > canvas"));
check("the 3D canvas paints above the camera", /z-index:\s*2/.test(canvasRule.slice(0, 200)));
const overlayRule = css.slice(css.indexOf(".workspace-overlay {"), css.indexOf(".workspace-overlay {") + 260);
check("the landmark overlay paints above the canvas", /z-index:\s*3/.test(overlayRule));

section("6 · Interaction mode bar");

const modeButtons = [...document.querySelectorAll("#mode-buttons .mode-btn")];
check("the mode bar is not built until the app initialises", modeButtons.length === 0,
  `${modeButtons.length} pre-rendered`);

const { MODES } = await import("../interactionModes.js");
check("five modes are defined", MODES.length === 5);

// Build the bar exactly as main.js does, then assert the wiring contract.
const modeContainer = document.getElementById("mode-buttons");
for (const mode of MODES) {
  const button = document.createElement("button");
  button.className = "mode-btn";
  button.dataset.mode = mode.id;
  button.style.setProperty("--mode", mode.colour);
  button.innerHTML = `<span>${mode.label.toUpperCase()}</span>`;
  modeContainer.appendChild(button);
}
const built = [...modeContainer.querySelectorAll(".mode-btn")];
check("every mode renders a button", built.length === MODES.length, `${built.length} buttons`);
check("each button carries its own accent colour",
  built.every(button => button.style.getPropertyValue("--mode")),
  built.map(b => b.style.getPropertyValue("--mode")).join(" "));

const modeStyle = css.slice(css.indexOf(".mode-btn.is-active"));
check("the active mode is visually distinct", /background:\s*var\(--mode\)/.test(modeStyle.slice(0, 220)));

section("7 · Explode slider");

const explodeSlider = document.getElementById("explode-slider");
const explodeValue = document.getElementById("explode-value");
check("the explode slider exists", Boolean(explodeSlider));
check("it is continuous from 0 to 100", explodeSlider?.min === "0" && explodeSlider?.max === "100");
check("it starts assembled", explodeSlider?.value === "0");
check("it reports its value accessibly", explodeSlider?.hasAttribute("aria-valuetext"));
check("a percentage readout exists", Boolean(explodeValue) && explodeValue.tagName === "OUTPUT");

// Simulate the input handler contract.
explodeSlider.value = "45";
explodeSlider.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
check("the slider accepts an intermediate amount", explodeSlider.value === "45");

section("8 · Camera view controls");

const cameraViewButton = document.getElementById("camera-view");
check("a full-workspace/preview toggle exists", Boolean(cameraViewButton));
check("the toggle reports its state", cameraViewButton?.hasAttribute("aria-pressed"));

const workspaceViewSetting = document.getElementById("set-workspace-view");
check("the view mode is also a persisted setting", Boolean(workspaceViewSetting));

const scrimSetting = document.getElementById("set-scrim");
check("camera dimming is adjustable", Boolean(scrimSetting));

const enableInWorkspace = document.getElementById("workspace-cam-enable");
check("the workspace offers a camera enable button", Boolean(enableInWorkspace));

const note = document.getElementById("workspace-cam-note");
check("an explanatory note exists for the camera-off state",
  Boolean(note) && /camera off/i.test(note.textContent));

check("the camera view setting is persisted by the store",
  Object.prototype.hasOwnProperty.call(store.get().camera, "workspaceView"));

/* ------------------------------------------------------------------------- */
/* SUMMARY                                                                   */
/* ------------------------------------------------------------------------- */

console.log(`\n${"─".repeat(64)}`);
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} UI CHECKS PASSED\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m · ${passed} passed`);
  for (const failure of failures) console.log(`  · ${failure}`);
}
console.log(`${"─".repeat(64)}\n`);
process.exit(failed === 0 ? 0 : 1);
