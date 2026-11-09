
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createComponentInspector } from "./componentInspector.js";

const viewport = document.getElementById("viewport");
const status = document.getElementById("model-status");

// --------------------------------------------------
// SCENE
// --------------------------------------------------

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x050910);
scene.fog = new THREE.Fog(0x050910, 18, 42);

// --------------------------------------------------
// CAMERA
// --------------------------------------------------

const camera = new THREE.PerspectiveCamera(
    45,
    viewport.clientWidth / viewport.clientHeight,
    0.1,
    100
);

camera.position.set(7, 5, 10);

// --------------------------------------------------
// RENDERER
// --------------------------------------------------

let renderer;

try {
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power"
    });
} catch (error) {
    status.textContent = "WEBGL UNAVAILABLE";
    console.error(error);
    throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

renderer.setSize(
    viewport.clientWidth,
    viewport.clientHeight
);

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

viewport.appendChild(renderer.domElement);

// --------------------------------------------------
// CAMERA CONTROLS
// --------------------------------------------------

const controls = new OrbitControls(
    camera,
    renderer.domElement
);

controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4;
controls.maxDistance = 24;
controls.target.set(0, 2.3, 0);

// --------------------------------------------------
// LIGHTING
// --------------------------------------------------

scene.add(
    new THREE.HemisphereLight(
        0xb9ddff,
        0x142033,
        2
    )
);

const keyLight = new THREE.DirectionalLight(
    0xffffff,
    3.5
);

keyLight.position.set(5, 9, 7);
scene.add(keyLight);

const blueLight = new THREE.PointLight(
    0x168cff,
    30,
    20
);

blueLight.position.set(-4, 3, 3);
scene.add(blueLight);

// --------------------------------------------------
// WORKSPACE GRID
// --------------------------------------------------

const grid = new THREE.GridHelper(
    40,
    40,
    0x205078,
    0x142b40
);

grid.position.y = -0.65;
grid.material.transparent = true;
grid.material.opacity = 0.4;

scene.add(grid);

// --------------------------------------------------
// MATERIALS
// --------------------------------------------------

const silver = new THREE.MeshStandardMaterial({
    color: 0xabbfd0,
    metalness: 0.72,
    roughness: 0.3
});

const dark = new THREE.MeshStandardMaterial({
    color: 0x263b50,
    metalness: 0.75,
    roughness: 0.3
});

const cyan = new THREE.MeshStandardMaterial({
    color: 0x28baff,
    metalness: 0.55,
    roughness: 0.25,
    emissive: 0x063c64,
    emissiveIntensity: 1
});

const white = new THREE.MeshStandardMaterial({
    color: 0xe2edf4,
    metalness: 0.35,
    roughness: 0.35
});

// --------------------------------------------------
// DEMONSTRATION ASSEMBLY
// --------------------------------------------------

const assembly = new THREE.Group();

assembly.name = "Demo Rocket Assembly";

function addPart(
    name,
    geometry,
    material,
    position,
    details
) {
    const mesh = new THREE.Mesh(geometry, material);

    mesh.name = name;
    mesh.position.set(...position);

    mesh.userData.component = {
        id: details.id,
        type: details.type,
        description: details.description,
        material: details.material || "Not supplied",
        source: "Procedural demonstration geometry"
    };

    assembly.add(mesh);

    return mesh;
}

// Nose cone
addPart(
    "Nose Cone",
    new THREE.ConeGeometry(0.68, 1.2, 48),
    silver,
    [0, 4.6, 0],
    {
        id: "RC-001",
        type: "Primary structure",
        description: "Upper aerodynamic demonstration section"
    }
);

// Payload bay
addPart(
    "Payload Bay",
    new THREE.CylinderGeometry(0.54, 0.54, 0.55, 40),
    dark,
    [0, 3.72, 0],
    {
        id: "RC-002",
        type: "Subassembly",
        description: "Upper demonstration module"
    }
);

// Upper tank
addPart(
    "Upper Tank",
    new THREE.CylinderGeometry(0.7, 0.7, 1.05, 48),
    silver,
    [0, 2.92, 0],
    {
        id: "RC-003",
        type: "Main body",
        description: "Upper cylindrical demonstration section"
    }
);

// Interstage
addPart(
    "Interstage Adapter",
    new THREE.CylinderGeometry(0.79, 0.75, 0.28, 48),
    dark,
    [0, 2.2, 0],
    {
        id: "RC-004",
        type: "Structural component",
        description: "Connector between body sections"
    }
);

// Lower tank
addPart(
    "Lower Tank",
    new THREE.CylinderGeometry(0.83, 0.83, 1.3, 48),
    silver,
    [0, 1.35, 0],
    {
        id: "RC-005",
        type: "Main body",
        description: "Lower cylindrical demonstration section"
    }
);

// Engine skirt
addPart(
    "Engine Skirt",
    new THREE.CylinderGeometry(0.85, 0.7, 0.42, 48),
    dark,
    [0, 0.48, 0],
    {
        id: "RC-006",
        type: "Structural component",
        description: "Lower assembly housing"
    }
);

// Engine mount
addPart(
    "Engine Mount",
    new THREE.CylinderGeometry(0.52, 0.52, 0.22, 40),
    cyan,
    [0, 0.15, 0],
    {
        id: "RC-007",
        type: "Subassembly",
        description: "Central demonstration engine mount"
    }
);

// Four independent demonstration engine nozzles
const nozzlePositions = [
    [-0.27, -0.2, -0.27],
    [ 0.27, -0.2, -0.27],
    [-0.27, -0.2,  0.27],
    [ 0.27, -0.2,  0.27]
];

nozzlePositions.forEach((position, index) => {
    addPart(
        `Engine Nozzle ${index + 1}`,
        new THREE.ConeGeometry(0.22, 0.65, 28),
        dark,
        position,
        {
            id: `RC-00${8 + index}`,
            type: "Demonstration component",
            description: "Individual nozzle geometry"
        }
    );
});

// Structural fins
const finPositions = [
    [0.77, 0.48, 0],
    [-0.77, 0.48, 0],
    [0, 0.48, 0.77],
    [0, 0.48, -0.77]
];

finPositions.forEach((position, index) => {
    const fin = addPart(
        `Stabilizer ${index + 1}`,
        new THREE.BoxGeometry(0.14, 0.7, 0.48),
        dark,
        position,
        {
            id: `RC-01${index + 2}`,
            type: "External structure",
            description: "Demonstration stabilizer geometry"
        }
    );

    if (index === 0) fin.rotation.z = -0.25;
    if (index === 1) fin.rotation.z = 0.25;
    if (index === 2) fin.rotation.x = 0.25;
    if (index === 3) fin.rotation.x = -0.25;
});

// Connector rings
function addRing(name, radius, height, id) {
    const ring = addPart(
        name,
        new THREE.TorusGeometry(radius, 0.035, 8, 64),
        cyan,
        [0, height, 0],
        {
            id,
            type: "Connector",
            description: "Cyan demonstration connector ring"
        }
    );

    ring.rotation.x = Math.PI / 2;

    return ring;
}

addRing("Upper Connector Ring", 0.72, 3.45, "RC-020");
addRing("Middle Connector Ring", 0.81, 2.35, "RC-021");
addRing("Lower Connector Ring", 0.83, 0.69, "RC-022");

scene.add(assembly);

// --------------------------------------------------
// COMPONENT INSPECTOR
// --------------------------------------------------

const inspector = createComponentInspector({
    THREE,
    scene,
    camera,
    controls,
    assembly,
    renderer
});

// --------------------------------------------------
// ANIMATION
// --------------------------------------------------

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.05);

    inspector.update(delta);
    controls.update();

    renderer.render(scene, camera);
}

animate();

// --------------------------------------------------
// RESPONSIVE VIEWPORT
// --------------------------------------------------

window.addEventListener("resize", () => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
});

status.textContent = "INSPECTION ENGINE READY";

console.log("HOLOCORE Component Inspection Engine initialized.");
