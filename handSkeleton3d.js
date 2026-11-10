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

const TIP_INDICES = [4, 8, 12, 16, 20];

/** Distance from the camera to the hand plane, in world units. */
const HAND_DEPTH = 6.2;

const PALETTE = {
  left: {
    core: 0x9df3ff,
    ring: 0x4ad8ff,
    bone: 0x38c8ff,
    emissive: 0x14708f
  },
  right: {
    core: 0xd8fbff,
    ring: 0x62e0ff,
    bone: 0x48d0ff,
    emissive: 0x157a99
  }
};

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
  mirror = true, depth = HAND_DEPTH, offsetX = 0, offsetY = 0
} = {}) {
  // Mirroring has to happen exactly once, in normalised space, to match the
  // CSS-mirrored video the user is looking at.
  const nx = mirror ? 1 - point.x : point.x;
  // NDC: x right, y up. MediaPipe y runs downward.
  const ndcX = nx * 2 - 1;
  const ndcY = -(point.y * 2 - 1);

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
 * One hand's skeleton: 21 joint spheres, 21 bone tubes, and a palm plate.
 * Geometry is shared across hands; only materials differ, so this is cheap
 * enough to run at frame rate.
 */
class HandRig {
  constructor(side) {
    const colours = paletteFor(side);
    this.group = new THREE.Group();
    this.group.name = `hand-${side}`;

    this.jointGeometry = new THREE.SphereGeometry(1, 14, 12);
    this.tipGeometry = new THREE.SphereGeometry(1, 16, 14);

    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: colours.ring,
      emissive: colours.emissive,
      emissiveIntensity: 2.4,
      roughness: 0.25,
      metalness: 0,
      transparent: true,
      opacity: 0.96
    });
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: colours.core });
    this.boneMaterial = new THREE.MeshBasicMaterial({
      color: colours.bone,
      transparent: true,
      opacity: 0.62
    });
    this.palmMaterial = new THREE.MeshBasicMaterial({
      color: colours.bone,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.joints = [];
    for (let i = 0; i < 21; i++) {
      const isTip = TIP_INDICES.includes(i);
      const mesh = new THREE.Mesh(isTip ? this.tipGeometry : this.jointGeometry, this.jointMaterial);
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.joints.push(mesh);
    }

    // A small bright core inside each joint gives the glow a hot centre.
    this.cores = [];
    for (let i = 0; i < 21; i++) {
      const core = new THREE.Mesh(this.jointGeometry, this.coreMaterial);
      core.renderOrder = 11;
      this.group.add(core);
      this.cores.push(core);
    }

    // Bones are cylinders re-oriented each frame. Reusing them avoids
    // allocating 21 geometries per hand per frame.
    this.bones = [];
    const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const mesh = new THREE.Mesh(boneGeometry, this.boneMaterial);
      mesh.renderOrder = 9;
      this.group.add(mesh);
      this.bones.push(mesh);
    }

    this.palm = new THREE.Mesh(new THREE.BufferGeometry(), this.palmMaterial);
    this.palm.renderOrder = 8;
    this.group.add(this.palm);

    this.visible = true;
  }

  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.group.visible = visible;
  }

  /**
   * @param {THREE.Vector3[]} positions world positions, one per landmark
   * @param {number} heat 0..1 gesture activity
   * @param {boolean} pinched
   */
  update(positions, heat = 0, pinched = false) {
    const active = 1 + heat * 0.35 + (pinched ? 0.2 : 0);

    for (let i = 0; i < 21; i++) {
      const isTip = TIP_INDICES.includes(i);
      const isWrist = i === 0;
      const radius = (isWrist ? 0.052 : isTip ? 0.044 : 0.03) * active;
      const joint = this.joints[i];
      joint.position.copy(positions[i]);
      joint.scale.setScalar(radius);

      const core = this.cores[i];
      core.position.copy(positions[i]);
      core.scale.setScalar(radius * 0.5);
    }

    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const [a, b] = HAND_CONNECTIONS[i];
      const pa = positions[a];
      const pb = positions[b];
      const bone = this.bones[i];
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      const dir = pb.clone().sub(pa);
      const length = dir.length();
      if (length < 1e-5) { bone.visible = false; continue; }
      bone.visible = true;
      bone.position.copy(mid);
      bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      // Taper slightly toward fingertip bones.
      const tipBone = TIP_INDICES.includes(a) || TIP_INDICES.includes(b);
      const radius = (tipBone ? 0.011 : 0.017) * active;
      bone.scale.set(radius, length, radius);
    }

    // Palm plate: a quad fan through wrist + the five knuckles. Reads as the
    // back of the hand and anchors the fingers.
    const palmIndices = [0, 1, 5, 9, 13, 17];
    const verts = new Float32Array(palmIndices.length * 3);
    palmIndices.forEach((index, i) => {
      verts[i * 3] = positions[index].x;
      verts[i * 3 + 1] = positions[index].y;
      verts[i * 3 + 2] = positions[index].z;
    });
    const indices = [];
    for (let i = 1; i < palmIndices.length - 1; i++) indices.push(0, i, i + 1);
    this.palm.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.palm.geometry = geometry;
  }

  dispose() {
    this.group.removeFromParent();
    this.jointGeometry.dispose();
    this.tipGeometry.dispose();
    this.jointMaterial.dispose();
    this.coreMaterial.dispose();
    this.boneMaterial.dispose();
    this.palmMaterial.dispose();
    this.palm.geometry.dispose();
    this.bones[0]?.geometry.dispose();
  }
}

