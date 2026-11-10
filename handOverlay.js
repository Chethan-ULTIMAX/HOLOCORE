/**
 * HOLOCORE — handOverlay.js
 * -----------------------------------------------------------------------------
 * Draws the real MediaPipe hand landmarks over the camera image and renders the
 * index fingertip as an interactive pointer.
 *
 * COORDINATES
 *
 * The overlay canvas covers exactly the same box as the video, so landmark
 * pixels are computed with the identical cover-crop + mirror maths the pointer
 * mapping uses (handGeometry.js). Sharing that maths is the whole point: if the
 * skeleton lines up with the hand, the pointer lines up too.
 *
 * The landmark data itself is never mirrored or cropped — only the drawing is.
 */

import { landmarkToStage } from "./handGeometry.js";

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

/** Thumb tip, then the four fingertips. */
export const TIP_INDICES = [4, 8, 12, 16, 20];

/**
 * Both hands use the same cyan palette, which is what makes the overlay read as
 * one tracking layer over the feed (see the reference implementation). A very
 * slight hue shift on the second hand keeps it possible to tell them apart at a
 * glance without breaking that single-colour look.
 */
const CYAN = {
  // Kept at full authored vividness: this canvas is composited over the video
  // by the browser, not through the WebGL renderer, so nothing tone-maps it.
  // The 3D rigs are set to the same strength (toneMapped = false) so the two
  // layers, when both are visible, read as one instrument.
  bone: "rgba(34, 214, 255, 0.95)",
  joint: "#7ceaff",
  tip: "#eafdff",
  pointer: [34, 214, 255],
  label: "#8ce9ff"
};

const HANDS = {
  Left: CYAN,
  Right: {
    ...CYAN,
    // A touch warmer so two hands are still distinguishable while grabbed.
    bone: "rgba(70, 200, 255, 0.95)",
    joint: "#9cdfff",
    label: "#a6e4ff"
  },
  Unknown: CYAN
};

/** Exponential smoothing factor for joint positions, per frame at 60 fps. */
const SMOOTHING = 0.55;

/**
 * Probe for a usable 2D context without producing noisy console output.
 * Returns false in jsdom (no canvas backend installed) and in any browser that
 * has exhausted its canvas quota.
 */
function supportsCanvas2D(canvas) {
  const hasDocument = typeof document !== "undefined";
  if (!hasDocument) return false;
  // jsdom exposes its "not implemented" stubs through this symbol; real browsers
  // do not have it.
  if (typeof canvas.getContext === "function" && !canvas.getContext.name) return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (/jsdom/i.test(ua)) return false;
  return true;
}

export class HandOverlay {
  constructor({ canvas, video, settings }) {
    this.canvas = canvas;
    this.video = video;
    // A 2D context can be unavailable (headless test runners, exhausted canvas
    // quota in some browsers). Tracking still works; only the drawing is lost,
    // so this degrades to a no-op painter instead of taking the app down.
    //
    // jsdom throws *and* logs when a context cannot be created, so probe the
    // environment first and skip the call entirely when it can't work.
    this.ctx = null;
    if (typeof canvas.getContext === "function" && supportsCanvas2D(canvas)) {
      try {
        this.ctx = canvas.getContext("2d");
      } catch {
        this.ctx = null;
      }
    }
    this.available = Boolean(this.ctx);
    this.settings = settings || { showLandmarks: true, showSkeleton: true, mirror: true };
    this.mirror = this.settings.mirror !== false;
    this.hands = [];
    this.handedness = [];
    /** Per-hand interaction glow, driven by main.js: 0 idle .. 1 active. */
    this.activity = [];
    /** Pinch animation phase, advanced by draw() so the ring can animate. */
    this._pulse = 0;
    this._lastFrame = 0;
    /**
     * Smoothed canvas-space positions per hand index, per landmark.
     * Raw MediaPipe joints jitter by a few pixels frame to frame; interpolating
     * toward the new position removes the shimmer without adding visible lag.
     */
    this._smooth = new Map();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();
  }

