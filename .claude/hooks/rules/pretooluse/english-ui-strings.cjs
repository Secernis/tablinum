"use strict";

/**
 * PreToolUse rule — user-facing strings in the frontend are English.
 *
 * A product decision, made on 2026-09-02: the interface speaks English. The
 * working language of the project is German, and it reaches the interface the
 * same way it reaches comments — one label at a time, each of them fine on its
 * own, until the picker greets a user in a language the product never chose.
 *
 * Detection is single-sourced in `scripts/lib/ui-lang.cjs` (JSX text and string
 * literals, the two-distinct-stopword quorum of the comment detector), shared
 * with the `english-ui-strings` verify sensor so the tiers cannot drift.
 *
 * Same fragment caveat and same courtesy as `english-comments`: the hook judges
 * what an edit INTRODUCES, so moving an existing German string stays free and
 * the whole-file sweep pays it down.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");
const { findGermanString, isUiFile } = require("../../../../scripts/lib/ui-lang.cjs");

/**
 * Deny edits that introduce a German user-facing string.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a new German string.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;

  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!isUiFile(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findGermanString(newText, rel);
  if (!hit) return PASS;
  if (findGermanString(oldText, rel)) return PASS;

  return deny(
    "tab-guard",
    "German user-facing string",
    `'${rel}' would introduce a German string (matched: ${hit.words.join(", ")}):\n` +
      `  ${hit.text}\n\n` +
      "The interface language is English — a product decision, recorded in " +
      ".claude/rules/code-quality/comments-and-language.md. The chat stays German; " +
      "what the user sees in the app does not.\n\n" +
      "Rewrite the text in English. If it is a fixture, it belongs in a `.test.` or " +
      "`.stories.` file, which the rule exempts.",
  );
}

module.exports = { id: "english-ui-strings", run };
