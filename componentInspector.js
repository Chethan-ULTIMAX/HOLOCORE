
export function createComponentInspector({
    THREE,
    scene,
    camera,
    controls,
    assembly,
    renderer
}) {
    const list = document.getElementById("component-list");
    const inspector = document.getElementById("inspector-content");
    const count = document.getElementById("component-count");
    const status = document.getElementById("model-status");

    const explodeButton = document.getElementById("explode-btn");
    const focusButton = document.getElementById("focus-btn");
    const isolateButton = document.getElementById("isolate-btn");
    const resetButton = document.getElementById("reset-btn");

    const parts = [];

    assembly.traverse(object => {
        if (object.isMesh) parts.push(object);
    });

    if (!list || !inspector || parts.length === 0) {
        throw new Error("Component Inspector initialization failed.");
    }

    const homes = new Map();
    const explodedPositions = new Map();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let selected = null;
    let highlightBox = null;

    let exploded = false;
    let isolated = false;
    let previousVisibility = null;

    let cameraGoal = null;
    let targetGoal = null;

    const homeCamera = camera.position.clone();
    const homeTarget = controls.target.clone();

    const assemblyBounds = new THREE.Box3().setFromObject(assembly);
    const assemblyCenter = assemblyBounds.getCenter(
        new THREE.Vector3()
    );

    // Store original positions and calculate exploded positions.
    parts.forEach((part, index) => {
        homes.set(part, part.position.clone());

        const bounds = new THREE.Box3().setFromObject(part);
        const partCenter = bounds.getCenter(new THREE.Vector3());

        const direction = partCenter.sub(assemblyCenter);

        if (direction.lengthSq() < 0.0001) {
            direction.set(0, 1, 0);
        }

        direction.normalize();

        const size = bounds.getSize(new THREE.Vector3()).length();
        const distance = 0.7 + Math.min(size * 0.15, 0.5);

        const destination = part.position.clone().add(
            direction.multiplyScalar(distance)
        );

        explodedPositions.set(part, destination);
    });

    count.textContent = `${parts.length} COMPONENTS`;

    function setStatus(message) {
        status.textContent = message;
    }

    function makeElement(tag, className, text) {
        const element = document.createElement(tag);

        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;

        return element;
    }

    function addProperty(parent, label, value) {
        const row = makeElement("div", "property-row");

        row.appendChild(makeElement("span", "", label));
        row.appendChild(makeElement("strong", "", String(value)));

        parent.appendChild(row);
    }

    function removeHighlight() {
        if (!highlightBox) return;

        scene.remove(highlightBox);
        highlightBox.geometry.dispose();
        highlightBox.material.dispose();

        highlightBox = null;
    }

    function renderList() {
        list.replaceChildren();

        parts.forEach((part, index) => {
            const button = makeElement("button", "component-item");

            if (part === selected) {
                button.classList.add("active");
            }

            button.appendChild(
                makeElement(
                    "span",
                    "component-index",
                    String(index + 1).padStart(2, "0")
                )
            );

            button.appendChild(
                makeElement("span", "", part.name || `Part ${index + 1}`)
            );

            button.addEventListener("click", () => {
                selectPart(part);
            });

            list.appendChild(button);
        });
    }

    function renderInspector() {
        inspector.replaceChildren();

        if (!selected) {
            const empty = makeElement("div", "empty-inspector");

            empty.appendChild(makeElement("div", "empty-icon", "◇"));
            empty.appendChild(
                makeElement("strong", "", "No component selected")
            );

            empty.appendChild(
                makeElement(
                    "p",
                    "",
                    "Select a part from the explorer or 3D viewport to inspect it."
                )
            );

            inspector.appendChild(empty);

            focusButton.disabled = true;
            isolateButton.disabled = true;

            return;
        }

        focusButton.disabled = false;
        isolateButton.disabled = false;

        const metadata = selected.userData.component || {};

        const heading = makeElement("div", "selected-heading");

        heading.appendChild(
            makeElement("small", "", "SELECTED COMPONENT")
        );

        heading.appendChild(
            makeElement("strong", "", selected.name)
        );

        inspector.appendChild(heading);

        const identity = makeElement("div", "property-title", "IDENTITY");
        inspector.appendChild(identity);

        addProperty(inspector, "Component ID", metadata.id || "Not assigned");
        addProperty(inspector, "Component type", metadata.type || "Mesh");
        addProperty(
            inspector,
            "Description",
            metadata.description || "Not provided"
        );

        const bounds = new THREE.Box3().setFromObject(selected);
        const dimensions = bounds.getSize(new THREE.Vector3());
        const position = selected.getWorldPosition(
            new THREE.Vector3()
        );

        const geometry = selected.geometry;
        const vertexCount = geometry.attributes.position
            ? geometry.attributes.position.count
            : 0;

        const faceCount = geometry.index
            ? geometry.index.count / 3
            : vertexCount / 3;

        inspector.appendChild(
            makeElement("div", "property-title", "GEOMETRY")
        );

        addProperty(
            inspector,
            "Bounding dimensions (scene units)",
            `${dimensions.x.toFixed(2)} × ${dimensions.y.toFixed(2)} × ${dimensions.z.toFixed(2)}`
        );

        addProperty(
            inspector,
            "World position",
            `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`
        );

        addProperty(
            inspector,
            "Vertices",
            vertexCount.toLocaleString()
        );

        addProperty(
            inspector,
            "Triangles",
            Math.round(faceCount).toLocaleString()
        );

        inspector.appendChild(
            makeElement("div", "property-title", "ENGINEERING DATA")
        );

        addProperty(
            inspector,
            "Material",
            metadata.material || "Not supplied"
        );

        addProperty(
            inspector,
            "Data source",
            metadata.source || "Demo geometry"
        );

        const clearButton = makeElement(
            "button",
            "clear-selection",
            "Clear selection"
        );

        clearButton.addEventListener("click", () => {
            selectPart(null);
        });

        inspector.appendChild(clearButton);
    }

    function selectPart(part) {
        selected = part;

        removeHighlight();

        if (selected) {
            highlightBox = new THREE.BoxHelper(selected, 0x35baff);
            highlightBox.material.transparent = true;
            highlightBox.material.opacity = 0.95;
            highlightBox.material.depthTest = false;

            highlightBox.renderOrder = 10;

            scene.add(highlightBox);

            if (isolated) {
                parts.forEach(item => {
                    item.visible = item === selected;
                });
            }

            setStatus(`SELECTED: ${selected.name.toUpperCase()}`);
        } else {
            setStatus(`${parts.length} COMPONENTS READY`);
        }

        renderList();
        renderInspector();
    }

    function toggleExplode() {
        exploded = !exploded;

        explodeButton.textContent = exploded
            ? "Reassemble"
            : "Explode";

        setStatus(
            exploded ? "EXPLODED VIEW" : "ASSEMBLY RESTORED"
        );
    }

    function toggleIsolate() {
        if (!selected) return;

        if (!isolated) {
            previousVisibility = new Map(
                parts.map(part => [part, part.visible])
            );

            parts.forEach(part => {
                part.visible = part === selected;
            });

            isolated = true;
            isolateButton.textContent = "Show All";

            setStatus(`ISOLATED: ${selected.name.toUpperCase()}`);
        } else {
            restoreVisibility();
            setStatus("ALL COMPONENTS VISIBLE");
        }

        renderList();
    }

    function restoreVisibility() {
        if (previousVisibility) {
            parts.forEach(part => {
                part.visible = previousVisibility.get(part) ?? true;
            });
        }

        previousVisibility = null;
        isolated = false;
        isolateButton.textContent = "Isolate";
    }

    function focusSelected() {
        if (!selected) return;

        const bounds = new THREE.Box3().setFromObject(selected);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());

        let direction = camera.position.clone().sub(controls.target);

        if (direction.lengthSq() < 0.0001) {
            direction.set(0.4, 0.3, 1);
        }

        direction.normalize();

        const distance = Math.max(size.length() * 2.2, 3);

        cameraGoal = center.clone().addScaledVector(
            direction,
            distance
        );

        targetGoal = center;
    }

    function resetView() {
        if (isolated) restoreVisibility();

        exploded = false;
        explodeButton.textContent = "Explode";

        selectPart(null);

        cameraGoal = homeCamera.clone();
        targetGoal = homeTarget.clone();

        setStatus("VIEW RESET");
    }

    // Select parts through mouse or pointer interaction.
    let pointerStart = null;

    renderer.domElement.addEventListener("pointerdown", event => {
        pointerStart = {
            x: event.clientX,
            y: event.clientY
        };
    });

    renderer.domElement.addEventListener("pointerup", event => {
        if (!pointerStart) return;

        const dx = event.clientX - pointerStart.x;
        const dy = event.clientY - pointerStart.y;

        pointerStart = null;

        // Ignore drags used by OrbitControls.
        if (Math.hypot(dx, dy) > 6) return;

        const rect = renderer.domElement.getBoundingClientRect();

        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);

        const visibleParts = parts.filter(part => part.visible);

        const hits = raycaster.intersectObjects(visibleParts, true);

        if (hits.length > 0) {
            selectPart(hits[0].object);
        }
    });

    renderer.domElement.addEventListener("pointerleave", () => {
        pointerStart = null;
    });

    explodeButton.addEventListener("click", toggleExplode);
    focusButton.addEventListener("click", focusSelected);
    isolateButton.addEventListener("click", toggleIsolate);
    resetButton.addEventListener("click", resetView);

    // Animate component positions and camera transitions.
    function update(delta) {
        const alpha = 1 - Math.exp(-8 * delta);

        for (const part of parts) {
            const destination = exploded
                ? explodedPositions.get(part)
                : homes.get(part);

            part.position.lerp(destination, alpha);

            if (part.position.distanceToSquared(destination) < 0.00001) {
                part.position.copy(destination);
            }
        }

        if (highlightBox) {
            highlightBox.update();
        }

        if (cameraGoal && targetGoal) {
            const cameraAlpha = 1 - Math.exp(-4 * delta);

            camera.position.lerp(cameraGoal, cameraAlpha);
            controls.target.lerp(targetGoal, cameraAlpha);

            if (
                camera.position.distanceToSquared(cameraGoal) < 0.0001 &&
                controls.target.distanceToSquared(targetGoal) < 0.0001
            ) {
                camera.position.copy(cameraGoal);
                controls.target.copy(targetGoal);

                cameraGoal = null;
                targetGoal = null;
            }
        }
    }

    renderList();
    renderInspector();

    setStatus(`${parts.length} COMPONENTS READY`);

    return {
        update,
        selectPart,
        getSelected: () => selected,
        getParts: () => [...parts]
    };
}
