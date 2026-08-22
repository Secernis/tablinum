"use strict";

/**
 * Append-only telemetry ring for hook dispatches.
 *
 * Every dispatcher records ONE sample per invocation: which rules ran, how long
 * they took, what they decided. That is the only way to answer "is this gate
 * carrying its weight, or is it 40ms of nothing on every tool call" from data
 * instead of from memory — and the only way a rule that silently started
 * crashing (fail-open, exit 0) becomes visible at all.
 *
 * Fully fail-open by contract: a telemetry failure must NEVER alter a verdict or
 * break a dispatch. Every write is wrapped, every error swallowed.
 *
 * Storage is a JSONL file trimmed to a byte cap. Trimming happens under a
 * non-blocking lock (`tryExclusive`) so the parallel dispatchers of one turn do
 * not all rewrite the same file; a loser simply skips and the next dispatch
 * retries.
 */

const fs = require("node:fs");
const path = require("node:path");

const { atomicWriteSync, tryExclusive } = require("./fs-atomic.cjs");
const { stateDir } = require("./state-dir.cjs");

/** Byte cap for the ring. Past this, the oldest half is dropped. */
const MAX_BYTES = 4 * 1024 * 1024;
/** How often a dispatch bothers to check the size (1 in N). */
const TRIM_PROBABILITY = 0.02;
/** A trim lock older than this is a crashed holder. */
const LOCK_STALE_MS = 30_000;

/**
 * Absolute path of the metrics ring. `TAB_HOOK_METRICS_FILE` is the test
 * injection seam.
 *
 * @returns {string} Path of the JSONL ring.
 */
function metricsFile() {
  return process.env.TAB_HOOK_METRICS_FILE || path.join(stateDir(), "hook-metrics.jsonl");
}

/**
 * Drop the oldest half of the ring when it outgrew the byte cap.
 *
 * Runs under a non-blocking lock and rewrites atomically, so a concurrent
 * reader never observes a truncated file.
 *
 * @param {string} file - Ring path.
 * @returns {void}
 */
function trim(file) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (size <= MAX_BYTES) return;
  try {
    tryExclusive(`${file}.lock`, LOCK_STALE_MS, () => {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      atomicWriteSync(file, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`);
    });
  } catch {
    // Fail-open by contract — a ring that cannot be trimmed still records.
  }
}

/**
 * Append one dispatch sample to the ring.
 *
 * @param {object} sample - The record from `io.buildSample()`.
 * @returns {void}
 */
function record(sample) {
  try {
    const file = metricsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ t: Date.now(), ...sample })}\n`, "utf8");
    // Probabilistic: checking the size on every dispatch would put a `stat` on
    // the hot PreToolUse path for a condition that is false ~99.9% of the time.
    if (Math.random() < TRIM_PROBABILITY) trim(file);
  } catch {
    // Fail-open by contract (see file docblock).
  }
}

module.exports = { MAX_BYTES, metricsFile, record, trim };
