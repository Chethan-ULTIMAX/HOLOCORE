/**
 * HOLOCORE — modelFactory.js
 * -----------------------------------------------------------------------------
 * Procedural geometry for every assembly in the model library.
 *
 * Conventions
 *  - Y is up for every assembly unless noted; flat assemblies (PCB, CPU) lie in
 *    the XZ plane so they read correctly from the default camera above.
 *  - Outer casings are built as *cutaways* (half shells / open fronts). That is
 *    how engineering models are normally shown, and it means the internals that
 *    the inspector describes are actually visible instead of hidden inside an
 *    opaque box.
 *  - Proportions follow the real machine class, so the geometry reads as that
 *    machine rather than a generic stack of primitives.
 *  - Every selectable part is registered against a `partId` that exists in
 *    engineeringData.js; tools/validate.js enforces both directions.
 */

import * as THREE from "three";
import { MODEL_LIBRARY } from "./engineeringData.js";

/* ------------------------------------------------------------------------- */
/* MATERIALS                                                                 */
/* ------------------------------------------------------------------------- */

const materialCache = new Map();

export function surface(color, {
  metalness = 0.6,
  roughness = 0.42,
  emissive,
  emissiveIntensity = 0,
  opacity,
  transparent = false,
  side = THREE.FrontSide
} = {}) {
  const key = [color, metalness, roughness, emissive, emissiveIntensity, opacity, transparent, side].join("|");
  if (materialCache.has(key)) return materialCache.get(key);
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive: emissive ?? 0x000000,
    emissiveIntensity,
    transparent,
    opacity: opacity ?? 1,
    envMapIntensity: 0.9,
    side
  });
  materialCache.set(key, material);
  return material;
}

/* ------------------------------------------------------------------------- */
/* GEOMETRY HELPERS                                                          */
/* ------------------------------------------------------------------------- */

/** Add a child and return the CHILD (three's .add returns the parent). */
function put(parent, child) {
  parent.add(child);
  return child;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 32, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const ring = (r, tube, seg = 48) => new THREE.TorusGeometry(r, tube, 10, seg);
const sphere = (r, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);

/** Lathe from a [[radius, y], ...] profile, rotating about Y. */
function lathe(profile, segments = 56) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments
  );
}

/**
 * Half-pipe shell used for cutaway casings, laid along the X axis.
 * The opening faces +Z so it reads as a cutaway from the default camera.
 */
function halfShellX(radius, length, { thickness = 0.03, segments = 40 } = {}) {
  // Cylinder(θ) starts at +X and sweeps toward +Z, so θ∈[0,π] is the half that
  // faces +Z. Rotate about Z to lay it along X; that leaves the opening on +Z,
  // which is the side the default camera looks from.
  const outer = new THREE.CylinderGeometry(radius, radius, length, segments, 1, true, 0, Math.PI);
  // CylinderGeometry sweeps theta from +Z toward +X, so sweeps 0..π cover the
  // +X half. Lay the axis along X (rotateZ) and roll the shell to the -Z half
  // (rotateX) so the missing half — the cutaway — faces the camera at +Z.
  outer.rotateZ(Math.PI / 2);
  outer.rotateX(-Math.PI / 2);
  void thickness;
  return outer;
}

/**
 * Tapered, twisted blade skin built as one continuous strip.
 *
 * `stations` is [{ r, chord, thick, twist }] in metres up the blade axis (+Y).
 * Each station contributes a thin rectangular aerofoil section; consecutive
 * sections are joined with quads, so the blade tapers smoothly instead of
 * showing the steps you get from stacking boxes of different widths.
 */
function bladeGeometry(stations, { closedTip = true, closedRoot = true } = {}) {
  const positions = [];
  const indices = [];
  const corner = (station) => {
    const c = station.chord / 2;
    const t = station.thick / 2;
    const sin = Math.sin(station.twist ?? 0);
    const cos = Math.cos(station.twist ?? 0);
    // (x, z) rotated about Y, then lifted to the station radius.
    return [
      [ t * cos - c * sin, station.r,  t * sin + c * cos],  // leading, +x
      [ t * cos + c * sin, station.r,  t * sin - c * cos],  // trailing, +x
      [-t * cos + c * sin, station.r, -t * sin - c * cos],  // trailing, -x
      [-t * cos - c * sin, station.r, -t * sin + c * cos]   // leading, -x
    ];
  };

  const rings = stations.map(corner);
  for (const ring of rings) {
    const base = positions.length / 3;
    for (const p of ring) positions.push(p[0], p[1], p[2]);
    void base;
  }
  // Side walls.
  for (let r = 0; r < rings.length - 1; r++) {
    const a = r * 4;
    const b = (r + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      indices.push(a + k, b + k, b + k2);
      indices.push(a + k, b + k2, a + k2);
    }
  }
  // Caps.
  const cap = (ringIndex, flip) => {
    const a = ringIndex * 4;
    if (flip) {
      indices.push(a + 0, a + 1, a + 2, a + 0, a + 2, a + 3);
    } else {
      indices.push(a + 0, a + 2, a + 1, a + 0, a + 3, a + 2);
    }
  };
  if (closedTip) cap(rings.length - 1, true);
  if (closedRoot) cap(0, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Place a pinion and a gear so their teeth mesh.
 *
 * `pitch` is the radius at which the teeth roll, which for the profile used by
 * gearGeometry() is slightly inside the tooth tip. Two gears mesh when the
 * distance between their axes equals the sum of their pitch radii, so the
 * positions are derived rather than eyeballed.
 */
function meshPair(parent, { x, y, radius, teeth, thickness, bore, material, pitch = 0.92 }) {
  const gear = new THREE.Mesh(gearGeometry(radius, teeth, thickness, bore), material);
  gear.position.set(x, y, 0);
  parent.add(gear);
  return radius * pitch;
}

/** Half-cylinder cutaway shell standing vertically (open toward +Z). */
function halfShellY(radius, height, { segments = 40 } = {}) {
  // Same convention: keep the shell on the far (-Z) side so the cutaway opens
  // toward the camera.
  const shell = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true, 0, Math.PI);
  shell.rotateY(Math.PI / 2);
  return shell;
}

/** Extruded spur gear with a bore. */
function gearGeometry(radius, teeth, thickness, bore = 0.16) {
  const shape = new THREE.Shape();
  const inner = radius * 0.86;
  const step = (Math.PI * 2) / teeth;

  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const points = [
      [inner, a0 + step * 0.02],
      [radius, a0 + step * 0.28],
      [radius, a0 + step * 0.55],
      [inner, a0 + step * 0.82]
    ];
    points.forEach(([r, a], index) => {
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0 && index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: Math.min(0.01, thickness * 0.2),
    bevelSize: Math.min(0.01, thickness * 0.2),
    bevelSegments: 2,
    curveSegments: 10
  });
  geometry.center();
  geometry.rotateX(-Math.PI / 2); // lie flat in XZ, axis along Y
  return geometry;
}

/** Closed tube loop through the given points. */
function tubeLoop(points, radius = 0.03, tubularSegments = 140) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(p => new THREE.Vector3(...p)),
    true,
    "catmullrom",
    0.25
  );
  return new THREE.TubeGeometry(curve, tubularSegments, radius, 8, true);
}

/** Open pipe through the given points. */
function tubePath(points, radius = 0.03, tubularSegments = 80) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(p => new THREE.Vector3(...p)),
    false,
    "catmullrom",
    0.2
  );
  return new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
}

/** A ring of repeated meshes (bolts, injectors, vanes). */
function ringOf(geometry, material, count, radius, { axis = "y", offset = 0, tilt = 0 } = {}) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const mesh = new THREE.Mesh(geometry, material);
    if (axis === "y") mesh.position.set(Math.cos(a) * radius, offset, Math.sin(a) * radius);
    else if (axis === "x") mesh.position.set(offset, Math.cos(a) * radius, Math.sin(a) * radius);
    else mesh.position.set(Math.cos(a) * radius, Math.sin(a) * radius, offset);
    mesh.rotation.y = -a;
    if (tilt) mesh.rotation.z += tilt;
    group.add(mesh);
  }
  return group;
}

/** Radial blade row for a turbomachine stage (axis along X). */
function bladeRow(count, rootRadius, length, chord, material, { twist = 0.45 } = {}) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const blade = new THREE.Mesh(box(chord, length, 0.016), material);
    blade.position.set(0, Math.cos(a) * (rootRadius + length / 2), Math.sin(a) * (rootRadius + length / 2));
    blade.rotation.x = -a;
    blade.rotation.z = twist;
    group.add(blade);
  }
  return group;
}

/* ------------------------------------------------------------------------- */
/* ASSEMBLY BUILDER                                                          */
/* ------------------------------------------------------------------------- */

class AssemblyBuilder {
  constructor(definition) {
    this.definition = definition;
    this.group = new THREE.Group();
    this.group.name = definition.name;
    this.parts = [];
    this.byId = new Map();
    /**
     * How part positions are interpreted.
     *
     *   false (default) — the position is the centre of the part's bounding box.
     *                     Used by assemblies authored in part-local coordinates.
     *   true            — the position is a world-space anchor and the child
     *                     meshes keep the coordinates they were authored at.
     *                     Used by cutaway assemblies where every sub-mesh is
     *                     placed in one shared model space (a gear train, an
     *                     engine block); re-centring those would slide every
     *                     child mesh onto the origin and collapse the assembly.
     */
    this.absoluteLayout = false;
  }

