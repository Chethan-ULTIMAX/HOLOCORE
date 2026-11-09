/**
 * HOLOCORE — tools/render-preview.js
 * -----------------------------------------------------------------------------
 * Software rasteriser for the procedural assemblies.
 *
 * This exists because the authoring environment has no GPU and no browser: it
 * renders the *real* scene graph produced by modelFactory.js through the real
 * camera, so the geometry can be inspected visually and gross modelling errors
 * (parts inside-out, collinear, mis-scaled) get caught before shipping.
 *
 *   node tools/render-preview.js            # all models
 *   node tools/render-preview.js gearTrain  # one model
 *
 * Output: tools/preview/<model>.png (+ a contact sheet index.html)
 */

import * as THREE from "three";
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildAssembly } from "../modelFactory.js";
import { MODEL_LIBRARY } from "../engineeringData.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "preview");
mkdirSync(outDir, { recursive: true });

const W = 900;
const H = 620;

/** Linear-light value in [0,1] → sRGB display value in [0,1]. */
function encodeSRGB(value) {
  const v = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/* ------------------------------------------------------------------------- */
/* PNG ENCODING                                                              */
/* ------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(rgb, width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------------- */
/* RASTERISER                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Distinct per-part colour, used by the "parts" mode so a piece of geometry can
 * be attributed to a part id instead of guessed at from grey pixels.
 */
function partColour(index, total) {
  const hue = (index * 0.61803398875) % 1;
  const sat = 0.62;
  const light = total > 6 ? 0.35 + 0.3 * ((index * 7) % 5) / 4 : 0.55;
  const c = new THREE.Color().setHSL(hue, sat, light);
  return c;
}

function renderModel(modelId, cameraPosition, cameraTarget, mode = "shaded") {
  const assembly = buildAssembly(modelId);
  const partColours = new Map();
  assembly.parts.forEach((part, i) => partColours.set(part, partColour(i, assembly.parts.length)));
  const partOfMesh = new Map();
  assembly.group.traverse(object => {
    let root = object;
    while (root && !root.userData.partId && root.parent) root = root.parent;
    if (root?.userData.partId) partOfMesh.set(object, root);
  });
  const scene = new THREE.Scene();
  scene.add(assembly.group);
  scene.updateMatrixWorld(true);

  // Flat assemblies (a CPU package, a PCB) hide their own detail from a low
  // three-quarter view, so they get a higher camera and a tighter lens.
  const extent = new THREE.Box3().setFromObject(assembly.group).getSize(new THREE.Vector3());
  const flat = extent.y < 0.42 * Math.max(extent.x, extent.z);
  const camera = new THREE.PerspectiveCamera(flat ? 32 : 38, W / H, 0.1, 200);
  if (flat) camera.position.set(4.6, 9.4, 6.6);
  else camera.position.copy(cameraPosition);
  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const colour = Buffer.alloc(W * H * 3);
  const depth = new Float32Array(W * H).fill(Infinity);
  const normalBuffer = new Float32Array(W * H * 3);

  // Background: vertical gradient matching the app's viewport.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(6 + t * 4);
    const g = Math.round(9 + t * 6);
    const b = Math.round(14 + t * 10);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      // Subtle radial vignette.
      const dx = (x / W - 0.5) * 2;
      const dy = (y / H - 0.45) * 2;
      const glow = Math.max(0, 1 - Math.hypot(dx, dy) * 1.15) * 0.10;
      colour[i] = Math.min(255, r + glow * 60);
      colour[i + 1] = Math.min(255, g + glow * 150);
      colour[i + 2] = Math.min(255, b + glow * 200);
    }
  }

  // ---- ground plane: drawn before the geometry so the z-buffer occludes it.
  // Grid cells record depth so a part sitting on the ground hides the lines
  // behind it instead of being painted over (the previous ordering bug).
  const groundY = cameraTarget.y - 3.05;
  const gridStep = 1.5;
  const gridRange = 9;
  for (let i = -gridRange; i <= gridRange; i++) {
    for (const axis of ["x", "z"]) {
      const a = new THREE.Vector3(axis === "x" ? i * gridStep : -gridRange * gridStep, groundY, axis === "x" ? -gridRange * gridStep : i * gridStep);
      const b2 = new THREE.Vector3(axis === "x" ? i * gridStep : gridRange * gridStep, groundY, axis === "x" ? gridRange * gridStep : i * gridStep);
      const pa = a.clone().project(camera);
      const pb = b2.clone().project(camera);
      const steps = 300;
      const major = i % 3 === 0;
      for (let s2 = 0; s2 < steps; s2++) {
        const t = s2 / steps;
        const ndcX = pa.x + (pb.x - pa.x) * t;
        const ndcY = pa.y + (pb.y - pa.y) * t;
        const ndcZ = pa.z + (pb.z - pa.z) * t;
        const px = Math.round((ndcX * 0.5 + 0.5) * W);
        const py = Math.round((-ndcY * 0.5 + 0.5) * H);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const idx = py * W + px;
        if (ndcZ >= depth[idx]) continue;
        const o = idx * 3;
        const strength = major ? 1 : 0.55;
        colour[o] = Math.min(255, colour[o] + 10 * strength);
        colour[o + 1] = Math.min(255, colour[o + 1] + 26 * strength);
        colour[o + 2] = Math.min(255, colour[o + 2] + 36 * strength);
      }
    }
  }

  const light = new THREE.Vector3(6, 10, 7).normalize();
  const rimLight = new THREE.Vector3(-7, 3, -6).normalize();

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();

  const meshes = [];
  assembly.group.traverse(object => {
    if (object.isMesh && object.visible) meshes.push(object);
  });

  // Contact shadow: project every triangle straight down onto the ground plane.
  // Drawn before the parts and depth-tested, so a cutaway assembly sits in a
  // lit scene instead of floating in a void.
  {
    const mask = new Float32Array(W * H);
    for (const mesh of meshes) {
      const pos = mesh.geometry.attributes.position;
      if (!pos) continue;
      const m = mesh.matrixWorld;
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
        const b2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)).applyMatrix4(m);
        const c2 = new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)).applyMatrix4(m);
        const pa = new THREE.Vector3(a.x, groundY, a.z).project(camera);
        const pb = new THREE.Vector3(b2.x, groundY, b2.z).project(camera);
        const pc = new THREE.Vector3(c2.x, groundY, c2.z).project(camera);
        const ax = (pa.x * 0.5 + 0.5) * W, ay = (-pa.y * 0.5 + 0.5) * H;
        const bx = (pb.x * 0.5 + 0.5) * W, by = (-pb.y * 0.5 + 0.5) * H;
        const cx = (pc.x * 0.5 + 0.5) * W, cy = (-pc.y * 0.5 + 0.5) * H;
        const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        if (Math.abs(area) < 1e-6) continue;
        const inv = 1 / area;
        const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
        const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5, py = y + 0.5;
            const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) * inv;
            const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) * inv;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            mask[y * W + x] = 1;
          }
        }
      }
    }
    // Two-pass box blur for a penumbra.
    const soft = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, n2 = 0;
        for (let dy = -5; dy <= 5; dy += 2) {
          for (let dx = -5; dx <= 5; dx += 2) {
            const sx = x + dx, sy = y + dy;
            n2++;
            if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
            sum += mask[sy * W + sx];
          }
        }
        soft[y * W + x] = sum / n2;
      }
    }
    for (let i = 0; i < W * H; i++) {
      if (depth[i] !== Infinity) continue;
      const alpha = soft[i] * 0.55;
      if (alpha <= 0.002) continue;
      const o = i * 3;
      colour[o] *= 1 - alpha;
      colour[o + 1] *= 1 - alpha;
      colour[o + 2] *= 1 - alpha;
    }
  }

  let trianglesDrawn = 0;

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (!position) continue;
    const index = geometry.index;
    const matrix = mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const solid = mode === "parts"
      ? (partColours.get(partOfMesh.get(mesh)) ?? new THREE.Color(0x888888))
      : null;
    const base = solid ?? (material?.color ? material.color : new THREE.Color(0x99aabb));
    const emissive = solid ? new THREE.Color(0x000000) : (material?.emissive || new THREE.Color(0x000000));
    const metalness = solid ? 0.2 : (material?.metalness ?? 0.5);
    const roughness = solid ? 0.7 : (material?.roughness ?? 0.4);

    const triCount = index ? index.count / 3 : position.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ai = index ? index.getX(t * 3) : t * 3;
      const bi = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ci = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      v0.fromBufferAttribute(position, ai).applyMatrix4(matrix);
      v1.fromBufferAttribute(position, bi).applyMatrix4(matrix);
      v2.fromBufferAttribute(position, ci).applyMatrix4(matrix);

      edge1.subVectors(v1, v0);
      edge2.subVectors(v2, v0);
      n.crossVectors(edge1, edge2);
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();

      p0.copy(v0).project(camera);
      p1.copy(v1).project(camera);
      p2.copy(v2).project(camera);
      if (p0.z > 1 && p1.z > 1 && p2.z > 1) continue;
      if (p0.z < -1 && p1.z < -1 && p2.z < -1) continue;

      const x0 = (p0.x * 0.5 + 0.5) * W;
      const y0 = (-p0.y * 0.5 + 0.5) * H;
      const x1 = (p1.x * 0.5 + 0.5) * W;
      const y1 = (-p1.y * 0.5 + 0.5) * H;
      const x2 = (p2.x * 0.5 + 0.5) * W;
      const y2 = (-p2.y * 0.5 + 0.5) * H;

      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 0.02) continue;

      // World-space normal for shading (double-sided).
      const worldNormal = n.clone().applyMatrix3(normalMatrix).normalize();
      const viewDir = v0.clone().sub(camera.position).normalize();
      if (worldNormal.dot(viewDir) > 0) worldNormal.negate();

      // Wrapped diffuse: interiors of a cutaway are lit by bounce light, so a
      // half-Lambert wrap keeps them readable instead of pure black.
      const diffuse = Math.max(0, (worldNormal.dot(light) + 0.45) / 1.45);
      const rim = Math.max(0, worldNormal.dot(rimLight)) * 0.55;
      const spec = Math.pow(
        Math.max(0, worldNormal.dot(light.clone().add(viewDir).normalize())),
        4 + (1 - roughness) * 60
      ) * metalness * 0.85;
      const ambient = 0.26 + 0.10 * worldNormal.y;

      // Materials are authored in sRGB but three.js stores them linear, so the
      // shading has to happen in linear space and be encoded back afterwards.
      // Skipping the encode is what made dark castings render as black holes.
      const env = 0.15 + 0.22 * Math.abs(worldNormal.y) + 0.12 * Math.max(0, worldNormal.z);
      const shade = ambient + diffuse * 0.85 + rim + env * metalness;
      const specTerm = spec * 0.75;
      const lr = base.r * shade + specTerm + emissive.r * 0.6;
      const lg = base.g * shade + specTerm + emissive.g * 0.6;
      const lb = base.b * shade + specTerm + emissive.b * 0.6;
      const cr = encodeSRGB(lr) * 255;
      const cg = encodeSRGB(lg) * 255;
      const cb = encodeSRGB(lb) * 255;

      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const inv = 1 / area;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
          const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;

          const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
          const idx = y * W + x;
          if (z >= depth[idx]) continue;
          depth[idx] = z;

          const o = idx * 3;
          colour[o] = cr;
          colour[o + 1] = cg;
          colour[o + 2] = cb;
          normalBuffer[o] = worldNormal.x;
          normalBuffer[o + 1] = worldNormal.y;
          normalBuffer[o + 2] = worldNormal.z;
        }
      }
      trianglesDrawn++;
    }
  }

  return { png: encodePNG(colour, W, H), trianglesDrawn, parts: assembly.parts.map(p => p.userData.partId) };
}

