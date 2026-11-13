/**
 * HOLOCORE — handSkeleton3d.js
 * -----------------------------------------------------------------------------
 * The hand skeleton as real geometry in the Three.js scene, rather than flat
 * 2D lines on an overlay canvas.
 *
 * WHY THIS EXISTS
 *
 * A 2D overlay can only ever look like a drawing on the camera image. To make
 * hands feel like they are *in* the space, the joints need to be scene objects:
 * they receive the same tone mapping and exposure as the model, they can be
 * lit, and — most importantly — they can be occluded by geometry in front of
 * them, which is what sells the illusion of depth.
 *
 * COORDINATES
 *
 * MediaPipe reports `landmarks` (normalised image space, 0..1) and
 * `worldLandmarks` (metres, origin at the hand's centre). This module places
 * the hand on a sphere centred on the camera frustum:
 *
 *   - the normalised x/y are mapped through the same cover-fit + mirror maths
 *     the 2D pointer uses, so the 3D and 2D layers can never disagree;
 *   - the depth is a fixed distance from the camera in front of the model,
 *     offset by the hand's own `worldLandmarks` depth so fingers that reach
 *     toward the lens really do move toward it;
 *   - `worldLandmarks` is then used *relative* to the wrist, which gives the
 *     skeleton correct 3D shape and correct foreshortening as the hand rotates.
 *
 * The result is a hand that is anatomically 3D, sits at the right screen
 * position, and responds to real rotation — not a flat billboard.
 */

import * as THREE from "three";
import { HAND_CONNECTIONS } from "./handOverlay.js";
import {
  handJoints,
  spreadFromWrist,
  FALLBACK_METRIC_SCALE
} from "./handCoordinates.js";
import { HandSmootherRegistry } from "./handSmoothing.js";
import { normaliseProfile } from "./trackingProfiles.js";

const TIP_INDICES = [4, 8, 12, 16, 20];

/** Distance from the camera to the hand plane, in world units. */
const HAND_DEPTH = 6.2;

/**
 * Neon cyan, kept deliberately close to the reference implementation's
 * `0x00ccff` line colour. The two hands differ only enough to be told apart at
 * a glance - the single-colour look is what makes the overlay read as one
 * instrument rather than two unrelated drawings.
 */
const PALETTE = {
  left: {
    // White is confined to `core`, and the core is deliberately small. Fingertip
    // caps are cyan like the bones — a white tip at that size reads as a grey
    // blob and breaks the neon identity of the whole overlay.
    core: 0xffffff,
    ring: 0x53e4ff,
    bone: 0x00d4ff,
    glow: 0x009dff,
    tip: 0x5fe8ff,
    palm: 0x0fa8d8,
    emissive: 0x14708f
  },
  right: {
    core: 0xffffff,
    ring: 0x74ecff,
    bone: 0x22c4ff,
    glow: 0x1a86ff,
    tip: 0x7ceeff,
    palm: 0x1490cc,
    emissive: 0x157a99
  }
};

/** True when `node` is `ancestor` or somewhere beneath it. */
function isDescendantOf(node, ancestor) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/**
 * A quaternion that makes a flat piece (the fingertip halo) face the camera.
 * Cheaper and more stable than lookAt for something rebuilding every frame.
 */
function cameraFacingQuaternion(camera) {
  if (!camera) return new THREE.Quaternion();
  return camera.quaternion.clone();
}

function paletteFor(side) {
  return String(side).toLowerCase() === "left" ? PALETTE.left : PALETTE.right;
}

/**
 * Convert a normalised MediaPipe landmark to a world position on the hand
 * plane in front of `camera`.
 *
 * @param {{x:number,y:number}} point        normalised image space
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} [options]
 * @param {boolean} [options.mirror=true]
 * @param {number}  [options.depth=HAND_DEPTH]
 * @param {number}  [options.offsetX=0] pixel-independent world nudge
 * @param {number}  [options.offsetY=0]
 */
