"use strict";

/**
 * PreToolUse rule — guards fail closed, not open.
 *
 * A guard that returns "allowed" when it cannot decide is worse than no guard:
 * it produces a green result under exactly the conditions it exists to catch,
 * and it does so silently. The shapes below are the recurring spellings of that
 * mistake, plus the two React escape hatches that hand raw markup to the DOM.
 *
 * In this app the relevant surfaces are the Tauri command boundary (Rust) and
 * anything that renders repository content — a branch name, a commit message and
 * a file path all come from data the app did not author.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, addedLines, textPair } = require("../../lib/edit-payload.cjs");

/** Where the rule applies. */
const SCOPE_RE = /^(?:src|src-tauri\/src)\/.*\.(tsx|ts|rs)$/;
const EXEMPT_RE = /\.(test|spec|stories)\./;

/** Fail-open and injection shapes, as `[pattern, what, instead]`. */
const SIGNALS = [
  [
    /dangerouslySetInnerHTML/,
    "renders unescaped HTML into the DOM",
    "Render text as text. A commit message, a branch name or a file path is data the app did not author — if it must carry markup, sanitise it explicitly and say why in a comment.",
  ],
  [
    /\.innerHTML\s*=/,
    "assigns raw HTML to an element",
    "Use `textContent`, or build the nodes. `innerHTML` executes what it is given.",
  ],
  [
    /\bcatch\s*(?:\([^)]*\))?\s*\{\s*return\s+true\s*[;}]/,
    "returns `true` from a catch block — a guard that fails open",
    "Return `false` (or propagate the error). An exception means the check did not run, which is not the same as the check passing.",
  ],
  [
    /\.unwrap_or\(\s*true\s*\)/,
    "defaults a failed Rust check to `true`",
    "Default to `false` and let the caller decide. `unwrap_or(true)` turns an error into an approval.",
  ],
  [
    /Access-Control-Allow-Origin["'\s:=]+\*/,
    "sets a wildcard CORS origin",
    "Name the origins that are actually allowed.",
  ],
  [
    /\beval\s*\(|new\s+Function\s*\(/,
    "evaluates a string as code",
    "There is no version of this that is safe in a webview with native reach behind it.",
  ],
  [
    /\bCommand::new\s*\(\s*(?:&|)(?:cmd|command|input|arg|user_)/i,
    "builds a shell command from a variable",
    "Pass a fixed program name with arguments as a vector — never assemble the program itself from input. For git, that means `Command::new(\"git\").args([...])`.",
  ],
];

/**
 * Find a fail-open or injection signal in added lines.
 *
 * @param {string[]} lines - Lines the edit introduces.
 * @returns {{line: string, what: string, instead: string}|null} The finding, or null.
 */
function findSignal(lines) {
  for (const line of lines) {
    for (const [re, what, instead] of SIGNALS) {
      if (re.test(line)) return { instead, line: line.trim().slice(0, 140), what };
    }
  }
  return null;
}

/**
 * Deny an edit that introduces a fail-open guard or an injection sink.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a signal.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!SCOPE_RE.test(rel) || EXEMPT_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findSignal(addedLines(newText, oldText));
  if (!hit) return PASS;

  return deny(
    "tab-guard",
    "Fail-open or injection sink",
    `'${rel}' would add code that ${hit.what}:\n  ${hit.line}\n\n${hit.instead}\n\n` +
      "The general rule: when a check cannot decide, the answer is no. A guard that returns " +
      "\"allowed\" on failure is green exactly when it matters and silent about it.",
  );
}

module.exports = { SIGNALS, findSignal, id: "deny-by-default", run };
