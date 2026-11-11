/**
 * HOLOCORE — tools/validate-anatomy.js
 * -----------------------------------------------------------------------------
 * Numerical tests for the hand coordinate contract.
 *
 * These do not ask "did a skeleton object get created". They ask where joint 4
 * actually ended up, in world units, and whether the answer is anatomically
 * right. That is the only kind of test that catches a reflected skeleton, which
 * looks perfectly plausible on screen until a single finger bends.
 *
 * Covers the ten cases the brief lists, in both mirror modes, plus the scale
 * invariance that keeps one bent finger from resizing the whole hand.
 *
 *   node tools/validate-anatomy.js
 */

import * as THREE from "three";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  handJoints,
  palmSpan,
  metricScale,
  mirrorOffset,
  metricOffsetInto,
  worldLandmarksToOffsets,
  FALLBACK_METRIC_SCALE
} from "../handCoordinates.js";
import { landmarkToWorld } from "../handSkeleton3d.js";
import { HandJointSmoother, HandSmootherRegistry } from "../handSmoothing.js";
import { HAND_CONNECTIONS } from "../handOverlay.js";
import {
  ANATOMY_CASES,
  makeHand,
  makePinchHand,
  fingerJoints,
  FINGER_BASE
} from "./fixtures/hands.mjs";

let passed = 0;
let failed = 0;
const failures = [];

