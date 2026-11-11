/**
 * HOLOCORE — main.js
 * -----------------------------------------------------------------------------
 * Application controller.
 *
 * Wiring summary
 *   settings  → Workspace (view/shadows/grid), HandTracker (detection),
 *               HandAnalyzer / ManipulationSolver (gestures + response)
 *   tracker   → HandAnalyzer per hand → ManipulationSolver → Workspace.transform
 *             → HandOverlay (landmarks) + reticle → Inspector (hover/selection)
 *   selection → Inspector + Assistant context + 3D outline + status bar
 */

import { Workspace } from "./modelManager.js";
import { HandTracker, TRACKER_STATUS } from "./handTracking.js";
import {
  HandAnalyzer,
  ManipulationSolver,
  describeGesture,
  LM
} from "./gestures.js";
import { HandOverlay } from "./handOverlay.js";
import { HandSkeleton3D } from "./handSkeleton3d.js";
import { Playground, PRIMITIVES } from "./playground.js";
import { chimes } from "./chimes.js";
import { VoiceControl, VOICE_STATUS, COLOR_PALETTE, parseCommand } from "./voiceControl.js";
import { MODES, getMode, isMode, instructionFor } from "./interactionModes.js";
import { landmarkToNdc, landmarkToStage, coverFit } from "./handGeometry.js";
import { ComponentInspector } from "./componentInspector.js";
import { createAssistant } from "./assistant.js";
import { SettingsStore } from "./store.js";
import { Animator, flash, clamp } from "./animations.js";
import { renderMarkdown } from "./ui/markdown.js";
import {
  MODEL_LIBRARY,
  COMPONENTS,
  getModelDefinition,
  getComponentData
} from "./engineeringData.js";

/* ------------------------------------------------------------------------- */
/* DOM HELPERS                                                               */
/* ------------------------------------------------------------------------- */

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const dom = {
  workspace: $("#workspace"),
  viewport: $("#viewport"),

  workspaceModel: $("#workspace-model"),
  cameraToggle: $("#camera-toggle"),
  cameraToggleLabel: $("#camera-toggle-label"),
  cameraDot: $("#camera-dot"),

  pillCamera: $("#pill-camera"),
  pillHands: $("#pill-hands"),
  pillGesture: $("#pill-gesture"),

  categoryRow: $("#category-row"),
  modelList: $("#model-list"),
  primitiveGrid: $("#primitive-grid"),
  primitiveCount: $("#primitive-count"),
  libraryImport: $("#library-import"),
  playgroundClear: $("#playground-clear"),
  partList: $("#part-list"),
  partCount: $("#part-count"),
  libraryFootModel: $("#library-foot-model"),

  toolExplode: $("#tool-explode"),
  toolIsolate: $("#tool-isolate"),
  toolFocus: $("#tool-focus"),
  toolReset: $("#tool-reset"),
  toolGrid: $("#tool-grid"),
  toolShadows: $("#tool-shadows"),
  toolRotate: $("#tool-rotate"),
  toolImport: $("#tool-import"),
  fileInput: $("#file-input"),
  importNote: $("#import-note"),

  hudModelStatus: $("#hud-model-status"),
  hudSelection: $("#hud-selection"),
  hudFps: $("#hud-fps"),
  hudTris: $("#hud-tris"),
  hudHands: $("#hud-hands"),
  panelLeft: $("#panel-left"),
  panelRight: $("#panel-right"),
  drawerToggleLeft: $("#drawer-toggle-left"),
  drawerToggleRight: $("#drawer-toggle-right"),
  stageToolbar: $("#stage-toolbar"),
  stageAddObject: $("#stage-add-object"),
  stageDuplicate: $("#stage-duplicate"),
  stageDelete: $("#stage-delete"),
  stageVoice: $("#stage-voice"),
  stageReset: $("#stage-reset"),
  stageKeys: $("#stage-keys"),
  hudObjects: $("#hud-objects"),
  hudObjectName: $("#hud-object-name"),
  voiceChip: $("#voice-chip"),
  voiceState: $("#voice-state"),
  voicePhrase: $("#voice-phrase"),
  sceneOutliner: $("#scene-outliner"),
  diagnostics: $("#diagnostics"),
  diagToggle: $("#diag-toggle"),
  diagGrid: $("#diag-grid"),
  diagModel: $("#diag-model"),
  diagMeshes: $("#diag-meshes"),
  diagVisible: $("#diag-visible"),
  diagTris: $("#diag-tris"),
  diagBounds: $("#diag-bounds"),
  diagCamdist: $("#diag-camdist"),
  diagAttached: $("#diag-attached"),
  diagInFrustum: $("#diag-infrustum"),
  diagLoop: $("#diag-loop"),
  diagErrors: $("#diag-errors"),

  reticle: $("#reticle"),
  reticleLabel: $("#reticle-label"),
  viewportHint: $("#viewport-hint"),
  readoutPos: $("#readout-pos"),
  readoutRot: $("#readout-rot"),
  readoutScale: $("#readout-scale"),

  workspaceVideo: $("#workspace-video"),
  workspaceOverlay: $("#workspace-overlay"),
  workspaceScrim: $("#workspace-scrim"),
  workspaceCamNote: $("#workspace-cam-note"),
  workspaceCamEnable: $("#workspace-cam-enable"),

  modeBar: $("#mode-bar"),
  modeButtons: $("#mode-buttons"),
  modeInstruction: $("#mode-instruction"),
  modeDot: $("#mode-dot"),
  modeInstructionText: $("#mode-instruction-text"),
  modeInstructionTarget: $("#mode-instruction-target"),
  hudGesture: $("#hud-gesture"),

  explodeSlider: $("#explode-slider"),
  explodeValue: $("#explode-value"),
  cameraView: $("#camera-view"),

  cameraCard: $("#camera-card"),
  cameraStage: $("#camera-stage"),
  cameraVideo: $("#camera-video"),
  cameraOverlay: $("#camera-overlay"),
  cameraPlaceholder: $("#camera-placeholder"),
  cameraError: $("#camera-error"),
  cameraErrorText: $("#camera-error-text"),
  cameraActivate: $("#camera-activate"),
  cameraRetry: $("#camera-retry"),
  cameraHide: $("#camera-hide"),
  cameraStop: $("#camera-stop"),
  cameraRestore: $("#camera-restore"),
  trackingState: $("#tracking-state"),
  trackingMetrics: $("#tracking-metrics"),
  handReadouts: $("#hand-readouts"),

  inspectorRoot: $("#inspector-root"),
  paneInspector: $("#pane-inspector"),
  paneAssistant: $("#pane-assistant"),
  assistantContext: $("#assistant-context"),
  chatScroll: $("#chat-scroll"),
  chatLog: $("#chat-log"),
  chatEmpty: $("#chat-empty"),
  chatSuggestions: $("#chat-suggestions"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),

  statusCamera: $("#status-camera"),
  statusHands: $("#status-hands"),
  statusGesture: $("#status-gesture"),
  statusTracking: $("#status-tracking"),
  statusSelected: $("#status-selected"),
  statusMode: $("#status-mode"),
  statusApp: $("#status-app"),

  settingsDrawer: $("#settings-drawer"),
  drawerBackdrop: $("#drawer-backdrop"),
  helpModal: $("#help-modal"),
  helpBackdrop: $("#help-backdrop"),
  helpHttpsNote: $("#help-https-note"),

  boot: $("#boot"),
  bootStatus: $("#boot-status"),
  bootBar: $("#boot-bar-fill"),
  toastStack: $("#toast-stack")
};

/* ------------------------------------------------------------------------- */
/* STATE                                                                     */
/* ------------------------------------------------------------------------- */

const store = new SettingsStore();
let settings = store.get();

/**
 * How far a grabbed playground object may be dragged. Shared with the gesture
 * solver so the clamp is applied once, at the same limit, in both places.
 */
const STAGE_BOUNDS = Object.freeze({ x: 4.2, y: 3.2, z: 3.6 });

const state = {
  modelId: MODEL_LIBRARY[0].id,
  category: "All",
  partId: null,
  hoverId: null,
  gestureMode: "idle",
  intent: "none",
  /** Active interaction mode id (select | move | rotate | scale | explode). */
  mode: "select",
  /** Full-workspace camera vs. small preview card. */
  cameraView: "workspace",
  /** True while the workspace video element is actually showing frames. */
  cameraLive: false,
  diagnosticsOpen: false,
  /** Per-part transform captured when a MOVE/ROTATE/SCALE gesture begins. */
  gestureTarget: null,
  gestureStart: null,
  /** Last hovered part under the fingertip. */
  pointerTarget: null,
  activePinches: [],
  lastFrameTime: performance.now(),
  lastAppliedTarget: null,
  booted: false,
  lastSelectionSource: "mouse",
  trackingFps: 0,
  renderFps: 0
};

const animator = new Animator();
const analyzers = new Map(); // keyed by handedness slot
let overlayWorkspace = null;
const overlayHands = [];
const overlayPinched = [];

/* ------------------------------------------------------------------------- */
/* BOOT SEQUENCE                                                             */
/* ------------------------------------------------------------------------- */

function setBoot(progress, text) {
  if (dom.bootBar) dom.bootBar.style.width = `${clamp(progress, 0, 100)}%`;
  if (dom.bootStatus && text) dom.bootStatus.textContent = text;
}

function finishBoot() {
  if (state.booted) return;
  state.booted = true;
  setBoot(100, "READY");
  window.setTimeout(() => {
    dom.boot?.classList.add("done");
    window.setTimeout(() => dom.boot?.remove(), 600);
  }, 260);
}

/* ------------------------------------------------------------------------- */
/* TOASTS                                                                    */
/* ------------------------------------------------------------------------- */

