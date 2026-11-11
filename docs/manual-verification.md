# HOLOCORE — manual verification checklist

Everything in this pass was verified with deterministic simulations: numeric
suites over the real modules, and the real `main.js` booted in jsdom against the
real 3D workspace. Nothing here claims a webcam, GPU or audio test.

There is no browser, webcam, microphone or audio device in the environment this
work was done in (`playwright install chromium` fails), so the items below are
the things that genuinely need a human in front of a real camera. They are
ordered by what is most likely to break.

Run with `npm start` and open `http://localhost:8080` in Chrome or Edge, on
`localhost` or HTTPS, with camera permission granted.

---

## 1. Camera views (§3) — 2 minutes, no hands needed

| Step | Expected |
|---|---|
| Click each of the seven faces of the orientation cube | Camera moves to that view over ~0.8 s, smoothly |
| Watch the model during the move | It rotates in place, it does not tumble or roll |
| Click **TOP** | Looking straight down. The model's front faces the bottom of the screen. The view is level — no diagonal roll |
| Click **BOT** | Looking straight up from underneath, level |
| Orbit by dragging after a view switch | Orbiting works immediately; the label under the cube changes to `FREE` and no face is lit |
| Orbit back near Front by hand | The `FRONT` face lights up again |
| Spawn a cube, drag it well off-centre, then click **FRONT** | The selected cube is centred, not the launch vehicle behind it |
| Select nothing, click **FRONT** | The whole model is framed |
| Press `Shift+1`, `Shift+2`, `Shift+3` | Front, Top, Isometric |
| Narrow the window under 820 px with the Properties drawer open | The cube fades out rather than sitting under the panel |

## 2. Camera-relative dragging (§4) — 5 minutes, mouse

| Step | Expected |
|---|---|
| Front view, select the cube, drag it right and up | Moves +X and +Y. Tracks the cursor, no jump on grab |
| Top view, drag right and up | Moves +X and **−Z**. Does *not* move towards/away from the camera |
| Left view, drag right | Moves along Z (across the screen), not X |
| Any view, orbit to a diagonal, drag | Moves along the screen, following the camera |
| Start a drag, keep the button down, and orbit with the other hand / pinch-zoom | The object does **not** slide. It stays put until you let go |
| Release | No jump, no drift |

## 3. Gizmo (§5) — 5 minutes, mouse then hands

| Step | Expected |
|---|---|
| Select a cube | Red/green/blue arrows plus three faint plane squares appear on it |
| Deselect | They disappear |
| Drag the red arrow | Moves on X only. No sideways drift at any camera angle |
| Hover a handle | It brightens before you press |
| Orbit while a handle is being dragged | The camera does **not** orbit. The handle owns the pointer |
| Switch to Top view, drag the red arrow | Still exactly X |
| Switch to Front view, try the blue (Z) arrow | It is pointing at you. Dragging does nothing rather than flinging the object — expected, use Top or a diagonal view for Z |
| Zoom far out / far in | Handles stay a usable on-screen size |
| Try the plane squares | Moves in two axes, blocked on the third |

## 4. Depth (§6) — 4 minutes, hands, needs a webcam

| Step | Expected |
|---|---|
| Select a cube | Gizmo appears |
| Hold a flat open palm, still, for about a second | Nothing moves at rest |
| Move that open palm slowly towards the camera | The cube moves forward (+Z). Move away, it moves back |
| Wiggle the hand without moving it closer | No movement — the dead zone absorbs it |
| Pinch instead of holding an open palm | Depth never engages. Pinch only grabs |
| Move the hand closer faster / slower | Proportional travel, not a fixed step |
| Take the hand out of frame while armed | On return, it re-calibrates from wherever the hand now is, rather than jumping |
| Settings → object depth sensitivity | Higher value means more travel for the same hand movement |

## 5. Hands (§2, §7, §8) — 6 minutes

| Step | Expected |
|---|---|
| Hold up your **right** hand | The skeleton matches your right hand — thumb on the same side as your real thumb. It does not mirror |
| Hold up your **left** hand | Likewise. Both hands at once: each is correct independently |
| Move a hand quickly, then stop | The skeleton arrives within ~100 ms and does not overshoot or wobble |
| Curl and extend fingers quickly | Fingers keep up; joints never look bent in a direction they cannot bend |
| Cover a hand briefly with the other | Tracking resumes cleanly, no skeleton stuck mid-air |
| Show two open palms far apart | Nothing is grabbed, nothing scales. Hovering only |
| Pinch one hand while the other is open | That one hand grabs. The open one does not steal control |
| Pinch with the left, then also pinch with the right while dragging | The hand that started keeps control; it does not swap mid-drag |
| Two-hand pinch | Scale / rotate works as before |

## 6. Translation gizmo by hand (§5) — 4 minutes, hands

| Step | Expected |
|---|---|
| Move the fingertip over a red arrow | It brightens |
| Pinch on the arrow and move | The object follows that axis only. It does not also drag the object behind |
| Release | Clean release, no drift |
| Pinch somewhere else on the object, not on a handle | Normal camera-relative drag, as in §2 |

## 7. Regressions (§15) — 8 minutes

Voice: say "add a cube", "select the cube", "make it red", "rotate it", "load the
orbital tug". Each should act once and chime. Voice must be unchanged.

Workspace: switch models from the library, explode and reassemble, select a
component and check the inspector, change material, spawn / duplicate / delete,
check the outliner updates, try the keyboard shortcuts, import a glTF, play an
animation.

App: switch between camera preview and workspace mode, change a setting and
reload to confirm it persisted, open and close both drawers, resize to phone
width and back.

---

## Known limitations, stated plainly

- **Blue (Z) in a pure front/back view:** an axis pointing at the camera has no
  measurable motion from that angle. The handle refuses rather than flinging the
  object. Use Top/Bottom or an angled view for Z.
- **Depth by hand is a proxy, not a measurement.** It is relative, calibrated per
  session, and it needs the deliberate open-palm hold to engage. The gizmo's Z
  handle is the exact method.
- **No orthographic camera.** The brief made it optional; the hand projection
  pipeline assumes perspective and adapting it was out of scope for a pass that
  must not rebuild the architecture.
- **Smoothing adds ~100 ms of latency by design.** It is time-based, so a lower
  frame rate does not make it lag further, but it is still latency.
- **Depth by hand moves playground props only.** A selected model component can
  be moved with the gizmo but not with the palm-size gesture, and the gesture
  refuses to arm rather than pretending to work.
