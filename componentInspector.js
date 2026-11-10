/**
 * HOLOCORE — componentInspector.js
 * -----------------------------------------------------------------------------
 * Turns the selected 3D part into a structured engineering brief.
 *
 * The panel is driven entirely by engineeringData.js, so what appears on screen
 * always corresponds to the part that is highlighted in the scene.
 */

import {
  getComponentData,
  resolveRelationName,
  DATA_PROVENANCE
} from "./engineeringData.js";

import { COLOR_PALETTE } from "./voiceControl.js";

const deg = radians => (radians * 180) / Math.PI;

const formatVec = v =>
  `${(v?.x ?? 0).toFixed(2)}, ${(v?.y ?? 0).toFixed(2)}, ${(v?.z ?? 0).toFixed(2)}`;

export class ComponentInspector {
  constructor({ root, onFocus, onIsolate, onShowRelated, onAsk, onClear, getWorkspace, getPlayground }) {
    this.root = root;
    this.onFocus = onFocus || (() => {});
    this.onIsolate = onIsolate || (() => {});
    this.onShowRelated = onShowRelated || (() => {});
    this.onAsk = onAsk || (() => {});
    this.onClear = onClear || (() => {});
    this.getWorkspace = getWorkspace || (() => null);
    // The playground is optional: the inspector works without it, it just has
    // no prop materials to edit.
    this.getPlayground = getPlayground || (() => null);

    this.modelId = null;
    this.partId = null;
    this.tab = "overview";
    this._render();
  }

  setModel(modelId) {
    this.modelId = modelId;
    this.partId = null;
    this._render();
  }

  select(partId) {
    this.partId = partId || null;
    this.tab = "overview";
    this._render();
  }

  /**
   * Imported geometry has no engineering data. Clearing the model id makes the
   * inspector show an explicit "no knowledge entry" state instead of inventing
   * a description.
   */
  clearSelection() {
    this.partId = null;
    this._render();
  }

  /**
   * Refresh live values after the scene changed underneath us.
   *
   * A full re-render would steal focus from a slider mid-drag, so this only
   * updates the readouts. Called when a hand gesture moves the object.
   */
  updateProperties() {
    if (!this.root) return;

    // Transform rows come first in the overview tab, then the material
    // sliders, so the readouts are addressed by section rather than by index.
    const tf = this._currentTransform();
    const sections = this.root.querySelectorAll(".inspector-section");
    for (const section of sections) {
      const title = section.querySelector(".section-title")?.textContent;
      const values = section.querySelectorAll(".prop-group .prop-val");
      if (!values.length) continue;

      if (title === "Transform" && tf) {
        if (values[0]) values[0].textContent = formatVec(tf.position);
        if (values[1]) {
          values[1].textContent =
            `${Math.round(deg(tf.rotationZ))}°, ${Math.round(deg(tf.rotationX))}°, ${Math.round(deg(tf.rotationY))}°`;
        }
        if (values[2]) values[2].textContent = `${tf.scale.toFixed(2)}×`;
      }

      if (title === "Material") {
        // The slider readouts live in .prop-slider-item rows.
        const sliderValues = section.querySelectorAll(".prop-slider-item .prop-val");
        const material = this._currentMaterial();
        if (!material) continue;
        if (sliderValues[0]) sliderValues[0].textContent = Number(material.roughness).toFixed(2);
        if (sliderValues[1]) sliderValues[1].textContent = Number(material.metalness).toFixed(2);
      }
    }
  }

  /** Called after isolation toggles so buttons stay in sync. */
  setState({ isolated = false } = {}) {
    this._isolated = isolated;
    this._syncButtons();
  }

  /* --------------------------------------------------------------------- */

  _data() {
    if (!this.partId || !this.modelId) return null;
    return getComponentData(this.modelId, this.partId);
  }

  /** The playground object behind the current selection, if any. */
  _selectedObject() {
    const playground = this.getPlayground?.();
    const propId = playground?.selectedId;
    if (propId) return playground.byId?.get(propId) || null;
    // An imported or spawn id that is not a documented assembly part.
    if (!this.partId) return null;
    if (this.modelId && getComponentData(this.modelId, this.partId)) return null;
    const material = this.getWorkspace()?.getPartMaterial?.(this.partId);
    return material ? { id: this.partId, name: this.partId, material } : null;
  }

