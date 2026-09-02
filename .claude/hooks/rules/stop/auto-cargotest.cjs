"use strict";

/**
 * Stop rule — cargo test over the Tauri core when Rust changed.
 *
 * Runs after clippy, on the same trigger. The ordering is not arbitrary: a lint
 * failure is cheaper to read and more specific than a test failure that was
 * caused by the same mistake, so the more useful message arrives first. They
 * serialise on the cargo target lock regardless, so nothing is lost by it.
 *
 * `--lib --bins` on purpose: integration tests that launch a webview cannot run
 * unattended on every Stop, and a gate that is skipped when it is inconvenient is
 * a gate that reports green for the wrong reason.
 */

const path = require("node:path");

const { BLOCK, INCONCLUSIVE, NOOP, PASS } = require("../../lib/io.cjs");
const { repoRoot } = require("../../lib/state-dir.cjs");
const { spawnTool } = require("../../lib/spawn-tool.cjs");
const { rustTouched } = require("./auto-clippy.cjs");

/** Test runs are slower than lints; the ceiling is correspondingly higher. */
const TIMEOUT_MS = 420_000;

/**
 * Run the Rust unit tests.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when no Rust changed, INCONCLUSIVE when cargo cannot
 *   run, PASS on green, BLOCK on a failure.
 */
function run(data) {
  if (data.stop_hook_active) return NOOP;
  // The repository root, never the payload's cwd: that is the Bash tool's
  // working directory, and after a `cd src-tauri` in a shell call it would
  // point the tool at a `scripts/` that does not exist there.
  const cwd = repoRoot();
  if (!rustTouched(data.session_id, cwd)) return NOOP;

  process.stderr.write("[tab-cargotest] Rust changed — running tests...\n");
  const res = spawnTool("cargo", ["test", "--lib", "--bins"], {
    cwd: path.join(cwd, "src-tauri"),
    encoding: "utf8",
    env: { ...process.env, TAB_HOOKS_DISABLED: "1" },
    maxBuffer: 16 * 1024 * 1024,
    timeout: TIMEOUT_MS,
  });

  if (res.error || res.status === null) {
    process.stderr.write(
      `[tab-cargotest] could not run (${res.error ? res.error.message : "timed out"}) — ` +
        "the Rust tests did not verify anything this turn.\n",
    );
    return INCONCLUSIVE;
  }
  if (res.status === 0) return PASS;

  process.stderr.write(
    `${res.stdout || ""}${res.stderr || ""}\n` +
      "[tab-cargotest] Rust tests failed. Read the assertion before changing anything: a failing " +
      "test is a statement about behaviour, and the question is which of the two is wrong.\n" +
      "Deleting or skipping the test is not an answer — if the expectation genuinely changed, " +
      "change it deliberately and say so in the commit.\n" +
      "Re-run: `cd src-tauri && cargo test --lib --bins`\n",
  );
  return BLOCK;
}

module.exports = { id: "auto-cargotest", run };
