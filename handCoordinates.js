/**
 * HOLOCORE — handCoordinates.js
 * -----------------------------------------------------------------------------
 * One place that converts MediaPipe's two landmark sets into Three.js offsets.
 *
 * WHY THIS EXISTS
 *
 * MediaPipe reports a hand twice:
 *
 *   landmarks       normalised image space, x/y in 0..1 of the *source* frame,
 *                   origin top-left, y DOWN. z is roughly wrist-relative and
 *                   not a reliable absolute distance.
 *
 *   worldLandmarks  metres, origin at the hand's geometric centre, x right,
 *                   y DOWN, z toward the camera negative. This is the only
 *                   source with correct anatomy, but its axes are the raw
 *                   camera's, NOT the mirrored video the user looks at.
 *
 * The old code mirrored the *wrist anchor* from `landmarks` but then took the
 * finger offsets straight from `worldLandmarks`. In mirror mode that put the
 * hand at the mirrored position while reflecting its anatomy — a right hand
 * appeared on screen as a left hand, with the thumb on the wrong side. The
 * error is invisible on a flat open hand and obvious the moment a finger bends,
 * which is exactly how it survived this long.
 *
 * THE CONTRACT
 *
 * Mirroring is a reflection of the camera image about its vertical axis, which
 * in camera-local space is exactly `x -> -x`. It is applied ONCE, to the metric
 * offsets, and never to the wrist anchor's own axes: the anchor's screen
 * position comes from the normalised landmarks, which are mapped to world
 * space through the camera basis and therefore already carry the mirror.
 *
 * So:
 *
 *   anchor  = landmarkToWorld(landmarks[0], camera, { mirror })   (already mirrored)
 *   offset  = mirror ? x -> -x of the metric offset                (mirrored here)
 *   joint   = anchor + camera-relative offset
 *
 * Because both hands come from the same camera image, the same reflection is
 * correct for both. The handedness *label* flips separately, in the skeleton
 * manager, because MediaPipe names hands for the un-mirrored frame.
 *
 * Everything here is pure and allocation-free on the hot path, so it can be
 * tested numerically without a renderer.
 */

import * as THREE from "three";

/**
 * Scale for converting metres into scene units when the caller has no better
 * estimate. Only used when the normalised and metric spreads are degenerate.
 */
export const FALLBACK_METRIC_SCALE = 8.6;

/**
 * MediaPipe worldLandmarks are metres with **y running downward** and **z
 * negative toward the camera**. Three.js world space has y up, and the hand
 * plane sits in front of the camera at negative local z.
 *
 * So the metric -> camera-local conversion is:
 *   local.x =   wx      (right stays right, until mirroring)
 *   local.y =  -wy      (image y down -> world y up)
 *   local.z =   wz      (both measure toward-camera as negative)
 *
 * The `-wy` term was already present in the original code and is correct; it is
 * stated explicitly here so the sign is not re-derived (and broken) later.
 */
export function metricOffsetInto(out, point, origin, scale) {
  out.set(
    (point.x - origin.x) * scale,
    -(point.y - origin.y) * scale,
    (point.z - origin.z) * scale
  );
  return out;
}

/**
 * Reflect a camera-local offset into the mirrored-video frame.
 *
 * Mirroring the image about its vertical axis maps camera-local +x to -x and
 * leaves y and z untouched. This is the whole of the anatomical correction.
 */
export function mirrorOffset(out, mirror) {
  if (mirror) out.x = -out.x;
  return out;
}

/**
 * The largest distance from the wrist to any other landmark, in either space.
 *
 * The ratio of the two is what converts metres into scene units, so the 3D rig
 * is the size the video shows rather than a fixed guess. Both must be usable:
 * identical landmarks give zero spread and would collapse every joint onto one
 * point (and hide every bone), so the caller falls back when this is not.
 */
export function spreadFromWrist(points, origin = points?.[0]) {
  if (!points?.length || !origin) return 0;
  let spread = 0;
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const dz = point.z - origin.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > spread) spread = d;
  }
  return spread;
}

/**
 * Convert a whole frame of metric landmarks into camera-local offsets for one
 * hand, using reused vectors.
 *
 * @param {Array<{x,y,z}>} world    worldLandmarks for this hand
 * @param {Array<THREE.Vector3>} out one vector per landmark, mutated in place
 * @param {object} options
 * @param {number}  options.scale   metres -> scene units
 * @param {boolean} options.mirror  reflect into the mirrored-video frame
 * @returns {Array<THREE.Vector3>|null} `out`, or null when the data is unusable
 */
export function worldLandmarksToOffsets(world, out, { scale, mirror }) {
  if (!world || world.length < 21 || !out) return null;
  const origin = world[0];
  if (!origin) return null;
  for (let i = 0; i < 21; i++) {
    const point = world[i];
    if (!point) {
      out[i]?.set(0, 0, 0);
      continue;
    }
    const target = out[i] || (out[i] = new THREE.Vector3());
    metricOffsetInto(target, point, origin, scale);
    mirrorOffset(target, mirror);
  }
  return out;
}