/**
 * Manages one rig per detected hand.
 */
export class HandSkeleton3D {
  constructor({ scene, camera, mirror = true }) {
    this.scene = scene;
    this.camera = camera;
    this.mirror = mirror;
    this.rigs = new Map();
    this.root = new THREE.Group();
    this.root.name = "hand-skeletons";
    scene.add(this.root);
    this.visible = true;
    this._tmp = new THREE.Vector3();
  }

  updateSettings({ mirror } = {}) {
    if (typeof mirror === "boolean") this.mirror = mirror;
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
  update(landmarks, worldLandmarks, handedness, { pinched = [], activity = [] } = {}) {
    if (!this.visible) return;
    this.camera.updateMatrixWorld();

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

      const world = worldLandmarks?.[handIndex] || null;

      // Anchor the hand at its wrist, so the whole skeleton is positioned by
      // the wrist landmark and shaped by the rest.
      const wristAnchor = landmarkToWorld(points[0], this.camera, { mirror: this.mirror });

      // Scale metric offsets from worldLandmarks into our world units. A hand
      // is roughly 0.19 m across; on the hand plane we want it to read at
      // about 1.6 world units wide.
      const METRIC_TO_WORLD = 8.6;

      const positions = points.map((point, i) => {
        if (!world || !world[i]) {
          // No metric data: fall back to the flat plane mapping, which is
          // still correctly positioned, just flat.
          return landmarkToWorld(point, this.camera, { mirror: this.mirror });
        }
        const w0 = world[0] || { x: 0, y: 0, z: 0 };
        const dx = (world[i].x - w0.x) * METRIC_TO_WORLD;
        const dy = -(world[i].y - w0.y) * METRIC_TO_WORLD;
        const dz = (world[i].z - w0.z) * METRIC_TO_WORLD;

        // Orient the metric offsets into camera space so the hand rotates with
        // the view rather than staying axis-aligned in world space.
        const offset = this._tmp.set(dx, dy, dz).applyMatrix4(
          new THREE.Matrix4().extractRotation(this.camera.matrixWorld)
        );
        return wristAnchor.clone().add(offset);
      });

      rig.group.visible = true;
      rig.update(positions, activity[handIndex] ?? 0, Boolean(pinched[handIndex]));
    });

    // Hide rigs whose hand has left the frame rather than deleting them, so
    // reappearing hands do not pop.
    for (const [key, rig] of this.rigs) {
      if (!seen.has(key)) rig.setVisible(false);
    }
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
