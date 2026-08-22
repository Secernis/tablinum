"use strict";

/**
 * SessionStart rule — the four version numbers must agree.
 *
 * Tablinum states its version in four independent places: `package.json`,
 * `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the newest heading in
 * `CHANGELOG.md`. Tauri reads one, cargo reads another, npm the third, and the
 * user reads the fourth.
 *
 * When they drift, nothing fails. Each file is internally consistent, the build
 * succeeds, and the app reports a version that matches no tag and no changelog
 * entry. The only moment anyone notices is while trying to reproduce a bug from a
 * version number that never existed as a coherent thing.
 *
 * `npm run release` writes all four in one step, which is why it is the only
 * channel allowed to. This rule reports the state at session start, so a drift
 * that has already happened does not get built on.
 */

const fs = require("node:fs");
const path = require("node:path");

const { cwdOf } = require("../../lib/io.cjs");
const { parseChangelog } = require("../../../../scripts/lib/changelog-core.cjs");

/**
 * Read the version each source declares.
 *
 * @param {string} cwd - Repo root.
 * @returns {Record<string, string|null>} Source name to version.
 */
function declaredVersions(cwd) {
  /**
   * Read a file, returning "" when it is unreadable.
   * @param {string} rel - Repo-relative path.
   * @returns {string} File content or "".
   */
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(cwd, rel), "utf8");
    } catch {
      return "";
    }
  };

  /**
   * Pull the first capture of a pattern out of a text.
   * @param {string} text - Haystack.
   * @param {RegExp} re - Pattern with one capture group.
   * @returns {string|null} The captured version, or null.
   */
  const pick = (text, re) => {
    const m = re.exec(text);
    return m ? m[1] : null;
  };

  const changelog = parseChangelog(read("CHANGELOG.md"));
  const newest = changelog.sections.find((s) => s.version);

  return {
    "CHANGELOG.md": newest ? newest.version : null,
    "package.json": pick(read("package.json"), /"version"\s*:\s*"([^"]+)"/),
    "src-tauri/Cargo.toml": pick(read("src-tauri/Cargo.toml"), /^version\s*=\s*"([^"]+)"/m),
    "src-tauri/tauri.conf.json": pick(read("src-tauri/tauri.conf.json"), /"version"\s*:\s*"([^"]+)"/),
  };
}

/**
 * Build the version-drift fragment, or null when the four agree.
 *
 * @param {object} data - SessionStart hook payload.
 * @returns {{additionalContext: string}|null} The fragment.
 */
function collect(data) {
  const versions = declaredVersions(cwdOf(data));
  const present = Object.entries(versions).filter(([, v]) => v);
  // Fewer than two sources to compare: nothing can be said about agreement.
  if (present.length < 2) return null;

  const distinct = new Set(present.map(([, v]) => v));
  if (distinct.size === 1) return null;

  return {
    additionalContext:
      "[tab-version] The declared versions disagree:\n" +
      present.map(([file, v]) => `  ${file}: ${v}`).join("\n") +
      "\nNothing fails on this — each file is internally consistent and the build succeeds, " +
      "so the app simply reports a version that matches no tag. `npm run release -- <version>` " +
      "writes all four in one step; fixing them by hand reintroduces the same drift.",
  };
}

module.exports = { collect, declaredVersions, id: "version-drift" };
