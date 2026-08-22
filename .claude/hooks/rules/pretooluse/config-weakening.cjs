"use strict";

/**
 * PreToolUse rule — no silent loosening of the compiler and linter settings.
 *
 * The failure this prevents has a recognisable shape: a type error appears, and
 * the cheapest way past it is to turn off the check that found it. That trade is
 * almost never worth making — `strict` catches the class of bug that costs the
 * most to find later — and it is invisible in review, because the diff shows one
 * flag flipping, not the hundred call sites it stops verifying.
 *
 * The rule fires on the DIRECTION of the change: turning a check ON is always
 * free, turning it OFF is what needs a decision. So it compares the old and new
 * text rather than pattern-matching the file.
 *
 * `surface-protect` already guards `tsconfig.json` behind an unlock window, so
 * this rule is the second tier: even inside an open window, a weakening still
 * has to be argued for rather than slipped in.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");

/** Config files whose strictness this rule watches. */
const SCOPE_RE = /^(?:tsconfig[^/]*\.json|eslint\.config\.[cm]?[jt]s|\.eslintrc[^/]*|vite[^/]*\.config\.ts|src-tauri\/Cargo\.toml|src-tauri\/clippy\.toml)$/;

/**
 * Settings whose weakening is the point of this rule, with what each one costs.
 *
 * Written as `[name, weakValueRe, why]`: the pattern describes the WEAK state, so
 * a hit in the new text that is absent from the old is the finding.
 */
const WEAKENINGS = [
  ["strict", /"strict"\s*:\s*false/, "turns off the whole strict family at once"],
  ["strictNullChecks", /"strictNullChecks"\s*:\s*false/, "reintroduces the null/undefined bug class"],
  ["noImplicitAny", /"noImplicitAny"\s*:\s*false/, "lets untyped values spread silently"],
  ["noUnusedLocals", /"noUnusedLocals"\s*:\s*false/, "lets dead code accumulate unnoticed"],
  ["noUnusedParameters", /"noUnusedParameters"\s*:\s*false/, "hides signatures that drifted from their callers"],
  ["noFallthroughCasesInSwitch", /"noFallthroughCasesInSwitch"\s*:\s*false/, "reopens the classic switch bug"],
  ["skipLibCheck", /"skipLibCheck"\s*:\s*true/, "stops checking dependency types (accepted here, but not to be widened further)"],
  ["allowJs", /"allowJs"\s*:\s*true/, "lets untyped JS into a TypeScript codebase"],
  ["ignoreDeprecations", /"ignoreDeprecations"/, "silences a deprecation instead of resolving it"],
  ["eslint disable-all", /\/\*\s*eslint-disable\s*\*\//, "disables every rule for a whole file"],
  ["clippy allow-all", /^\s*#!\[allow\(clippy::all\)\]/m, "turns off the entire lint set for a crate"],
];

/**
 * Find a weakening the edit introduces.
 *
 * @param {string} newText - Replacement text.
 * @param {string} oldText - Replaced text.
 * @returns {{name: string, why: string}|null} The finding, or null.
 */
function findWeakening(newText, oldText) {
  for (const [name, re, why] of WEAKENINGS) {
    if (re.test(newText) && !re.test(oldText)) return { name, why };
  }
  return null;
}

/**
 * Deny an edit that loosens a compiler or linter setting.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a weakening.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!SCOPE_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findWeakening(newText, oldText);
  if (!hit) return PASS;

  return deny(
    "tab-guard",
    "Config weakening",
    `'${rel}' would weaken \`${hit.name}\` — it ${hit.why}.\n\n` +
      "A check that just failed is evidence, not an obstacle. Fix what it found; the flag " +
      "flipping is one line in a diff, the hundred call sites it stops verifying are not.\n\n" +
      "If the setting genuinely has to change, that is a decision for the user to make " +
      "explicitly — say what broke, what you tried, and what the setting would cost.",
  );
}

module.exports = { WEAKENINGS, findWeakening, id: "config-weakening", run };
