# Main → immersive branch: integration review

This is the review requested before PR #6 is merged. It records what was ported from `main`,
what was deliberately discarded, how the conflicts were resolved, what the tests prove, and
what they do not.

**Branch:** `arena/93558f13-holocore` · **PR:** #6 → `main` · **State:** `MERGEABLE` / `CLEAN`

---

## Why the merge was needed

`main` (`b34ea11`) and this branch both descend from `c921532`, but neither descends from the
other — `main` is a single root commit with its own history. Git therefore reported nine
add/add conflicts and the pull request sat `CONFLICTING` / `DIRTY`.

A blind resolution in either direction would have destroyed real work. `main` carried
1,455 lines this branch did not have; this branch carried the entire immersive rewrite
(`handSkeleton3d.js`, `playground.js`, the drawer layout) that `main` did not. So `main` was
**not** merged wholesale. Each file was read, and the useful parts were re-implemented on the
immersive architecture.

---

## Ported from `main`

| Feature | Where it now lives | Note |
| --- | --- | --- |
| Audio chimes (6 cues) | `chimes.js` — new module | `main` bundled the synth inside its voice class. The sounds fire on gestures and spawns too, so it was extracted. Same envelopes. |
| Colour voice commands | `voiceControl.js` + `handleVoiceIntent` | Ten-name `COLOR_PALETTE`, exported so voice, swatches and the colour input share one list. |
| Wireframe / solid / matte / metallic voice | `voiceControl.js`, `modelManager.js`, `playground.js` | Applies to a selected prop, else the selected part, else the whole assembly. |
| View voice commands | `voiceControl.js` | grid, shadows, orbit, isolate, focus, deselect, fullscreen. |
| Numeric explode | `voiceControl.js` | *"explode 40 percent"* sets the amount; bare *"explode"* still switches mode. |
| Part material control | `modelManager.js` | `setPartMaterial`, `getPartMaterial`, `toggleWireframe`, plus a scene-wide mesh lookup. |
| Prop material control | `playground.js` | `setMaterial` / `setColor` / `setWireframe` / `getMaterial` — props own their own materials. |
| Inspector colour picker + swatches | `componentInspector.js` | Wired to the selected prop or part. |
| Roughness / metalness sliders | `componentInspector.js` | Live, and they reach the real material. |
| Transform readout | `componentInspector.js` | Position / rotation / scale, and it actually updates. |
| Clear-all control | `index.html`, `main.js` | Beside import in the library drawer. |
| Voice + audio switches | `index.html`, `main.js`, `store.js` | Persisted; turning cues on plays one. |
| README voice + properties sections | `README.md` | Every documented phrase is now a test. |

Two bugs in `main` were fixed while porting rather than reproduced:

- Its transform readout rendered once into `innerHTML` and never updated, so it went stale the
  moment anything moved. It now updates in place.
- Its inspector never showed the material controls for a playground object at all, because it
  bailed out to the empty state when `getComponentData()` returned nothing. Props and imported
  meshes now get a real panel.

---

## Deliberately not ported

| Discarded | Why |
| --- | --- |
| Three-column `--left-w / 1fr / --right-w` grid | The rejected permanent dashboard. Panels stay as independently collapsible drawers. |
| `modelManager.addPlaygroundObject` / `clearPlaygroundObjects` | Superseded by `playground.js`. Keeping both would mean two competing object registries. |
| `pg-add-cube` … `pg-clear` grid markup | The primitive palette already spawns all seven shapes and reports a count. Only the missing clear action was added. |
| `VoiceController` class itself | `main`'s recogniser; this branch's `VoiceControl` is the newer implementation with mode-gated gesture labels. Its grammar, palette and cues were ported instead. |
| `voice-hud` / `pill-voice` / `status-voice` markup | Duplicates. The voice chip already shows status, the heard phrase and listening state. |
| `.voice-hud`, `.playground-grid`, `.dot`, `.btn-danger` CSS | Styling for the discarded markup. The `.prop-*` and `.prop-group` styles it needed *were* ported. |

No file that exists on `main` was deleted. Every one was checked after the merge.

---

## How the conflicts were resolved

Resolved **in favour of this branch** (`-X ours`), deliberately and only *after* the port:
by that point `main`'s useful content was already present here in a re-implemented form, so
taking the branch side discarded nothing. The merge commit `ab7a484` records `b34ea11` as its
second parent, giving the history a real shared ancestor.

The merged tree is **byte-identical** to the branch before the merge (`git diff 8f3b17a HEAD`
is empty). The merge adds history, not code.

`main` is untouched and `b34ea11` remains reachable.

---

## Verification

All four suites, run on the merged tree:

```
476 checks across 21 sections   PASSED
100 UI checks                   PASSED
 48 boot checks                 PASSED
161 full-stack checks           PASSED
```

New coverage added during the port:

- **5j** material controls render and act on the selection — swatch, picker, slider, switch,
  and a voice colour, all asserted against the object's real material.
- **5k** clear-all and object creation — all seven primitives, and the counter following.
- **5l** voice and audio preferences round-trip through storage and the synth.
- **5m** the transform readout follows the object and refreshes without re-rendering.
- **5n** every README voice phrase and every palette colour parses.
- **5o** a stub `SpeechRecognition` drives the real `onresult` handler: a spoken spawn,
  colour, wireframe on/off, mode switch, clear, and the chip showing the words heard.

This is the first coverage of the *recognition wiring* — transcript in, scene change out.
Earlier tests only exercised intents.

---

## What is not verified

Stated plainly, because passing tests are not the same as a working application:

- **No browser.** There is no browser in this sandbox (`playwright install` fails to download).
  Nothing has been run as a real page.
- **No GPU.** Rendering is exercised through a stub renderer in jsdom. No pixel has been shaded.
- **No webcam.** No real MediaPipe landmark stream has been processed. Tracking is tested with
  synthetic landmark fixtures.
- **No microphone.** The speech engine is a stub. It proves the wiring, not transcription
  accuracy.
- **No audio device.** The chimes are asserted to be enabled and routed, never heard.
- **No cross-browser check.** Voice needs Chrome or Edge; that is untested here.

Visual verification was done with CPU rasterisers only:

- `tools/visual/inspector-panel.png` — the real inspector DOM laid out from the real stylesheet.
- `tools/visual/layout-drawers.png` — drawers, toolbar, voice chip and clear-all in place.
- `tools/visual/rig3d.png` — the 3D hand rig, previously verified.

These catch the wrong-place / zero-size / hidden-behind-something class of bug. They are not
screenshots and do not prove the interface looks right.

**Recommendation:** the application should be opened in Chrome with a webcam before anyone
relies on it, and the page should be served over HTTPS or `localhost` — MediaPipe and the Web
Speech API both refuse to run otherwise.