  updateSettings(settings = {}) {
    Object.assign(this.settings, settings);
    this.mirror = this.settings.mirror !== false;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    if (!this.available) {
      this.width = parent.clientWidth;
      this.height = parent.clientHeight;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
  }

  /** The size descriptor handGeometry needs for this canvas. */
  _metrics() {
    return {
      videoWidth: this.video?.videoWidth || 0,
      videoHeight: this.video?.videoHeight || 0,
      boxWidth: this.width,
      boxHeight: this.height
    };
  }

  /**
   * Map a landmark into canvas pixels, exponentially smoothed.
   * `handIndex`/`landmarkIndex` identify the slot; when they are omitted the raw
   * mapping is returned (used by fingertipPixels for hit-testing, which must not
   * lag behind the pointer).
   */
  smoothed(handIndex, landmarkIndex, point) {
    const key = `${handIndex}:${landmarkIndex}`;
    const raw = this.toCanvas(point);
    if (!raw.inside) return raw;
    const previous = this._smooth.get(key);
    if (!previous) {
      this._smooth.set(key, { x: raw.x, y: raw.y });
      return raw;
    }
    // Frame-rate independent: at 60 fps this is the plain factor, and it eases
    // toward a tighter follow if the loop runs slower.
    const t = 1 - Math.pow(1 - SMOOTHING, Math.max(0.4, this._frameScale || 1));
    previous.x += (raw.x - previous.x) * t;
    previous.y += (raw.y - previous.y) * t;
    return { x: previous.x, y: previous.y, inside: true };
  }

  /** Map a normalised landmark into canvas pixels (crop + mirror aware). */
  toCanvas(point) {
    const metrics = this._metrics();
    // Before metadata arrives there is nothing meaningful to map; fall back to
    // the naive rectangle so the very first frame is not wildly displaced.
    if (!metrics.videoWidth || !metrics.videoHeight) {
      const x = this.mirror ? 1 - point.x : point.x;
      return { x: x * this.width, y: point.y * this.height, inside: true };
    }
    return landmarkToStage(point, metrics, { mirror: this.mirror });
  }

  clear() {
    if (!this.available) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * @param hands        array of 21-landmark arrays
   * @param handedness   array of "Left" | "Right" | "Unknown"
   * @param options      { pinched: boolean[], activity: number[], targets: string[],
   *                       tethers: ({x,y}|null)[] }
   *
   * `tethers` draws a line from the index fingertip to a point in the same
   * canvas space — used to keep the hand visually attached to the component it
   * is moving.
   */
  draw(hands, handedness, {
    pinched = [], activity = [], targets = [], tethers = [],
    depths = [], joints3d = [], viewport = null,
    /**
     * True when the scene-space 3D rigs are drawing the hands. The 2D layer
     * then supplies only what real geometry cannot: the pointer reticle, the
     * pinch burst and the hand labels. Without this, every hand was drawn
     * twice — once in the scene and once on top of it — which doubled both the
     * glow and the CPU cost of the overlay.
     */
    sceneSkeletons = false
  } = {}) {
    if (!this.available) return;
    this.clear();
    if (!this.width || !this.height) return;
    if (!this.settings.showLandmarks) return;

    // Advance the pinch-pulse animation at a fixed rate per frame; the overlay
    // is drawn from the render loop so this matches real time closely enough.
    const now = performance.now();
    const dt = this._lastFrame ? Math.min(0.1, (now - this._lastFrame) / 1000) : 0.016;
    this._lastFrame = now;
    this._pulse += dt;

    (hands || []).forEach((landmarks, index) => {
      const side = handedness?.[index] || "Unknown";
      const colours = HANDS[side] || HANDS.Unknown;
      const isPinched = Boolean(pinched[index]);
      const heat = Math.max(0, Math.min(1, activity[index] ?? (isPinched ? 1 : 0)));

      const depth = depths[index] || null;
      const bones = joints3d[index] || null;

      // Spray of limb bone volumes in projected 3D, then the 2D connective
      // tissue and glowing joints. Drawing bones first keeps joints crisp.
      if (bones && viewport) this._drawBoneVolumes(bones, colours, heat, depth, viewport);
      if (!sceneSkeletons) {
        this._drawSkeleton(landmarks, colours, heat, index, depth);
        this._drawJoints(landmarks, colours, heat, isPinched, index, depth);
      }
      this._drawPinch(landmarks, colours, isPinched, heat, index);
      this._drawPointer(landmarks, colours, isPinched, heat, targets[index], tethers[index], index);
      this._drawLabel(landmarks, colours, side, heat, index);
    });
  }

  /**
   * Depth 0..1 where 1 is nearest the camera, derived from MediaPipe's
   * normalised z (which is roughly wrist-relative and negative toward the lens).
   */
  _depthScale(depth) {
    if (!depth) return 1;
    return 0.82 + Math.max(0, Math.min(1, depth)) * 0.42;
  }

  /**
   * Skeleton with per-bone taper and depth weighting. Each bone is stroked on
   * its own so width and opacity can differ: thicker at the knuckle, thinner at
   * the tip, brighter when that segment is closer to the camera. A soft wide
   * pass underneath gives the glow a bloom-like halo.
   */
  _drawSkeleton(landmarks, colours, heat, handIndex, depth) {
    if (!this.settings.showSkeleton) return;
    const ctx = this.ctx;
    const dScale = this._depthScale(depth);

    // Bone width keyed on the segment's role: the palm arcs are the heaviest,
    // fingertips the lightest.
    const widthFor = (a, b) => {
      const tip = TIP_INDICES.includes(b) || TIP_INDICES.includes(a);
      const palm = a === 0 || b === 0;
      const base = palm ? 5.0 : tip ? 2.0 : 3.4;
      return base * dScale;
    };

    ctx.save();
    ctx.lineCap = "round";

    // Pass 0: a dark backing stroke. Over a bright camera image the cyan alone
    // washes out; this keeps the skeleton readable against a white wall or a
    // window without darkening the whole feed.
    ctx.strokeStyle = "rgba(3, 8, 14, 0.45)";
    ctx.lineWidth = 8.5 * dScale;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = this.smoothed(handIndex, a, landmarks[a]);
      const p2 = this.smoothed(handIndex, b, landmarks[b]);
      if (!p1.inside && !p2.inside) continue;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Pass 1: wide, low-alpha halo.
    ctx.strokeStyle = `rgba(64, 224, 255, ${0.13 + heat * 0.12})`;
    ctx.lineWidth = 11 * dScale;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = this.smoothed(handIndex, a, landmarks[a]);
      const p2 = this.smoothed(handIndex, b, landmarks[b]);
      if (!p1.inside && !p2.inside) continue;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Pass 2: the bones themselves, one stroke each for correct tapering.
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = this.smoothed(handIndex, a, landmarks[a]);
      const p2 = this.smoothed(handIndex, b, landmarks[b]);
      if (!p1.inside && !p2.inside) continue;
      const w = widthFor(a, b);
      const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      gradient.addColorStop(0, `rgba(126, 236, 255, ${0.95})`);
      gradient.addColorStop(1, `rgba(48, 196, 255, ${0.72 + heat * 0.2})`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Limb volumes: draw each bone as a tapered capsule using the projected 3D
   * endpoints supplied by the caller. This is what gives the skeleton an
   * unmistakable "hand in space" read rather than a flat line drawing.
   *
   * `bones` is an array of { a: {x,y,scale}, b: {x,y,scale} } in canvas pixels.
   */
  _drawBoneVolumes(bones, colours, heat, depth, viewport) {
    const ctx = this.ctx;
    const dScale = this._depthScale(depth);
    ctx.save();
    for (const bone of bones) {
      const { a, b } = bone;
      if (!a || !b) continue;
      const wa = Math.max(1.5, a.scale * 0.055 * dScale);
      const wb = Math.max(1.1, b.scale * 0.042 * dScale);
      // Direction and normal, so we can build a quad with tapered ends.
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;

      ctx.beginPath();
      ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
      ctx.lineTo(b.x + nx * wb, b.y + ny * wb);
      ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
      ctx.lineTo(a.x - nx * wa, a.y - ny * wa);
      ctx.closePath();

      const mid = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      mid.addColorStop(0, `rgba(150, 244, 255, ${0.30 + heat * 0.2})`);
      mid.addColorStop(1, `rgba(70, 210, 255, ${0.20 + heat * 0.16})`);
      ctx.fillStyle = mid;
      ctx.fill();

      // Bright edge on the leading side reads as a highlight.
      ctx.strokeStyle = `rgba(190, 250, 255, ${0.30 + heat * 0.25})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x + nx * wa, a.y + ny * wa);
      ctx.lineTo(b.x + nx * wb, b.y + ny * wb);
      ctx.stroke();
    }
    ctx.restore();
    void colours; void viewport;
  }

  /**
   * Glowing joints. Each is a three-layer puck: an outer halo, a coloured ring,
   * and a bright core with a specular dot, which is what makes them read as
   * suspended points in space rather than flat circles.
   */
  _drawJoints(landmarks, colours, heat, isPinched, handIndex, depth) {
    const ctx = this.ctx;
    const dScale = this._depthScale(depth);
    for (let i = 0; i < landmarks.length; i++) {
      const point = this.smoothed(handIndex, i, landmarks[i]);
      if (!point.inside) continue;
      const isTip = TIP_INDICES.includes(i);
      const isWrist = i === 0;
      const radius = (isWrist ? 7.5 : isTip ? 6.2 : 4.4) * dScale + heat * 1.4;

      ctx.save();

      // Outer halo.
      const halo = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3);
      halo.addColorStop(0, `rgba(64, 224, 255, ${0.34 + heat * 0.26})`);
      halo.addColorStop(1, "rgba(64, 224, 255, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 3, 0, Math.PI * 2);
      ctx.fill();

      // Dark backing disc so the joint separates from a bright background.
      ctx.beginPath();
      ctx.fillStyle = "rgba(3, 8, 14, 0.42)";
      ctx.arc(point.x, point.y, radius + 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Ring.
      ctx.beginPath();
      ctx.fillStyle = isTip ? "rgba(190, 250, 255, 0.95)" : "rgba(120, 226, 255, 0.92)";
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Bright core.
      ctx.beginPath();
      ctx.fillStyle = isTip || isWrist ? "#ffffff" : "rgba(232, 253, 255, 0.98)";
      ctx.arc(point.x, point.y, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight, offset up-left.
      ctx.beginPath();
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.arc(point.x - radius * 0.3, point.y - radius * 0.34, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      void isPinched; void colours;
    }
  }

  /** Thumb–index tether plus the closing activation ring. */
  _drawPinch(landmarks, colours, isPinched, heat, handIndex) {
    const thumb = this.smoothed(handIndex, 4, landmarks[4]);
    const index = this.smoothed(handIndex, 8, landmarks[8]);
    if (!thumb.inside && !index.inside) return;

    const ctx = this.ctx;
    const distance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const mid = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };

    // Proximity is expressed relative to the hand's own size so it works at any
    // distance from the camera.
    const palm = this.smoothed(handIndex, 0, landmarks[0]);
    const middle = this.smoothed(handIndex, 9, landmarks[9]);
    const handSpan = Math.max(8, Math.hypot(palm.x - middle.x, palm.y - middle.y));
    const closeness = Math.max(0, Math.min(1, 1 - distance / (handSpan * 2.2)));

    if (isPinched || closeness > 0.25) {
      // Tether between the two fingertips.
      ctx.save();
      ctx.strokeStyle = isPinched
        ? "rgba(94, 242, 192, 0.95)"
        : `rgba(94, 242, 192, ${0.18 + closeness * 0.4})`;
      ctx.lineWidth = isPinched ? 2.4 : 1.4;
      ctx.setLineDash(isPinched ? [] : [3, 5]);
      ctx.beginPath();
      ctx.moveTo(thumb.x, thumb.y);
      ctx.lineTo(index.x, index.y);
      ctx.stroke();
      ctx.restore();
    }

    if (isPinched) {
      // Concentric activation: an expanding ring stamps the moment of closure.
      const phase = this._pulse % 0.9 / 0.9;
      ctx.save();
      ctx.strokeStyle = `rgba(94, 242, 192, ${0.55 * (1 - phase)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, 10 + phase * 26, 0, Math.PI * 2);
      ctx.stroke();

      // Solid core ring.
      ctx.shadowColor = "rgba(94, 242, 192, 0.9)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "rgba(94, 242, 192, 0.22)";
      ctx.strokeStyle = "#5ef2c0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (closeness > 0.05) {
      // Approaching: a ring closes around the midpoint.
      ctx.save();
      ctx.strokeStyle = `rgba(94, 242, 192, ${0.1 + closeness * 0.5})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, 26 - closeness * 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    void colours;
  }

  /** The index fingertip as an interactive pointer: outer glow, ring, crosshair. */
  _drawPointer(landmarks, colours, isPinched, heat, target, tether, handIndex) {
    const tip = this.smoothed(handIndex, 8, landmarks[8]);
    if (!tip.inside) return;

    const ctx = this.ctx;

    // Tether to the object being manipulated: a live link, only while active.
    if (tether && heat > 0.3) {
      const [r, g, b] = colours.pointer;
      ctx.save();
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.25 + heat * 0.45})`;
      ctx.lineWidth = 1.2 + heat * 0.8;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tether.x, tether.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Anchor ring at the component end.
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.5 + heat * 0.4})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(tether.x, tether.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const [r, g, b] = colours.pointer;
    const radius = 9 + heat * 5;

    ctx.save();

    // Soft glow.
    const glow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius * 2.6);
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.45 + heat * 0.35})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Pointer ring.
    ctx.strokeStyle = isPinched ? "#5ef2c0" : `rgba(${r}, ${g}, ${b}, 0.95)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair ticks, so the exact aim point is unambiguous.
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const inner = radius + 3;
      const outer = radius + 8;
      ctx.beginPath();
      ctx.moveTo(tip.x + Math.cos(a) * inner, tip.y + Math.sin(a) * inner);
      ctx.lineTo(tip.x + Math.cos(a) * outer, tip.y + Math.sin(a) * outer);
      ctx.stroke();
    }

    // Centre dot: turns into a filled puck while pinching.
    ctx.fillStyle = isPinched ? "#5ef2c0" : `rgba(${r}, ${g}, ${b}, 1)`;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, isPinched ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();

    // Target label under the pointer.
    if (target) {
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      const text = String(target).toUpperCase().slice(0, 26);
      const w = ctx.measureText(text).width + 14;
      const ty = tip.y + radius + 20;
      ctx.fillStyle = "rgba(4, 10, 16, 0.82)";
      ctx.beginPath();
      ctx.roundRect?.(tip.x - w / 2, ty - 11, w, 17, 5);
      if (ctx.roundRect) ctx.fill();
      ctx.fillStyle = isPinched ? "#5ef2c0" : "#dbe7f1";
      ctx.fillText(text, tip.x, ty + 1.5);
      ctx.textAlign = "left";
    }

    ctx.restore();
  }

  _drawLabel(landmarks, colours, side, heat, handIndex) {
    const wrist = this.smoothed(handIndex, 0, landmarks[0]);
    if (!wrist.inside) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "600 9.5px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = colours.label;
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 4;
    ctx.fillText(`${side.toUpperCase()}${heat > 0.4 ? " · ACTIVE" : ""}`, wrist.x + 10, wrist.y + 18);
    ctx.restore();
  }

  /** Index fingertip in viewport pixels, or null. */
  fingertipPixels(hand) {
    if (!hand) return null;
    return this.toCanvas(hand.indexTip || hand.landmarks?.[8] || { x: 0, y: 0 });
  }

  dispose() {
    this._resizeObserver.disconnect();
  }
}