/* ------------------------------------------------------------------------- */
/* MAIN                                                                      */
/* ------------------------------------------------------------------------- */

const parts_mode = process.argv.includes("--parts");
const only = process.argv.slice(2).find(a => !a.startsWith("--"));
const models = MODEL_LIBRARY.filter(model => !only || model.id === only);

const results = [];
for (const model of models) {
  const cameraPosition = new THREE.Vector3(6.4, 4.4, 9.6);
  const cameraTarget = new THREE.Vector3(0, 0.1, 0);
  const { png, trianglesDrawn, parts } = renderModel(model.id, cameraPosition, cameraTarget, parts_mode ? "parts" : "shaded");
  const file = join(outDir, `${model.id}${parts_mode ? "-parts" : ""}.png`);
  writeFileSync(file, png);
  results.push({ model, trianglesDrawn, parts });
  console.log(
    `${model.id.padEnd(14)} ${String(parts.length).padStart(3)} parts · ` +
    `${String(trianglesDrawn).padStart(6)} triangles → tools/preview/${model.id}${parts_mode ? "-parts" : ""}.png`
  );
}

// Gallery page so all previews can be compared side by side.
const cards = results.map(({ model, parts, trianglesDrawn }) => `
  <figure>
    <img src="${model.id}.png" alt="${model.name}">
    <figcaption>
      <strong>${model.name}</strong>
      <span>${model.category} · ${parts.length} parts · ${trianglesDrawn.toLocaleString()} triangles</span>
      <a href="${model.id}-parts.png">part-id colouring</a>
    </figcaption>
  </figure>`).join("\n");

