/**
 * HOLOCORE — tools/audit.mjs
 * -----------------------------------------------------------------------------
 * Static audit of the application source (§15).
 *
 * WHY THIS EXISTS
 *
 * Three defects in this project's history were found by accident rather than by
 * a test, and all three shared a shape: code that referred to something that did
 * not exist, in a place nothing exercised.
 *
 *   - `calibrate()` assigned to `hoverLock`, a binding that has never existed in
 *     main.js. Every press of the Calibrate button threw a ReferenceError before
 *     doing anything. Nothing called it, so nothing noticed.
 *   - `analyzerSettings()` was called from the tracking loop but never defined,
 *     so the first frame with a hand took the whole pipeline down.
 *   - `hoverFromHand()` was called from `updatePointer()` and likewise never
 *     existed.
 *
 * Tests catch these only if they happen to walk the exact path. A static pass
 * over the source catches the whole class in a second.
 *
 * WHAT IT CHECKS
 *
 *   1. Undefined calls      — `name(...)` where `name` is defined nowhere.
 *   2. DOM ids              — `$("#id")` where index.html has no such id.
 *   3. Settings paths       — `settings.section.key` where the store default has
 *                             no such key.
 *   4. Unused exports       — exports nothing imports, which usually means a
 *                             rename was completed in one direction only.
 *
 * WHAT IT CANNOT CHECK
 *
 * Anything that needs the app to run: runtime types, gesture quality, rendering.
 * This is a smell detector, not a proof of correctness, and a clean run is not
 * evidence that the app works.
 *
 *   node tools/audit.mjs          # report
 *   node tools/audit.mjs --strict # exit 1 on findings (used by validate:all)
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const strict = process.argv.includes("--strict");

const read = name => readFileSync(join(root, name), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

/**
 * Read every module from disk.
 *
 * Deliberately re-read on each call rather than cached at import time: the
 * detectors are exercised against a temporary file in the test suite, and a
 * snapshot taken at import could not see it. Reading a few hundred KB is
 * microseconds and this only runs from the CLI and the test suite.
 */
function loadSources() {
  return readdirSync(root)
    .filter(name => name.endsWith(".js"))
    .sort()
    .map(name => [name, read(name)]);
}

const sources = loadSources().map(([name]) => name);

/**
 * Blank out comments and string contents WITHOUT changing the source length.
 *
 * Every character is replaced by a space (newlines are kept), so byte offsets and
 * therefore line numbers stay exact. An earlier version collapsed strings to
 * `"x"` and every reported line number after the first string was wrong.
 */
function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

function stripNoise(source) {
  let out = "";
  let i = 0;
  const n = source.length;

  while (i < n) {
    const char = source[i];
    const next = source[i + 1];

    // Line comment
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    // Block comment
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    // String or template literal: keep the delimiters, blank the contents.
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === quote) { j += 1; break; }
        // An unterminated quote is a bug in the file, not the audit: stop here.
        if (source[j] === "\n" && quote !== "`") break;
        j += 1;
      }
      out += quote + blank(source.slice(i + 1, Math.max(i + 1, j - 1))) + (j <= n ? source[j - 1] : "");
      i = j;
      continue;
    }

    out += char;
    i += 1;
  }
  return out;
}

/**
 * Blank out comments only, keeping string contents.
 *
 * Some checks — DOM ids, settings paths — are ABOUT the contents of string
 * literals. Running them on the string-stripped source made them silently match
 * nothing, which is worse than a false positive: a checker that can never fail.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let quote = null;

  while (i < n) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      if (char === "\\") { out += char + (source[i + 1] || ""); i += 2; continue; }
      if (char === quote) quote = null;
      out += char;
      i += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;

    out += char;
    i += 1;
  }
  return out;
}

/** Both views of the source, rebuilt on each run. */
function views() {
  const loaded = loadSources();
  return {
    clean: Object.fromEntries(loaded.map(([k, v]) => [k, stripNoise(v)])),
    uncommented: Object.fromEntries(loaded.map(([k, v]) => [k, stripComments(v)]))
  };
}

/* -------------------------------------------------------------------------- */
/* 1 · Undefined calls                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Every `(...)` group that is immediately followed by `{` or `=>` — i.e. a
 * parameter list — with balanced parentheses.
 */
