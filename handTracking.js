/**
 * HOLOCORE — handTracking.js
 * -----------------------------------------------------------------------------
 * Real webcam access and real hand landmark inference.
 *
 * Camera: navigator.mediaDevices.getUserMedia
 * Model:  MediaPipe Tasks Vision "HandLandmarker" (2 hands, video mode, GPU
 *         delegate with automatic CPU fallback), loaded from a local vendor
 *         copy with a CDN fallback.
 *
 * This module never fabricates landmarks. If the model is not running, the
 * tracker reports `hands: []` and a status string that says exactly what
 * happened.
 */

const LOCAL = {
  bundle: "./vendor/mediapipe/vision_bundle.mjs",
  wasm: "./vendor/mediapipe/wasm",
  model: "./vendor/mediapipe/hand_landmarker.task"
};

const CDN = {
  bundle: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs",
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  model:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
};

export const TRACKER_STATUS = {
  IDLE: "idle",
  REQUESTING: "requesting",
  STARTING: "starting",
  ACTIVE: "active",
  HANDS: "hands",
  LOST: "tracking-lost",
  ERROR: "error",
  STOPPED: "stopped"
};

export const STATUS_LABEL = {
  [TRACKER_STATUS.IDLE]: "Camera inactive",
  [TRACKER_STATUS.REQUESTING]: "Requesting permission",
  [TRACKER_STATUS.STARTING]: "Starting tracker",
  [TRACKER_STATUS.ACTIVE]: "Camera active",
  [TRACKER_STATUS.HANDS]: "Hands detected",
  [TRACKER_STATUS.LOST]: "Tracking lost",
  [TRACKER_STATUS.ERROR]: "Camera error",
  [TRACKER_STATUS.STOPPED]: "Camera off"
};

export class HandTracker {
  /**
   * @param {object} options
   * @param {HTMLVideoElement} options.video
   * @param {(state:object)=>void} [options.onState] fired on every state change
   * @param {(frame:object)=>void} [options.onFrame] fired per processed frame
   */
  constructor({ video, onState, onFrame, settings } = {}) {
    this.video = video;
    this.onState = onState || (() => {});
    this.onFrame = onFrame || (() => {});
    this.settings = {
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.5,
      minPresenceConfidence: 0.5,
      maxHands: 2,
      ...(settings || {})
    };

    this.status = TRACKER_STATUS.IDLE;
    this.error = null;
    this.stream = null;
    this.landmarker = null;
    this.delegate = null;
    this.devices = [];
    this.deviceId = null;

    this.hands = [];
    this.handedness = [];
    this.lastVideoTime = -1;
    this.frameCount = 0;
    this.droppedFrames = 0;
    this.fps = 0;
    this.inferenceMs = 0;
    this._fpsSamples = [];
    this._rafId = null;
    this._lastFrameAt = 0;
    this._startedAt = 0;
    this._lostSince = null;
    this._running = false;
    this._modelPromise = null;
  }

  /* --------------------------------------------------------------------- */
  /* STATUS                                                                */
  /* --------------------------------------------------------------------- */