export function landmarkToWorld(point, camera, {
  mirror = true, depth = HAND_DEPTH, offsetX = 0, offsetY = 0, fit = null
} = {}) {
  // The <video> is displayed with object-fit: cover, so on a stage whose aspect
  // ratio differs from the camera the image is centre-cropped. The 2D overlay
  // has always compensated for that; the 3D rigs did not, so on a non-16:9
  // stage the scene skeletons drifted away from the real hands. `fit` carries
  // the cover rectangle (from handGeometry.coverFit) and is applied here in
  // normalised space, exactly like the 2D path.
  let u = point.x;
  let v = point.y;
  if (fit) {
    const boxWidth = Math.max(1, fit.boxWidth);
    const boxHeight = Math.max(1, fit.boxHeight);
    // Source pixels for this landmark, relative to the visible crop.
    const sourceX = point.x * fit.videoWidth - fit.offsetX;
    const sourceY = point.y * fit.videoHeight - fit.offsetY;
    u = (sourceX * fit.scale) / boxWidth;
    v = (sourceY * fit.scale) / boxHeight;
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      u = point.x;
      v = point.y;
    }
  }

  // Mirroring has to happen exactly once, in normalised space, to match the
  // CSS-mirrored video the user is looking at. This happens *after* cropping,
  // because the video is flipped as a whole.
  const nx = mirror ? 1 - u : u;
  // NDC: x right, y up. MediaPipe y runs downward.
  const ndcX = nx * 2 - 1;
  const ndcY = -(v * 2 - 1);

  // Half-extents of the visible frustum at the hand plane.
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth;
  const halfWidth = halfHeight * camera.aspect;

  const worldX = ndcX * halfWidth + offsetX;
  const worldY = ndcY * halfHeight + offsetY;

  // Build the point in camera space, then move it into world space. This is
  // what keeps the hand glued to the camera as it orbits.
  const local = new THREE.Vector3(worldX, worldY, -depth);
  return local.applyMatrix4(camera.matrixWorld);
}

/**
 * One hand's skeleton.
 *
 * This is real 3D geometry, not a billboard: tapered bone volumes with genuine
 * thickness, layered joints, fingertip tips with haloes, and a palm plate that
 * fills the back of the hand. Fingers reaching toward the lens foreshorten and
 * the pieces genuinely sit in front of / behind one another in depth.
 *
 * RENDER ORDER (the "hybrid" part)
 *
 * The rig draws late and with `depthTest: false`, so a model in front of the
 * hand can never hide it — losing the skeleton the moment it passes over the
 * object is far worse than a small occlusion inaccuracy. Depth is *not*
 * discarded, though: each piece's opacity and size are scaled by how far behind
 * the nearest scene geometry it is, so a hand passing behind the model dims and
 * shrinks as it recedes instead of flattening to the same brightness. That is
 * what keeps it reading as 3D while staying always-visible.
 */
class HandRig {
  constructor(side) {
    const colours = paletteFor(side);
    this.group = new THREE.Group();
    this.group.name = `hand-${side}`;
    this.side = side;

    // Shared geometry — 21 joints × 2 hands at 60fps must not allocate.
    this.jointGeometry = new THREE.SphereGeometry(1, 16, 12);
    this.tipGeometry = new THREE.SphereGeometry(1, 20, 16);
    // An annulus, not a filled disc: a ring reads as an aura, a disc reads as
    // a flat sticker over the video.
    this.haloGeometry = new THREE.RingGeometry(0.55, 1, 28);
    this.boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);