/**
 * Landmarks that make up the rigid part of the hand.
 *
 * The wrist (0) and the four knuckles (5, 9, 13, 17) form a plate that barely
 * deforms when fingers bend. Measuring scale from these instead of from the
 * whole landmark cloud is what stops a curled pinky from rescaling the entire
 * skeleton — with a max-spread ratio, curling one finger changed the length of
 * the thumb, which is exactly the "bending my pinky moved my thumb" symptom.
 */
export const PALM_LANDMARKS = [5, 9, 13, 17];

/**
 * Apparent palm size in the IMAGE plane, using x and y only.
 *
 * This is the correct input for a depth proxy. `palmSpan` includes z, which is
 * right for measuring the hand's 3D geometry but wrong for judging how large it
 * appears: MediaPipe's z is relative and changes as much when the palm rotates
 * as when it moves closer. Dropping z means turning the palm no longer changes
 * the depth estimate.
 *
 * @param {Array<{x:number,y:number}>} points 21 normalised landmarks
 * @returns {number} mean wrist-to-knuckle distance in normalised image units
 */
export function palmSpan2D(points) {
  if (!points || points.length < 21) return 0;
  const wrist = points[0];
  if (!wrist) return 0;
  let total = 0;
  let count = 0;
  for (const index of PALM_LANDMARKS) {
    const point = points[index];
    if (!point) continue;
    total += Math.hypot(point.x - wrist.x, point.y - wrist.y);
    count += 1;
  }
  return count ? total / count : 0;
}

/**
 * Mean wrist-to-knuckle distance in 3D, over whichever knuckles are present.
 *
 * Used for geometry scaling and for the skeleton's anatomy. Deliberately still
 * includes z -- see `palmSpan2D` for why depth must not use this.
 * Returns 0 when the data is unusable.
 */
export function palmSpan(points) {
  if (!points || points.length < 21) return 0;
  const wrist = points[0];
  if (!wrist) return 0;
  let total = 0;
  let count = 0;
  for (const index of PALM_LANDMARKS) {
    const point = points[index];
    if (!point) continue;
    total += Math.hypot(
      point.x - wrist.x, point.y - wrist.y, point.z - wrist.z
    );
    count += 1;
  }
  return count ? total / count : 0;
}

/**
 * The scale that turns the metric landmarks into the same scene units the
 * normalised landmarks were mapped into.
 *
 * Prefers the rigid palm span; falls back to the overall spread, then to a
 * constant, so a degenerate frame still produces a sane skeleton.
 *
 * @param {Array<{x,y,z}>} normalised plane-projected landmarks
 * @param {Array<{x,y,z}>} metric     worldLandmarks, metres
 * @returns {number} metres -> scene units
 */
export function metricScale(normalised, metric) {
  const normalisedPalm = palmSpan(normalised);
  const metricPalm = palmSpan(metric);
  if (metricPalm > 1e-4 && normalisedPalm > 1e-4) {
    return normalisedPalm / metricPalm;
  }

  // Degenerate or partial data: fall back to the widest extent.
  const normalisedSpread = spreadFromWrist(normalised);
  const metricSpread = spreadFromWrist(metric);
  if (metricSpread > 1e-4 && normalisedSpread > 1e-4) {
    return normalisedSpread / metricSpread;
  }
  return FALLBACK_METRIC_SCALE;
}

/**
 * Produce the 21 joint positions for one hand in world space.
 *
 * The anchor is mirrored by the caller's `landmarkToWorld` (it maps through the
 * camera basis); the offsets are mirrored here. Applying the mirror in exactly
 * these two places — never both on the same quantity — is what stops the classic
 * double-flip.
 *
 * @param {object} args
 * @param {Array<{x,y,z}>} args.planePositions world positions of each landmark
 *        on the hand plane (already mirrored)
 * @param {Array<{x,y,z}>} args.world          worldLandmarks, metres
 * @param {THREE.Matrix4} args.cameraRotation  rotation half of camera.matrixWorld
 * @param {boolean} args.mirror
 * @param {Array<THREE.Vector3>} args.scratch  21 reusable offsets
 * @param {THREE.Vector3} args.scratchVec      reusable temp for rotation
 * @param {Array<THREE.Vector3>} args.out      21 reusable outputs
 * @returns {Array<THREE.Vector3>} `out`
 */
export function handJoints({
  planePositions, world, cameraRotation, mirror, scratch, scratchVec, out
}) {
  // No metric landmarks: the plane projection is still correct and is all we
  // have. It loses only the true 3D shape of the fingers.
  if (!world || world.length < 21) {
    for (let i = 0; i < planePositions.length; i++) {
      (out[i] || (out[i] = new THREE.Vector3())).copy(planePositions[i]);
    }
    return out;
  }

  // Scale from the rigid palm plate, not from the widest finger: a curled
  // finger must not resize the rest of the hand.
  const scale = metricScale(planePositions, world);

  worldLandmarksToOffsets(world, scratch, { scale, mirror });

  const anchor = planePositions[0];
  for (let i = 0; i < 21; i++) {
    const offset = scratchVec.copy(scratch[i] || ZERO).applyMatrix4(cameraRotation);
    (out[i] || (out[i] = new THREE.Vector3())).copy(anchor).add(offset);
  }
  return out;
}

const ZERO = new THREE.Vector3();

export { ZERO as ZERO_OFFSET };
