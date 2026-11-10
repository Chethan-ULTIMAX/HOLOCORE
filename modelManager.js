/**
 * HOLOCORE — modelManager.js
 * -----------------------------------------------------------------------------
 * The 3D workspace: renderer, lighting, environment, grid, procedural model
 * library, selection, highlighting, exploded / isolated views, camera moves,
 * and the object transform that hand gestures drive.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildAssembly, disposeAssembly } from "./modelFactory.js";
import { MODEL_LIBRARY, getComponentData } from "./engineeringData.js";

const ACCENT = 0x3fd0ff;
const HOVER = 0x8fa9c4;

export class Workspace {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container
   * @param {Function} [options.rendererFactory] swap the renderer (tests/WebGPU)
   * @param {Function} [options.controlsFactory] swap the orbit controls
   * @param {boolean} [options.environment] build the PBR environment
   */
  constructor({
    container, onSelect, onHover, onStatus, settings,
    rendererFactory, controlsFactory, environment = true
  }) {
    this.container = container;
    this.rendererFactory = rendererFactory || null;
    this.controlsFactory = controlsFactory || null;
    this.useEnvironment = environment;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.onStatus = onStatus || (() => {});
    this.settings = {
      shadows: true,
      quality: "balanced",
      autoRotate: false,
      grid: true,
      ...(settings || {})
    };

    this.assembly = null;
    this.modelId = null;
    this.selected = null;
    this.hovered = null;
    this.exploded = false;          // kept for compatibility (true when amount > 0)
    this.explodeAmount = 0;         // continuous 0..1
    this.isolated = false;
    this.partTransforms = new Map(); // part -> {offset, rotationX, rotationZ, scale}
    this._previousVisibility = null;
    this._selectedOrigEmissive = null;

    this._partTargets = new Map();
    this._cameraGoal = null;
    this._targetGoal = null;
    this._clock = new THREE.Clock();
    this._hoverPending = null;
    /** Group composited after the main pass (the hand skeletons). */
    this.lateLayer = null;

    this._initRenderer();
    this._initScene();
    this._initControls();
    this._initLights();
    this._initGrid();
    this._initPost();
    this._events();

    this._frame = this._tick.bind(this);
    this._rafId = requestAnimationFrame(this._frame);
  }

  /* ===================================================================== */
  /* SETUP                                                                 */
  /* ===================================================================== */

  _initRenderer() {
    // `alpha: true` is what lets the live camera feed sit *behind* the canvas.
    // With an opaque drawing buffer the renderer paints over the video and the
    // user only ever sees the scene background, no matter how the layers stack.
    const options = {
      antialias: this.settings.quality !== "performance",
      powerPreference: "high-performance",
      alpha: true,
      premultipliedAlpha: true,
      stencil: false
    };
    this.renderer = this.rendererFactory
      ? this.rendererFactory(options)
      : new THREE.WebGLRenderer({
      antialias: this.settings.quality !== "performance",
      powerPreference: "high-performance",
      alpha: true,
      premultipliedAlpha: true,
      stencil: false
    });
    // Clear to fully transparent, then paint a subtle scrim in the scene itself
    // (see _initScene) so the model stays legible over a bright camera image.
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.settings.quality === "performance" ? 1 : 1.75)
    );
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "HOLOCORE 3D workspace");
    // Explicit class rather than relying on a "#viewport > canvas" descendant
    // selector: the landmark overlay is *also* a <canvas> in this container and
    // must keep its own absolute/z-index:3 rules.
    this.renderer.domElement.classList.add("workspace-canvas");
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    // No scene.background: the drawing buffer stays transparent so the camera
    // video behind the canvas remains visible. Legibility over bright footage is
    // handled by a CSS scrim layered between the video and the canvas, which is
    // cheaper than compositing a quad and can be faded independently.
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(0x05070c, 0.018);

    this.camera = new THREE.PerspectiveCamera(
      42,
      this.container.clientWidth / Math.max(1, this.container.clientHeight),
      0.1,
      200
    );
    this.camera.position.set(7.5, 5.2, 9.5);

    // PBR environment for believable metal without an HDRI download. This is a
    // nicety: if the GPU cannot build the prefiltered map (old drivers, software
    // rasterisers) the lights alone still render the scene correctly.
    if (this.useEnvironment) {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.scene.environmentIntensity = 0.55;
        pmrem.dispose();
      } catch (error) {
        console.warn("[HOLOCORE] Environment map unavailable, using direct lighting only:", error?.message);
      }
    }

    // Root that hand gestures transform; the model lives inside it.
    this.manipulator = new THREE.Group();
    this.manipulator.name = "manipulator";
    this.scene.add(this.manipulator);
  }

  _initControls() {
    const controls = this.controlsFactory
      ? this.controlsFactory(this.camera, this.renderer.domElement)
      : new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 3.2;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.target.set(0, 0.1, 0);
    controls.autoRotateSpeed = 0.8;
    controls.autoRotate = this.settings.autoRotate;
    this.controls = controls;
  }

  _initLights() {
    const hemi = new THREE.HemisphereLight(0xa8d4ff, 0x0a1018, 1.1);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(6, 10, 7);
    key.castShadow = this.settings.shadows;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x59b7ff, 1.5);
    rim.position.set(-7, 4, -6);
    this.scene.add(rim);

    const fill = new THREE.PointLight(0x7d5cff, 22, 26, 2);
    fill.position.set(-4, -2, 5);
    this.scene.add(fill);

    const under = new THREE.PointLight(0x1d7fb8, 14, 20, 2);
    under.position.set(2, -4.5, -2);
    this.scene.add(under);

    // Soft contact shadow catcher under the object.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 64),
      new THREE.ShadowMaterial({ opacity: 0.34 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3.6;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _initGrid() {
    const grid = new THREE.GridHelper(40, 40, 0x1b3b52, 0x10222f);
    grid.position.y = -3.6;
    grid.material.transparent = true;
    grid.material.opacity = 0.75;
    grid.material.depthWrite = false;
    this.scene.add(grid);
    this.grid = grid;

    // Concentric rings add spatial reference without visual noise.
    const rings = new THREE.Group();
    for (const radius of [2.2, 4.4, 6.6]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.012, 128),
        new THREE.MeshBasicMaterial({
          color: 0x1d5b7d,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.userData.baseOpacity = 0.5;
      rings.add(ring);
    }
    rings.position.y = -3.595;
    this.scene.add(rings);
    this.rings = rings;
    // Remember the authored strength so setGridEmphasis can fade and restore.
    if (grid.material) grid.userData.baseOpacity = 0.75;
  }

  _initPost() {
    // Bloom is added lazily by main.js when quality allows (dynamic import
    // keeps the base load light and avoids failing hard without WebGL2).
    this.composer = null;
    this.bloomPass = null;
  }

  async enableBloom({ strength = 0.32, radius = 0.6, threshold = 0.85 } = {}) {
    if (this.composer) return true;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] =
        await Promise.all([
          import("three/addons/postprocessing/EffectComposer.js"),
          import("three/addons/postprocessing/RenderPass.js"),
          import("three/addons/postprocessing/UnrealBloomPass.js"),
          import("three/addons/postprocessing/OutputPass.js")
        ]);

      const size = new THREE.Vector2(
        this.container.clientWidth,
        this.container.clientHeight
      );
      const composer = new EffectComposer(this.renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      composer.setSize(size.x, size.y);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(size, strength, radius, threshold);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.bloomPass = bloom;
      return true;
    } catch (error) {
      console.warn("[HOLOCORE] Bloom unavailable:", error?.message || error);
      return false;
    }
  }

  disableBloom() {
    this.composer = null;
    this.bloomPass = null;
  }

  _events() {
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.container);

    const dom = this.renderer.domElement;

    this._pointerStart = null;
    dom.addEventListener("pointerdown", event => {
      this._pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    });

    dom.addEventListener("pointerup", event => {
      if (!this._pointerStart) return;
      const dx = event.clientX - this._pointerStart.x;
      const dy = event.clientY - this._pointerStart.y;
      const moved = Math.hypot(dx, dy);
      this._pointerStart = null;
      if (moved > 6) return;
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const hit = this.raycast(ndc);
      this.select(hit);
    });

    dom.addEventListener("pointermove", event => {
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      this._hoverPending = ndc;
    });

    dom.addEventListener("pointerleave", () => {
      this._hoverPending = null;
      this.setHover(null);
    });
  }

  resize() {
    const width = this.container.clientWidth;
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
  }

  /* ===================================================================== */
  /* MODEL LOADING                                                         */
  /* ===================================================================== */

  async setModel(modelId) {
    const definition = MODEL_LIBRARY.find(model => model.id === modelId);
    if (!definition) throw new Error(`Unknown model "${modelId}"`);

    this.clearSelection({ silent: true });
    this.exploded = false;          // kept for compatibility (true when amount > 0)
    this.explodeAmount = 0;         // continuous 0..1
    this.isolated = false;
    this.partTransforms = new Map(); // part -> {offset, rotationX, rotationZ, scale}
    this._previousVisibility = null;

    if (this.assembly) {
      this.manipulator.remove(this.assembly.group);
      disposeAssembly(this.assembly);
      this.assembly = null;
    }

    const assembly = buildAssembly(modelId);
    this.assembly = assembly;
    this.modelId = modelId;
    this._partTargets.clear();
    for (const part of assembly.parts) {
      this._partTargets.set(part, {
        position: part.position.clone(),
        scale: new THREE.Vector3(1, 1, 1)
      });
    }

    this.manipulator.add(assembly.group);
    this.resetTransform({ animated: false });
    this.frameModel();
    this.onStatus({ model: definition, parts: assembly.parts.length });
    return assembly;
  }

  frameModel({ instant = false } = {}) {
    if (!this.assembly) return;
    const bounds = new THREE.Box3().setFromObject(this.assembly.group);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 2);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius / Math.sin(fov / 2)) * 1.15;

    const direction = new THREE.Vector3(0.62, 0.42, 1).normalize();
    const goal = centre.clone().addScaledVector(direction, distance);
    this._moveCamera(goal, centre, instant ? 0 : 0.9);
  }

  /* ===================================================================== */
  /* SELECTION                                                             */
  /* ===================================================================== */

  get parts() {
    return this.assembly?.parts || [];
  }

  /** True when the current assembly was imported from a file. */
  get imported() {
    return Boolean(this.assembly?.imported);
  }

  getPart(partId) {
    return this.assembly?.byId.get(partId) || null;
  }

  /** Raycast a screen NDC point. Returns the part id or null. */
  raycast(ndc) {
    if (!this.assembly) return null;
    this._raycaster = this._raycaster || new THREE.Raycaster();
    this._raycaster.setFromCamera(ndc, this.camera);
    const candidates = this.parts.filter(part => part.visible);
    const hits = this._raycaster.intersectObjects(candidates, true);
    for (const hit of hits) {
      const root = hit.object.userData.partRoot;
      if (root) return root.userData.partId;
      if (hit.object.userData.partId) return hit.object.userData.partId;
    }
    return null;
  }

  /** Project a part's world position to viewport pixels (for 3D labels). */
  projectPart(partId) {
    const part = this.getPart(partId);
    if (!part) return null;
    const box = new THREE.Box3().setFromObject(part);
    const centre = box.getCenter(new THREE.Vector3());
    const projected = centre.clone().project(this.camera);
    return {
      x: (projected.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * this.container.clientHeight,
      visible: projected.z < 1
    };
  }

  select(partId, { focus = false } = {}) {
    this._clearOutline(this.selected);
    this.selected = partId ? this.getPart(partId) : null;

    if (this.selected) {
      this._applyOutline(this.selected, ACCENT, 1.045);
      if (this.isolated) this._applyIsolation(this.selected);
    } else if (this.isolated) {
      this._restoreVisibility();
    }

    if (focus && this.selected) this.focusSelected();
    this.onSelect(partId || null);
  }

  clearSelection(options) {
    this.select(null, options);
  }

  setHover(partId) {
    if (this.hovered === partId) return;
    this._clearOutline(this.hovered);
    this.hovered = partId ? this.getPart(partId) : null;
    if (this.hovered && this.hovered !== this.selected) {
      this._applyOutline(this.hovered, HOVER, 1.025, 0.45);
    }
    this.onHover(partId || null);
  }

  _applyOutline(object, color, scale, opacity = 0.85) {
    if (!object || object.userData.outline) return;
    const group = new THREE.Group();
    group.name = "__outline";
    object.traverse(child => {
      if (!child.isMesh) return;
      const ghost = new THREE.Mesh(
        child.geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.BackSide,
          depthWrite: false
        })
      );
      ghost.renderOrder = 2;
      ghost.raycast = () => {};
      // Outline sits in the same local space as the source mesh.
      ghost.matrixAutoUpdate = false;
      ghost.matrix.copy(child.matrix);
      ghost.material.userData.shared = false;
      group.add(ghost);
    });
    // Match the outline to the object's own transform.
    group.position.copy(object.position);
    group.quaternion.copy(object.quaternion);
    group.scale.copy(object.scale);
    group.scale.multiplyScalar(scale);

    object.userData.outline = group;
    object.parent?.add(group);
  }

  _clearOutline(object) {
    if (!object?.userData?.outline) return;
    const group = object.userData.outline;
    group.parent?.remove(group);
    group.traverse(child => {
      if (child.isMesh) child.material?.dispose?.();
    });
    delete object.userData.outline;
  }

  /* ===================================================================== */
  /* VIEW CONTROLS                                                         */
  /* ===================================================================== */

  /**
   * Set the explosion amount continuously, 0 (assembled) .. 1 (fully exploded).
   *
   * Parts move along their own `explodeDirection`, scaled by the amount, so the
   * same geometry produces every intermediate state. The motion itself is eased
   * in update(dt), which is why dragging the slider looks like an assembly coming
   * apart rather than a series of jumps.
   */
  setExplodeAmount(amount) {
    const next = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
    this.explodeAmount = next;
    this.exploded = next > 0.001;
    this._applyExplodeTargets();
    return this.explodeAmount;
  }

  /** Add to the explosion amount (used by the two-hand explode gesture). */
  nudgeExplode(delta) {
    return this.setExplodeAmount(this.explodeAmount + delta);
  }

  /** Legacy boolean API, expressed in terms of the continuous amount. */
  toggleExplode(force) {
    const wanted = typeof force === "boolean" ? force : !this.exploded;
    return this.setExplodeAmount(wanted ? 1 : 0) > 0.001;
  }

  _applyExplodeTargets() {
    const amount = this.explodeAmount;
    for (const part of this.parts) {
      const target = this._partTargets.get(part);
      if (!target) continue;
      const home = part.userData.home;
      const dir = part.userData.explodeDirection;
      const distance = part.userData.explodeDistance ?? 1;
      // A per-part offset (from MOVE on a single component) is preserved so
      // exploding does not throw away a component the user has placed.
      const offset = this.partTransforms.get(part)?.offset;
      target.position.copy(home);
      if (offset) target.position.add(offset);
      if (dir) target.position.addScaledVector(dir, 1.9 * distance * amount);
    }
  }

  /* ---- per-part transforms --------------------------------------------- */

  /** The transform record for a part, created on demand. */
  _partTransform(part) {
    if (!part) return null;
    let record = this.partTransforms.get(part);
    if (!record) {
      record = {
        offset: new THREE.Vector3(),
        rotationX: 0,
        rotationZ: 0,
        scale: 1
      };
      this.partTransforms.set(part, record);
    }
    return record;
  }

  /** Read a part's current local transform (offset from its home position). */
  getPartTransform(partId) {
    const part = this.getPart(partId);
    if (!part) return null;
    const record = this.partTransforms.get(part);
    const home = part.userData.home;
    return {
      offset: {
        x: part.position.x - home.x,
        y: part.position.y - home.y,
        z: part.position.z - home.z
      },
      rotationX: record?.rotationX ?? 0,
      rotationZ: record?.rotationZ ?? 0,
      scale: record?.scale ?? 1
    };
  }

  /**
   * Move / rotate / scale a single component.
   *
   * The offset is stored relative to the part's home position, then folded into
   * the explode target, so a part can be dragged *and* the assembly exploded
   * without the two fighting over `part.position`.
   */
  setPartTransform(partId, { offset, rotationX, rotationZ, scale } = {}) {
    const part = this.getPart(partId);
    if (!part) return false;
    const record = this._partTransform(part);

    if (offset) {
      if (typeof offset.x === "number") record.offset.x = offset.x;
      if (typeof offset.y === "number") record.offset.y = offset.y;
      if (typeof offset.z === "number") record.offset.z = offset.z;
    }
    if (typeof rotationX === "number") record.rotationX = rotationX;
    if (typeof rotationZ === "number") record.rotationZ = rotationZ;
    if (typeof scale === "number") record.scale = THREE.MathUtils.clamp(scale, 0.15, 4);

    this._applyExplodeTargets();
    this._applyPartTransform(part);
    return true;
  }

  /** Add a delta to a part's stored offset (used by the MOVE gesture). */
  applyPartDelta(partId, { x = 0, y = 0, z = 0, roll = 0, pitch = 0, scale = 0 } = {}) {
    const part = this.getPart(partId);
    if (!part) return false;
    const record = this._partTransform(part);
    record.offset.x = THREE.MathUtils.clamp(record.offset.x + x, -6, 6);
    record.offset.y = THREE.MathUtils.clamp(record.offset.y + y, -5, 5);
    record.offset.z = THREE.MathUtils.clamp(record.offset.z + z, -5, 5);
    record.rotationZ += roll;
    record.rotationX = THREE.MathUtils.clamp(record.rotationX + pitch, -Math.PI, Math.PI);
    record.scale = THREE.MathUtils.clamp(record.scale + scale, 0.15, 4);
    this._applyExplodeTargets();
    this._applyPartTransform(part);
    return true;
  }

  /** Clear every per-part transform, returning components to their homes. */
  resetPartTransforms() {
    for (const part of this.partTransforms.keys()) {
      part.rotation.set(0, 0, 0);
      part.scale.setScalar(1);
      if (part.userData.outline) {
        part.userData.outline.rotation.set(0, 0, 0);
        part.userData.outline.scale.setScalar(1);
      }
    }
    this.partTransforms.clear();
    this._applyExplodeTargets();
    for (const part of this.parts) part.rotation.set(0, 0, 0), part.scale.setScalar(1);
  }

  _applyPartTransform(part) {
    const record = this.partTransforms.get(part);
    if (!record) return;
    part.rotation.set(record.rotationX, 0, record.rotationZ);
    part.scale.setScalar(record.scale);
    if (part.userData.outline) {
      part.userData.outline.rotation.copy(part.rotation);
      part.userData.outline.scale.copy(part.scale);
    }
  }

  toggleIsolate(force) {
    const next = typeof force === "boolean" ? force : !this.isolated;
    if (next && !this.selected) return false;
    this.isolated = next;
    if (this.isolated) this._applyIsolation(this.selected);
    else this._restoreVisibility();
    return this.isolated;
  }

  _applyIsolation(selected) {
    if (!this._previousVisibility) {
      this._previousVisibility = new Map(this.parts.map(part => [part, part.visible]));
    }
    for (const part of this.parts) part.visible = part === selected;
  }

  _restoreVisibility() {
    if (this._previousVisibility) {
      for (const part of this.parts) {
        part.visible = this._previousVisibility.get(part) ?? true;
      }
    }
    this._previousVisibility = null;
    this.isolated = false;
  }

  focusSelected() {
    if (!this.selected) return;
    const box = new THREE.Box3().setFromObject(this.selected);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.35);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = Math.max((radius / Math.sin(fov / 2)) * 1.6, 2.4);

    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this._moveCamera(centre.clone().addScaledVector(direction, distance), centre, 0.75);
  }

  resetView() {
    this._restoreVisibility();
    this.isolated = false;
    this.explodeAmount = 0;
    this.exploded = false;
    this.resetPartTransforms();
    for (const part of this.parts) {
      this._partTargets.get(part)?.position.copy(part.userData.home);
    }
    this.resetTransform({ animated: true });
    this.frameModel();
  }

  _moveCamera(position, target, duration = 0.8) {
    this._cameraGoal = {
      position: position.clone(),
      target: target.clone(),
      t: 0,
      duration: Math.max(0.001, duration)
    };
  }

  /* ===================================================================== */
  /* OBJECT TRANSFORM (hand + mouse driven)                                */
  /* ===================================================================== */

  resetTransform({ animated = true } = {}) {
    this.transform = this.transform || {
      position: new THREE.Vector3(),
      rotationZ: 0,
      rotationX: 0,
      scale: 1
    };
    if (animated) {
      this._transformGoal = { position: new THREE.Vector3(), rotationZ: 0, rotationX: 0, scale: 1 };
    } else {
      this.transform.position.set(0, 0, 0);
      this.transform.rotationZ = 0;
      this.transform.rotationX = 0;
      this.transform.scale = 1;
      this._transformGoal = null;
      this._applyTransform();
    }
  }

  /** Directly set the object transform (used by the gesture solver). */
  setTransform({ position, rotationZ, scale, rotationX }) {
    this._transformGoal = null;
    const t = this.transform;
    if (position) {
      if (typeof position.x === "number") t.position.x = position.x;
      if (typeof position.y === "number") t.position.y = position.y;
      if (typeof position.z === "number") t.position.z = position.z;
    }
    if (typeof rotationZ === "number") t.rotationZ = rotationZ;
    if (typeof rotationX === "number") t.rotationX = rotationX;
    if (typeof scale === "number") t.scale = scale;
    this._applyTransform();
  }

  applyDelta({ x = 0, y = 0, roll = 0, scale = 0 }) {
    const t = this.transform;
    t.position.x = THREE.MathUtils.clamp(t.position.x + x, -4.5, 4.5);
    t.position.y = THREE.MathUtils.clamp(t.position.y + y, -3.5, 3.5);
    t.rotationZ += roll;
    t.scale = THREE.MathUtils.clamp(t.scale + scale, 0.3, 3.2);
    this._applyTransform();
  }

  nudge(direction, amount = 0.2) {
    const t = this._transformGoal || this.transform;
    if (direction === "left") t.position.x -= amount;
    if (direction === "right") t.position.x += amount;
    if (direction === "up") t.position.y += amount;
    if (direction === "down") t.position.y -= amount;
    if (direction === "forward") t.position.z -= amount;
    if (direction === "back") t.position.z += amount;
    if (direction === "rollLeft") t.rotationZ += amount * 0.8;
    if (direction === "rollRight") t.rotationZ -= amount * 0.8;
    if (direction === "scaleUp") t.scale = Math.min(3.2, t.scale + amount * 0.5);
    if (direction === "scaleDown") t.scale = Math.max(0.3, t.scale - amount * 0.5);
    this._transformGoal = t;
  }

  _applyTransform() {
    const t = this.transform;
    this.manipulator.position.copy(t.position);
    this.manipulator.rotation.z = t.rotationZ;
    this.manipulator.rotation.x = t.rotationX;
    this.manipulator.scale.setScalar(t.scale);
  }

  /* ===================================================================== */
  /* SETTINGS                                                              */
  /* ===================================================================== */

  updateSettings(settings = {}) {
    Object.assign(this.settings, settings);

    if (settings.shadows !== undefined) {
      this.renderer.shadowMap.enabled = settings.shadows;
      this.keyLight.castShadow = settings.shadows;
      this.scene.traverse(object => {
        if (object.isMesh && object.material) object.material.needsUpdate = true;
      });
    }
    if (settings.autoRotate !== undefined) {
      this.controls.autoRotate = settings.autoRotate;
    }
    if (settings.grid !== undefined) {
      this.grid.visible = settings.grid;
      this.rings.visible = settings.grid;
    }
  }

  /**
   * How strongly the ground grid draws.
   *
   * With the camera filling the stage, a 40-unit wireframe laid over the live
   * feed reads as clutter and muddies the person on camera. The grid is kept
   * for spatial reference but faded well back so the model and the hands stay
   * the subject; over a plain background it draws at full strength.
   */
  setGridEmphasis(emphasis = 1) {
    const opacity = Math.max(0, Math.min(1, emphasis));
    const apply = (object, base) => {
      if (!object?.material) return;
      object.material.transparent = true;
      object.material.opacity = base * opacity;
      object.material.depthWrite = opacity > 0.5;
      object.material.needsUpdate = true;
    };
    apply(this.grid, 0.75);
    if (this.rings) {
      this.rings.traverse(child => {
        if (child.material) apply(child, child.userData.baseOpacity ?? 0.5);
      });
    }
  }

  /* ===================================================================== */
  /* EXTERNAL GLB / GLTF                                                   */
  /* ===================================================================== */

  /**
   * Import a GLB/GLTF assembly. Every mesh becomes an independently selectable
   * part; engineering data does not exist for imported geometry, and the UI
   * says so rather than inventing descriptions.
   */
  async loadFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;

      this.clearSelection({ silent: true });
      this.setHover(null);
      if (this.assembly) {
        this.manipulator.remove(this.assembly.group);
        disposeAssembly(this.assembly);
        this.assembly = null;
      }

      // Centre and normalise so the import lands in the same working volume.
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const centre = bounds.getCenter(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z) || 1;

      const holder = new THREE.Group();
      holder.position.copy(centre).multiplyScalar(-1);
      holder.add(root);
      holder.updateMatrixWorld(true);

      const group = new THREE.Group();
      group.add(holder);
      group.scale.setScalar(6.2 / largest);
      group.name = file.name;
      group.updateMatrixWorld(true);

      const parts = [];
      const byId = new Map();
      const assemblyCentre = new THREE.Vector3();

      root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;

        const index = parts.length;
        const partId = `mesh-${index}`;
        child.userData.partId = partId;
        child.userData.partRoot = child;
        child.userData.imported = true;
        child.userData.importedName = child.name && child.name.trim()
          ? child.name
          : `Mesh ${index + 1}`;
        child.userData.home = child.position.clone();

        const world = child.getWorldPosition(new THREE.Vector3());
        const direction = world.clone().sub(assemblyCentre);
        if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0);
        child.userData.explodeDirection = direction.normalize();

        parts.push(child);
        byId.set(partId, child);
      });

      if (parts.length === 0) {
        throw new Error("the file contains no meshes");
      }

      this.assembly = {
        group,
        parts,
        byId,
        definition: { id: "imported", name: file.name, imported: true },
        imported: true
      };
      this.modelId = "imported";
      this._partTargets.clear();
      for (const part of parts) {
        this._partTargets.set(part, { position: part.position.clone() });
      }

      this.manipulator.add(group);
      this.resetTransform({ animated: false });
      this.frameModel();
      this.onStatus({ model: this.assembly.definition, parts: parts.length, imported: true });
      return { parts: parts.length, name: file.name };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ===================================================================== */
  /* LOOP                                                                  */
  /* ===================================================================== */

  _tick() {
    this._rafId = requestAnimationFrame(this._frame);
    this.update(Math.min(this._clock.getDelta(), 0.05));
  }

  /**
   * Advance the workspace simulation by `dt` seconds. Kept separate from the
   * animation-frame driver so it can be stepped deterministically (wireframe
   * checks, screenshots) without a GPU.
   */
  update(dt) {
    this.time = (this.time || 0) + dt;

    // Hover raycast is throttled to once per frame from the latest pointer.
    if (this._hoverPending) {
      const ndc = this._hoverPending;
      this._hoverPending = null;
      this.setHover(this.raycast(ndc));
    }

    // Animate parts toward their targets (explode / reassemble).
    const alpha = 1 - Math.exp(-9 * dt);
    for (const part of this.parts) {
      const target = this._partTargets.get(part);
      if (!target) continue;
      part.position.lerp(target.position, alpha);
      // Snap when the remaining distance is imperceptible, so parts settle
      // exactly at their targets instead of creeping forever.
      if (part.position.distanceToSquared(target.position) < 1e-4) {
        part.position.copy(target.position);
      }
      if (part.userData.outline) {
        part.userData.outline.position.copy(part.position);
        part.userData.outline.rotation.copy(part.rotation);
        part.userData.outline.scale.copy(part.scale);
      }
    }

    // Camera transition.
    if (this._cameraGoal) {
      const goal = this._cameraGoal;
      goal.t = Math.min(1, goal.t + dt / goal.duration);
      const e = 1 - Math.pow(1 - goal.t, 3);
      this.camera.position.lerp(goal.position, Math.min(1, alpha * (0.6 + e)));
      this.controls.target.lerp(goal.target, Math.min(1, alpha * (0.6 + e)));
      if (
        goal.t >= 1 &&
        this.camera.position.distanceToSquared(goal.position) < 1e-4 &&
        this.controls.target.distanceToSquared(goal.target) < 1e-4
      ) {
        this.camera.position.copy(goal.position);
        this.controls.target.copy(goal.target);
        this._cameraGoal = null;
      }
    }

    // Smooth transform settling.
    if (this._transformGoal) {
      const t = this.transform;
      const g = this._transformGoal;
      t.position.lerp(g.position, alpha);
      t.rotationZ += (g.rotationZ - t.rotationZ) * alpha;
      t.rotationX += (g.rotationX - t.rotationX) * alpha;
      t.scale += (g.scale - t.scale) * alpha;
      this._applyTransform();
    }

    this.controls.update();

    // ---- render, with the hands drawn late -------------------------------
    // The hand rigs are scene objects so they keep real 3D shape and depth, but
    // they are excluded from the scene/bloom pass and drawn afterwards with
    // depth testing off. Two things follow:
    //
    //   1. A model sweeping in front of the hand can never hide it. Losing the
    //      skeleton mid-gesture is far worse than a small occlusion error.
    //   2. The skeleton is not smeared by bloom, so bones and joints stay crisp
    //      instead of glowing into a blur.
    //
    // Depth is not thrown away: the rig dims and shrinks when scene geometry is
    // between it and the camera (see HandRig.applyDepth), so it still reads as
    // 3D rather than as a flat sticker.
    const late = this.lateLayer && this.lateLayer.visible;
    if (late) this.lateLayer.visible = false;

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    if (late) {
      this.lateLayer.visible = true;
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = autoClear;
    }
  }

  /**
   * Attach the group that must be composited over the frame.
   *
   * main.js hands over the hand-skeleton root here once the rigs exist, so the
   * render loop knows what to hold back for the second pass.
   */
  setLateLayer(object3d) {
    this.lateLayer = object3d || null;
    return this.lateLayer;
  }

  /**
   * A real, computed snapshot of the render pipeline — the numbers a support
   * request needs. Nothing here is cached success state: every field is read
   * from the live scene graph, camera and renderer at call time.
   */
  diagnostics() {
    const out = {
      model: this.modelId || null,
      loaded: Boolean(this.assembly),
      meshes: 0,
      visibleMeshes: 0,
      triangles: 0,
      bounds: null,
      attached: false,
      cameraDistance: null,
      renderCallCount: 0,
      trianglesLastFrame: 0,
      inFrustum: false,
      loopRunning: false
    };

    if (!this.assembly) return out;

    const root = this.assembly.group;
    root.updateMatrixWorld(true);

    root.traverse(object => {
      if (!object.isMesh) return;
      out.meshes++;
      // A mesh is only visible if nothing in its parent chain is hidden.
      let visible = true;
      for (let node = object; node; node = node.parent) {
        if (!node.visible) { visible = false; break; }
      }
      if (!visible) return;
      out.visibleMeshes++;
      const geometry = object.geometry;
      const count = geometry?.index
        ? geometry.index.count
        : geometry?.attributes?.position?.count || 0;
      out.triangles += Math.floor(count / 3);
    });

    // Is the assembly actually reachable from the scene the renderer draws?
    let node = root;
    while (node.parent) node = node.parent;
    out.attached = node === this.scene && this.scene.children.includes(this.manipulator);

    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      out.bounds = { x: size.x, y: size.y, z: size.z, centre };
    }

    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    out.cameraDistance = this.camera.position.distanceTo(this.controls.target);

    // Frustum test against the assembly's own bounding sphere. This answers
    // "is the thing I am drawing on screen" without needing a GPU readback.
    if (out.bounds) {
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      this._frustum = this._frustum || new THREE.Frustum();
      this._projScreen = this._projScreen || new THREE.Matrix4();
      this._projScreen.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this._frustum.setFromProjectionMatrix(this._projScreen);
      out.inFrustum = this._frustum.intersectsSphere(sphere);
    }

    const info = this.renderer.info || { render: {} };
    out.renderCallCount = info.render?.calls || 0;
    out.trianglesLastFrame = info.render?.triangles || 0;
    out.loopRunning = Boolean(this._rafId);
    return out;
  }

  getStats() {
    const info = this.renderer.info || { render: {}, memory: {} };
    return {
      fps: this._fps || 0,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
  }

  /* ===================================================================== */
  /* DISPOSAL                                                              */
  /* ===================================================================== */

  dispose() {
    cancelAnimationFrame(this._rafId);
    window.removeEventListener("resize", this._onResize);
    this._ro?.disconnect();
    disposeAssembly(this.assembly);
    this.controls.dispose?.();
    this.renderer.dispose?.();
    this.renderer.domElement?.remove();
  }
}
