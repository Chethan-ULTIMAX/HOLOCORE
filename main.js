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
import { MODES, getMode, isMode, instructionFor } from "./interactionModes.js";
import { landmarkToNdc, landmarkToStage } from "./handGeometry.js";
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
  buildCategoryRow();
  buildModelLibrary();
  checkSecureContext();

  // A settings/assistant shell exists even without a renderer.
  inspector = new ComponentInspector({
    root: dom.inspectorRoot,
    getWorkspace: () => workspace,
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

/** Settings that do not depend on the 3D renderer. */
function applyNonSceneSettings() {
  if (dom.workspaceOverlay) {
    overlayWorkspace = new HandOverlay({
      canvas: dom.workspaceOverlay,
      video: dom.workspaceVideo,
      settings: settings.camera
    });
  }

  dom.cameraStage.classList.toggle("no-landmarks", !settings.camera.showLandmarks);
  dom.cameraVideo.classList.toggle("unmirrored", !settings.camera.mirror);
  dom.workspaceVideo?.classList.toggle("unmirrored", !settings.camera.mirror);
  overlay?.updateSettings?.(settings.camera);
  overlayWorkspace?.updateSettings?.(settings.camera);
  dom.viewport?.style.setProperty("--scrim-strength", String(settings.camera.scrim ?? 0.4));
  const workspaceViewInput = document.getElementById("set-workspace-view");
  if (workspaceViewInput) workspaceViewInput.checked = settings.camera.workspaceView !== false;
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
  dom.fileInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!workspace) {
      toast("Importing needs the 3D renderer, which is unavailable.", "error", 5000);
      event.target.value = "";
      return;
    }

    dom.importNote.textContent = `Loading ${file.name}…`;
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

  if (dom.workspaceOverlay) {
    overlayWorkspace = new HandOverlay({
      canvas: dom.workspaceOverlay,
      video: dom.workspaceVideo,
      settings: settings.camera
    });
  }

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

    animator.update(dt);
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
    zSensitivity: settings.object.depthSensitivity
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

function processHands(now) {
  if (!tracker || !workspace) return;

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

  overlay?.draw(hands, handedness, { pinched: overlayPinched, activity, targets });
  drawWorkspaceOverlay(hands, handedness, activeStates, activity, targets, tethers);

  // ---- run the solver -------------------------------------------------------
  // A pinch in MOVE/ROTATE grabs what you are pointing at. Promote the hovered
  // component to the selection on gesture start so the gesture has a target.
  if ((state.mode === "move" || state.mode === "rotate") && state.pointerTarget &&
      state.pointerTarget !== state.partId && activeStates.some(hand => hand?.pinched) &&
      !state.gestureTarget) {
    workspace.select(state.pointerTarget);
    handleSelect(state.pointerTarget, "hand");
    state.gestureTarget = state.pointerTarget;
  }
  if (!activeStates.some(hand => hand?.pinched)) state.gestureTarget = null;

  const objectState = {
    position: { x: 0, y: 0, z: 0 },
    rotationZ: 0,
    rotationX: 0,
    scale: 1,
    explode: workspace.explodeAmount ?? 0
  };

  // In a real mode the transform applies to the selected component when there
  // is one; EXPLODE and SCALE always act on the assembly.
  const part = getGesturePart();
  if (part && state.mode !== "explode") {
    objectState.position = { ...part.offset };
    objectState.rotationZ = part.rotationZ;
    objectState.rotationX = part.rotationX;
    objectState.scale = part.scale;
  } else {
    const t = workspace.transform;
    objectState.position = { x: t.position.x, y: t.position.y, z: t.position.z };
    objectState.rotationZ = t.rotationZ;
    objectState.rotationX = t.rotationX;
    objectState.scale = t.scale;
  }

  const result = solver.update(activeStates, objectState, now);
  state.gestureMode = result.mode;
  state.intent = result.intent;

  applyGestureResult(result, part);

  // ---- pointer, hover and selection ----------------------------------------
  const pointer = pickPointer(activeStates);
  updatePointer(pointer, activeStates, result);

  updateGestureLabels(activeStates, result);
}

/** The component a gesture should transform, or null for the whole assembly. */
function getGesturePart() {
  if (!state.partId || !workspace) return null;
  const transform = workspace.getPartTransform(state.partId);
  if (!transform) return null;
  return { partId: state.partId, ...transform };
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

/** Confirm the component under the pointer as the selection. */
function handleHandSelect() {
  if (!state.pointerTarget) return;
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
  overlayWorkspace.draw(hands, handedness, {
    pinched: states.map(hand => hand.pinched),
    activity,
    targets,
    tethers
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
  const hit = workspace.raycast({ x: ndc.x, y: ndc.y });

  // Hover highlight follows the pointer, but never while dragging.
  const dragging = result?.intent === "translate" || result?.intent === "rotate";
  if (!dragging) {
    if (hit !== state.pointerTarget) {
      state.pointerTarget = hit;
      workspace.setHover(hit);
      if (hit) hoverFromHand(pointer.hand, hit);
    }
  }

  // Always resolve the *hovered* part's own name — inspector.lastComponent
  // belongs to the current selection and would mislabel a different part.
  const label = hit
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

    const tracking = tracker?.getState();
    dom.statusTracking.textContent = tracking?.fps
      ? `${tracking.fps} FPS · ${Number(tracking.inferenceMs || 0).toFixed(0)}MS`
      : "—";
  }
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

    if (dom.workspaceOverlay) {
    overlayWorkspace = new HandOverlay({
      canvas: dom.workspaceOverlay,
      video: dom.workspaceVideo,
      settings: settings.camera
    });
  }

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
      case "c":
        event.preventDefault();
        toggleCamera();
        break;
      case "l":
        event.preventDefault();
        togglePanels();
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
  switchModel,
  calibrate,
  toast,
  setMode,
  setExplodeAmount,
  setCameraView,
  syncWorkspaceVideo,
  // Deliberately exposed for automated verification (see tools/).
  _internals: { store, animator, analyzers, LM }
};