    // Every material opts out of tone mapping: ACES at 1.05 exposure drags the
    // authored cyan towards grey (#1ad1ff -> #5cbac4) and flattens the hot
    // cores to near-white, which is what made the skeleton look muted.
    const make = (options) => new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      ...options
    });

    this.materials = {
      // Outer glow sleeve. Additive, so it accumulates into a real halo against
      // whatever is behind it rather than washing the backdrop toward grey.
      boneGlow: make({
        color: colours.glow,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
      }),
      // The solid bone core: saturated cyan, fully opaque, so the limb reads as
      // a defined object rather than a smudge.
      bone: make({ color: colours.bone, opacity: 1 }),
      // Joint ring: deeper cyan than the bone, so joints register as nodes.
      joint: make({ color: colours.ring, opacity: 1 }),
      // Hot centre, small and bright.
      jointCore: make({ color: colours.core, opacity: 1 }),
      // Fingertips read brightest of all — they are where the interaction is.
      tip: make({ color: colours.tip, opacity: 1 }),
      halo: make({
        color: colours.glow,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      }),
      // The palm is a whisper. Additive and very low, so it reads as a soft
      // energy fill behind the bones rather than a solid slab laid over the
      // model — the thing that made an early pass look like a sticker.
      palm: make({
        color: colours.palm,
        opacity: 0.16,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    };

    // ---- layers, in draw order -------------------------------------------
    // Each layer is a separate group so renderOrder is stable and the whole
    // rig can be faded by one multiplier.
    this.palmLayer = new THREE.Group();
    this.palmLayer.renderOrder = 30;

    this.glowLayer = new THREE.Group();
    this.glowLayer.renderOrder = 31;

    this.boneLayer = new THREE.Group();
    this.boneLayer.renderOrder = 32;

    this.jointLayer = new THREE.Group();
    this.jointLayer.renderOrder = 33;

    this.tipLayer = new THREE.Group();
    this.tipLayer.renderOrder = 34;

    // Palm plate: a single triangle fan through wrist + knuckles.
    //
    // Built once and mutated in place. The vertex count and the index list never
    // change, so there is no reason to allocate a new geometry per frame.
    this.palmGeometryData = buildPalmGeometry();
    this.palm = new THREE.Mesh(this.palmGeometryData.geometry, this.materials.palm);
    this.palmPoints = palmIndicesToPoints(this.palmGeometryData.indices);
    this.palm.renderOrder = 30;
    // The palm moves every frame, so its bounds must not be trusted for culling.
    this.palm.frustumCulled = false;
    this.palmLayer.add(this.palm);

    // Bones: a glow sleeve plus a solid core, per connection.
    this.boneGlows = [];
    this.bones = [];
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const glow = new THREE.Mesh(this.boneGeometry, this.materials.boneGlow);
      glow.renderOrder = 31;
      this.glowLayer.add(glow);
      this.boneGlows.push(glow);

      const bone = new THREE.Mesh(this.boneGeometry, this.materials.bone);
      bone.renderOrder = 32;
      this.boneLayer.add(bone);
      this.bones.push(bone);

    }

    // Joints.
    this.joints = [];
    this.cores = [];
    for (let i = 0; i < 21; i++) {
      const isTip = TIP_INDICES.includes(i);
      const joint = new THREE.Mesh(isTip ? this.tipGeometry : this.jointGeometry,
        isTip ? this.materials.tip : this.materials.joint);
      joint.renderOrder = 33;
      this.jointLayer.add(joint);
      this.joints.push(joint);

      const core = new THREE.Mesh(this.jointGeometry, this.materials.jointCore);
      core.renderOrder = 34;
      this.jointLayer.add(core);
      this.cores.push(core);
    }

    // Fingertip haloes: a soft ring that pulses while grabbing.
    this.haloes = [];
    for (const index of TIP_INDICES) {
      const halo = new THREE.Mesh(this.haloGeometry, this.materials.halo);
      halo.renderOrder = 34;
      halo.userData.landmark = index;
      this.tipLayer.add(halo);
      this.haloes.push(halo);
    }

    for (const layer of [this.palmLayer, this.glowLayer, this.boneLayer,
      this.jointLayer, this.tipLayer]) {
      this.group.add(layer);
    }

    this.visible = true;
    this._cameraRef = null;
    // Reusable joint output, filled by the coordinate module each frame. The
    // rig rebuilds its geometry from these; allocating 21 vectors per hand per
    // frame at 60fps is 2,500 allocations a second for no benefit.
    this.scratchPositions = Array.from({ length: 21 }, () => new THREE.Vector3());
    // The smoothed copy the rig actually draws from, so the raw solver output
    // is never mutated and depth probing still sees the true position.
    this.scratchSmoothed = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.pulse = 0;
    this._depth = 1;
    this._up = new THREE.Vector3(0, 1, 0);
    // Shared scratch for bone orientation, installed by the manager so every
    // bone in every rig reuses one quaternion and one direction vector.
    this._boneQuat = new THREE.Quaternion();
    this._boneDir = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._mid = new THREE.Vector3();
  }

  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.group.visible = visible;
  }

  /**
   * Depth cue, not depth occlusion.
   *
   * @param {number} nearness 0 = behind the model, 1 = at the hand plane.
   * Everything about the rig scales with this: opacity, bone thickness and the
   * halo, so a hand that has moved behind the object visibly recedes.
   */
  applyDepth(nearness) {
    const n = Math.max(0, Math.min(1, nearness));
    this._depth = n;
    const fade = 0.42 + 0.58 * n;
    this.materials.bone.opacity = 0.9 * fade;
    this.materials.boneGlow.opacity = 0.16 * fade;
    this.materials.joint.opacity = 0.95 * fade;
    this.materials.jointCore.opacity = fade;
    this.materials.tip.opacity = fade;
    this.materials.halo.opacity = 0.22 * fade;
    this.materials.palm.opacity = 0.2 * fade;
  }

  /**
   * @param {THREE.Vector3[]} positions world positions, one per landmark
   * @param {number} heat 0..1 gesture activity
   * @param {boolean} pinched
   * @param {number} dt seconds since the last frame
   */
  update(positions, heat = 0, pinched = false, dt = 1 / 60) {
    // Grabbed hands breathe: a gentle scale pulse is the clearest possible
    // "the app knows you are holding something" signal.
    const target = pinched ? 1 : 0;
    this.pulse += (target - this.pulse) * Math.min(1, dt * 10);
    this._pulsePhase = (this._pulsePhase || 0) + dt * 6.5;
    const breathe = 1 + this.pulse * 0.14 * (0.5 + 0.5 * Math.sin(this._pulsePhase));

    const depthScale = 0.82 + 0.18 * this._depth;
    const active = (1 + heat * 0.22) * breathe * depthScale;

    // ---- joints ----------------------------------------------------------
    for (let i = 0; i < 21; i++) {
      const isTip = TIP_INDICES.includes(i);
      const isWrist = i === 0;
      const radius = (isWrist ? 0.075 : isTip ? 0.062 : 0.042) * active;

      const joint = this.joints[i];
      joint.position.copy(positions[i]);
      joint.scale.setScalar(radius);

      // A compact white core inside each joint: this is what makes the dots
      // read as lit rather than as flat circles. Kept small (not much over half
      // the sphere) or the joint would wash out to a white blob at distance.
      const core = this.cores[i];
      core.position.copy(positions[i]);
      const coreScale = isWrist ? 0.5 : isTip ? 0.34 : 0.3;
      core.scale.setScalar(radius * coreScale);
    }

    // ---- bones -----------------------------------------------------------
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const [a, b] = HAND_CONNECTIONS[i];
      const pa = positions[a];
      const pb = positions[b];
      const bone = this.bones[i];
      const glow = this.boneGlows[i];

      this._dir.subVectors(pb, pa);
      const length = this._dir.length();
      if (length < 1e-5) {
        bone.visible = false;
        glow.visible = false;
        continue;
      }
      const mid = this._mid.addVectors(pa, pb).multiplyScalar(0.5);
      // Reuse the manager's scratch objects: `setFromUnitVectors` needs a unit
      // vector, and cloning one per bone was ~220 allocations a frame.
      const quaternion = this._boneQuat.setFromUnitVectors(
        this._up, this._boneDir.copy(this._dir).normalize()
      );

      // Fingertip segments taper; the palm rays are the heaviest.
      const tipBone = TIP_INDICES.includes(a) || TIP_INDICES.includes(b);
      const palmRay = a === 0 || b === 0;
      const radius = (palmRay ? 0.026 : tipBone ? 0.019 : 0.023) * active;

      for (const [mesh, scale] of [[bone, 1], [glow, 2.1]]) {
        mesh.visible = true;
        mesh.position.copy(mid);
        mesh.quaternion.copy(quaternion);
        mesh.scale.set(radius * scale, length, radius * scale);
      }
      // Glow is a hair longer so the sleeve wraps the ends.
      glow.scale.y = length * 1.08;
    }

    // ---- fingertip haloes -------------------------------------------------
    for (const halo of this.haloes) {
      const point = positions[halo.userData.landmark];
      halo.position.copy(point);
      const size = (0.115 + this.pulse * 0.06) * active;
      halo.scale.setScalar(size);
      halo.quaternion.copy(cameraFacingQuaternion(this._cameraRef));
    }

    // ---- palm ------------------------------------------------------------
    // Wrist, thumb base and the four knuckles: enough to fill the back of the
    // hand without implying geometry MediaPipe does not actually track.
    //
    // The geometry is allocated once in the constructor and only its position
    // and normal buffers are rewritten here. Rebuilding a BufferGeometry every
    // frame (and disposing the previous one) meant a GPU buffer allocation per
    // hand per frame, which is exactly the kind of churn the brief rules out.
    const { indices, position, normal } = this.palmGeometryData;
    const points = this.palmPoints;
    for (let i = 0; i < indices.length; i++) {
      const source = positions[indices[i]];
      points[i].copy(source);
      position[i * 3] = source.x;
      position[i * 3 + 1] = source.y;
      position[i * 3 + 2] = source.z;
    }

    // Normals for a flat-ish fan: the face normal of the palm plane. Computed
    // from the wrist/knuckle spread rather than computeVertexNormals(), which
    // would rebuild the whole attribute set.
    this._palmNormalInto(normal);

    this.palmGeometryData.positionAttribute.needsUpdate = true;
    this.palmGeometryData.normalAttribute.needsUpdate = true;
  }

  /**
   * Fill the palm's normal buffer from the palm plane.
   *
   * The palm is a fan around the wrist, so a single face normal is correct for
   * every vertex and stays smooth as the hand moves.
   */
  _palmNormalInto(normal) {
    // palmPoints is indexed by position in PALM_LANDMARKS, not by landmark id:
    // [0]=wrist, [1]=thumb base, [2..5]=knuckles.
    const p = this.palmPoints;
    const wrist = p[0];
    const indexKnuckle = p[2];
    const pinkyKnuckle = p[5];
    const ax = indexKnuckle.x - wrist.x;
    const ay = indexKnuckle.y - wrist.y;
    const az = indexKnuckle.z - wrist.z;
    const bx = pinkyKnuckle.x - wrist.x;
    const by = pinkyKnuckle.y - wrist.y;
    const bz = pinkyKnuckle.z - wrist.z;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) {
      // Degenerate palm: any unit normal is as good as another.
      nx = 0; ny = 0; nz = 1;
    } else {
      nx /= length; ny /= length; nz /= length;
    }
    for (let i = 0; i < normal.length; i += 3) {
      normal[i] = nx;
      normal[i + 1] = ny;
      normal[i + 2] = nz;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.jointGeometry.dispose();
    this.tipGeometry.dispose();
    this.haloGeometry.dispose();
    this.boneGeometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.palm.geometry.dispose();
  }
}