  _setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.onState(this.getState());
  }

  getState() {
    return {
      status: this.status,
      label: STATUS_LABEL[this.status] || this.status,
      error: this.error,
      hands: this.hands.length,
      handedness: this.handedness.slice(),
      fps: this.fps,
      inferenceMs: this.inferenceMs,
      delegate: this.delegate,
      deviceId: this.deviceId,
      devices: this.devices.slice(),
      videoWidth: this.video?.videoWidth || 0,
      videoHeight: this.video?.videoHeight || 0,
      running: this._running
    };
  }

  /* --------------------------------------------------------------------- */
  /* CAMERA                                                                */
  /* --------------------------------------------------------------------- */

  static async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(device => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`
        }));
    } catch {
      return [];
    }
  }

  async start(options = {}) {
    if (this._running) return this.getState();

    if (!navigator.mediaDevices?.getUserMedia) {
      this._setStatus(
        TRACKER_STATUS.ERROR,
        "This browser does not expose a camera API. Use a modern browser over HTTPS or localhost."
      );
      return this.getState();
    }

    this._setStatus(TRACKER_STATUS.REQUESTING);

    const deviceId = options.deviceId ?? this.deviceId ?? null;
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const message = this._describeCameraError(error);
      this._setStatus(TRACKER_STATUS.ERROR, message);
      return this.getState();
    }

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;

    try {
      await this.video.play();
    } catch (error) {
      this._setStatus(TRACKER_STATUS.ERROR, `Could not start the video element: ${error.message}`);
      return this.getState();
    }

    const track = this.stream.getVideoTracks()[0];
    this.deviceId = track?.getSettings?.().deviceId || this.deviceId;
    this.devices = await HandTracker.listCameras();
    this._startedAt = performance.now();

    this._setStatus(TRACKER_STATUS.STARTING);

    try {
      await this._ensureLandmarker();
    } catch (error) {
      this._setStatus(TRACKER_STATUS.ERROR, `Hand model failed to load: ${error.message}`);
      return this.getState();
    }

    this._running = true;
    this._setStatus(TRACKER_STATUS.ACTIVE);
    this._loop();
    return this.getState();
  }

  _describeCameraError(error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return (
        "Camera permission was denied. Allow camera access in the browser's site settings " +
        "and try again. The camera API also requires HTTPS or localhost."
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "No usable camera was found for the requested device. Check that a webcam is connected.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "The camera is already in use by another application or tab.";
    }
    if (name === "AbortError") {
      return "The browser aborted the camera request. Try again.";
    }
    return error?.message || "Unknown camera error.";
  }

  /* --------------------------------------------------------------------- */
  /* MODEL                                                                 */
  /* --------------------------------------------------------------------- */

  async _ensureLandmarker() {
    if (this.landmarker) return this.landmarker;
    if (this._modelPromise) return this._modelPromise;

    this._modelPromise = (async () => {
      const load = async (paths) => {
        const vision = await import(paths.bundle);
        const fileset = await vision.FilesetResolver.forVisionTasks(paths.wasm);
        return vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: paths.model, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: this.settings.maxHands,
          minHandDetectionConfidence: this.settings.minDetectionConfidence,
          minHandPresenceConfidence: this.settings.minPresenceConfidence,
          minTrackingConfidence: this.settings.minTrackingConfidence
        });
      };

      // Try the bundled local copy first (works offline), then the CDN.
      const attempts = [
        { paths: LOCAL, label: "local" },
        { paths: CDN, label: "cdn" }
      ];

      let lastError = null;
      for (const attempt of attempts) {
        try {
          const landmarker = await load(attempt.paths);
          this.landmarker = landmarker;
          this.delegate = "GPU";
          return landmarker;
        } catch (error) {
          lastError = error;
          console.warn(`[HOLOCORE] Hand model (${attempt.label}) failed:`, error?.message || error);
        }
      }

      // Last resort: CPU delegate from the local copy.
      try {
        const vision = await import(LOCAL.bundle);
        const fileset = await vision.FilesetResolver.forVisionTasks(LOCAL.wasm);
        const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: LOCAL.model, delegate: "CPU" },
          runningMode: "VIDEO",
          numHands: this.settings.maxHands
        });
        this.landmarker = landmarker;
        this.delegate = "CPU";
        return landmarker;
      } catch (error) {
        lastError = error;
      }

      throw lastError || new Error("Hand landmarker unavailable");
    })();

    return this._modelPromise;
  }

  /* --------------------------------------------------------------------- */
  /* LOOP                                                                  */
  /* --------------------------------------------------------------------- */

  _loop = () => {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(this._loop);
    this._processFrame();
  };

  _processFrame() {
    const video = this.video;
    if (!video || video.readyState < 2 || !this.landmarker) return;
    if (video.currentTime === this.lastVideoTime) {
      this.droppedFrames++;
      return;
    }
    this.lastVideoTime = video.currentTime;

    const started = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, started);
    } catch (error) {
      this._setStatus(TRACKER_STATUS.ERROR, `Tracking error: ${error.message}`);
      return;
    }
    const finished = performance.now();
    this.inferenceMs = finished - started;

    this.frameCount++;

    // FPS from a sliding window of inference timestamps.
    this._fpsSamples.push(finished);
    while (this._fpsSamples.length > 2 && finished - this._fpsSamples[0] > 1000) {
      this._fpsSamples.shift();
    }
    const span = finished - this._fpsSamples[0];
    this.fps = span > 0 ? Math.round(((this._fpsSamples.length - 1) / span) * 1000) : 0;

    const landmarks = result?.landmarks || [];
    this.hands = landmarks;
    this.handedness = (result?.handednesses || []).map(entry => entry?.[0]?.categoryName || "Unknown");

    if (landmarks.length > 0) {
      this._lostSince = null;
      if (this.status !== TRACKER_STATUS.HANDS) this._setStatus(TRACKER_STATUS.HANDS);
    } else {
      if (!this._lostSince) this._lostSince = finished;
      const lostFor = finished - this._lostSince;
      // Only declare "tracking lost" after a short grace period, so a single
      // dropped frame does not flicker the UI.
      if (lostFor > 600 && this.status !== TRACKER_STATUS.LOST) {
        this._setStatus(TRACKER_STATUS.LOST);
      }
    }

    this.onFrame(this.getState());
  }

  /* --------------------------------------------------------------------- */
  /* CONTROL                                                               */
  /* --------------------------------------------------------------------- */

  /** Used by manual calibration: forget all tracking history. */
  resetTracking() {
    this.hands = [];
    this.handedness = [];
    this.lastVideoTime = -1;
    this._fpsSamples = [];
    this.fps = 0;
    this._lostSince = null;
    if (this._running) this._setStatus(TRACKER_STATUS.ACTIVE);
    return this.getState();
  }

  async switchCamera(deviceId) {
    if (deviceId === this.deviceId && this._running) return this.getState();
    const wasRunning = this._running;
    // Stop the old stream but keep the model (and its WASM heap) loaded.
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.hands = [];
    this.handedness = [];

    this.deviceId = deviceId;
    if (wasRunning) return this.start({ deviceId });
    this._setStatus(TRACKER_STATUS.STOPPED);
    return this.getState();
  }

  async updateSettings(settings = {}) {
    const needsRebuild =
      (settings.maxHands !== undefined && settings.maxHands !== this.settings.maxHands) ||
      (settings.minDetectionConfidence !== undefined &&
        settings.minDetectionConfidence !== this.settings.minDetectionConfidence) ||
      (settings.minTrackingConfidence !== undefined &&
        settings.minTrackingConfidence !== this.settings.minTrackingConfidence) ||
      (settings.minPresenceConfidence !== undefined &&
        settings.minPresenceConfidence !== this.settings.minPresenceConfidence);

    Object.assign(this.settings, settings);

    if (needsRebuild && this.landmarker) {
      // close() frees the WASM instance before rebuilding with new options.
      try { this.landmarker.close?.(); } catch { /* ignore */ }
      this.landmarker = null;
      this._modelPromise = null;
      if (this._running) {
        try { await this._ensureLandmarker(); } catch (error) {
          this._setStatus(TRACKER_STATUS.ERROR, error.message);
        }
      }
    }
  }

  stop({ silent = false } = {}) {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;

    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;

    this.hands = [];
    this.handedness = [];
    this.lastVideoTime = -1;
    this.fps = 0;
    this._fpsSamples = [];
    this._lostSince = null;

    if (!silent) this._setStatus(TRACKER_STATUS.STOPPED);
    return this.getState();
  }

  dispose() {
    this.stop({ silent: true });
    try { this.landmarker?.close?.(); } catch { /* ignore */ }
    this.landmarker = null;
    this._modelPromise = null;
  }
}
