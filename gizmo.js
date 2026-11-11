/**
 * HOLOCORE — gizmo.js
 * -----------------------------------------------------------------------------
 * An XYZ translation gizmo: three axis handles and three plane handles, attached
 * to the current selection.
 *
 * WHY THIS EXISTS
 *
 * Pinch-dragging moves an object in the plane facing the camera, which is the
 * natural thing to do but can never express movement towards or away from you.
 * Without a second, explicit tool, depth has to come from hand-size heuristics,
 * and MediaPipe's landmark z is nowhere near accurate enough for that (see §6).
 * An axis handle is unambiguous: the object moves along that axis and nowhere
 * else, at any camera angle.
 *
 * ONE CODE PATH, TWO INPUT DEVICES
 *
 * Everything here is expressed in terms of a ray into the scene, not in terms of
 * DOM events. The mouse produces a ray from its pixel; the hand produces a ray
 * from the fingertip in the same normalised coordinates the reticle already
 * uses. The constraint maths is therefore identical for both, and neither path
 * can drift from the other.
 *
 * THE CONSTRAINT MATHS
 *
 * Axis drag: find the point on the axis line closest to the pointer ray. The
 * distance from the gizmo origin along the axis is the drag parameter. The delta
 * is the change in that parameter, so the object tracks the pointer exactly and
 * never picks up motion in the other two axes.
 *
 * Plane drag: intersect the pointer ray with the coordinate plane. The delta is
 * the movement of the hit point within that plane.
 *
 * Both are solved per frame against the CURRENT ray but against a FIXED
 * reference (parameter and hit point captured at drag start), so pushing the
 * handle ten pixels moves the object ten pixels' worth regardless of how far the
 * camera is or which way it faces.
 */

import * as THREE from "three";

/** Standard engineering axis colours. Red = X, green = Y, blue = Z. */
export const AXIS_COLORS = {
  x: 0xff4d4d,
  y: 0x4dff88,
  z: 0x4d9dff
};

export const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

/** Plane handles are named by the two axes they span. */
export const PLANE_AXES = {
  xy: ["x", "y"],
  xz: ["x", "z"],
  yz: ["y", "z"]
};

export const AXIS_HANDLES = ["x", "y", "z"];
export const PLANE_HANDLES = ["xy", "xz", "yz"];

/**
 * Closest point parameter along an axis, given a ray.
 *
 * Solves for the point on the line `origin + t * direction` that is closest to
 * the ray. This is the standard closest-approach of two skew lines, clamped to
 * avoid a divide-by-zero when the ray is parallel to the axis (which happens in
 * Front view for the Z axis, looking straight down it).
 *
 * @param {THREE.Vector3} origin gizmo origin
 * @param {THREE.Vector3} direction unit axis direction
 * @param {THREE.Ray} ray
 * @returns {number|null} parameter t, or null when the ray is degenerate
 */
export function axisParameter(origin, direction, ray) {
  const w0 = new THREE.Vector3().subVectors(origin, ray.origin);
  const a = direction.dot(direction);        // 1 for a unit axis
  const b = direction.dot(ray.direction);
  const c = ray.direction.dot(ray.direction); // 1 for a unit ray
  const d = direction.dot(w0);
  const e = ray.direction.dot(w0);
  const denominator = a * c - b * b;

  // Ray (anti)parallel to the axis: the closest point is undefined, so refuse
  // rather than produce an enormous bogus number.
  if (Math.abs(denominator) < 1e-6) return null;

  return (b * e - c * d) / denominator;
}

/**
 * Distance along a plane-handle's normal, i.e. the plane offset from origin.
 *
 * @param {THREE.Ray} ray
 * @param {THREE.Vector3} normal
 * @param {THREE.Vector3} origin
 * @returns {THREE.Vector3|null} intersection point, or null when parallel
 */
export function planeHit(ray, normal, origin) {
  const denominator = normal.dot(ray.direction);
  if (Math.abs(denominator) < 1e-6) return null;
  const t = new THREE.Vector3().subVectors(origin, ray.origin).dot(normal) / denominator;
  if (!Number.isFinite(t)) return null;
  return new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, t);
}

/**
 * Apply a handle constraint to a raw drag.
 *
 * Kept separate from the meshes so the rule can be asserted directly: an axis
 * handle must produce movement on one axis and exactly zero on the other two.
 *
 * @param {"x"|"y"|"z"|"xy"|"xz"|"yz"} handle
 * @param {{x:number,y:number,z:number}} delta
 * @returns {{x:number,y:number,z:number}}
 */
export function constrainDelta(handle, delta) {
  const out = { x: 0, y: 0, z: 0 };
  if (PLANE_AXES[handle]) {
    for (const axis of PLANE_AXES[handle]) out[axis] = delta[axis] || 0;
    return out;
  }
  if (AXIS_VECTORS[handle]) {
    out[handle] = delta[handle] || 0;
    return out;
  }
  return out;
}