/**
 * The palm's source landmarks.
 *
 * Wrist, thumb base and the four knuckles. This is deliberately NOT a full hand
 * mesh: these are the only points MediaPipe actually gives us that describe the
 * back of the hand.
 */
export const PALM_LANDMARKS = [0, 1, 5, 9, 13, 17];

/**
 * Build the palm geometry once.
 *
 * A triangle fan around the wrist. The buffers are writable and stay the same
 * size, so the per-frame update is a memcpy-ish loop rather than an allocation.
 */
function buildPalmGeometry() {
  const count = PALM_LANDMARKS.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) normal[i * 3 + 2] = 1;

  // Fan: (wrist, next, next+1).
  const indices = [];
  for (let i = 1; i < count - 1; i++) indices.push(0, i, i + 1);

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(position, 3);
  const normalAttribute = new THREE.BufferAttribute(normal, 3);
  // Positions change every frame and the palm is never culled, so tell Three.js
  // not to compute a bounding sphere it would have to replace anyway.
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  normalAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("normal", normalAttribute);
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  return {
    geometry,
    indices,
    position,
    normal,
    positionAttribute,
    normalAttribute
  };
}

/** One reusable Vector3 per palm vertex, so the update loop allocates nothing. */
function palmIndicesToPoints(indices) {
  return indices.map(() => new THREE.Vector3());
}

