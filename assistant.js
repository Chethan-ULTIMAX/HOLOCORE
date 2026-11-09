/**
 * HOLOCORE — assistant.js
 * -----------------------------------------------------------------------------
 * A local, deterministic engineering assistant that answers from the structured
 * knowledge base. It is not a language model: every sentence it produces is
 * assembled from engineeringData.js, so answers are relevant and never invented.
 *
 * The public surface is intentionally provider-shaped:
 *
 *   const assistant = createAssistant({ getContext });
 *   const reply = await assistant.ask("what happens if the turbopump fails?");
 *   reply = { text, sources, followups, action }
 *
 * To integrate an external LLM later, implement the same `ask()` signature and
 * pass the same context. API keys belong on a server, never in this file.
 */

import {
  MODEL_LIBRARY,
  COMPONENTS,
  getComponentData,
  getModelDefinition,
  resolveRelationName
} from "./engineeringData.js";

/* ------------------------------------------------------------------------- */
/* TEXT UTILITIES                                                            */
/* ------------------------------------------------------------------------- */

const normalise = text =>
  String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleise = text =>
  text
    .split(" ")
    .map(word => (word.length > 3 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

/** Levenshtein distance, capped for performance. */
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      last = temp;
    }
  }
  return prev[b.length];
}

/* ------------------------------------------------------------------------- */
/* ENTITY RESOLUTION                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Build a search index of every component and model name/keyword.
 * Recomputed once; the data set is static.
 */
let INDEX = null;

function buildIndex() {
  if (INDEX) return INDEX;
  const entries = [];
  for (const model of MODEL_LIBRARY) {
    entries.push({
      kind: "model",
      modelId: model.id,
      id: model.id,
      name: model.name,
      aliases: [
        ...[model.name, model.short].map(text => ({ text: normalise(text), strong: true })),
        ...(model.keywords || []).map(text => ({ text: normalise(text), strong: false }))
      ]
    });
    for (const [partId, data] of Object.entries(COMPONENTS[model.id] || {})) {
      entries.push({
        kind: "component",
        modelId: model.id,
        id: partId,
        name: data.name,
        aliases: [
          ...[data.name, partId.replace(/-/g, " ")].map(text => ({ text: normalise(text), strong: true })),
          ...(data.keywords || []).map(text => ({ text: normalise(text), strong: false }))
        ]
      });
    }
  }
  INDEX = entries;
  return INDEX;
}

/**
 * Words too generic to identify a component on their own when they appear only
 * as a keyword. A component's own *name* is always allowed, however short.
 */
const GENERIC_KEYWORDS = new Set([
  "air", "core", "base", "head", "block", "port", "cover", "band", "tank",
  "shaft", "gear", "valve", "pump", "board", "power", "tower", "blade",
  "housing", "generator", "bearing", "structure", "control", "data", "metal",
  "alloy", "composite", "temperature", "pressure", "torque", "efficiency"
]);

const matchedModelIds = [];

/**
 * Find component/model mentions in a question.
 *
 * Scoring prefers a component's real name over a keyword, and prefers a
 * component in the model the user is currently inspecting when two candidates
 * are equally specific.
 */
