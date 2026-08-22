"use strict";

/**
 * The TODO grammar — single source for the write-time hook gate and the
 * repo-wide verify sweep.
 *
 * Why a grammar at all: an untagged `TODO` is a note to nobody. It carries no
 * owner, no reason and no expiry, so it survives every cleanup pass by default
 * and the file of them grows monotonically. A tag forces the writer to say WHICH
 * KIND of debt this is, and the date-bearing kinds force a decision by a
 * deadline instead of at nobody's convenience.
 *
 * Grammar:
 *   TODO(<tag>): text
 *   TODO(<tag>, YYYY-MM-DD): text
 *
 * Tags and their policy:
 *   production  — must be resolved before the app ships to users (date optional)
 *   security    — a known weakness (date REQUIRED, blocks a release cut)
 *   legal       — licence/trademark/compliance follow-up (date optional)
 *   bug         — a known defect with a workaround in place
 *   hack        — a deliberate shortcut, kept honest by being named
 *   perf        — a known slow path
 *   feature     — planned work (date REQUIRED, at most +90 days out)
 *
 * The keyword is canonically UPPERCASE. Lowercase and mixed spellings are
 * detected as violations rather than ignored — otherwise `todo:` becomes the
 * escape hatch that empties the rule.
 *
 * This file is plain CJS with no build step on purpose: the hook dispatcher runs
 * as CJS and must load it directly, and the verify script loads the same module
 * through `createRequire`. One grammar, two consumers, no mirror to drift.
 */

/** Tags that may carry a date. */
const TAGS = {
  bug: { dateRequired: false, maxDays: null },
  feature: { dateRequired: true, maxDays: 90 },
  hack: { dateRequired: false, maxDays: null },
  legal: { dateRequired: false, maxDays: null },
  perf: { dateRequired: false, maxDays: null },
  production: { dateRequired: false, maxDays: null },
  security: { dateRequired: true, maxDays: 180 },
};

/** Tags that block a release cut while any of them is open. */
const RELEASE_BLOCKING_TAGS = new Set(["production", "security", "legal"]);

/** Files whose content is scanned for markers. */
const SCANNED_EXT_RE = /\.(ts|tsx|js|jsx|cjs|mjs|rs|css|toml|json|md|mjs|sh|py)$/i;

/**
 * Paths never scanned: generated output, vendored code, dependency trees, and
 * this grammar's own documentation (which must be able to SHOW a bad marker).
 */
const SKIP_PATH_RE =
  /(?:^|\/)(?:node_modules|dist|target|\.git|vendor|gen|icons|\.claude\/hooks\/state)\//i;

/**
 * Documents that DESCRIBE the grammar must be able to quote it.
 *
 * The whole `.claude/` tree, not a named list: every rule document explains a
 * gate, several of them by showing what the gate refuses. A named list was the
 * first spelling and it was wrong within the hour — `release-gates.md` mentions
 * the release-blocking tags and was refused by the rule it documents.
 */
const GRAMMAR_DOC_RE = /(?:^|\/)todo-core\.cjs$|^\.claude\//i;

/** A well-formed marker: `TODO(tag)` or `TODO(tag, YYYY-MM-DD)` followed by `:`. */
const TAGGED_RE = /\bTODO\(\s*([a-z]+)\s*(?:,\s*(\d{4}-\d{2}-\d{2})\s*)?\)\s*:/g;

/**
 * Any uppercase TODO MARKER, well-formed or not.
 *
 * Two positions count, and nothing else: followed by `:` or `(`, or standing as
 * the first word of a comment body. A bare `TODO` mid-sentence is the word, not
 * a marker — prose about the grammar says "the TODO grammar" and means it.
 *
 * The looser `\bTODO\b` was the first spelling and it flagged this file's own
 * sibling documentation, which is the same signal the lowercase pattern gave:
 * a rule matching its own description is matching the wrong thing.
 */