  add(partId, object, options = {}) {
    const { position, rotation = [0, 0, 0], scale = [1, 1, 1] } = options;
    const absolute = options.absoluteLayout ?? this.absoluteLayout;

    object.name = partId;

    if (absolute) {
      // Absolute layout: every child keeps the coordinate it was authored at,
      // and the part's own authored position is preserved. A passed position is
      // an offset from it (builders position their own helper groups).
      if (position) object.position.add(new THREE.Vector3(...position));
    } else {
      // Local layout: the position is the centre of the part.
      object.position.set(...(position ?? [0, 0, 0]));
    }

    object.rotation.set(...rotation);
    object.scale.set(...scale);

    object.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.partRoot = object;
      }
    });

    object.userData.partId = partId;
    object.userData.modelId = this.definition.id;
    object.userData.home = object.position.clone();
    object.userData.explodeDirection = new THREE.Vector3();

    this.group.add(object);
    this.parts.push(object);
    this.byId.set(partId, object);
    return object;
  }

  finish() {
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.group);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z) || 1;
    const scale = (this.definition.scale ?? 1) * (6.2 / largest);

    // Centre on the origin so rotation and scaling feel anchored.
    this.group.position.sub(centre);
    this.group.updateMatrixWorld(true);




    // Explode directions: radial from the origin plus a per-part fan around the
    // vertical axis. Collinear stacks (a rocket is a column of cylinders) would
    // otherwise all travel along the same line and never open up.
    const golden = Math.PI * (3 - Math.sqrt(5));
    this.parts.forEach((part, index) => {
      const origin = new THREE.Vector3();
      part.getWorldPosition(origin);
      if (origin.lengthSq() < 1e-6) origin.set(0, 0.001, 0);
      const dir = origin.clone().normalize();
      const angle = index * golden;
      dir.x += Math.cos(angle) * 0.75;
      dir.z += Math.sin(angle) * 0.75;
      dir.y += 0.2;
      part.userData.explodeDirection.copy(dir.normalize());
      part.userData.explodeDistance = 0.7 + 0.6 * (((index * 7) % 5) / 5);
    });

    const wrapper = new THREE.Group();
    wrapper.add(this.group);
    wrapper.scale.setScalar(scale);
    wrapper.name = this.definition.name;
    wrapper.updateMatrixWorld(true);

    return {
      group: wrapper,
      parts: this.parts,
      byId: this.byId,
      bounds: new THREE.Box3().setFromObject(wrapper)
    };
  }
}

/* ========================================================================= */
/* 1 · LAUNCH VEHICLE                                                        */
/* ========================================================================= */

function buildLaunchVehicle(b) {
  const body = surface(0xc9d8e4, { metalness: 0.72, roughness: 0.34 });
  const dark = surface(0x27394b, { metalness: 0.72, roughness: 0.38 });
  const shellDark = surface(0x33475c, { metalness: 0.7, roughness: 0.42, side: THREE.DoubleSide });
  const accent = surface(0x1f86c4, { metalness: 0.55, roughness: 0.3, emissive: 0x0a3550, emissiveIntensity: 0.7 });
  const hot = surface(0x8d99a6, { metalness: 0.94, roughness: 0.24 });
  const chamberMat = surface(0xb07a4a, { metalness: 0.95, roughness: 0.28 });

  const R = 0.55;              // body radius
  // Explicit bottom-up stack. Sections must meet exactly; the renderer check in
  // tools/preview verifies there are no floating or overlapping stages.
  const STACK = {
    nozzleBottom: -6.70,
    nozzleTop: -5.90,
    chamberBottom: -5.90,
    chamberTop: -5.56,
    gimbal: -5.50,
    skirtBottom: -5.46,
    skirtTop: -4.86,
    stage1Top: -1.36,
    interstageTop: -0.36,
    fuelTop: 0.52,
    loxTop: 2.20,
    avionicsTop: 2.62,
    adapterTop: 2.84,
    fairingBase: 2.60,
    fairingTop: 4.74
  };
  const centre = (a, b) => (a + b) / 2;
  const height = (a, b) => b - a;

  /* ---- Payload fairing: ogive ---------------------------------------- */
  // Skirt: a short straight section wide enough to sit over the adapter.
  const fairingProfile = [[R * 1.01, 0], [R * 1.01, 0.24], [R * 0.99, 0.3]];
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    // Tangent ogive: radius falls smoothly to zero at the tip.
    const r = R * Math.cos((t * Math.PI) / 2) ** 0.72;
    fairingProfile.push([Math.max(r, 0.004), 0.3 + t * 1.84]);
  }
  // The fairing skirt overlaps the adapter so there is no visible seam.
  b.add("payload-fairing", new THREE.Mesh(lathe(fairingProfile, 56), body), {
    position: [0, STACK.fairingBase, 0]
  });

  /* ---- Payload adapter: conical ring ---------------------------------- */
  const adapter = new THREE.Group();
  adapter.add(new THREE.Mesh(cyl(R * 0.82, R * 0.99, 0.22, 40, true), dark));
  const adapterRing = new THREE.Mesh(ring(R * 0.9, 0.014, 40), accent);
  adapterRing.rotation.x = Math.PI / 2;
  adapter.add(adapterRing);
  b.add("payload-adapter", adapter, {
    position: [0, centre(STACK.avionicsTop, STACK.adapterTop), 0]
  });

  /* ---- Avionics bay --------------------------------------------------- */
  const avionics = new THREE.Group();
  avionics.add(new THREE.Mesh(cyl(R * 0.97, R * 0.97, height(STACK.loxTop, STACK.avionicsTop), 40), dark));
  const avionicsBand = new THREE.Mesh(ring(R * 0.985, 0.013, 40), accent);
  avionicsBand.rotation.x = Math.PI / 2;
  avionics.add(avionicsBand);
  for (let i = 0; i < 3; i++) {
    const boxMesh = new THREE.Mesh(box(0.14, 0.16, 0.06), accent);
    const a = -0.6 + i * 0.6;
    boxMesh.position.set(Math.cos(a) * R * 0.96, 0.02, Math.sin(a) * R * 0.96);
    boxMesh.rotation.y = -a;
    avionics.add(boxMesh);
  }
  b.add("avionics-bay", avionics, {
    position: [0, centre(STACK.loxTop, STACK.avionicsTop), 0]
  });

  /* ---- Second-stage oxidiser tank ------------------------------------- */
  const loxTank = new THREE.Group();
  loxTank.add(new THREE.Mesh(cyl(R * 0.93, R * 0.93, height(STACK.fuelTop, STACK.loxTop), 48), body));
  for (let i = 0; i < 2; i++) {
    const band = new THREE.Mesh(ring(R * 0.94, 0.012, 48), accent);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.4 + i * 0.8;
    loxTank.add(band);
  }
  b.add("lox-tank", loxTank, {
    position: [0, centre(STACK.fuelTop, STACK.loxTop), 0]
  });

  /* ---- Common bulkhead / fuel tank ------------------------------------ */
  const fuelTank = new THREE.Group();
  fuelTank.add(new THREE.Mesh(cyl(R * 0.93, R * 0.93, height(STACK.interstageTop, STACK.fuelTop), 48), body));
  const fuelBand = new THREE.Mesh(ring(R * 0.94, 0.012, 48), accent);
  fuelBand.rotation.x = Math.PI / 2;
  fuelTank.add(fuelBand);
  b.add("fuel-tank", fuelTank, {
    position: [0, centre(STACK.interstageTop, STACK.fuelTop), 0]
  });

  /* ---- Interstage ------------------------------------------------------ */
  const interstage = new THREE.Group();
  interstage.add(new THREE.Mesh(halfShellY(R * 0.99, height(STACK.stage1Top, STACK.interstageTop), { segments: 44 }), shellDark));
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.42 + (i / 6) * Math.PI * 0.84;
    const strut = new THREE.Mesh(box(0.035, height(STACK.stage1Top, STACK.interstageTop) - 0.04, 0.02), accent);
    strut.position.set(Math.cos(a) * R * 0.985, 0, Math.sin(a) * R * 0.985);
    strut.rotation.y = -a;
    interstage.add(strut);
  }
  b.add("interstage", interstage, {
    position: [0, centre(STACK.stage1Top, STACK.interstageTop), 0]
  });

  /* ---- First-stage tank ------------------------------------------------ */
  const firstStage = new THREE.Group();
  firstStage.add(new THREE.Mesh(cyl(R, R, height(STACK.skirtTop, STACK.stage1Top), 48), body));
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(ring(R * 1.001, 0.009, 48), accent);
    stripe.rotation.x = Math.PI / 2;
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = -1.3 + i * 0.9;
    firstStage.add(stripe);
  }
  b.add("first-stage-tank", firstStage, {
    position: [0, centre(STACK.skirtTop, STACK.stage1Top), 0]
  });

  /* ---- Thrust structure: cutaway skirt + struts ------------------------ */
  const thrust = new THREE.Group();
  thrust.add(new THREE.Mesh(halfShellY(R * 0.99, height(STACK.skirtBottom, STACK.skirtTop), { segments: 40 }), shellDark));
  const shield = new THREE.Mesh(cyl(R * 0.9, R * 0.96, 0.05, 40), surface(0x1c2733, { metalness: 0.35, roughness: 0.75 }));
  shield.position.y = -0.29;
  thrust.add(shield);
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI * 0.45 + (i / 5) * Math.PI * 0.9;
    const strut = new THREE.Mesh(cyl(0.022, 0.022, 0.5, 8), accent);
    strut.position.set(Math.cos(a) * R * 0.72, -0.16, Math.sin(a) * R * 0.72);
    strut.rotation.z = -Math.cos(a) * 0.16;
    strut.rotation.x = Math.sin(a) * 0.16;
    thrust.add(strut);
  }
  b.add("thrust-structure", thrust, {
    position: [0, centre(STACK.skirtBottom, STACK.skirtTop), 0]
  });

  /* ---- Turbopump ------------------------------------------------------- */
  const pump = new THREE.Group();
  pump.add(new THREE.Mesh(cyl(0.15, 0.15, 0.36, 24), hot));
  put(pump, new THREE.Mesh(cyl(0.09, 0.16, 0.16, 24), accent)).position.y = 0.25;
  const pumpFeed = new THREE.Mesh(tubePath([
    [0, 0.3, 0], [-0.06, 0.62, 0], [-0.18, 0.95, 0]
  ], 0.035, 24), hot);
  pump.add(pumpFeed);
  b.add("turbopump", pump, { position: [R * 0.66, STACK.skirtTop - 0.5, 0] });

  /* ---- Gimbal ---------------------------------------------------------- */
  const gimbal = new THREE.Group();
  gimbal.add(new THREE.Mesh(sphere(0.11, 20, 14), accent));
  const gimbalRing = new THREE.Mesh(ring(0.17, 0.018, 28), dark);
  gimbalRing.rotation.x = Math.PI / 2;
  gimbal.add(gimbalRing);
  b.add("gimbal", gimbal, { position: [0, STACK.gimbal, 0] });

  /* ---- Thrust chamber -------------------------------------------------- */
  const chamber = new THREE.Group();
  chamber.add(new THREE.Mesh(cyl(0.19, 0.15, height(STACK.chamberBottom, STACK.chamberTop), 28), chamberMat));
  chamber.add(new THREE.Mesh(ring(0.185, 0.016, 28), accent));
  const injector = new THREE.Mesh(cyl(0.2, 0.2, 0.04, 28), hot);
  injector.position.y = 0.13;
  chamber.add(injector);
  b.add("thrust-chamber", chamber, {
    position: [0, centre(STACK.chamberBottom, STACK.chamberTop), 0]
  });

  /* ---- Nozzle bell ----------------------------------------------------- */
  const bell = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    bell.push([0.14 + t ** 1.8 * 0.4, -t * 0.82]);
  }
  const nozzle = new THREE.Group();
  nozzle.add(new THREE.Mesh(lathe(bell, 52), hot));
  const nozzleRim = new THREE.Mesh(ring(0.54, 0.014, 52), accent);
  nozzleRim.rotation.x = Math.PI / 2;
  nozzleRim.position.y = -0.82;
  nozzle.add(nozzleRim);
  b.add("nozzle", nozzle, { position: [0, STACK.nozzleTop, 0] });

  /* ---- Grid fins + legs ------------------------------------------------ */
  const fins = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const fin = new THREE.Group();
    const frame = new THREE.Mesh(box(0.3, 0.34, 0.035), dark);
    fin.add(frame);
    for (let k = 0; k < 3; k++) {
      put(fin, new THREE.Mesh(box(0.26, 0.014, 0.016), accent)).position.y = -0.1 + k * 0.1;
    }
    for (let k = 0; k < 3; k++) {
      put(fin, new THREE.Mesh(box(0.014, 0.3, 0.016), accent)).position.x = -0.09 + k * 0.09;
    }
    fin.position.set(Math.cos(a) * (R + 0.1), 0, Math.sin(a) * (R + 0.1));
    fin.rotation.y = -a + Math.PI / 2;
    fins.add(fin);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(cyl(0.026, 0.04, 0.55, 8), dark);
    leg.position.set(Math.cos(a) * (R * 0.95), -0.34, Math.sin(a) * (R * 0.95));
    leg.rotation.z = Math.cos(a) * 0.14;
    leg.rotation.x = -Math.sin(a) * 0.14;
    fins.add(leg);
  }
  b.add("grid-fin", fins, { position: [0, STACK.skirtTop + 1.15, 0] });
}

