/**
 * HOLOCORE — playground.js
 * -----------------------------------------------------------------------------
 * Multi-object scene support: spawning primitives, importing GLB/GLTF with
 * animation support, and selecting / duplicating / deleting individual objects.
 *
 * DESIGN
 *
 * `modelManager.js` owns exactly one `assembly` at a time (the engineering
 * models, with their parts, explode and isolation). Rather than rewrite that
 * proven code, the playground keeps a list of its own "props" beside it:
 *
 *   - a prop is a THREE.Group with its own transform, holding a geometry
 *     (primitive) or a loaded glTF scene (with an AnimationMixer if animated);
 *   - props live in their own group in the same scene, so they light, shadow
 *     and raycast exactly like the assemblies do;
 *   - exactly one thing is the *active target* of hand gestures at a time,
 *     which the workspace exposes as `setActiveObject`.
 *
 * That keeps one gesture → one object, which is the contract the solver and
 * the tests already enforce.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** The primitives offered in the "add object" menu. */
export const PRIMITIVES = [
  { id: "cube", label: "Cube", icon: "□" },
  { id: "sphere", label: "Sphere", icon: "○" },
  { id: "cylinder", label: "Cylinder", icon: "▯" },
  { id: "cone", label: "Cone", icon: "△" },
  { id: "torus", label: "Torus", icon: "◎" },
  { id: "torusKnot", label: "Knot", icon: "✳" },
  { id: "icosahedron", label: "Crystal", icon: "◈" }
];

/* A small palette so spawned objects look designed rather than default-white. */
const PALETTE = [
  { colour: 0x3fd0ff, emissive: 0x0a3550, metalness: 0.55, roughness: 0.28 },
  { colour: 0x7ef0c0, emissive: 0x0a3b30, metalness: 0.4, roughness: 0.3 },
  { colour: 0xc084fc, emissive: 0x241046, metalness: 0.5, roughness: 0.26 },
  { colour: 0xffb45c, emissive: 0x3a2108, metalness: 0.45, roughness: 0.32 },
  { colour: 0xff7f9e, emissive: 0x3a0f20, metalness: 0.4, roughness: 0.3 }
];

function geometryFor(id) {
  switch (id) {
    case "sphere": return new THREE.SphereGeometry(0.85, 40, 28);
    case "cylinder": return new THREE.CylinderGeometry(0.6, 0.6, 1.6, 40);
    case "cone": return new THREE.ConeGeometry(0.75, 1.6, 40);
    case "torus": return new THREE.TorusGeometry(0.72, 0.26, 24, 72);
    case "torusKnot": return new THREE.TorusKnotGeometry(0.62, 0.2, 120, 20);
    case "icosahedron": return new THREE.IcosahedronGeometry(0.95, 0);
    case "cube":
    default: return new THREE.BoxGeometry(1.3, 1.3, 1.3);
  }
}

export class Playground {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {THREE.Group}  [options.parent] container for props
   * @param {Function}     [options.onSelect]  (propId|null) => void
   * @param {Function}     [options.onChange]  () => void, after add/delete
   */
  constructor({ scene, parent, onSelect, onChange } = {}) {
    this.scene = scene;
    this.group = parent || new THREE.Group();
    this.group.name = "playground";
    if (!this.group.parent) scene.add(this.group);

    this.props = [];
    this.revision = 0;
    this.byId = new Map();
    this.selectedId = null;
    this.onSelect = onSelect || (() => {});
    this.onChange = onChange || (() => {});

    this._loader = new GLTFLoader();
    this._raycaster = new THREE.Raycaster();
    this._counter = 0;
    this._clock = 0;
    /** Props whose material should be highlighted as the gesture target. */
    this._highlighted = null;
  }

  /* --------------------------------------------------------------------- */
  /* CREATION                                                              */
  /* --------------------------------------------------------------------- */

  /** Spawn a primitive. Returns the prop. */
  /**
   * Increments whenever the set of props changes identity (add, remove, clear).
   *
   * Cheap consumers -- hover picking, for one -- use it to know that a cached hit
   * from a previous frame may refer to an object that no longer exists or has
   * moved, without having to compare the whole prop list.
   */
  _bumpRevision() {
    this.revision = (this.revision || 0) + 1;
  }

