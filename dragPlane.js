/**
 * HOLOCORE — dragPlane.js
 * -----------------------------------------------------------------------------
 * Camera-relative translation: the maths that makes a pinch feel like you are
 * holding the object rather than nudging it along world axes.
 *
 * THE PROBLEM
 *
 * The solver mapped hand movement onto world X and Y with a fixed multiplier:
 *
 *     dx = (hand.x - start.x) * sensitivity
 *     dy = -(hand.y - start.y) * sensitivity
 *
 * In the default three-quarter view that is roughly right by accident. Switch
 * to Top and dragging up moves the object along world Y — towards the camera —
 * where it appears to do nothing. Switch to Left and horizontal dragging still
 * moves along world X, which is now depth. The object and your hand disagree
 * about which way is "across".
 *
 * THE FIX
 *
 * Work in the plane the user is looking at. At pinch time, capture:
 *   - a plane through the grab point whose normal is the camera's view
 *     direction, and
 *   - the ray from the camera through the pointer at that moment.
 *
 * Every later frame, project the new pointer ray onto the same plane and take
 * the difference from where it started. That difference is a world-space vector
 * in the plane, so dragging right moves the object right *on screen* — in Front
 * that is +X, in Top it is +X, in Left it is -Z, and it is correct for any angle
 * in between, including views the user orbits to by hand.
 *
 * The plane is captured once and never recomputed. If the camera moves during a
 * drag the object stays put: the alternative is an object that slides whenever
 * the user adjusts the view, which is far worse than a drag that ignores a
 * camera change until the next pinch.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Depth. A drag plane is by definition perpendicular to the view, so it cannot
 * express movement towards the viewer. Depth is a separate, explicit action:
 * the Z handle on the gizmo, or the calibrated palm-size gesture. Treating
 * MediaPipe's landmark z as absolute camera distance is what made the old code
 * push objects forward and back at random.
 */

import * as THREE from "three";

/**
 * A stable drag plane for one grab.
 *
 * Construct once when the pinch starts, then call `delta()` each frame.
 */
export class DragPlane {
  constructor() {
    // Reused every frame; a drag allocates nothing after construction.
    this._hitStart = new THREE.Vector3();
    // The camera basis, frozen at grab time.
    this._right = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._forward = new THREE.Vector3(0, 0, -1);
    this._startNdc = new THREE.Vector2();
    this._tmpVec = new THREE.Vector3();
    this._depth = 1;
    this._worldPerNdcX = 1;
    this._worldPerNdcY = 1;
    this.active = false;
  }

  /**
   * Capture the plane and the grab point.
   *
   * @param {object} options
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {{x:number,y:number}} options.ndc pointer in normalised device
   *        coordinates (-1..1, y up), which is what the reticle already uses
   * @param {THREE.Vector3} options.grabPoint world position of the object
   * @returns {boolean} whether a usable plane was found
   */
  begin({ camera, ndc, grabPoint }) {
    if (!camera || !ndc || !grabPoint) return false;

    camera.updateMatrixWorld();

    // Freeze the camera basis NOW. Everything afterwards is computed from these
    // captured vectors, not from the live camera, which is what makes the drag
    // survive a camera nudge: with a live raycast, orbiting mid-drag re-points
    // the ray and the object slides even though the hand did not move.
    this._right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this._up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    this._forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();

    // The grab point's distance along the view axis, not the straight-line
    // distance: the world-per-NDC scale depends on depth along the camera's
    // forward vector.
    this._depth = Math.max(
      0.01,
      this._tmpVec.subVectors(grabPoint, camera.position).dot(this._forward)
    );

    // Half-extents of the visible frustum at that depth. A movement of one
    // NDC unit (half the screen) covers this many world units.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * this._depth;
    this._worldPerNdcY = halfHeight;
    this._worldPerNdcX = halfHeight * camera.aspect;

    this._startNdc.set(ndc.x, ndc.y);
    this.active = true;
    this._hitStart.copy(grabPoint);
    return true;
  }

  /**
   * World-space movement since the grab started.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {{x:number,y:number}} ndc current pointer
   * @param {THREE.Vector3} out reusable output vector
   * @returns {THREE.Vector3|null} the delta, or null if it could not be found
   */
  delta(camera, ndc, out = new THREE.Vector3()) {
    if (!this.active || !ndc) return null;
    // Deliberately ignores the live camera: the captured basis defines the
    // plane for the whole grab.
    void camera;
    const dx = (ndc.x - this._startNdc.x) * this._worldPerNdcX;
    const dy = (ndc.y - this._startNdc.y) * this._worldPerNdcY;
    return out
      .set(0, 0, 0)
      .addScaledVector(this._right, dx)
      .addScaledVector(this._up, dy);
  }

  /**
   * The point on the plane under the pointer right now.
   *
   * Used to place the object under the fingertip precisely, rather than merely
   * offsetting it by the same amount the finger moved.
   */
  pointUnder(camera, ndc, out = new THREE.Vector3()) {
    if (!this.active || !ndc) return null;
    const delta = this.delta(camera, ndc, this._tmpVec);
    return out.copy(this._hitStart).add(delta);
  }

  release() {
    this.active = false;
    this._hitStart.set(0, 0, 0);
  }
}

/**
 * The world-axis each screen direction maps to, for a given camera.
 *
 * Used by the tests and by the HUD, which tells the user which way "up" will
 * move the object. It is derived from the camera rather than hardcoded per
 * view, so an orbited camera reports honestly too.
 *
 * @returns {{right: THREE.Vector3, up: THREE.Vector3, forward: THREE.Vector3}}
 */
export function screenAxes(camera) {
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();

  camera.updateMatrixWorld();
  // Camera basis: +X right, +Y up, -Z forward.
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();

  return { right, up, forward };
}

/**
 * Which world axis a screen direction is most aligned with.
 *
 * @param {THREE.Vector3} direction
 * @returns {"x"|"y"|"z"} the dominant axis
 */
export function dominantAxis(direction) {
  const abs = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
  const largest = Math.max(...abs);
  if (largest === abs[0]) return "x";
  if (largest === abs[1]) return "y";
  return "z";
}

/**
 * Signed world-axis movement for a screen-space drag.
 *
 * This is the pure core of camera-relative translation, expressed without a
 * scene so it can be tested against the exact expectations in the brief:
 *
 *   Front: drag right -> +X, drag up -> +Y
 *   Top:   drag right -> +X, drag up -> -Z
 *   Left:  drag right -> -Z (the direction that reads as "across"), up -> +Y
 *
 * @param {THREE.Camera} camera
 * @param {{x:number,y:number}} drag  screen-space drag, +x right, +y up
 * @returns {{x:number,y:number,z:number}} world-space offset
 */
export function screenDragToWorld(camera, drag) {
  const { right, up } = screenAxes(camera);
  return new THREE.Vector3()
    .addScaledVector(right, drag.x)
    .addScaledVector(up, drag.y);
}