/* ========================================================================= */
/* 2 · TURBOJET (cutaway)                                                    */
/* ========================================================================= */

function buildTurbojet(b) {
  b.absoluteLayout = true;

  const casing = surface(0x9fb0c0, { metalness: 0.86, roughness: 0.26 });
  const hot = surface(0xb5793f, { metalness: 0.9, roughness: 0.3 });
  const dark = surface(0x2b3644, { metalness: 0.75, roughness: 0.4 });
  const blade = surface(0xdde8f2, { metalness: 0.95, roughness: 0.16 });
  const accent = surface(0x2f96d6, { metalness: 0.5, roughness: 0.3, emissive: 0x0c3a58, emissiveIntensity: 0.8 });
  const shellSide = surface(0x8fa2b3, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });

  // Casing: half shell along X, opening toward +Z (cutaway).
  const nacelle = new THREE.Group();
  nacelle.add(new THREE.Mesh(halfShellX(0.62, 4.5), shellSide));
  for (const x of [-2.24, -1.1, 0.1, 1.2]) {
    const hoop = new THREE.Mesh(ring(0.625, 0.018, 40), dark);
    hoop.rotation.y = Math.PI / 2;
    hoop.position.x = x;
    nacelle.add(hoop);
  }
  b.add("nacelle", nacelle);

  // Inlet: lip that narrows toward the compressor face.
  const inlet = new THREE.Group();
  inlet.add(new THREE.Mesh(lathe([
    [0.62, 0], [0.6, -0.18], [0.54, -0.42], [0.5, -0.62]
  ], 44), casing));
  b.add("inlet", inlet, { position: [-2.3, 0, 0], rotation: [0, 0, Math.PI / 2] });

  // Low-pressure compressor: three fan stages.
  const lp = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const stage = new THREE.Group();
    const hub = new THREE.Mesh(cyl(0.1, 0.1, 0.07, 20), dark);
    hub.rotation.z = Math.PI / 2;
    stage.add(hub);
    stage.add(bladeRow(20, 0.1, 0.4, 0.045, blade, { twist: 0.5 }));
    stage.position.x = -1.95 + i * 0.13;
    lp.add(stage);
  }
  b.add("lp-compressor", lp);

  // High-pressure compressor: six progressively smaller stages.
  const hp = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const stage = new THREE.Group();
    const hub = new THREE.Mesh(cyl(0.095, 0.095, 0.05, 18), dark);
    hub.rotation.z = Math.PI / 2;
    stage.add(hub);
    const rootR = 0.1;
    const bladeLen = 0.36 - i * 0.028;
    stage.add(bladeRow(18, rootR, bladeLen, 0.032, blade, { twist: 0.55 }));
    stage.position.x = -1.35 + i * 0.11;
    hp.add(stage);
  }
  b.add("hp-compressor", hp);

  // Annular combustor with a visible flame-holder ring.
  const combustor = new THREE.Group();
  const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.34, 40, 1, true), hot);
  liner.rotation.z = Math.PI / 2;
  combustor.add(liner);
  const outerLiner = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 40, 1, true, 0, Math.PI), hot);
  outerLiner.rotation.z = Math.PI / 2;
  outerLiner.rotation.y = Math.PI / 2;
  combustor.add(outerLiner);
  const flameRing = new THREE.Mesh(ring(0.4, 0.012, 40), accent);
  flameRing.rotation.y = Math.PI / 2;
  flameRing.position.x = -0.14;
  combustor.add(flameRing);
  b.add("combustor", combustor, { position: [-0.62, 0, 0] });

  // Fuel nozzle ring feeding the combustor dome.
  const nozzles = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const nozzle = new THREE.Mesh(cyl(0.026, 0.02, 0.12, 10), surface(0xd7e2ec, { metalness: 0.92, roughness: 0.22 }));
    nozzle.position.set(-0.78, Math.cos(a) * 0.4, Math.sin(a) * 0.4);
    nozzle.rotation.x = a;
    nozzles.add(nozzle);
  }
  b.add("fuel-nozzles", nozzles);

  // HP turbine: two stages, glowing hot.
  const hpt = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const stage = new THREE.Group();
    const disc = new THREE.Mesh(cyl(0.16, 0.16, 0.05, 20), hot);
    disc.rotation.z = Math.PI / 2;
    stage.add(disc);
    stage.add(bladeRow(22, 0.16, 0.22, 0.03, hot, { twist: -0.5 }));
    stage.position.x = -0.4 + i * 0.14;
    hpt.add(stage);
  }
  b.add("hp-turbine", hpt);

  // LP turbine: four stages with growing annulus.
  const lpt = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const stage = new THREE.Group();
    const rootR = 0.14 + i * 0.02;
    stage.add(bladeRow(24, rootR, 0.22 + i * 0.03, 0.028, hot, { twist: -0.55 }));
    stage.position.x = -0.1 + i * 0.16;
    lpt.add(stage);
  }
  b.add("lp-turbine", lpt);

  // HP shaft with visible bearing housings.
  const shaft = new THREE.Group();
  const shaftBody = new THREE.Mesh(cyl(0.05, 0.05, 2.5, 18), surface(0x9aa7b3, { metalness: 0.95, roughness: 0.18 }));
  shaftBody.rotation.z = Math.PI / 2;
  shaft.add(shaftBody);
  for (const x of [-1.05, 0.58]) {
    const bearing = new THREE.Mesh(ring(0.12, 0.035, 24), accent);
    bearing.rotation.y = Math.PI / 2;
    bearing.position.x = x;
    shaft.add(bearing);
  }
  b.add("hp-shaft", shaft);

  // Exhaust nozzle: convergent-divergent visible from the cutaway.
  const exhaust = new THREE.Group();
  exhaust.add(new THREE.Mesh(lathe([
    [0.5, 0], [0.56, 0.28], [0.62, 0.62], [0.6, 0.74]
  ], 44), surface(0x8a7d70, { metalness: 0.9, roughness: 0.34 })));
  const exhaustRim = new THREE.Mesh(ring(0.6, 0.02, 44), accent);
  exhaustRim.rotation.x = Math.PI / 2;
  exhaustRim.position.y = 0.72;
  exhaust.add(exhaustRim);
  b.add("exhaust-nozzle", exhaust, { position: [1.55, 0, 0], rotation: [0, 0, -Math.PI / 2] });

  // Accessory gearbox slung under the casing.
  const gearbox = new THREE.Group();
  gearbox.add(new THREE.Mesh(box(0.62, 0.26, 0.34), dark));
  for (let i = 0; i < 3; i++) {
    const pump = new THREE.Mesh(cyl(0.075, 0.075, 0.18, 16), accent);
    pump.position.set(-0.2 + i * 0.2, -0.2, 0);
    gearbox.add(pump);
  }
  const driveShaft = new THREE.Mesh(cyl(0.022, 0.022, 0.3, 10), casing);
  driveShaft.position.set(0.2, 0.24, 0);
  gearbox.add(driveShaft);
  b.add("accessory-gearbox", gearbox, { position: [-0.95, -0.78, 0] });
}

/* ========================================================================= */
/* 3 · INLINE-4 ENGINE (cutaway)                                             */
/* ========================================================================= */