function toast(message, kind = "", duration = 3200) {
  if (!dom.toastStack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  dom.toastStack.appendChild(el);
  window.setTimeout(() => {
    el.classList.add("out");
    window.setTimeout(() => el.remove(), 260);
  }, duration);
}

/* ------------------------------------------------------------------------- */
/* WORKSPACE BOOT                                                           */
/* ------------------------------------------------------------------------- */

let workspace;
let tracker;
let overlay;
let inspector;
let assistant;
/** Scene-space hand skeletons (the glowing 3D hands). */
let skeleton3d = null;
/** Multi-object playground: primitives, imports, animation. */
let playground = null;
/** Web Speech command layer. */
let voice = null;

/**
 * Boot is split in two so that a missing GPU degrades the experience instead of
 * killing it: the library, inspector shell, settings and assistant always wire
 * up; only the 3D scene is unavailable in that case.
 */
function setupChrome() {
  setupSceneTools();
  setupCameraControls();
  setupAssistantChrome();
  setupDrawer();
  buildPrimitiveLibrary();
  buildCategoryRow();
  buildModelLibrary();
  checkSecureContext();

  // A settings/assistant shell exists even without a renderer.
  inspector = new ComponentInspector({
    root: dom.inspectorRoot,
    getWorkspace: () => workspace,
    getPlayground: () => playground,
    onFocus: () => {
      workspace?.focusSelected();
      if (workspace) toast("Camera focused on the selected component", "accent", 2000);
    },
    onIsolate: () => toggleIsolate(),
    onShowRelated: partId => {
      if (!partId || !workspace) return;
      workspace.select(partId, { focus: true });
      handleSelect(partId, "inspector-relation");
      toast(`Selected ${getComponentData(state.modelId, partId)?.name || partId}`, "accent", 2200);
    },
    onAsk: prompt => askAssistant(prompt, { switchTab: true }),
    onClear: () => {
      workspace?.clearSelection();
      handleSelect(null, "ui");
    }
  });
  inspector.setModel(state.modelId);

  setupSettingsUI();
  applyNonSceneSettings();
}

/**
 * Build the workspace landmark overlay once and reuse it. It was previously
 * constructed in three separate places (including inside applySettings, which
 * runs on every settings change), leaking a ResizeObserver each time and
 * resetting the pinch animation phase.
 */
function ensureWorkspaceOverlay() {
  if (overlayWorkspace || !dom.workspaceOverlay) return overlayWorkspace;
  overlayWorkspace = new HandOverlay({
    canvas: dom.workspaceOverlay,
    video: dom.workspaceVideo,
    settings: settings.camera
  });
  return overlayWorkspace;
}

/** Settings that do not depend on the 3D renderer. */
function applyNonSceneSettings() {
  ensureWorkspaceOverlay();

  dom.cameraStage.classList.toggle("no-landmarks", !settings.camera.showLandmarks);
  dom.cameraVideo.classList.toggle("unmirrored", !settings.camera.mirror);
  dom.workspaceVideo?.classList.toggle("unmirrored", !settings.camera.mirror);
  overlay?.updateSettings?.(settings.camera);
  overlayWorkspace?.updateSettings?.(settings.camera);
  // The scene-space skeletons must follow the mirror setting too. Without this
  // the preview flipped while the 3D hands stayed put, which is precisely the
  // mismatch the coordinate module now prevents. `updateSettings` reconfigure
  // the existing rigs; it does not rebuild them, so the change is instant and
  // tracking is not interrupted.
  skeleton3d?.updateSettings?.({
    mirror: settings.camera.mirror,
    smoothing: settings.gesture.smoothing
  });
  dom.viewport?.style.setProperty("--scrim-strength", String(settings.camera.scrim ?? 0));
  const workspaceViewInput = document.getElementById("set-workspace-view");
  if (workspaceViewInput) workspaceViewInput.checked = settings.camera.workspaceView !== false;
  const voiceEnabledInputSync = document.getElementById("set-voice-enabled");
  if (voiceEnabledInputSync) voiceEnabledInputSync.checked = settings.voice?.enabled !== false;
  const soundEffectsInputSync = document.getElementById("set-sound-effects");
  if (soundEffectsInputSync) soundEffectsInputSync.checked = settings.voice?.soundEffects !== false;
  syncWorkspaceVideo();
  setRightTab(settings.ui.rightTab || "inspector");
  setPanelState({ left: settings.ui.leftOpen, right: settings.ui.rightOpen }, { persist: false });
}

function disable3DControls(reason) {
  for (const button of [
    dom.toolExplode, dom.toolIsolate, dom.toolFocus, dom.toolReset,
    dom.toolGrid, dom.toolShadows, dom.toolRotate, dom.toolImport
  ]) {
    if (button) {
      button.disabled = true;
      button.title = reason;
    }
  }
  dom.hudModelStatus.textContent = "RENDERER UNAVAILABLE";
  dom.viewportHint?.classList.add("dimmed");
}

function boot() {
  setupChrome();

  const hasWebGL = (() => {
    // A harness may supply its own renderer (tests, WebGPU back ends). When it
    // does, the WebGL probe is irrelevant.
    if (typeof window !== "undefined" && window.__HOLOCORE_RENDERER_FACTORY__) return true;
    try {
      const canvas = document.createElement("canvas");
      return Boolean(
        window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl"))
      );
    } catch {
      return false;
    }
  })();

  if (!hasWebGL) {
    const reason =
      "This browser could not create a WebGL context, so the 3D workspace cannot run. " +
      "Enable hardware acceleration (or try another browser) — the model library, inspector " +
      "and assistant remain available.";
    setBoot(100, "WEBGL UNAVAILABLE");
    disable3DControls(reason);
    dom.hudModelStatus.textContent = "WEBGL UNAVAILABLE";
    dom.partCount.textContent = "—";
    dom.libraryFootModel.textContent = "3D renderer unavailable";
    toast(reason, "error", 12000);
    setupAssistant();
    initInteraction();
    finishBoot();
    return;
  }

  setBoot(20, "Building 3D workspace…");

  try {
    workspace = new Workspace({
      container: dom.viewport,
      rendererFactory: window.__HOLOCORE_RENDERER_FACTORY__ || undefined,
      controlsFactory: window.__HOLOCORE_CONTROLS_FACTORY__ || undefined,
      environment: !window.__HOLOCORE_RENDERER_FACTORY__,
      settings: {
        shadows: settings.view.shadows,
        autoRotate: settings.view.autoRotate,
        grid: settings.view.grid,
        quality: settings.view.quality
      },
      onSelect: partId => handleSelect(partId, "mouse"),
      onHover: partId => handleHover(partId),
      onStatus: status => {
        dom.hudModelStatus.textContent = status.imported
          ? "IMPORTED MODEL"
          : `${status.parts} PARTS · READY`;
      }
    });
  } catch (error) {
    console.error("[HOLOCORE] Workspace failed to initialise:", error);
    const reason = `The 3D renderer failed to start: ${error.message}`;
    dom.hudModelStatus.textContent = "RENDERER ERROR";
    disable3DControls(reason);
    toast(reason, "error", 10000);
    setupAssistant();
    finishBoot();
    return;
  }

  installGlErrorWatch(workspace);

  // Scene-space hand skeletons: real geometry so hands can be occluded by the
  // model and share its lighting, which a 2D overlay can never do.
  skeleton3d = new HandSkeleton3D({
    scene: workspace.scene,
    camera: workspace.camera,
    mirror: settings.camera.mirror !== false
  });
  // Register the rigs for the late composite pass, so a model can never hide
  // the hands and bloom never smears them.
  workspace.setLateLayer?.(skeleton3d.root);

  setBoot(55, "Loading assembly…");

  workspace
    .setModel(state.modelId)
    .then(() => {
      renderPartList();
      updateWorkspaceLabels();
      dom.hudModelStatus.textContent = `${workspace.parts.length} PARTS · READY`;
      setBoot(80, "Starting interaction engine…");
      setupAssistant();
      setupOverlay();
      setupPlayground();
      setupVoice();
      applySettings({ section: "all" });
      initInteraction();
      startLoop();
      finishBoot();
      window.setTimeout(() => {
        toast("HOLOCORE ready. Press C to enable the camera, or drag to orbit.", "accent", 5200);
      }, 700);
    })
    .catch(error => {
      console.error("[HOLOCORE] Model load failed:", error);
      toast(`Model failed to load: ${error.message}`, "error", 9000);
      setBoot(100, "MODEL ERROR");
      setupAssistant();
      finishBoot();
    });
}

/* ------------------------------------------------------------------------- */
/* MODEL LIBRARY UI                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Primitive palette. Every tile adds a real object to the playground, so the
 * library is the primary way to populate the scene.
 */
function buildPrimitiveLibrary() {
  if (!dom.primitiveGrid) return;
  dom.primitiveGrid.replaceChildren();
  for (const primitive of PRIMITIVES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primitive-tile";
    button.dataset.primitive = primitive.id;
    button.title = `Add a ${primitive.label.toLowerCase()} to the scene`;
    button.setAttribute("aria-label", `Add ${primitive.label}`);

    const glyph = document.createElement("span");
    glyph.className = "primitive-glyph";
    glyph.textContent = primitive.icon;
    const name = document.createElement("span");
    name.className = "primitive-name";
    name.textContent = primitive.label;
    button.append(glyph, name);

    button.addEventListener("click", () => {
      const added = addPlaygroundPrimitive(primitive.id);
      if (added) toast(`${primitive.label} added`, "", 1200);
    });
    dom.primitiveGrid.appendChild(button);
  }
  if (dom.primitiveCount) dom.primitiveCount.textContent = String(PRIMITIVES.length);
}

function buildCategoryRow() {
  const categories = ["All", ...new Set(MODEL_LIBRARY.map(model => model.category))];
  dom.categoryRow.replaceChildren();
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-chip";
    button.textContent = category;
    button.dataset.category = category;
    if (category === state.category) button.classList.add("active");
    button.addEventListener("click", () => {
      state.category = category;
      buildCategoryRow();
      buildModelLibrary();
    });
    dom.categoryRow.appendChild(button);
  }
}

function buildModelLibrary() {
  dom.modelList.replaceChildren();
  const models = MODEL_LIBRARY.filter(
    model => state.category === "All" || model.category === state.category
  );

  for (const model of models) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-card";
    button.dataset.modelId = model.id;
    if (model.id === state.modelId) button.classList.add("active");
    button.title = model.blurb;

    const glyph = document.createElement("span");
    glyph.className = "model-glyph";
    glyph.textContent = model.glyph;
    glyph.style.color = model.accent;

    const info = document.createElement("span");
    const name = document.createElement("span");
    name.className = "model-name";
    name.textContent = model.name;
    const meta = document.createElement("span");
    meta.className = "model-meta";
    meta.textContent = model.category.toUpperCase();
    info.append(name, meta);

    const count = document.createElement("span");
    count.className = "model-count";
    count.textContent = String(Object.keys(COMPONENTS[model.id] || {}).length);

    button.append(glyph, info, count);
    button.addEventListener("click", () => switchModel(model.id));
    dom.modelList.appendChild(button);
  }
}

async function switchModel(modelId) {
  if (!workspace) {
    const model = getModelDefinition(modelId);
    toast(`${model?.name || modelId}: the 3D renderer is unavailable in this browser.`, "warn", 5000);
    return;
  }
  if (modelId === state.modelId && !state.importedModel) return;
  state.modelId = modelId;
  state.importedModel = false;
  state.partId = null;
  state.hoverId = null;

  dom.hudModelStatus.textContent = "LOADING…";
  for (const card of $$(".model-card")) {
    card.classList.toggle("active", card.dataset.modelId === modelId);
  }

  try {
    await workspace.setModel(modelId);
    inspector.setModel(modelId);
    inspector.select(null);
    renderPartList();
    updateWorkspaceLabels();
    updateStatusSelection(null);
    updateAssistantContext();
    dom.hudModelStatus.textContent = `${workspace.parts.length} PARTS · READY`;
    dom.viewportHint?.classList.add("dimmed");
    toast(`${getModelDefinition(modelId).name} loaded — ${workspace.parts.length} inspectable parts`, "accent", 3000);
  } catch (error) {
    console.error("[HOLOCORE] switchModel failed", error);
    toast(`Could not load that model: ${error.message}`, "error", 6000);
  }
}

function renderPartList() {
  dom.partList.replaceChildren();
  if (!workspace) return;
  const parts = workspace.parts;

  parts.forEach((part, index) => {
    const data = getComponentData(state.modelId, part.userData.partId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "part-item";
    button.dataset.partId = part.userData.partId;

    const idx = document.createElement("span");
    idx.className = "part-index";
    idx.textContent = String(index + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "part-name";
    name.textContent = data?.name || part.name || part.userData.partId;

    const dot = document.createElement("span");
    dot.className = "part-dot";

    button.append(idx, name, dot);
    button.addEventListener("click", () => {
      workspace.select(part.userData.partId, { focus: false });
      handleSelect(part.userData.partId, "list");
    });
    dom.partList.appendChild(button);
  });

  dom.partCount.textContent = String(parts.length);
}

function updateWorkspaceLabels() {
  const model = getModelDefinition(state.modelId);
  if (!model) return;
  dom.workspaceModel.textContent = model.name;
  dom.libraryFootModel.textContent = `${model.short} · ${model.category}`;
  document.title = `HOLOCORE — ${model.name}`;
}

/* ------------------------------------------------------------------------- */
/* SELECTION                                                                 */
/* ------------------------------------------------------------------------- */

function handleSelect(partId, source) {
  state.partId = partId || null;
  state.lastSelectionSource = source;
  const label = partId
    ? getComponentData(state.modelId, partId)?.name || partId
    : null;

  if (!state.importedModel) inspector?.select(partId);
  inspector?.setState({ isolated: workspace?.isolated });
  updatePartListSelection();
  updateStatusSelection(partId);
  updateAssistantContext();

  dom.toolIsolate.disabled = !partId;
  dom.toolFocus.disabled = !partId;
  dom.toolIsolate.classList.toggle("is-on", Boolean(workspace?.isolated));

  if (partId && source !== "hand") dom.viewportHint?.classList.add("dimmed");
  if (label) dom.hudSelection.textContent = label.toUpperCase();
  else dom.hudSelection.textContent = "NONE";

  // The mode strip names what the next gesture will act on.
  updateModeTargetLabel();
}

/**
 * Select a playground object the same way the outliner does: the object is
 * highlighted, the assembly selection is cleared, and the HUD follows.
 */
function selectProp(id, source = "hand") {
  if (!playground) return null;
  const prop = id ? playground.byId.get(id) : null;
  playground.select(prop ? prop.id : null);
  if (prop) {
    workspace?.clearSelection?.();
    handleSelect(null, source);
    toast(`Selected ${prop.name}`, "accent", 1400);
  }
  refreshSceneOutliner();
  updateObjectHud();
  return prop;
}

function updatePartListSelection() {
  for (const item of dom.partList.querySelectorAll(".part-item")) {
    item.classList.toggle("active", item.dataset.partId === state.partId);
  }
}

function handleHover(partId) {
  state.hoverId = partId || null;
  if (state.hoverId) {
    const name = getComponentData(state.modelId, state.hoverId)?.name;
    if (name) {
      dom.reticleLabel.textContent = name;
      dom.reticle.classList.add("is-over");
    }
  } else {
    dom.reticle.classList.remove("is-over");
    dom.reticleLabel.textContent = "";
  }
}

function updateStatusSelection(partId) {
  if (!partId) {
    dom.statusSelected.textContent = "None";
    dom.statusSelected.className = "status-val";
    return;
  }
  const data = getComponentData(state.modelId, partId);
  dom.statusSelected.textContent = data?.name || partId;
  dom.statusSelected.className = "status-val is-accent";
}

/* ------------------------------------------------------------------------- */
/* SCENE TOOLS                                                               */
/* ------------------------------------------------------------------------- */

function setupSceneTools() {
  dom.toolExplode.addEventListener("click", () => {
    if (!workspace) return;
    const next = (workspace.explodeAmount ?? 0) > 0.001 ? 0 : 100;
    setExplodeAmount(next);
    toast(next ? "Exploded view" : "Assembly reassembled", "", 1600);
  });

  dom.explodeSlider?.addEventListener("input", event => {
    setExplodeAmount(Number(event.target.value), { fromSlider: true });
  });

  dom.toolIsolate.addEventListener("click", () => toggleIsolate());
  dom.toolFocus.addEventListener("click", () => workspace?.focusSelected());
  dom.toolReset.addEventListener("click", () => {
    if (!workspace) return;
    workspace.resetView();
    setExplodeAmount(0);
    dom.toolExplode.classList.remove("is-on");
    dom.toolIsolate.classList.remove("is-on");
    workspace.clearSelection();
    handleSelect(null, "ui");
    toast("View, transform and selection reset", "", 1800);
  });

  dom.toolGrid.addEventListener("click", () => {
    const next = !settings.view.grid;
    store.update("view", { grid: next });
  });

  dom.toolShadows.addEventListener("click", () => {
    const next = !settings.view.shadows;
    store.update("view", { shadows: next });
  });

  dom.toolRotate.addEventListener("click", () => {
    const next = !settings.view.autoRotate;
    store.update("view", { autoRotate: next });
  });

  dom.toolImport.addEventListener("click", () => dom.fileInput.click());
  dom.libraryImport?.addEventListener("click", () => dom.fileInput.click());
  dom.playgroundClear?.addEventListener("click", () => {
    const count = playground?.props.length || 0;
    if (!count) {
      toast("No objects to clear", "warn", 1500);
      return;
    }
    playground.clear();
    refreshSceneOutliner();
    updateObjectHud();
    toast(`Cleared ${count} object${count === 1 ? "" : "s"}`, "", 1800);
  });
  dom.fileInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!workspace) {
      toast("Importing needs the 3D renderer, which is unavailable.", "error", 5000);
      event.target.value = "";
      return;
    }

    dom.importNote.textContent = `Loading ${file.name}…`;

    // Preferred path: import into the playground as an additional object, with
    // animation clips where the file has them. The assembly stays loaded, so a
    // user can compare an import against an engineering model side by side.
    if (playground) {
      try {
        const prop = await playground.importFile(file);
        refreshSceneOutliner();
        updateObjectHud();
        const clipNote = prop.clipNames.length
          ? ` · ${prop.clipNames.length} animation${prop.clipNames.length > 1 ? "s" : ""}`
          : "";
        dom.importNote.textContent =
          `Added ${prop.name} to the scene${clipNote}. Pick it from SCENE to animate it.`;
        toast(`Added ${prop.name}${clipNote}`, "accent", 4200);
        return;
      } catch (error) {
        console.warn("[HOLOCORE] Playground import failed, trying assembly import:", error.message);
        // Fall through to the assembly path so a file that only works as a
        // standalone assembly is still usable.
      }
    }

    try {
      const result = await workspace.loadFile(file);

      // Imported geometry has no knowledge base. Remember the procedural model
      // so the library cards can restore it (and the assistant is honest about
      // the missing context).
      state.importedModel = true;
      state.partId = null;
      inspector.lastModelId = state.modelId;
      inspector.setModel(null);
      inspector.clearSelection();

      dom.workspaceModel.textContent = file.name;
      dom.libraryFootModel.textContent = "Imported assembly";
      dom.partCount.textContent = String(result.parts);
      dom.hudModelStatus.textContent = `${result.parts} MESHES · IMPORTED`;
      dom.hudSelection.textContent = "NONE";
      dom.toolIsolate.disabled = true;
      dom.toolFocus.disabled = true;
      dom.importNote.textContent =
        `Imported ${file.name}. These meshes have no engineering knowledge entry — ` +
        "select a mesh to inspect its geometry, or pick a library model to leave import mode.";
      renderImportedPartList();
      updateAssistantContext();
      toast(`Imported ${file.name} — ${result.parts} selectable meshes`, "accent", 4200);
    } catch (error) {
      console.error("[HOLOCORE] GLB import failed", error);
      dom.importNote.textContent = `Could not read ${file.name}: ${error.message}`;
      toast(`Import failed: ${error.message}`, "error", 6000);
    } finally {
      event.target.value = "";
    }
  });
}

