/**
 * HOLOCORE — tools/visual/render-inspector.mjs
 * -----------------------------------------------------------------------------
 * Paints the real inspector panel to a PNG so the ported material controls can
 * be looked at without a browser.
 *
 * It boots the real main.js in jsdom with a stub renderer — the same harness
 * validate-full.js uses — spawns a primitive, selects it, and then lays out the
 * live #inspector-root DOM tree with a small block layouter. Styling is read
 * from the real styles.css, so the panel's fonts, colours and sizes come from
 * the app rather than from this script's imagination.
 *
 * What it proves: every control exists, has a non-zero box, sits inside the
 * panel, and the text it shows is the object's real state.
 * What it does not prove: browser text shaping, backdrop blur, or that the
 * panel looks good. It is a layout check, not a screenshot.
 *
 *   node tools/visual/render-inspector.mjs
 */

import { createCanvas } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import * as THREE from "three";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  url: "http://localhost:8000/",
  runScripts: "outside-only"
});
const { window } = dom;

// main.js reads the real DOM at module scope, so the jsdom globals have to be
// installed before the import — the same setup validate-full.js uses.
global.window = window;
global.document = window.document;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.MouseEvent = window.MouseEvent;
global.Event = window.Event;
global.ResizeObserver = window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.requestAnimationFrame = window.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = window.cancelAnimationFrame = () => {};

/* --- the same stub renderer validate-full.js uses ------------------------- */
window.__HOLOCORE_RENDERER_FACTORY__ = () => {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  return {
    domElement: window.document.createElement("canvas"),
    setSize() {},
    setPixelRatio() {},
    setClearColor() {},
    setAnimationLoop(fn) { window.__loop = fn; },
    render() {},
    dispose() {},
    compile() {},
    shadowMap: { enabled: false, type: 0 },
    capabilities: { getMaxAnisotropy: () => 4, isWebGL2: true },
    getContext: () => ({}),
    outputColorSpace: "",
    toneMapping: 0,
    toneMappingExposure: 1,
    getSize: target => target.set(1440, 900),
    __camera: camera
  };
};
window.__HOLOCORE_CONTROLS_FACTORY__ = camera => ({
  target: new THREE.Vector3(),
  enableDamping: false,
  update() { camera.lookAt(this.target); },
  dispose() {}
});
window.WebGLRenderingContext = window.WebGLRenderingContext || function () {};
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  return kind === "2d" ? null : {};
};

await import("../../main.js");
await new Promise(resolve => setTimeout(resolve, 400));

const doc = window.document;
const api = window.HOLOCORE;

/* --- put a real object in the inspector ---------------------------------- */
const playground = api.getPlayground();
playground.clear();
const cube = playground.addPrimitive("cube");
playground.select(cube.id);
api._internals.refreshInspector();
playground.setTransform(cube.id, { position: { x: 1.25, y: 0.4, z: -0.75 } });
api._internals.refreshInspector();

const inspectorRoot = doc.getElementById("inspector-root");
if (!inspectorRoot) {
  console.error("inspector root missing");
  process.exit(1);
}

