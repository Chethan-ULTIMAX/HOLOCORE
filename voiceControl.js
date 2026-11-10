/**
 * HOLOCORE — voiceControl.js
 * -----------------------------------------------------------------------------
 * Real voice commands via the Web Speech API (`SpeechRecognition` /
 * `webkitSpeechRecognition`), with a written command grammar and a
 * no-speech-engine fallback that is honest about being unavailable.
 *
 * DESIGN NOTES
 *
 * - Speech recognition is *on-device in the browser* where supported (Chrome
 *   uses Google's service; that is the browser's decision, not ours). No API
 *   key, no paid service, no audio ever leaves the page through our code.
 * - Recognition runs continuously with interim results, so "grab" can fire the
 *   moment it is heard rather than waiting for the end of an utterance.
 * - Commands map to *intents*, and the caller decides what an intent means. The
 *   module therefore has no dependency on Three.js or the DOM.
 * - Every failure path reports a specific reason, because "voice doesn't work"
 *   is useless when the cause is an unsupported browser or a denied mic.
 */

/** Command grammar: each entry is [patterns, intent, example]. */
const COMMAND_TABLE = [
  // ---- modes -------------------------------------------------------------
  [/\b(select|selection|inspect)\s*(mode)?\b/, "mode:select", "select mode"],
  [/\b(move|translate|drag)\b(?!\s+(it|the object|this|that)?\s*(up|down|left|right|forward|back))\s*(mode)?\b/, "mode:move", "move mode"],
  [/\b(rotate|rotation|spin|turn)\s*(mode)?\b/, "mode:rotate", "rotate mode"],
  [/\b(scale|resize)\s*(mode)?\b(?!.*\b(bigger|smaller|up|down)\b)/, "mode:scale", "scale mode"],
  [/\b(explode|explosion|separate)\s*(mode)?\b/, "mode:explode", "explode mode"],

  // ---- objects -----------------------------------------------------------
  [/\b(add|create|spawn|new)\b.*\b(cube|box)\b/, "add:cube", "add cube"],
  [/\b(add|create|spawn|new)\b.*\b(sphere|ball|orb)\b/, "add:sphere", "add sphere"],
  [/\b(add|create|spawn|new)\b.*\b(cylinder|tube)\b/, "add:cylinder", "add cylinder"],
  [/\b(add|create|spawn|new)\b.*\b(cone)\b/, "add:cone", "add cone"],
  [/\b(add|create|spawn|new)\b.*\b(torus|donut|ring)\b/, "add:torus", "add torus"],
  [/\b(add|create|spawn|new)\b.*\b(knot)\b/, "add:torusKnot", "add knot"],
  [/\b(add|create|spawn|new)\b.*\b(crystal|gem|icosahedron)\b/, "add:icosahedron", "add crystal"],

  [/\b(duplicate|copy|clone)\b/, "object:duplicate", "duplicate"],
  [/\b(delete|remove|destroy)\b/, "object:delete", "delete"],
  [/\b(clear|empty)\b.*\b(scene|stage|objects)\b/, "object:clear", "clear the scene"],

  // ---- environment (before the generic transform verbs, so "reset
  // everything" is not swallowed by "reset") ------------------------------
  [/\b(reset|clear)\b.*\b(everything|all|stage|scene|environment|view)\b/, "env:reset", "reset everything"],
  [/\b(camera|webcam)\b.*\b(on|start|enable)\b/, "env:cameraOn", "camera on"],
  [/\b(camera|webcam)\b.*\b(off|stop|disable)\b/, "env:cameraOff", "camera off"],
  [/\b(help|commands|what can i say)\b/, "env:help", "help"],

  // ---- transformations ---------------------------------------------------
  [/\b(reset|recenter|centre|center)\b/, "transform:reset", "reset"],
  [/\b(bigger|larger|grow|increase)\b/, "transform:scaleUp", "bigger"],
  [/\b(smaller|shrink|decrease|reduce)\b/, "transform:scaleDown", "smaller"],
  [/\b(up|raise|lift)\b/, "transform:up", "up"],
  [/\b(down|lower)\b/, "transform:down", "down"],
  [/\b(left)\b/, "transform:left", "left"],
  [/\b(right)\b/, "transform:right", "right"],
  [/\b(forward|closer|near)\b/, "transform:forward", "forward"],
  [/\b(back|backward|further|away)\b/, "transform:back", "back"],
  [/\b(reset|recenter|centre|center)\b/, "transform:reset", "reset"],

  // ---- models / animation -----------------------------------------------
  [/\b(play|start|resume)\b.*\b(animation|clip)\b/, "anim:play", "play animation"],
  [/\b(pause|stop)\b.*\b(animation|clip)\b/, "anim:pause", "pause animation"],
  [/\b(next|another)\b.*\b(animation|clip)\b/, "anim:next", "next animation"],
  [/\b(load|switch|show|open)\b.*\b(robot|arm)\b/, "model:robotArm", "load the robot"],
  [/\b(load|switch|show|open)\b.*\b(turbojet|jet|engine)\b/, "model:turbojet", "load the turbojet"],
  [/\b(load|switch|show|open)\b.*\b(gear)\b/, "model:gearTrain", "load the gear train"],
  [/\b(load|switch|show|open)\b.*\b(rocket|launch|vehicle)\b/, "model:launchVehicle", "load the rocket"],
  [/\b(load|switch|show|open)\b.*\b(pcb|circuit|board)\b/, "model:controlPCB", "load the PCB"],
  [/\b(load|switch|show|open)\b.*\b(cpu|processor|chip)\b/, "model:cpuPackage", "load the CPU"],
  [/\b(load|switch|show|open)\b.*\b(turbine)\b/, "model:windTurbine", "load the turbine"],
  [/\b(load|switch|show|open)\b.*\b(inline|four|4 cylinder)\b/, "model:inlineEngine", "load the inline engine"],

];

