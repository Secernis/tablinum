"use strict";

/**
 * CHANGELOG schema — single source for the write-time hook gates, the Stop-time
 * currency reminder, the `changelog` script and the release cut.
 *
 * The format is Keep a Changelog (keepachangelog.com) with Semantic Versioning,
 * because it is the one changelog convention a reader recognises without being
 * told, and because its structure is machine-checkable: a version heading
 * carries its release date, and every entry sits under one of six fixed
 * categories.
 *
 *   # Changelog
 *   ...intro...
 *   ## [Unreleased]
 *   ### Added
 *   - a user-visible statement
 *   ## [0.2.0] - 2026-08-22
 *   ### Fixed
 *   - ...
 *
 * Two properties this project depends on:
 *
 * 1. The `## [Unreleased]` section is where work is documented AS IT LANDS. A
 *    changelog written at release time is written from `git log`, and a git log
 *    is a list of what changed in the code, not of what changed for the person
 *    using the app. Those are different documents, and only the second one is
 *    worth writing.
 * 2. A `## [X.Y.Z]` heading is written by the version bump ALONE. Its number is
 *    only known once the bump has decided it, so a hand-written heading is a
 *    guess — and a guessed version heading claims a release that never existed.
 *    The gate `changelog-version-heading` enforces the channel.
 *
 * Plain CJS with no build step on purpose: the hook dispatcher loads it directly
 * and the ESM scripts load it through `createRequire`. One schema, no mirror.
 */

/**
 * The six Keep a Changelog categories, in canonical render order.
 *
 * Fixed set on purpose: a free-text category is how a changelog degenerates into
 * a commit log with headings. "Added / Changed / Deprecated / Removed / Fixed /
 * Security" is the vocabulary a reader can scan without reading.
 */
const CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/** Categories whose presence makes a release at least a MINOR bump. */
const MINOR_CATEGORIES = new Set(["Added", "Deprecated"]);

/** The Unreleased heading, in the spelling the scripts write. */
const UNRELEASED_HEADING = "## [Unreleased]";