  /** Panel for a selected object that has no engineering knowledge entry. */
  _renderObjectPanel() {
    const object = this._selectedObject();
    if (!object) {
      this._renderEmpty();
      return;
    }

    const name = object.name || object.id;
    const header = this._el("div", "inspector-header");
    header.appendChild(this._el("h2", "inspector-title", String(name).toUpperCase()));
    const kind = object.primitive ? "PRIMITIVE" : "OBJECT";
    header.appendChild(this._el("span", "inspector-kind", kind));
    this.root.appendChild(header);

    const body = this._el("div", "inspector-body");
    this.root.appendChild(body);

    const geometry = this._el("section", "inspector-section");
    geometry.appendChild(this._el("h3", "section-title", "Object"));
    const grid = this._el("dl", "spec-grid");
    grid.appendChild(this._el("dt", "", "Id"));
    grid.appendChild(this._el("dd", "", object.id));
    if (object.primitive) {
      grid.appendChild(this._el("dt", "", "Type"));
      grid.appendChild(this._el("dd", "", object.primitive));
    }
    geometry.appendChild(grid);
    geometry.appendChild(
      this._el("p", "provenance",
        "Spawned object — no engineering knowledge entry. Material changes apply immediately.")
    );
    body.appendChild(geometry);

    this._renderTransform(body);
    this._renderMaterials(body);
  }

  _el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  _render() {
    if (!this.root) return;
    this.root.replaceChildren();
    const data = this._data();

    // A selected object with no engineering entry (a playground prop, or an
    // imported mesh) still gets a real panel: name, measured geometry and the
    // material controls. Previously the inspector bailed out to the empty state,
    // which is why the material section never appeared.
    if (!data) {
      if (this._selectedObject()) {
        this._renderObjectPanel();
        return;
      }
      this._renderEmpty();
      return;
    }

    this._renderHeader(data);
    this._renderTabs();
    const body = this._el("div", "inspector-body");
    this.root.appendChild(body);

    if (this.tab === "overview") {
      this._renderOverview(body, data);
      this._renderTransform(body);
      this._renderMaterials(body);
    }
    else if (this.tab === "system") this._renderSystem(body, data);
    else if (this.tab === "learn") this._renderLearn(body, data);

    this._renderActions(data);
    this._syncButtons();
  }

  _renderEmpty() {
    const empty = this._el("div", "inspector-empty");
    empty.appendChild(this._el("div", "inspector-empty-glyph", "◇"));
    empty.appendChild(this._el("strong", "", "No component selected"));

    const partCount = this.getWorkspace()?.parts?.length || 0;
    const workspace = this.getWorkspace();

    if (workspace?.imported) {
      empty.appendChild(
        this._el(
          "p",
          "",
          "Imported geometry has no engineering knowledge entry. Select a mesh to see its " +
            "name, materials and measured geometry. Pick a model from the library to return " +
            "to documented components."
        )
      );
    } else {
      empty.appendChild(
        this._el(
          "p",
          "",
          partCount
            ? `Point at a component with your index finger, or click one of the ${partCount} ` +
              "parts in the viewport or the parts list."
            : "Load an assembly to begin inspection."
        )
      );
    }

    const hint = this._el("div", "inspector-hint");
    hint.innerHTML =
      "<span>POINT</span> hover &amp; highlight · <span>PINCH</span> grab the whole assembly";
    empty.appendChild(hint);

    this.root.appendChild(empty);
  }

  _renderHeader(data) {
    const header = this._el("div", "inspector-head");

    const meta = this._el("div", "inspector-meta");
    meta.appendChild(this._el("span", "tag-accent", data.category || "Component"));
    meta.appendChild(this._el("span", "tag-muted", this.partId));
    header.appendChild(meta);

    header.appendChild(this._el("h2", "inspector-title", data.name));
    header.appendChild(this._el("p", "inspector-subtitle", data.short || ""));

    this.root.appendChild(header);
  }

  _renderTabs() {
    const tabs = [
      ["overview", "Overview"],
      ["system", "System"],
      ["learn", "Learn"]
    ];
    const bar = this._el("div", "inspector-tabs");
    for (const [id, label] of tabs) {
      const button = this._el("button", "inspector-tab", label);
      button.type = "button";
      if (this.tab === id) button.classList.add("active");
      button.addEventListener("click", () => {
        this.tab = id;
        this._render();
      });
      bar.appendChild(button);
    }
    this.root.appendChild(bar);
  }

  _section(parent, title, className = "") {
    const section = this._el("section", `inspector-section ${className}`.trim());
    section.appendChild(this._el("h3", "section-title", title));
    parent.appendChild(section);
    return section;
  }

