/**
 * HOLOCORE — tools/validate-boot.js
 * -----------------------------------------------------------------------------
 * Boots the real main.js against the real index.html inside jsdom.
 *
 * jsdom has no GPU, so this deliberately exercises the *degraded* path: the app
 * must open, wire every non-3D control, build the model library, and report the
 * missing renderer instead of throwing. It also proves there are no uncaught
 * exceptions or console errors during startup.
 *
 *   node tools/validate-boot.js
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
/* ENVIRONMENT                                                               */
/* ------------------------------------------------------------------------- */

const html = readFileSync(join(root, "index.html"), "utf8");
const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: "http://localhost:8000/",
  runScripts: "outside-only"
});

const { window } = dom;
const uncaught = [];
const consoleErrors = [];
const consoleWarnings = [];

window.addEventListener("error", event => uncaught.push(event.message));
window.addEventListener("unhandledrejection", event => uncaught.push(String(event.reason)));

// Mirror jsdom globals into the Node module scope used by the app modules.
global.window = window;
global.document = window.document;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true, writable: true });
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.HTMLInputElement = window.HTMLInputElement;
global.Event = window.Event;
global.MouseEvent = window.MouseEvent;
global.FileReader = window.FileReader;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.structuredClone = global.structuredClone || (v => JSON.parse(JSON.stringify(v)));

// jsdom ships no ResizeObserver; the app must not require it to open.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
global.ResizeObserver = window.ResizeObserver;

// Capture console output from the app.
const realError = console.error;
const realWarn = console.warn;
console.error = (...args) => { consoleErrors.push(args.join(" ")); };
console.warn = (...args) => { consoleWarnings.push(args.join(" ")); };

/* ------------------------------------------------------------------------- */
/* BOOT                                                                      */
/* ------------------------------------------------------------------------- */

section("1 · Application boot (no GPU available)");

let bootError = null;
try {
  await import("../main.js");
} catch (error) {
  bootError = error;
}

console.error = realError;
console.warn = realWarn;

// The boot overlay dismisses itself on a short timer; let it run.
await new Promise(resolve => setTimeout(resolve, 1200));

check("main.js loads without throwing", bootError === null,
  (bootError?.stack || bootError?.message || "").split("\n").slice(0, 6).join(" ⏎ "));
check("no uncaught errors during boot", uncaught.length === 0, uncaught.join(" | "));
check(
  "WebGL absence is reported, not thrown",
  consoleWarnings.concat(consoleErrors).some(line => /webgl/i.test(line)) ||
    window.document.body.textContent.toLowerCase().includes("webgl") ||
    window.document.getElementById("hud-model-status")?.textContent.includes("WEBGL"),
  window.document.getElementById("hud-model-status")?.textContent
);

const api = window.HOLOCORE || global.HOLOCORE;
check("application exposes its runtime state", Boolean(api) && Boolean(api.state));
check("boot overlay finishes even without WebGL",
  document.getElementById("boot")?.className.includes("done") ||
    !document.getElementById("boot"),
  "boot overlay dismissed");

/* ------------------------------------------------------------------------- */
/* 2. NON-3D UI IS FULLY FUNCTIONAL                                          */
/* ------------------------------------------------------------------------- */

section("2 · Non-3D interface still works");

const modelCards = document.querySelectorAll(".model-card");
check("model library renders every model", modelCards.length === 8,
  `${modelCards.length} cards`);

const categoryChips = document.querySelectorAll(".category-chip");
check("category filters render", categoryChips.length >= 8, `${categoryChips.length} categories`);

// Filtering works even without a renderer.
const roboticsChip = [...categoryChips].find(chip => chip.textContent === "Robotics");
roboticsChip?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("category filter narrows the model list",
  document.querySelectorAll(".model-card").length === 1,
  `${document.querySelectorAll(".model-card").length} card(s)`);

// Restore all categories.
const allChip = [...document.querySelectorAll(".category-chip")]
  .find(chip => chip.textContent === "All");
allChip?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("filter can be cleared", document.querySelectorAll(".model-card").length === 8);

// Settings drawer opens and closes.
document.getElementById("open-settings").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("settings drawer opens",
  document.getElementById("settings-drawer").classList.contains("open"));
document.getElementById("close-settings").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("settings drawer closes",
  !document.getElementById("settings-drawer").classList.contains("open"));

// Help sheet.
document.getElementById("open-help").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("interaction guide opens", document.getElementById("help-modal").hidden === false);
document.getElementById("close-help").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("interaction guide closes", document.getElementById("help-modal").hidden === true);

// Settings sliders write through to persisted settings.
const pinch = document.getElementById("set-pinch");
pinch.value = "0.8";
pinch.dispatchEvent(new window.Event("input", { bubbles: true }));
const stored = JSON.parse(window.localStorage.getItem("holocore.settings.v1"));
check("changing a slider persists the setting", stored.gesture.pinchThreshold === 0.8,
  `pinchThreshold=${stored.gesture.pinchThreshold}`);
check("the slider read-out updates",
  document.getElementById("val-pinch").textContent === "0.80",
  document.getElementById("val-pinch").textContent);

// The release threshold is kept below the grab threshold automatically.
check("release threshold is kept below the grab threshold",
  stored.gesture.pinchRelease < stored.gesture.pinchThreshold,
  `${stored.gesture.pinchRelease} < ${stored.gesture.pinchThreshold}`);

// A checkbox setting writes through too.
const grid = document.getElementById("set-grid");
grid.checked = false;
grid.dispatchEvent(new window.Event("change", { bubbles: true }));
check("checkbox settings persist",
  JSON.parse(window.localStorage.getItem("holocore.settings.v1")).view.grid === false);

// Camera button is honest about the missing camera API in jsdom.
check("camera control reports unsupported/hidden state instead of pretending",
  document.getElementById("camera-toggle").disabled === true ||
    /CAMERA/i.test(document.getElementById("status-camera").textContent),
  `status="${document.getElementById("status-camera").textContent}"`);

// Keyboard shortcuts must not throw.
let keyError = null;
try {
  for (const key of ["c", "l", "f", "s", "a", "r", "e", "i", "g", "?", "Escape"]) {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  }
} catch (error) {
  keyError = error;
}
check("keyboard shortcuts execute without errors", keyError === null, keyError?.message || "");
check("no uncaught errors after interaction", uncaught.length === 0, uncaught.join(" | "));

/* ------------------------------------------------------------------------- */
/* 3. ERROR MESSAGES ARE SPECIFIC                                            */
/* ------------------------------------------------------------------------- */

section("3 · Failure messaging");

const reportedErrors = consoleErrors.filter(line => !/webgl|renderer/i.test(line));
check("no unexpected console errors", reportedErrors.length === 0,
  reportedErrors.slice(0, 2).join(" | "));

const toasts = [...document.querySelectorAll(".toast")].map(node => node.textContent);
check("the user is told what is wrong", toasts.some(text => /webgl/i.test(text)),
  toasts[0] || "no toasts");
check("no toast claims the camera or tracking works",
  !toasts.some(text => /tracking active|hands detected/i.test(text)));

/* ------------------------------------------------------------------------- */
/* SUMMARY                                                                   */
/* ------------------------------------------------------------------------- */

console.log(`\n${"─".repeat(64)}`);
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} BOOT CHECKS PASSED\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m · ${passed} passed`);
  for (const failure of failures) console.log(`  · ${failure}`);
}
console.log(`${"─".repeat(64)}\n`);
process.exit(failed === 0 ? 0 : 1);
