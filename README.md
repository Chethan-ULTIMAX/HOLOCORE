# HOLOCORE

**A spatial engineering workspace for interactive 3D model inspection and natural manipulation.**

HOLOCORE is an experimental, browser-based 3D engineering workspace built with JavaScript and [Three.js](https://threejs.org/). The project aims to make working with 3D assemblies feel more direct and intuitive through interactive component inspection, spatial controls, and eventually hand gestures and AI-assisted workflows.

> **Current status:** Early prototype. The current scene uses a procedurally generated demonstration rocket assembly; real model importing and hand tracking are planned, not yet implemented.

## Current features

- Interactive 3D viewport with orbit, zoom, and camera damping.
- Procedurally generated multi-part demonstration assembly.
- Component Explorer listing individual meshes.
- Component selection from the explorer or directly in the 3D viewport.
- Cyan bounding-box highlighting for the selected component.
- Component Inspector showing available metadata, world position, bounding dimensions, vertex count, and triangle count.
- Focus camera on the selected component.
- Isolate a selected component and restore the other components.
- Animated exploded view and reassembly.
- Reset the selection and camera view.

The displayed geometry dimensions are currently in **scene units**, not verified real-world engineering measurements. The demonstration component metadata is placeholder data.

## Tech stack

- JavaScript (ES modules)
- [Three.js](https://threejs.org/)
- HTML
- CSS

Three.js is loaded from jsDelivr through an import map. No npm installation or build step is currently required, but an internet connection is needed to load the library.

## Run locally

1. Clone the repository:

   ```bash
   git clone https://github.com/Chethan-ULTIMAX/HOLOCORE.git
   cd HOLOCORE
   ```

2. Start a local static web server. With Python installed:

   ```bash
   python -m http.server 8000
   ```

   On Windows, `py -m http.server 8000` also works.

3. Open [http://localhost:8000](http://localhost:8000) in your browser.

Use a local server rather than opening `index.html` directly so browser ES modules load correctly.

## Controls

| Action | Control |
|---|---|
| Rotate the view | Click and drag in the 3D viewport |
| Zoom | Scroll |
| Select a component | Click a component in the viewport or Component Explorer |
| Focus | Select a component, then choose **Focus** |
| Isolate | Select a component, then choose **Isolate** |
| Restore visibility | Choose **Show All** |
| Explode / reassemble | Choose **Explode** / **Reassemble** |
| Reset | Choose **Reset** |

## Project structure

```text
HOLOCORE/
├── assets/
│   ├── models/
│   └── textures/
├── animations.js
├── componentInspector.js
├── engineeringData.js
├── gestures.js
├── handTracking.js
├── index.html
├── main.js
├── modelManager.js
└── styles.css
```

The current working prototype is centered on `index.html`, `main.js`, `componentInspector.js`, and `styles.css`. Other modules and asset folders are reserved for planned development.

## Roadmap

- [ ] Import real 3D models (GLB / glTF).
- [ ] Preserve and inspect nested model hierarchies.
- [ ] Improve component metadata and engineering data handling.
- [ ] Add more capable measurements, annotations, and cross-section tools.
- [ ] Add natural webcam-based hand tracking and gesture manipulation.
- [ ] Improve rendering, lighting, and animation.
- [ ] Explore an AI integration layer and MCP interface.
- [ ] Add voice interaction after the core workspace and interaction model are stable.

## Project philosophy

HOLOCORE is being developed around a simple idea: **3D engineering work should feel natural.**

The priority is to build a useful foundation for inspecting and manipulating real assemblies first. More advanced visual effects, voice interaction, and AI control will build on that foundation.

---

*HOLOCORE is an experimental project under active development.*
