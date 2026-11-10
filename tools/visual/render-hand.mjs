/**
 * Render the hand overlay to a PNG with a REAL 2D canvas, so the skeleton can be
 * looked at instead of only asserted about. This is the visual harness for the
 * single most important part of the app.
 *
 *   node tools/visual/render-hand.mjs
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

// The overlay probes for a browser; give it one.
const W = 640, H = 480;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const parent = { clientWidth: W, clientHeight: H };

globalThis.document = { createElement: () => ({}) };
globalThis.window = { devicePixelRatio: 1 };
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Mozilla/5.0 Chrome/120" }, configurable: true
});
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.performance = performance;

const { HandOverlay } = await import(join(root, "handOverlay.js"));

// A plausible right hand: wrist at the bottom, fingers fanning up, thumb out.
function makeHand(cx, cy, scale, pinch, rot = 0) {
  const MCP = { thumb: [-0.42, 0.42], index: [-0.26, 0.98], middle: [0, 1.02], ring: [0.22, 0.98], pinky: [0.42, 0.88] };
  const SEG = { thumb: [0.22, 0.17, 0.14], index: [0.3, 0.18, 0.14], middle: [0.32, 0.2, 0.15], ring: [0.3, 0.19, 0.14], pinky: [0.24, 0.15, 0.12] };
  const REST = { thumb: 2.35, index: 1.6, middle: 1.57, ring: 1.53, pinky: 1.44 };
  const IDS = { thumb: [1,2,3,4], index: [5,6,7,8], middle: [9,10,11,12], ring: [13,14,15,16], pinky: [17,18,19,20] };
  const pts = new Array(21).fill([0, 0]);
  pts[0] = [0, 0];
  const fingers = ["thumb","index","middle","ring","pinky"];
  fingers.forEach((f) => {
    let [x, y] = MCP[f];
    let angle = REST[f];
    SEG[f].forEach((len, k) => {
      // curl the finger inward toward the palm as k grows
      const curl = pinch && (f === "thumb" || f === "index") ? (f === "thumb" ? 1.5 : 1.4) : 0.18;
      const a = angle + (k === 0 ? 0 : curl * (k === 1 ? 1.0 : 0.85));
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      pts[IDS[f][k]] = [nx, ny];
      x = nx; y = ny;
    });
  });
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(([px, py]) => {
    const rx = px * c - py * s, ry = px * s + py * c;
    // cx/cy are already normalised 0..1, the space MediaPipe reports in.
    return { x: cx + rx * scale, y: cy - ry * scale, z: 0 };
  });
}

const overlay = new HandOverlay({ canvas, video: { videoWidth: W, videoHeight: H }, settings: { showLandmarks: true, showSkeleton: true, mirror: true } });
if (!overlay.available) { console.error("overlay unavailable"); process.exit(1); }
overlay.width = W; overlay.height = H;
overlay.ctx.setTransform(1, 0, 0, 1, 0, 0);

// Dark backdrop standing in for the camera image.
const backdrop = ctx.createLinearGradient(0, 0, W, H);
backdrop.addColorStop(0, "#7d7062");
backdrop.addColorStop(0.55, "#9a8b78");
backdrop.addColorStop(1, "#584d43");
ctx.fillStyle = backdrop;
ctx.fillRect(0, 0, W, H);

// draw() clears the canvas, which would wipe the backdrop; suppress the clear so
// the skeleton is composited over the stand-in camera image.
overlay.clear = () => {};

const open = makeHand(0.33, 0.86, 0.34, false, 0.25);
const pinched = makeHand(0.70, 0.84, 0.36, true, -0.2);

overlay.draw([open, pinched], ["Left", "Right"], {
  pinched: [false, true],
  activity: [0.15, 1],
  targets: [null, "Shoulder Link"],
  tethers: [null, { x: 420, y: 150 }]
});

mkdirSync(here, { recursive: true });
writeFileSync(join(here, "hand-skeleton.png"), canvas.toBuffer("image/png"));
console.log("wrote tools/visual/hand-skeleton.png");
