"use strict";

/**
 * Detector for German user-facing strings in the frontend.
 *
 * The product decision behind it: the interface is English. Same quorum as the
 * comment detector — two DISTINCT German stopwords — and the same stopword set,
 * imported rather than copied so the two tiers cannot drift.
 *
 * What counts as user-facing: JSX text between tags, and string literals. A
 * class list or an event key cannot reach the quorum (no German function word
 * is a Tailwind utility), so no attribute allowlist is needed — the quorum is
 * the filter. Template literals are scanned with their `${…}` holes removed.
 *
 * Shared by the write-time gate (`.claude/hooks/rules/pretooluse/english-ui-strings.cjs`)
 * and the verify sensor, like `comment-lang.cjs`.
 */

const { QUORUM, germanStopwordsIn, isSkippedPath } = require("./comment-lang.cjs");

/** Frontend source the rule applies to. */
const UI_FILE_RE = /^src\/.*\.(?:ts|tsx|js|jsx)$/i;

/**
 * Stories and vendored component sources are not this app's copy: a story
 * shows a component under any text, and `components/tailgrids/` is what the
 * TailGrids CLI wrote. The detector's own home is skipped like `comment-lang`.
 */
const UI_SKIP_RE = /\.stories\.|(?:^|\/)src\/components\/tailgrids\/|(?:^|\/)ui-lang\.cjs$/i;

/**
 * Remove comments so a German comment (the other gate's business) does not
 * surface here as a string finding.
 *
 * `//` is only a comment start when it does not follow a quote or a colon —
 * otherwise a URL inside a string would be cut in half.
 *
 * @param {string} text - Source fragment.
 * @returns {string} The fragment with comment bodies blanked.
 */
function stripComments(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * The user-facing text candidates in a source fragment.
 *
 * @param {string} text - Source fragment, comments already stripped.
 * @param {boolean} jsx - Whether to look for JSX text between tags as well.
 * @returns {string[]} Candidate strings, in source order.
 */
function extractStrings(text, jsx) {
  const out = [];
  const src = String(text || "");
  if (jsx) {
    for (const m of src.matchAll(/>([^<>{}]+)</g)) {
      const t = m[1].trim();
      if (t) out.push(t);
    }
  }
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) out.push(m[1]);
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) out.push(m[1].replace(/\$\{[^}]*\}/g, " "));
  return out;
}

/**
 * Whether a repo-relative path is subject to the rule.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {boolean} True when the file's strings are user-facing app text.
 */
function isUiFile(rel) {
  const p = String(rel || "");
  return UI_FILE_RE.test(p) && !isSkippedPath(p) && !UI_SKIP_RE.test(`/${p}`);
}

/**
 * Find the first German user-facing string in a source fragment.
 *
 * @param {string} text - Source fragment.
 * @param {string} rel - Repo-relative POSIX path, for the scope check.
 * @returns {{text: string, words: string[]}|null} The finding, or null when clean.
 */
function findGermanString(text, rel) {
  if (!isUiFile(rel)) return null;
  const jsx = /\.(?:tsx|jsx)$/i.test(rel);
  for (const candidate of extractStrings(stripComments(text), jsx)) {
    const words = germanStopwordsIn(candidate);
    if (words.length >= QUORUM) return { text: candidate.slice(0, 160), words };
  }
  return null;
}

module.exports = { extractStrings, findGermanString, isUiFile, stripComments };
