"use strict";

/**
 * Stop rule — clippy over the Tauri core when Rust changed.
 *
 * Separate from the main verify gate for one reason: cost. A cargo run holds the
 * target directory lock and takes tens of seconds even when warm, so it is worth
 * paying only when a `.rs` file actually moved. On every other turn this rule
 * costs one set lookup.
 *
 * `-D warnings` is deliberate. A clippy warning that does not fail is a clippy
 * warning nobody reads: the output scrolls past, the build is green, and the
 * count grows monotonically until the whole tool is noise. Failing on the first
 * one keeps the number at zero, which is the only number that stays honest.
 *
 * Runs BEFORE the test rule, and they serialise on the same cargo lock anyway —
 * so the ordering costs nothing and puts the cheaper, more specific failure
 * first.
 */

const path = require("node:path");

const { BLOCK, INCONCLUSIVE, NOOP, PASS, cwdOf } = require("../../lib/io.cjs");
const { readTrackerSet } = require("../../lib/session-touched.cjs");
const { spawnTool } = require("../../lib/spawn-tool.cjs");

/** Cargo is slow but not unbounded; past this the turn is being held hostage. */
const TIMEOUT_MS = 300_000;

/**
 * Whether this session edited Rust source or the crate manifest.
 *
 * @param {string|undefined} sessionId - Stop payload session id.
 * @param {string} cwd - Repo root.
 * @returns {boolean} True when a cargo run is warranted.
 */
function rustTouched(sessionId, cwd) {
  const set = readTrackerSet(sessionId, "session-touched");
  if (!set) return false;
  return [...set].some((abs) => {
    const rel = path.relative(cwd, abs).replace(/\\/g, "/");
    return /^src-tauri\/(?:src\/.*\.rs|Cargo\.toml|build\.rs)$/.test(rel);
  });
}

/**
 * Run clippy over the Tauri crate.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when no Rust changed, INCONCLUSIVE when cargo cannot
 *   run, PASS on clean, BLOCK on a lint.
 */
function run(data) {
  if (data.stop_hook_active) return NOOP;
  const cwd = cwdOf(data);
  if (!rustTouched(data.session_id, cwd)) return NOOP;

  process.stderr.write("[tab-clippy] Rust changed — running clippy...\n");
  const res = spawnTool(
    "cargo",
    ["clippy", "--all-targets", "--", "-D", "warnings"],
    {
      cwd: path.join(cwd, "src-tauri"),
      encoding: "utf8",
      env: { ...process.env, TAB_HOOKS_DISABLED: "1" },
      maxBuffer: 16 * 1024 * 1024,
      timeout: TIMEOUT_MS,
    },
  );

  if (res.error || res.status === null) {
    process.stderr.write(
      `[tab-clippy] could not run (${res.error ? res.error.message : "timed out"}) — ` +
        "the Rust side is unverified this turn.\n",
    );
    return INCONCLUSIVE;
  }
  if (res.status === 0) return PASS;

  process.stderr.write(
    `${res.stderr || res.stdout || ""}\n` +
      "[tab-clippy] Clippy failed. Warnings are errors here on purpose: a warning that does not " +
      "fail is one nobody reads, and the count only ever grows.\n" +
      "Fix the lint rather than allowing it. If an `#[allow(...)]` is genuinely right, it needs " +
      "a reason on the line above — the suppression gate enforces that.\n" +
      "Re-run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`\n",
  );
  return BLOCK;
}

module.exports = { id: "auto-clippy", run, rustTouched };