function buildInlineEngine(b) {
  b.absoluteLayout = true;

  const alloy = surface(0xb9c7d3, { metalness: 0.7, roughness: 0.36 });
  const cast = surface(0x5f6d7a, { metalness: 0.55, roughness: 0.55 });
  const steel = surface(0xd6e1eb, { metalness: 0.95, roughness: 0.18 });
  const dark = surface(0x222b35, { metalness: 0.55, roughness: 0.55 });
  const accent = surface(0xff9a3c, { metalness: 0.45, roughness: 0.35, emissive: 0x4a2400, emissiveIntensity: 0.9 });
  const coolant = surface(0x2fb6a8, { metalness: 0.3, roughness: 0.4, emissive: 0x0a3a34, emissiveIntensity: 0.6 });

  const boreSpacing = 0.62;
  const boreX = i => -0.93 + i * boreSpacing;
  const deckY = 0.18;

  /* ---- Cylinder block: open front cutaway ----------------------------- */
  // Datum: y = 0 is the crankcase top, the crankshaft lives at y = -0.55 and the
  // pistons reach the deck at y = 0.66. Everything below is derived so the
  // block, liners, deck and sump actually touch.
  const DECK_Y = 0.73;
  const LINER_BOTTOM = -0.30;
  const LINER_TOP = 0.68;
  const block = new THREE.Group();
  put(block, new THREE.Mesh(box(2.62, 1.5, 0.06), cast)).position.set(0, 0.03, -0.58);  // back wall
  for (const x of [-1.29, 1.29]) {
    put(block, new THREE.Mesh(box(0.07, 1.5, 1.2), cast)).position.set(x, 0.03, 0);     // side walls
  }
  put(block, new THREE.Mesh(box(2.62, 0.1, 1.2), cast)).position.y = -0.75;             // skirt floor
  put(block, new THREE.Mesh(box(2.62, 0.1, 1.2), cast)).position.y = DECK_Y;            // deck
  // Cylinder liners, visible through the open front.
  const linerMat = surface(0x9fb0c0, { metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const liner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.235, 0.235, LINER_TOP - LINER_BOTTOM, 28, 1, true),
      linerMat
    );
    liner.position.set(boreX(i), (LINER_BOTTOM + LINER_TOP) / 2, 0);
    block.add(liner);
  }
  // Oil pan, bolted under the skirt floor.
  put(block, new THREE.Mesh(box(2.3, 0.3, 1.0), dark)).position.y = -0.92;
  b.add("cylinder-block", block);

  /* ---- Cylinder head with cutaway front ------------------------------- */
  // Open-front head so the valves, springs and camshaft are visible instead of
  // being sealed inside a solid block. Bottom face sits exactly on the deck.
  const head = new THREE.Group();
  put(head, new THREE.Mesh(box(2.62, 0.5, 0.06), alloy)).position.set(0, 0.25, -0.58); // back
  put(head, new THREE.Mesh(box(2.62, 0.08, 1.2), alloy)).position.y = 0.5;              // top deck
  for (const x of [-1.29, 1.29]) {
    put(head, new THREE.Mesh(box(0.07, 0.5, 1.2), alloy)).position.set(x, 0.25, 0);
  }
  put(head, new THREE.Mesh(box(2.56, 0.04, 0.5), accent)).position.set(0, 0.55, 0.35); // cam-cover rail
  put(head, new THREE.Mesh(box(2.56, 0.16, 0.56), alloy)).position.set(0, 0.62, -0.3); // rear cam cover
  b.add("cylinder-head", head, { position: [0, DECK_Y + 0.05, 0] });

  /* ---- Pistons --------------------------------------------------------- */
  const pistons = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const piston = new THREE.Group();
    piston.add(new THREE.Mesh(cyl(0.228, 0.228, 0.26, 28), steel));
    const crown = new THREE.Mesh(cyl(0.228, 0.228, 0.03, 28), surface(0x8f9aa5, { metalness: 0.9, roughness: 0.3 }));
    crown.position.y = 0.14;
    piston.add(crown);
    for (let r = 0; r < 3; r++) {
      const ringMesh = new THREE.Mesh(ring(0.231, 0.01, 28), dark);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = -0.08 + r * 0.06;
      piston.add(ringMesh);
    }
    piston.position.set(boreX(i), 0.5, 0);
    pistons.add(piston);
  }
  b.add("piston", pistons);

  /* ---- Connecting rods -------------------------------------------------- */
  // Length is derived from the piston pin height and the crank centre so the
  // small end meets the piston and the big end wraps the journal.
  const PIN_Y = 0.36;
  const ROD_LENGTH = PIN_Y + 0.55;
  const rods = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const rod = new THREE.Group();
    rod.add(new THREE.Mesh(box(0.1, ROD_LENGTH - 0.14, 0.06), steel));
    const smallEnd = new THREE.Mesh(cyl(0.075, 0.075, 0.1, 16), steel);
    smallEnd.rotation.z = Math.PI / 2;
    smallEnd.position.y = (ROD_LENGTH - 0.14) / 2;
    rod.add(smallEnd);
    const bigEnd = new THREE.Mesh(cyl(0.1, 0.1, 0.12, 18), dark);
    bigEnd.rotation.z = Math.PI / 2;
    bigEnd.position.y = -(ROD_LENGTH - 0.14) / 2;
    rod.add(bigEnd);
    rod.position.set(boreX(i), PIN_Y - ROD_LENGTH / 2, 0);
    rod.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.14;
    rods.add(rod);
  }
  b.add("connecting-rod", rods);

  /* ---- Crankshaft ------------------------------------------------------- */
  const crank = new THREE.Group();
  const crankMain = new THREE.Mesh(cyl(0.085, 0.085, 2.9, 24), steel);
  crankMain.rotation.z = Math.PI / 2;
  crank.add(crankMain);
  for (let i = 0; i < 4; i++) {
    const web = new THREE.Mesh(cyl(0.22, 0.22, 0.07, 24), cast);
    web.rotation.z = Math.PI / 2;
    web.position.set(boreX(i), 0, 0);
    crank.add(web);
    const journal = new THREE.Mesh(cyl(0.065, 0.065, 0.14, 16), steel);
    journal.rotation.z = Math.PI / 2;
    journal.position.set(boreX(i), (i % 2 === 0 ? 1 : -1) * 0.11, 0);
    crank.add(journal);
  }
  b.add("crankshaft", crank, { position: [0, -0.55, 0] });

  /* ---- Camshafts -------------------------------------------------------- */
  const cams = new THREE.Group();
  for (const z of [-0.32, 0.32]) {
    const cam = new THREE.Group();
    const shaft = new THREE.Mesh(cyl(0.05, 0.05, 2.6, 20), steel);
    shaft.rotation.z = Math.PI / 2;
    cam.add(shaft);
    for (let i = 0; i < 8; i++) {
      const lobe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 18), steel);
      lobe.rotation.z = Math.PI / 2;
      lobe.scale.set(1, 1.35, 1);
      lobe.position.set(-1.14 + i * 0.325, 0.045, 0);
      lobe.rotation.y = 0;
      cam.add(lobe);
    }
    cam.position.z = z;
    cams.add(cam);
  }
  b.add("camshaft", cams, { position: [0, 1.06, 0] });

  /* ---- Valves ----------------------------------------------------------- */
  const makeValve = (count, zOffset, tilt, stemRadius, discRadius) => {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      for (const dx of [-0.1, 0.1]) {
        const valve = new THREE.Group();
        valve.add(new THREE.Mesh(cyl(stemRadius, stemRadius, 0.3, 10), steel));
        const disc = new THREE.Mesh(cyl(discRadius, discRadius * 0.84, 0.03, 18), steel);
        disc.position.y = 0.15;
        valve.add(disc);
        const spring = new THREE.Mesh(cyl(0.045, 0.045, 0.1, 10, true), accent);
        spring.material = surface(0xff9a3c, { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
        spring.position.y = -0.06;
        valve.add(spring);
        valve.position.set(boreX(i) + dx, 0, zOffset);
        valve.rotation.x = tilt;
        group.add(valve);
      }
    }
    return group;
  };
  b.add("intake-valve", makeValve(4, 0.15, 0.14, 0.016, 0.082), { position: [0, 0.84, 0] });
  b.add("exhaust-valve", makeValve(4, -0.15, -0.14, 0.015, 0.072), { position: [0, 0.84, 0] });

  /* ---- Spark plugs ------------------------------------------------------ */
  const plugs = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const plug = new THREE.Group();
    plug.add(new THREE.Mesh(cyl(0.04, 0.04, 0.18, 12), steel));
    put(plug, new THREE.Mesh(cyl(0.055, 0.055, 0.07, 12), accent)).position.y = 0.11;
    plug.position.set(boreX(i), 0.3, 0.33);
    plugs.add(plug);
  }
  b.add("spark-plug", plugs, { position: [0, 0.72, 0] });

  /* ---- Fuel injectors ---------------------------------------------------- */
  const injectors = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const injector = new THREE.Group();
    injector.add(new THREE.Mesh(cyl(0.038, 0.038, 0.2, 12), dark));
    put(injector, new THREE.Mesh(cyl(0.05, 0.026, 0.06, 12), accent)).position.y = -0.12;
    injector.position.set(boreX(i), 0.28, 0.42);
    injector.rotation.x = 0.45;
    injectors.add(injector);
  }
  b.add("fuel-injector", injectors, { position: [0, 0.72, 0] });

  /* ---- Timing belt -------------------------------------------------------- */
  const belt = new THREE.Group();
  const beltPoints = [
    [1.4, 0.5, 0.18], [1.46, 0.1, 0.18], [1.45, -0.25, 0.18], [1.4, -0.56, 0.18],
    [1.3, -0.6, 0.18], [1.16, -0.52, 0.18], [1.12, -0.1, 0.18], [1.16, 0.3, 0.18], [1.28, 0.52, 0.18]
  ];
  belt.add(new THREE.Mesh(tubeLoop(beltPoints, 0.032, 160), dark));
  const camPulley = new THREE.Mesh(cyl(0.2, 0.2, 0.05, 28), steel);
  camPulley.rotation.z = Math.PI / 2;
  camPulley.position.set(1.4, 0.5, 0.18);
  belt.add(camPulley);
  const crankPulley = new THREE.Mesh(cyl(0.14, 0.14, 0.05, 28), steel);
  crankPulley.rotation.z = Math.PI / 2;
  crankPulley.position.set(1.4, -0.56, 0.18);
  belt.add(crankPulley);
  b.add("timing-belt", belt, { position: [0, 0.42, 0] });

  /* ---- Flywheel ----------------------------------------------------------- */
  const flywheel = new THREE.Group();
  const disc = new THREE.Mesh(cyl(0.56, 0.56, 0.1, 48), cast);
  disc.rotation.z = Math.PI / 2;
  flywheel.add(disc);
  const ringGear = new THREE.Mesh(ring(0.56, 0.028, 48), steel);
  ringGear.rotation.y = Math.PI / 2;
  flywheel.add(ringGear);
  for (let i = 0; i < 12; i++) {
    const tooth = new THREE.Mesh(box(0.03, 0.05, 0.06), steel);
    const a = (i / 12) * Math.PI * 2;
    tooth.position.set(0, Math.cos(a) * 0.57, Math.sin(a) * 0.57);
    tooth.rotation.x = a;
    flywheel.add(tooth);
  }
  b.add("flywheel", flywheel, { position: [-1.42, -0.55, 0] });

  /* ---- Water pump --------------------------------------------------------- */
  const pump = new THREE.Group();
  pump.add(new THREE.Mesh(cyl(0.18, 0.18, 0.24, 24), alloy));
  put(pump, new THREE.Mesh(cyl(0.06, 0.06, 0.26, 14), steel)).position.y = 0.24;
  pump.add(new THREE.Mesh(ring(0.2, 0.018, 24), accent));
  const hose = new THREE.Mesh(tubePath([
    [0, 0.1, 0.1], [0.1, 0.16, 0.3], [0.16, 0.2, 0.46]
  ], 0.03, 22), coolant);
  pump.add(hose);
  b.add("water-pump", pump, { position: [1.05, 0.3, -0.78], rotation: [Math.PI / 2, 0, 0] });
}

