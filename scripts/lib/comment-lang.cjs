"use strict";

/**
 * Language detection for code comments — single source for the write-time hook
 * gate and the repo-wide verify sweep.
 *
 * Why it exists: the working language of this project is German, and it bleeds
 * into the code. A German comment is fine for exactly as long as the only reader
 * is the person who wrote it; the moment the repository is public, a contributor
 * or a tool, it is an unreadable artefact sitting inside otherwise portable code.
 * Code, identifiers, comments and commit subjects are English. The CHAT stays
 * German — this rule has nothing to say about it.
 *
 * Detection is a stopword quorum, not a language model: a comment counts as
 * German when it contains at least two DISTINCT German function words. One is
 * not enough, because German function words collide with English identifiers and
 * with borrowed nouns ("die" is a verb in English, "war" is a noun, "hat" is a
 * hat). Two distinct ones essentially never co-occur by accident in English
 * prose, and the false-positive cost — blocking a legitimate comment — is what
 * the quorum is calibrated against.
 */

/**
 * German function words. Deliberately closed-class (articles, pronouns,
 * conjunctions, prepositions, auxiliaries): they appear in every German
 * sentence, and they carry no domain meaning that could pull in identifiers.
 * Words that ARE English words are excluded by construction — see the docblock.
 */
const GERMAN_STOPWORDS = new Set([
  "aber", "alle", "allen", "als", "also", "auch", "auf", "aus",
  "bei", "beim", "bereits", "bevor", "damit", "dann", "darf", "das",
  "dass", "dem", "den", "denn", "der", "des", "deshalb", "dies",
  "diese", "diesem", "diesen", "dieser", "dieses", "doch", "dort",
  "durch", "eigentlich", "ein", "eine", "einem", "einen", "einer",
  "eines", "erst", "etwa", "falls", "für", "fuer", "gegen", "gibt",
  "hier", "ihre", "immer", "jede", "jeden", "jetzt", "kann", "kein",
  "keine", "können", "koennen", "muss", "müssen", "muessen", "nach",
  "nicht", "nichts", "noch", "nur", "oder", "ohne", "schon", "sein",
  "seine", "sich", "sind", "soll", "sollte", "sonst", "statt", "über",
  "ueber", "und", "uns", "unter", "vom", "von", "vor", "während",
  "waehrend", "wenn", "werden", "wird", "wirklich", "wurde", "zum",
  "zur", "zwar", "zwischen",
]);

/** Minimum DISTINCT stopwords before a comment counts as German. */
const QUORUM = 2;

/** Test corpora and fixtures, which carry the language on purpose. */
const FIXTURE_PATH_RE = /(?:^|\/)(?:__fixtures__|__tests__|__mocks__)\/|\.(?:test|spec)\./;

/** Files whose comments are subject to the rule. */
const SCANNED_EXT_RE = /\.(ts|tsx|js|jsx|cjs|mjs|rs|css|toml|sh|py)$/i;

/**
 * Paths excluded: generated output, vendored code, and this detector itself.
 *
 * `src/lib/brand/` is in the list for the same reason as `dist/` and `gen/`: it
 * is generated output that happens to be committed, because its generator lives
 * in the private `design/` tree. A German comment there is a real finding — but
 * the fix belongs in the generator, and reporting it here would leave the gate
 * permanently red against a file nobody in this repository can correct. A gate
 * that is always red is a gate that gets skipped, which costs more than the one
 * finding it holds.
 */
const SKIP_PATH_RE =
  /(?:^|\/)(?:node_modules|dist|target|\.git|vendor|gen)\/|(?:^|\/)src\/lib\/brand\/|(?:^|\/)comment-lang\.cjs$/i;

/**
 * Extract comment text from a source fragment.
 *
 * Covers the three comment shapes this repo uses: `//` line comments, `/* ... *\/`
 * blocks (JS/TS/Rust/CSS) and `#` line comments (shell, Python, TOML). String
 * literals are NOT excluded — a false positive there is a comment-shaped string,
 * which is rare, while excluding them properly would need a real tokenizer.
 *
 * @param {string} text - Source fragment.
 * @returns {string[]} The comment bodies found, in source order.
 */
function extractComments(text) {
  const src = String(text || "");
  const out = [];
  const patterns = [
    /\/\*[\s\S]*?\*\//g,
    /(?:^|[^:])\/\/(.*)$/gm,
    /(?:^|\s)#(?!\[|!)(.*)$/gm,
  ];
  for (const re of patterns) {
    let m = re.exec(src);
    while (m !== null) {
      out.push((m[1] !== undefined ? m[1] : m[0]).trim());
      m = re.exec(src);
    }
  }
  return out.filter(Boolean);
}

/**
 * Count the DISTINCT German stopwords in a piece of text.
 *
 * @param {string} text - Comment body.
 * @returns {string[]} The distinct stopwords found.
 */
function germanStopwordsIn(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^a-zäöüß]+/i)
    .filter(Boolean);
  const hits = new Set();
  for (const w of words) if (GERMAN_STOPWORDS.has(w)) hits.add(w);
  return [...hits];
}

/**
 * Find the first German comment in a source fragment.
 *
 * @param {string} text - Source fragment.
 * @param {string} [rel] - Repo-relative path, for the skip check.
 * @returns {{comment: string, words: string[]}|null} The finding, or null when clean.
 */
function findGermanComment(text, rel) {
  if (rel && (isSkippedPath(rel) || !isScannedFile(rel))) return null;
  for (const comment of extractComments(text)) {
    const words = germanStopwordsIn(comment);
    if (words.length >= QUORUM) {
      return { comment: comment.slice(0, 160), words };
    }
  }
  return null;
}

/**
 * Whether a repo-relative path is inside the scan scope.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {boolean} True when the file's comments are subject to the rule.
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
  // Outside the repository is not repository content — same boundary and same
  // reason as in `todo-core.cjs`.
  if (p.startsWith("../") || /^[A-Za-z]:/.test(p)) return true;
  // A corpus for a language detector necessarily contains the language it
  // detects. `secret-write` and the marker grammar both carry this exemption;
  // this one lacked it, and the gap surfaced the moment a fixture needed a
  // German comment to prove the detector fires on one.
  if (FIXTURE_PATH_RE.test(p)) return true;
  return SKIP_PATH_RE.test(`/${p}`);
}

module.exports = {
  GERMAN_STOPWORDS,
  QUORUM,
  extractComments,
  findGermanComment,
  germanStopwordsIn,
  isScannedFile,
  isSkippedPath,
};
