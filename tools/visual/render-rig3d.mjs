/**
 * HOLOCORE — tools/visual/render-rig3d.mjs
 * -----------------------------------------------------------------------------
 * Renders the REAL hand rig (the actual HandSkeleton3D geometry, materials and
 * camera) through a small software rasteriser, and writes a PNG.
 *
 * WHY THIS EXISTS
 *
 * There is no browser or GPU in the build environment, so the 3D skeleton could
 * otherwise only be checked by asserting on numbers. Numbers cannot tell you
 * whether a hand looks like a hand. This walks the same scene graph the app
 * renders — every bone cylinder, joint sphere, fingertip halo and palm triangle
 * — projects it through the same PerspectiveCamera, shades it with the same
 * material colours, and composites it in the same order the late pass uses.
 *
 * It proves: geometry exists and is correctly shaped, the projection is right,
 * the palette reads as neon cyan, bones taper, joints sit on the skeleton, and
 * the hands draw over the model. It does NOT prove GPU shading, real tracking,
 * or how it looks over an actual video feed — those need a browser and a camera.
 *
 *   node tools/visual/render-rig3d.mjs [--out file.png] [--size WxH] [--pinch]
 */

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

import { HandSkeleton3D } from "../../handSkeleton3d.js";

const here = dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const outArg = args.find(a => a.startsWith("--out="));
const sizeArg = args.find(a => a.startsWith("--size="));
const pinching = args.includes("--pinch");

const W = sizeArg ? Number(sizeArg.split("=")[1].split("x")[0]) : 1280;
const H = sizeArg ? Number(sizeArg.split("=")[1].split("x")[1]) : 720;
const OUT = outArg ? outArg.split("=")[1] : join(here, "rig3d.png");

/* -------------------------------------------------------------------------- */
/* A plausible hand                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build 21 MediaPipe-ordered landmarks for one hand, using real proportions.
 *
 * A hand is ~19cm from wrist to middle fingertip, with the palm a little under
 * half of that. Phalanx lengths are roughly 2:1.4:1 from knuckle to tip, and the
 * four digits fan out from the knuckle row rather than standing parallel — that
 * fan is most of what makes a skeleton read as a hand rather than a crown.
 *
 * `curl` 0 = flat, 1 = closed. `pinch` brings the thumb pad onto the index pad.
 */
function makeHand({ cx = 0.5, cy = 0.62, scale = 0.15, flip = 1, curl = 0, pinch = false } = {}) {
  const pts = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  const S = scale;

  // Wrist at the bottom; the hand grows upward (negative y).
  const wristY = cy + S * 0.52;
  const knuckleY = cy + S * 0.02;
  pts[0] = { x: cx, y: wristY, z: 0 };

  // Knuckle row: an arc across the palm, index lowest, pinky highest & narrowest.
  const digits = [
    { base: 5,  spread: -0.30, knuckleLift: 0.00, length: 1.00, phalanx: [0.46, 0.30, 0.24] },
    { base: 9,  spread: -0.10, knuckleLift: 0.03, length: 1.06, phalanx: [0.48, 0.31, 0.25] },
    { base: 13, spread:  0.10, knuckleLift: 0.02, length: 0.98, phalanx: [0.44, 0.29, 0.23] },
    { base: 17, spread:  0.29, knuckleLift: 0.00, length: 0.82, phalanx: [0.38, 0.25, 0.20] }
  ];

  for (const digit of digits) {
    const kx = cx + digit.spread * S * flip;
    const ky = knuckleY - digit.knuckleLift * S;
    pts[digit.base] = { x: kx, y: ky, z: 0 };

    let px = kx;
    let py = ky;
    let pz = 0;
    // Fingers fan outward from the palm centre, then curl toward the palm.
    const fan = digit.spread * 0.55 * flip;
    for (let step = 0; step < 3; step++) {
      const len = S * digit.phalanx[step] * digit.length;
      const bend = curl * (0.55 + step * 0.5);
      px += Math.sin(fan + bend * flip) * len;
      py -= Math.cos(bend) * len;
      pz -= curl * len * 0.5;
      pts[digit.base + step + 1] = { x: px, y: py, z: pz };
    }
  }

  // Thumb: leaves the palm low on the radial side, at a clear angle to the rest.
  const thumb = [
    { x: cx - 0.22 * S * flip, y: wristY - 0.18 * S, z: 0 },
    { x: cx - 0.40 * S * flip, y: wristY - 0.40 * S, z: 0 },
    { x: cx - 0.46 * S * flip, y: wristY - 0.62 * S, z: 0 },
    { x: cx - 0.42 * S * flip, y: wristY - 0.78 * S, z: 0 }
  ];
  thumb.forEach((p, i) => { pts[i + 1] = p; });

  if (pinch) {
    // Thumb pad meets index pad; the joints between follow.
    pts[4] = { ...pts[8] };
    pts[3] = {
      x: pts[4].x + 0.02 * S * flip,
      y: pts[4].y + 0.06 * S,
      z: 0.01
    };
    pts[2] = {
      x: (pts[3].x + pts[1].x) / 2 - 0.01 * S * flip,
      y: (pts[3].y + pts[1].y) / 2,
      z: 0
    };
  }
  return pts;
}

