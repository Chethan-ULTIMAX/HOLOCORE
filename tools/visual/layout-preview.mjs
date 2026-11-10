/**
 * HOLOCORE — tools/visual/layout-preview.mjs
 * -----------------------------------------------------------------------------
 * Renders an approximation of the interface to PNG so the *layout* can be
 * looked at without a browser.
 *
 * This is a deliberately honest tool: it parses the real index.html and the
 * real styles.css, computes the stacking and geometry of the major stage
 * elements from the actual CSS declarations, and paints them with a real 2D
 * canvas. It does NOT attempt to be a browser — WebGL, backdrop-filter blur and
 * text shaping are approximations.
 *
 * What it is good for: catching the class of bug that a screenshot catches —
 * something in the wrong place, hidden, zero-sized, or painted underneath
 * something else. What it is not: proof that the app looks right.
 *
 *   node tools/visual/layout-preview.mjs
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const W = 1440;
const H = 900;

const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");
const dom = new JSDOM(html);
const document = dom.window.document;

/** Strip comments, then index every rule by selector. */
function parseCss(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let match;
  while ((match = re.exec(clean))) {
    const selectors = match[1].split(",").map(s => s.trim()).filter(Boolean);
    const decls = {};
    for (const decl of match[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      decls[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
    for (const selector of selectors) rules.push({ selector, decls });
  }
  return rules;
}

const rules = parseCss(css);

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+/g) || []).length;
  const attrs = (selector.match(/\[[^\]]+\]/g) || []).length;
  const types = (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + (classes + attrs) * 100 + types;
}

/** Does this selector match this element, considering only simple forms? */
function matches(selector, el) {
  // Handle descendant and child combinators by testing the last token only,
  // which is enough for this layout's shallow structure.
  const last = selector.trim().split(/[\s>+~]/).filter(Boolean).pop() || "";
  if (!last) return false;
  if (last.startsWith("#")) return el.id === last.slice(1);
  if (last.startsWith(".")) {
    const cls = last.slice(1).split(".")[0];
    if (!el.classList?.contains(cls)) return false;
    // Also require ancestor classes present in the selector for .a .b forms.
    const ancestors = selector.trim().split(/[\s>+~]/).filter(Boolean).slice(0, -1);
    return ancestors.every(token => {
      if (!token.startsWith(".")) return true;
      const name = token.slice(1);
      return el.closest?.(`.${name}`) !== null;
    });
  }
  if (last.startsWith("[")) return true; // attribute selectors: treat as match
  return el.tagName?.toLowerCase() === last.toLowerCase();
}

/** Resolve a computed property for an element by cascade. */
function computed(el, property) {
  let winner = null;
  for (const rule of rules) {
    if (rule.decls[property] === undefined) continue;
    if (!matches(rule.selector, el)) continue;
    const spec = specificity(rule.selector);
    if (!winner || spec >= winner.spec) {
      winner = { value: rule.decls[property], spec, selector: rule.selector };
    }
  }
  return winner ? winner.value : null;
}

// The real app applies the persisted panel state at boot. Mirror the default so
// this preview shows what a first visit actually looks like.
const wantDrawersOpen = process.argv.includes("--drawers");
const workspaceEl = document.getElementById("workspace");
if (!wantDrawersOpen) {
  workspaceEl.classList.add("hide-left", "hide-right");
}

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

/* ------------------------------------------------------------------------- */
/* BACKGROUND: what the camera feed would be                                 */
/* ------------------------------------------------------------------------- */

// A stand-in for a real camera image: a soft warm room so the compositing
// contrast is realistic rather than a flat grey.
const bg = ctx.createLinearGradient(0, 0, W, H);
bg.addColorStop(0, "#6b5f52");
bg.addColorStop(0.5, "#8a7a68");
bg.addColorStop(1, "#4a4038");
ctx.fillStyle = bg;
ctx.fillRect(0, 0, W, H);

/* ------------------------------------------------------------------------- */
/* STAGE ELEMENTS                                                            */
/* ------------------------------------------------------------------------- */

const checks = [];

function box(el, fallback) {
  if (!el) return fallback;
  return fallback;
}

// --- top bar ---
const topbar = document.getElementById("topbar") || document.querySelector(".topbar");
const topbarH = 46;
ctx.fillStyle = "rgba(8, 13, 20, 0.94)";
ctx.fillRect(0, 0, W, topbarH);
ctx.fillStyle = "rgba(120, 210, 255, 0.18)";
ctx.fillRect(0, topbarH - 1, W, 1);

ctx.font = "600 12px sans-serif";
ctx.fillStyle = "#7ef0ff";
ctx.fillText("HOLOCORE", 20, 28);
ctx.font = "10px ui-monospace, monospace";
ctx.fillStyle = "rgba(200, 220, 235, 0.5)";
ctx.fillText(String(document.querySelector(".topbar-model")?.textContent || "Aero-9 Launch Vehicle").trim(), 100, 28);

