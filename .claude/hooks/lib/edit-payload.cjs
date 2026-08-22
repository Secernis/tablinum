"use strict";

/**
 * Reading an edit payload — the shape every content gate needs.
 *
 * Three tools write files (`Edit`, `MultiEdit`, `Write`) and they carry their
 * content in three different shapes: `new_string`/`old_string`, an `edits[]`
 * array of those pairs, and `content`. A gate that only understands one of them
 * has a hole exactly the size of the other two, and that hole is invisible —
 * the rule returns "clean" rather than "cannot judge".
 *
 * Everything here is pure: no I/O, no payload mutation, so a rule's own suite
 * can drive it with a literal object.
 */

const path = require("node:path");

/** The tools whose payload carries file content a rule can inspect. */
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

/**
 * Whether this payload is a file-writing tool call.
 *
 * @param {object} data - Hook payload.
 * @returns {boolean} True for Edit/MultiEdit/Write.
 */
function isEdit(data) {
  return EDIT_TOOLS.has(data && data.tool_name);
}

/**
 * Extract the (new, old) text pair from an edit payload, concatenating the
 * fragments of a MultiEdit so one call is judged as one change.
 *
 * @param {object} input - The `tool_input` payload.
 * @returns {{newText: string, oldText: string}} The replacement and replaced text.
 */
function textPair(input) {
  const ti = input || {};
  if (Array.isArray(ti.edits)) {
    return {
      newText: ti.edits.map((e) => (e && e.new_string) || "").join("\n"),
      oldText: ti.edits.map((e) => (e && e.old_string) || "").join("\n"),
    };
  }
  return {
    newText: ti.new_string ?? ti.content ?? "",
    oldText: ti.old_string ?? "",
  };
}

/**
 * Repo-relative POSIX path of an edit target.
 *
 * @param {object} data - Hook payload.
 * @param {string} cwd - Absolute repo root.
 * @returns {string} Relative path with forward slashes, or `""` when absent.
 */
function relTarget(data, cwd) {
  const p = data && data.tool_input && data.tool_input.file_path;
  if (!p) return "";
  return path.relative(cwd, p).replace(/\\/g, "/");
}

/**
 * The lines a fragment ADDS, i.e. present in the new text and not in the old.
 *
 * Rules judge introductions, not existing state: a gate that fires on content
 * the edit merely moved past holds an unrelated change hostage to legacy debt,
 * and the agent's only way out is to fix something it was not asked to touch.
 *
 * @param {string} newText - Replacement text.
 * @param {string} oldText - Replaced text.
 * @returns {string[]} Lines that the edit introduces.
 */
function addedLines(newText, oldText) {
  const before = new Set(
    String(oldText || "")
      .split("\n")
      .map((l) => l.trim()),
  );
  return String(newText || "")
    .split("\n")
    .filter((l) => l.trim() && !before.has(l.trim()));
}

module.exports = { EDIT_TOOLS, addedLines, isEdit, relTarget, textPair };