/* -------------------------------------------------------------------------- */
/* Scene: the same camera and rig the app builds                               */
/* -------------------------------------------------------------------------- */

const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
camera.position.set(0, 0, 9);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();

const scene = new THREE.Scene();
const skeleton = new HandSkeleton3D({ scene, camera, mirror: false });

// A playground cube, placed to sit in front of the right hand so the render
// shows the late pass doing its job.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(2.4, 2.4, 2.4),
  new THREE.MeshStandardMaterial({ color: 0x2b7fa8, metalness: 0.4, roughness: 0.35 })
);
cube.position.set(0.9, 0.15, 2.2);
cube.rotation.set(0.35, 0.6, 0.1);
cube.updateMatrixWorld(true);
scene.add(cube);

const leftHand = makeHand({ cx: 0.29, cy: 0.58, scale: 0.15, flip: 1,
  curl: pinching ? 0.35 : 0.12 });
const rightHand = makeHand({ cx: 0.71, cy: 0.60, scale: 0.145, flip: -1,
  curl: 0.18, pinch: pinching });

skeleton.update(
  [leftHand, rightHand],
  [],
  ["Left", "Right"],
  { pinched: [false, pinching], activity: [0.2, pinching ? 1 : 0.3], dt: 1 / 60 }
);

// Settle the ping so the grabbed hand shows its breathe.
for (let i = 0; i < 40; i++) {
  skeleton.update([leftHand, rightHand], [], ["Left", "Right"],
    { pinched: [false, pinching], activity: [0.2, pinching ? 1 : 0.3], dt: 1 / 60 });
}

/* -------------------------------------------------------------------------- */
/* Rasteriser                                                                  */
/* -------------------------------------------------------------------------- */

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const image = ctx.createImageData(W, H);
const pixels = image.data;

// z-buffer, so the opaque pass sorts correctly
const zbuf = new Float32Array(W * H).fill(Infinity);

function toScreen(v) {
  const p = v.clone().project(camera);
  return {
    x: (p.x * 0.5 + 0.5) * W,
    y: (-p.y * 0.5 + 0.5) * H,
    z: p.z,
    // Clip check in clip space: |x|,|y| <= w and z <= w
    inside: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1
  };
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

let additivePass = false;

function putPixel(x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  // Colours arrive normalised 0..1 and the buffer is 0..255.
  if (additivePass) {
    // Three.js AdditiveBlending: dst = dst + src * alpha. Judging the glow
    // under normal alpha would make it look much weaker than it renders.
    pixels[i] = Math.min(255, pixels[i] + rgb[0] * 255 * a);
    pixels[i + 1] = Math.min(255, pixels[i + 1] + rgb[1] * 255 * a);
    pixels[i + 2] = Math.min(255, pixels[i + 2] + rgb[2] * 255 * a);
  } else {
    pixels[i] = pixels[i] * (1 - a) + rgb[0] * 255 * a;
    pixels[i + 1] = pixels[i + 1] * (1 - a) + rgb[1] * 255 * a;
    pixels[i + 2] = pixels[i + 2] * (1 - a) + rgb[2] * 255 * a;
  }
  pixels[i + 3] = 255;
}

/** Barycentric triangle fill with an optional z-test. */
function triangle(a, b, c, rgb, alpha, { depthTest = false, shade = null } = {}) {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-9) return;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y)) / area;
      const w1 = ((px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const z = w2 * a.z + w1 * b.z + w0 * c.z;
      const index = y * W + x;
      if (depthTest && z >= zbuf[index]) continue;
      if (depthTest) zbuf[index] = z;

      const colour = shade ? shade(w2, w1, w0) : rgb;
      putPixel(x, y, colour, alpha);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Pass 1: the scene, with the hands held back (exactly what the late pass    */
/* does — lateLayer.visible = false)                                           */
/* -------------------------------------------------------------------------- */

// Backdrop: a soft, warm camera-feed-like wash so the cyan has something to
// contrast against, plus a vignette. Not a fake webcam — just a neutral plate.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const u = x / W;
    const v = y / H;
    const base = mix([88, 96, 104], [150, 140, 126], 0.35 + 0.4 * v);
    const glow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.42) * 1.5) * 26;
    const vig = 1 - Math.hypot(u - 0.5, v - 0.5) * 0.55;
    const i = (y * W + x) * 4;
    pixels[i] = (base[0] + glow) * vig;
    pixels[i + 1] = (base[1] + glow) * vig;
    pixels[i + 2] = (base[2] + glow * 0.8) * vig;
    pixels[i + 3] = 255;
  }
}