/**
 * Manages one rig per detected hand.
 */
export class HandSkeleton3D {
  constructor({ scene, camera, mirror = true, profile = "balanced" }) {
    this.scene = scene;
    this.camera = camera;
    this.mirror = mirror;
    // The smoothing profile is applied here so a saved setting takes effect on
    // the very first frame, not after the user touches the control.
    this.profile = normaliseProfile(profile);
    this.rigs = new Map();
    this.root = new THREE.Group();
    this.root.name = "hand-skeletons";
    scene.add(this.root);
    this.visible = true;
    this._tmp = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._cast = new THREE.Raycaster();
    this._castDir = new THREE.Vector3();
    this._castOrigin = new THREE.Vector3();
    // Objects the depth cue measures against. Populated lazily from the scene
    // so new playground objects are picked up without extra wiring.
    this._occluders = [];
    this._occluderRefreshAt = 0;
    this._depthProbeAt = 0;
    // The camera's rotation half, refreshed once per update rather than once
    // per joint. `extractRotation` inside the joint loop was the single biggest
    // per-frame allocation in this module.
    this._cameraRotation = new THREE.Matrix4();
    // 21 reusable camera-local offsets, shared across hands because they are
    // consumed into the rig's own buffer before the next hand is handled.
    this._offsets = Array.from({ length: 21 }, () => new THREE.Vector3());
    // Bone orientation scratch, so the per-bone quaternion is not reallocated.
    this._boneQuat = new THREE.Quaternion();
    this._boneDir = new THREE.Vector3();
    // Per-hand, per-joint smoothing. The 3D rig is the skeleton the user
    // actually sees and touches; it used to place joints straight from the
    // solver while the 2D overlay smoothed, so the visible one juddered.
    this.smoothers = new HandSmootherRegistry({ settings: { profile: this.profile } });
    // Per-hand depth state, keyed like the rigs themselves. Each hand owns its
    // own probe timer and its own smoothed value.
    this._nearnessState = new Map();
  }