  _renderOverview(body, data) {
    const fn = this._section(body, "Function");
    fn.appendChild(this._el("p", "prose", data.function));

    const spec = this._section(body, "Technical specification");
    const table = this._el("dl", "spec-grid");
    for (const row of data.specs || []) {
      table.appendChild(this._el("dt", "", row.label));
      table.appendChild(this._el("dd", "", row.value));
    }
    spec.appendChild(table);
    spec.appendChild(this._el("p", "provenance", DATA_PROVENANCE.note));

    const work = this._section(body, "Working principle");
    work.appendChild(this._el("p", "prose", data.principle));

    if (data.materials?.length) {
      const mat = this._section(body, "Materials");
      const chips = this._el("div", "chip-row");
      for (const material of data.materials) {
        chips.appendChild(this._el("span", "chip", material));
      }
      mat.appendChild(chips);
    }

    if (data.facts?.length) {
      const facts = this._section(body, "Engineering notes");
      const list = this._el("ul", "bullet-list");
      for (const fact of data.facts) list.appendChild(this._el("li", "", fact));
      facts.appendChild(list);
    }
  }

  /**
   * Live transform readout for the selected part.
   *
   * Ported from main, which rendered position/rotation/scale above the
   * material controls. Read-only on purpose: gestures and the keyboard own
   * transforms, and duplicating that as text fields invites the two to
   * disagree. The values are refreshed by updateProperties().
   */
  _renderTransform(body) {
    const tf = this._currentTransform();
    if (!tf) return;

    const section = this._section(body, "Transform");
    const grid = this._el("div", "prop-group");
    const row = (label, value) => {
      const line = this._el("div", "prop-row");
      line.appendChild(this._el("span", "prop-label", label));
      line.appendChild(this._el("span", "prop-val", value));
      grid.appendChild(line);
    };

    row("Position", formatVec(tf.position));
    row("Rotation", `${Math.round(deg(tf.rotationZ))}°, ${Math.round(deg(tf.rotationX))}°, ${Math.round(deg(tf.rotationY))}°`);
    row("Scale", `${tf.scale.toFixed(2)}×`);
    section.appendChild(grid);
  }

  /** Transform of whatever is selected, in a shape both sources share. */
  _currentTransform() {
    const playground = this.getPlayground?.();
    const prop = playground?.selectedId ? playground.byId?.get(playground.selectedId) : null;
    if (prop) {
      return {
        position: prop.group.position,
        rotationX: prop.group.rotation.x,
        rotationY: prop.group.rotation.y,
        rotationZ: prop.group.rotation.z,
        scale: prop.group.scale.x
      };
    }

    const ws = this.getWorkspace?.();
    if (!ws || !this.partId) return null;
    const tf = ws.getPartTransform?.(this.partId);
    if (!tf) return null;
    return {
      position: tf.offset,
      rotationX: tf.rotationX || 0,
      rotationY: tf.rotationY || 0,
      rotationZ: tf.rotationZ || 0,
      scale: tf.scale ?? 1
    };
  }

  /**
   * Live material controls for the selected object.
   *
   * Ported from the main branch: colour input, palette swatches, wireframe
   * switch and roughness/metalness sliders. main applied these only to
   * documented assembly parts; here the same panel drives a playground object
   * when one is selected, because that is where users actually edit materials.
   */
  _renderMaterials(body) {
    const ws = this.getWorkspace();
    if (!ws) return;

    const playground = this.getPlayground?.();
    const propId = playground?.selectedId;
    const material = propId
      ? playground.getMaterial?.(propId)
      : ws.getPartMaterial?.(this.partId);
    if (!material) return;

    const section = this._section(body, "Material");

    // ---- colour ---------------------------------------------------------
    const colourRow = this._el("div", "prop-color-row");
    const colourInput = this._el("input", "prop-color-input");
    colourInput.type = "color";
    colourInput.value = material.color?.startsWith("#") ? material.color : "#3fd0ff";
    colourInput.title = "Object colour";
    colourInput.setAttribute("aria-label", "Object colour");
    colourInput.addEventListener("input", () => {
      this._applyMaterial({ color: colourInput.value });
    });

    const swatches = this._el("div", "prop-swatches");
    for (const [name, hex] of Object.entries(COLOR_PALETTE)) {
      const swatch = this._el("button", "prop-swatch");
      swatch.type = "button";
      swatch.style.background = hex;
      swatch.title = name;
      swatch.setAttribute("aria-label", `Colour: ${name}`);
      swatch.addEventListener("click", () => {
        colourInput.value = hex;
        this._applyMaterial({ color: hex });
      });
      swatches.appendChild(swatch);
    }
    colourRow.append(colourInput, swatches);
    section.appendChild(colourRow);

    // ---- wireframe ------------------------------------------------------
    const wireRow = this._el("label", "prop-row prop-switch-label");
    wireRow.appendChild(this._el("span", "prop-label", "Wireframe"));
    const wireInput = this._el("input", "");
    wireInput.type = "checkbox";
    wireInput.checked = Boolean(material.wireframe);
    wireInput.addEventListener("change", () => {
      this._applyMaterial({ wireframe: wireInput.checked });
    });
    wireRow.appendChild(wireInput);
    section.appendChild(wireRow);

    // ---- roughness / metalness ------------------------------------------
    const sliders = this._el("div", "prop-sliders");
    const addSlider = (label, key, value) => {
      const item = this._el("div", "prop-slider-item");
      const labelRow = this._el("div", "prop-row");
      labelRow.appendChild(this._el("span", "prop-label", label));
      const readout = this._el("span", "prop-val", Number(value).toFixed(2));
      labelRow.appendChild(readout);

      const input = this._el("input", "prop-slider-input");
      input.type = "range";
      input.min = "0";
      input.max = "1";
      input.step = "0.01";
      input.value = String(value);
      input.setAttribute("aria-label", label);
      input.addEventListener("input", () => {
        readout.textContent = Number(input.value).toFixed(2);
        this._applyMaterial({ [key]: Number(input.value) });
      });

      item.append(labelRow, input);
      sliders.appendChild(item);
    };
    addSlider("Roughness", "roughness", material.roughness);
    addSlider("Metalness", "metalness", material.metalness);
    section.appendChild(sliders);
  }