/* ========================================================================= */
/* 4 · GEAR TRAIN (open-front housing)                                       */
/* ========================================================================= */

function buildGearTrain(b) {
  b.absoluteLayout = true;

  const steel = surface(0xa9b8c6, { metalness: 0.95, roughness: 0.22 });
  const hardened = surface(0x93a6b8, { metalness: 0.98, roughness: 0.14 });
  const cast = surface(0x46545f, { metalness: 0.55, roughness: 0.6 });
  const accent = surface(0xb7a1ff, { metalness: 0.4, roughness: 0.3, emissive: 0x2a2050, emissiveIntensity: 1 });
  const oil = surface(0x3ad1c4, { metalness: 0.3, roughness: 0.25, emissive: 0x0d443f, emissiveIntensity: 0.9 });

  const Z_BACK = -0.72;
  const Z_GEAR = 0.1;

  /* ---- Housing: back plate, rails, feet; front left open ---------------- */
  const housing = new THREE.Group();
  put(housing, new THREE.Mesh(box(4.4, 2.9, 0.12), cast)).position.z = Z_BACK;
  put(housing, new THREE.Mesh(box(4.4, 0.16, 1.5), cast)).position.set(0, 1.45, -0.1);
  put(housing, new THREE.Mesh(box(4.4, 0.16, 1.5), cast)).position.set(0, -1.45, -0.1);
  for (const x of [-2.2, 2.2]) {
    put(housing, new THREE.Mesh(box(0.14, 2.9, 1.5), cast)).position.set(x, 0, -0.1);
  }
  for (const x of [-1.5, 1.5]) {
    put(housing, new THREE.Mesh(box(0.8, 0.14, 1.7), cast)).position.set(x, -1.56, -0.05);
  }
  b.add("housing", housing);

  /* ---- Shafts + gears (Y axis pinions, lying flat) --------------------- */
  // Layout is derived from pitch radii: an 18-tooth input pinion drives a
  // 42-tooth idler, which drives a 90-tooth output gear. Axis spacing is the
  // sum of adjacent pitch radii, so every pair truly meshes.
  const PITCH = 0.92;
  const inputR = 0.34;
  const idlerR = 0.80;
  const outputR = 1.26;
  const RING_Z = -0.1;

  const inputPos = { x: -1.30, y: 0.92 };
  const idlerPos = { x: inputPos.x + (inputR + idlerR) * PITCH * 0.98, y: inputPos.y - 0.30 };
  const outputPos = { x: idlerPos.x + (idlerR + outputR) * PITCH * 0.98, y: idlerPos.y - 0.10 };

  const shaftGroup = (x, y, radius, length) => {
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(cyl(radius, radius, length, 26), steel);
    shaft.rotation.x = Math.PI / 2;
    group.add(shaft);
    group.position.set(x, y, RING_Z);
    return group;
  };

  const input = shaftGroup(inputPos.x, inputPos.y, 0.1, 1.9);
  const pinion = new THREE.Mesh(gearGeometry(inputR, 18, 0.2, 0.085), hardened);
  pinion.position.z = Z_GEAR + 0.1;
  input.add(pinion);
  b.add("input-shaft", input);

  const idler = shaftGroup(idlerPos.x, idlerPos.y, 0.12, 1.7);
  const idlerGear = new THREE.Mesh(gearGeometry(idlerR, 42, 0.22, 0.1), steel);
  idlerGear.position.z = Z_GEAR + 0.1;
  idler.add(idlerGear);
  const idlerHub = new THREE.Mesh(cyl(0.2, 0.2, 0.26, 24), accent);
  idlerHub.rotation.x = Math.PI / 2;
  idlerHub.position.z = Z_GEAR + 0.1;
  idler.add(idlerHub);
  b.add("idler-gear", idler);

  const output = shaftGroup(outputPos.x, outputPos.y, 0.15, 1.8);
  const outputGear = new THREE.Mesh(gearGeometry(outputR, 90, 0.24, 0.13), hardened);
  outputGear.position.z = Z_GEAR + 0.1;
  output.add(outputGear);
  b.add("output-gear", output);

  const outShaft = new THREE.Group();
  const shaftBody = new THREE.Mesh(cyl(0.18, 0.18, 2.5, 26), steel);
  shaftBody.rotation.x = Math.PI / 2;
  outShaft.add(shaftBody);
  put(outShaft, new THREE.Mesh(cyl(0.3, 0.3, 0.18, 30), steel)).position.z = 1.05;
  b.add("output-shaft", outShaft, { position: [outputPos.x, outputPos.y, RING_Z] });

  /* ---- Bearings --------------------------------------------------------- */
  const bearings = new THREE.Group();
  const bearingSpecs = [
    [inputPos.x, inputPos.y], [outputPos.x, outputPos.y], [idlerPos.x, idlerPos.y]
  ];
  for (const [x, y] of bearingSpecs) {
    for (const z of [0.78, -1.0]) {
      const bearing = new THREE.Group();
      const outer = new THREE.Mesh(ring(0.17, 0.045, 24), steel);
      bearing.add(outer);
      const inner = new THREE.Mesh(cyl(0.13, 0.13, 0.09, 20), accent);
      inner.rotation.x = Math.PI / 2;
      bearing.add(inner);
      bearing.position.set(x, y, z);
      bearings.add(bearing);
    }
  }
  b.add("bearing", bearings);

  /* ---- Lubrication circuit ---------------------------------------------- */
  const lube = new THREE.Group();
  const lubePath = [
    [-2.0, 1.2, Z_BACK + 0.16], [-0.9, 1.15, Z_BACK + 0.16],
    [1.2, 1.0, Z_BACK + 0.16], [2.0, 0.4, Z_BACK + 0.16],
    [2.0, -0.8, Z_BACK + 0.16], [0.4, -1.15, Z_BACK + 0.16], [-1.4, -1.0, Z_BACK + 0.16]
  ];
  lube.add(new THREE.Mesh(tubeLoop(lubePath, 0.026, 150), oil));
  for (const [x, y, dx, dy] of [
    [-1.6, 0.95, 0.1, -0.35], [-0.62, 0.3, 0.15, -0.35], [1.28, -0.45, 0.1, -0.35]
  ]) {
    const jet = new THREE.Mesh(cyl(0.018, 0.018, 0.26, 8), oil);
    jet.position.set(x + dx, y + dy, Z_BACK + 0.4);
    jet.rotation.x = 0.6;
    lube.add(jet);
  }
  b.add("lubrication-jet", lube);

  /* ---- Inspection cover (rear, semi-transparent) ------------------------ */
  const cover = new THREE.Group();
  const plate = new THREE.Mesh(
    box(3.4, 2.2, 0.04),
    surface(0x5d6b78, { metalness: 0.6, roughness: 0.45, opacity: 0.22, transparent: true })
  );
  plate.material.depthWrite = false;
  cover.add(plate);
  for (let i = 0; i < 8; i++) {
    const bolt = new THREE.Mesh(cyl(0.045, 0.045, 0.06, 10), hardened);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(-1.5 + (i % 4) * 1.0, i < 4 ? 0.95 : -0.95, -1.4);
    cover.add(bolt);
  }
  const sight = new THREE.Mesh(cyl(0.11, 0.11, 0.03, 20), oil);
  sight.rotation.x = Math.PI / 2;
  sight.position.set(1.05, -0.68, -1.4);
  cover.add(sight);
  b.add("inspection-cover", cover);
}

/* ========================================================================= */
/* 5 · ROBOT ARM                                                             */
/* ========================================================================= */

