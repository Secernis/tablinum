"use strict";

/**
 * PreToolUse rule — a suppression has to say why.
 *
 * `@ts-ignore`, `eslint-disable-next-line` and `#[allow(...)]` are legitimate
 * tools. What makes them expensive is that they are permanent and anonymous: the
 * check stops running at that line forever, and six months later nobody can tell
 * whether the suppression was a considered exception or the fastest way past a
 * red build.
 *
 * The rule does not forbid suppressions. It requires a reason ON THE SAME LINE
 * or the line above, which costs the author ten seconds and gives every later
 * reader the one fact they need. That asymmetry is the whole design.
 *
 * `@ts-ignore` is treated separately: it suppresses EVERY error on the following
 * line, including ones introduced later that have nothing to do with the
 * original. `@ts-expect-error` fails when the error goes away, so it cannot rot
 * silently — it is the correct spelling and the message says so.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");

/** Where the rule applies. */
const SCOPE_RE = /^(?:src|src-tauri\/src|scripts)\/.*\.(tsx|ts|rs|mjs|cjs|js)$/;

/** Suppression forms, as `[pattern, name]`. */
const SUPPRESSIONS = [
  [/@ts-ignore\b/, "@ts-ignore"],
  [/@ts-nocheck\b/, "@ts-nocheck"],
  [/@ts-expect-error\b/, "@ts-expect-error"],
  [/eslint-disable(?:-next-line|-line)?\b/, "eslint-disable"],
  [/#\[allow\(/, "#[allow(...)]"],
  [/#!\[allow\(/, "#![allow(...)]"],
];

/** What counts as a reason: prose after the directive, at least a few words. */
const REASON_RE = /(?:—|--|:|\breason\b|\bbecause\b|\bwhy\b)\s*\S+(?:\s+\S+){2,}/i;

/**
 * Whether a line (or the line above it) carries a stated reason.
 *
 * @param {string} line - The suppression line.
 * @param {string} previous - The line above it.
 * @returns {boolean} True when a reason is present.
 */
function hasReason(line, previous) {
  if (REASON_RE.test(line)) return true;
  // A comment directly above counts: the common shape is a sentence of context
  // followed by the bare directive.
  const prev = String(previous || "").trim();
  return /^(?:\/\/|\/\*|\*|#)/.test(prev) && prev.split(/\s+/).length >= 5;
}

/**
 * Find an unjustified suppression among the lines an edit introduces.
 *
 * The whole new text is scanned rather than a diffed subset, because a
 * suppression's justification sits on the LINE ABOVE and a line-set diff loses
 * that adjacency. Existing suppressions are filtered by comparing against the
 * replaced text instead.
 *
 * @param {string} newText - Replacement text.
 * @param {string} oldText - Replaced text.
 * @returns {{line: string, name: string}|null} The finding, or null.
 */
function findUnjustified(newText, oldText) {
  const before = new Set(
    String(oldText || "")
      .split("\n")
      .map((l) => l.trim()),
  );
  const lines = String(newText || "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (before.has(line.trim())) continue;
    const hit = SUPPRESSIONS.find(([re]) => re.test(line));
    if (!hit) continue;
    if (hasReason(line, lines[i - 1])) continue;
    return { line: line.trim().slice(0, 140), name: hit[1] };
  }
  return null;
}

/**
 * Deny an edit that introduces a suppression without a stated reason.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when justified, BLOCK otherwise.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!SCOPE_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findUnjustified(newText, oldText);
  if (!hit) return PASS;

  const tsIgnoreNote =
    hit.name === "@ts-ignore"
      ? "\n\nAlso: use `@ts-expect-error` rather than `@ts-ignore`. It fails once the error " +
        "disappears, so it cannot quietly outlive its reason — `@ts-ignore` suppresses every " +
        "error on the next line forever, including ones introduced later."
      : "";

  return deny(
    "tab-guard",
    "Suppression without a reason",
    `'${rel}' would add \`${hit.name}\` with no stated reason:\n  ${hit.line}\n\n` +
      "Suppressions are allowed — anonymous ones are not. Write the reason on the same line or " +
      "in a comment directly above it:\n" +
      "  // The upstream types model this as `any`; narrowing here is the caller's job.\n" +
      `  ${hit.name}\n\n` +
      "The check stops running at that line permanently. Ten seconds now saves the next reader " +
      `from having to reconstruct whether it was considered or convenient.${tsIgnoreNote}`,
  );
}

module.exports = { findUnjustified, hasReason, id: "suppression-gate", run };