writeFileSync(join(outDir, "index.html"), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>HOLOCORE — procedural model previews</title>
<style>
  body { margin:0; background:#05070c; color:#dbe7f1; font-family:Inter,system-ui,sans-serif; padding:28px; }
  h1 { font-size:18px; letter-spacing:.16em; font-weight:600; margin:0 0 4px; }
  p.note { color:#7d93a6; font-size:12px; margin:0 0 24px; max-width:760px; line-height:1.6; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:18px; }
  figure { margin:0; border:1px solid rgba(120,170,210,.16); border-radius:10px; overflow:hidden; background:#080c12; }
  img { display:block; width:100%; height:auto; }
  figcaption { padding:10px 12px; display:flex; flex-direction:column; gap:3px; }
  figcaption strong { font-size:12.5px; font-weight:600; }
  figcaption span { font-size:10px; color:#7d93a6; letter-spacing:.04em; }
  figcaption a { font-size:10px; color:#3fd0ff; text-decoration:none; letter-spacing:.04em; }
  figcaption a:hover { text-decoration:underline; }
</style></head>
<body>
  <h1>HOLOCORE · PROCEDURAL MODEL PREVIEWS</h1>
  <p class="note">Software-rasterised from the real scene graph in modelFactory.js using the same camera
  the application uses. No GPU was available in the authoring environment, so these renders are the
  visual verification that each assembly is real geometry rather than a placeholder.
  The <a href="../index.html">live application</a> needs WebGL and a browser.</p>
  <div class="grid">${cards}</div>
</body></html>
`);

console.log(`\nGallery: tools/preview/index.html`);