function renderImportedPartList() {
  dom.partList.replaceChildren();
  const parts = workspace.parts;
  parts.forEach((part, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "part-item";
    button.dataset.partId = part.userData.partId;

    const idx = document.createElement("span");
    idx.className = "part-index";
    idx.textContent = String(index + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "part-name";
    name.textContent = part.userData.importedName || part.name || part.userData.partId;

    const dot = document.createElement("span");
    dot.className = "part-dot";

    button.append(idx, name, dot);
    button.addEventListener("click", () => {
      workspace.select(part.userData.partId);
      handleSelect(part.userData.partId, "list");
    });
    dom.partList.appendChild(button);
  });
}

function toggleIsolate() {
  if (!state.partId || !workspace) return;
  if (!workspace) return;
  const isolated = workspace.toggleIsolate();
  dom.toolIsolate.classList.toggle("is-on", isolated);
  inspector?.setState({ isolated });
  toast(isolated ? "Isolated selection" : "All parts visible", "", 1600);
}

/* ------------------------------------------------------------------------- */
/* CAMERA + TRACKING                                                        */
/* ------------------------------------------------------------------------- */

function setupOverlay() {
  overlay = new HandOverlay({
    canvas: dom.cameraOverlay,
    video: dom.cameraVideo,
    settings: settings.camera
  });

  tracker = new HandTracker({
    video: dom.cameraVideo,
    settings: settings.tracking,
    onState: trackerState => {
      updateTrackingUI(trackerState);
      syncWorkspaceVideo();
      if (trackerState.status === TRACKER_STATUS.ERROR) {
        showCameraError(trackerState.error);
      } else if (trackerState.status !== TRACKER_STATUS.IDLE) {
        hideCameraError();
      }
    },
    onFrame: () => {} // per-frame work happens in the render loop
  });

  ensureWorkspaceOverlay();

  dom.cameraStage.classList.toggle("no-landmarks", !settings.camera.showLandmarks);
  dom.cameraVideo.classList.toggle("unmirrored", !settings.camera.mirror);
  dom.workspaceVideo?.classList.toggle("unmirrored", !settings.camera.mirror);
}

async function toggleCamera() {
  if (!tracker) return;
  if (tracker.status === TRACKER_STATUS.ACTIVE || tracker.status === TRACKER_STATUS.HANDS ||
      tracker.status === TRACKER_STATUS.LOST) {
    tracker.stop();
    updateTrackingUI(tracker.getState());
    return;
  }
  const trackerState = await tracker.start({ deviceId: settings.camera.deviceId || undefined });
  if (trackerState.status === TRACKER_STATUS.ERROR) {
    showCameraError(trackerState.error);
    return;
  }

  // Turning the camera on is the user asking for camera mode, so put the feed
  // across the workspace straight away. The model is still composited in front
  // of it; V (or the toggle) returns to the small preview card.
  if (trackerState.status !== TRACKER_STATUS.ERROR && state.cameraView !== "workspace") {
    setCameraView("workspace");
  }
}

function setupCameraControls() {
  dom.cameraToggle.addEventListener("click", toggleCamera);
  dom.cameraActivate?.addEventListener("click", toggleCamera);
  dom.cameraRetry?.addEventListener("click", () => {
    hideCameraError();
    toggleCamera();
  });
  dom.cameraStop?.addEventListener("click", () => {
    tracker?.stop();
    updateTrackingUI(tracker.getState());
  });
  dom.cameraHide?.addEventListener("click", () => {
    store.update("camera", { previewVisible: false });
  });
  dom.cameraRestore?.addEventListener("click", () => {
    store.update("camera", { previewVisible: true });
  });
  dom.cameraView?.addEventListener("click", toggleCameraView);
  dom.workspaceCamEnable?.addEventListener("click", toggleCamera);
}


/* ------------------------------------------------------------------------- */
/* INTERACTION MODES                                                         */
/* ------------------------------------------------------------------------- */

const MODE_ICONS = {
  select: '<circle cx="8" cy="8" r="2.2"/><circle cx="8" cy="8" r="5.4" opacity="0.55"/>',
  move: '<path d="M8 2v12M2 8h12M8 2 6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2"/>',
  rotate: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 3.6V7h-3.4"/>',
  scale: '<path d="M3 13V9M3 13h4M13 3v4M13 3h-4M3 13 7 9M13 3 9 7"/>',
  explode: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M12 4l-2 2M4 12l2-2M12 12l-2-2"/>'
};

function buildModeBar() {
  if (!dom.modeButtons) return;
  dom.modeButtons.innerHTML = "";
  for (const mode of MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-btn";
    button.dataset.mode = mode.id;
    button.style.setProperty("--mode", mode.colour);
    button.setAttribute("aria-pressed", "false");
    button.title = `${mode.label} mode — ${mode.instruction}`;
    button.innerHTML =
      `<svg viewBox="0 0 16 16" aria-hidden="true">${MODE_ICONS[mode.id] || ""}</svg>` +
      `<span>${mode.label.toUpperCase()}</span><kbd>${mode.shortcut}</kbd>`;
    button.addEventListener("click", () => setMode(mode.id));
    dom.modeButtons.appendChild(button);
  }
  setMode(state.mode, { silent: true });
}

/** Switch interaction mode. This is the only thing that changes what a gesture does. */
function setMode(modeId, { silent = false } = {}) {
  if (!isMode(modeId)) return state.mode;
  state.mode = modeId;
  const mode = getMode(modeId);

  for (const button of $$("#mode-buttons .mode-btn")) {
    const active = button.dataset.mode === modeId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  // The solver is the enforcement point: outside a real mode it keeps its
  // legacy "auto" behaviour, inside one it can only emit that mode's intent.
  solver.setMode(modeId);

  if (dom.modeInstructionText) dom.modeInstructionText.textContent = mode.instruction;
  if (dom.modeDot) dom.modeDot.style.background = mode.colour;
  if (dom.modeInstruction) dom.modeInstruction.style.setProperty("--mode-accent", mode.colour);
  updateModeTargetLabel();

  if (!silent) toast(`${mode.label} mode — ${mode.hint}`, "accent", 2200);
  return state.mode;
}

function updateModeTargetLabel() {
  if (!dom.modeInstructionTarget) return;
  const mode = getMode(state.mode);
  // EXPLODE acts on the whole assembly; the others act on the selected part
  // (falling back to the whole assembly when nothing is selected).
  if (mode.id === "explode") {
    dom.modeInstructionTarget.textContent = "WHOLE ASSEMBLY";
    return;
  }
  if (state.partId) {
    const label = inspector?.lastComponent?.name || state.partId;
    dom.modeInstructionTarget.textContent = label.toUpperCase();
    return;
  }
  dom.modeInstructionTarget.textContent = "WHOLE ASSEMBLY";
}

/* ------------------------------------------------------------------------- */
/* WORKSPACE CAMERA LAYER                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Attach the tracker's stream to the full-workspace video element.
 *
 * The tracker owns one MediaStream; the small preview and the workspace layer
 * are two video elements reading the same stream. Sharing the stream (rather
 * than calling getUserMedia twice) is what keeps both in sync and avoids a
 * second camera indicator.
 */
function syncWorkspaceVideo() {
  const video = dom.workspaceVideo;
  if (!video) return;

  const stream = tracker?.stream || null;
  if (stream && video.srcObject !== stream) {
    video.srcObject = stream;
    video.play?.().catch(() => {});
  } else if (!stream && video.srcObject) {
    video.srcObject = null;
  }

  const live = Boolean(stream) && tracker?.status !== TRACKER_STATUS.ERROR;
  state.cameraLive = live;

  if (dom.workspaceVideo) {
    dom.workspaceVideo.classList.toggle("is-live", live && state.cameraView === "workspace");
    dom.workspaceVideo.classList.toggle("unmirrored", !settings.camera.mirror);
  }
  if (dom.workspaceScrim) {
    dom.workspaceScrim.classList.toggle("is-live", live);
  }
  // Fade the ground grid while the camera fills the stage: a 40-unit wireframe
  // over a live feed buries the person and the model in clutter.
  workspace?.setGridEmphasis?.(live && state.cameraView === "workspace" ? 0.22 : 1);
  if (dom.workspaceCamNote) {
    dom.workspaceCamNote.hidden = live || state.cameraView !== "workspace";
  }
  if (dom.workspaceOverlay) {
    dom.workspaceOverlay.style.display = state.cameraView === "workspace" ? "" : "none";
  }
  // The small preview card is hidden while the feed fills the workspace.
  if (dom.cameraCard) {
    dom.cameraCard.classList.toggle("is-minimised", state.cameraView === "workspace" && live);
  }
  if (dom.cameraView) {
    dom.cameraView.setAttribute("aria-pressed", String(state.cameraView === "workspace"));
  }
}

function setCameraView(view) {
  state.cameraView = view === "workspace" ? "workspace" : "preview";
  store.update("camera", { workspaceView: state.cameraView === "workspace" });
  const workspaceViewInput = document.getElementById("set-workspace-view");
  if (workspaceViewInput) workspaceViewInput.checked = state.cameraView === "workspace";
  syncWorkspaceVideo();
  toast(
    state.cameraView === "workspace"
      ? "Camera fills the workspace"
      : "Camera shown as a small preview",
    "",
    1800
  );
}

function toggleCameraView() {
  setCameraView(state.cameraView === "workspace" ? "preview" : "workspace");
}

/* ------------------------------------------------------------------------- */
/* EXPLODE AMOUNT                                                            */
/* ------------------------------------------------------------------------- */

function setExplodeAmount(percent, { fromSlider = false } = {}) {
  const amount = clamp(percent, 0, 100) / 100;
  if (workspace) workspace.setExplodeAmount(amount);

  if (dom.explodeSlider && !fromSlider) {
    dom.explodeSlider.value = String(Math.round(amount * 100));
  }
  if (dom.explodeValue) dom.explodeValue.textContent = `${Math.round(amount * 100)}%`;
  if (dom.explodeSlider) {
    dom.explodeSlider.setAttribute("aria-valuetext", `${Math.round(amount * 100)} percent`);
  }
  if (dom.toolExplode) {
    dom.toolExplode.classList.toggle("is-on", amount > 0.001);
    const label = dom.toolExplode.lastChild;
    if (label?.nodeType === 3) label.textContent = amount > 0.001 ? " Reassemble" : " Explode";
  }
}

function showCameraError(message) {
  dom.cameraError.hidden = false;
  dom.cameraPlaceholder.hidden = true;
  dom.cameraErrorText.textContent = message;
  dom.cameraCard.dataset.state = "off";
  toast(message, "error", 7000);
}

function hideCameraError() {
  dom.cameraError.hidden = true;
}

const STATUS_CLASS = {
  [TRACKER_STATUS.IDLE]: ["CAMERA INACTIVE", ""],
  [TRACKER_STATUS.REQUESTING]: ["REQUESTING PERMISSION", "is-warn"],
  [TRACKER_STATUS.STARTING]: ["LOADING HAND MODEL", "is-warn"],
  [TRACKER_STATUS.ACTIVE]: ["CAMERA ACTIVE · NO HANDS", "is-live"],
  [TRACKER_STATUS.HANDS]: ["TRACKING", "is-live"],
  [TRACKER_STATUS.LOST]: ["TRACKING LOST", "is-warn"],
  [TRACKER_STATUS.ERROR]: ["CAMERA ERROR", "is-error"],
  [TRACKER_STATUS.STOPPED]: ["CAMERA OFF", ""]
};

function updateTrackingUI(trackerState) {
  if (!trackerState) return;

  const [label, cls] = STATUS_CLASS[trackerState.status] || ["UNKNOWN", ""];
  dom.trackingState.textContent = label;
  dom.trackingState.className = `tracking-state ${cls}`.trim();

  const live =
    trackerState.status === TRACKER_STATUS.ACTIVE ||
    trackerState.status === TRACKER_STATUS.HANDS ||
    trackerState.status === TRACKER_STATUS.LOST;

  dom.cameraCard.dataset.state = live ? "live" : "off";
  dom.cameraPlaceholder.hidden = live;
  if (live) hideCameraError();

  // Top bar camera control
  dom.cameraToggle.classList.toggle("is-active", live);
  dom.cameraToggleLabel.textContent = live ? "Stop camera" : "Enable camera";
  dom.cameraDot.className = `dot ${live ? "dot-live" : "dot-off"}`;

  // Status pills
  dom.pillCamera.className = `pill ${live ? "is-on" : ""}`.trim();
  dom.pillCamera.querySelector("span").textContent = live ? "CAMERA LIVE" : "CAMERA OFF";

  dom.pillHands.className = `pill ${trackerState.hands > 0 ? "is-live" : ""}`.trim();
  dom.pillHands.querySelector("span").textContent = `${trackerState.hands} HAND${trackerState.hands === 1 ? "" : "S"}`;

  // Status bar
  dom.statusCamera.textContent =
    trackerState.status === TRACKER_STATUS.ERROR ? "Error" : live ? "Live" : "Inactive";
  dom.statusCamera.className = `status-val ${trackerState.status === TRACKER_STATUS.ERROR ? "is-error" : live ? "is-live" : ""}`.trim();

  dom.statusHands.textContent = String(trackerState.hands);
  dom.statusHands.className = `status-val ${trackerState.hands ? "is-accent" : ""}`.trim();

  state.trackingFps = trackerState.fps;
  state.trackingDelegate = trackerState.delegate;

  dom.trackingMetrics.textContent = live
    ? `${trackerState.fps} FPS · ${Number(trackerState.inferenceMs || 0).toFixed(1)} MS` +
      (trackerState.delegate ? ` · ${trackerState.delegate}` : "")
    : "—";

  updateHandReadouts();

  // The workspace camera layer mirrors the same state so the two views agree.
  syncWorkspaceVideo();
  if (dom.workspaceCamNote) {
    dom.workspaceCamNote.hidden = live || state.cameraView !== "workspace";
  }
}

function updateHandReadouts() {
  const readouts = dom.handReadouts.querySelectorAll(".hand-readout");
  readouts.forEach(el => {
    const side = el.dataset.hand;
    const hand = overlayHands.find(item => item?.state?.handedness === side) ||
      overlayHands.find(item => item?.side === side);
    const stateObj = hand?.state || hand;

    el.classList.toggle("is-active", Boolean(stateObj));
    const small = el.querySelector("small");
    if (!stateObj) {
      small.textContent = "not detected";
      return;
    }
    const bits = [];
    if (stateObj.pinched) bits.push("PINCH");
    else if (stateObj.pointing > 0.6) bits.push("POINT");
    else if (stateObj.openPalm > 0.7) bits.push("OPEN");
    bits.push(`P ${(stateObj.pinchStrength ?? 0).toFixed(2)}`);
    small.textContent = bits.join(" · ");
  });
}

function checkSecureContext() {
  const secure =
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!secure) {
    document.body.dataset.permission = "insecure";
    if (dom.helpHttpsNote) dom.helpHttpsNote.hidden = false;
    dom.importNote.textContent =
      "Camera access requires HTTPS or localhost. The 3D workspace and inspector work normally.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    dom.cameraToggle.disabled = true;
    dom.cameraActivate.disabled = true;
    dom.cameraActivate.textContent = "Camera unsupported";
    dom.trackingState.textContent = "CAMERA API UNAVAILABLE";
    dom.trackingState.className = "tracking-state is-error";
  }
}

/* ------------------------------------------------------------------------- */
/* INTERACTION LOOP                                                         */
/* ------------------------------------------------------------------------- */

function initInteraction() {
  buildModeBar();
  setupShortcuts();
  // Restore the camera view preference (defaults to full workspace).
  state.cameraView = settings.camera.workspaceView === false ? "preview" : "workspace";
  syncWorkspaceVideo();
  if (dom.workspaceCamNote) {
    dom.workspaceCamNote.hidden = state.cameraLive || state.cameraView !== "workspace";
  }
  setupDiagnostics();
}

/**
 * The diagnostic panel is collapsible and starts closed. It is wired here (and
 * not in the WebGL success path) so it also works when 3D is unavailable and
 * reports the failure honestly instead of showing a blank panel.
 */
function setupDiagnostics() {
  if (!dom.diagToggle || dom.diagToggle.dataset.wired === "1") return;
  dom.diagToggle.dataset.wired = "1";
  dom.diagToggle.addEventListener("click", () => {
    state.diagnosticsOpen = !state.diagnosticsOpen;
    updateDiagnostics();
  });
  updateDiagnostics();
}

function startLoop() {
  const loop = () => {
    const now = performance.now();
    const dt = Math.min((now - state.lastFrameTime) / 1000, 0.05);
    state.lastFrameTime = now;
    state.frameDelta = dt;

    animator.update(dt);
    // Playground animation (glTF clips and the idle spin) runs on the same
    // clock as everything else.
    playground?.update(dt);
    // Fade the keyboard hints once the user is actually interacting, so the
    // stage is clean during a session but discoverable at rest.
    const interacting = Boolean(state.gestureTarget) || state.cameraLive;
    if (interacting !== document.body.classList.contains("is-interacting")) {
      document.body.classList.toggle("is-interacting", interacting);
      if (dom.stageKeys) dom.stageKeys.style.opacity = interacting ? "0" : "";
    }
    processHands(now / 1000);
    updateHud(dt);

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const solver = new ManipulationSolver({
  settings: {
    mode: "select",
    moveSensitivity: settings.object.moveSensitivity,
    rotateSensitivity: settings.object.rotateSensitivity,
    scaleSensitivity: settings.object.scaleSensitivity,
    zSensitivity: settings.object.depthSensitivity,
    // Match the stage bounds used when the result is written to the object, so
    // a drag stops at the visible edge instead of saturating early.
    limits: STAGE_BOUNDS
  },
  onModeChange: mode => {
    state.gestureMode = mode;
    updateGestureLabels(overlayHands.map(hand => hand.state), { mode });
  }
});

/**
 * The rectangle the camera image is displayed in. In workspace mode that is the
 * viewport itself; in preview mode it is the small card. This is the box the
 * landmark mapping must use, and it must match the CSS exactly.
 */
function cameraDisplayBox() {
  const el = state.cameraView === "workspace" ? dom.workspaceVideo : dom.cameraVideo;
  const rect = el?.getBoundingClientRect?.();
  if (!rect || !rect.width) {
    const vp = dom.viewport.getBoundingClientRect();
    return { width: vp.width, height: vp.height, left: 0, top: 0 };
  }
  const host = dom.viewport.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    // Offsets relative to the viewport, so a preview card in a corner maps to
    // the same place in the viewport it visually occupies.
    left: rect.left - host.left,
    top: rect.top - host.top
  };
}

function videoSize() {
  const video = dom.workspaceVideo?.videoWidth ? dom.workspaceVideo : dom.cameraVideo;
  return {
    videoWidth: video?.videoWidth || 0,
    videoHeight: video?.videoHeight || 0
  };
}

/** Map a landmark to viewport NDC using the exact display box + mirror. */
function landmarkNdc(landmark) {
  const video = videoSize();
  const box = cameraDisplayBox();
  const viewRect = dom.viewport.getBoundingClientRect();
  return landmarkToNdc(
    landmark,
    { ...video, boxWidth: box.width, boxHeight: box.height },
    { width: viewRect.width, height: viewRect.height },
    { mirror: settings.camera.mirror !== false }
  );
}

/** Map a landmark to pixels within the viewport (for the reticle). */
function landmarkViewportPixels(landmark) {
  const video = videoSize();
  const box = cameraDisplayBox();
  const stage = landmarkToStage(
    landmark,
    { ...video, boxWidth: box.width, boxHeight: box.height },
    { mirror: settings.camera.mirror !== false }
  );
  return { x: stage.x + box.left, y: stage.y + box.top, inside: stage.inside };
}

/**
 * Intents that genuinely transform something.
 *
 * "point", "hover", "hold", "none", "release" and "tracking-lost" are all
 * non-destructive: the object is not being moved, so the idle animation should
 * keep running.
 */
const MANIPULATING_INTENTS = new Set([
  "translate",
  "rotate",
  "scale",
  "explode",
  "frame",
  "two-hand grab",
  "scale + rotate + translate"
]);

function processHands(now) {
  // Nothing is being manipulated when there is no pipeline at all. Returning
  // early used to leave the playground's "a hand is acting" flag stuck on from
  // the last frame that had hands, which silently froze every idle animation.
  if (!tracker || !workspace) {
    playground?.setManipulating?.(false);
    return;
  }

  const hands = tracker.hands || [];
  const handedness = tracker.handedness || [];
  const activeStates = [];

  overlayHands.length = 0;
  overlayPinched.length = 0;

  hands.forEach((landmarks, index) => {
    const side = handedness[index] || "Unknown";
    let analyzer = analyzers.get(side);
    if (!analyzer) {
      analyzer = new HandAnalyzer(analyzerSettings());
      analyzers.set(side, analyzer);
    }
    const handState = analyzer.update(landmarks, side, now);
    activeStates.push(handState);
    overlayHands.push({ state: handState, side, landmarks });
    overlayPinched.push(handState.pinched);
  });

  if (hands.length === 0) {
    for (const analyzer of analyzers.values()) analyzer.reset();
  }

  // ---- draw both overlays ---------------------------------------------------
  const activity = activeStates.map(hand => (hand.pinched ? 1 : 0.15));
  const targets = activeStates.map(() => state.pointerTarget);

  const tethers = activeStates.map(hand =>
    hand.pinched ? projectedTarget(hand) : null
  );

  // ---- scene-space skeletons ------------------------------------------------
  // The 3D hands are the primary representation; the 2D overlay is kept for the
  // corner preview card and as a fallback when WebGL is unavailable.
  if (skeleton3d) {
    // The video is object-fit: cover, so hand the rigs the same crop rectangle
    // the 2D overlay uses; otherwise the scene skeletons drift off the real
    // hands whenever the stage aspect ratio differs from the camera's.
    const video = videoSize();
    const box = cameraDisplayBox();
    const fit = video.videoWidth && box.width
      ? {
          ...coverFit(video.videoWidth, video.videoHeight, box.width, box.height),
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          boxWidth: box.width,
          boxHeight: box.height
        }
      : null;

    skeleton3d.update(
      hands,
      tracker.worldLandmarks || [],
      handedness,
      {
        pinched: overlayPinched,
        activity,
        fit,
        dt: state.frameDelta ?? 1 / 60,
        // Monotonic seconds for the per-joint filters, so smoothing is
        // time-based rather than assuming a fixed frame rate.
        now: now / 1000
      }
    );
  }

  // Depth cues for the 2D overlay, so both layers agree about which hand is
  // nearer the camera.
  const depths = hands.map(landmarks => {
    if (!landmarks?.length) return null;
    const z = landmarks.reduce((sum, point) => sum + (point.z || 0), 0) / landmarks.length;
    return Math.max(0, Math.min(1, 0.5 - z * 4));
  });

  overlay?.draw(hands, handedness, {
    pinched: overlayPinched, activity, targets, depths
  });
  drawWorkspaceOverlay(hands, handedness, activeStates, activity, targets, tethers);

  // ---- run the solver -------------------------------------------------------
  // A pinch in MOVE/ROTATE grabs what you are pointing at. Promote whatever the
  // reticle resolves to the selection on gesture start so the gesture has a
  // target. Playground objects and engineering components take different
  // selection paths: without the prop branch, a pinch over a spawned cube did
  // nothing at all and the gesture fell through to the assembly.
  const pinching = activeStates.some(hand => hand?.pinched);

  // A short latch on grab and a soft lift on release. This is the audio half of
  // the gesture feedback, ported from main, and it is what makes a pinch feel
  // like it landed rather than merely registering.
  if (pinching && !state.wasPinching) chimes().play("grab");
  else if (!pinching && state.wasPinching) chimes().play("release");
  state.wasPinching = pinching;
  if ((state.mode === "move" || state.mode === "rotate") && state.pointerTarget && pinching) {
    if (state.pointerKind === "prop") {
      if (playground?.selectedId !== state.pointerTarget) {
        selectProp(state.pointerTarget, "hand");
      }
    } else if (state.pointerTarget !== state.partId && !state.gestureTarget) {
      workspace.select(state.pointerTarget);
      handleSelect(state.pointerTarget, "hand");
      state.gestureTarget = state.pointerTarget;
    }
  }
  if (!pinching) state.gestureTarget = null;

  // In a real mode the transform applies to the selected component when there
  // is one; EXPLODE and SCALE always act on the assembly.
  const part = getGesturePart();
  const objectState = gestureObjectState(part);

  const result = solver.update(activeStates, objectState, now);
  state.gestureMode = result.mode;
  state.intent = result.intent;

  // Tell the playground whether a hand is actively *transforming* something, so
  // its idle spin can stand down. Only real transforms count: the solver also
  // reports `active` for hover ("point") and for the SCALE mode's arm-up hold,
  // neither of which is touching the object. Treating those as manipulation
  // left the idle spin permanently frozen.
  playground?.setManipulating?.(MANIPULATING_INTENTS.has(result.intent));

  applyGestureResult(result, part);

  // ---- pointer, hover and selection ----------------------------------------
  // Prefer the hand the solver actually used. The reticle and the object must
  // be driven by the same hand, or a pinch can be drawn on one hand while the
  // other one moves the object.
  const pointer = pickPointer(activeStates, result.activeHand);
  updatePointer(pointer, activeStates, result);

  updateGestureLabels(activeStates, result);
}

/**
 * Settings handed to each per-hand analyzer.
 *
 * Referenced by the tracking loop and the settings panel but never defined, so
 * the first frame with a hand threw and took the whole pipeline with it.
 */
function analyzerSettings() {
  return {
    pinchThreshold: settings.gesture.pinchThreshold,
    pinchRelease: settings.gesture.pinchRelease,
    smoothing: settings.gesture.smoothing
  };
}

/**
 * Choose which hand drives the reticle and manipulation.
 *
 * Both hands used to be reduced to `states[0]` implicitly, which is whatever
 * order MediaPipe happened to return. Prefer a pinching hand (you are actively
 * manipulating), then a fully visible one, then the first tracked hand.
 */
function pickPointer(states, activeHand = null) {
  if (!Array.isArray(states) || !states.length) return null;

  // The solver's choice wins outright. It has already applied the pinch and
  // lock rules, so re-deriving a preference here could only disagree with it.
  if (activeHand?.hand && states.includes(activeHand.hand)) {
    const hand = activeHand.hand;
    const tip = hand.landmarks?.[8] || hand.indexTip || hand.pinch || null;
    return { hand: { ...hand, indexTip: tip, pinched: Boolean(hand.pinched) }, state: hand };
  }

  let best = null;
  let bestScore = -Infinity;
  for (const hand of states) {
    if (!hand) continue;
    let score = 0;
    if (hand.pinched) score += 10;
    // A hand with a complete landmark set is likelier to be in frame.
    const points = hand.landmarks?.length || 0;
    score += Math.min(points, 21) / 21;
    if (hand.present === false) score -= 5;
    if (score > bestScore) {
      bestScore = score;
      best = hand;
    }
  }

  if (!best) return null;
  const tip = best.landmarks?.[8] || best.indexTip || best.pinch || null;
  return {
    hand: { ...best, indexTip: tip, pinched: Boolean(best.pinched) },
    state: best
  };
}

/**
 * Report which engineering component the hand is hovering.
 *
 * Called from updatePointer() but never defined. Hover is a purely visual
 * affordance, so this stays cheap and never touches selection.
 */
function hoverFromHand(hand, partId) {
  if (!workspace || !partId) return;
  if (state.hoverId === partId) return;
  state.hoverId = partId;
  workspace.setHover?.(partId);
}

/**
 * Report the live gesture for each tracked hand.
 *
 * This is called from the tracking loop and from the solver's mode-change
 * callback. It used to be referenced but never defined, which threw
 * `ReferenceError: updateGestureLabels is not defined` on the first tracked
 * frame and killed the rest of processHands() — including depth cues and the
 * solver — so the stage looked frozen the moment a hand appeared.
 */
function updateGestureLabels(states, result) {
  const hands = Array.isArray(states) ? states.filter(Boolean) : [];
  const primary = hands[0] || null;
  state.activePinches = hands.map(hand => Boolean(hand.pinched));

  const gesture = !hands.length
    ? null
    : primary.pinched
      ? (result?.intent && result.intent !== "none" ? result.intent : "grab")
      : primary.gesture || primary.pose || "tracking";

  state.gestureName = gesture;

  if (dom.hudGesture) {
    const label = gesture ? String(gesture).toUpperCase() : "—";
    if (dom.hudGesture.textContent !== label) dom.hudGesture.textContent = label;
  }

  // The instruction strip keeps the mode's guidance, but the target chip also
  // reports an active grab so the user can see the pinch was recognised.
  if (dom.modeInstructionTarget && gesture === "translate") {
    dom.modeInstructionTarget.textContent = "GRABBED";
  }

  if (dom.viewport) {
    dom.viewport.classList.toggle("is-gesturing", Boolean(gesture));
    dom.viewport.classList.toggle("is-pinching", hands.some(hand => hand.pinched));
  }
}

/** The component a gesture should transform, or null for the whole assembly. */
function getGesturePart() {
  if (!state.partId || !workspace) return null;
  const transform = workspace.getPartTransform(state.partId);
  if (!transform) return null;
  return { partId: state.partId, ...transform };
}

/**
 * The transform the solver should treat as "current" for this frame.
 *
 * The solver captures its reference frame from this state, so it must describe
 * the thing actually being grabbed. Seeding it from the assembly while a
 * playground object is selected made the object jump by the assembly's offset
 * the instant the pinch closed — this is the fix for that.
 */
function gestureObjectState(part) {
  const objectState = {
    position: { x: 0, y: 0, z: 0 },
    rotationZ: 0,
    rotationX: 0,
    scale: 1,
    explode: workspace?.explodeAmount ?? 0
  };

  const selected = playground?.get?.();
  const grabbed = selected ? playground.getTransform(selected.id) : null;

  if (grabbed) {
    objectState.position = { ...grabbed.position };
    // The playground yaws around Y; the solver reports yaw in rotationZ.
    objectState.rotationZ = grabbed.rotationY;
    objectState.rotationX = grabbed.rotationX;
    objectState.scale = grabbed.scale;
    return objectState;
  }

  if (part && state.mode !== "explode") {
    objectState.position = { ...part.offset };
    objectState.rotationZ = part.rotationZ;
    objectState.rotationX = part.rotationX;
    objectState.scale = part.scale;
    return objectState;
  }

  const t = workspace?.transform;
  if (t) {
    objectState.position = { x: t.position.x, y: t.position.y, z: t.position.z };
    objectState.rotationZ = t.rotationZ;
    objectState.rotationX = t.rotationX;
    objectState.scale = t.scale;
  }
  return objectState;
}

/**
 * Apply a solver result.
 *
 * The solver is mode-gated, so `result.intent` is the single kind of change it
 * is allowed to request. This function refuses anything else — that refusal is
 * what stops a SCALE gesture from also translating.
 */
function applyGestureResult(result, part) {
  if (!result?.active) return;

  // A grabbed playground object owns the gesture. The solver produces the same
  // intents either way, so the only difference is where the transform lands.
  const prop = playground?.get?.();
  if (prop && (result.intent === "translate" || result.intent === "rotate" || result.intent === "scale")) {
    applyGestureToProp(result, prop);
    return;
  }

  switch (result.intent) {
    case "translate": {
      if (!result.position) return;
      if (part) {
        // result.position is already absolute: the solver starts from the
        // part's current offset, so the depth must not be added again.
        workspace.setPartTransform(part.partId, {
          offset: {
            x: result.position.x,
            y: result.position.y,
            z: result.position.z
          }
        });
      } else {
        workspace.setTransform({ position: result.position });
      }
      break;
    }
    case "rotate": {
      if (part) {
        workspace.setPartTransform(part.partId, {
          rotationZ: result.rotationZ,
          rotationX: result.rotationX
        });
      } else {
        workspace.setTransform({ rotationZ: result.rotationZ, rotationX: result.rotationX });
      }
      break;
    }
    case "scale": {
      // Scale always applies to the assembly, even with a component selected:
      // a part scaled in isolation reads as a rendering bug, not a resize.
      if (typeof result.scale === "number") workspace.setTransform({ scale: result.scale });
      break;
    }
    case "explode": {
      if (typeof result.explode === "number") setExplodeAmount(result.explode * 100);
      break;
    }
    case "select": {
      handleHandSelect();
      break;
    }
    default:
      break;
  }
}

/**
 * Apply a solver result to a playground object.
 *
 * The solver already captured a reference frame, so `position`, `rotationZ` and
 * `scale` are absolute values derived from where the grab started — the object
 * never jumps to the fingertip.
 */
function applyGestureToProp(result, prop) {
  if (result.intent === "translate" && result.position) {
    playground.setTransform(prop.id, {
      position: {
        x: clamp(result.position.x, -STAGE_BOUNDS.x, STAGE_BOUNDS.x),
        y: clamp(result.position.y, -STAGE_BOUNDS.y, STAGE_BOUNDS.y),
        z: clamp(result.position.z, -STAGE_BOUNDS.z, STAGE_BOUNDS.z)
      }
    });
    playground.highlight(prop.id);
    return;
  }

  if (result.intent === "rotate") {
    // The solver reports yaw in rotationZ and pitch in rotationX for a flat
    // target; for a 3D prop, yaw reads most naturally around Y.
    playground.setTransform(prop.id, {
      rotationY: result.rotationZ,
      rotationX: result.rotationX
    });
    playground.highlight(prop.id);
    return;
  }

  if (result.intent === "scale" && typeof result.scale === "number") {
    playground.setTransform(prop.id, { scale: result.scale });
    playground.highlight(prop.id);
  }
}

/** Confirm whatever is under the pointer as the selection. */
function handleHandSelect() {
  if (!state.pointerTarget) return;
  if (state.pointerKind === "prop") {
    if (playground?.selectedId === state.pointerTarget) {
      flash(dom.inspectorRoot, "flash");
      return;
    }
    selectProp(state.pointerTarget, "hand");
    flash(dom.inspectorRoot, "flash");
    return;
  }
  if (state.partId === state.pointerTarget) {
    flash(dom.inspectorRoot, "flash");
    return;
  }
  workspace.select(state.pointerTarget);
  handleSelect(state.pointerTarget, "hand");
  flash(dom.inspectorRoot, "flash");
  toast(`Selected ${inspector?.lastComponent?.name || state.pointerTarget}`, "accent", 1700);
}

/** Draw the landmark skeleton onto the full-workspace overlay. */
function drawWorkspaceOverlay(hands, handedness, states, activity, targets, tethers) {
  if (!overlayWorkspace || state.cameraView !== "workspace") return;

  // The scene-space rigs are the primary skeleton. When they are live, the 2D
  // layer only adds the reticle, the pinch burst and the labels — otherwise
  // both layers draw the same bones and hands look doubled and smeared.
  const sceneSkeletons = Boolean(skeleton3d?.rigs?.size);

  overlayWorkspace.draw(hands, handedness, {
    pinched: states.map(hand => hand.pinched),
    activity,
    targets,
    tethers,
    sceneSkeletons
  });
}

/**
 * Where the current gesture target projects into the overlay canvas.
 *
 * Returns null when there is nothing to link to (whole-assembly moves have no
 * single point, so no tether is drawn for them).
 */
function projectedTarget() {
  if (!workspace || !state.partId) return null;
  if (state.mode === "explode" || state.mode === "scale") return null;
  const projected = workspace.projectPart(state.partId);
  if (!projected || !projected.visible) return null;

  // projectPart returns viewport pixels; the overlay canvas is inset:0 over the
  // viewport, so those coordinates are already in its space.
  return { x: projected.x, y: projected.y };
}

/** Place the reticle and resolve what it is pointing at. */
function updatePointer(pointer, states, result) {
  if (!pointer || state.cameraView !== "workspace") {
    if (pointer && state.cameraView === "preview") {
      // Keep the reticle usable with the preview card too.
    } else {
      dom.reticle.hidden = true;
      if (state.pointerTarget) {
        state.pointerTarget = null;
        workspace.setHover(null);
      }
      return;
    }
  }

  const tip = pointer.hand.indexTip;
  const pixels = landmarkViewportPixels(tip);
  const viewRect = dom.viewport.getBoundingClientRect();

  if (!pixels.inside) {
    dom.reticle.hidden = true;
    return;
  }

  dom.reticle.hidden = false;
  dom.reticle.style.left = `${clamp(pixels.x, 0, viewRect.width)}px`;
  dom.reticle.style.top = `${clamp(pixels.y, 0, viewRect.height)}px`;

  const ndc = landmarkNdc(tip);

  // Playground objects take priority over engineering components: if the user
  // spawned or imported something, they expect to be able to grab it.
  const propHit = playground
    ? playground.pick({ x: ndc.x, y: ndc.y }, workspace.camera)
    : null;

  const hit = propHit || workspace.raycast({ x: ndc.x, y: ndc.y });

  // Hover highlight follows the pointer, but never while dragging.
  const dragging = result?.intent === "translate" || result?.intent === "rotate";
  if (!dragging) {
    if (hit !== state.pointerTarget) {
      state.pointerTarget = hit;
      state.pointerKind = propHit ? "prop" : hit ? "part" : null;
      if (!propHit) workspace.setHover(hit);
      if (hit) hoverFromHand(pointer.hand, hit);
      playground?.highlight(propHit);
    }
  }

  // Always resolve the *hovered* part's own name — inspector.lastComponent
  // belongs to the current selection and would mislabel a different part.
  const propName = propHit ? playground?.byId.get(propHit)?.name : null;
  const label = propHit
    ? propName || propHit
    : hit
      ? (getComponentData(state.modelId, hit)?.name || hit)
      : "";
  dom.reticle.classList.toggle("is-over", Boolean(hit));
  dom.reticle.classList.toggle("is-active", Boolean(pointer.hand.pinched));
  if (dom.reticleLabel) {
    dom.reticleLabel.textContent = pointer.hand.pinched && hit ? `GRAB · ${label}` : label;
  }
  updateModeTargetLabel();
}

/* ------------------------------------------------------------------------- */
/* HUD                                                                       */
/* ------------------------------------------------------------------------- */

let fpsSamples = [];
let hudTimer = 0;

function updateHud(dt) {
  // Render FPS, smoothed over a rolling third of a second.
  fpsSamples.push(dt);
  if (fpsSamples.length > 30) fpsSamples.shift();
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  const fps = avg > 0 ? Math.round(1 / avg) : 0;

  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    dom.hudFps.textContent = String(fps);
    const stats = workspace?.getStats();
    if (stats) dom.hudTris.textContent = formatCompact(stats.triangles);

    const t = workspace?.transform;
    if (t) {
      dom.readoutPos.textContent =
        `${t.position.x.toFixed(2)}, ${t.position.y.toFixed(2)}, ${t.position.z.toFixed(2)}`;
      dom.readoutRot.textContent = `${((t.rotationZ * 180) / Math.PI).toFixed(0)}°`;
      dom.readoutScale.textContent = `${t.scale.toFixed(2)}×`;
    }

    updateDiagnostics();

    updateObjectHud();

    const tracking = tracker?.getState();

    // Hand count was looked up (dom.hudHands) but never written anywhere, so the
    // HUD showed a permanent 0 even with both hands in frame. Read it from the
    // tracker's live state instead.
    if (dom.hudHands) {
      const count = tracking?.hands ?? tracking?.handCount ?? 0;
      dom.hudHands.textContent = String(count);
    }

    dom.statusTracking.textContent = tracking?.fps
      ? `${tracking.fps} FPS · ${Number(tracking.inferenceMs || 0).toFixed(0)}MS`
      : tracking?.status === "error"
        ? "ERROR"
        : "—";
  }
}

/* ------------------------------------------------------------------------- */
/* PLAYGROUND (multi-object scene)                                           */
/* ------------------------------------------------------------------------- */

/**
 * Add one primitive to the playground and refresh everything that reflects the
 * object list. Shared by the library tiles, the toolbar and voice commands.
 */
function addPlaygroundPrimitive(kind) {
  const scene3d = setupPlayground();
  if (!scene3d) return null;
  const prop = scene3d.addPrimitive(kind);
  if (!prop) return null;
  chimes().play("spawn");
  refreshSceneOutliner();
  updateObjectHud();
  return prop;
}

/**
 * The playground lives beside the engineering assemblies rather than replacing
 * them: the selected model is still a first-class object, and anything spawned
 * or imported here becomes an additional manipulable object in the same scene.
 */
function setupPlayground() {
  if (playground || !workspace?.scene) return playground;

  playground = new Playground({
    scene: workspace.scene,
    onSelect: id => {
      state.playgroundId = id;
      updateObjectHud();
    },
    onChange: () => {
      updateObjectHud();
      refreshSceneOutliner();
    }
  });

  dom.stageAddObject?.addEventListener("click", () => {
    const prop = playground.addPrimitive(nextPrimitive());
    toast(`Added ${prop.name}`, "", 1600);
  });
  dom.stageDuplicate?.addEventListener("click", () => {
    const prop = playground.duplicate();
    toast(prop ? `Duplicated to ${prop.name}` : "Nothing selected to duplicate",
      prop ? "" : "error", 1600);
  });
  dom.stageDelete?.addEventListener("click", () => {
    const removed = playground.remove();
    toast(removed ? "Object deleted" : "Nothing selected to delete",
      removed ? "" : "error", 1600);
  });
  dom.stageReset?.addEventListener("click", resetEnvironment);

  return playground;
}

/** Cycle through the primitive kinds so repeated clicks build a varied scene. */
let primitiveCursor = 0;
function nextPrimitive() {
  const kind = PRIMITIVES[primitiveCursor % PRIMITIVES.length].id;
  primitiveCursor++;
  return kind;
}

/** "Reset the environment": clear props, reset the model, re-frame the camera. */
function resetEnvironment() {
  playground?.clear();
  primitiveCursor = 0;
  if (workspace) {
    workspace.resetView();
  }
  setMode("select");
  refreshSceneOutliner();
  updateObjectHud();
  toast("Environment reset", "", 1800);
}

function updateObjectHud() {
  const count = playground?.props.length || 0;
  if (dom.hudObjects) dom.hudObjects.textContent = String(count);
  const selected = playground?.get();
  if (dom.hudObjectName) {
    dom.hudObjectName.textContent = selected ? selected.name.toUpperCase() : "—";
  }
}

/** Rebuild the right-drawer object list. */
function refreshSceneOutliner() {
  const list = document.getElementById("scene-outliner");
  if (!list || !playground) return;
  list.replaceChildren();

  const items = [];
  if (workspace?.assembly) {
    items.push({ id: "__model__", name: workspace.modelId, kind: "model" });
  }
  for (const prop of playground.props) {
    items.push({ id: prop.id, name: prop.name, kind: prop.kind, clips: prop.clipNames });
  }

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "outliner-empty";
    empty.textContent = "No objects yet. Add a primitive or import a model.";
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "outliner-row";
    row.dataset.id = item.id;
    const isSelected =
      item.id === "__model__"
        ? !playground.selectedId
        : item.id === playground.selectedId;
    if (isSelected) row.classList.add("is-selected");

    const label = document.createElement("span");
    label.className = "outliner-name";
    label.textContent = item.name;
    row.appendChild(label);

    const meta = document.createElement("span");
    meta.className = "outliner-meta";
    meta.textContent = item.kind === "model" ? "MODEL" : item.kind.toUpperCase();
    row.appendChild(meta);

    row.addEventListener("click", () => {
      if (item.id === "__model__") {
        playground.select(null);
        workspace.select(state.partId);
      } else {
        playground.select(item.id);
        workspace.clearSelection();
      }
      refreshSceneOutliner();
    });
    list.appendChild(row);

    // Animation clip picker for imported GLTF models.
    if (item.clips?.length > 1) {
      const clips = document.createElement("div");
      clips.className = "outliner-clips";
      item.clips.forEach((name, index) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = name;
        chip.addEventListener("click", event => {
          event.stopPropagation();
          playground.setClip(item.id, index);
        });
        clips.appendChild(chip);
      });
      list.appendChild(clips);
    }
  }
}

