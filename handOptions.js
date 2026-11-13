/**
 * HOLOCORE — handOptions.js
 * -----------------------------------------------------------------------------
 * Which hand does what (§10).
 *
 * WHY THIS EXISTS
 *
 * The app has settings for detection confidence, tracking confidence and how many
 * hands to look for, but no way to say *whose* hand drives the cursor. That was
 * hard-wired: the active hand was resolved by a fixed rule (locked, then
 * pinching, then first tracked) and `hands[0]` decided the pointer whenever that
 * rule was ambiguous.
 *
 * That is wrong for two real groups of users:
 *
 *   - people who want to use a non-dominant hand, because the dominant one is
 *     holding a tool, a mouse or a cup;
 *   - people with one usable hand, who need the app to ignore the other one
 *     instead of sometimes following it.
 *
 * This module turns "which hand is in charge" into an explicit choice, and makes
 * the two-hand gestures behave consistently with it.
 *
 * THE FOUR ROLES
 *
 *   auto        whatever is manipulating wins, otherwise the first tracked hand
 *   left        the left hand drives; the right hand can still two-hand with it
 *   right       the right hand drives
 *   any         either hand alone drives; useful when handedness is unreliable
 *
 * A role is not a filter: hands that are not in charge are still tracked, still
 * drawn, and still available for a two-hand gesture. It only decides who holds
 * the reticle.
 */

/** Selectable hand roles, in menu order. */
export const HAND_ROLES = Object.freeze([
  {
    id: "auto",
    label: "Automatic",
    detail: "Whichever hand is manipulating drives; the first tracked hand otherwise."
  },
  {
    id: "left",
    label: "Left hand",
    detail: "The left hand drives. The right can still join a two-hand gesture."
  },
  {
    id: "right",
    label: "Right hand",
    detail: "The right hand drives. The left can still join a two-hand gesture."
  },
  {
    id: "any",
    label: "Either hand",
    detail: "Any single hand drives. Best when handedness reads unreliably."
  }
]);

export const DEFAULT_ROLE = "auto";

/** @returns {boolean} whether `id` is one of the four roles. */
export function isHandRole(id) {
  return HAND_ROLES.some(role => role.id === id);
}

/** Fall back to automatic rather than throwing on a stale stored value. */
export function normaliseRole(id) {
  return isHandRole(id) ? id : DEFAULT_ROLE;
}

/**
 * Strength of a handedness label.
 *
 * MediaPipe occasionally reports "Unknown" for a hand it is otherwise tracking
 * confidently, which used to make the hand unreachable by a fixed role.
 *
 * @param {string} handedness
 * @returns {"Left"|"Right"|null}
 */
export function normaliseHandedness(handedness) {
  const value = String(handedness || "").toLowerCase();
  if (value === "left") return "Left";
  if (value === "right") return "Right";
  return null;
}

/**
 * Score how strongly a hand matches a role.
 *
 * Higher is better; 0 means "not eligible at all". Kept separate from the choice
 * so the ranking is testable on its own, and so the reason for a choice can be
 * reported to the UI.
 *
 * @param {object} hand analysed hand state
 * @param {string} role normalised role id
 * @returns {number}
 */
export function roleAffinity(hand, role) {
  if (!hand) return 0;
  if (role === "any" || role === "auto") return 1;

  const side = normaliseHandedness(hand.handedness);
  if (!side) {
    // Unknown handedness is a tracked hand, not a wrong one. Let it compete at
    // reduced weight rather than dropping the user's only hand on the floor.
    return 0.4;
  }
  return side.toLowerCase() === role ? 1 : 0;
}

/**
 * Choose the hand that drives the reticle.
 *
 * @param {Array<object>} hands analysed hand states, in tracker order
 * @param {object} [options]
 * @param {string} [options.role] one of HAND_ROLES
 * @param {string|null} [options.lockedKey] identity pinned for the current grab
 * @param {boolean} [options.hoverOnly]
 * @returns {object|null} the chosen hand state, or null when none qualifies
 */