/** A `## ` version heading, capturing version and (optional) date. */
const VERSION_HEADING_RE = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?\s*(?:[-–—]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

/** The Unreleased heading in any of its accepted spellings. */
const UNRELEASED_HEADING_RE = /^##\s+\[?Unreleased\]?\s*$/i;

/** A `### ` category heading. */
const CATEGORY_HEADING_RE = /^###\s+(.+?)\s*$/;

/** A list entry. */
const ENTRY_RE = /^[-*]\s+(.+?)\s*$/;

/**
 * Collect the set of versions claimed by `## ` headings in a block of text.
 *
 * Comparing VERSIONS rather than heading LINES is what keeps a reformat
 * (`## [1.2.3] - ...` -> `## 1.2.3 - ...`) free while still catching a newly
 * claimed release.
 *
 * @param {string} text - Any slice of CHANGELOG content.
 * @returns {Set<string>} The versions found, without duplicates.
 */
function headingVersions(text) {
  const found = new Set();
  if (typeof text !== "string" || text === "") return found;
  for (const line of text.split("\n")) {
    const m = VERSION_HEADING_RE.exec(line);
    if (m) found.add(m[1]);
  }
  return found;
}

/**
 * Parse a CHANGELOG into its sections.
 *
 * @param {string} text - Full file content.
 * @returns {{intro: string[], sections: Array<{version: string|null, date: string|null,
 *   heading: string, lines: string[], categories: Record<string, string[]>}>}}
 *   `version` is null for the Unreleased section.
 */
function parseChangelog(text) {
  const lines = String(text || "").split("\n");
  const intro = [];
  const sections = [];
  let current = null;
  let category = null;

  for (const line of lines) {
    const unreleased = UNRELEASED_HEADING_RE.test(line);
    const versionMatch = VERSION_HEADING_RE.exec(line);
    if (unreleased || versionMatch) {
      current = {
        categories: {},
        date: versionMatch ? versionMatch[2] || null : null,
        heading: line,
        lines: [],
        version: versionMatch ? versionMatch[1] : null,
      };
      sections.push(current);
      category = null;
      continue;
    }
    if (!current) {
      intro.push(line);
      continue;
    }
    current.lines.push(line);
    const cat = CATEGORY_HEADING_RE.exec(line);
    if (cat) {
      category = cat[1];
      if (!current.categories[category]) current.categories[category] = [];
      continue;
    }
    const entry = ENTRY_RE.exec(line);
    if (entry && category) {
      current.categories[category].push(entry[1]);
      continue;
    }
    // A wrapped bullet is ONE entry, not a stray line: an indented continuation
    // is folded into the entry above it. Without this a hand-wrapped entry is
    // counted several times over and rendered truncated at its first line.
    if (category && /^\s+\S/.test(line) && current.categories[category].length > 0) {
      const list = current.categories[category];
      list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
    }
  }
  return { intro, sections };
}

/**
 * The Unreleased section, or null when the file has none.
 *
 * @param {string} text - Full file content.
 * @returns {object|null} The parsed section.
 */
function unreleasedSection(text) {
  return parseChangelog(text).sections.find((s) => s.version === null) || null;
}

/**
 * Every entry currently sitting in Unreleased, flattened with its category.
 *
 * @param {string} text - Full file content.
 * @returns {Array<{category: string, text: string}>} The pending entries.
 */
function unreleasedEntries(text) {
  const section = unreleasedSection(text);
  if (!section) return [];
  const out = [];
  for (const [category, entries] of Object.entries(section.categories)) {
    for (const entry of entries) out.push({ category, text: entry });
  }
  return out;
}

/**
 * The release bump the pending entries imply.
 *
 * Deliberately conservative — it never proposes `major`. A breaking change is a
 * judgement about the product's contract with its users, and no heuristic over
 * category names is entitled to make it.
 *
 * @param {string} text - Full file content.
 * @returns {"minor"|"patch"|null} The implied bump, or null when nothing pends.
 */
function impliedBump(text) {
  const entries = unreleasedEntries(text);
  if (entries.length === 0) return null;
  return entries.some((e) => MINOR_CATEGORIES.has(e.category)) ? "minor" : "patch";
}

/**
 * Validate a CHANGELOG against the schema.
 *
 * @param {string} text - Full file content.
 * @returns {string[]} Human-readable problems; empty means the file is well-formed.
 */
function validateSchema(text) {
  const problems = [];
  const src = String(text || "");
  const { sections } = parseChangelog(src);

  if (!/^#\s+Changelog\s*$/m.test(src)) {
    problems.push("missing the top-level `# Changelog` heading");
  }
  if (!sections.some((s) => s.version === null)) {
    problems.push(
      "missing the `## [Unreleased]` section — that is where work is documented as it lands",
    );
  }

  const seen = new Set();
  for (const section of sections) {
    const label = section.version ? section.version : "Unreleased";
    if (section.version) {
      if (!section.date) {
        problems.push(`\`## [${section.version}]\` carries no release date (expected \`- YYYY-MM-DD\`)`);
      }
      if (seen.has(section.version)) problems.push(`version ${section.version} appears twice`);
      seen.add(section.version);
    }
    for (const category of Object.keys(section.categories)) {
      if (!CATEGORIES.includes(category)) {
        problems.push(
          `${label}: unknown category \`### ${category}\` (allowed: ${CATEGORIES.join(", ")})`,
        );
      }
    }
    for (const [category, entries] of Object.entries(section.categories)) {
      if (entries.length === 0) problems.push(`${label}: empty category \`### ${category}\``);
    }
  }

  // Versions must descend: a changelog is read top-down, newest first.
  const versions = sections.filter((s) => s.version).map((s) => s.version);
  for (let i = 1; i < versions.length; i += 1) {
    if (compareVersions(versions[i - 1], versions[i]) < 0) {
      problems.push(`version order: ${versions[i - 1]} is listed above the newer ${versions[i]}`);
    }
  }
  return problems;
}

/**
 * Compare two semver-ish versions numerically.
 *
 * @param {string} a - Left version.
 * @param {string} b - Right version.
 * @returns {number} Negative when a < b, positive when a > b, 0 when equal.
 */
function compareVersions(a, b) {
  const pa = String(a).split("-")[0].split(".").map(Number);
  const pb = String(b).split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * Insert an entry into the Unreleased section under a category, creating the
 * category (in canonical order) when it does not exist yet.
 *
 * @param {string} text - Full file content.
 * @param {string} category - One of {@link CATEGORIES}.
 * @param {string} entry - The entry text, without the leading `- `.
 * @returns {string} The rewritten file content.
 */
function addUnreleasedEntry(text, category, entry) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`unknown category '${category}' (allowed: ${CATEGORIES.join(", ")})`);
  }
  const lines = String(text || "").split("\n");
  let start = lines.findIndex((l) => UNRELEASED_HEADING_RE.test(l));
  if (start === -1) {
    // No Unreleased section yet: open one directly under the intro, i.e. above
    // the newest version heading (or at the end when there is none).
    const firstVersion = lines.findIndex((l) => VERSION_HEADING_RE.test(l));
    const at = firstVersion === -1 ? lines.length : firstVersion;
    lines.splice(at, 0, UNRELEASED_HEADING, "");
    start = at;
  }
  // The Unreleased section ends at the next `## ` heading.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  const catIndex = body.findIndex((l) => {
    const m = CATEGORY_HEADING_RE.exec(l);
    return m && m[1] === category;
  });

  if (catIndex !== -1) {
    // Append after the LAST entry of that category, so entries keep their order.
    //
    // Three line kinds have to be walked past, not just entries: the blank line
    // that conventionally follows a `###` heading, and the indented continuation
    // lines of a wrapped bullet. Stopping at the first non-entry line put a new
    // entry ABOVE the existing ones with a stray blank between them — visible
    // the first time this ran against a real, hand-wrapped section.
    let insertAt = catIndex + 1;
    let lastEntryEnd = catIndex + 1;
    while (insertAt < body.length && !/^##/.test(body[insertAt])) {
      const line = body[insertAt];
      if (ENTRY_RE.test(line) || /^\s+\S/.test(line)) {
        insertAt += 1;
        lastEntryEnd = insertAt;
        continue;
      }
      if (line.trim() === "") {
        insertAt += 1;
        continue;
      }
      break;
    }
    body.splice(lastEntryEnd, 0, `- ${entry}`);
  } else {
    // New category: place it in canonical order among the existing ones.
    const order = CATEGORIES.indexOf(category);
    let insertAt = body.length;
    for (let i = 0; i < body.length; i += 1) {
      const m = CATEGORY_HEADING_RE.exec(body[i]);
      if (m && CATEGORIES.indexOf(m[1]) > order) {
        insertAt = i;
        break;
      }
    }
    const block = [`### ${category}`, `- ${entry}`, ""];
    // Keep exactly one blank line between the heading and the first category.
    while (insertAt > 0 && body[insertAt - 1].trim() === "") insertAt -= 1;
    body.splice(insertAt, 0, "", ...block);
  }

  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join("\n");
}

/**
 * Promote the Unreleased section to a released version heading and open a fresh,
 * empty Unreleased above it.
 *
 * @param {string} text - Full file content.
 * @param {string} version - The version being released.
 * @param {string} date - Release date as `YYYY-MM-DD`.
 * @returns {string} The rewritten file content.
 */
function promoteUnreleased(text, version, date) {
  const lines = String(text || "").split("\n");
  const at = lines.findIndex((l) => UNRELEASED_HEADING_RE.test(l));
  if (at === -1) throw new Error("no `## [Unreleased]` section to promote");
  lines.splice(at, 1, UNRELEASED_HEADING, "", `## [${version}] - ${date}`);
  return lines.join("\n");
}

module.exports = {
  CATEGORIES,
  MINOR_CATEGORIES,
  UNRELEASED_HEADING,
  UNRELEASED_HEADING_RE,
  VERSION_HEADING_RE,
  addUnreleasedEntry,
  compareVersions,
  headingVersions,
  impliedBump,
  parseChangelog,
  promoteUnreleased,
  unreleasedEntries,
  unreleasedSection,
  validateSchema,
};