/* ------------------------------------------------------------------------- */
/* VOICE                                                                     */
/* ------------------------------------------------------------------------- */

function setupVoice() {
  if (voice) return voice;
  voice = new VoiceControl({
    onCommand: (intent, phrase) => {
      handleVoiceIntent(intent, phrase);
    },
    onState: voxState => {
      updateVoiceUi(voxState);
    }
  });

  dom.stageVoice?.addEventListener("click", () => {
    if (!voice.supported) {
      toast("This browser has no speech engine. Try Chrome or Edge.", "error", 6000);
      return;
    }
    voice.toggle();
  });

  updateVoiceUi({
    status: voice.status,
    supported: voice.supported,
    listening: false,
    error: voice.error
  });
  return voice;
}

function updateVoiceUi(voxState) {
  const button = dom.stageVoice;
  if (button) {
    button.classList.toggle("is-on", voxState.status === VOICE_STATUS.LISTENING);
    button.setAttribute("aria-pressed", String(voxState.status === VOICE_STATUS.LISTENING));
    button.title = voxState.error
      ? voxState.error
      : voxState.status === VOICE_STATUS.LISTENING
        ? "Listening — click to stop"
        : "Voice commands (or press V)";
  }
  if (dom.voiceState) {
    dom.voiceState.textContent =
      voxState.status === VOICE_STATUS.LISTENING ? "LISTENING"
      : voxState.status === VOICE_STATUS.HEARD ? `“${voxState.phrase || ""}”`
      : voxState.status === VOICE_STATUS.UNSUPPORTED ? "UNAVAILABLE"
      : voxState.status === VOICE_STATUS.ERROR ? "ERROR"
      : "OFF";
  }
  if (dom.voicePhrase && voxState.phrase) {
    dom.voicePhrase.textContent = voxState.phrase;
  }
  dom.voiceChip?.classList.toggle("is-listening", voxState.status === VOICE_STATUS.LISTENING);
}