function findEntities(text, context) {
  const q = ` ${normalise(text)} `;
  const index = buildIndex();
  const candidates = [];

  // Does the question name a model? If so, prefer that model's components.
  const namedModels = new Set();
  for (const entry of index) {
    if (entry.kind !== "model") continue;
    for (const alias of entry.aliases) {
      if (alias.text.length >= 3 && q.includes(` ${alias.text} `)) namedModels.add(entry.modelId);
    }
  }
  matchedModelIds.length = 0;
  matchedModelIds.push(...namedModels);

  for (const entry of index) {
    for (const alias of entry.aliases) {
      if (!alias.text) continue;
      // Short aliases must match a whole word; long ones may match inside a phrase.
      const needle = ` ${alias.text} `;
      if (!q.includes(needle) && !q.includes(`${needle.trim()}s `)) continue;

      if (!alias.strong) {
        if (alias.text.length < 4) continue;
        if (GENERIC_KEYWORDS.has(alias.text)) continue;
      }

      let score = alias.text.length + (alias.strong ? 6 : 0);
      if (context?.modelId && entry.modelId === context.modelId) score += 2;
      if (namedModels.has(entry.modelId)) score += 4;

      candidates.push({ ...entry, alias: alias.text, score });
      break;
    }
  }

  // Typo rescue: one edit away from a distinctive alias.
  if (candidates.length === 0) {
    const words = normalise(text).split(" ").filter(word => word.length >= 6);
    for (const entry of index) {
      for (const alias of entry.aliases) {
        if (alias.text.length < 6) continue;
        for (const word of words) {
          if (editDistance(word, alias.text) <= 1) {
            candidates.push({ ...entry, alias: alias.text, score: alias.text.length });
          }
        }
      }
    }
  }

  // Deduplicate by model + id, keeping the best score.
  const best = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.modelId}:${candidate.id}`;
    const existing = best.get(key);
    if (!existing || candidate.score > existing.score) best.set(key, candidate);
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------------- */
/* INTENT DETECTION                                                          */
/* ------------------------------------------------------------------------- */

const INTENTS = [
  { id: "compare", test: /\b(compare|versus|vs|difference between|different from)\b/ },
  { id: "failure", test: /\b(fail|fails|failure|breaks|broken|malfunction|goes wrong|stops working|dead)\b/ },
  { id: "connections", test: /\b(connect|connected|connection|interface|linked|attached|mated|depend|depends|wired)\b/ },
  { id: "simple", test: /\b(simple|simply|plain english|eli5|layman|beginner|like im|easy)\b/ },
  { id: "specs", test: /\b(spec|specs|specification|specifications|number|numbers|rating|rated|how fast|how hot|how big|how heavy|how much|pressure|torque|rpm|efficiency|temperature|voltage|power output)\b/ },
  { id: "materials", test: /\b(material|materials|made of|made from|alloy|metal|composite)\b/ },
  { id: "system", test: /\b(system|whole|overall|assembly|how does it all|work together|entire)\b/ },
  { id: "where", test: /\b(where|locate|located|position of|find)\b/ },
  { id: "list", test: /\b(list|parts|components|what can i inspect|show me all)\b/ },
  { id: "explain", test: /\b(explain|how does|how do|what does|what is|whats|tell me about|describe|work)\b/ }
];

function detectIntents(text) {
  const q = normalise(text);
  const found = INTENTS.filter(intent => intent.test.test(q)).map(intent => intent.id);
  return found.length ? found : ["explain"];
}

/* ------------------------------------------------------------------------- */
/* REPLY BUILDERS                                                            */
/* ------------------------------------------------------------------------- */

function formatSpecs(data, limit = 5) {
  return (data.specs || [])
    .slice(0, limit)
    .map(spec => `• ${spec.label}: **${spec.value}**`)
    .join("\n");
}

function relationLine(modelId, relation) {
  return `• **${resolveRelationName(modelId, relation.target)}** — ${relation.label}`;
}

function dependentsOf(modelId, partId) {
  const model = COMPONENTS[modelId] || {};
  const out = [];
  for (const [id, data] of Object.entries(model)) {
    if (id === partId) continue;
    for (const relation of data.relations || []) {
      if (relation.target === partId) {
        out.push({ id, name: data.name, label: relation.label });
      }
    }
  }
  return out;
}

function componentReply(modelId, partId, intents, modelName) {
  const data = getComponentData(modelId, partId);
  if (!data) return null;
  const wantsSimple = intents.includes("simple");
  const sections = [];
  const sources = [{ type: "component", label: `${data.name} (${partId})`, partId }];

  if (wantsSimple || intents.includes("explain")) {
    sections.push(
      `**${data.name}** · *${data.category}* — ${data.short}.`
    );
  }

  if (intents.includes("specs")) {
    sections.push(`### Specification\n${formatSpecs(data, 6)}`);
  }

  if (intents.includes("materials")) {
    sections.push(`### Materials\n${(data.materials || []).map(m => `• ${m}`).join("\n")}`);
  }

  if (intents.includes("failure")) {
    const dependents = dependentsOf(modelId, partId);
    let text =
      `### If the ${data.name.toLowerCase()} fails\n` +
      `**${data.name}** — ${data.failureMode}`;
    if (dependents.length) {
      text +=
        `\n\n### Knock-on effects\n` +
        `These components depend on it:\n` +
        dependents
          .slice(0, 4)
          .map(dep => `• **${dep.name}** — ${dep.label}`)
          .join("\n");
    }
    if (data.facts?.length) {
      text += `\n\n### Related engineering notes\n` +
        data.facts.slice(0, 2).map(fact => `• ${fact}`).join("\n");
    }
    sections.push(text);
  }

  if (intents.includes("connections")) {
    const relations = data.relations || [];
    sections.push(
      relations.length
        ? `### Connections\n${relations.map(r => relationLine(modelId, r)).join("\n")}`
        : "This component has no recorded interfaces in the model."
    );
  }

  if (intents.includes("where")) {
    sections.push(`### Where it sits\n${data.role}`);
  }

  // Default explanatory content when nothing more specific was asked.
  if (sections.length === 0 || (wantsSimple && sections.length === 1)) {
    sections.push(`### What it does\n${data.function}`);
    sections.push(`### How it works\n${data.principle}`);
    if (data.role) sections.push(`### Its role in the ${modelName}\n${data.role}`);
    if (data.relations?.length) {
      sections.push(
        `### Connected to\n${data.relations
          .slice(0, 4)
          .map(r => relationLine(modelId, r))
          .join("\n")}`
      );
    }
  }

  if (wantsSimple) {
    sections.push(`### In plain language\n${data.education}`);
  }

  const followups = [
    `What happens if the ${data.name.toLowerCase()} fails?`,
    `What is the ${data.name.toLowerCase()} connected to?`,
    `Explain the ${data.name.toLowerCase()} in simple language`
  ];

  return { text: sections.join("\n\n"), sources, followups };
}