/**
 * The three-handle translation gizmo.
 */
export class TranslationGizmo {
  constructor({ length = 1.05, thickness = 0.035 } = {}) {
    this.root = new THREE.Group();
    this.root.name = "translation-gizmo";
    // Drawn over the model so a handle inside a part is still grabbable.
    this.root.renderOrder = 10;

    this.length = length;
    this.thickness = thickness;

    this.target = null;
    this.hovered = null;
    this.dragging = null;

    // Reused per frame so hovering and dragging allocate nothing.
    this._ray = new THREE.Ray();
    this._hit = new THREE.Vector3();
    this._startValue = 0;
    this._startPoint = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._scale = 1;

    /** @type {Map<string, {mesh: THREE.Object3D, picker: THREE.Object3D}>} */
    this.handles = new Map();
    this._build();

    this.root.visible = false;
    this.setEnabled(false);
  }

  /* ---- construction ------------------------------------------------------ */

  _build() {
    const shaftRadius = this.thickness;
    const headLength = this.thickness * 6;
    const headRadius = this.thickness * 2.6;

    for (const axis of AXIS_HANDLES) {
      const colour = AXIS_COLORS[axis];
      const group = new THREE.Group();

      // Shaft: starts outside the origin marker so the three do not overlap.
      const shaftLength = this.length - headLength;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 8, 1, false),
        new THREE.MeshBasicMaterial({
          color: colour, transparent: true, opacity: 0.95,
          depthTest: false, toneMapped: false
        })
      );
      shaft.position.y = shaftLength / 2;
      group.add(shaft);

      const head = new THREE.Mesh(
        new THREE.ConeGeometry(headRadius, headLength, 10, 1),
        new THREE.MeshBasicMaterial({
          color: colour, transparent: true, opacity: 0.95,
          depthTest: false, toneMapped: false
        })
      );
      head.position.y = shaftLength + headLength / 2;
      group.add(head);

      // Invisible, fatter picker: a 3.5cm shaft is nearly impossible to hit with
      // a fingertip, and hover accuracy is what makes the gizmo feel responsive.
      const picker = new THREE.Mesh(
        new THREE.CylinderGeometry(this.thickness * 4.5, this.thickness * 4.5,
          this.length * 1.02, 6, 1, false),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      picker.position.y = (this.length * 1.02) / 2;
      group.add(picker);

      // Cylinders are built along +Y, so rotate each into its axis.
      if (axis === "x") group.rotation.z = -Math.PI / 2;
      if (axis === "z") group.rotation.x = Math.PI / 2;

      picker.userData.handle = axis;
      group.userData.handle = axis;
      this.root.add(group);
      this.handles.set(axis, { mesh: group, picker, material: [shaft.material, head.material] });
    }

