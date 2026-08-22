"use strict";

/**
 * PreToolUse rule — code comments are English, enforced at write time.
 *
 * The working language of this project is German and it bleeds into the code.
 * That is the root cause, and the moment of writing is the right place to
 * intervene: a German comment is fine for exactly as long as the only reader is
 * the person who wrote it, and this repository is public.
 *
 * The chat stays German. Identifiers, comments, commit subjects and CHANGELOG
 * entries are English. User-facing STRINGS are a product decision and out of
 * scope here.
 *
 * Detection is single-sourced in `scripts/lib/comment-lang.cjs` (a two-distinct-
 * stopword quorum), shared with the verify sweep so the tiers cannot drift.
 *
 * Fragment caveat: the hook sees edit FRAGMENTS, not whole files, so block-
 * comment state can be off when a fragment starts mid-block. This is the
 * best-effort first line of defence; the whole-file sweep is the accurate
 * backstop. Only NEWLY introduced German blocks — moving an existing comment
 * stays free.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");
const {
  findGermanComment,
  isScannedFile,
  isSkippedPath,
} = require("../../../../scripts/lib/comment-lang.cjs");

/**
 * Deny edits that introduce a German code comment.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a new German comment.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;

  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!isScannedFile(rel) || isSkippedPath(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findGermanComment(newText, rel);
  if (!hit) return PASS;
  // Existing German in the replaced text means this edit is moving it, not
  // writing it — that is the sweep's job to pay down, not this gate's.
  if (findGermanComment(oldText, rel)) return PASS;

  return deny(
    "tab-guard",
    "German code comment",
    `'${rel}' would introduce a German comment (matched: ${hit.words.join(", ")}):\n` +
      `  ${hit.comment}\n\n` +
      "Comments, identifiers and commit subjects are English — this repository is public, and " +
      "a German comment inside otherwise portable code is unreadable to everyone who is not " +
      "you. The chat language stays German; only the code is switched.\n\n" +
      "Rewrite the comment in English, keeping the reasoning rather than translating word by " +
      "word — the reason WHY is what the comment is for.",
  );
}

module.exports = { id: "english-comments", run };
