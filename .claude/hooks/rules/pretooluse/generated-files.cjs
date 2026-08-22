"use strict";

/**
 * PreToolUse rule — generated files are edited at their source, never by hand.
 *
 * A hand-edit to generated output survives exactly until the next generator run,
 * and then vanishes without a trace. Worse, it is invisible while it lives: the
 * file looks authored, so the next reader trusts it. The fix is always upstream —
 * change what produced the file, then regenerate.
 *
 * Tablinum's generated surfaces and their real sources:
 *
 *   src-tauri/gen/schemas/**   — written by the Tauri build (build.rs / the CLI)
 *   src-tauri/target/**        — cargo output
 *   dist/**                    — vite build output
 *   tailgrids.css              — emitted by the TailGrids toolchain
 *   package-lock.json          — npm's resolver output; edited via `npm install`
 *   src-tauri/Cargo.lock       — cargo's resolver output; edited via `cargo`
 *
 * The brand assets are also generated, but they are guarded by `surface-protect`
 * instead: they have a user-openable window because the generator lives outside
 * the repo and there are legitimate reasons for a human to touch them.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny, noteDetail } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");

/** Generated surfaces, each with the channel that legitimately writes it. */
const GENERATED = [
  {
    re: /^src-tauri\/gen\//,
    source: "the Tauri build — `npm run tauri build` / `npm run tauri dev` regenerates it from tauri.conf.json and capabilities/",
  },
  { re: /^src-tauri\/target\//, source: "cargo — build output, never authored" },
  { re: /^dist\//, source: "vite — `npm run build` regenerates it from src/" },
  {
    re: /^tailgrids\.css$/,
    source: "the TailGrids toolchain — change the component source or the Tailwind config, then regenerate",
  },
  {
    re: /^package-lock\.json$/,
    source: "npm — run `npm install <pkg>` / `npm update`; a hand-edited lockfile resolves to a tree nobody can reproduce",
  },
  {
    re: /^src-tauri\/Cargo\.lock$/,
    source: "cargo — run `cargo add <crate>` / `cargo update` from src-tauri/",
  },
];

/**
 * Classify a repo-relative path as generated output.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {{re: RegExp, source: string}|null} The entry, or null.
 */
function generatedEntry(rel) {
  return GENERATED.find((g) => g.re.test(rel)) || null;
}

/**
 * Deny hand-edits to generated output.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS for authored files, BLOCK otherwise.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const target = data.tool_input && data.tool_input.file_path;
  if (!target) return NOOP;

  const rel = path.relative(cwdOf(data), target).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return NOOP;

  const entry = generatedEntry(rel);
  if (!entry) return PASS;
  noteDetail(rel.split("/")[0]);

  return deny(
    "tab-guard",
    "Generated file",
    `'${rel}' is generated output, not source.\n\n` +
      `Its writer: ${entry.source}.\n\n` +
      "A hand-edit here survives until the next generator run and then disappears silently. " +
      "Change the input instead, regenerate, and commit the result.",
  );
}

module.exports = { GENERATED, generatedEntry, id: "generated-files", run };