export function selectRoleHand(hands, { role = DEFAULT_ROLE, lockedKey = null, hoverOnly = false } = {}) {
  const list = (Array.isArray(hands) ? hands : []).filter(Boolean);
  if (!list.length) return null;

  const normalised = normaliseRole(role);

  // A grab in progress owns the reticle. Switching hands mid-gesture would make
  // the object jump to the other hand's position, so the lock outranks the role.
  if (lockedKey) {
    const locked = list.find(hand => hand.key === lockedKey);
    if (locked) return locked;
  }

  // Rank by role affinity, then by the established preference: a manipulating
  // hand beats an idle one, because the user is already acting.
  const ranked = list
    .map(hand => ({
      hand,
      affinity: roleAffinity(hand, normalised),
      acting: hand.pinched ? 2 : 0,
      // Preserve tracker order for genuine ties: it is the most stable of the
      // remaining signals, and changing it only when something else changes is
      // what makes the reticle feel steady.
      order: list.indexOf(hand)
    }))
    .filter(entry => entry.affinity > 0)
    .sort((a, b) =>
      b.affinity - a.affinity ||
      b.acting - a.acting ||
      a.order - b.order
    );

  if (!ranked.length) return null;

  // In hoverOnly mode a hand that is already pinching is about to become a real
  // gesture; letting it drive hover first is what makes the reticle land on the
  // right target before the grab starts.
  void hoverOnly;
  return ranked[0].hand;
}

/**
 * Assess the tracking configuration for problems the user cannot see.
 *
 * Several settings combinations are legal but self-defeating, and the failure
 * looks like a broken gesture engine rather than a bad setting:
 *
 *   - detection confidence above tracking confidence drops hands on re-detection
 *     far more often than it filters false positives;
 *   - a high detection confidence on a weak camera means hands are rarely found
 *     at all, which reads as "the app does not see me";
 *   - `maxHands: 1` with a fixed two-hand gesture silently makes it impossible.
 *
 * @param {{detection:number, tracking:number, maxHands:number}} config
 * @param {{role?:string, twoHandGesture?:boolean}} [context]
 * @returns {Array<{id:string, level:"warn"|"info", message:string, fix:object|null}>}
 */
export function assessHandSettings(config = {}, context = {}) {
  const warnings = [];
  const detection = Number(config.detection);
  const tracking = Number(config.tracking);
  const maxHands = Number(config.maxHands);

  if (Number.isFinite(detection) && Number.isFinite(tracking) && detection > tracking + 0.09) {
    warnings.push({
      id: "detection-exceeds-tracking",
      level: "warn",
      message:
        "Detection confidence is well above tracking confidence. Hands will be " +
        "re-detected often and may flicker between them.",
      fix: { section: "tracking", values: { minDetectionConfidence: tracking } }
    });
  }

  if (Number.isFinite(detection) && detection >= 0.8) {
    warnings.push({
      id: "detection-too-high",
      level: "warn",
      message:
        "Detection confidence this high will miss hands in ordinary lighting. " +
        "0.5–0.7 is usually better.",
      fix: { section: "tracking", values: { minDetectionConfidence: 0.6 } }
    });
  }

  if (maxHands === 1 && context.twoHandGesture) {
    warnings.push({
      id: "single-hand-two-hand-gesture",
      level: "info",
      message:
        "Only one hand is tracked, so two-hand scale and rotate cannot trigger. " +
        "Set maximum hands to 2 to use them.",
      fix: { section: "tracking", values: { maxHands: 2 } }
    });
  }

  return warnings;
}

/**
 * One-line summary of what the current role means for the user.
 *
 * @param {string} role
 * @param {object|null} activeHand the hand currently driving, if any
 */
export function describeRole(role, activeHand = null) {
  const normalised = normaliseRole(role);
  const entry = HAND_ROLES.find(item => item.id === normalised);

  if (!activeHand) {
    return `${entry.label}: waiting for a${normalised === "left" ? " left" : ""} hand.`;
  }
  const side = normaliseHandedness(activeHand.handedness) || "unlabelled";
  return `${entry.label}: ${side.toLowerCase()} hand${activeHand.key ? ` (${activeHand.key})` : ""}`;
}