const cubeGeom = cube.geometry;
const cubePos = cubeGeom.attributes.position;
const cubeIndex = cubeGeom.index;
const cubeNormal = cubeGeom.attributes.normal;
const lightDir = new THREE.Vector3(0.4, 0.8, 0.6).normalize();
const baseColour = [0.16, 0.45, 0.62];

function renderMesh(mesh, { depthTest }) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const index = geom.index;
  const matrixWorld = mesh.matrixWorld;
  const colour = mesh.material.color;
  const opacity = mesh.material.opacity ?? 1;

  const worldVerts = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrixWorld);
    worldVerts.push({ world: v, screen: toScreen(v) });
  }

  const emit = (ia, ib, ic, shade) => {
    const a = worldVerts[ia];
    const b = worldVerts[ib];
    const c = worldVerts[ic];
    if (!a || !b || !c) return;
    triangle(a.screen, b.screen, c.screen,
      [colour.r, colour.g, colour.b], opacity, { depthTest, shade });
  };

  const count = index ? index.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;

    // Flat shading from the face normal, so the cube reads as a solid object.
    const n = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().copy(worldVerts[ib].world).sub(worldVerts[ia].world),
        new THREE.Vector3().copy(worldVerts[ic].world).sub(worldVerts[ia].world)
      )
      .normalize();
    const lambert = Math.max(0, n.dot(lightDir)) * 0.8 + 0.28;
    const lit = [colour.r, colour.g, colour.b].map(c => Math.min(1, c * lambert));
    emit(ia, ib, ic, () => lit);
  }
}

renderMesh(cube, { depthTest: true });

/* -------------------------------------------------------------------------- */
/* Pass 2: the late composite — hands over everything, depth test off         */
/* -------------------------------------------------------------------------- */

/** Collect every visible mesh in the rig, ordered exactly as the GPU would. */
function collectLateMeshes() {
  const out = [];
  skeleton.root.traverse(object => {
    if (!object.isMesh) return;
    if (!object.visible) return;
    out.push(object);
  });
  // renderOrder is the authored layer (palm 30 → tips 34); ties break by depth.
  out.sort((a, b) => (a.renderOrder - b.renderOrder));
  return out;
}

const lateMeshes = collectLateMeshes();

// Painter's order within a layer: furthest from the camera first.
const camPos = camera.getWorldPosition(new THREE.Vector3());
lateMeshes.sort((a, b) => {
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const da = a.getWorldPosition(new THREE.Vector3()).distanceTo(camPos);
  const db = b.getWorldPosition(new THREE.Vector3()).distanceTo(camPos);
  return db - da;
});

for (const mesh of lateMeshes) {
  const opacity = mesh.material.opacity ?? 1;
  if (opacity <= 0.01) continue;
  additivePass = mesh.material.blending === THREE.AdditiveBlending;
  renderMesh(mesh, { depthTest: false });
}
additivePass = false;

ctx.putImageData(image, 0, 0);

/* -------------------------------------------------------------------------- */
/* Annotate what was actually drawn                                            */
/* -------------------------------------------------------------------------- */

const rigs = [...skeleton.rigs.values()];
const counts = {
  rigs: rigs.length,
  boneCores: lateMeshes.filter(m => m.material === rigs[0]?.materials?.bone).length,
  joints: lateMeshes.filter(m => m.material === rigs[0]?.materials?.joint ||
    m.material === rigs[0]?.materials?.tip).length,
  haloes: lateMeshes.filter(m => m.material === rigs[0]?.materials?.halo).length
};

ctx.font = "600 13px ui-monospace, monospace";
ctx.fillStyle = "rgba(10, 16, 22, 0.72)";
const label = `${counts.rigs} RIGS · ${counts.joints} JOINTS · ${counts.haloes} HALOES` +
  (pinching ? " · PINCH POSE" : " · OPEN POSE");
const tw = ctx.measureText(label).width;
ctx.fillRect(18, H - 46, tw + 24, 28);
ctx.fillStyle = "#7ceaff";
ctx.fillText(label, 30, H - 27);

writeFileSync(OUT, canvas.toBuffer("image/png"));
console.log(`wrote ${OUT}`);
console.log(`  ${counts.rigs} rig(s), ${lateMeshes.length} late meshes, ` +
  `${counts.joints} joints, ${counts.haloes} haloes`);