/** Map a parsed intent onto an action. Voice and hands share the same state. */
function handleVoiceIntent(intent, phrase) {
  const [group, value] = String(intent).split(":");

  switch (group) {
    case "mode":
      if (isMode(value)) { setMode(value); toast(`Mode: ${value.toUpperCase()}`, "", 1400); }
      return;

    case "add": {
      const prop = playground?.addPrimitive(value);
      if (prop) { toast(`Added ${prop.name}`, "", 1600); refreshSceneOutliner(); }
      return;
    }

    case "select": {
      const props = playground?.props || [];
      const match = props.find(prop => prop.primitive === value);
      if (match) {
        selectProp(match.id, "voice");
        toast(`Selected ${match.name}`, "accent", 1400);
      } else {
        toast(`No ${value} in the scene — say "add ${value}" first`, "warn", 2400);
      }
      return;
    }

    case "object":
      if (value === "duplicate") { playground?.duplicate(); refreshSceneOutliner(); }
      if (value === "delete") { playground?.remove(); refreshSceneOutliner(); }
      if (value === "clear") { playground?.clear(); refreshSceneOutliner(); }
      if (value === "next" || value === "prev") cyclePropSelection(value === "next" ? 1 : -1);
      return;

    case "transform":
      if (value === "assemble") setExplodeAmount(0);
      applyVoiceTransform(value);
      return;

    case "anim": {
      const prop = playground?.get();
      if (!prop?.actions?.length) { toast("No animation on the selected object", "error", 2000); return; }
      if (value === "play") {
        const action = prop.actions[prop.activeClip];
        if (action) action.paused = false;
      }
      if (value === "pause") {
        const action = prop.actions[prop.activeClip];
        if (action) action.paused = true;
      }
      if (value === "next") playground.setClip(prop.id, (prop.activeClip + 1) % prop.actions.length);
      return;
    }

    case "model":
      switchModel(value);
      return;

    case "color": {
      const hex = COLOR_PALETTE[value];
      if (!hex) return;
      const prop = playground?.get?.();
      const partId = state.partId;
      if (prop) {
        playground.setColor(prop.id, hex);
      } else if (partId) {
        workspace?.setPartMaterial?.(partId, { color: hex });
      } else if (workspace) {
        // Nothing selected: recolour the whole assembly, as `main` did.
        for (const part of workspace.parts) {
          workspace.setPartMaterial?.(part.partId ?? part.userData?.partId, { color: hex });
        }
      }
      inspector?.updateProperties?.();
      toast(`Colour: ${value.toUpperCase()}`, "accent", 1600);
      return;
    }

    case "material": {
      const prop = playground?.get?.();
      if (value === "wireframe" || value === "solid") {
        const target = value === "wireframe";
        const next = workspace?.toggleWireframe?.(state.partId || null);
        if (prop) playground.setWireframe(prop.id, target);
        toast(`Wireframe ${(next ?? target) ? "ON" : "OFF"}`, "accent", 1600);
      }
      if (value === "rough" || value === "metal") {
        const options = value === "rough"
          ? { roughness: 0.95, metalness: 0.05 }
          : { roughness: 0.15, metalness: 0.95 };
        if (prop) playground.setMaterial(prop.id, options);
        else if (state.partId) workspace?.setPartMaterial?.(state.partId, options);
        toast(value === "rough" ? "Matte finish" : "Metallic finish", "accent", 1600);
      }
      inspector?.updateProperties?.();
      return;
    }

    case "view":
      if (value === "grid") store.update("view", { grid: !settings.view.grid });
      if (value === "shadows") store.update("view", { shadows: !settings.view.shadows });
      if (value === "orbit") store.update("view", { autoRotate: !settings.view.autoRotate });
      if (value === "isolate") toggleIsolate();
      if (value === "focus") workspace?.focusSelected();
      if (value === "deselect") { playground?.select(null); workspace?.clearSelection(); }
      if (value === "panels") {
        setPanelState({ left: !settings.ui.leftOpen, right: !settings.ui.rightOpen });
      }
      if (value === "fullscreen") toggleFullscreen();
      return;

    case "explode": {
      const amount = Number(String(phrase).match(/(\d{1,3})\s*(?:percent|%)?/)?.[1] ?? 0);
      setExplodeAmount(amount);
      toast(`Explode ${amount}%`, "accent", 1600);
      return;
    }

    case "env":
      if (value === "reset") resetEnvironment();
      if (value === "help") showVoiceHelp();
      if (value === "cameraOn" && tracker && !isTrackerLive()) toggleCamera();
      if (value === "cameraOff" && isTrackerLive()) toggleCamera();
      return;

    default:
      void phrase;
  }
}

