/**
 * HOLOCORE — voiceControl.js
 * -----------------------------------------------------------------------------
 * Real-time voice command engine powered by the Web Speech API (SpeechRecognition).
 *
 * Provides hands-free interaction with the 3D workspace while gesturing:
 *   - Mode switching: "select", "move", "rotate", "scale", "explode", "assemble"
 *   - 3D playground objects: "add cube", "add sphere", "add cylinder", "add torus", "add cone", "delete"
 *   - Object styling: "color [red/blue/green/gold/cyan/purple/white/dark]", "wireframe", "solid"
 *   - Environment: "reset view", "camera", "grid", "shadows", "auto rotate", "isolate", "focus"
 *   - Model loading: "load rocket", "load turbojet", "load engine", "load robot", etc.
 *
 * Includes low-latency synthesized audio feedback via Web Audio API.
 */

export const VOICE_STATUS = {
  UNSUPPORTED: "unsupported",
  IDLE: "idle",
  STARTING: "starting",
  LISTENING: "listening",
  PROCESSING: "processing",
  PAUSED: "paused",
  ERROR: "error"
};

export const COLOR_PALETTE = {
  red: "#ef4444",
  crimson: "#dc2626",
  blue: "#3b82f6",
  azure: "#0284c7",
  cyan: "#06b6d4",
  teal: "#14b8a6",
  green: "#22c55e",
  emerald: "#10b981",
  gold: "#eab308",
  yellow: "#facc15",
  orange: "#f97316",
  amber: "#f59e0b",
  purple: "#a855f7",
  violet: "#8b5cf6",
  pink: "#ec4899",
  rose: "#f43f5e",
  white: "#f8fafc",
  silver: "#cbd5e1",
  dark: "#1e293b",
  graphite: "#0f172a"
};

export class VoiceController {
  constructor({
    onStatus,
    onHeard,
    onCommand,
    onError,
    soundEnabled = true
  } = {}) {
    this.onStatus = onStatus || (() => {});
    this.onHeard = onHeard || (() => {});
    this.onCommand = onCommand || (() => {});
    this.onError = onError || (() => {});
    this.soundEnabled = soundEnabled;

    this.status = VOICE_STATUS.IDLE;
    this.recognition = null;
    this.isListening = false;
    this.lastTranscript = "";
    this._audioCtx = null;
    this._restartTimer = null;
    this._shouldBeListening = false;

    this._initRecognition();
  }

  /* ------------------------------------------------------------------------- */
  /* WEB AUDIO SYNTHESIZER                                                     */
  /* ------------------------------------------------------------------------- */

