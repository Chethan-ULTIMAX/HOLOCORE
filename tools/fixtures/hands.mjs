/**
 * HOLOCORE — tools/fixtures/hands.mjs
 * -----------------------------------------------------------------------------
 * Anatomically realistic synthetic hands, in MediaPipe's two landmark spaces.
 *
 * These exist because the skeleton's worst bug — the mirror reflecting a hand's
 * anatomy — is invisible on a flat open hand. The thumb only ends up on the
 * wrong side, or a bent pinky only drags the thumb, when one finger at a time
 * does something. A fixture that curls exactly one finger and measures every
 * other joint is the only way to catch it.
 *
 * CONVENTIONS (both mediapipe sets)
 *
 *   landmarks       normalised, 0..1, origin top-left, y DOWN, for the
 *                   UN-mirrored camera image.
 *   worldLandmarks  metres, origin at the hand centre, x right, y DOWN,
 *                   z toward the camera negative.
 *
 * A right hand shown to an un-mirrored camera has its thumb on the IMAGE LEFT
 * (small x) and its pinky on the IMAGE RIGHT (large x). That asymmetry is the
 * whole point: a symmetric fixture cannot detect a reflection.
 *
 * LANDMARK ORDER (MediaPipe, 21 points)
 *   0 wrist
 *   1-4   thumb   (1 CMC, 2 MCP, 3 IP, 4 TIP)
 *   5-8   index   (5 MCP, 6 PIP, 7 DIP, 8 TIP)
 *   9-12  middle
 *   13-16 ring
 *   17-20 pinky
 */

/** Knuckle index for each finger: [thumb, index, middle, ring, pinky]. */
export const FINGER_BASE = { thumb: 1, index: 5, middle: 9, ring: 13, pinky: 17 };

/** Every landmark belonging to one finger, wrist to tip. */
export function fingerJoints(finger) {
  const base = FINGER_BASE[finger];
  return [base, base + 1, base + 2, base + 3];
}

/**
 * A relaxed but extended right hand.
 *
 * Values are chosen so that the thumb points down-and-left and the pinky
 * up-and-right, which is what a right palm facing the camera actually looks
 * like in an un-mirrored image.
 */
const RIGHT_EXTENDED = [
  [0.500, 0.860], // 0  wrist
  [0.436, 0.780], // 1  thumb CMC
  [0.398, 0.722], // 2  thumb MCP
  [0.368, 0.668], // 3  thumb IP
  [0.340, 0.628], // 4  thumb TIP
  [0.440, 0.600], // 5  index MCP
  [0.418, 0.482], // 6  index PIP
  [0.406, 0.400], // 7  index DIP
  [0.396, 0.332], // 8  index TIP
  [0.500, 0.582], // 9  middle MCP
  [0.500, 0.458], // 10 middle PIP
  [0.500, 0.376], // 11 middle DIP
  [0.500, 0.308], // 12 middle TIP
  [0.558, 0.598], // 13 ring MCP
  [0.578, 0.480], // 14 ring PIP
  [0.590, 0.402], // 15 ring DIP
  [0.600, 0.334], // 16 ring TIP
  [0.618, 0.638], // 17 pinky MCP
  [0.658, 0.540], // 18 pinky PIP
  [0.680, 0.462], // 19 pinky DIP
  [0.700, 0.394]  // 20 pinky TIP
];

/** Horizontal scale that turns the right hand into a left hand. */
function flip(points) {
  return points.map(([x, y]) => [1 - x, y]);
}

function toLandmarks(rows) {
  return rows.map(([x, y]) => ({ x, y, z: 0 }));
}

/**
 * MediaPipe worldLandmarks for a set of normalised landmarks.
 *
 * Deliberately derived from the same rows rather than authored separately, so
 * the two spaces agree about the hand. The metric scale (0.2 m across the
 * image) is roughly a real hand.
 *
 * @param {Array<{x,y}>} landmarks
 */
export function toWorldLandmarks(landmarks) {
  const origin = landmarks[0];
  return landmarks.map(point => ({
    x: (point.x - origin.x) * 0.2,
    // MediaPipe y runs DOWN, exactly as the normalised image does.
    y: (point.y - origin.y) * 0.2,
    z: point.z || 0
  }));
}

/**
 * Curl one finger.
 *
 * Only the finger's own joints move: the knuckle stays where it is (it is part
 * of the rigid palm plate) and the three joints beyond it fold toward the palm.
 * This is what makes the fixture able to prove independence — if a regression
 * makes the thumb move when the pinky curls, the test measures it.
 *
 * @param {Array<{x,y,z}>} landmarks
 * @param {keyof typeof FINGER_BASE} finger
 * @param {number} amount 0 = extended, 1 = fully curled
 */
