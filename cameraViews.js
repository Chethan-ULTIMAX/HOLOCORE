/**
 * HOLOCORE — cameraViews.js
 * -----------------------------------------------------------------------------
 * The seven standard engineering views, as pure camera maths.
 *
 * WHY A MODULE AND NOT A SWITCH IN main.js
 *
 * Top and Bottom are the views that break naive implementations. Point a camera
 * straight down with the default up vector of (0,1,0) and the view direction is
 * parallel to `up`, so the camera's basis is degenerate and OrbitControls
 * produces an arbitrary roll — the model appears rotated by an angle nobody
 * asked for, and often flips between frames.
 *
 * Getting that right is a few lines of trig, but it is the kind of few lines
 * that is impossible to eyeball. Keeping it pure means the whole thing can be
 * asserted numerically, including "does this preset actually look along the
 * axis its name claims".
 *
 * `up` for each view is chosen so that:
 *   - Front/Back/Left/Right look horizontally with world +Y up, so the horizon
 *     is level and the model stands upright;
 *   - Top looks down with world -Z up, so the model's front faces the bottom of
 *     the screen — the convention every CAD viewer uses, and the one that makes
 *     Top feel like a plan drawing;
 *   - Bottom looks up with world +Z up, its mirror image;
 *   - Isometric looks down the (1,1,1) diagonal.
 */

import * as THREE from "three";

/**
 * Unit direction FROM the target TOWARDS the camera, for each view.
 *
 * These are deliberately named "towards the camera": a Front view means the
 * camera is in front of the model looking back at it, not the model's forward
 * vector.
 */
export const VIEW_DIRECTIONS = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
  iso: new THREE.Vector3(1, 0.8, 1).normalize()
};

/**
 * The up vector to hand OrbitControls for each view.
 *
 * Only the views that look along an axis need care. For the others, (0,1,0) is
 * both correct and conventional.
 */