  /**
   * The objects worth measuring hand depth against: anything visible and made
   * of triangles that is not the hands themselves or the ground.
   *
   * Refreshed on a timer rather than every frame — the raycaster is only asked
   * about a handful of points, but rebuilding this list each frame would walk
   * the whole scene graph for every hand.
   */
  _refreshOccluders(now) {
    if (now < this._occluderRefreshAt && this._occluders.length) return this._occluders;
    this._occluderRefreshAt = now + 500;
    const found = [];
    const root = this.root.parent || this.scene;
    root.traverse(object => {
      if (!object.isMesh || !object.visible) return;
      // Never measure against the hands, the ground plane or the grid.
      if (this.root && isDescendantOf(object, this.root)) return;
      if (object.material?.depthWrite === false && object.material?.transparent) return;
      found.push(object);
    });
    this._occluders = found;
    return found;
  }

  /**
   * How far in front of the scene geometry a hand is, as 0..1.
   *
   * 1 means nothing is between the hand and the camera (the normal case, hand
   * at the lens). Lower values mean scene geometry sits in front of it. The rig
   * uses this to dim and shrink rather than vanish, because `depthTest: false`
   * keeps the skeleton visible but should not make it look flat.
   */
  _nearnessFor(positions, key = "default") {
    if (!positions?.length) return 1;
    const now = performance.now();

    // Per-hand cache. There used to be a single `_lastNearness` shared by every
    // hand and a single probe timer, so the second hand always reused the first
    // hand's result: bring one hand forward and the other appeared to come
    // forward with it.
    let hand = this._nearnessState.get(key);
    if (!hand) {
      hand = { value: 1, probeAt: 0 };
      this._nearnessState.set(key, hand);
    }
    if (now < hand.probeAt) return hand.value;
    hand.probeAt = now + 60; // ~16 probes/second is plenty per hand

    const occluders = this._refreshOccluders(now);
    if (!occluders.length) return (hand.value = 1);

    // Probe the wrist and every fingertip: a hand half behind the model should
    // read as partly occluded, not all-or-nothing.
    const probes = [0, 4, 8, 12, 16, 20];
    let blocked = 0;
    this._castOrigin.copy(this._camPos);
    for (const index of probes) {
      const point = positions[index];
      if (!point) continue;
      this._castDir.subVectors(point, this._camPos);
      const distance = this._castDir.length();
      if (distance < 1e-4) continue;
      this._castDir.divideScalar(distance);
      this._cast.set(this._castOrigin, this._castDir);
      this._cast.far = distance - 0.02;
      this._cast.near = 0;
      if (this._cast.intersectObjects(occluders, false).length) blocked += 1;
    }
    const fraction = blocked / probes.length;
    return (hand.value = 1 - fraction * 0.65);
  }

  updateSettings({ mirror, smoothing, profile } = {}) {
    if (typeof mirror === "boolean") this.mirror = mirror;
    // `profile` is the real control; `smoothing` is accepted so a saved 0..1
    // slider value from an older version still works and is migrated.
    if (profile !== undefined || typeof smoothing === "number") {
      this.smoothers.updateSettings({ profile, smoothing });
    }
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.root.visible = this.visible;
  }

