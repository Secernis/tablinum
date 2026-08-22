"use strict";

/**
 * PreToolUse rule — no TODO without a valid tag, enforced at write time.
 *
 * The write-time tier of the TODO grammar: an edit that NEWLY introduces a
 * marker outside the grammar is blocked here rather than hours later in the
 * verify sweep, at the one moment the author still knows what the marker meant.
 *
 * The grammar, tag policies, date rules and scan scope are SINGLE-SOURCED in
 * `scripts/lib/todo-core.cjs` — this rule and the sweep consume the same module,
 * so the two tiers cannot drift apart. A hand-kept mirror always does.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");
const {
  TAGS,
  findDateWindowViolation,
  findNonUppercaseMarker,
  findUntaggedMarker,
  isScannedFile,
  isSkippedPath,
} = require("../../../../scripts/lib/todo-core.cjs");

/** The grammar, rendered for the block message. */
const GRAMMAR_HELP =
  "Format: TODO(<tag>): text   or   TODO(<tag>, YYYY-MM-DD): text\n" +
  `Tags: ${Object.entries(TAGS)
    .map(([t, p]) => (p.dateRequired ? `${t} (date required)` : t))
    .join(", ")}`;

/**
 * Deny edits that introduce a marker outside the grammar.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a violation.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;

  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!isScannedFile(rel) || isSkippedPath(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);

  const untagged = findUntaggedMarker(newText, rel);
  if (untagged && !findUntaggedMarker(oldText, rel)) {
    return deny(
      "tab-guard",
      "TODO without a valid tag",
      `'${rel}' would introduce a marker outside the grammar:\n  ${untagged}\n\n` +
        `${GRAMMAR_HELP}\n\n` +
        "An untagged TODO is a note to nobody: no kind, no owner, no expiry. It survives every " +
        "cleanup by default, which is why the file of them only ever grows.",
    );
  }

  const nonUpper = findNonUppercaseMarker(newText, rel);
  if (nonUpper && !findNonUppercaseMarker(oldText, rel)) {
    return deny(
      "tab-guard",
      "Debt marker in the wrong spelling",
      `'${rel}' would introduce a lowercase TODO or a sibling keyword (FIXME/XXX/HACK/TBD):\n` +
        `  ${nonUpper}\n\n${GRAMMAR_HELP}\n\n` +
        "One spelling, one grammar — otherwise `todo:` becomes the escape hatch that empties " +
        "the rule, and the sweep can no longer count the debt it is supposed to track.",
    );
  }

  const now = new Date();
  const dateProblem = findDateWindowViolation(newText, now);
  if (dateProblem && !findDateWindowViolation(oldText, now)) {
    return deny(
      "tab-guard",
      "TODO date outside its window",
      `'${rel}': ${dateProblem}.\n\n` +
        "A date-bearing tag exists so the decision has a deadline instead of an intention. " +
        "Pick a date you would actually defend, or use a tag that does not require one.",
    );
  }

  return PASS;
}

module.exports = { id: "todo-tags", run };