/* --- styling from the real stylesheet ------------------------------------ */
const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [];
for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const selectors = match[1].split(",").map(s => s.trim()).filter(Boolean);
  const decls = {};
  for (const decl of match[2].split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    decls[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  for (const selector of selectors) rules.push({ selector, decls });
}

/** Resolve a declaration by exact class match, last rule wins as in CSS. */
function styleFor(el, prop, fallback) {
  const classes = [...(el.classList || [])].map(c => `.${c}`);
  const byTag = el.tagName.toLowerCase();
  let value = fallback;
  for (const { selector, decls } of rules) {
    if (!(prop in decls)) continue;
    const simple = selector.split(/[\s>+~]/).pop();
    const matches =
      simple === byTag ||
      classes.includes(simple) ||
      (simple.includes("::") && classes.includes(simple.split("::")[0]));
    if (matches) value = decls[prop];
  }
  return value;
}
const px = (value, fallback) => {
  const n = parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
};

/* --- paint ----------------------------------------------------------------- */
const PANEL_W = 320;
const PAD = 14;
const SCALE = 2.6; // generous, so 8px type is legible in the PNG

const canvas = createCanvas(PANEL_W * SCALE, 720 * SCALE);
const ctx = canvas.getContext("2d");
ctx.scale(SCALE, SCALE);

ctx.fillStyle = "#080d14";
ctx.fillRect(0, 0, PANEL_W, 720);

let y = PAD;
const placed = [];
const problems = [];

function text(el, size, colour, x, baseline, weight = "400") {
  const value = el.textContent?.trim();
  if (!value) return;
  ctx.font = `${weight} ${size}px ui-monospace, monospace`;
  ctx.fillStyle = colour;
  ctx.fillText(value, x, baseline);
}

/** Walk the inspector tree, stacking blocks and recording each control's box. */
function layout(node, x, width) {
  for (const el of node.children) {
    const cls = [...(el.classList || [])];
    const tag = el.tagName.toLowerCase();

    if (cls.includes("inspector-header")) {
      const title = el.querySelector(".inspector-title");
      if (title) text(title, 13, "#eaf7ff", x + PAD, y + 16, "600");
      const kind = el.querySelector(".inspector-kind");
      if (kind) {
        ctx.font = "600 7.5px ui-monospace, monospace";
        const w = ctx.measureText(kind.textContent.trim()).width + 14;
        ctx.strokeStyle = "rgba(120,210,255,0.28)";
        ctx.fillStyle = "rgba(56,189,248,0.10)";
        ctx.beginPath();
        ctx.roundRect(x + PAD, y + 24, w, 14, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(150,225,255,0.85)";
        ctx.fillText(kind.textContent.trim(), x + PAD + 7, y + 34);
        y += 44;
      } else y += 26;
      if (title) placed.push({ el: title, x: x + PAD, y: y - 18, w: 180, h: 16 });
      placed.push({ el, x: x + 4, y: y - 40, w: width - 8, h: 40 });
      continue;
    }

    if (cls.includes("inspector-body")) { layout(el, x, width); continue; }

    if (cls.includes("inspector-section")) {
      const startY = y;
      const title = el.querySelector(".section-title");
      if (title) {
        text(title, 8.5, "rgba(190,220,240,0.55)", x + PAD, y + 10, "600");
        y += 18;
      }
      layout(el, x, width);
      placed.push({ el, x, y: startY, w: width, h: y - startY });
      continue;
    }

    if (cls.includes("prop-group")) {
      const startY = y;
      for (const row of el.querySelectorAll(".prop-row")) {
        const label = row.querySelector(".prop-label");
        const value = row.querySelector(".prop-val");
        if (label) text(label, 8.5, "rgba(190,220,240,0.6)", x + PAD, y + 9);
        if (value) {
          ctx.font = "400 9px ui-monospace, monospace";
          const w = ctx.measureText(value.textContent.trim()).width;
          ctx.fillStyle = "#8ce9ff";
          ctx.fillText(value.textContent.trim(), x + width - PAD - w, y + 9);
        }
        placed.push({ el: row, x: x + PAD, y, w: width - PAD * 2, h: 13 });
        y += 15;
      }
      y += 4;
      continue;
    }

    if (cls.includes("spec-grid")) {
      const dts = [...el.querySelectorAll("dt")];
      const dds = [...el.querySelectorAll("dd")];
      dts.forEach((dt, i) => {
        text(dt, 8.5, "rgba(190,220,240,0.55)", x + PAD, y + 9);
        text(dds[i], 9, "rgba(226,244,255,0.92)", x + PAD + 90, y + 9);
        placed.push({ el: dt, x: x + PAD, y, w: 84, h: 13 });
        y += 15;
      });
      y += 4;
      continue;
    }

    if (cls.includes("prop-color-row")) {
      const input = el.querySelector(".prop-color-input");
      if (input) {
        ctx.fillStyle = input.value;
        ctx.strokeStyle = "rgba(120,210,255,0.28)";
        ctx.beginPath();
        ctx.roundRect(x + PAD, y, 34, 34, 9);
        ctx.fill();
        ctx.stroke();
        placed.push({ el: input, x: x + PAD, y, w: 34, h: 34 });
      }
      const swatches = el.querySelector(".prop-swatches");
      let sx = x + PAD + 44;
      let sy = y + 2;
      for (const sw of swatches?.children || []) {
        if (sx + 17 > x + width - PAD) { sx = x + PAD + 44; sy += 22; }
        ctx.fillStyle = sw.style.background || "#ffffff";
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.roundRect(sx, sy, 17, 17, 5);
        ctx.fill();
        ctx.stroke();
        placed.push({ el: sw, x: sx, y: sy, w: 17, h: 17 });
        sx += 22;
      }
      y = Math.max(y + 38, sy + 19) + 8;
      continue;
    }

    if (cls.includes("prop-switch-label")) {
      const label = el.querySelector(".prop-label");
      text(label, 8.5, "rgba(190,220,240,0.6)", x + PAD, y + 10);
      const box = el.querySelector("input");
      ctx.strokeStyle = "rgba(120,210,255,0.4)";
      ctx.strokeRect(x + width - PAD - 15, y + 2, 15, 15);
      if (box?.checked) {
        ctx.fillStyle = "#38d6ff";
        ctx.fillRect(x + width - PAD - 12, y + 5, 9, 9);
      }
      placed.push({ el: el, x: x + PAD, y, w: width - PAD * 2, h: 19 });
      y += 23;
      continue;
    }

    if (cls.includes("prop-sliders")) {
      for (const item of el.children) {
        const row = item.querySelector(".prop-row");
        const label = row?.querySelector(".prop-label");
        const value = row?.querySelector(".prop-val");
        if (label) text(label, 8.5, "rgba(190,220,240,0.6)", x + PAD, y + 9);
        if (value) {
          ctx.font = "400 9px ui-monospace, monospace";
          const w = ctx.measureText(value.textContent.trim()).width;
          ctx.fillStyle = "#8ce9ff";
          ctx.fillText(value.textContent.trim(), x + width - PAD - w, y + 9);
        }
        const input = item.querySelector(".prop-slider-input");
        if (input) {
          const trackW = width - PAD * 2;
          const ratio = Number(input.value);
          ctx.fillStyle = "rgba(120,210,255,0.18)";
          ctx.fillRect(x + PAD, y + 15, trackW, 3);
          ctx.fillStyle = "#38d6ff";
          ctx.fillRect(x + PAD, y + 15, trackW * ratio, 3);
          ctx.beginPath();
          ctx.arc(x + PAD + trackW * ratio, y + 16.5, 4.5, 0, Math.PI * 2);
          ctx.fill();
          placed.push({ el: input, x: x + PAD, y: y + 12, w: trackW, h: 9 });
        }
        y += 28;
      }
      y += 4;
      continue;
    }

    if (cls.includes("prose") || cls.includes("provenance")) {
      ctx.font = "400 8px ui-monospace, monospace";
      ctx.fillStyle = "rgba(180,205,225,0.55)";
      const words = (el.textContent || "").trim().split(/\s+/);
      let line = "";
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > width - PAD * 2 && line) {
          ctx.fillText(line, x + PAD, y + 9);
          placed.push({ el, x: x + PAD, y, w: width - PAD * 2, h: 12 });
          y += 12;
          line = word;
        } else line = test;
      }
      if (line) {
        ctx.fillText(line, x + PAD, y + 9);
        placed.push({ el, x: x + PAD, y, w: width - PAD * 2, h: 12 });
        y += 13;
      }
      y += 4;
      continue;
    }

    // Unknown block: recurse so nothing is silently skipped.
    layout(el, x, width);
  }
}

