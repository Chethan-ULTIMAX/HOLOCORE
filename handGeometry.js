/**
 * HOLOCORE — handGeometry.js
 * -----------------------------------------------------------------------------
 * Pure coordinate mapping between the camera image, the DOM box that shows it,
 * and normalised device coordinates for the 3D viewport.
 *
 * This module exists because getting this wrong is invisible: a pointer that is
 * "roughly right" in the middle of the screen drifts badly at the edges, and
 * nobody can tell whether it is a tracking problem or a maths problem. All the
 * mapping lives here, is pure, and is unit-tested against known crop cases.
 *
 * THE THREE SPACES
 *
 *   landmark  MediaPipe output: x,y in 0..1 of the *source camera frame*,
 *             origin top-left, NOT mirrored.
 *
 *   stage     pixels inside the element that displays the video. The video is
 *             drawn with `object-fit: cover`, so the source frame is scaled to
 *             fill the box and the overflow is cropped symmetrically. A point at
 *             landmark (x, y) lands somewhere that depends on the crop.
 *
 *   ndc       the 3D viewport's -1..1 space, Y up. This is what `raycast()`
 *             expects.
 *
 * MIRRORING HAPPENS EXACTLY ONCE
 *
 * The video is displayed mirrored (`transform: scaleX(-1)` or an equivalent
 * negative-X scale on the canvas). So the *displayed* x of a landmark is
 * `1 - x` of its source x. Every function here takes `mirror` and applies it in
 * one place. Nothing downstream mirrors again — that double-flip is the classic
 * cause of a pointer that moves the wrong way.
 */

/** Clamp helper kept local so this module has no dependencies at all. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * How a source frame of `videoW × videoH` is laid out inside a `boxW × boxH`
 * display box under `object-fit: cover`.
 *
 * Returns the scale factor, the size of the *visible* region in source pixels,
 * and the offset of that region's top-left corner in source pixels. This is the
 * same computation as the CSS cover fit, expressed in source-pixel space so it
 * can be inverted exactly.
 */
export function coverFit(videoW, videoH, boxW, boxH) {
  const vw = Math.max(1, videoW);
  const vh = Math.max(1, videoH);
  const bw = Math.max(1, boxW);
  const bh = Math.max(1, boxH);

  // Cover = the larger of the two scale factors, so the frame fills the box and
  // overflows on one axis.
  const scale = Math.max(bw / vw, bh / vh);

  const visibleW = bw / scale;   // how much of the source width is on screen
  const visibleH = bh / scale;   // how much of the source height is on screen

  return {
    scale,
    visibleW,
    visibleH,
    // Overflow is distributed symmetrically because object-fit centres the image.
    offsetX: (vw - visibleW) / 2,
    offsetY: (vh - visibleH) / 2
  };
}

/**
 * Map a MediaPipe landmark into pixels inside the display box.
 *
 * @param {{x:number,y:number}} landmark normalised source-frame point
 * @param {{videoWidth:number, videoHeight:number, boxWidth:number, boxHeight:number}} size
 * @param {{mirror?:boolean}} options
 * @returns {{x:number, y:number, inside:boolean}} pixels in the display box
 */
export function landmarkToStage(landmark, size, { mirror = true } = {}) {
  const fit = coverFit(size.videoWidth, size.videoHeight, size.boxWidth, size.boxHeight);

  // Source pixels for this landmark.
  const sourceX = landmark.x * size.videoWidth;
  const sourceY = landmark.y * size.videoHeight;

  // Position relative to the visible (cropped) region, then scaled to the box.
  const stageX = (sourceX - fit.offsetX) * fit.scale;
  const stageY = (sourceY - fit.offsetY) * fit.scale;

  // Mirror in *display* space: the video is flipped, so the pixel column that
  // would have been at stageX appears at boxWidth - stageX.
  const x = mirror ? size.boxWidth - stageX : stageX;

  return {
    x,
    y: stageY,
    // Whether the landmark is actually within the visible (non-cropped) area.
    // Outside this, the hand is off-screen and the pointer should not be drawn.
    inside:
      stageX >= 0 && stageX <= size.boxWidth &&
      stageY >= 0 && stageY <= size.boxHeight
  };
}

/**
 * Map a MediaPipe landmark all the way to the viewport's NDC space.
 *
 * `stageBox` is the rectangle that displays the camera image (full workspace or
 * the small card), `viewport` is the 3D canvas rectangle. When the camera fills
 * the workspace these are the same box, but they are passed separately so the
 * small-preview mode maps correctly too.
 *
 * @returns {{x:number, y:number, stage:{x:number,y:number,inside:boolean}}}
 */
export function landmarkToNdc(landmark, size, viewport = null, { mirror = true } = {}) {
  const stage = landmarkToStage(landmark, size, { mirror });

  // Fraction across the camera image box.
  const u = stage.x / Math.max(1, size.boxWidth);
  const v = stage.y / Math.max(1, size.boxHeight);

  // The 3D viewport is what we raycast against. If we were given one, map the
  // same fraction into it; otherwise assume the camera box *is* the viewport.
  const vp = viewport || { width: size.boxWidth, height: size.boxHeight, left: 0, top: 0 };
  const pixelX = clamp(u, 0, 1) * vp.width;
  const pixelY = clamp(v, 0, 1) * vp.height;

  return {
    // NDC: x right, y UP (hence the negation on y).
    x: (pixelX / Math.max(1, vp.width)) * 2 - 1,
    y: -((pixelY / Math.max(1, vp.height)) * 2 - 1),
    pixel: { x: pixelX, y: pixelY },
    stage
  };
}

/**
 * Convert a screen-space pointer delta (CSS pixels) into world units at the
 * depth of the 3D target, so dragging a hand across the screen moves the model
 * by the same distance the pointer travels.
 *
 * This uses the camera's visible height at the target depth, which is what makes
 * the object appear to stay under the fingertip regardless of camera distance.
 */
export function pixelsToWorld(pixelDelta, { viewportHeight, fovDegrees, distance }) {
  const worldHeight = 2 * Math.tan((fovDegrees * Math.PI) / 360) * Math.abs(distance);
  const perPixel = worldHeight / Math.max(1, viewportHeight);
  return { x: pixelDelta.x * perPixel, y: -pixelDelta.y * perPixel };
}

export { clamp };