export function curlFinger(landmarks, finger, amount = 1) {
  const base = FINGER_BASE[finger];
  return landmarks.map((point, i) => {
    if (i <= base || i > base + 3) return { ...point };
    const k = i - base; // 1..3
    // Fold down (image +y) and slightly toward the middle of the hand.
    const inward = point.x < 0.5 ? 0.012 : -0.012;
    return {
      ...point,
      x: point.x + inward * k * amount,
      y: point.y + 0.055 * k * amount,
      z: (point.z || 0) - 0.01 * k * amount
    };
  });
}

/**
 * Build a complete hand fixture.
 *
 * @param {object} [options]
 * @param {"Right"|"Left"} [options.handedness="Right"]
 * @param {object} [options.curl] { pinky: 1, thumb: 0.5, … }
 * @param {number} [options.rotateZ=0] radians, about the wrist, in image space
 * @returns {{landmarks:Array, worldLandmarks:Array, handedness:string}}
 */
export function makeHand({ handedness = "Right", curl = {}, rotateZ = 0 } = {}) {
  const rows = handedness === "Left" ? flip(RIGHT_EXTENDED) : RIGHT_EXTENDED;
  let points = toLandmarks(rows);

  for (const [finger, amount] of Object.entries(curl)) {
    if (finger in FINGER_BASE) points = curlFinger(points, finger, amount);
  }

  // Derive the metric hand FIRST, then rotate both representations by the same
  // rigid transform. Rotating only the normalised landmarks would change the
  // hand's proportions, because normalised x and y do not share a world scale.
  let world = toWorldLandmarks(points);

  if (rotateZ) {
    // A rigid in-plane rotation of the 3D hand, expressed in each space.
    points = rotateRigid3D(points, rotateZ, 16 / 9);
    world = rotateRigid3D(world, rotateZ, 1);
  }

  return { landmarks: points, worldLandmarks: world, handedness };
}

/**
 * Rotate about the wrist around the axis parallel to z.
 *
 * `aspect` scales x before the rotation so that, in a frame where one unit of x
 * and one unit of y are the same physical size, the rotation is rigid. Pass 1
 * for the metric space (already isotropic) and 16/9 for normalised space.
 */
function rotateRigid3D(points, radians, aspect) {
  const origin = points[0];
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(point => {
    const dx = (point.x - origin.x) * aspect;
    const dy = point.y - origin.y;
    return {
      ...point,
      x: origin.x + (dx * cos - dy * sin) / aspect,
      y: origin.y + (dx * sin + dy * cos)
    };
  });
}


/**
 * A pinching hand: thumb tip and index tip brought together.
 *
 * The rest of the hand stays extended, so a pinch is distinguishable from a
 * fist by the other three fingers.
 */
export function makePinchHand({ handedness = "Right" } = {}) {
  const hand = makeHand({ handedness });
  const points = hand.landmarks.map(point => ({ ...point }));
  // Meet in the middle between the extended thumb and index tips.
  const target = {
    x: (points[4].x + points[8].x) / 2,
    y: (points[4].y + points[8].y) / 2
  };
  points[4] = { ...points[4], x: target.x, y: target.y };
  points[3] = { ...points[3], x: (points[3].x + target.x) / 2, y: (points[3].y + target.y) / 2 };
  points[8] = { ...points[8], x: target.x, y: target.y };
  points[7] = { ...points[7], x: (points[7].x + target.x) / 2, y: (points[7].y + target.y) / 2 };
  return { landmarks: points, worldLandmarks: toWorldLandmarks(points), handedness };
}

/** Every named case the brief asks the skeleton to survive. */
export const ANATOMY_CASES = {
  "right hand, fingers extended": () => makeHand({ handedness: "Right" }),
  "left hand, fingers extended": () => makeHand({ handedness: "Left" }),
  "right pinky curled": () => makeHand({ handedness: "Right", curl: { pinky: 1 } }),
  "left pinky curled": () => makeHand({ handedness: "Left", curl: { pinky: 1 } }),
  "thumb curled": () => makeHand({ handedness: "Right", curl: { thumb: 1 } }),
  "index curled": () => makeHand({ handedness: "Right", curl: { index: 1 } }),
  "several fingers curled": () => makeHand({ handedness: "Right", curl: { index: 1, ring: 1, pinky: 1 } }),
  "hand rotated toward the camera": () => makeHand({ handedness: "Right", rotateZ: 0.6 }),
  "hand rotated sideways": () => makeHand({ handedness: "Right", rotateZ: Math.PI / 2 }),
  "pinching": () => makePinchHand({ handedness: "Right" })
};