function buildRobotArm(b) {
  b.absoluteLayout = true;

  const shell = surface(0xe4edf5, { metalness: 0.45, roughness: 0.34 });
  const jointMat = surface(0x39434f, { metalness: 0.85, roughness: 0.28 });
  const accent = surface(0x39e0b0, { metalness: 0.45, roughness: 0.3, emissive: 0x0b4a3a, emissiveIntensity: 0.9 });
  const cable = surface(0x20272f, { metalness: 0.3, roughness: 0.7 });

  /* ---- Base ------------------------------------------------------------- */
  const base = new THREE.Group();
  base.add(new THREE.Mesh(cyl(0.86, 0.96, 0.24, 40), jointMat));
  put(base, new THREE.Mesh(cyl(0.9, 0.9, 0.03, 40), accent)).position.y = 0.13;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bolt = new THREE.Mesh(cyl(0.05, 0.05, 0.26, 10), shell);
    bolt.position.set(Math.cos(a) * 0.74, 0.11, Math.sin(a) * 0.74);
    base.add(bolt);
  }
  b.add("base", base, { position: [0, -1.6, 0] });

  /* ---- Axis 1 slew drive ------------------------------------------------- */
  const j1 = new THREE.Group();
  j1.add(new THREE.Mesh(cyl(0.5, 0.6, 0.44, 40), shell));
  const j1Ring = new THREE.Mesh(ring(0.52, 0.022, 40), accent);
  j1Ring.rotation.x = Math.PI / 2;
  j1.add(j1Ring);
  b.add("j1-drive", j1, { position: [0, -1.24, 0] });

  /* ---- Harmonic drive ---------------------------------------------------- */
  const harmonic = new THREE.Group();
  const flexSpline = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 40, 1, true), accent);
  flexSpline.rotation.x = Math.PI / 2;
  harmonic.add(flexSpline);
  harmonic.add(new THREE.Mesh(ring(0.34, 0.028, 40), jointMat));
  b.add("harmonic-drive", harmonic, { position: [0, -0.98, 0] });

  /* ---- Shoulder link (axis 2) ------------------------------------------- */
  const shoulder = new THREE.Group();
  const upperArm = new THREE.Mesh(box(0.4, 1.15, 0.46), shell);
  upperArm.position.y = 0.5;
  shoulder.add(upperArm);
  // Hollowed side plates make it read as a cast link.
  for (const s of [-1, 1]) {
    put(shoulder, new THREE.Mesh(box(0.06, 0.75, 0.36), jointMat)).position.set(s * 0.21, 0.5, 0);
  }
  const shoulderBearing = new THREE.Mesh(ring(0.3, 0.1, 32), jointMat);
  shoulderBearing.rotation.y = Math.PI / 2;
  shoulder.add(shoulderBearing);
  b.add("shoulder-link", shoulder, { position: [0, -1.0, 0], rotation: [0, 0, -0.16] });

  /* ---- Elbow (axis 3) ---------------------------------------------------- */
  const elbow = new THREE.Group();
  const elbowBody = new THREE.Mesh(cyl(0.3, 0.3, 0.5, 32), jointMat);
  elbowBody.rotation.x = Math.PI / 2;
  elbow.add(elbowBody);
  const elbowRing = new THREE.Mesh(ring(0.28, 0.036, 32), accent);
  elbow.add(elbowRing);
  b.add("elbow-joint", elbow, { position: [0.1, 0.62, 0] });

  /* ---- Forearm + wrist --------------------------------------------------- */
  const forearm = new THREE.Group();
  const foreArmBody = new THREE.Mesh(box(1.15, 0.32, 0.36), shell);
  foreArmBody.position.x = 0.6;
  forearm.add(foreArmBody);
  put(forearm, new THREE.Mesh(box(0.65, 0.1, 0.28), jointMat)).position.set(0.6, -0.11, 0);
  // Three wrist joints (axes 4-6).
  const wristAxes = [
    { x: 1.2, axis: "x" },
    { x: 1.34, axis: "y" },
    { x: 1.48, axis: "z" }
  ];
  for (const wrist of wristAxes) {
    const joint = new THREE.Group();
    const body = new THREE.Mesh(cyl(0.15, 0.15, 0.16, 24), jointMat);
    if (wrist.axis === "x") body.rotation.z = Math.PI / 2;
    if (wrist.axis === "y") body.rotation.x = Math.PI / 2;
    joint.add(body);
    const ringMesh = new THREE.Mesh(ring(0.145, 0.02, 24), accent);
    if (wrist.axis === "x") ringMesh.rotation.y = Math.PI / 2;
    if (wrist.axis === "y") ringMesh.rotation.x = Math.PI / 2;
    joint.add(ringMesh);
    joint.position.x = wrist.x;
    forearm.add(joint);
  }
  const flange = new THREE.Mesh(cyl(0.16, 0.16, 0.05, 28), accent);
  flange.rotation.z = Math.PI / 2;
  flange.position.x = 1.6;
  forearm.add(flange);
  b.add("forearm", forearm, { position: [0.22, 0.7, 0], rotation: [0, 0, -0.12] });

  /* ---- Gripper ----------------------------------------------------------- */
  const gripper = new THREE.Group();
  gripper.add(new THREE.Mesh(box(0.26, 0.26, 0.3), jointMat));
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(box(0.2, 0.08, 0.07), shell);
    jaw.position.set(0.21, 0, s * 0.1);
    gripper.add(jaw);
    const pad = new THREE.Mesh(box(0.04, 0.07, 0.05), accent);
    pad.position.set(0.3, 0, s * 0.1);
    gripper.add(pad);
  }
  b.add("gripper", gripper, { position: [1.95, 0.62, 0], rotation: [0, 0, -0.12] });

  /* ---- Cable harness: short bundles at each joint ------------------------ */
  const harness = new THREE.Group();
  const bundles = [
    [[-0.22, -1.5, 0.3], [-0.26, -1.2, 0.34], [-0.24, -0.9, 0.3]],
    [[-0.26, -0.7, 0.26], [-0.3, -0.3, 0.26], [-0.28, 0.1, 0.24]],
    [[0.18, 0.5, 0.22], [0.4, 0.58, 0.22], [0.7, 0.66, 0.2]],
    [[1.0, 0.66, 0.2], [1.3, 0.66, 0.19], [1.6, 0.64, 0.18]]
  ];
  for (const path of bundles) {
    harness.add(new THREE.Mesh(tubePath(path, 0.036, 30), cable));
  }
  b.add("cable-harness", harness);

  /* ---- Teach pendant on its own stand ------------------------------------ */
  const pendant = new THREE.Group();
  const post = new THREE.Mesh(cyl(0.035, 0.045, 0.62, 12), jointMat);
  post.position.y = 0.31;
  pendant.add(post);
  const footplate = new THREE.Mesh(cyl(0.16, 0.18, 0.04, 20), jointMat);
  pendant.add(footplate);
  const panel = new THREE.Mesh(box(0.44, 0.62, 0.07), jointMat);
  panel.position.set(0, 0.86, 0);
  panel.rotation.x = -0.18;
  pendant.add(panel);
  const screen = new THREE.Mesh(box(0.34, 0.26, 0.015), accent);
  screen.position.set(0, 0.98, 0.045);
  screen.rotation.x = -0.18;
  pendant.add(screen);
  for (let i = 0; i < 4; i++) {
    const button = new THREE.Mesh(cyl(0.032, 0.032, 0.03, 12), shell);
    button.rotation.x = Math.PI / 2 - 0.18;
    button.position.set(-0.1 + (i % 2) * 0.2, 0.72 + Math.floor(i / 2) * 0.1, 0.05);
    pendant.add(button);
  }
  b.add("teach-pendant", pendant, { position: [-2.1, -1.72, 0.4], rotation: [0, 0.42, 0] });
}

/* ========================================================================= */
/* 6 · CONTROL PCB                                                           */
/* ========================================================================= */

function buildControlPCB(b) {
  b.absoluteLayout = true;

  const board = surface(0x1c6349, { metalness: 0.22, roughness: 0.68 });
  const copper = surface(0xc9a35a, { metalness: 0.9, roughness: 0.3 });
  const black = surface(0x12161b, { metalness: 0.3, roughness: 0.62 });
  const chip = surface(0x181b20, { metalness: 0.5, roughness: 0.45 });
  const accent = surface(0x4ee6a8, { metalness: 0.3, roughness: 0.3, emissive: 0x0b5a3c, emissiveIntensity: 1.2 });
  const silver = surface(0xd7dee5, { metalness: 0.95, roughness: 0.2 });
  const amber = surface(0xffc24d, { metalness: 0.2, roughness: 0.4, emissive: 0xff9d1a, emissiveIntensity: 1.4 });
  const red = surface(0xff5c5c, { metalness: 0.2, roughness: 0.4, emissive: 0xc01d1d, emissiveIntensity: 1.4 });

  const W = 4.0;
  const D = 2.6;

  /* ---- Board ------------------------------------------------------------- */
  const pcb = new THREE.Group();
  pcb.add(new THREE.Mesh(box(W, 0.08, D), board));
  // Copper edge plating
  put(pcb, new THREE.Mesh(box(W * 1.002, 0.02, 0.05), copper)).position.set(0, 0.045, -D / 2 + 0.03);
  // Traces: deterministic pseudo-random distribution.
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 34; i++) {
    const length = 0.18 + rand() * 0.9;
    const trace = new THREE.Mesh(box(length, 0.008, 0.022), copper);
    trace.position.set(-W / 2 + 0.2 + rand() * (W - 0.5), 0.045, -D / 2 + 0.18 + rand() * 0.45);
    pcb.add(trace);
  }
  for (let i = 0; i < 20; i++) {
    const length = 0.18 + rand() * 0.9;
    const trace = new THREE.Mesh(box(0.022, 0.008, length), copper);
    trace.position.set(-W / 2 + 0.25 + rand() * (W - 0.5), 0.045, 0.2 + rand() * (D / 2 - 0.4));
    pcb.add(trace);
  }
  // Mounting holes
  for (const [x, z] of [[-W / 2 + 0.18, -D / 2 + 0.18], [W / 2 - 0.18, -D / 2 + 0.18],
    [-W / 2 + 0.18, D / 2 - 0.18], [W / 2 - 0.18, D / 2 - 0.18]]) {
    const hole = new THREE.Mesh(cyl(0.075, 0.075, 0.09, 18), copper);
    hole.position.set(x, 0, z);
    pcb.add(hole);
    const pad = new THREE.Mesh(ring(0.1, 0.014, 20), copper);
    pad.rotation.x = Math.PI / 2;
    pad.position.set(x, 0.045, z);
    pcb.add(pad);
  }
  b.add("pcb-substrate", pcb);

  /* ---- MCU ---------------------------------------------------------------- */
  const mcu = new THREE.Group();
  mcu.add(new THREE.Mesh(box(0.62, 0.1, 0.62), chip));
  put(mcu, new THREE.Mesh(box(0.24, 0.015, 0.24), silver)).position.y = 0.058;
  for (let i = 0; i < 8; i++) {
    for (const s of [-1, 1]) {
      const pin = new THREE.Mesh(box(0.075, 0.025, 0.016), silver);
      pin.position.set(-0.24 + i * 0.068, -0.02, s * 0.32);
      mcu.add(pin);
    }
  }
  const pin1 = new THREE.Mesh(cyl(0.018, 0.018, 0.01, 10), accent);
  pin1.position.set(-0.22, 0.06, -0.22);
  mcu.add(pin1);
  b.add("mcu", mcu, { position: [-0.75, 0.09, 0.15] });

  /* ---- Buck converter ------------------------------------------------------ */
  const buck = new THREE.Group();
  buck.add(new THREE.Mesh(box(0.34, 0.08, 0.3), chip));
  const inductor = new THREE.Mesh(cyl(0.12, 0.12, 0.12, 20), surface(0x4a4a52, { metalness: 0.6, roughness: 0.5 }));
  inductor.position.set(0.32, 0.08, 0);
  buck.add(inductor);
  const switchFET = new THREE.Mesh(box(0.12, 0.06, 0.1), black);
  switchFET.position.set(-0.26, 0.07, 0);
  buck.add(switchFET);
  b.add("buck-converter", buck, { position: [1.05, 0.09, -0.72] });

  /* ---- Capacitors ---------------------------------------------------------- */
  const caps = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const ceramic = new THREE.Mesh(box(0.09, 0.05, 0.05),
      i % 3 === 0 ? surface(0x8a7a5c, { metalness: 0.45, roughness: 0.5 })
        : surface(0xb5a184, { metalness: 0.4, roughness: 0.5 }));
    ceramic.position.set(-1.15 + (i % 6) * 0.17, 0.07, 0.62 + Math.floor(i / 6) * 0.16);
    caps.add(ceramic);
  }
  const can = new THREE.Mesh(cyl(0.14, 0.14, 0.34, 22), surface(0x2b3138, { metalness: 0.65, roughness: 0.4 }));
  can.position.set(1.5, 0.2, 0.35);
  caps.add(can);
  const canTop = new THREE.Mesh(cyl(0.14, 0.14, 0.01, 22), silver);
  canTop.position.set(1.5, 0.375, 0.35);
  caps.add(canTop);
  b.add("capacitors", caps);

  /* ---- Crystal ------------------------------------------------------------- */
  const crystal = new THREE.Group();
  crystal.add(new THREE.Mesh(box(0.2, 0.06, 0.12), silver));
  put(crystal, new THREE.Mesh(box(0.09, 0.015, 0.045), copper)).position.y = 0.038;
  b.add("crystal", crystal, { position: [-0.03, 0.08, 0.78] });

  /* ---- USB-C connector ------------------------------------------------------ */
  const usb = new THREE.Group();
  usb.add(new THREE.Mesh(box(0.34, 0.11, 0.42), silver));
  put(usb, new THREE.Mesh(box(0.26, 0.05, 0.24), black)).position.y = 0.06;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(box(0.05, 0.03, 0.12), silver);
    leg.position.set(s * 0.12, -0.06, 0.24);
    usb.add(leg);
  }
  b.add("usb-connector", usb, { position: [-W / 2 + 0.24, 0.1, 0.5] });

  /* ---- GPIO headers --------------------------------------------------------- */
  const gpio = new THREE.Group();
  for (let row = 0; row < 2; row++) {
    const strip = new THREE.Mesh(box(1.3, 0.09, 0.09), black);
    strip.position.set(0.1, 0.1, -0.92 - row * 0.18);
    gpio.add(strip);
    for (let i = 0; i < 12; i++) {
      const pin = new THREE.Mesh(box(0.024, 0.13, 0.024), copper);
      pin.position.set(-0.42 + i * 0.1, 0.15, -0.92 - row * 0.18);
      gpio.add(pin);
    }
  }
  b.add("gpio-header", gpio, { position: [0.3, 0, 0] });

  /* ---- LED array ------------------------------------------------------------ */
  const leds = new THREE.Group();
  const colours = [accent, amber, red];
  for (let i = 0; i < 3; i++) {
    const led = new THREE.Mesh(box(0.055, 0.035, 0.055), colours[i]);
    led.position.set(-1.2 + i * 0.11, 0.08, -0.72);
    leds.add(led);
    const pad = new THREE.Mesh(cyl(0.03, 0.03, 0.02, 10), silver);
    pad.position.set(-1.2 + i * 0.11, 0.05, -0.72);
    leds.add(pad);
  }
  b.add("led-array", leds);

  /* ---- RF antenna: printed inverted-F at the board edge ---------------------- */
  const antenna = new THREE.Group();
  const armLength = 0.62;
  const segments = [
    [[0, 0], [0, armLength]],
    [[0, armLength], [0.3, armLength]],
    [[0.3, armLength], [0.3, 0.3]],
    [[0.3, 0.3], [0.1, 0.3]]
  ];
  for (const [[x1, z1], [x2, z2]] of segments) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const bar = new THREE.Mesh(box(x1 === x2 ? 0.026 : length, 0.012, x1 === x2 ? length : 0.026), copper);
    bar.position.set((x1 + x2) / 2, 0.05, (z1 + z2) / 2);
    antenna.add(bar);
  }
  // Matching network + ground plane under the antenna keep-out.
  const keepOut = new THREE.Mesh(box(0.9, 0.01, 0.86), surface(0x123f2e, { metalness: 0.2, roughness: 0.7 }));
  keepOut.position.set(0.16, 0.042, -0.1);
  antenna.add(keepOut);
  for (let i = 0; i < 3; i++) {
    const match = new THREE.Mesh(box(0.05, 0.03, 0.04), copper);
    match.position.set(-0.06 - i * 0.08, 0.06, 0.1);
    antenna.add(match);
  }
  b.add("rf-antenna", antenna, { position: [W / 2 - 0.55, 0, D / 2 - 0.16] });
}