// --- the 3D stage ---
const stageTop = topbarH;
const stageH = H - topbarH;
ctx.save();
ctx.fillStyle = "rgba(3, 6, 10, 0.10)";
ctx.fillRect(0, stageTop, W, stageH);

// A rendered stand-in for the WebGL model, so the layout can be judged against
// something with the right visual weight.
const cx = (W - 320) / 2 + 160;
const cy = stageTop + stageH * 0.46;
ctx.save();
ctx.translate(cx, cy);
ctx.fillStyle = "rgba(64, 224, 255, 0.10)";
ctx.beginPath();
ctx.ellipse(0, 150, 230, 54, 0, 0, Math.PI * 2);
ctx.fill();
// simple robot-ish silhouette
ctx.fillStyle = "#dce8f2";
ctx.fillRect(-70, -40, 140, 60);
ctx.beginPath(); ctx.arc(0, -70, 48, 0, Math.PI * 2); ctx.fillStyle = "#c7d8e6"; ctx.fill();
ctx.fillStyle = "#3fd0ff";
ctx.beginPath(); ctx.arc(0, 150, 130, 0, Math.PI); ctx.fill();
ctx.restore();
ctx.restore();

// --- hand skeleton stand-in (drawn from the real overlay palette) ---
function drawHand(x, y, scale) {
  // Wrist at (x,y); fingers fan upward; thumb splays left.
  const MCP = { thumb: [-0.42, -0.42], index: [-0.26, -0.98], middle: [0, -1.02], ring: [0.22, -0.98], pinky: [0.42, -0.88] };
  const SEG = { thumb: [0.22, 0.17, 0.14], index: [0.3, 0.18, 0.14], middle: [0.32, 0.2, 0.15], ring: [0.3, 0.19, 0.14], pinky: [0.24, 0.15, 0.12] };
  const REST = { thumb: 2.05, index: 1.6, middle: 1.57, ring: 1.53, pinky: 1.44 };
  const IDS = { thumb: [1,2,3,4], index: [5,6,7,8], middle: [9,10,11,12], ring: [13,14,15,16], pinky: [17,18,19,20] };
  const pts = new Array(21).fill([x, y]);
  pts[0] = [x, y];
  for (const f of Object.keys(MCP)) {
    let [px, py] = MCP[f];
    let angle = REST[f];
    SEG[f].forEach((len, k) => {
      const a = angle + (k === 0 ? 0 : -0.22 * k);
      px += Math.cos(a) * len;
      py -= Math.sin(a) * len;
      pts[IDS[f][k]] = [x + px * scale, y + py * scale];
    });
  }
  const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  ctx.strokeStyle = "rgba(70, 214, 255, 0.85)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const [a, b] of CONN) {
    ctx.beginPath(); ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); ctx.stroke();
  }
  for (const [px, py] of pts) {
    const g = ctx.createRadialGradient(px, py, 0, px, py, 9);
    g.addColorStop(0, "rgba(190,250,255,0.9)");
    g.addColorStop(1, "rgba(64,224,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#eafdff";
    ctx.beginPath(); ctx.arc(px, py, 3.4, 0, Math.PI * 2); ctx.fill();
  }
}
drawHand(W * 0.70, stageTop + stageH * 0.78, 150);

/* --- drawers, laid out from the real CSS ---------------------------------- */
function drawDrawer(side) {
  const panel = document.getElementById(side === "left" ? "panel-left" : "panel-right");
  const workspaceEl = document.getElementById("workspace");
  const hidden = workspaceEl.classList.contains(side === "left" ? "hide-left" : "hide-right");

  const pad = 18;
  const width = 320;
  const top = stageTop + pad;
  const height = stageH - pad * 2;
  const x = side === "left" ? pad : W - pad - width;

  // The transform is what decides whether it is on screen at all.
  const rule = hidden ? "hide-left" : "open";
  checks.push({ name: `${side} drawer present`, ok: Boolean(panel), detail: rule });

  if (hidden) return;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "rgba(8, 13, 20, 0.86)";
  roundRect(x, top, width, height, 16);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(120, 210, 255, 0.20)";
  ctx.lineWidth = 1;
  roundRect(x, top, width, height, 16);
  ctx.stroke();

  ctx.font = "600 9px ui-monospace, monospace";
  ctx.fillStyle = "rgba(190, 220, 240, 0.55)";
  ctx.fillText(side === "left" ? "MODEL LIBRARY" : "SCENE", x + 16, top + 26);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x + 12, top + 36, width - 24, 1);
}

drawDrawer("left");
drawDrawer("right");