  _getAudioContext() {
    if (!this._audioCtx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          this._audioCtx = new AudioCtx();
        } catch {
          this._audioCtx = null;
        }
      }
    }
    if (this._audioCtx && this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    return this._audioCtx;
  }

  playChime(type = "command") {
    if (!this.soundEnabled) return;
    const ctx = this._getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "command") {
        // Futuristic two-tone confirmation
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === "listen") {
        // High-tech activation ping
        osc.type = "triangle";
        osc.frequency.setValueAtTime(740, now);
        osc.frequency.exponentialRampToValueAtTime(1108.73, now + 0.06);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.07, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === "spawn") {
        // Geometric chord / chime
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.06);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.16);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.36);
      } else if (type === "grab") {
        // Mechanical latch click
        osc.type = "square";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.04);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
      } else if (type === "release") {
        // Soft snap release
        osc.type = "triangle";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(480, now + 0.03);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.045);
      } else if (type === "error") {
        // Subtle warning tone
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.setValueAtTime(210, now + 0.09);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      }
    } catch {
      // Audio autoplay policies or closed context
    }
  }

  /* ------------------------------------------------------------------------- */
  /* RECOGNITION SETUP                                                         */
  /* ------------------------------------------------------------------------- */

  _initRecognition() {
    if (typeof window === "undefined") {
      this._setStatus(VOICE_STATUS.UNSUPPORTED);
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      this._setStatus(VOICE_STATUS.UNSUPPORTED);
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.isListening = true;
        this._setStatus(VOICE_STATUS.LISTENING);
        this.playChime("listen");
      };

      recognition.onresult = event => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const text = res[0]?.transcript || "";
          if (res.isFinal) final += text;
          else interim += text;
        }

        const raw = (final || interim).trim();
        if (!raw) return;

        this.lastTranscript = raw;
        this.onHeard(raw, Boolean(final));

        if (final) {
          const cmd = this.parseCommand(final);
          if (cmd) {
            this.playChime("command");
            this.onCommand(cmd);
          }
        }
      };

      recognition.onerror = event => {
        const error = event.error;
        if (error === "no-speech") {
          // Normal silence, keep listening
          return;
        }
        if (error === "not-allowed" || error === "service-not-allowed") {
          this._shouldBeListening = false;
          this.isListening = false;
          this._setStatus(VOICE_STATUS.ERROR, "Microphone permission denied.");
          this.onError(new Error("Microphone permission was denied."));
          return;
        }
        this.onError(new Error(`Voice error: ${error}`));
      };

      recognition.onend = () => {
        this.isListening = false;
        if (this._shouldBeListening) {
          // Auto-reconnect so voice control remains seamless
          clearTimeout(this._restartTimer);
          this._restartTimer = setTimeout(() => {
            if (this._shouldBeListening && !this.isListening) {
              try {
                this.recognition.start();
              } catch {
                // Already started or busy
              }
            }
          }, 350);
        } else {
          this._setStatus(VOICE_STATUS.IDLE);
        }
      };

      this.recognition = recognition;
      this._setStatus(VOICE_STATUS.IDLE);
    } catch (err) {
      this._setStatus(VOICE_STATUS.ERROR, err.message);
    }
  }

  _setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.onStatus(status, error);
  }

  /* ------------------------------------------------------------------------- */
  /* PUBLIC CONTROL                                                            */
  /* ------------------------------------------------------------------------- */

  get isSupported() {
    return this.status !== VOICE_STATUS.UNSUPPORTED && Boolean(this.recognition);
  }

  start() {
    if (!this.isSupported) {
      this._setStatus(VOICE_STATUS.UNSUPPORTED);
      return false;
    }
    this._shouldBeListening = true;
    try {
      this.recognition.start();
      return true;
    } catch {
      // If already started
      this.isListening = true;
      this._setStatus(VOICE_STATUS.LISTENING);
      return true;
    }
  }

  stop() {
    this._shouldBeListening = false;
    clearTimeout(this._restartTimer);
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }
    this.isListening = false;
    this._setStatus(VOICE_STATUS.IDLE);
  }

  toggle() {
    if (this.isListening || this._shouldBeListening) {
      this.stop();
      return false;
    }
    return this.start();
  }

  /* ------------------------------------------------------------------------- */
  /* COMMAND PARSER                                                            */
  /* ------------------------------------------------------------------------- */

  parseCommand(rawText) {
    if (!rawText) return null;
    const text = rawText.toLowerCase().trim().replace(/[.,!?;:]/g, "");

    // 1. Interaction Modes
    if (/\b(select|pick|point)\b/.test(text)) {
      return { type: "mode", mode: "select", label: "SELECT mode", raw: rawText };
    }
    if (/\b(move|drag|translate|shift)\b/.test(text)) {
      return { type: "mode", mode: "move", label: "MOVE mode", raw: rawText };
    }
    if (/\b(rotate|spin|turn|yaw|pitch)\b/.test(text)) {
      return { type: "mode", mode: "rotate", label: "ROTATE mode", raw: rawText };
    }
    if (/\b(scale|resize|zoom)\b/.test(text)) {
      return { type: "mode", mode: "scale", label: "SCALE mode", raw: rawText };
    }
    if (/\b(explode|disassemble|separate|break down)\b/.test(text)) {
      // Check for specific percentage
      const percentMatch = text.match(/([0-9]{1,3})\s*(?:percent|%)/);
      if (percentMatch) {
        const val = Math.max(0, Math.min(100, parseInt(percentMatch[1], 10)));
        return { type: "explode-amount", amount: val / 100, label: `Explode ${val}%`, raw: rawText };
      }
      return { type: "mode", mode: "explode", label: "EXPLODE mode", raw: rawText };
    }
    if (/\b(assemble|collapse|put together|join|close)\b/.test(text)) {
      return { type: "explode-amount", amount: 0, label: "Assemble (0%)", raw: rawText };
    }

    // 2. 3D Playground Objects (Add Shapes)
    if (/\b(add|spawn|create|new|make)\s+(cube|box)\b/.test(text) || text === "cube" || text === "box") {
      return { type: "add-object", shape: "cube", label: "Add Cube", raw: rawText };
    }
    if (/\b(add|spawn|create|new|make)\s+(sphere|ball|globe)\b/.test(text) || text === "sphere") {
      return { type: "add-object", shape: "sphere", label: "Add Sphere", raw: rawText };
    }
    if (/\b(add|spawn|create|new|make)\s+(cylinder|can|tube)\b/.test(text) || text === "cylinder") {
      return { type: "add-object", shape: "cylinder", label: "Add Cylinder", raw: rawText };
    }
    if (/\b(add|spawn|create|new|make)\s+(torus|donut|ring)\b/.test(text) || text === "torus") {
      return { type: "add-object", shape: "torus", label: "Add Torus", raw: rawText };
    }
    if (/\b(add|spawn|create|new|make)\s+(cone)\b/.test(text) || text === "cone") {
      return { type: "add-object", shape: "cone", label: "Add Cone", raw: rawText };
    }
    if (/\b(add|spawn|create|new|make)\s+(pyramid)\b/.test(text) || text === "pyramid") {
      return { type: "add-object", shape: "pyramid", label: "Add Pyramid", raw: rawText };
    }
    if (/\b(clear objects|delete objects|remove all objects)\b/.test(text)) {
      return { type: "action", action: "clear-objects", label: "Clear Playground Objects", raw: rawText };
    }
    if (/\b(delete|remove)\b/.test(text)) {
      return { type: "action", action: "delete-selected", label: "Delete Selection", raw: rawText };
    }

    // 3. Materials & Color
    if (/\b(wireframe|wire frame)\b/.test(text)) {
      return { type: "action", action: "toggle-wireframe", label: "Toggle Wireframe", raw: rawText };
    }
    if (/\b(solid|shaded)\b/.test(text)) {
      return { type: "action", action: "solid", label: "Solid Surface", raw: rawText };
    }
    for (const [name, hex] of Object.entries(COLOR_PALETTE)) {
      if (new RegExp(`\\b(color|make|paint)\\s+${name}\\b`).test(text) || text === `color ${name}`) {
        return { type: "color", color: hex, name, label: `Color: ${name.toUpperCase()}`, raw: rawText };
      }
    }

    // 4. View & Environment
    if (/\b(reset|home|recenter|re-center)\b/.test(text)) {
      return { type: "action", action: "reset", label: "Reset View", raw: rawText };
    }
    if (/\b(camera|webcam)\b/.test(text)) {
      return { type: "action", action: "toggle-camera", label: "Toggle Camera", raw: rawText };
    }
    if (/\b(switch view|toggle view|full camera|preview view)\b/.test(text)) {
      return { type: "action", action: "toggle-camera-view", label: "Toggle Camera View", raw: rawText };
    }
    if (/\b(grid)\b/.test(text)) {
      return { type: "action", action: "toggle-grid", label: "Toggle Grid", raw: rawText };
    }
    if (/\b(shadow|shadows)\b/.test(text)) {
      return { type: "action", action: "toggle-shadows", label: "Toggle Shadows", raw: rawText };
    }
    if (/\b(auto rotate|auto-rotate|orbit|spin assembly|stop orbit)\b/.test(text)) {
      return { type: "action", action: "toggle-orbit", label: "Toggle Auto-Orbit", raw: rawText };
    }
    if (/\b(isolate|solo)\b/.test(text)) {
      return { type: "action", action: "isolate", label: "Isolate Selection", raw: rawText };
    }
    if (/\b(focus|center on)\b/.test(text)) {
      return { type: "action", action: "focus", label: "Focus Selection", raw: rawText };
    }
    if (/\b(clear selection|deselect)\b/.test(text)) {
      return { type: "action", action: "clear-selection", label: "Clear Selection", raw: rawText };
    }
    if (/\b(panels|sidebars|toggle panels)\b/.test(text)) {
      return { type: "action", action: "toggle-panels", label: "Toggle Panels", raw: rawText };
    }
    if (/\b(fullscreen|full screen)\b/.test(text)) {
      return { type: "action", action: "toggle-fullscreen", label: "Toggle Fullscreen", raw: rawText };
    }

    // 5. Model Loading
    if (/\b(rocket|launch vehicle|astra)\b/.test(text)) {
      return { type: "model", modelId: "launchVehicle", label: "Load Launch Vehicle", raw: rawText };
    }
    if (/\b(turbojet|jet|turbine engine)\b/.test(text)) {
      return { type: "model", modelId: "turbojet", label: "Load Turbojet", raw: rawText };
    }
    if (/\b(engine|inline|automotive)\b/.test(text)) {
      return { type: "model", modelId: "inlineEngine", label: "Load Inline Engine", raw: rawText };
    }
    if (/\b(gear|gears|gear train)\b/.test(text)) {
      return { type: "model", modelId: "gearTrain", label: "Load Gear Train", raw: rawText };
    }
    if (/\b(robot|robot arm|industrial robot)\b/.test(text)) {
      return { type: "model", modelId: "robotArm", label: "Load Robot Arm", raw: rawText };
    }
    if (/\b(pcb|circuit|circuit board)\b/.test(text)) {
      return { type: "model", modelId: "controlPCB", label: "Load Control PCB", raw: rawText };
    }
    if (/\b(cpu|processor|package)\b/.test(text)) {
      return { type: "model", modelId: "cpuPackage", label: "Load CPU Package", raw: rawText };
    }
    if (/\b(wind turbine|windmill)\b/.test(text)) {
      return { type: "model", modelId: "windTurbine", label: "Load Wind Turbine", raw: rawText };
    }

    return null;
  }
}