/* ========================================================================= */
/* 7 · CPU PACKAGE (lid with a cutaway corner)                               */
/* ========================================================================= */

function buildCpuPackage(b) {
  b.absoluteLayout = true;

  const substrateMat = surface(0x2b3a30, { metalness: 0.22, roughness: 0.62 });
  const nickel = surface(0xd6dde3, { metalness: 0.98, roughness: 0.14 });
  const silicon = surface(0x33517a, { metalness: 0.86, roughness: 0.15, emissive: 0x0d1c30, emissiveIntensity: 0.9 });
  const gold = surface(0xd8b061, { metalness: 1, roughness: 0.22 });
  const steel = surface(0x8e9aa6, { metalness: 0.9, roughness: 0.3 });
  const accent = surface(0x6fa8ff, { metalness: 0.4, roughness: 0.3, emissive: 0x14345f, emissiveIntensity: 1.1 });
  const timMat = surface(0xb8c0c8, { metalness: 0.8, roughness: 0.34 });

  const W = 2.6;
  const D = 2.2;

  /* ---- Substrate ---------------------------------------------------------- */
  const substrate = new THREE.Group();
  substrate.add(new THREE.Mesh(box(W, 0.14, D), substrateMat));
  put(substrate, new THREE.Mesh(box(W - 0.12, 0.015, 0.26), gold)).position.set(0, 0.08, -D / 2 + 0.2);
  for (let i = 0; i < 6; i++) {
    const via = new THREE.Mesh(cyl(0.02, 0.02, 0.15, 8), gold);
    via.position.set(-W / 2 + 0.2 + i * 0.2, 0.01, D / 2 - 0.12);
    substrate.add(via);
  }
  b.add("substrate", substrate);

  /* ---- LGA pads on the underside ------------------------------------------ */
  const pads = new THREE.Group();
  const cols = 20;
  const rows = 17;
  const padGeom = box(0.05, 0.018, 0.05);
  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      const pad = new THREE.Mesh(padGeom, gold);
      pad.position.set(-1.14 + x * 0.12, -0.08, -0.96 + z * 0.12);
      pads.add(pad);
    }
  }
  b.add("lga-pads", pads);

  /* ---- Die with core clusters ---------------------------------------------- */
  const die = new THREE.Group();
  die.add(new THREE.Mesh(box(0.98, 0.08, 0.78), silicon));
  for (let i = 0; i < 8; i++) {
    const core = new THREE.Mesh(box(0.14, 0.012, 0.12), accent);
    core.position.set(
      -0.32 + (i % 4) * 0.21,
      0.046,
      i < 4 ? -0.17 : 0.17
    );
    die.add(core);
  }
  put(die, new THREE.Mesh(box(0.3, 0.012, 0.2), accent)).position.set(0, 0.046, 0);
  b.add("die", die, { position: [0, 0.11, 0] });

  /* ---- TIM layer ------------------------------------------------------------ */
  // Stack datum: substrate top 0.07 → die top 0.15 → TIM top 0.18 → IHS 0.18-0.36.
  // Every height below is derived from those, so nothing floats.
  const tim = new THREE.Group();
  // The TIM only extends under the part of the lid that is still fitted, so the
  // exposed silicon reads in the cutaway instead of being covered by paste.
  put(tim, new THREE.Mesh(box(0.62, 0.03, 0.8), timMat)).position.x = 0.4;
  b.add("tim", tim, { position: [0, 0.165, 0] });

  /* ---- IHS: lid opened along the centreline so the die is visible ----------- */
  // A corner notch only ever exposed substrate, so the lid is cut back to
  // z = LID_EDGE and the front third of the die, the TIM spread and the
  // decoupling capacitors read from the camera.
  const LID_EDGE = 0.12;
  const lidShape = new THREE.Shape();
  const hw = 1.1;
  const hd = 0.95;

  lidShape.moveTo(-hw, -hd);
  lidShape.lineTo(hw, -hd);
  lidShape.lineTo(hw, hd);
  lidShape.lineTo(LID_EDGE, hd);
  lidShape.lineTo(LID_EDGE, -hd);
  lidShape.closePath();

  const ihs = new THREE.Group();
  const lidGeom = new THREE.ExtrudeGeometry(lidShape, {
    depth: 0.18, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2
  });
  lidGeom.rotateX(-Math.PI / 2);
  lidGeom.translate(0, 0.18, 0);
  ihs.add(new THREE.Mesh(lidGeom, nickel));

  // Recessed top face for the "engraved" look, clipped to the cut lid.
  const topGeom = new THREE.ExtrudeGeometry(
    (() => {
      const s2 = new THREE.Shape();
      const iw = hw - 0.16;
      const id = hd - 0.16;
      s2.moveTo(-iw, -id);
      s2.lineTo(iw, -id);
      s2.lineTo(iw, id);
      s2.lineTo(LID_EDGE + 0.05, id);
      s2.lineTo(LID_EDGE + 0.05, -id);
      s2.closePath();
      return s2;
    })(),
    { depth: 0.02, bevelEnabled: false }
  );
  topGeom.rotateX(-Math.PI / 2);
  topGeom.translate(0, 0.38, 0);
  ihs.add(new THREE.Mesh(topGeom, surface(0xc3ccd4, { metalness: 0.98, roughness: 0.2 })));

  // Adhesive bead around the perimeter.
  const bead = new THREE.Mesh(new THREE.BoxGeometry(W - 0.34, 0.04, 0.04), surface(0x2a2a2e, { metalness: 0.2, roughness: 0.8 }));
  bead.position.set(0, 0.04, -hd + 0.02);
  bead.scale.x = 0.5;
  ihs.add(bead);

  // Lid rests directly on the TIM: local 0.18 is the lid underside.
  b.add("ihs", ihs, { position: [0, 0, 0] });

  /* ---- Decoupling capacitors on the substrate -------------------------------- */
  const caps = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const cap = new THREE.Mesh(box(0.1, 0.05, 0.055), i % 2
      ? surface(0x8c7a5e, { metalness: 0.4, roughness: 0.5 })
      : surface(0x6b5c46, { metalness: 0.4, roughness: 0.5 }));
    const a = (i / 16) * Math.PI * 2;
    cap.position.set(Math.cos(a) * 1.16, 0.095, Math.sin(a) * 0.98);
    cap.rotation.y = -a;
    caps.add(cap);
  }
  b.add("decoupling-caps", caps);

  /* ---- Retention frame: tight around the package ----------------------------- */
  const frame = new THREE.Group();
  // The frame clamps the lid from the side, so its bars sit at lid mid-height
  // (0.27) and its posts reach down to the substrate top (0.07).
  const LID_MID = 0.27;
  const frameBar = (w, d, x, z) => {
    const bar = new THREE.Mesh(box(w, 0.1, d), steel);
    bar.position.set(x, LID_MID, z);
    frame.add(bar);
  };
  frameBar(W + 0.9, 0.12, 0, -D / 2 - 0.14);
  frameBar(W + 0.9, 0.12, 0, D / 2 + 0.14);
  frameBar(0.12, D + 0.16, -W / 2 - 0.22, 0);
  frameBar(0.12, D + 0.16, W / 2 + 0.22, 0);
  for (const [x, z] of [
    [-W / 2 - 0.22, -D / 2 - 0.14], [W / 2 + 0.22, -D / 2 - 0.14],
    [-W / 2 - 0.22, D / 2 + 0.14], [W / 2 + 0.22, D / 2 + 0.14]
  ]) {
    const postHeight = LID_MID - 0.07;
    const post = new THREE.Mesh(cyl(0.05, 0.05, postHeight, 12), steel);
    post.position.set(x, 0.07 + postHeight / 2, z);
    frame.add(post);
  }
  // Load plate arm across the lid.
  const loadArm = new THREE.Mesh(box(0.16, 0.06, D + 0.34), steel);
  loadArm.position.set(W / 2 + 0.22, LID_MID + 0.08, 0);
  frame.add(loadArm);
  b.add("retention-frame", frame);
}

