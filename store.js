/**
 * HOLOCORE — store.js
 * -----------------------------------------------------------------------------
 * Single source of truth for user settings, with localStorage persistence.
 * Every value here is wired to real behaviour in main.js — there are no
 * decorative settings.
 */
import {
  normaliseProfile,
  profileFromLegacySmoothing
} from "./trackingProfiles.js";


const KEY = "holocore.settings.v1";

export const DEFAULT_SETTINGS = {
  camera: {
    deviceId: "",
    previewVisible: true,
    showLandmarks: true,
    showSkeleton: true,
    mirror: true,
    /**
     * false = the camera stays a small preview card and the 3D model sits on
     * the normal dark workspace. true = the feed fills the workspace behind the
     * model. Defaults to false so a first visit shows the model immediately.
     */
    workspaceView: false,
    /**
     * How strongly the legibility wash dims the camera image, 0..1.
     * 0 = the feed is shown at full brightness, which is the point of camera
     * mode: you should see yourself clearly, not through a dark filter.
     */
    scrim: 0
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
    inertia: true,
    /**
     * Tracking smoothing profile. Replaces the old 0..1 "smoothing" slider,
     * which mapped its value onto the filter backwards. A saved numeric value
     * from an older version is migrated to the nearest profile on load.
     */
    trackingProfile: "balanced"
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
    /**
     * Bloom previously defaulted on with a 0.85 threshold, which turned the
     * lit assemblies into glowing white shapes -- especially over a bright
     * camera image, where there is no dark background to separate them from.
     * Off by default; still available in settings.
     */
    bloom: false,
    quality: "balanced"
  },
  ui: {
    leftOpen: false,
    rightOpen: false,
    rightTab: "inspector"
  },
  // Ported from the `main` branch: voice recognition and its audio cues are
  // user-controllable, and the preferences persist.
  voice: {
    enabled: true,
    soundEffects: true
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

/**
 * Bring a saved settings object up to date.
 *
 * Settings live in localStorage, so a user who has run an older build has an
 * object that predates any new key. `deepMerge` fills in new defaults, but it
 * cannot know that an old key has been REPLACED by a different one. That is what
 * this function is for, and it is deliberately a pure function so it can be
 * asserted directly with a synthetic old-settings object.
 *
 * Migration 1: `gesture.smoothing` (0..1 slider) -> `gesture.trackingProfile`.
 * The slider mapped its value onto the filter backwards, so its old values were
 * never meaningful; picking the nearest profile preserves the user's intent
 * (more or less smoothing) rather than replaying a broken mapping.
 */
export function migrateSettings(settings) {
  const gesture = settings?.gesture;
  if (!gesture) return settings;

  if (gesture.trackingProfile === undefined || gesture.trackingProfile === null) {
    gesture.trackingProfile = profileFromLegacySmoothing(gesture.smoothing);
  }
  // Any value that is not a known profile falls back rather than disabling
  // smoothing entirely, which an unknown string would otherwise do.
  gesture.trackingProfile = normaliseProfile(gesture.trackingProfile);
  return settings;
}

/* ------------------------------------------------------------------------- */
export class SettingsStore {
  constructor() {
    this.listeners = new Set();
    this.settings = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_SETTINGS);
      return migrateSettings(deepMerge(DEFAULT_SETTINGS, JSON.parse(raw)));
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