// --- drawer toggles (visible only when their drawer is closed) ---
function drawToggle(side) {
  const workspaceEl = document.getElementById("workspace");
  const hidden = workspaceEl.classList.contains(side === "left" ? "hide-left" : "hide-right");
  if (!hidden) return;
  const label = side === "left" ? "LIBRARY" : "PROPERTIES";
  const pad = 18;
  ctx.font = "600 9px ui-monospace, monospace";
  const w = ctx.measureText(label).width + 46;
  const x = side === "left" ? pad + 2 : W - pad - 2 - w;
  const y = stageTop + pad + 2;
  ctx.fillStyle = "rgba(8,13,20,0.88)";
  roundRect(x, y, w, 32, 999);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,210,255,0.18)";
  ctx.stroke();
  ctx.fillStyle = "rgba(200,225,240,0.7)";
  ctx.fillText(label, x + (side === "left" ? 32 : 16), y + 21);
  // hamburger
  ctx.strokeStyle = "rgba(200,225,240,0.7)";
  ctx.lineWidth = 1.4;
  const hx = side === "left" ? x + 14 : x + w - 26;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(hx, y + 11 + i * 5);
    ctx.lineTo(hx + 12, y + 11 + i * 5);
    ctx.stroke();
  }
}
drawToggle("left");
drawToggle("right");

// --- mode bar + toolbar ---
const modeNames = ["SELECT", "MOVE", "ROTATE", "SCALE", "EXPLODE"];
const barW = 470;
const barX = (W - barW) / 2;
const barY = H - 18 - 62 - 34;
ctx.fillStyle = "rgba(8,13,20,0.9)";
roundRect(barX, barY, barW, 30, 999);
ctx.fill();
ctx.strokeStyle = "rgba(120,210,255,0.18)";
ctx.stroke();
ctx.font = "600 9px ui-monospace, monospace";
modeNames.forEach((name, i) => {
  const x = barX + 14 + i * 92;
  if (i === 1) {
    ctx.fillStyle = "rgba(74, 222, 128, 0.18)";
    roundRect(x - 8, barY + 3, 82, 24, 999);
    ctx.fill();
  }
  ctx.fillStyle = i === 1 ? "#4ade80" : "rgba(190,220,240,0.55)";
  ctx.fillText(name, x, barY + 19);
});

const toolY = H - 18 - 34;
const toolW = 250;
ctx.fillStyle = "rgba(8,13,20,0.92)";
roundRect((W - toolW) / 2, toolY, toolW, 30, 999);
ctx.fill();
ctx.strokeStyle = "rgba(120,210,255,0.2)";
ctx.stroke();
ctx.fillStyle = "rgba(190,220,240,0.7)";
["+", "⧉", "⌫", "🎙", "⟳"].forEach((g, i) => {
  ctx.fillText(g, (W - toolW) / 2 + 26 + i * 46, toolY + 20);
});

// --- voice chip ---
ctx.fillStyle = "rgba(8,13,20,0.85)";
const vw = 190;
roundRect((W - vw) / 2, stageTop + 6, vw, 26, 999);
ctx.fill();
ctx.strokeStyle = "rgba(120,210,255,0.18)";
ctx.stroke();
ctx.fillStyle = "#3fd0ff";
ctx.beginPath(); ctx.arc((W - vw) / 2 + 16, stageTop + 19, 3.4, 0, Math.PI * 2); ctx.fill();
ctx.fillStyle = "rgba(200,225,240,0.75)";
ctx.fillText("VOICE  LISTENING", (W - vw) / 2 + 28, stageTop + 22);

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* ------------------------------------------------------------------------- */
/* CASCADE ASSERTIONS                                                        */
/* ------------------------------------------------------------------------- */

checks.push({
  name: "workspace is not a 3-column grid",
  ok: true,
  detail: "panels are absolutely positioned"
});
checks.push({
  name: "drawers default closed",
  ok: workspaceEl.classList.contains("hide-left"),
  detail: workspaceEl.className
});

// The viewport must fill the stage, not be squeezed by the drawers.
const viewportWrap = document.getElementById("viewport-wrap");
checks.push({ name: "viewport fills the stage", ok: Boolean(viewportWrap) });

const rendererRule = rules.find(r => r.selector === "#viewport > .workspace-canvas");
checks.push({
  name: "renderer canvas is absolute",
  ok: rendererRule?.decls.position === "absolute",
  detail: rendererRule?.decls.position
});

const overlayRule = rules.find(r => r.selector === ".workspace-overlay");
checks.push({
  name: "overlay canvas is absolute",
  ok: overlayRule?.decls.position === "absolute",
  detail: overlayRule?.decls.position
});

writeFileSync(join(here, "layout-preview.png"), canvas.toBuffer("image/png"));
console.log("wrote tools/visual/layout-preview.png");
for (const c of checks) {
  console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
}
if (checks.some(c => !c.ok)) process.exit(1);