/* ========================================================================= */
/* 8 · WIND TURBINE                                                          */
/* ========================================================================= */

function buildWindTurbine(b) {
  b.absoluteLayout = true;

  const towerMat = surface(0xc8d1d9, { metalness: 0.42, roughness: 0.5 });
  const shell = surface(0xe8eff5, { metalness: 0.35, roughness: 0.4 });
  const dark = surface(0x3a4653, { metalness: 0.7, roughness: 0.4 });
  const accent = surface(0x3fc9f0, { metalness: 0.4, roughness: 0.3, emissive: 0x0b3e50, emissiveIntensity: 0.9 });
  const concrete = surface(0x9aa3ab, { metalness: 0.05, roughness: 0.9 });

  // Proportions follow a utility turbine: hub height 105 m, rotor diameter
  // 117 m, nacelle 12 m. Scaled so the tower is 2.4 units tall.
  const HUB_Y = 1.15;
  const ROTOR_X = 0.62;
  const BLADE_LENGTH = 1.34;
  const TOWER_H = 2.5;

  /* ---- Foundation ----------------------------------------------------------- */
  const foundation = new THREE.Group();
  foundation.add(new THREE.Mesh(cyl(0.62, 0.74, 0.2, 40), concrete));
  put(foundation, new THREE.Mesh(ring(0.4, 0.035, 40), dark)).position.y = 0.11;
  b.add("foundation", foundation, { position: [0, -1.72, 0] });

  /* ---- Tower ---------------------------------------------------------------- */
  const tower = new THREE.Group();
  const towerBody = new THREE.Mesh(cyl(0.14, 0.28, TOWER_H, 40, true), towerMat);
  towerBody.material = surface(0xc8d1d9, { metalness: 0.42, roughness: 0.5, side: THREE.DoubleSide });
  tower.add(towerBody);
  for (let i = 0; i < 3; i++) {
    const flange = new THREE.Mesh(ring(0.18 + i * 0.045, 0.012, 40), dark);
    flange.rotation.x = Math.PI / 2;
    flange.position.y = -0.85 + i * 0.85;
    tower.add(flange);
  }
  b.add("tower", tower, { position: [0, -0.35, 0] });

  /* ---- Nacelle -------------------------------------------------------------- */
  const nacelle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.72, 8, 24), shell);
  body.rotation.z = Math.PI / 2;
  nacelle.add(body);
  put(nacelle, new THREE.Mesh(box(0.4, 0.05, 0.3), dark)).position.y = -0.17;
  const spinnerPlate = new THREE.Mesh(cyl(0.16, 0.16, 0.03, 24), dark);
  spinnerPlate.rotation.z = Math.PI / 2;
  spinnerPlate.position.x = 0.5;
  nacelle.add(spinnerPlate);
  b.add("nacelle", nacelle, { position: [0, HUB_Y, 0] });

  /* ---- Gearbox (visible in a cutaway section of the nacelle) ----------------- */
  const gearbox = new THREE.Group();
  const gbBody = new THREE.Mesh(cyl(0.15, 0.15, 0.34, 28), dark);
  gbBody.rotation.z = Math.PI / 2;
  gearbox.add(gbBody);
  for (let i = 0; i < 3; i++) {
    const planet = new THREE.Mesh(cyl(0.055, 0.055, 0.1, 16), accent);
    const a = (i / 3) * Math.PI * 2;
    planet.position.set(-0.05, Math.cos(a) * 0.085, Math.sin(a) * 0.085);
    gearbox.add(planet);
  }
  b.add("gearbox", gearbox, { position: [-0.02, HUB_Y, 0] });

  /* ---- Generator ------------------------------------------------------------- */
  const generator = new THREE.Group();
  const genBody = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.48, 28, 1, true), surface(0x8fa0b0, { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
  genBody.rotation.z = Math.PI / 2;
  generator.add(genBody);
  for (let i = 0; i < 5; i++) {
    const finRing = new THREE.Mesh(ring(0.155, 0.012, 24), accent);
    finRing.rotation.y = Math.PI / 2;
    finRing.position.x = -0.18 + i * 0.09;
    generator.add(finRing);
  }
  b.add("generator", generator, { position: [-0.5, HUB_Y, 0] });

  /* ---- Yaw drive -------------------------------------------------------------- */
  // Yaw sits on the tower top (the nacelle underside), not floating at hub height.
  const yaw = new THREE.Group();
  for (const x of [-0.18, 0.18]) {
    const motor = new THREE.Mesh(cyl(0.075, 0.075, 0.2, 16), accent);
    motor.position.set(x, 0.1, 0);
    yaw.add(motor);
  }
  const yawRing = new THREE.Mesh(ring(0.19, 0.03, 32), dark);
  yawRing.rotation.x = Math.PI / 2;
  yaw.add(yawRing);
  b.add("yaw-drive", yaw, { position: [0, HUB_Y - 0.34, 0] });

  /* ---- Hub --------------------------------------------------------------------- */
  const hub = new THREE.Group();
  const hubBody = new THREE.Mesh(sphere(0.21, 32, 20), shell);
  hubBody.scale.set(0.85, 1, 1);
  hub.add(hubBody);
  const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.3, 28), accent);
  noseCone.rotation.z = -Math.PI / 2;
  noseCone.position.x = 0.26;
  hub.add(noseCone);
  for (let i = 0; i < 3; i++) {
    const root = new THREE.Mesh(cyl(0.09, 0.09, 0.12, 20), dark);
    const a = (i / 3) * Math.PI * 2;
    root.position.set(0, Math.cos(a) * 0.15, Math.sin(a) * 0.15);
    root.rotation.x = a;
    hub.add(root);
  }
  b.add("hub", hub, { position: [ROTOR_X, HUB_Y, 0] });

  /* ---- Blades: radial around the X axis, tapered and twisted -------------------- */
  const blades = new THREE.Group();
  const bladeSkin = surface(0xe8eff5, { metalness: 0.35, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Group();

    // Aerofoil planform: chord peaks at ~25 % span then tapers to the tip, and
    // the section pitches progressively flatter toward the tip.
    const stations = [
      { r: 0.06, chord: 0.13, thick: 0.055, twist: 0.52 },
      { r: 0.24, chord: 0.20, thick: 0.050, twist: 0.40 },
      { r: 0.52, chord: 0.185, thick: 0.040, twist: 0.26 },
      { r: 0.82, chord: 0.150, thick: 0.030, twist: 0.14 },
      { r: 1.08, chord: 0.110, thick: 0.022, twist: 0.05 },
      { r: 1.30, chord: 0.070, thick: 0.015, twist: 0.0 },
      { r: BLADE_LENGTH, chord: 0.030, thick: 0.009, twist: -0.03 }
    ];
    const skin = new THREE.Mesh(bladeGeometry(stations), bladeSkin);
    skin.material = surface(0xe8eff5, { metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide });
    blade.add(skin);

    // Root fairing blends the blade into the hub.
    const rootFairing = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.05, 0.18, 18), dark);
    rootFairing.position.y = 0.05;
    blade.add(rootFairing);

    blade.rotation.x = (i / 3) * Math.PI * 2;
    blades.add(blade);
  }
  blades.position.set(ROTOR_X, HUB_Y, 0);
  b.add("blade", blades);

  /* ---- Pitch actuator ------------------------------------------------------------ */
  const pitch = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const actuator = new THREE.Mesh(cyl(0.045, 0.045, 0.16, 14), accent);
    actuator.position.set(-0.08, Math.cos(a) * 0.15, Math.sin(a) * 0.15);
    actuator.rotation.x = a;
    pitch.add(actuator);
  }
  b.add("pitch-actuator", pitch, { position: [ROTOR_X - 0.12, HUB_Y, 0] });

  /* ---- Anemometer ------------------------------------------------------------------ */
  const wind = new THREE.Group();
  const mast = new THREE.Mesh(cyl(0.016, 0.016, 0.22, 10), dark);
  mast.position.y = 0.11;
  wind.add(mast);
  const cups = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const arm = new THREE.Mesh(box(0.1, 0.008, 0.008), dark);
    arm.position.set(Math.cos(a) * 0.05, 0.23, Math.sin(a) * 0.05);
    arm.rotation.y = -a;
    cups.add(arm);
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent);
    cup.position.set(Math.cos(a) * 0.1, 0.23, Math.sin(a) * 0.1);
    cup.rotation.z = Math.PI;
    cups.add(cup);
  }
  wind.add(cups);
  b.add("anemometer", wind, { position: [-0.3, HUB_Y + 0.17, 0] });
}

/* ========================================================================= */
/* PUBLIC API                                                                */
/* ========================================================================= */

const BUILDERS = {
  launchVehicle: buildLaunchVehicle,
  turbojet: buildTurbojet,
  inlineEngine: buildInlineEngine,
  gearTrain: buildGearTrain,
  robotArm: buildRobotArm,
  controlPCB: buildControlPCB,
  cpuPackage: buildCpuPackage,
  windTurbine: buildWindTurbine
};

export function buildAssembly(modelId) {
  const definition = MODEL_LIBRARY.find(model => model.id === modelId);
  if (!definition) throw new Error(`Unknown model: ${modelId}`);
  const builder = new AssemblyBuilder(definition);
  const build = BUILDERS[modelId];
  if (!build) throw new Error(`No procedural builder for ${modelId}`);
  build(builder);
  const result = builder.finish();
  return { ...result, definition, selectable: result.parts };
}

export function getModelCategories() {
  return [...new Set(MODEL_LIBRARY.map(model => model.category))];
}

export function disposeAssembly(assembly) {
  if (!assembly?.group) return;
  assembly.group.traverse(object => {
    if (object.isMesh) object.geometry?.dispose?.();
  });
}
