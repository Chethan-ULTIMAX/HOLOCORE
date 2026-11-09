/**
 * HOLOCORE — store.js
 * -----------------------------------------------------------------------------
 * Single source of truth for user settings, with localStorage persistence.
 * Every value here is wired to real behaviour in main.js — there are no
 * decorative settings.
 */

const KEY = "holocore.settings.v1";

export const DEFAULT_SETTINGS = {
  camera: {
    deviceId: "",
    previewVisible: true,
    showLandmarks: true,
    showSkeleton: true,
    mirror: true
  },
  tracking: {
    maxHands: 2,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.5
  },
  gesture: {
    pinchThreshold: 0.62,
    pinchRelease: 0.44,
    smoothing: 0.45,
    inertia: true
  },
  object: {
    moveSensitivity: 1,
    rotateSensitivity: 1,
    scaleSensitivity: 1,
    depthSensitivity: 1
  },
  view: {
    grid: true,
    shadows: true,
    autoRotate: false,
    bloom: true,
    quality: "balanced"
  },
  ui: {
    leftOpen: true,
    rightOpen: true,
    rightTab: "inspector"
  }
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class SettingsStore {
  constructor() {
    this.listeners = new Set();
    this.settings = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_SETTINGS);
      return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  get() {
    return this.settings;
  }

  /**
   * Update settings by section, e.g. update("gesture", { smoothing: 0.7 }).
   * Returns the changed keys for that section.
   */
  update(section, patch) {
    if (!this.settings[section]) this.settings[section] = {};
    const changed = [];
    for (const [key, value] of Object.entries(patch)) {
      if (this.settings[section][key] !== value) {
        this.settings[section][key] = value;
        changed.push(key);
      }
    }
    if (changed.length) {
      this._persist();
      this._emit(section, changed);
    }
    return changed;
  }

  reset() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this._persist();
    this._emit("all", Object.keys(DEFAULT_SETTINGS));
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(section, keys) {
    for (const fn of this.listeners) {
      try {
        fn(section, keys, this.settings);
      } catch (error) {
        console.error("[HOLOCORE] settings listener failed", error);
      }
    }
  }

  _persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* storage may be unavailable in private mode — settings still work in-session */
    }
  }
}

export { deepMerge };