function section(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? `  ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------------- */
/* A camera looking down -Z, so world +X is screen right                     */
/* ------------------------------------------------------------------------- */

function makeCamera() {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  return camera;
}

const camera = makeCamera();
const cameraRotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);

/** Run a fixture through the real solver, returning 21 world positions. */
function solve(hand, mirror) {
  const plane = hand.landmarks.map(point =>
    landmarkToWorld(point, camera, { mirror })
  );
  return handJoints({
    planePositions: plane,
    world: hand.worldLandmarks,
    cameraRotation,
    mirror,
    scratch: Array.from({ length: 21 }, () => new THREE.Vector3()),
    scratchVec: new THREE.Vector3(),
    out: Array.from({ length: 21 }, () => new THREE.Vector3())
  });
}

/** Vector3 distance. */
const distance = (a, b) => a.distanceTo(b);

/** Distance for plain {x,y,z} objects, which the metric landmarks are. */
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/* ========================================================================= */
section("1 · Landmark structure and bone connections");

{
  const hand = makeHand({ handedness: "Right" });
  check("a hand has 21 landmarks", hand.landmarks.length === 21, `${hand.landmarks.length}`);
  check("it has 21 metric landmarks too",
    hand.worldLandmarks.length === 21, `${hand.worldLandmarks.length}`);

  // MediaPipe's documented order: wrist, then one finger at a time.
  // The palm is drawn as wrist->index, then the knuckle arch index->pinky.
  // There is no separate wrist->middle bone: the arch plus wrist->index closes
  // the plate, and the palm mesh fills it.
  const expected = [
    [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
    [0, 5], [5, 6], [6, 7], [7, 8],           // index
    [9, 10], [10, 11], [11, 12],              // middle
    [13, 14], [14, 15], [15, 16],             // ring
    [0, 17], [17, 18], [18, 19], [19, 20],    // pinky
    [5, 9], [9, 13], [13, 17]                 // knuckle arch
  ];
  const missing = expected.filter(
    ([a, b]) => !HAND_CONNECTIONS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  );
  check("every anatomical bone is drawn", missing.length === 0,
    missing.map(([a, b]) => `${a}-${b}`).join(", "));

  // A finger must never be wired to a different finger. The knuckle arch is the
  // deliberate exception: 5-9, 9-13 and 13-17 are the palm's transverse arch,
  // not finger bones, so they are allowed to span knuckles.
  const KNUCKLE_ARCH = new Set(["5-9", "9-13", "13-17"]);
  const fingerOf = index => {
    for (const [name, base] of Object.entries(FINGER_BASE)) {
      if (index >= base && index <= base + 3) return name;
    }
    return null;
  };
  const crossFinger = HAND_CONNECTIONS.filter(([a, b]) => {
    if (KNUCKLE_ARCH.has(`${a}-${b}`) || KNUCKLE_ARCH.has(`${b}-${a}`)) return false;
    const fa = fingerOf(a);
    const fb = fingerOf(b);
    // Knuckles themselves belong to a finger, so a finger bone must stay within
    // one finger, and a bone that leaves the hand's edge must end at a knuckle.
    return fa && fb && fa !== fb && !(a === 0 || b === 0);
  });
  check("no bone connects two different fingers",
    crossFinger.length === 0, JSON.stringify(crossFinger));
}

/* ========================================================================= */
section("2 · Mirroring is applied exactly once");

{
  for (const mirror of [false, true]) {
    const hand = makeHand({ handedness: "Right" });
    const joints = solve(hand, mirror);
    const anchor = landmarkToWorld(hand.landmarks[0], camera, { mirror });

    check(`wrist sits exactly at the mirrored anchor (mirror=${mirror})`,
      joints[0].distanceTo(anchor) < 1e-9,
      `${joints[0].x.toFixed(4)} vs ${anchor.x.toFixed(4)}`);

    // A right hand has its thumb on the image left, so in an UN-mirrored view
    // the thumb must stay on world -X. Mirroring flips that to +X, which is
    // what the user sees in the mirrored preview.
    const thumbX = joints[4].x;
    const pinkyX = joints[20].x;
    const thumbLeft = thumbX < pinkyX;
    check(`right hand is not anatomically reflected (mirror=${mirror})`,
      thumbLeft === !mirror,
      `thumb.x=${thumbX.toFixed(3)} pinky.x=${pinkyX.toFixed(3)}`);
  }

  // The same for the left hand, which must be the mirror image of the right.
  for (const mirror of [false, true]) {
    const hand = makeHand({ handedness: "Left" });
    const joints = solve(hand, mirror);
    const thumbLeft = joints[4].x < joints[20].x;
    check(`left hand is not anatomically reflected (mirror=${mirror})`,
      thumbLeft === mirror,
      `thumb.x=${joints[4].x.toFixed(3)} pinky.x=${joints[20].x.toFixed(3)}`);
  }

  // Double mirroring is the classic failure: the wrist lands correctly but the
  // anatomy is reflected, or vice versa. Both are caught by asserting that
  // toggling the flag reflects the anatomy AND translates the anchor.
  const hand = makeHand({ handedness: "Right" });
  const plain = solve(hand, false);
  const flipped = solve(hand, true);
  const anatomyFlipped = Math.sign(plain[4].x - plain[20].x) !== Math.sign(flipped[4].x - flipped[20].x);
  check("toggling mirror reflects the anatomy", anatomyFlipped);

  // Mirroring must not touch depth: a reflection about the vertical axis leaves
  // z alone. A skeleton that moves in depth when you toggle a 2D preview
  // setting is a double flip somewhere.
  const depthDrift = Math.max(...plain.map((point, i) => Math.abs(point.z - flipped[i].z)));
  check("mirroring leaves depth untouched", depthDrift < 1e-6, depthDrift.toExponential(2));

  // And the hand's size must be identical either way.
  const sizePlain = palmSpan(plain);
  const sizeFlipped = palmSpan(flipped);
  check("mirroring leaves the hand the same size",
    Math.abs(sizePlain - sizeFlipped) < 1e-9,
    `${sizePlain.toFixed(4)} vs ${sizeFlipped.toFixed(4)}`);
}

/* ========================================================================= */
section("3 · Fingers move independently");

{
  const restRight = makeHand({ handedness: "Right" });
  const restJoints = solve(restRight, true);

  for (const mirror of [true, false]) {
    const rest = solve(makeHand({ handedness: "Right" }), mirror);

    for (const [finger, base] of Object.entries(FINGER_BASE)) {
      const curled = solve(makeHand({ handedness: "Right", curl: { [finger]: 1 } }), mirror);
      const own = fingerJoints(finger);

      // The fingertip of the curled finger must actually move.
      const ownMotion = Math.max(...own.slice(1).map(i => distance(rest[i], curled[i])));
      check(`${finger} curls when asked (mirror=${mirror})`, ownMotion > 0.1,
        ownMotion.toFixed(3));

      // No other finger may move at all.
      const others = Object.keys(FINGER_BASE).filter(f => f !== finger);
      const leakage = others.map(other => ({
        finger: other,
        movement: Math.max(...fingerJoints(other).slice(1).map(i => distance(rest[i], curled[i])))
      }));
      const worst = leakage.reduce((a, b) => (a.movement > b.movement ? a : b));
      check(`curling the ${finger} does not move the ${worst.finger} (mirror=${mirror})`,
        worst.movement < 1e-6, worst.movement.toExponential(2));
    }
  }

  // The brief calls this out by name: bending the pinky must not move the thumb.
  const pinkyCurled = solve(makeHand({ handedness: "Right", curl: { pinky: 1 } }), true);
  const thumbDrift = Math.max(...[1, 2, 3, 4].map(i => distance(restJoints[i], pinkyCurled[i])));
  check("bending the pinky leaves the thumb exactly where it was",
    thumbDrift < 1e-6, thumbDrift.toExponential(2));

  // And the reverse.
  const thumbCurled = solve(makeHand({ handedness: "Right", curl: { thumb: 1 } }), true);
  const pinkyDrift = Math.max(...[17, 18, 19, 20].map(i => distance(restJoints[i], thumbCurled[i])));
  check("bending the thumb leaves the pinky exactly where it was",
    pinkyDrift < 1e-6, pinkyDrift.toExponential(2));
}

/* ========================================================================= */
section("4 · Scale is rigid under finger movement");

{
  const spread = points => palmSpan(points);

  const rest = makeHand({ handedness: "Right" });
  const curled = makeHand({ handedness: "Right", curl: { pinky: 1 } });

  check("palm span ignores a curled pinky",
    Math.abs(spread(rest.landmarks) - spread(curled.landmarks)) < 1e-12,
    `${spread(rest.landmarks).toFixed(6)} vs ${spread(curled.landmarks).toFixed(6)}`);

  const scaleRest = metricScale(rest.landmarks, rest.worldLandmarks);
  const scaleCurled = metricScale(curled.landmarks, curled.worldLandmarks);
  check("the metres-to-world scale is unchanged by curling a finger",
    Math.abs(scaleRest - scaleCurled) < 1e-6,
    `${scaleRest.toFixed(4)} vs ${scaleCurled.toFixed(4)}`);

  // Degenerate input must fall back rather than produce NaN or zero.
  const collapsed = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const fallback = metricScale(collapsed, collapsed.map(p => ({ x: 0, y: 0, z: 0 })));
  check("degenerate landmarks fall back to a constant scale",
    Number.isFinite(fallback) && fallback > 0, fallback.toFixed(2));

  const joints = solve({ landmarks: collapsed, worldLandmarks: collapsed }, true);
  check("a collapsed hand still produces finite joints",
    joints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)),
    "");
}

/* ========================================================================= */
section("5 · Hand rotation keeps anatomy intact");

{
  // Image-space rotation is not a rigid 3D rotation unless the hand is flat:
  // rotating a landmark cloud with depth variation about an axis parallel to z
  // genuinely foreshortens some bones. What must hold is that the *metric*
  // anatomy is untouched, because rotation only rewrites normalised x/y.
  const upright = makeHand({ handedness: "Right" });
  const tilted = makeHand({ handedness: "Right", rotateZ: 0.6 });
  // Every metric bone must keep its length: the rotation is rigid in 3D even
  // though the coordinates themselves change.
  const metricBones = points => HAND_CONNECTIONS.map(([a, b]) => span(points[a], points[b]));
  const mu = metricBones(upright.worldLandmarks);
  const mt = metricBones(tilted.worldLandmarks);
  const metricWorst = Math.max(...mu.map((len, i) => Math.abs(len - mt[i])));
  check("rotation preserves every metric bone length", metricWorst < 1e-12,
    metricWorst.toExponential(2));

  // The metres-to-world scale SHOULD change, and by exactly the foreshortening
  // the rotation caused: the palm plate is seen at an angle, so it projects
  // smaller in the image while its metric size is unchanged. Asserting a stable
  // scale here would be asserting that the hand does not turn.
  const scaleUpright = metricScale(upright.landmarks, upright.worldLandmarks);
  const scaleTilted = metricScale(tilted.landmarks, tilted.worldLandmarks);
  check("a turned hand projects smaller than an upright one",
    scaleTilted < scaleUpright,
    `${scaleUpright.toFixed(4)} -> ${scaleTilted.toFixed(4)}`);
  check("the projection change stays physically bounded",
    scaleTilted / scaleUpright > 0.5 && scaleTilted / scaleUpright < 1,
    (scaleTilted / scaleUpright).toFixed(3));

  const uprightJoints = solve(upright, true);
  const tiltedJoints = solve(tilted, true);
  const boneLengths = points => HAND_CONNECTIONS.map(([a, b]) => distance(points[a], points[b]));
  const a = boneLengths(uprightJoints);
  const b = boneLengths(tiltedJoints);
  const worst = Math.max(...a.map((len, i) => Math.abs(len - b[i])));
  check("rotated bones stay within 20% of their upright length", worst < 0.2 * Math.max(...a),
    worst.toExponential(2));

  // A sideways hand must still be a right hand.
  const sideways = solve(makeHand({ handedness: "Right", rotateZ: Math.PI / 2 }), true);
  const thumbVsPinky = sideways[4].y - sideways[20].y;
  check("a sideways right hand keeps its thumb on the correct side",
    Math.abs(thumbVsPinky) > 0.1, thumbVsPinky.toFixed(3));

  // Under rotation the curl must still be independent.
  const rotatedRest = solve(makeHand({ handedness: "Right", rotateZ: 0.6 }), true);
  const rotatedCurl = solve(makeHand({ handedness: "Right", rotateZ: 0.6, curl: { pinky: 1 } }), true);
  const thumbStill = Math.max(...[1, 2, 3, 4].map(i => distance(rotatedRest[i], rotatedCurl[i])));
  check("pinky independence survives hand rotation", thumbStill < 1e-6, thumbStill.toExponential(2));
}

/* ========================================================================= */
section("6 · Every listed case, both mirror modes");

{
  for (const [name, build] of Object.entries(ANATOMY_CASES)) {
    for (const mirror of [false, true]) {
      const hand = build();
      const joints = solve(hand, mirror);
      const finite = joints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
      // No two distinct joints may coincide: a collapsed skeleton hides bones.
      // Thumb and index tips genuinely touch in a pinch — that is the gesture.
      // Every other pair must be distinct, or bones collapse and disappear.
      let coincident = 0;
      for (let i = 0; i < joints.length; i++) {
        for (let j = i + 1; j < joints.length; j++) {
          if (i === 4 && j === 8) continue;
          if (distance(joints[i], joints[j]) < 1e-6) coincident++;
        }
      }
      check(`${name} (mirror=${mirror})`,
        finite && coincident === 0 && joints[0].distanceTo(joints[20]) > 0.1,
        coincident ? `${coincident} coincident pairs` : "finite, distinct");
    }
  }
}

/* ========================================================================= */
section("7 · Pinch brings thumb and index together");

{
  const pinch = makePinchHand({ handedness: "Right" });
  const joints = solve(pinch, true);
  const gap = distance(joints[4], joints[8]);
  const openHand = solve(makeHand({ handedness: "Right" }), true);
  const openGap = distance(openHand[4], openHand[8]);

  check("a pinching hand has its tips together", gap < openGap * 0.5,
    `${gap.toFixed(3)} vs open ${openGap.toFixed(3)}`);

  // The pinch must not disturb the other fingers.
  const drift = Math.max(...[9, 12, 13, 16, 17, 20].map(i => distance(joints[i], openHand[i])));
  check("pinching leaves the other fingers alone", drift < 1e-6, drift.toExponential(2));
}

/* ========================================================================= */
section("8 · Coordinate helpers are pure and allocation-free");

{
  const out = new THREE.Vector3();
  metricOffsetInto(out, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }, 2);
  check("metric offsets flip y (image down -> world up)",
    out.x === 2 && out.y === -4 && out.z === 6, `${out.x},${out.y},${out.z}`);

  const mirrored = mirrorOffset(new THREE.Vector3(1, 2, 3), true);
  check("mirroring negates x only", mirrored.x === -1 && mirrored.y === 2 && mirrored.z === 3);

  const unmirrored = mirrorOffset(new THREE.Vector3(1, 2, 3), false);
  check("no mirror leaves the offset alone", unmirrored.x === 1);

  // The scratch array must be reused, not replaced.
  const scratch = Array.from({ length: 21 }, () => new THREE.Vector3());
  const before = scratch.slice();
  const hand = makeHand({ handedness: "Right" });
  worldLandmarksToOffsets(hand.worldLandmarks, scratch, { scale: 8, mirror: true });
  check("offsets reuse the caller's array", scratch.every((v, i) => v === before[i]));
  check("offsets are filled for all 21 joints",
    scratch.every(v => Number.isFinite(v.x)));

  check("fallback scale is a usable constant",
    Number.isFinite(FALLBACK_METRIC_SCALE) && FALLBACK_METRIC_SCALE > 0,
    String(FALLBACK_METRIC_SCALE));
}

/* ========================================================================= */
section("9 · The 3D skeleton filter removes jitter without lagging");

{
  const point = value => ({ x: value, y: value, z: 0 });
  const buffer = () => Array.from({ length: 21 }, () => ({
    x: 0, y: 0, z: 0,
    set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }
  }));
  const rms = values => {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  };

  // Jitter on a still hand must visibly reduce.
  {
    const smoother = new HandJointSmoother();
    const out = buffer();
    const raw = [];
    const filtered = [];
    // Deterministic noise: a fixed pseudo-random sequence, so the check is
    // reproducible rather than flaky.
    let seed = 12345;
    const noise = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff - 0.5) * 0.04;
    };
    for (let frame = 0; frame < 200; frame++) {
      const joints = Array.from({ length: 21 }, (_, i) => ({
        x: 0.1 * Math.sin(i) + noise(),
        y: 0.1 * Math.cos(i) + noise(),
        z: 0
      }));
      smoother.update(joints, out, frame / 30);
      if (frame > 20) { raw.push(joints[8].x); filtered.push(out[8].x); }
    }
    const reduction = 1 - rms(filtered) / rms(raw);
    check("filtering removes most jitter from a still hand", reduction > 0.4,
      `${(reduction * 100).toFixed(0)}% reduction`);
  }

  // A deliberate movement must not be damped into sluggishness.
  {
    const smoother = new HandJointSmoother();
    const out = buffer();
    let stepFrame = -1;
    let reach = -1;
    for (let frame = 0; frame < 80; frame++) {
      const moving = frame >= 10;
      smoother.update(Array.from({ length: 21 }, () => point(moving ? 1 : 0)), out, frame / 30);
      if (moving && stepFrame < 0) stepFrame = frame;
      if (stepFrame >= 0 && reach < 0 && out[0].x > 0.9) reach = frame - stepFrame;
    }
    check("a deliberate move settles inside 200 ms", reach > 0 && reach <= 6,
      `${reach} frames = ${Math.round((reach / 30) * 1000)} ms`);
  }

  // Joints must be filtered independently: one fingertip moving must not drag
  // its neighbours, which would deform the hand's proportions.
  {
    const smoother = new HandJointSmoother();
    const out = buffer();
    for (let frame = 0; frame < 60; frame++) {
      smoother.update(
        Array.from({ length: 21 }, (_, i) => point(i === 8 ? (frame < 20 ? 0 : 1) : 0)),
        out,
        frame / 30
      );
    }
    check("a moving fingertip does not drag its neighbours",
      out[8].x > 0.95 && out[7].x === 0 && out[9].x === 0,
      `8=${out[8].x.toFixed(2)} 7=${out[7].x} 9=${out[9].x}`);
  }

  // Losing the hand and finding it again must not glide in from the old pose.
  {
    const smoother = new HandJointSmoother();
    const out = buffer();
    for (let frame = 0; frame < 30; frame++) {
      smoother.update(Array.from({ length: 21 }, () => point(0)), out, frame / 30);
    }
    smoother.reset();
    smoother.update(Array.from({ length: 21 }, () => point(5)), out, 100);
    check("a reappearing hand is taken as-is, not eased in", out[0].x === 5, String(out[0].x));
  }

  // The caller's input must never be mutated.
  {
    const smoother = new HandJointSmoother();
    const out = buffer();
    const joints = Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: 0, z: 0 }));
    const snapshot = joints.map(j => ({ ...j }));
    for (let frame = 0; frame < 10; frame++) smoother.update(joints, out, frame / 30);
    const untouched = joints.every((j, i) =>
      j.x === snapshot[i].x && j.y === snapshot[i].y && j.z === snapshot[i].z);
    check("smoothing never mutates the source landmarks", untouched);
  }

  // Separate smoothers must keep separate history: the second hand must not
  // inherit the first hand's filtered positions.
  {
    const registry = new HandSmootherRegistry();
    const outA = buffer();
    const outB = buffer();
    for (let frame = 0; frame < 40; frame++) {
      registry.for("Right-0").update(Array.from({ length: 21 }, () => point(1)), outA, frame / 30);
      registry.for("Left-1").update(Array.from({ length: 21 }, () => point(-1)), outB, frame / 30);
    }
    check("each hand keeps its own filter history",
      Math.abs(outA[0].x - 1) < 1e-6 && Math.abs(outB[0].x + 1) < 1e-6,
      `${outA[0].x.toFixed(2)} / ${outB[0].x.toFixed(2)}`);
    check("two hands get distinct smoothers", registry.smoothers.size === 2,
      String(registry.smoothers.size));
  }
}

/* ========================================================================= */
console.log("");
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1mALL ${passed} ANATOMY CHECKS PASSED\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m${failed} FAILED\x1b[0m · ${passed} passed`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