const ANY_UPPER_RE = /\bTODO\s*[:(]|(?:^|\/\/|\/\*|^\s*\*|#|^\s*[-*])\s*TODO\b/gm;

/**
 * A lowercase/mixed-case marker — a violation, not an exemption.
 *
 * The trailing `:` or `(` is what makes this a MARKER rather than the word.
 * Without it the pattern matched any hyphenated identifier containing "todo" —
 * a filename like `todo-and-debt-markers.md`, a CSS class, a variable — because
 * a hyphen is a word boundary. It fired on the document that defines the
 * grammar, which is as clear a signal as a rule gets that it is matching the
 * wrong thing.
 */
const NON_UPPER_RE = /\b(?!TODO\s*[:(])[Tt][Oo][Dd][Oo]\s*[:(]/g;

/** Sibling debt keywords that must be written as a tagged TODO instead. */
const SIBLING_MARKER_RE = /\b(FIXME|XXX|HACK|TBD)\b/g;

/**
 * Whether a repo-relative path is inside the scan scope.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {boolean} True when the file's content is subject to the grammar.
 */
function isScannedFile(rel) {
  return SCANNED_EXT_RE.test(String(rel || ""));
}

/**
 * Whether a repo-relative path is excluded from the sweep.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {boolean} True when the path is skipped.
 */
function isSkippedPath(rel) {
  const p = String(rel || "");
  // A path that leaves the repository is not repository content. Scratch files
  // live outside it by design, and a grammar for THIS codebase has nothing to
  // say about a throwaway note in a temp directory.
  if (p.startsWith("../") || /^[A-Za-z]:/.test(p)) return true;
  return SKIP_PATH_RE.test(`/${p}/`) || GRAMMAR_DOC_RE.test(p);
}

/**
 * Find the first uppercase TODO that does not match the grammar.
 *
 * @param {string} text - Content to scan.
 * @param {string} [rel] - Repo-relative path, for the skip check.
 * @returns {string|null} The offending line, or null when clean.
 */
function findUntaggedMarker(text, rel) {
  if (rel && isSkippedPath(rel)) return null;
  const src = String(text || "");
  for (const line of src.split("\n")) {
    ANY_UPPER_RE.lastIndex = 0;
    if (!ANY_UPPER_RE.test(line)) continue;
    TAGGED_RE.lastIndex = 0;
    const m = TAGGED_RE.exec(line);
    if (!m) return line.trim();
    if (!Object.hasOwn(TAGS, m[1])) return line.trim();
  }
  return null;
}

/**
 * Find the first lowercase/mixed-case TODO or sibling debt keyword.
 *
 * @param {string} text - Content to scan.
 * @param {string} [rel] - Repo-relative path, for the skip check.
 * @returns {string|null} The offending line, or null when clean.
 */
function findNonUppercaseMarker(text, rel) {
  if (rel && isSkippedPath(rel)) return null;
  for (const line of String(text || "").split("\n")) {
    NON_UPPER_RE.lastIndex = 0;
    if (NON_UPPER_RE.test(line)) return line.trim();
    SIBLING_MARKER_RE.lastIndex = 0;
    if (SIBLING_MARKER_RE.test(line)) return line.trim();
  }
  return null;
}

/**
 * Check date policy for every well-formed marker in the text.
 *
 * Three failures: a date-requiring tag without one, a date further out than the
 * tag's window (a deadline nobody will honour), and a date already in the past
 * (a deadline that already passed — the marker is now overdue, not planned).
 *
 * @param {string} text - Content to scan.
 * @param {Date} now - Reference time (injected so the check is deterministic).
 * @returns {string|null} A human-readable reason, or null when every date is fine.
 */
function findDateWindowViolation(text, now) {
  const src = String(text || "");
  TAGGED_RE.lastIndex = 0;
  let m = TAGGED_RE.exec(src);
  while (m !== null) {
    const [, tag, date] = m;
    const policy = TAGS[tag];
    if (policy) {
      if (policy.dateRequired && !date) {
        return `TODO(${tag}) requires a date: TODO(${tag}, YYYY-MM-DD)`;
      }
      if (date) {
        const due = new Date(`${date}T00:00:00Z`);
        if (Number.isNaN(due.getTime())) return `TODO(${tag}, ${date}) is not a valid date`;
        const days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
        if (days < 0) return `TODO(${tag}, ${date}) is overdue by ${-days} day(s)`;
        if (policy.maxDays !== null && days > policy.maxDays) {
          return `TODO(${tag}, ${date}) is ${days} days out — the limit for '${tag}' is ${policy.maxDays}`;
        }
      }
    }
    m = TAGGED_RE.exec(src);
  }
  return null;
}

/**
 * Collect every well-formed marker in a text, with its tag and date.
 *
 * @param {string} text - Content to scan.
 * @returns {Array<{tag: string, date: string|null, line: number}>} The markers found.
 */
function collectMarkers(text) {
  const out = [];
  const lines = String(text || "").split("\n");
  lines.forEach((line, i) => {
    TAGGED_RE.lastIndex = 0;
    let m = TAGGED_RE.exec(line);
    while (m !== null) {
      out.push({ date: m[2] || null, line: i + 1, tag: m[1] });
      m = TAGGED_RE.exec(line);
    }
  });
  return out;
}

module.exports = {
  RELEASE_BLOCKING_TAGS,
  SCANNED_EXT_RE,
  SKIP_PATH_RE,
  TAGS,
  collectMarkers,
  findDateWindowViolation,
  findNonUppercaseMarker,
  findUntaggedMarker,
  isScannedFile,
  isSkippedPath,
};
