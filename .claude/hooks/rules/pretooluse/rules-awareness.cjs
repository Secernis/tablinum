"use strict";

/**
 * PreToolUse rule — point at `.claude/rules/` on the first edit of a session.
 *
 * Not a gate: context injection, once. The standards in `.claude/rules/` are not
 * loaded into every session (they would cost more context than they are worth on
 * a turn that never touches code), so a session can spend its whole life unaware
 * that a written rule covers what it is doing. One line at the first edit closes
 * that gap for the price of one line.
 *
 * Deliberately a POINTER, not a summary: a summary here would be a second copy
 * of the rules that drifts from the first.
 */

const fs = require("node:fs");
const path = require("node:path");

const { EXCUSED, NOOP, cwdOf, hint } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");

/**
 * Resolve the per-session flag path.
 *
 * @param {string} sessionId - Harness-provided session identifier.
 * @returns {string} Absolute path of this session's marker.
 */
function flagPath(sessionId) {
  return path.join(
    stateDir(),
    "rules-awareness",
    String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_"),
  );
}

/**
 * List the rule topics that exist, so the hint can name them.
 *
 * @param {string} cwd - Repo root.
 * @returns {string[]} Topic directory names, sorted.
 */
function ruleTopics(cwd) {
  try {
    return fs
      .readdirSync(path.join(cwd, ".claude", "rules"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Inject the rules pointer once per session.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} Non-blocking; emits at most once per session.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const sessionId = data.session_id;
  if (!sessionId) return NOOP;

  const flag = flagPath(sessionId);
  try {
    if (fs.existsSync(flag)) return EXCUSED;
  } catch {
    return EXCUSED;
  }

  const cwd = cwdOf(data);
  const topics = ruleTopics(cwd);
  if (topics.length === 0) return NOOP;

  try {
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(flag, new Date().toISOString(), "utf8");
  } catch {
    // Marker IO failed — still hint once rather than swallow it.
  }

  return hint(
    "tab-rules",
    `This repository keeps its standards in \`.claude/rules/\` — ${topics.length} topics: ` +
      `${topics.join(", ")}.\n` +
      "Read the one that covers what you are about to change; several of the hooks that can " +
      "block this session are the enforcement tier of a rule written there, and the rule says " +
      "WHY where the block only says what.",
    `rules: ${topics.length} topic(s) in .claude/rules/ — read the relevant one`,
  );
}

module.exports = { flagPath, id: "rules-awareness", ruleTopics, run };