layout(inspectorRoot, 0, PANEL_W);

/* --- checks: every control must have a real box inside the panel --------- */
const boxed = el => placed.find(p => p.el === el);
for (const selector of [
  ".prop-color-input", ".prop-swatch", ".prop-slider-input",
  ".prop-switch-label input", ".inspector-title"
]) {
  const nodes = [...inspectorRoot.querySelectorAll(selector)];
  if (!nodes.length) problems.push(`missing ${selector}`);
  for (const node of nodes) {
    const box = boxed(node) || boxed(node.closest?.(".prop-color-row, .prop-sliders, .prop-switch-label"));
    if (!box) problems.push(`${selector} was never laid out`);
    else if (box.w <= 0 || box.h <= 0) problems.push(`${selector} has a zero box`);
    else if (box.x < 0 || box.x + box.w > PANEL_W) problems.push(`${selector} overflows the panel`);
  }
}

const panelHeight = Math.ceil(y + PAD);

// Crop to the content: the scratch canvas is tall so nothing clips while
// laying out, but a mostly-empty PNG is harder to read at a glance.
const cropped = createCanvas(canvas.width, Math.ceil(panelHeight * SCALE));
cropped.getContext("2d").drawImage(canvas, 0, 0);
const out = cropped.toDataURL("image/png");
writeFileSync(join(here, "inspector-panel.png"),
  Buffer.from(out.split(",")[1], "base64"));

console.log(`Inspector panel rendered: ${PANEL_W} x ${panelHeight} CSS px, ${placed.length} boxes`);
console.log(`Sections: ${[...inspectorRoot.querySelectorAll(".section-title")].map(e => e.textContent).join(" / ")}`);
console.log(`Swatches: ${inspectorRoot.querySelectorAll(".prop-swatch").length}, ` +
  `sliders: ${inspectorRoot.querySelectorAll(".prop-slider-input").length}`);
if (problems.length) {
  console.error("LAYOUT PROBLEMS:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("All controls laid out inside the panel.");