/** Step the playground selection, so voice and keyboard can both cycle. */
function cyclePropSelection(direction) {
  const props = playground?.props || [];
  if (!props.length) {
    toast("Nothing to select yet", "warn", 1600);
    return null;
  }
  const current = props.findIndex(prop => prop.id === playground.selectedId);
  const next = ((current < 0 ? 0 : current + direction) + props.length) % props.length;
  const prop = props[next];
  selectProp(prop.id, "voice");
  toast(`Selected ${prop.name}`, "accent", 1200);
  return prop;
}

function applyVoiceTransform(direction) {
  const prop = playground?.get();
  if (!prop) {
    // No playground object selected: nudge the engineering assembly instead.
    if (!workspace) return;
    if (direction === "scaleUp") workspace.nudge("scaleUp");
    if (direction === "scaleDown") workspace.nudge("scaleDown");
    if (direction === "reset") workspace.resetView();
    return;
  }
  const t = playground.getTransform(prop.id);
  const step = 0.4;
  const next = { position: { ...t.position } };
  if (direction === "up") next.position.y += step;
  if (direction === "down") next.position.y -= step;
  if (direction === "left") next.position.x -= step;
  if (direction === "right") next.position.x += step;
  if (direction === "forward") next.position.z -= step;
  if (direction === "back") next.position.z += step;
  if (direction === "scaleUp") next.scale = Math.min(4, t.scale * 1.25);
  if (direction === "scaleDown") next.scale = Math.max(0.25, t.scale / 1.25);
  if (direction === "reset") {
    next.position = { x: 0, y: 0.2, z: 0 };
    next.scale = 1;
    next.rotationY = 0;
  }
  playground.setTransform(prop.id, next);
}

function showVoiceHelp() {
  const examples = ["add cube", "move mode", "duplicate", "bigger", "reset everything", "help"];
  toast(`Try: ${examples.join(" · ")}`, "", 7000);
}

/* ------------------------------------------------------------------------- */
/* RENDER DIAGNOSTICS                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Count real WebGL errors raised during the session. This installs a listener
 * on the renderer's own canvas context, so it reports what the driver actually
 * logged rather than a guess.
 */
let glErrorCount = 0;
function installGlErrorWatch(ws) {
  const canvas = ws?.renderer?.domElement;
  if (!canvas) return;
  canvas.addEventListener("webglcontextcreationerror", () => { glErrorCount++; });
  canvas.addEventListener("webglcontextlost", () => { glErrorCount++; });
}

function setDiagValue(node, value, ok) {
  if (!node) return;
  node.textContent = value;
  node.classList.toggle("is-bad", ok === false);
}

/**
 * Push live values into the diagnostic panel. Called from the HUD tick, so the
 * numbers are sampled from the running app — there is no hardcoded success.
 */