  addPrimitive(kind = "cube", { position = null } = {}) {
    const definition = PRIMITIVES.find(p => p.id === kind) || PRIMITIVES[0];
    const style = PALETTE[this._counter % PALETTE.length];

    const geometry = geometryFor(definition.id);
    const material = new THREE.MeshStandardMaterial({
      color: style.colour,
      emissive: style.emissive,
      emissiveIntensity: 0.55,
      metalness: style.metalness,
      roughness: style.roughness,
      flatShading: definition.id === "icosahedron"
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const prop = this._wrap(mesh, {
      name: definition.label,
      kind: "primitive",
      primitive: definition.id
    });

    // Fan new objects around the stage so they do not stack on each other.
    const angle = (this._counter * 2.39996) % (Math.PI * 2);
    const radius = 1.7 + (this._counter % 3) * 0.55;
    prop.group.position.set(
      position?.x ?? Math.cos(angle) * radius,
      position?.y ?? 0.15,
      position?.z ?? Math.sin(angle) * radius
    );

    this._counter++;
    this._register(prop);
    this._bumpRevision();
    return prop;
  }

  /**
   * Import a GLB/GLTF. Every animation clip becomes playable, and the first
   * clip autoplays so an animated model is obviously animated on arrival.
   */
  async importFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const gltf = await this._loader.loadAsync(url);
      const root = gltf.scene;

      // Normalise into the working envelope so imports are never microscopic
      // or larger than the stage.
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const centre = bounds.getCenter(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z) || 1;
      const scale = 3.2 / largest;

      root.position.copy(centre).multiplyScalar(-1);
      const holder = new THREE.Group();
      holder.add(root);
      holder.scale.setScalar(scale);

      const prop = this._wrap(holder, {
        name: file.name.replace(/\.(glb|gltf)$/i, ""),
        kind: "import",
        imported: true
      });

      prop.group.position.set(0, 0.2, 0);

      if (gltf.animations?.length) {
        prop.mixer = new THREE.AnimationMixer(root);
        prop.clips = gltf.animations;
        prop.actions = gltf.animations.map(clip => {
          const action = prop.mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          return action;
        });
        prop.clipNames = gltf.animations.map((clip, i) => clip.name || `Clip ${i + 1}`);
        prop.activeClip = 0;
        prop.actions[0].play();
      }

      this._register(prop);
      return prop;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Wrap a display object in a selectable prop with a stable id. */
  _wrap(object, meta) {
    this._idSeed = (this._idSeed || 0) + 1;
    const id = `prop-${this._idSeed}`;
    const group = new THREE.Group();
    group.name = meta.name || "Object";
    group.userData.propId = id;
    group.userData.isPlaygroundProp = true;
    group.add(object);

    object.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.propId = id;
      }
    });

