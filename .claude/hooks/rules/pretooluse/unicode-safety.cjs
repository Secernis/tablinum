"use strict";

/**
 * PreToolUse rule — no invisible or bidi control characters in source.
 *
 * Catches the Trojan Source class (CVE-2021-42574) at write time: bidi override
 * and isolate controls make code RENDER differently than it EXECUTES, so a
 * reviewer reading the diff sees one program and the compiler sees another.
 * Zero-width and invisible-operator characters smuggle in token boundaries or
 * homoglyph identifiers.
 *
 * The realistic vector here is text carried over from an untrusted web source
 * (see `web-content-untrusted`) — a snippet copied from a page, a code block
 * from search results.
 *
 * Deliberately narrow, scoped to the DANGEROUS invisible class. Emoji are not
 * blocked, and Latin diacritics (ä/ö/ü/ß/ç/ã — required in this project's German
 * user-facing text) sit outside these code-point ranges and cannot trip it by
 * construction.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");

const IS_CODE_FILE_RE = /\.(ts|tsx|js|jsx|cjs|mjs|rs|css|toml|ya?ml|json|md|sh)$/i;

/**
 * Dangerous invisible code points. Each entry is `[lo, hi]` (inclusive).
 * Source: the Trojan Source paper and the Unicode bidi specification.
 */
const DANGEROUS_RANGES = [
  [0x200b, 0x200d], // Zero-Width Space / Non-Joiner / Joiner
  [0x2060, 0x2064], // Word-Joiner + invisible operators
  [0x202a, 0x202e], // Bidi embeddings + overrides (LRE/RLE/PDF/LRO/RLO)
  [0x2066, 0x2069], // Bidi isolates (LRI/RLI/FSI/PDI)
  [0xfeff, 0xfeff], // Zero-Width No-Break Space / BOM inside the file
  [0x115f, 0x1160], // Hangul fillers, abused as zero-width
  [0x3164, 0x3164], // Hangul Filler
];

/**
 * Find the first dangerous character in a text.
 *
 * @param {string} text - Content to scan.
 * @returns {{cp: number, index: number}|null} Code point + position, or null.
 */
function findDangerous(text) {
  const src = String(text || "");
  for (let i = 0; i < src.length; i += 1) {
    const cp = src.codePointAt(i);
    for (const [lo, hi] of DANGEROUS_RANGES) {
      if (cp >= lo && cp <= hi) return { cp, index: i };
    }
  }
  return null;
}

/**
 * Deny edits that introduce invisible/bidi control characters into source.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a new control char.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;

  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!IS_CODE_FILE_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findDangerous(newText);
  // Only NEWLY introduced characters block — an existing one must not hold an
  // unrelated edit hostage.
  if (hit && !findDangerous(oldText)) {
    const hex = `U+${hit.cp.toString(16).toUpperCase().padStart(4, "0")}`;
    return deny(
      "tab-guard",
      "Invisible/bidi character in source blocked",
      `'${rel}' would introduce an invisible control character (${hex}) — the Trojan Source ` +
        "class (CVE-2021-42574): the code renders differently than it runs.\n\n" +
        "This almost always arrives with text copied from an untrusted web source. Remove the " +
        "character and retype the line. Real diacritics (ä/ö/ü/ß) are unaffected — only " +
        "bidi and zero-width controls are in scope.",
    );
  }
  return PASS;
}

module.exports = { DANGEROUS_RANGES, findDangerous, id: "unicode-safety", run };