function updateDiagnostics() {
  const panel = dom.diagnostics;
  if (!panel) return;

  // No renderer (WebGL unavailable, or the Workspace constructor threw): report
  // that explicitly. An empty panel would be indistinguishable from a panel
  // whose values are simply stale, and this must never look like success.
  const d = workspace?.diagnostics?.();
  const problems = [];

  if (!d) {
    setDiagValue(dom.diagModel, "renderer unavailable", false);
    setDiagValue(dom.diagMeshes, "—", false);
    setDiagValue(dom.diagVisible, "—", false);
    setDiagValue(dom.diagTris, "—", false);
    setDiagValue(dom.diagBounds, "—", false);
    setDiagValue(dom.diagCamdist, "—", false);
    setDiagValue(dom.diagAttached, "no", false);
    setDiagValue(dom.diagInFrustum, "no", false);
    setDiagValue(dom.diagLoop, "stopped", false);
    setDiagValue(dom.diagErrors, String(glErrorCount), glErrorCount === 0);
    panel.dataset.ok = "false";
    panel.dataset.open = state.diagnosticsOpen ? "true" : "false";
    dom.diagToggle?.setAttribute("aria-expanded", state.diagnosticsOpen ? "true" : "false");
    return;
  }

  const modelOk = d.loaded;
  setDiagValue(dom.diagModel, d.loaded ? `${d.model} · loaded` : "not loaded", modelOk);
  if (!modelOk) problems.push("model");

  setDiagValue(dom.diagMeshes, String(d.meshes), d.meshes > 0);
  setDiagValue(dom.diagVisible, String(d.visibleMeshes), d.visibleMeshes > 0);
  if (d.visibleMeshes === 0) problems.push("visible");

  setDiagValue(dom.diagTris, formatCompact(d.triangles), d.triangles > 0);
  if (d.triangles === 0) problems.push("triangles");

  setDiagValue(
    dom.diagBounds,
    d.bounds
      ? `${d.bounds.x.toFixed(1)} × ${d.bounds.y.toFixed(1)} × ${d.bounds.z.toFixed(1)}`
      : "—",
    Boolean(d.bounds)
  );

  setDiagValue(
    dom.diagCamdist,
    Number.isFinite(d.cameraDistance) ? d.cameraDistance.toFixed(1) : "—",
    Number.isFinite(d.cameraDistance)
  );

  setDiagValue(dom.diagAttached, d.attached ? "yes" : "no", d.attached);
  if (!d.attached) problems.push("attached");

  setDiagValue(dom.diagInFrustum, d.inFrustum ? "yes" : "no", d.inFrustum);
  if (!d.inFrustum) problems.push("frustum");

  setDiagValue(dom.diagLoop, d.loopRunning ? "running" : "stopped", d.loopRunning);
  if (!d.loopRunning) problems.push("loop");

  setDiagValue(dom.diagErrors, String(glErrorCount), glErrorCount === 0);
  if (glErrorCount > 0) problems.push("gl");

  panel.dataset.ok = problems.length === 0 ? "true" : "false";
  panel.dataset.open = state.diagnosticsOpen ? "true" : "false";
  dom.diagToggle?.setAttribute("aria-expanded", state.diagnosticsOpen ? "true" : "false");
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

/* ------------------------------------------------------------------------- */
/* ASSISTANT                                                                 */
/* ------------------------------------------------------------------------- */

function setupAssistant() {
  assistant = createAssistant({
    getContext: () => ({
      modelId: state.modelId,
      partId: state.partId
    })
  });
  refreshSuggestions();
  updateAssistantContext();
}

function setupAssistantChrome() {
  $$(".right-tab").forEach(tab => {
    tab.addEventListener("click", () => setRightTab(tab.dataset.tab));
  });

  dom.chatForm.addEventListener("submit", event => {
    event.preventDefault();
    const question = dom.chatInput.value.trim();
    if (!question) return;
    dom.chatInput.value = "";
    askAssistant(question);
  });
}

function setRightTab(tab, { mobileOpen = false } = {}) {
  state.rightTab = tab;
  store.update("ui", { rightTab: tab });

  for (const button of $$(".right-tab")) {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  dom.paneInspector.hidden = tab !== "inspector";
  dom.paneAssistant.hidden = tab !== "assistant";

  if (mobileOpen && window.innerWidth <= 820) {
    dom.workspace.classList.add("mobile-right");
  }
}

function updateAssistantContext() {
  if (!dom.assistantContext) return;
  if (!state.modelId) {
    dom.assistantContext.textContent = "Imported geometry — no engineering data available";
    return;
  }
  const model = getModelDefinition(state.modelId);
  const part = state.partId ? getComponentData(state.modelId, state.partId) : null;
  dom.assistantContext.replaceChildren();
  const label = document.createElement("span");
  label.textContent = "CONTEXT ";
  const value = document.createElement("b");
  value.textContent = part ? `${part.name} · ${model?.short}` : model?.name || "—";
  dom.assistantContext.append(label, value);
  refreshSuggestions();
}

function refreshSuggestions() {
  if (!dom.chatSuggestions || !assistant) return;
  dom.chatSuggestions.replaceChildren();
  for (const suggestion of assistant.suggestions()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip chip-action";
    button.textContent = suggestion;
    button.addEventListener("click", () => askAssistant(suggestion));
    dom.chatSuggestions.appendChild(button);
  }
}

let chatBusy = false;

async function askAssistant(question, { switchTab = false, lead } = {}) {
  if (!assistant || chatBusy) return;
  if (switchTab) setRightTab("assistant", { mobileOpen: true });
  dom.chatEmpty.hidden = true;

  appendMessage("user", lead || question);
  const pending = appendPending();
  chatBusy = true;

  // The local engine is synchronous, but the await keeps the interface
  // identical to a future network-backed provider.
  const started = performance.now();
  let reply;
  try {
    reply = await assistant.ask(question);
  } catch (error) {
    console.error("[HOLOCORE] assistant failed", error);
    reply = {
      text: "The knowledge engine hit an error answering that. Try rephrasing the question.",
      sources: [],
      followups: []
    };
  }
  const elapsed = performance.now() - started;

  // A tiny minimum delay makes the streaming-style reveal readable.
  const delay = Math.max(0, 240 - elapsed);
  window.setTimeout(() => {
    pending.remove();
    chatBusy = false;
    const node = appendMessage("assistant", reply.text, reply);
    node.querySelector(".msg-bubble")?.classList.add("reveal");

    if (reply.action) {
      applyAssistantAction(reply.action);
    }
  }, delay);
}

function applyAssistantAction(action) {
  if (!action) return;
  if (action.type === "select" && action.partId) {
    if (action.modelId && action.modelId !== state.modelId) {
      switchModel(action.modelId).then(() => {
        workspace.select(action.partId, { focus: true });
        handleSelect(action.partId, "assistant");
      });
      return;
    }
    workspace.select(action.partId, { focus: true });
    handleSelect(action.partId, "assistant");
    setRightTab("inspector");
  }
  if (action.type === "load-model" && action.modelId) {
    switchModel(action.modelId);
  }
}

function appendMessage(role, text, reply) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg msg-${role}`;

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  if (role === "assistant") bubble.innerHTML = renderMarkdown(text);
  else bubble.textContent = text;
  wrapper.appendChild(bubble);

  if (role === "assistant" && reply) {
    if (reply.sources?.length) {
      const meta = document.createElement("div");
      meta.className = "msg-meta";
      const label = document.createElement("span");
      label.textContent = "SOURCE";
      meta.appendChild(label);
      for (const source of reply.sources) {
        const chip = document.createElement("span");
        chip.className = "msg-source";
        chip.textContent = source.label;
        if (source.partId) {
          chip.addEventListener("click", () => {
            workspace.select(source.partId, { focus: true });
            handleSelect(source.partId, "assistant");
          });
        }
        meta.appendChild(chip);
      }
      wrapper.appendChild(meta);
    }

    if (reply.followups?.length) {
      const followups = document.createElement("div");
      followups.className = "msg-followups";
      for (const followup of reply.followups.slice(0, 3)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip chip-action";
        chip.textContent = followup;
        chip.addEventListener("click", () => askAssistant(followup));
        followups.appendChild(chip);
      }
      wrapper.appendChild(followups);
    }
  }

  dom.chatLog.appendChild(wrapper);
  dom.chatScroll.scrollTop = dom.chatScroll.scrollHeight;
  return wrapper;
}

function appendPending() {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg-assistant";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  const typing = document.createElement("span");
  typing.className = "typing";
  typing.innerHTML = "<i></i><i></i><i></i>";
  bubble.appendChild(typing);
  wrapper.appendChild(bubble);
  dom.chatLog.appendChild(wrapper);
  dom.chatScroll.scrollTop = dom.chatScroll.scrollHeight;
  return wrapper;
}

/* ------------------------------------------------------------------------- */
/* SETTINGS UI                                                              */
/* ------------------------------------------------------------------------- */

const BINDINGS = [
  ["set-preview", "camera", "previewVisible", "checkbox"],
  ["set-landmarks", "camera", "showLandmarks", "checkbox"],
  ["set-skeleton", "camera", "showSkeleton", "checkbox"],
  ["set-mirror", "camera", "mirror", "checkbox"],
  ["set-scrim", "camera", "scrim", "number", "val-scrim", 2],
  ["set-maxhands", "tracking", "maxHands", "number", "val-maxhands"],
  ["set-detection", "tracking", "minDetectionConfidence", "number", "val-detection", 2],
  ["set-tracking", "tracking", "minTrackingConfidence", "number", "val-tracking", 2],
  ["set-pinch", "gesture", "pinchThreshold", "number", "val-pinch", 2],
  ["set-release", "gesture", "pinchRelease", "number", "val-release", 2],
  ["set-smoothing", "gesture", "smoothing", "number", "val-smoothing", 2],
  ["set-inertia", "gesture", "inertia", "checkbox"],
  ["set-move", "object", "moveSensitivity", "number", "val-move", 1],
  ["set-rotate", "object", "rotateSensitivity", "number", "val-rotate", 1],
  ["set-scale", "object", "scaleSensitivity", "number", "val-scale", 1],
  ["set-depth", "object", "depthSensitivity", "number", "val-depth", 1],
  ["set-grid", "view", "grid", "checkbox"],
  ["set-shadows", "view", "shadows", "checkbox"],
  ["set-autorotate", "view", "autoRotate", "checkbox"],
  ["set-bloom", "view", "bloom", "checkbox"],
  ["set-quality", "view", "quality", "select"]
];

function setupSettingsUI() {
  for (const [id, section, key, kind, valueId, decimals] of BINDINGS) {
    const input = document.getElementById(id);
    if (!input) continue;

    // Initialise from stored settings.
    const value = settings[section][key];
    if (kind === "checkbox") input.checked = Boolean(value);
    else input.value = String(value);
    if (valueId) {
      const target = document.getElementById(valueId);
      if (target) target.textContent = formatValue(value, decimals);
    }

    const eventName = kind === "checkbox" ? "change" : "input";
    input.addEventListener(eventName, () => {
      let next;
      if (kind === "checkbox") next = input.checked;
      else if (kind === "number") next = Number(input.value);
      else next = input.value;

      if (key === "pinchThreshold" && next <= settings.gesture.pinchRelease + 0.02) {
        // Keep the release threshold strictly below the grab threshold, and
        // reflect the adjustment in the other slider immediately.
        store.update("gesture", { pinchRelease: Math.max(0.15, next - 0.05) });
        syncSettingInputs();
      }

      store.update(section, { [key]: next });
      if (valueId) {
        const target = document.getElementById(valueId);
        if (target) target.textContent = formatValue(next, decimals);
      }
    });
  }

  const workspaceViewInput = document.getElementById("set-workspace-view");
  if (workspaceViewInput) {
    workspaceViewInput.checked = settings.camera.workspaceView !== false;
    workspaceViewInput.addEventListener("change", () => {
      setCameraView(workspaceViewInput.checked ? "workspace" : "preview");
    });
  }

  // Voice and audio preferences, ported from main's settings panel.
  const voiceEnabledInput = document.getElementById("set-voice-enabled");
  if (voiceEnabledInput) {
    voiceEnabledInput.checked = settings.voice?.enabled !== false;
    voiceEnabledInput.addEventListener("change", () => {
      store.update("voice", { enabled: voiceEnabledInput.checked });
      if (!voiceEnabledInput.checked && voice?.isListening) voice.stop();
      toast(`Voice commands ${voiceEnabledInput.checked ? "enabled" : "disabled"}`, "", 1800);
    });
  }

  const soundEffectsInput = document.getElementById("set-sound-effects");
  if (soundEffectsInput) {
    soundEffectsInput.checked = settings.voice?.soundEffects !== false;
    soundEffectsInput.addEventListener("change", () => {
      store.update("voice", { soundEffects: soundEffectsInput.checked });
      chimes().enabled = soundEffectsInput.checked;
      if (soundEffectsInput.checked) chimes().play("command");
      toast(`Audio cues ${soundEffectsInput.checked ? "enabled" : "muted"}`, "", 1800);
    });
  }

  document.getElementById("refresh-devices")?.addEventListener("click", refreshCameraList);
  document.getElementById("calibrate-btn")?.addEventListener("click", calibrate);
  document.getElementById("reset-settings-btn")?.addEventListener("click", () => {
    store.reset();
    toast("Settings reset to defaults", "accent", 2600);
  });

  refreshCameraList();
  syncSettingInputs();

  store.subscribe((section, keys) => {
    settings = store.get();
    applySettings({ section, keys });
  });
}

/**
 * Push the stored settings into the drawer controls. Used once at boot so the
 * UI always reflects what the app is actually doing.
 */
function syncSettingInputs() {
  for (const [id, section, key, kind, valueId, decimals] of BINDINGS) {
    const input = document.getElementById(id);
    if (!input) continue;
    const value = settings[section][key];
    if (kind === "checkbox") input.checked = Boolean(value);
    else input.value = String(value);
    if (valueId) {
      const label = document.getElementById(valueId);
      if (label) label.textContent = formatValue(value, decimals);
    }
  }
}

function formatValue(value, decimals) {
  if (typeof value === "number") {
    return decimals !== undefined ? value.toFixed(decimals) : String(value);
  }
  return String(value);
}

async function refreshCameraList() {
  const select = document.getElementById("set-camera-device");
  if (!select) return;
  const devices = await HandTracker.listCameras();
  const current = settings.camera.deviceId;

  select.replaceChildren();
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Default camera";
  select.appendChild(def);

  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label;
    select.appendChild(option);
  }
  select.value = current || "";
}

/* ------------------------------------------------------------------------- */
/* SETTINGS → BEHAVIOUR                                                     */
/* ------------------------------------------------------------------------- */

let settingsAppliedOnce = false;

function applySettings({ section, keys } = {}) {
  settings = store.get();
  const all = section === "all";
  const changed = key => all || !keys || keys.includes(key);

  if (!workspace) return;

  // ---- Voice & audio cues ----
  // Ported from main: both are user-controllable and persisted.
  if (all || section === "voice") {
    chimes().enabled = settings.voice?.soundEffects !== false;
    if (settings.voice?.enabled === false && voice?.isListening) voice.stop();
  }

  // ---- View ----
  if (all || section === "view" || section === "all") {
    workspace.updateSettings({
      shadows: settings.view.shadows,
      autoRotate: settings.view.autoRotate,
      grid: settings.view.grid
    });
    dom.toolGrid.classList.toggle("is-on", settings.view.grid);
    dom.toolShadows.classList.toggle("is-on", settings.view.shadows);
    dom.toolRotate.classList.toggle("is-on", settings.view.autoRotate);

    if (all || section === "view") {
      applyBloom(settings.view.bloom);
      applyQuality(settings.view.quality);
    }
  }

  // ---- Camera ----
  if (all || section === "camera") {
    const card = dom.cameraCard;
    if (settings.camera.previewVisible) {
      // Restore the card to whatever the camera is actually doing.
      dom.cameraRestore.hidden = true;
      card.hidden = false;
      card.dataset.state = isTrackerLive() ? "live" : "off";
    } else if (isTrackerLive()) {
      // Keep a compact strip so tracking status stays visible.
      card.hidden = false;
      card.dataset.state = "hidden";
      dom.cameraRestore.hidden = true;
    } else {
      card.hidden = true;
      dom.cameraRestore.hidden = false;
    }

    ensureWorkspaceOverlay();
    overlayWorkspace?.updateSettings(settings.camera);
    dom.cameraStage.classList.toggle("no-landmarks", !settings.camera.showLandmarks);
    dom.cameraVideo.classList.toggle("unmirrored", !settings.camera.mirror);
    overlay?.updateSettings(settings.camera);
  }

  // ---- Tracking model ----
  if ((all || section === "tracking") && tracker) {
    tracker.updateSettings({
      maxHands: settings.tracking.maxHands,
      minDetectionConfidence: settings.tracking.minDetectionConfidence,
      minTrackingConfidence: settings.tracking.minTrackingConfidence,
      minPresenceConfidence: Math.min(0.6, settings.tracking.minTrackingConfidence)
    });
  }

  // ---- Gestures ----
  if (all || section === "gesture") {
    for (const analyzer of analyzers.values()) analyzer.updateSettings(analyzerSettings());
    solver.updateSettings({
      moveSensitivity: settings.object.moveSensitivity,
      rotateSensitivity: settings.object.rotateSensitivity,
      scaleSensitivity: settings.object.scaleSensitivity,
      zSensitivity: settings.object.depthSensitivity
    });
  }

  // ---- Object response ----
  if (all || section === "object") {
    solver.updateSettings({
      moveSensitivity: settings.object.moveSensitivity,
      rotateSensitivity: settings.object.rotateSensitivity,
      scaleSensitivity: settings.object.scaleSensitivity,
      zSensitivity: settings.object.depthSensitivity
    });
  }

  if (!settingsAppliedOnce && all) {
    settingsAppliedOnce = true;
    setRightTab(settings.ui.rightTab || "inspector");
    setPanelState(
      { left: settings.ui.leftOpen, right: settings.ui.rightOpen },
      { persist: false }
    );
  }

  void changed;
}

function isTrackerLive() {
  if (!tracker) return false;
  return [
    TRACKER_STATUS.ACTIVE,
    TRACKER_STATUS.HANDS,
    TRACKER_STATUS.LOST
  ].includes(tracker.status);
}

async function applyBloom(enabled) {
  if (!workspace) return;
  if (enabled && settings.view.quality !== "performance") {
    await workspace.enableBloom({ strength: 0.34, radius: 0.62, threshold: 0.85 });
  } else {
    workspace.disableBloom();
  }
}

function applyQuality(quality) {
  if (!workspace) return;
  const ratio =
    quality === "performance" ? 1 : quality === "quality" ? 2 : 1.5;
  workspace.renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
  workspace.resize();
}

/* ------------------------------------------------------------------------- */
/* CALIBRATION                                                              */
/* ------------------------------------------------------------------------- */

function calibrate() {
  for (const analyzer of analyzers.values()) analyzer.reset();
  solver.reset();
  overlayHands.length = 0;
  overlayPinched.length = 0;
  hoverLock = null;

  if (workspace) {
    workspace.setHover(null);
    workspace.resetTransform({ animated: true });
  }
  if (tracker) tracker.resetTracking();

  const log = document.getElementById("calibration-log");
  if (log) {
    const now = new Date();
    log.textContent =
      `Calibrated ${now.toLocaleTimeString()} · filters reset · grab released · ` +
      `object re-centred · thresholds ${settings.gesture.pinchThreshold.toFixed(2)}/` +
      `${settings.gesture.pinchRelease.toFixed(2)}`;
  }
  toast("Gesture engine calibrated — filters reset, object re-centred", "accent", 3200);
}

/* ------------------------------------------------------------------------- */
/* DRAWER / MODAL / PANELS                                                  */
/* ------------------------------------------------------------------------- */

function setupDrawer() {
  const openSettings = () => {
    dom.settingsDrawer.classList.add("open");
    dom.settingsDrawer.setAttribute("aria-hidden", "false");
    dom.drawerBackdrop.hidden = false;
    refreshCameraList();
  };
  const closeSettings = () => {
    dom.settingsDrawer.classList.remove("open");
    dom.settingsDrawer.setAttribute("aria-hidden", "true");
    dom.drawerBackdrop.hidden = true;
  };

  $("#open-settings")?.addEventListener("click", openSettings);
  $("#close-settings")?.addEventListener("click", closeSettings);
  dom.drawerBackdrop?.addEventListener("click", closeSettings);

  const openHelp = () => {
    dom.helpModal.hidden = false;
    dom.helpBackdrop.hidden = false;
  };
  const closeHelp = () => {
    dom.helpModal.hidden = true;
    dom.helpBackdrop.hidden = true;
  };
  $("#open-help")?.addEventListener("click", openHelp);
  $("#close-help")?.addEventListener("click", closeHelp);
  dom.helpBackdrop?.addEventListener("click", closeHelp);

  $("#fullscreen-toggle")?.addEventListener("click", toggleFullscreen);

  dom.drawerToggleLeft?.addEventListener("click", () => setPanelState({ left: true }));
  dom.drawerToggleRight?.addEventListener("click", () => setPanelState({ right: true }));

  for (const button of $$("[data-collapse]")) {
    button.addEventListener("click", () => {
      const side = button.dataset.collapse;
      if (side === "left") setPanelState({ left: false });
      else if (side === "right") setPanelState({ right: false });
      else togglePanels();
    });
  }

  // On narrow screens the panels are drawers opened by the top-bar button.
  $("#layout-toggle")?.addEventListener("click", () => {
    if (window.innerWidth <= 820) {
      const openLeft = !dom.workspace.classList.contains("mobile-left");
      dom.workspace.classList.remove("mobile-left", "mobile-right");
      if (openLeft) {
        dom.workspace.classList.add("mobile-left");
      } else {
        dom.workspace.classList.add("mobile-right");
      }
    }
  });

  dom.cameraDeviceSelect = document.getElementById("set-camera-device");
  dom.cameraDeviceSelect?.addEventListener("change", async event => {
    const deviceId = event.target.value;
    store.update("camera", { deviceId });
    if (isTrackerLive()) {
      await tracker.switchCamera(deviceId || null);
      toast("Camera switched", "", 2200);
    }
  });

  document.getElementById("set-quality")?.addEventListener("change", () => {
    // Bloom must be rebuilt when quality changes from performance.
    applyBloom(settings.view.bloom);
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(error => {
      toast(`Fullscreen unavailable: ${error.message}`, "warn", 3000);
    });
  } else {
    document.exitFullscreen?.();
  }
}

/**
 * Panel visibility is real state, persisted in settings, and shared by the
 * collapse buttons, the top-bar toggle and the mobile drawer behaviour.
 */
function setPanelState({ left, right }, { persist = true } = {}) {
  const nextLeft = left ?? settings.ui.leftOpen;
  const nextRight = right ?? settings.ui.rightOpen;

  dom.workspace.classList.toggle("hide-left", !nextLeft);
  dom.workspace.classList.toggle("hide-right", !nextRight);

  // A drawer that has slid off-screen must not stay in the tab order: focus
  // would land on controls nobody can see. `inert` is set purely as an
  // attribute so it behaves identically in every environment.
  for (const [panel, open] of [[dom.panelLeft, nextLeft], [dom.panelRight, nextRight]]) {
    if (!panel) continue;
    if (open) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
  }

  // Keep the corner toggles in sync so they are always independently
  // reopenable and correctly labelled for assistive tech.
  dom.drawerToggleLeft?.setAttribute("aria-expanded", String(nextLeft));
  dom.drawerToggleRight?.setAttribute("aria-expanded", String(nextRight));

  // On narrow layouts the panels are drawers; collapsing closes the drawer.
  if (window.innerWidth <= 820) {
    dom.workspace.classList.remove("mobile-left", "mobile-right");
  }

  if (persist) {
    store.update("ui", { leftOpen: nextLeft, rightOpen: nextRight });
  }

  const bothHidden = !nextLeft && !nextRight;
  dom.statusApp.textContent = bothHidden ? "FOCUS MODE" : "ONLINE";
  dom.statusApp.className = `status-val ${bothHidden ? "is-accent" : "status-ok"}`;

  // The viewport changed size: keep the camera aspect correct.
  requestAnimationFrame(() => workspace?.resize());
}

function togglePanels() {
  const anyOpen = settings.ui.leftOpen || settings.ui.rightOpen;
  setPanelState({ left: !anyOpen, right: !anyOpen });
}

/* ------------------------------------------------------------------------- */
/* KEYBOARD SHORTCUTS                                                       */
/* ------------------------------------------------------------------------- */

function setupShortcuts() {
  window.addEventListener("keydown", event => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");

    if (event.key === "Escape") {
      dom.helpModal.hidden = true;
      dom.helpBackdrop.hidden = true;
      dom.settingsDrawer.classList.remove("open");
      dom.settingsDrawer.setAttribute("aria-hidden", "true");
      dom.drawerBackdrop.hidden = true;
      return;
    }

    if (typing) return;

    const key = event.key.toLowerCase();
    switch (key) {
      case "1": case "2": case "3": case "4": case "5": {
        event.preventDefault();
        const mode = MODES[Number(key) - 1];
        if (mode) setMode(mode.id);
        break;
      }
      case "v":
        event.preventDefault();
        toggleCameraView();
        break;
      case "m":
        // Voice: M for microphone, leaving V for the camera view.
        event.preventDefault();
        dom.stageVoice?.click();
        break;
      case "n":
        event.preventDefault();
        dom.stageAddObject?.click();
        break;
      case "d":
        event.preventDefault();
        dom.stageDuplicate?.click();
        break;
      case "backspace":
      case "delete":
        if (playground?.selectedId) {
          event.preventDefault();
          dom.stageDelete?.click();
        }
        break;
      case "c":
        event.preventDefault();
        toggleCamera();
        break;
      case "l":
        // Toggle the library drawer, independently of the properties drawer.
        event.preventDefault();
        setPanelState({ left: !dom.workspace.classList.contains("hide-left") ? false : true });
        break;
      case "p":
        event.preventDefault();
        setPanelState({ right: !dom.workspace.classList.contains("hide-right") ? false : true });
        break;
      case "f":
        event.preventDefault();
        toggleFullscreen();
        break;
      case "s":
        event.preventDefault();
        $("#open-settings")?.click();
        break;
      case "a":
        event.preventDefault();
        setRightTab("assistant");
        dom.chatInput?.focus();
        break;
      case "?":
        event.preventDefault();
        $("#open-help")?.click();
        break;
      case "r":
        event.preventDefault();
        workspace?.resetView();
        workspace?.clearSelection();
        handleSelect(null, "ui");
        toast("View reset", "", 1400);
        break;
      case "e":
        event.preventDefault();
        dom.toolExplode.click();
        break;
      case "i":
        event.preventDefault();
        if (!dom.toolIsolate.disabled) toggleIsolate();
        break;
      case "g":
        event.preventDefault();
        dom.toolGrid.click();
        break;
      case "arrowleft":
        event.preventDefault();
        workspace?.nudge("left", 0.18);
        break;
      case "arrowright":
        event.preventDefault();
        workspace?.nudge("right", 0.18);
        break;
      case "arrowup":
        event.preventDefault();
        workspace?.nudge("up", 0.18);
        break;
      case "arrowdown":
        event.preventDefault();
        workspace?.nudge("down", 0.18);
        break;
      case "q":
        event.preventDefault();
        workspace?.nudge("forward", 0.2);
        break;
      case "w":
        event.preventDefault();
        workspace?.nudge("back", 0.2);
        break;
      case "z":
        event.preventDefault();
        workspace?.nudge("rollLeft", 0.16);
        break;
      case "x":
        event.preventDefault();
        workspace?.nudge("rollRight", 0.16);
        break;
      default:
        break;
    }
  });
}

/* ------------------------------------------------------------------------- */
/* START                                                                     */
/* ------------------------------------------------------------------------- */

// Everything except the renderer is wired immediately so the interface is
// usable even before (or without) a 3D context.
boot();

window.HOLOCORE = {
  get state() {
    return state;
  },
  get workspace() {
    return workspace;
  },
  get tracker() {
    return tracker;
  },
  get solver() {
    return solver;
  },
  get settings() {
    return settings;
  },
  /** The scene-space hand skeletons, or null before boot completes. */
  getHandSkeleton() {
    return skeleton3d;
  },
  /** The multi-object playground, or null before boot completes. */
  getPlayground() {
    return playground;
  },
  /** The voice command layer, or null before boot completes. */
  getVoice() {
    return voice;
  },
  /** The current interaction mode id. */
  getMode() {
    return state.mode;
  },
  getWorkspace() {
    return workspace;
  },
  /** Persisted settings, including the ported voice preferences. */
  getSettings() {
    return store.get();
  },
  /** The shared chime synth, so tests and the console can inspect it. */
  getChimes() {
    return chimes();
  },
  /** Exposed for the full-stack harness; also handy in the console. */
  handleVoiceIntentForTest: (intent, phrase) => handleVoiceIntent(intent, phrase),
  resetEnvironment,
  refreshSceneOutliner,
  switchModel,
  calibrate,
  toast,
  setMode,
  setExplodeAmount,
  setCameraView,
  syncWorkspaceVideo,
  // Deliberately exposed for automated verification (see tools/).
  _internals: {
    store, animator, analyzers, LM,
    gestureObjectState,
    applyGestureResult,
    // Resolve what the reticle is pointing at, so selection can be exercised
    // without a camera.
    pointerTargets: () => ({ target: state.pointerTarget, kind: state.pointerKind }),
    selectProp,
    updateGestureLabels,
    inspector,
    parseCommand,
    COLOR_PALETTE,
    updateVoiceUi,

    // Re-render the inspector so material controls match the current selection.
    // The playground reports its own selection, so re-selecting the same part
    // id is enough; the inspector prefers a selected prop over the part.
    refreshInspector: () => {
      inspector?.setModel?.(state.modelId);
      inspector?.select?.(state.partId);
    },
    // Drives the real per-frame hand pipeline with supplied landmarks, so the
    // tracking loop can be exercised without a camera.
    processHands
  }
};