/** Strip filler and normalise so matching is stable. */
function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a phrase into an intent.
 * @returns {{ intent: string, phrase: string } | null}
 */
export function parseCommand(phrase) {
  const text = normalise(phrase);
  if (!text) return null;
  for (const [pattern, intent] of COMMAND_TABLE) {
    if (pattern.test(text)) return { intent, phrase: text };
  }
  return null;
}

/** Every phrase the recogniser understands, for the help panel. */
export function commandExamples() {
  return COMMAND_TABLE.map(([, , example]) => example);
}

export const VOICE_STATUS = {
  UNSUPPORTED: "unsupported",
  IDLE: "idle",
  LISTENING: "listening",
  HEARD: "heard",
  ERROR: "error"
};

export class VoiceControl {
  /**
   * @param {object} options
   * @param {Function} options.onCommand (intent, phrase) => void
   * @param {Function} [options.onState]  (state) => void
   */
  constructor({ onCommand, onState } = {}) {
    this.onCommand = onCommand || (() => {});
    this.onState = onState || (() => {});

    const Recognition =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;
    this.Recognition = Recognition || null;
    this.supported = Boolean(this.Recognition);

    this.recognition = null;
    this.listening = false;
    this.status = this.supported ? VOICE_STATUS.IDLE : VOICE_STATUS.UNSUPPORTED;
    this.error = this.supported ? null : "This browser has no speech recognition engine.";
    this.lastPhrase = "";
    this.lastIntent = null;
    this._wantListening = false;
  }

  _emit(state = {}) {
    this.onState({
      status: this.status,
      supported: this.supported,
      listening: this.listening,
      error: this.error,
      phrase: this.lastPhrase,
      intent: this.lastIntent,
      ...state
    });
  }

  start() {
    if (!this.supported) {
      this.status = VOICE_STATUS.UNSUPPORTED;
      this._emit();
      return false;
    }
    if (this.listening) return true;

    this._wantListening = true;
    try {
      if (!this.recognition) this.recognition = this._build();
      this.recognition.start();
      this.listening = true;
      this.status = VOICE_STATUS.LISTENING;
      this.error = null;
      this._emit();
      return true;
    } catch (error) {
      // start() throws if called twice; treat that as already listening.
      if (/already started/i.test(error.message)) {
        this.listening = true;
        this.status = VOICE_STATUS.LISTENING;
        this._emit();
        return true;
      }
      this.error = error.message;
      this.status = VOICE_STATUS.ERROR;
      this._emit();
      return false;
    }
  }

  stop() {
    this._wantListening = false;
    this.listening = false;
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.status = this.supported ? VOICE_STATUS.IDLE : VOICE_STATUS.UNSUPPORTED;
    this._emit();
  }

  toggle() {
    if (this.listening) { this.stop(); return false; }
    return this.start();
  }

  _build() {
    const recognition = new this.Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.listening = true;
      this.status = VOICE_STATUS.LISTENING;
      this.error = null;
      this._emit();
    };

    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || "";
        this.lastPhrase = transcript.trim();

        // Fire on the first match, whether interim or final, so commands feel
        // immediate. Interim text repeats, so guard against re-firing the same
        // phrase.
        const parsed = parseCommand(transcript);
        if (parsed && (parsed.intent !== this.lastIntent || result.isFinal)) {
          this.lastIntent = parsed.intent;
          this.status = VOICE_STATUS.HEARD;
          this._emit({ final: result.isFinal });
          this.onCommand(parsed.intent, transcript.trim());
        } else if (!parsed) {
          this._emit({ final: result.isFinal });
        }
      }
    };

    recognition.onerror = event => {
      // "no-speech" and "aborted" are routine; everything else is worth
      // surfacing.
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.error =
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone permission was denied."
          : `Speech recognition error: ${event.error}`;
      this.status = VOICE_STATUS.ERROR;
      this.listening = false;
      this._emit();
    };

    recognition.onend = () => {
      this.listening = false;
      // Chrome ends the session after a pause; keep listening if the user has
      // not asked to stop.
      if (this._wantListening) {
        try { recognition.start(); return; } catch { /* fall through */ }
      }
      this.status = this.supported ? VOICE_STATUS.IDLE : VOICE_STATUS.UNSUPPORTED;
      this._emit();
    };

    return recognition;
  }

  /** Feed text directly — used by the keyboard fallback and by tests. */
  submitText(text) {
    const parsed = parseCommand(text);
    if (parsed) {
      this.lastPhrase = text;
      this.lastIntent = parsed.intent;
      this.status = VOICE_STATUS.HEARD;
      this._emit({ final: true, manual: true });
      this.onCommand(parsed.intent, text);
      return parsed;
    }
    this.lastPhrase = text;
    this._emit({ final: true, manual: true });
    return null;
  }

  dispose() {
    this._wantListening = false;
    try { this.recognition?.abort?.(); } catch { /* ignore */ }
    this.recognition = null;
  }
}
