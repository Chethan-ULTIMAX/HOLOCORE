/**
 * HOLOCORE — handOverlay.js
 * -----------------------------------------------------------------------------
 * Draws the real MediaPipe hand landmarks on top of the live camera preview and
 * projects the index fingertip into the 3D viewport as an aiming reticle.
 *
 * Mirroring note: the video element is CSS-mirrored, and the overlay applies the
 * same mirror to landmark coordinates, so the skeleton always lines up with the
 * hand the user sees. Landmark coordinates stay un-mirrored in the data model;
 * only the drawing (and the pointer mapping in main.js) is mirrored.
 */

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const HAND_COLOURS = {
  Left: { bone: "rgba(94, 234, 255, 0.92)", joint: "#9df3ff", tip: "#ffffff" },
  Right: { bone: "rgba(167, 139, 250, 0.92)", joint: "#cabfff", tip: "#ffffff" },
  Unknown: { bone: "rgba(148, 200, 230, 0.9)", joint: "#d5e9f6", tip: "#ffffff" }
};

const TIPS = [4, 8, 12, 16, 20];

export class HandOverlay {
  constructor({ canvas, video, settings }) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext("2d");
    this.settings = settings || { showLandmarks: true, showSkeleton: true, mirror: true };
    this.mirror = this.settings.mirror !== false;
    this.hands = [];
    this.handedness = [];
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

  /** Map normalised landmark space into canvas pixels, applying mirroring. */
  toCanvas(point) {
    const x = this.mirror ? 1 - point.x : point.x;
    return { x: x * this.width, y: point.y * this.height };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  draw(hands, handedness, { pinched = [] } = {}) {
    this.clear();
    if (!this.width || !this.height) return;
    if (!this.settings.showLandmarks) return;

    hands.forEach((landmarks, index) => {
      const side = handedness?.[index] || "Unknown";
      const colours = HAND_COLOURS[side] || HAND_COLOURS.Unknown;
      const isPinched = Boolean(pinched[index]);

      if (this.settings.showSkeleton) {
        this.ctx.lineWidth = 2.4;
        this.ctx.lineCap = "round";
        this.ctx.strokeStyle = colours.bone;
        this.ctx.shadowColor = colours.bone;
        this.ctx.shadowBlur = 8;

        this.ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          const p1 = this.toCanvas(landmarks[a]);
          const p2 = this.toCanvas(landmarks[b]);
          this.ctx.moveTo(p1.x, p1.y);
          this.ctx.lineTo(p2.x, p2.y);
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
      }

      // Joints
      for (let i = 0; i < landmarks.length; i++) {
        const p = this.toCanvas(landmarks[i]);
        const isTip = TIPS.includes(i);
        const radius = isTip ? 4.6 : 2.6;
        this.ctx.beginPath();
        this.ctx.fillStyle = isTip ? colours.tip : colours.joint;
        this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // Pinch indicator between thumb tip and index tip
      const thumb = this.toCanvas(landmarks[4]);
      const index4 = this.toCanvas(landmarks[8]);
      const distance = Math.hypot(thumb.x - index4.x, thumb.y - index4.y);
      if (isPinched) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = "#5ef2c0";
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 4]);
        this.ctx.moveTo(thumb.x, thumb.y);
        this.ctx.lineTo(index4.x, index4.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        const mid = { x: (thumb.x + index4.x) / 2, y: (thumb.y + index4.y) / 2 };
        this.ctx.beginPath();
        this.ctx.fillStyle = "rgba(94, 242, 192, 0.22)";
        this.ctx.strokeStyle = "#5ef2c0";
        this.ctx.lineWidth = 2;
        this.ctx.arc(mid.x, mid.y, 14, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
      } else if (distance < 48) {
        // Proximity ring shows how close the pinch is to triggering.
        const t = 1 - distance / 48;
        this.ctx.beginPath();
        this.ctx.strokeStyle = `rgba(94, 242, 192, ${0.15 + t * 0.4})`;
        this.ctx.lineWidth = 1.5;
        this.ctx.arc(thumb.x, thumb.y, 8 + t * 10, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      // Hand label near the wrist
      const wrist = this.toCanvas(landmarks[0]);
      this.ctx.font = "600 10px Inter, system-ui, sans-serif";
      this.ctx.fillStyle = colours.joint;
      this.ctx.fillText(`${side.toUpperCase()} HAND`, wrist.x + 10, wrist.y + 16);
    });
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