  _rigFor(key, side) {
    let rig = this.rigs.get(key);
    if (!rig) {
      rig = new HandRig(side);
      this.root.add(rig.group);
      this.rigs.set(key, rig);
    }
    return rig;
  }

  /**
   * @param {Array<Array<{x,y,z}>>} landmarks normalised, per hand
   * @param {Array<Array<{x,y,z}>>} worldLandmarks metres, per hand
   * @param {string[]} handedness
   * @param {object} options { pinched: boolean[], activity: number[] }
   */
  update(landmarks, worldLandmarks, handedness, {
    pinched = [], activity = [], fit = null, dt = 1 / 60, now = null
  } = {}) {
    if (!this.visible) {
      // Nothing to draw: drop filter history so a resumed stream does not ease
      // in from a stale pose.
      this.smoothers.resetAll();
      return;
    }
    const time = Number.isFinite(now) ? now : performance.now() / 1000;
    this.camera.getWorldPosition(this._camPos);
    this.camera.updateMatrixWorld();
    // Cached once per frame; every joint of every hand reuses it.
    this._cameraRotation.extractRotation(this.camera.matrixWorld);

    const seen = new Set();

    (landmarks || []).forEach((points, handIndex) => {
      if (!points || points.length < 21) return;
      const side = handedness?.[handIndex] || "Unknown";
      // MediaPipe's handedness is reported for the *un-mirrored* image, so when
      // the video is mirrored (the normal case) the labels swap.
      const effectiveSide = this.mirror
        ? (String(side).toLowerCase() === "left" ? "right" : String(side).toLowerCase() === "right" ? "left" : side)
        : side;
      const key = `${effectiveSide}-${handIndex}`;
      seen.add(key);

      const rig = this._rigFor(key, effectiveSide);
      rig.setVisible(true);
      rig._cameraRef = this.camera;

      const world = worldLandmarks?.[handIndex] || null;

      // Place every joint on the hand plane first. `planePositions[0]` is the
      // wrist anchor: the whole skeleton is positioned by it and shaped by the
      // rest. This is always correct, and
      // it is all we need when MediaPipe gives no metric landmarks.
      const planePositions = points.map(point =>
        landmarkToWorld(point, this.camera, { mirror: this.mirror, fit })
      );

      // Joint positions come from the shared coordinate module, which applies
      // the mirror to the metric offsets exactly once. Building them inline is
      // what produced an anatomically reflected skeleton in mirror mode, and it
      // also allocated a Matrix4 per joint per hand per frame.
      const positions = handJoints({
        planePositions,
        world,
        cameraRotation: this._cameraRotation,
        mirror: this.mirror,
        scratch: this._offsets,
        scratchVec: this._tmp,
        out: rig.scratchPositions
      });

      // Smooth each joint independently, filtered per hand. The raw solver
      // output is left untouched; the rig draws the smoothed copy.
      const smoother = this.smoothers.for(key);
      const smoothed = smoother.update(positions, rig.scratchSmoothed, time);

      rig.group.visible = true;
      // Depth is measured on the raw positions: the cue is about where the hand
      // really is relative to the model, not where its display copy is.
      rig.applyDepth(this._nearnessFor(positions, key));
      rig.update(smoothed, activity[handIndex] ?? 0,
        Boolean(pinched[handIndex]), dt);
    });

    // Hide rigs whose hand has left the frame rather than deleting them, so
    // reappearing hands do not pop.
    for (const [key, rig] of this.rigs) {
      if (!seen.has(key)) rig.setVisible(false);
    }
    // A hand that has gone must not keep smoothing toward its last pose: when
    // it comes back the skeleton should appear where the hand is, not glide
    // there from where it used to be.
    this.smoothers.retain(seen);
  }

  /** Screen-space anchor for a hand, for tether lines. */
  wristOf(handIndex = 0) {
    const rigs = [...this.rigs.values()].filter(r => r.visible);
    const rig = rigs[handIndex];
    if (!rig) return null;
    return rig.joints[0].position.clone();
  }

  dispose() {
    for (const rig of this.rigs.values()) rig.dispose();
    this.rigs.clear();
    this.root.removeFromParent();
  }
}
