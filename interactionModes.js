/**
 * HOLOCORE — interactionModes.js
 * -----------------------------------------------------------------------------
 * The five interaction modes, as data.
 *
 * The mode determines exactly one thing a gesture can do. That rule is enforced
 * in gestures.js (the solver is given the active mode and refuses to produce any
 * other kind of change), but the definitions live here so the UI, the solver and
 * the tests all read from one source.
 *
 * Colours follow the reference project's idea of a strong per-mode identity, but
 * are chosen to stay legible against a live video feed: saturated, mid-lightness,
 * and separated in hue by at least 40°.
 */

export const MODES = [
  {
    id: "select",
    label: "Select",
    shortcut: "1",
    colour: "#3fd0ff",
    rgb: [63, 208, 255],
    icon: "target",
    instruction: "Point at a component and pinch to select it.",
    hint: "Point · pinch to select",
    /** What the solver is allowed to emit while this mode is active. */
    allows: ["hover", "select"]
  },
  {
    id: "move",
    label: "Move",
    shortcut: "2",
    colour: "#4ade80",
    rgb: [74, 222, 128],
    icon: "move",
    instruction: "Pinch and move your hand to drag the target.",
    hint: "Pinch · drag to move",
    allows: ["translate"]
  },
  {
    id: "rotate",
    label: "Rotate",
    shortcut: "3",
    colour: "#c084fc",
    rgb: [192, 132, 252],
    icon: "rotate",
    instruction: "Pinch and move left/right or up/down to rotate.",
    hint: "Pinch · sweep to rotate",
    allows: ["rotate"]
  },
  {
    id: "scale",
    label: "Scale",
    shortcut: "4",
    colour: "#fbbf24",
    rgb: [251, 191, 36],
    icon: "scale",
    instruction: "Pinch with both hands, then move them apart or together.",
    hint: "Two-hand pinch · spread",
    allows: ["scale"]
  },
  {
    id: "explode",
    label: "Explode",
    shortcut: "5",
    colour: "#fb7185",
    rgb: [251, 113, 133],
    icon: "explode",
    instruction: "Use the slider, or spread both hands to control the explosion.",
    hint: "Slider · or two-hand spread",
    allows: ["explode"]
  }
];

export const MODE_IDS = MODES.map(mode => mode.id);

const BY_ID = new Map(MODES.map(mode => [mode.id, mode]));

/** Look up a mode definition, falling back to SELECT for unknown ids. */
export function getMode(id) {
  return BY_ID.get(id) || BY_ID.get("select");
}

/** True when `id` is one of the five real modes. */
export function isMode(id) {
  return BY_ID.has(id);
}

/**
 * Whether a solver result of `intent` is permitted in `mode`.
 * Used by both the solver and the validator, so the rule cannot drift.
 */
export function allowsIntent(modeId, intent) {
  const mode = getMode(modeId);
  if (!intent || intent === "none") return true;
  // Housekeeping intents are always permitted; they do not move the model.
  // "hold" is the SCALE mode waiting for a second pinched hand; it carries no
  // transform, so it must pass the gate in any mode that can emit it.
  if (["release", "tracking-lost", "hover", "blocked", "hold"].includes(intent)) return true;
  return mode.allows.includes(intent);
}

/** A gesture instruction line for the HUD. */
export function instructionFor(modeId) {
  return getMode(modeId).instruction;
}