function systemReply(modelId, focus = "system") {
  const model = getModelDefinition(modelId);
  if (!model) return null;
  const components = COMPONENTS[modelId] || {};
  const names = Object.keys(components);

  if (focus === "list") {
    const lines = names
      .map(id => `• **${components[id].name}** — ${components[id].short}`)
      .join("\n");
    return {
      text: `### ${model.name}\n${model.summary}\n\n### Inspectable components (${names.length})\n${lines}`,
      sources: [{ type: "model", label: model.name, modelId }],
      followups: [
        "How does this system work as a whole?",
        `What are the most critical components of the ${model.short}?`
      ]
    };
  }

  return {
    text:
      `### ${model.name}\n${model.summary}\n\n` +
      `### How the system works\n${model.systemOverview}\n\n` +
      `### Categories in this assembly\n${summariseCategories(modelId)}`,
    sources: [{ type: "model", label: model.name, modelId }],
    followups: [
      `How does the ${names.length ? components[names[0]].name.toLowerCase() : "first part"} work?`,
      `What are the most critical components of the ${model.short}?`,
      "Show me the components connected to the main power path"
    ]
  };
}

function summariseCategories(modelId) {
  const components = COMPONENTS[modelId] || {};
  const groups = new Map();
  for (const data of Object.values(components)) {
    const category = data.category || "Other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(data.name);
  }
  return [...groups.entries()]
    .map(([category, items]) => `• **${category}**: ${items.join(", ")}`)
    .join("\n");
}

function compareReply(a, b) {
  const first = getComponentData(a.modelId, a.id);
  const second = getComponentData(b.modelId, b.id);
  if (!first || !second) return null;

  const specLabels = new Set([
    ...(first.specs || []).map(s => s.label),
    ...(second.specs || []).map(s => s.label)
  ]);
  const rows = [...specLabels].slice(0, 6).map(label => {
    const av = first.specs.find(s => s.label === label)?.value || "—";
    const bv = second.specs.find(s => s.label === label)?.value || "—";
    return `• **${label}** — ${first.name}: ${av} · ${second.name}: ${bv}`;
  });

  const text =
    `### ${first.name} vs ${second.name}\n` +
    `**${first.name}**: ${first.short}\n${first.function}\n\n` +
    `**${second.name}**: ${second.short}\n${second.function}\n\n` +
    `### Specification comparison\n${rows.join("\n")}\n\n` +
    `### How they differ in the system\n` +
    `• ${first.name} — ${first.role}\n• ${second.name} — ${second.role}`;

  return {
    text,
    sources: [
      { type: "component", label: first.name, partId: a.id },
      { type: "component", label: second.name, partId: b.id }
    ],
    followups: [
      `Explain the ${first.name.toLowerCase()} in simple language`,
      `Explain the ${second.name.toLowerCase()} in simple language`
    ]
  };
}

function helpReply(context) {
  const model = context?.modelId ? getModelDefinition(context.modelId) : null;
  return {
    text:
      "### How I can help\n" +
      "I answer from HOLOCORE's structured engineering knowledge base, using the model and " +
      "component you are currently inspecting as context.\n\n" +
      "• *How does the turbopump work?* — function and working principle\n" +
      "• *What happens if the piston fails?* — failure behaviour and dependents\n" +
      "• *What is the nozzle connected to?* — interfaces\n" +
      "• *Compare the crankshaft and the camshaft* — side-by-side specs\n" +
      "• *Explain the gearbox in simple language* — plain-language explanation\n" +
      "• *How does this system work as a whole?* — assembly overview\n" +
      "• *Show me the spark plug* — selects that component in the 3D workspace\n\n" +
      (model ? `Context loaded: **${model.name}**.` : "Select a model to add context."),
    sources: [],
    followups: model
      ? [
          `How does the ${model.short} work as a whole?`,
          "What can I ask you?",
          "Show me the most important component"
        ]
      : ["What can I ask you?"]
  };
}