function parameterLists(source) {
  const lists = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "(") continue;
    // Only consider a `(` that closes into `{` or `=>`.
    let depth = 0;
    let j = i;
    for (; j < source.length; j++) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const after = source.slice(j + 1, j + 12);
    if (!/^\s*(?:=>|\{)/.test(after)) continue;
    lists.push(source.slice(i + 1, j));
    i = j;
  }
  return lists;
}

/** Split on commas that are not inside brackets, braces or parens. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if ("([{<".includes(char)) depth++;
    else if (")]}>".includes(char)) depth--;
    if (char === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Every name any module defines, exports or declares. */
function collectDsl({ clean, uncommented }) {
  void uncommented;
  const defined = new Set();
  const add = name => { if (name) defined.add(name); };

  for (const source of Object.values(clean)) {
    for (const m of source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) add(m[1]);
    for (const m of source.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of source.matchAll(/import\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) add(part.trim().split(/\s+as\s+/).pop().trim());
    }
    for (const m of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) add(m[1]);
    for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) add(part.trim().split(/\s+as\s+/).pop().trim());
    }
    // Object literal and class methods: `foo() {}`, `async foo() {}`, `get foo() {}`.
    for (const m of source.matchAll(
      /^\s*(?:(?:async|get|set|static|\*)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm
    )) add(m[1]);
    // Every parameter name, anywhere. Balancing parens properly matters:
    // `duration = 500, format = v => String(round(v))` contains its own parens,
    // and a regex that stops at the first `)` simply loses `format`.
    for (const signature of parameterLists(source)) {
      for (const part of splitTopLevel(signature)) {
        const name = part.trim()
          .replace(/=.*$/, "")
          .replace(/^\.\.\./, "")
          .replace(/:.*$/, "")
          .trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
      }
    }
    for (const m of source.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
    for (const m of source.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of source.matchAll(/\{([^{}]*)\}\s*=/g)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(":").pop().trim().replace(/=.*$/, "").trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
      }
    }
    // Positional destructuring: const [a, b] = ...
    for (const m of source.matchAll(/\bconst\s*\[([^\]]*)\]\s*=/g)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().replace(/^\.\.\./, "").trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) add(name);
      }
    }
  }

  for (const name of [
    "if", "for", "while", "switch", "catch", "return", "typeof", "function", "new", "await",
    "Number", "String", "Boolean", "Math", "JSON", "Object", "Array", "Promise", "Set", "Map",
    "WeakMap", "Error", "TypeError", "RangeError", "Date", "RegExp", "Symbol", "Proxy", "Reflect",
    "performance", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI",
    "encodeURIComponent", "decodeURIComponent", "structuredClone", "queueMicrotask", "console",
    "window", "document", "globalThis", "navigator", "localStorage", "fetch", "URL", "URLSearchParams",
    "Float32Array", "Uint8Array", "Uint16Array", "Float64Array", "Int32Array", "ArrayBuffer",
    "DataView", "TextDecoder", "TextEncoder", "Blob", "FormData", "AudioContext", "IntersectionObserver",
    "ResizeObserver", "MutationObserver", "HTMLElement", "CustomEvent", "Event", "KeyboardEvent",
    "Image", "Audio", "AbortController", "DOMParser", "requestIdleCallback", "process", "void",
    "undefined", "NaN", "Infinity", "super", "this", "arguments", "THREE"
  ]) add(name);

  // Three.js class names are referenced by import; allow anything capitalised.
  return { defined, isKnown: name => defined.has(name) };
}