export const VIEW_UPS = {
  front: new THREE.Vector3(0, 1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(0, 1, 0),
  // Looking straight down: "up" on screen must be a world horizontal axis, or
  // the camera basis is degenerate. -Z puts the model's front at the bottom of
  // the screen, which is the standard plan view.
  top: new THREE.Vector3(0, 0, -1),
  // Looking straight up: +Z, the mirror of Top.
  bottom: new THREE.Vector3(0, 0, 1),
  iso: new THREE.Vector3(0, 1, 0)
};

/** Human labels, used by the view controller and its tooltips. */
export const VIEW_LABELS = {
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  top: "Top",
  bottom: "Bottom",
  iso: "Isometric"
};

/** The order the controller lays its buttons out in. */
export const VIEW_ORDER = ["front", "back", "left", "right", "top", "bottom", "iso"];

/**
 * Keyboard shortcut per standard view.
 *
 * Digits 1–5 are taken by the interaction modes, so views live on Shift+digit
 * through the shifted characters those keys produce. Before this map existed the
 * handler hard-coded only Shift+1/2/3, which left back, left, right and bottom
 * reachable by mouse only -- a keyboard user simply could not get to them.
 *
 * The digit is stored explicitly rather than derived from the character's code:
 * `$` is ASCII 36, not "Shift+4", and deriving it that way produced tooltips
 * reading "Shift+32" and "Shift+62".
 */
export const VIEW_SHORTCUTS = Object.freeze({
  "!": { view: "front", digit: 1 },
  "@": { view: "top", digit: 2 },
  "#": { view: "iso", digit: 3 },
  "$": { view: "right", digit: 4 },
  "%": { view: "left", digit: 5 },
  "^": { view: "back", digit: 6 },
  "&": { view: "bottom", digit: 7 }
});

/** Every shortcut as `{ key, view, digit }`, in digit order. */
export const SHORTCUT_LIST = Object.freeze(
  Object.entries(VIEW_SHORTCUTS)
    .map(([key, entry]) => ({ key, view: entry.view, digit: entry.digit }))
    .sort((a, b) => a.digit - b.digit)
);

/** @returns {string|null} the view id a keyboard event's key maps to. */
export function viewForShortcut(key) {
  if (typeof key !== "string") return null;
  const entry = VIEW_SHORTCUTS[key];
  return entry ? entry.view : null;
}

/**
 * Resolve a keyboard event to a view.
 *
 * Accepts both the shifted character (`$`) and a reported digit with shiftKey
 * set (`4`), because layouts and key remappers differ in which they send.
 */
export function viewForEvent(key, shiftKey = false) {
  const direct = viewForShortcut(key);
  if (direct) return direct;
  if (!shiftKey) return null;
  const digit = Number(key);
  if (!Number.isInteger(digit)) return null;
  const entry = SHORTCUT_LIST.find(item => item.digit === digit);
  return entry ? entry.view : null;
}

/** Human-readable shortcut hint, for tooltips and the settings panel. */
export function shortcutHint(id) {
  const entry = SHORTCUT_LIST.find(item => item.view === id);
  return entry ? `Shift+${entry.digit}` : "";
}


export function isViewId(id) {
  return Object.prototype.hasOwnProperty.call(VIEW_DIRECTIONS, id);
}

/**
 * The distance the camera needs to see a sphere of `radius` comfortably.
 *
 * A sphere of radius r subtends 2*asin(r/d) at distance d, so filling the
 * vertical field of view needs d = r / sin(fov/2). The margin leaves the model
 * clear of the viewport edges, and a floor keeps a tiny object from putting the
 * camera inside it (and inside OrbitControls' minDistance).
 */
export function fitDistance(radius, fovDegrees, { margin = 1.45, min = 3.2 } = {}) {
  const safeRadius = Math.max(0.2, radius > 0 ? radius : 1);
  const fov = THREE.MathUtils.degToRad(Math.max(5, Math.min(160, fovDegrees)));
  return Math.max(min, (safeRadius / Math.sin(fov / 2)) * margin);
}

/**
 * Compute a camera placement for a standard view.
 *
 * @param {string} id one of VIEW_ORDER
 * @param {object} options
 * @param {THREE.Vector3} options.target  what to look at (never assumed to be
 *        the origin: an off-centre selection must be framed correctly)
 * @param {number} options.radius         bounding radius of the framed object
 * @param {number} options.fov            camera vertical field of view, degrees
 * @param {number} [options.margin]
 * @returns {{position: THREE.Vector3, target: THREE.Vector3,
 *            up: THREE.Vector3, id: string} | null}
 */
export function viewPlacement(id, { target, radius, fov, margin = 1.45 } = {}) {
  const direction = VIEW_DIRECTIONS[id];
  const up = VIEW_UPS[id];
  if (!direction || !up) return null;

  const centre = target ? target.clone() : new THREE.Vector3();
  const distance = fitDistance(radius, fov, { margin });

  return {
    id,
    // Offset along the view direction, NOT from the origin: an object parked at
    // x=4 must still be centred when you switch to Left.
    position: centre.clone().addScaledVector(direction, distance),
    target: centre,
    up: up.clone()
  };
}

/**
 * Guarantee an up vector that is not parallel to the view direction.
 *
 * OrbitControls derives its basis from `camera.up` and the look direction. When
 * the two are parallel the basis collapses and the camera spins unpredictably.
 * Rather than trusting every caller, this nudges `up` onto an axis that works.
 *
 * @param {THREE.Vector3} direction normalised direction from target to camera
 * @param {THREE.Vector3} up        desired up
 * @returns {THREE.Vector3} a safe up vector
 */
export function safeUp(direction, up) {
  const dir = direction.clone().normalize();
  const candidate = up.clone().normalize();

  // 0.999 rather than 1: a nearly-parallel up is as bad as a parallel one,
  // because the basis becomes ill-conditioned well before it is degenerate.
  if (Math.abs(dir.dot(candidate)) < 0.999) return candidate;

  // Pick the world axis least aligned with the view direction, then project the
  // desired up onto the plane perpendicular to it.
  const axes = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0)
  ];
  axes.sort((a, b) => Math.abs(dir.dot(a)) - Math.abs(dir.dot(b)));
  const fallback = axes[0];
  // Project out the component along the view direction.
  const projected = fallback.clone().addScaledVector(dir, -fallback.dot(dir));
  if (projected.lengthSq() < 1e-8) return new THREE.Vector3(0, 1, 0);
  return projected.normalize();
}

/**
 * Which standard view, if any, the camera is currently closest to.
 *
 * Used to light up the view controller. A generous threshold means "Front"
 * only lights up when the camera really is near a front view, not merely in
 * that hemisphere — an orbiting camera should show no active preset.
 *
 * @returns {string|null}
 */
/**
 * Which standard view the camera is near, or null.
 *
 * `tolerance` is in RADIANS of angular error from the axis. The default is
 * seven degrees: tight enough that an orbit reads as free, loose enough that the
 * small settling wobble after an animated view change does not flicker the
 * indicator to FREE and back.
 */
export function matchingView(position, target, { tolerance = 0.12 } = {}) {
  if (!position || !target) return null;
  const direction = position.clone().sub(target);
  const length = direction.length();
  if (length < 1e-6) return null;
  direction.divideScalar(length);

  let best = null;
  let bestDot = -Infinity;
  for (const id of VIEW_ORDER) {
    const dot = direction.dot(VIEW_DIRECTIONS[id]);
    if (dot > bestDot) {
      bestDot = dot;
      best = id;
    }
  }
  // cos of a small angle: near the axis only.
  return bestDot >= Math.cos(tolerance) ? best : null;
}

/**
 * Assert-friendly description of a placement, for tests and diagnostics.
 */
export function describePlacement(placement) {
  if (!placement) return null;
  const direction = placement.position.clone().sub(placement.target);
  const distance = direction.length();
  return {
    id: placement.id,
    target: placement.target.toArray(),
    position: placement.position.toArray(),
    up: placement.up.toArray(),
    distance,
    // The unit direction from the target to the camera: this is what "which
    // view is this" actually means.
    direction: distance > 1e-9 ? direction.divideScalar(distance).toArray() : [0, 0, 0]
  };
}
