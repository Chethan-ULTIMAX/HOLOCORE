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

export class ComponentInspector {
  constructor({ root, onFocus, onIsolate, onShowRelated, onAsk, onClear, getWorkspace }) {
    this.root = root;
    this.onFocus = onFocus || (() => {});
    this.onIsolate = onIsolate || (() => {});
    this.onShowRelated = onShowRelated || (() => {});
    this.onAsk = onAsk || (() => {});
    this.onClear = onClear || (() => {});
    this.getWorkspace = getWorkspace || (() => null);

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

    if (!data) {
      this._renderEmpty();
      return;
    }

    this._renderHeader(data);
    this._renderTabs();
    const body = this._el("div", "inspector-body");
    this.root.appendChild(body);

    if (this.tab === "overview") this._renderOverview(body, data);
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
