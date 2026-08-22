"use strict";

/**
 * PreToolUse rule — no hardcoded mock data in the shipping UI.
 *
 * A component that renders `const repos = [{ name: "example-repo" }]` looks
 * finished. It builds, it screenshots well, and it is indistinguishable from a
 * working feature until someone runs it against reality. That is precisely why
 * it is expensive: placeholder data does not fail, it just quietly stands in for
 * a data path nobody wrote.
 *
 * For a Git client this is worse than average — the whole product IS the data.
 * A commit list that is real reveals loading states, empty states, error states
 * and pagination on day one; a hardcoded one reveals none of them until the
 * feature is declared done.
 *
 * Scope is the shipping surface (`src/**`), minus tests and stories, where
 * fixtures are the point. The check looks for placeholder VOCABULARY in added
 * lines, not for arrays as such: a static list of menu labels is data, not a
 * mock.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, addedLines, textPair } = require("../../lib/edit-payload.cjs");

/** The shipping surface. */
const SCOPE_RE = /^src\/.*\.(tsx|ts)$/;

/** Places where fixtures ARE the deliverable. */
const EXEMPT_RE = /\.(test|spec|stories|fixture)\.|(?:^|\/)(?:__tests__|__mocks__|__fixtures__)\//;

/**
 * Identifier names that announce placeholder data.
 *
 * Matched at a declaration, so a variable named `mockRepos` trips it and a
 * comment mentioning "mock" does not.
 */
const PLACEHOLDER_DECL_RE =
  /\b(?:const|let|var|function)\s+(?:mock|dummy|fake|sample|placeholder|stub|test)[A-Z_]\w*/;

/** Classic filler values — the ones nobody types on purpose in shipping code. */
const FILLER_VALUE_RE =
  /["'](?:lorem ipsum|John Doe|Jane Doe|foo ?bar|example@example\.com|test@test\.|user@example\.com|John Smith)/i;

/** A `TODO`-free "replace me later" marker. */
const PLACEHOLDER_COMMENT_RE = /\/\/\s*(?:mock|dummy|fake|placeholder|hardcoded)\s+data\b/i;

/**
 * Find the first placeholder signal in a set of added lines.
 *
 * @param {string[]} lines - Lines the edit introduces.
 * @returns {{line: string, why: string}|null} The finding, or null.
 */
function findPlaceholder(lines) {
  for (const line of lines) {
    if (PLACEHOLDER_DECL_RE.test(line)) {
      return { line: line.trim().slice(0, 140), why: "a declaration named as placeholder data" };
    }
    if (FILLER_VALUE_RE.test(line)) {
      return { line: line.trim().slice(0, 140), why: "a classic filler value" };
    }
    if (PLACEHOLDER_COMMENT_RE.test(line)) {
      return { line: line.trim().slice(0, 140), why: "a comment declaring the data is a stand-in" };
    }
  }
  return null;
}

/**
 * Deny an edit that introduces placeholder data into the shipping UI.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on placeholder data.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!SCOPE_RE.test(rel) || EXEMPT_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findPlaceholder(addedLines(newText, oldText));
  if (!hit) return PASS;

  return deny(
    "tab-guard",
    "Mock data in the shipping UI",
    `'${rel}' would introduce placeholder data — ${hit.why}:\n  ${hit.line}\n\n` +
      "Placeholder data does not fail. It builds and it screenshots well, so the missing data " +
      "path stays invisible until someone runs the app for real — and this app IS its data.\n\n" +
      "Wire the component to the actual source (a Tauri command, a store, a prop) even when it " +
      "returns nothing yet: an empty result is a real state worth designing. If you need a " +
      "fixture to develop against, put it in a `.stories.tsx` or a test — those are exempt.",
  );
}

module.exports = { findPlaceholder, id: "mock-data", run };
