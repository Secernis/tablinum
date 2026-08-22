"use strict";

/**
 * PreToolUse rule — barrel files re-export, they do not implement.
 *
 * `index.ts`, `index.tsx` and `mod.rs` exist to give a directory one public
 * name. The moment logic lands in one, three things break at once: the module
 * graph gains a cycle risk (every consumer of ANY sibling now imports the
 * barrel's own code), tree-shaking stops working because the barrel has side
 * effects, and the file becomes the place where things go when nobody decided
 * where they belong.
 *
 * The rule is structural, not stylistic: it looks for a definition (a function,
 * a class, a component, a `useState`) in ADDED lines. Re-exports, type-only
 * declarations and constants that are literally part of the public surface stay
 * free — a barrel may name what it exports.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, addedLines, textPair } = require("../../lib/edit-payload.cjs");

/** The barrel filenames this repo uses. */
const BARREL_RE = /(?:^|\/)(?:index\.tsx?|mod\.rs)$/;

/** Definitions that make a barrel more than a barrel. */
const LOGIC_SIGNALS = [
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+\w/, what: "a function definition" },
  { re: /^\s*(?:export\s+)?class\s+\w/, what: "a class definition" },
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+\w/, what: "a Rust function definition" },
  { re: /^\s*(?:pub\s+)?struct\s+\w/, what: "a Rust struct definition" },
  { re: /^\s*(?:pub\s+)?impl\b/, what: "a Rust impl block" },
  { re: /\buse(?:State|Effect|Memo|Callback|Ref|Reducer|Context)\s*\(/, what: "a React hook call" },
  { re: /^\s*(?:export\s+)?const\s+\w+\s*[:=].*=>\s*(?:\{|\()/, what: "an arrow function definition" },
  { re: /^\s*(?:export\s+default\s+)?function\s*\(/, what: "an anonymous function definition" },
];

/**
 * Find the first logic signal in a set of added lines.
 *
 * @param {string[]} lines - Lines the edit introduces.
 * @returns {{line: string, what: string}|null} The finding, or null.
 */
function findLogic(lines) {
  for (const line of lines) {
    // A re-export is the barrel's whole job, whatever it looks like.
    if (/^\s*export\s+(?:\*|\{[^}]*\})\s+from\s/.test(line)) continue;
    if (/^\s*(?:pub\s+)?(?:use|mod)\s/.test(line)) continue;
    if (/^\s*export\s+type\s/.test(line)) continue;
    const hit = LOGIC_SIGNALS.find((s) => s.re.test(line));
    if (hit) return { line: line.trim().slice(0, 140), what: hit.what };
  }
  return null;
}

/**
 * Deny an edit that puts implementation into a barrel file.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on new logic.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!BARREL_RE.test(rel) || rel.startsWith("..")) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findLogic(addedLines(newText, oldText));
  if (!hit) return PASS;

  return deny(
    "tab-guard",
    "Logic in a barrel file",
    `'${rel}' is a barrel — it re-exports a directory's public surface. This edit would add ` +
      `${hit.what}:\n  ${hit.line}\n\n` +
      "Implementation in a barrel creates a cycle risk (every consumer of any sibling now " +
      "imports the barrel's own code), defeats tree-shaking, and turns the file into the " +
      "default home for anything nobody placed.\n\n" +
      "Put the code in a named sibling module and re-export it from here.",
  );
}

module.exports = { findLogic, id: "barrel-purity", run };