  /** The material of whatever is currently selected, or null. */
  _currentMaterial() {
    const playground = this.getPlayground?.();
    const propId = playground?.selectedId;
    if (propId) return playground.getMaterial?.(propId) || null;
    if (!this.partId) return null;
    return this.getWorkspace()?.getPartMaterial?.(this.partId) || null;
  }

  /** Route a material change to whichever thing is actually selected. */
  _applyMaterial(options) {
    const playground = this.getPlayground?.();
    const propId = playground?.selectedId;
    if (propId && playground.setMaterial?.(propId, options)) return true;
    if (this.partId) return Boolean(this.getWorkspace()?.setPartMaterial?.(this.partId, options));
    return false;
  }

  _renderSystem(body, data) {
    const role = this._section(body, "Role in the assembly");
    role.appendChild(this._el("p", "prose", data.role));

    const rel = this._section(body, "Connected components");
    if (!data.relations?.length) {
      rel.appendChild(this._el("p", "prose muted", "This component has no recorded interfaces."));
    } else {
      const list = this._el("div", "relation-list");
      for (const relation of data.relations) {
        const button = this._el("button", "relation-item");
        button.type = "button";
        button.appendChild(
          this._el("span", "relation-name", resolveRelationName(this.modelId, relation.target))
        );
        button.appendChild(this._el("span", "relation-desc", relation.label));
        button.appendChild(this._el("span", "relation-arrow", "›"));
        button.addEventListener("click", () => this.onShowRelated(relation.target));
        list.appendChild(button);
      }
      rel.appendChild(list);
    }

    if (data.failureMode) {
      const fail = this._section(body, "Failure behaviour", "section-warning");
      fail.appendChild(this._el("p", "prose", data.failureMode));
    }
  }

  _renderLearn(body, data) {
    const edu = this._section(body, "Explain it simply");
    edu.appendChild(this._el("p", "prose lead", data.education));

    const summary = this._section(body, "In the wider system");
    summary.appendChild(this._el("p", "prose", data.role));

    const questions = this._section(body, "Ask the assistant");
    const chips = this._el("div", "chip-row wrap");
    const prompts = [
      `How does the ${data.name} work?`,
      `What happens if the ${data.name} fails?`,
      `What is the ${data.name} connected to?`
    ];
    for (const prompt of prompts) {
      const button = this._el("button", "chip chip-action", prompt);
      button.type = "button";
      button.addEventListener("click", () => this.onAsk(prompt));
      chips.appendChild(button);
    }
    questions.appendChild(chips);
  }

  _renderActions(data) {
    const actions = this._el("div", "inspector-actions");

    const focus = this._el("button", "btn btn-primary", "Focus component");
    focus.type = "button";
    focus.addEventListener("click", () => this.onFocus());
    actions.appendChild(focus);

    const isolate = this._el("button", "btn", "Isolate");
    isolate.type = "button";
    isolate.dataset.role = "isolate";
    isolate.addEventListener("click", () => this.onIsolate());
    actions.appendChild(isolate);

    const related = this._el("button", "btn", "Show connections");
    related.type = "button";
    if (!data.relations?.length) related.disabled = true;
    related.addEventListener("click", () => {
      const target = data.relations?.[0]?.target;
      if (target) this.onShowRelated(target);
    });
    actions.appendChild(related);

    const clear = this._el("button", "btn btn-ghost", "Clear selection");
    clear.type = "button";
    clear.addEventListener("click", () => this.onClear());
    actions.appendChild(clear);

    this.root.appendChild(actions);
  }

  _syncButtons() {
    const button = this.root.querySelector('[data-role="isolate"]');
    if (button) button.textContent = this._isolated ? "Show all" : "Isolate";
  }
}