/* ------------------------------------------------------------------------- */
/* ASSISTANT                                                                 */
/* ------------------------------------------------------------------------- */

export function createAssistant({ getContext } = {}) {
  const getContextSafe = () => {
    try {
      return getContext?.() || {};
    } catch {
      return {};
    }
  };

  /**
   * Ask a question.
   * @param {string} question
   * @returns {Promise<{text:string, sources:Array, followups:Array, action:object|null}>}
   */
  async function ask(question) {
    const context = getContextSafe();
    const q = String(question || "").trim();
    if (!q) {
      return { text: "Ask me about the model or a component you are inspecting.", sources: [], followups: [], action: null };
    }

    const intents = detectIntents(q);
    const norm = normalise(q);
    const focusPart = context.partId;
    const modelId = context.modelId;
    const modelDef = modelId ? getModelDefinition(modelId) : null;
    const modelName = modelDef?.name || "assembly";

    // Small talk / meta
    if (/^(hi|hello|hey|yo|good (morning|evening))\b/.test(norm)) {
      return {
        text:
          `Hello. You are inspecting **${modelDef?.name || "the workspace"}**` +
          (focusPart ? `, focused on the **${getComponentData(modelId, focusPart)?.name || focusPart}**.` : ".") +
          " Ask about any component, its connections, or how the system works.",
        sources: [],
        followups: ["How does this system work as a whole?", "What can I ask you?"],
        action: null
      };
    }

    if (/\b(help|what can you do|how do i use|capabilities|commands)\b/.test(norm)) {
      return { ...helpReply(context), action: null };
    }

    // "show me / select / highlight <component>" — acts on the 3D scene.
    const isSelectVerb = /\b(show|select|highlight|point to|find|focus on|take me to)\b/.test(norm);
    const entities = findEntities(q, context);

    if (isSelectVerb) {
      const target = entities.find(entity => entity.kind === "component");
      if (target) {
        const data = getComponentData(target.modelId, target.id);
        return {
          text:
            `Selecting **${data.name}** in the ${getModelDefinition(target.modelId).name}.\n\n` +
            `${data.short}.\n\n${data.function}`,
          sources: [{ type: "component", label: data.name, partId: target.id }],
          followups: [
            `What happens if the ${data.name.toLowerCase()} fails?`,
            `Explain the ${data.name.toLowerCase()} in simple language`
          ],
          action:
            target.modelId !== modelId
              ? { type: "select", modelId: target.modelId, partId: target.id }
              : { type: "select", partId: target.id }
        };
      }
      if (entities.some(entity => entity.kind === "model")) {
        const target = entities.find(entity => entity.kind === "model");
        const model = getModelDefinition(target.modelId);
        return {
          text: `Loading **${model.name}**.\n\n${model.summary}\n\n${model.systemOverview}`,
          sources: [{ type: "model", label: model.name, modelId: target.modelId }],
          followups: [`List the components of the ${model.short}`, "How does this system work as a whole?"],
          action: { type: "load-model", modelId: target.modelId }
        };
      }
    }

    // Compare two components.
    if (intents.includes("compare")) {
      const components = entities.filter(entity => entity.kind === "component");
      if (components.length >= 2) {
        const reply = compareReply(components[0], components[1]);
        if (reply) return { ...reply, action: null };
      }
      // Compare two models when the user named models instead.
      const models = entities.filter(entity => entity.kind === "model");
      if (models.length >= 2) {
        const a = getModelDefinition(models[0].modelId);
        const b = getModelDefinition(models[1].modelId);
        return {
          text:
            `### ${a.name} vs ${b.name}\n` +
            `**${a.name}** (${a.category}) — ${a.blurb}\n\n${a.summary}\n\n` +
            `**${b.name}** (${b.category}) — ${b.blurb}\n\n${b.summary}`,
          sources: [
            { type: "model", label: a.name, modelId: a.id },
            { type: "model", label: b.name, modelId: b.id }
          ],
          followups: [`Explain the ${a.short} as a system`, `Explain the ${b.short} as a system`],
          action: null
        };
      }
      if (context.partId && components.length === 1) {
        const reply = compareReply(
          { modelId, id: context.partId },
          { modelId: components[0].modelId, id: components[0].id }
        );
        if (reply) return { ...reply, action: null };
      }
      return {
        text:
          "Name two components to compare, for example: *compare the turbopump and the thrust " +
          "chamber*, or *compare the piston and the connecting rod*.",
        sources: [],
        followups: focusPart
          ? [
              `Compare the ${getComponentData(modelId, focusPart)?.name.toLowerCase()} and the crankshaft`,
              "What can I ask you?"
            ]
          : ["What can I ask you?"],
        action: null
      };
    }

    // Named component (explicit or implied current selection).
    const namedComponent = entities.find(entity => entity.kind === "component");
    if (namedComponent) {
      const reply = componentReply(
        namedComponent.modelId,
        namedComponent.id,
        intents,
        getModelDefinition(namedComponent.modelId)?.name || "assembly"
      );
      if (reply) {
        return {
          ...reply,
          action:
            namedComponent.modelId === modelId
              ? { type: "select", partId: namedComponent.id }
              : { type: "select", modelId: namedComponent.modelId, partId: namedComponent.id }
        };
      }
    }

    // "what are the most critical components" style question.
    if (/\b(most important|critical|main|key) component/.test(norm)) {
      const parts = Object.entries(COMPONENTS[modelId] || {});
      const ranked = parts
        .map(([id, data]) => ({
          id,
          data,
          weight: (data.relations?.length || 0) * 2 + (data.specs?.length || 0)
        }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3);
      return {
        text:
          `### Most interconnected components of the ${modelName}\n` +
          ranked
            .map(
              (entry, i) =>
                `${i + 1}. **${entry.data.name}** — ${entry.data.short}. ${entry.data.role}`
            )
            .join("\n\n") +
          "\n\nInterconnection count is a practical proxy for criticality: a part with many " +
          "interfaces has many ways to propagate a fault.",
        sources: ranked.map(entry => ({ type: "component", label: entry.data.name, partId: entry.id })),
        followups: ranked.length ? [`What happens if the ${ranked[0].data.name.toLowerCase()} fails?`] : [],
        action: ranked.length ? { type: "select", partId: ranked[0].id } : null
      };
    }

    // Assembly-level questions.
    if (intents.includes("system") || intents.includes("list")) {
      const reply = systemReply(modelId, intents.includes("list") ? "list" : "system");
      if (reply) return { ...reply, action: null };
    }

    // Current selection context.
    if (focusPart) {
      const reply = componentReply(modelId, focusPart, intents, modelName);
      if (reply) {
        return {
          ...reply,
          text:
            `*(Using your current selection: ${reply.sources[0]?.label || focusPart})*\n\n` +
            reply.text,
          action: null
        };
      }
    }

    // Last resort: explain the model.
    const reply = systemReply(modelId);
    if (reply) {
      return {
        ...reply,
        text:
          "I could not match a specific component in that question, so here is the " +
          `context of the **${modelName}**:\n\n${reply.text}`,
        action: null
      };
    }

    return {
      text:
        "Select a model first, then ask about any component. For example: *how does the " +
        "turbopump work?*",
      sources: [],
      followups: ["What can I ask you?"],
      action: null
    };
  }

  /** Suggested openers for the current context. */
  function suggestions() {
    const context = getContextSafe();
    const modelId = context.modelId;
    const modelDef = modelId ? getModelDefinition(modelId) : null;
    if (!modelDef) return ["What can I ask you?"];

    const part = context.partId ? getComponentData(modelId, context.partId) : null;
    if (part) {
      return [
        `How does the ${part.name.toLowerCase()} work?`,
        `What happens if the ${part.name.toLowerCase()} fails?`,
        `What is the ${part.name.toLowerCase()} connected to?`,
        `Explain the ${part.name.toLowerCase()} simply`
      ];
    }

    const names = Object.keys(COMPONENTS[modelId] || {});
    const first = names[0] ? COMPONENTS[modelId][names[0]] : null;
    return [
      `How does the ${modelDef.short} work as a whole?`,
      first ? `How does the ${first.name.toLowerCase()} work?` : "What can I ask you?",
      `List the components of the ${modelDef.short}`,
      `What are the most critical components of the ${modelDef.short}?`
    ];
  }

  return { ask, suggestions, detectIntents, findEntities };
}

export { INTENTS, buildIndex, editDistance };