    return {
      id,
      name: meta.name || "Object",
      kind: meta.kind || "primitive",
      primitive: meta.primitive || null,
      imported: Boolean(meta.imported),
      group,
      object,
      mixer: null,
      clips: [],
      actions: [],
      clipNames: [],
      activeClip: -1
    };
  }

  _register(prop) {
    this.props.push(prop);
    this.byId.set(prop.id, prop);
    this.group.add(prop.group);
    this.select(prop.id);
    this.onChange();
  }

  /* --------------------------------------------------------------------- */
  /* SELECTION                                                             */
  /* --------------------------------------------------------------------- */

  select(id) {
    this.selectedId = id || null;
    this.onSelect(this.selectedId);
    return this.get();
  }

  get() {
    return this.selectedId ? this.byId.get(this.selectedId) || null : null;
  }

  /** Raycast against props only. Returns a prop id or null. */
  pick(ndc, camera) {
    if (!this.props.length) return null;
    this._raycaster.setFromCamera(ndc, camera);
    const roots = this.props.map(p => p.group);
    const hits = this._raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.propId) node = node.parent;
      if (node?.userData.propId) return node.userData.propId;
    }
    return null;
  }

  /* --------------------------------------------------------------------- */
  /* EDITING                                                               */
  /* --------------------------------------------------------------------- */

  duplicate() {
    const prop = this.get();
    if (!prop) return null;
    const clone = prop.object.clone(true);
    const copy = this._wrap(clone, {
      name: `${prop.name} copy`,
      kind: prop.kind,
      primitive: prop.primitive,
      imported: prop.imported
    });
    copy.group.position.copy(prop.group.position).add(new THREE.Vector3(0.9, 0.25, 0.7));
    copy.group.rotation.copy(prop.group.rotation);
    copy.group.scale.copy(prop.group.scale);

    // Clone materials so recolouring one copy cannot affect the other.
    clone.traverse(child => {
      if (child.isMesh && child.material) {
        child.material = Array.isArray(child.material)
          ? child.material.map(m => m.clone())
          : child.material.clone();
      }
    });

    this._register(copy);
    return copy;
  }

  remove(id = null) {
    const target = id || this.selectedId;
    const prop = target ? this.byId.get(target) : null;
    if (!prop) return false;

    prop.mixer?.stopAllAction();
    this.group.remove(prop.group);
    prop.group.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material?.dispose?.();
      }
    });

    this.props = this.props.filter(p => p.id !== prop.id);
    this.byId.delete(prop.id);
    this._bumpRevision();
    if (this.selectedId === prop.id) {
      const next = this.props[this.props.length - 1] || null;
      this.selectedId = next?.id || null;
      this.onSelect(this.selectedId);
    }
    this.onChange();
    return true;
  }

  clear() {
    for (const prop of [...this.props]) this.remove(prop.id);
    this.selectedId = null;
    this.onSelect(null);
    this.onChange();
  }

  /* --------------------------------------------------------------------- */
  /* MATERIALS (voice colour commands, inspector controls)                 */
  /* --------------------------------------------------------------------- */

  /**
   * Apply material options to one object.
   *
   * Ported from the main branch's workspace `setPartMaterial`, retargeted at
   * playground props. Kept here rather than in the renderer because the props
   * belong to this module and it owns their materials.
   */
  setMaterial(id, { color, roughness, metalness, wireframe, opacity } = {}) {
    const prop = this.byId.get(id);
    if (!prop) return false;
    prop.group.traverse(child => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (color !== undefined && material.color) material.color.set(color);
        if (roughness !== undefined && "roughness" in material) {
          material.roughness = Math.max(0, Math.min(1, roughness));
        }
        if (metalness !== undefined && "metalness" in material) {
          material.metalness = Math.max(0, Math.min(1, metalness));
        }
        if (wireframe !== undefined && "wireframe" in material) {
          material.wireframe = Boolean(wireframe);
        }
        if (opacity !== undefined) {
          material.opacity = Math.max(0.1, Math.min(1, opacity));
          material.transparent = material.opacity < 1;
        }
        material.needsUpdate = true;
      }
    });
    return true;
  }

  /** Convenience wrapper used by the "color …" voice command. */
  setColor(id, color) {
    return this.setMaterial(id, { color });
  }

  setWireframe(id, wireframe) {
    return this.setMaterial(id, { wireframe });
  }

  /** Read back the first material, so the inspector can show live values. */
  getMaterial(id) {
    const prop = this.byId.get(id);
    if (!prop) return null;
    let found = null;
    prop.group.traverse(child => {
      if (found || !child.isMesh || !child.material) return;
      found = Array.isArray(child.material) ? child.material[0] : child.material;
    });
    if (!found) return null;
    return {
      color: `#${found.color?.getHexString?.() ?? "ffffff"}`,
      roughness: found.roughness ?? 0.5,
      metalness: found.metalness ?? 0.5,
      wireframe: Boolean(found.wireframe),
      opacity: found.opacity ?? 1
    };
  }

  /* --------------------------------------------------------------------- */
  /* TRANSFORMS (driven by hand gestures and keyboard)                     */
  /* --------------------------------------------------------------------- */

  setTransform(id, { position, rotationX, rotationY, rotationZ, scale } = {}) {
    const prop = this.byId.get(id);
    if (!prop) return false;
    const g = prop.group;
    if (position) {
      if (typeof position.x === "number") g.position.x = position.x;
      if (typeof position.y === "number") g.position.y = position.y;
      if (typeof position.z === "number") g.position.z = position.z;
    }
    if (typeof rotationX === "number") g.rotation.x = rotationX;
    if (typeof rotationY === "number") g.rotation.y = rotationY;
    if (typeof rotationZ === "number") g.rotation.z = rotationZ;
    if (typeof scale === "number") g.scale.setScalar(scale);
    return true;
  }

  getTransform(id) {
    const prop = this.byId.get(id);
    if (!prop) return null;
    const g = prop.group;
    return {
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
      rotationX: g.rotation.x,
      rotationY: g.rotation.y,
      rotationZ: g.rotation.z,
      scale: g.scale.x
    };
  }

  /** World-space centre of a prop, for tethering the pointer to it. */
  centreOf(id) {
    const prop = this.byId.get(id);
    if (!prop) return null;
    return new THREE.Box3().setFromObject(prop.group).getCenter(new THREE.Vector3());
  }

  /* --------------------------------------------------------------------- */
  /* ANIMATION                                                             */
  /* --------------------------------------------------------------------- */

  setClip(id, index) {
    const prop = this.byId.get(id);
    if (!prop?.mixer || !prop.actions.length) return false;
    const next = Math.max(0, Math.min(prop.actions.length - 1, index | 0));
    if (next === prop.activeClip) return true;
    prop.actions[prop.activeClip]?.fadeOut?.(0.2);
    prop.actions[next].reset().fadeIn(0.2).play();
    prop.activeClip = next;
    this.onChange();
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* HIGHLIGHT                                                             */
  /* --------------------------------------------------------------------- */

  /** Emissive pulse on the prop a gesture is currently acting on. */
  highlight(id) {
    if (this._highlighted === id) return;
    const previous = this._highlighted ? this.byId.get(this._highlighted) : null;
    if (previous) previous.group.traverse(c => {
      if (c.isMesh && c.material?.emissiveIntensity !== undefined) {
        c.material.emissiveIntensity = previous._restoreEmissive ?? 0.55;
      }
    });

    const prop = id ? this.byId.get(id) : null;
    if (prop) {
      prop._restoreEmissive = null;
      prop.group.traverse(c => {
        if (c.isMesh && c.material?.emissiveIntensity !== undefined) {
          if (prop._restoreEmissive == null) prop._restoreEmissive = c.material.emissiveIntensity;
          c.material.emissiveIntensity = 1.6;
        }
      });
    }
    this._highlighted = prop ? id : null;
  }

  /* --------------------------------------------------------------------- */
  /* LOOP                                                                  */
  /* --------------------------------------------------------------------- */

  update(dt) {
    this._clock += dt;
    for (const prop of this.props) {
      prop.mixer?.update(dt);

      // A gentle idle spin so the stage never looks static — but only for
      // objects nobody is working on. A selected primitive was still being
      // spun by 0.22 rad/s underneath the user's own rotation, so letting go
      // after turning it left the object drifting, and every frame the hand
      // set a rotation the update immediately added to it.
      if (prop.mixer || prop.kind !== "primitive") continue;

      // A drag anywhere holds every primitive still: a hand is transforming
      // the scene, and objects drifting past under it is just confusing.
      const held = this._isManipulating();
      const selected = prop.id === this.selectedId;
      if (held) {
        // Remember where the user left it, so the idle spin resumes from there
        // instead of jumping back to the angle it would otherwise have reached.
        prop._idleAngle = prop.group.rotation.y;
        prop._idlePaused = true;
        continue;
      }

      if (selected) {
        // Selected but not being dragged: still no drift. The user is looking
        // at this object and needs its orientation to hold still.
        prop._idleAngle = prop.group.rotation.y;
        continue;
      }

      // Resuming: continue from wherever the object was left, so the spin
      // never snaps. `_idleAngle` is carried forward by the rotation itself.
      prop._idleAngle = (prop._idleAngle ?? prop.group.rotation.y) + dt * 0.22;
      prop.group.rotation.y = prop._idleAngle;
      prop._idlePaused = false;
    }
  }

  /**
   * True while a hand (or the pointer) is actively transforming an object.
   *
   * Set by the caller around a gesture frame. Kept as a flag rather than
   * derived from the solver so the playground does not depend on gestures.js.
   */
  _isManipulating() {
    return Boolean(this.manipulating);
  }

  /** Called by the gesture pipeline when a grab starts and ends. */
  setManipulating(active) {
    this.manipulating = Boolean(active);
  }

  /** Why the idle spin is or is not running, for diagnostics and tests. */
  idleState() {
    return {
      manipulating: Boolean(this.manipulating),
      selectedId: this.selectedId,
      props: this.props.map(p => ({
        id: p.id,
        kind: p.kind,
        mixer: Boolean(p.mixer),
        rotationY: p.group.rotation.y
      }))
    };
  }

  /** Serializable description, used by the HUD and the voice layer. */
  describe() {
    return this.props.map(p => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      clips: p.clipNames,
      activeClip: p.activeClip,
      selected: p.id === this.selectedId
    }));
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}
