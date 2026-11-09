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

const HANDS = {
  Left: {
    bone: "rgba(86, 226, 255, 0.95)",
    joint: "#a9f0ff",
    tip: "#e8fdff",
    pointer: [86, 226, 255],
    label: "#8fe8ff"
  },
  Right: {
    bone: "rgba(190, 148, 255, 0.95)",
    joint: "#d5c2ff",
    tip: "#f4ecff",
    pointer: [190, 148, 255],
    label: "#cbadff"
  },
  Unknown: {
    bone: "rgba(150, 205, 235, 0.95)",
    joint: "#d8ecf8",
    tip: "#ffffff",
    pointer: [150, 205, 235],
    label: "#cfe4f2"
  }
};

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
  draw(hands, handedness, { pinched = [], activity = [], targets = [], tethers = [] } = {}) {
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

      this._drawSkeleton(landmarks, colours, heat);
      this._drawJoints(landmarks, colours, heat, isPinched);
      this._drawPinch(landmarks, colours, isPinched, heat);
      this._drawPointer(landmarks, colours, isPinched, heat, targets[index], tethers[index]);
      this._drawLabel(landmarks, colours, side, heat);
    });
  }

  _drawSkeleton(landmarks, colours, heat) {
    if (!this.settings.showSkeleton) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2.2 + heat * 1.4;
    ctx.lineCap = "round";
    ctx.strokeStyle = colours.bone;
    ctx.shadowColor = colours.bone;
    ctx.shadowBlur = 6 + heat * 14;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = this.toCanvas(landmarks[a]);
      const p2 = this.toCanvas(landmarks[b]);
      if (!p1.inside && !p2.inside) continue;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawJoints(landmarks, colours, heat, isPinched) {
    const ctx = this.ctx;
    for (let i = 0; i < landmarks.length; i++) {
      const point = this.toCanvas(landmarks[i]);
      if (!point.inside) continue;
      const isTip = TIP_INDICES.includes(i);
      // Fingertips read as pointers, not dots: bigger, brighter, haloed.
      const radius = isTip ? 4.4 + heat * 1.8 : 2.4;
      ctx.save();
      if (isTip) {
        ctx.shadowColor = colours.pointer;
        ctx.shadowBlur = 10 + heat * 16;
      }
      ctx.beginPath();
      ctx.fillStyle = isTip ? colours.tip : colours.joint;
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      void isPinched;
    }
  }

  /** Thumb–index tether plus the closing activation ring. */
  _drawPinch(landmarks, colours, isPinched, heat) {
    const thumb = this.toCanvas(landmarks[4]);
    const index = this.toCanvas(landmarks[8]);
    if (!thumb.inside && !index.inside) return;

    const ctx = this.ctx;
    const distance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const mid = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };

    // Proximity is expressed relative to the hand's own size so it works at any
    // distance from the camera.
    const palm = this.toCanvas(landmarks[0]);
    const middle = this.toCanvas(landmarks[9]);
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
  _drawPointer(landmarks, colours, isPinched, heat, target, tether) {
    const tip = this.toCanvas(landmarks[8]);
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

  _drawLabel(landmarks, colours, side, heat) {
    const wrist = this.toCanvas(landmarks[0]);
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
