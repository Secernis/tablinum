"use strict";

/**
 * PreToolUse rule — no hardcoded secrets, not even in gitignored files.
 *
 * Closes the hole a commit-time scanner leaves open by construction: a scanner
 * reads the STAGED diff, so a real key written into a gitignored `.env`, a doc
 * or a scratch file never reaches it. This rule checks at WRITE time — earlier,
 * and independent of git status.
 *
 * Deliberately only HIGH-CONFIDENCE shapes (PEM headers, AWS key IDs, GitHub and
 * API token prefixes, complete JWT triples). Each one is practically impossible
 * to produce as a placeholder, so false positives go to zero. Generic
 * `password = "..."` patterns are left alone on purpose: they fire on fixtures,
 * on prompts, on the word itself, and a gate that cries wolf gets disabled.
 *
 * Diff-based: only a NEWLY introduced value blocks. A pre-existing secret of the
 * same shape does not hold an unrelated edit hostage — it is recorded as
 * detected-and-excused, never as clean.
 */

const fs = require("node:fs");
const path = require("node:path");

const { EXCUSED, NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");

/** Paths that legitimately carry secret-SHAPED strings: test fixtures, scanner config. */
const EXEMPT_PATH_RE = /(?:\.test\.|\.spec\.|__fixtures__\/|(?:^|\/)secret-write\.cjs$)/;

/**
 * High-confidence secret shapes. Each is a vendor-defined prefix plus a fixed
 * body length — the properties that make them unmistakable and unforgeable as
 * documentation placeholders.
 */
const SECRET_SHAPES = [
  { name: "PEM private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "API key (sk- prefix)", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Tauri updater private key", re: /\bdW50cnVzdGVkIGNvbW1lbnQ6[A-Za-z0-9+/=]{20,}/ },
];

/**
 * Find the first secret shape present in a text.
 *
 * @param {string} text - Content to scan.
 * @returns {string|null} Shape name, or null when nothing matches.
 */
function findShape(text) {
  const hit = SECRET_SHAPES.find((s) => s.re.test(String(text || "")));
  return hit ? hit.name : null;
}

/**
 * Deny edits that introduce a high-confidence secret value anywhere in the repo.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when the fragment is clean, EXCUSED
 *   when the same shape already existed, BLOCK on a newly introduced value.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;

  const ti = data.tool_input || {};
  const abs = ti.file_path || "";
  const rel = path.relative(cwdOf(data), abs).replace(/\\/g, "/");
  if (!rel || EXEMPT_PATH_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const shape = findShape(newText);
  if (!shape) return PASS;

  // A `Write` carries no old_string, so the diff base is the file on disk.
  let before = oldText;
  if (!before) {
    try {
      before = fs.readFileSync(abs, "utf8");
    } catch {
      before = "";
    }
  }
  if (findShape(before) === shape) return EXCUSED;

  return deny(
    "tab-guard",
    "Hardcoded secret blocked",
    `'${rel}' would introduce a real secret value (${shape}).\n\n` +
      "Hardcoded secrets are out of bounds everywhere — docs, fixtures and gitignored files " +
      "included. A gitignored file still sits on disk, still ends up in a backup, and is " +
      "one `git add -f` away from the history.\n\n" +
      "Write a placeholder instead (`${VAR_NAME}` / `<VALUE>`), read the real value from the " +
      "environment at runtime, and keep the Tauri updater key out of the repo entirely — it " +
      "belongs in the release machine's keychain.",
  );
}

module.exports = { SECRET_SHAPES, findShape, id: "secret-write", run };