    // Plane handles: small translucent squares in each coordinate quadrant.
    for (const plane of PLANE_HANDLES) {
      const [a, b] = PLANE_AXES[plane];
      const inset = this.length * 0.28;
      const size = this.length * 0.26;

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          color: 0xbfe8ff, transparent: true, opacity: 0.16,
          side: THREE.DoubleSide, depthTest: false, toneMapped: false
        })
      );
      // Sit the square in the corner spanned by the two axes it moves in.
      mesh.position.set(
        (a === "x" || b === "x") ? inset : 0,
        (a === "y" || b === "y") ? inset : 0,
        (a === "z" || b === "z") ? inset : 0
      );
      if (plane === "xy") mesh.rotation.set(0, 0, 0);
      if (plane === "xz") mesh.rotation.set(-Math.PI / 2, 0, 0);
      if (plane === "yz") mesh.rotation.set(0, Math.PI / 2, 0);

      const picker = mesh.clone();
      picker.material = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
      picker.scale.setScalar(1.15);
      picker.userData.handle = plane;

      mesh.userData.handle = plane;
      this.root.add(picker, mesh);
      this.handles.set(plane, { mesh, picker, material: [mesh.material] });
    }

    // Origin dot, so the gizmo has an anchor point at small sizes.
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(this.thickness * 2.2, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85,
        depthTest: false, toneMapped: false
      })
    );
    this.root.add(dot);
  }

  /* ---- attachment -------------------------------------------------------- */

  /**
   * Attach to an object, or detach with null.
   *
   * The gizmo never lives inside the object's own tree: it is positioned from
   * the object's world matrix each frame, so a scaled or rotated parent cannot
   * distort the handles and the handles cannot end up in a save/export as part
   * of the model.
   */
  setTarget(object3D) {
    this.target = object3D || null;
    this.setEnabled(Boolean(this.target));
    if (this.target) this.sync();
  }

  /** Attach by world position instead of a scene object. */
  setOrigin(position) {
    this._origin.copy(position);
    if (!this.target) this.root.position.copy(position);
  }

  setEnabled(enabled) {
    this.root.visible = Boolean(enabled && this.target);
    if (!this.root.visible) {
      this.hovered = null;
      this.dragging = null;
    }
  }

  /** Move the gizmo onto whatever it is attached to. */
  sync() {
    if (!this.target) return;
    this.target.updateWorldMatrix(true, false);
    this.root.position.setFromMatrixPosition(this.target.matrixWorld);
  }

  /**
   * Keep the gizmo a constant size on screen, and refuse to get absurd.
   *
   * A fixed world size is wrong: zoomed out, the handles disappear; zoomed in,
   * they swallow the model. Scaling with distance means the handles always
   * cover the same number of pixels.
   */
  update(camera) {
    if (!this.root.visible) return;
    this.sync();
    if (!camera) return;

    const distance = camera.position.distanceTo(this.root.position);
    // 0.075 * distance is roughly a seventh of the visible height at that depth,
    // which reads clearly without covering the object.
    const scale = Math.max(0.08, Math.min(distance * 0.075, 6));
    this._scale = scale;
    this.root.scale.setScalar(scale);
    // Keep the handles in front of the model but still depth-sorted among
    // themselves.
    this.root.quaternion.identity();
  }

  /* ---- interaction ------------------------------------------------------- */

  /**
   * Which handle, if any, a ray hits.
   *
   * @param {THREE.Raycaster} raycaster
   * @returns {string|null}
   */
  pick(raycaster) {
    if (!this.root.visible) return null;
    this.root.updateWorldMatrix(true, false);

    const pickers = [];
    for (const [, entry] of this.handles) pickers.push(entry.picker);

    const hits = raycaster.intersectObjects(pickers, false);
    if (!hits.length) return null;
    return hits[0].object.userData.handle || null;
  }

  /** Highlight a handle. Cheap: only touches materials when it changes. */
  setHovered(handle) {
    if (this.hovered === handle) return;
    this.hovered = handle;
    for (const [name, entry] of this.handles) {
      const isActive = name === handle || name === this.dragging;
      const highlight = isActive ? 1 : 0;
      for (const material of entry.material) {
        if (!material) continue;
        if (entry.material.length === 1) {
          // Plane handle: brightness only.
          material.opacity = highlight ? 0.34 : 0.16;
        } else {
          material.opacity = highlight ? 1 : 0.95;
        }
      }
    }
  }

  /**
   * Start a drag on a handle.
   *
   * @param {THREE.Ray} ray
   * @param {string} handle
   * @returns {boolean} whether the drag could be started
   */
  beginDrag(ray, handle) {
    if (!this.root.visible || !handle || !ray) return false;
    this.sync();
    this.dragging = handle;
    this.setHovered(handle);

    if (PLANE_AXES[handle]) {
      const normal = this._planeNormal(handle);
      const hit = planeHit(ray, normal, this.root.position);
      if (!hit) { this.dragging = null; return false; }
      this._startPoint.copy(hit);
    } else {
      const parameter = axisParameter(
        this.root.position, AXIS_VECTORS[handle], ray
      );
      if (parameter === null) { this.dragging = null; return false; }
      this._startValue = parameter;
    }
    return true;
  }

  /** Normal of a plane handle, in gizmo-local space (the gizmo is unrotated). */
  _planeNormal(handle) {
    const axes = PLANE_AXES[handle];
    const missing = ["x", "y", "z"].find(axis => !axes.includes(axis));
    return AXIS_VECTORS[missing];
  }

  /**
   * Continue a drag.
   *
   * @param {THREE.Ray} ray
   * @returns {{x:number,y:number,z:number}|null} world-space delta from drag start
   */
  drag(ray) {
    if (!this.dragging || !ray) return null;

    if (PLANE_AXES[this.dragging]) {
      const normal = this._planeNormal(this.dragging);
      const hit = planeHit(ray, normal, this.root.position);
      if (!hit) return null;
      this._delta.subVectors(hit, this._startPoint);
      return constrainDelta(this.dragging, {
        x: this._delta.x / this._scale,
        y: this._delta.y / this._scale,
        z: this._delta.z / this._scale
      });
    }

    const parameter = axisParameter(
      this.root.position, AXIS_VECTORS[this.dragging], ray
    );
    if (parameter === null) return null;
    // The parameter is in world units along the unit axis; divide by the gizmo
    // scale so the object moves with the handle as drawn.
    const moved = (parameter - this._startValue) / this._scale;
    return constrainDelta(this.dragging, {
      x: this.dragging === "x" ? moved : 0,
      y: this.dragging === "y" ? moved : 0,
      z: this.dragging === "z" ? moved : 0
    });
  }

  endDrag() {
    this.dragging = null;
    this.setHovered(this.hovered);
  }

  dispose() {
    this.root.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else if (child.material) child.material.dispose();
    });
    this.handles.clear();
    this.target = null;
  }
}