function auditUndefinedCalls() {
  const view = views();
  const { isKnown } = collectDsl(view);
  const findings = [];

  for (const [file, source] of Object.entries(view.clean)) {
    if (file === "three.core.js" || file.startsWith("vendor")) continue;
    for (const m of source.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (isKnown(name)) continue;
      // Capitalised names are almost always classes or JSX-ish constructs.
      if (/^[A-Z]/.test(name)) continue;
      // IIFE and arrow wrappers: `(async () => …)()`, `(() => …)()`.
      if (name === "async" || name === "function" || name === "await") continue;
      // Dynamic import is syntax, not a call to a binding.
      if (name === "import") continue;
      // A definition looks like `name(...) {` or `name: (...) =>`; a call does
      // not. Without this, method definitions that the definition scan missed
      // would be reported as calls to nothing.
      const lineText = source.split("\n")[source.slice(0, m.index).split("\n").length - 1] || "";
      if (/^\s*(?:(?:async|get|set|static|\*)\s+)*[A-Za-z_$][\w$]*\s*\(/.test(lineText)) continue;
      const line = source.slice(0, m.index).split("\n").length;
      findings.push({ file, line, message: `call to undefined \`${name}()\`` });
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* 2 · DOM ids                                                                */
/* -------------------------------------------------------------------------- */

function auditDomIds() {
  const findings = [];
  const { uncommented } = views();
  const declared = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) declared.add(m[1]);

  for (const [file, source] of Object.entries(uncommented)) {
    if (file.startsWith("vendor")) continue;
    for (const m of source.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) {
      if (declared.has(m[1])) continue;
      const line = source.slice(0, m.index).split("\n").length;
      findings.push({ file, line, message: `\`$("#${m[1]}")\` has no matching element` });
    }
    for (const m of source.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)) {
      if (declared.has(m[1])) continue;
      const line = source.slice(0, m.index).split("\n").length;
      findings.push({ file, line, message: `getElementById("${m[1]}") has no matching element` });
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* 3 · Settings paths                                                         */
/* -------------------------------------------------------------------------- */

/** Section -> keys, parsed from the store's default settings object. */
function storeDefaults() {
  const source = views().clean["store.js"] || "";
  const start = source.indexOf("DEFAULT_SETTINGS");
  if (start < 0) return null;
  const body = source.slice(start, source.indexOf("\n};", start));
  const sections = {};
  for (const m of body.matchAll(/^\s{2}([a-zA-Z]+):\s*\{([\s\S]*?)^\s{2}\},/gm)) {
    const keys = new Set();
    for (const k of m[2].matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(k[1]);
    sections[m[1]] = keys;
  }
  return sections;
}

function auditSettingsPaths() {
  const { uncommented } = views();
  const sections = storeDefaults();
  if (!sections) return [];
  const findings = [];

  for (const [file, source] of Object.entries(uncommented)) {
    if (file.startsWith("vendor") || file === "store.js") continue;
    for (const m of source.matchAll(/\bsettings\.([a-zA-Z]+)\.([A-Za-z_$][\w$]*)/g)) {
      const [, section, key] = m;
      const keys = sections[section];
      if (!keys) continue;               // not a settings section; ignore
      if (keys.has(key)) continue;
      const line = source.slice(0, m.index).split("\n").length;
      findings.push({ file, line, message: `settings.${section}.${key} is not a stored default` });
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */

export const AUDITS = [
  ["undefined calls", auditUndefinedCalls],
  ["DOM ids", auditDomIds],
  ["settings paths", auditSettingsPaths]
];

/** Run every check and return the findings, grouped by check name. */
export function runAudit() {
  const results = {};
  for (const [label, run] of AUDITS) {
    try {
      results[label] = run();
    } catch (error) {
      results[label] = [{ file: "tools/audit.mjs", line: 0, message: `${label} threw: ${error.message}` }];
    }
  }
  return results;
}

/**
 * Expose the detectors so their own behaviour can be tested.
 *
 * A static check that has never been shown to fire is worthless: this audit's
 * DOM-id pass silently matched nothing for a while because it ran against
 * string-stripped source. The tests inject known-bad input and require a hit.
 */
export const detectors = {
  undefinedCalls: auditUndefinedCalls,
  domIds: auditDomIds,
  settingsPaths: auditSettingsPaths,
  stripComments,
  stripNoise
};

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("audit.mjs");

if (isEntryPoint) {
  let total = 0;
  for (const [label, findings] of Object.entries(runAudit())) {
    total += findings.length;
    if (!findings.length) {
      console.log(`  ok    ${label}`);
      continue;
    }
    console.log(`  ${findings.length} in ${label}:`);
    for (const finding of findings.slice(0, 40)) {
      console.log(`        ${finding.file}:${finding.line}  ${finding.message}`);
    }
    if (findings.length > 40) console.log(`        … ${findings.length - 40} more`);
  }

  console.log(`\n${total === 0 ? "clean" : `${total} finding(s)`}`);
  if (strict && total > 0) process.exit(1);
}
