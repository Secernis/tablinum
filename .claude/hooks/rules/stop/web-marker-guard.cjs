"use strict";

/**
 * Stop rule — say where web content came from.
 *
 * When a turn fetched a page or ran a search, the reply mixes two kinds of claim:
 * facts read out of this repository, and text written by a stranger. Those carry
 * very different weight, and once they are in the same paragraph the reader
 * cannot tell them apart — which is exactly the condition under which a wrong
 * claim from a page gets acted on as if it were a fact about the code.
 *
 * So a turn that used a web tool has to name its sources visibly. Cheap to
 * satisfy (one line, a URL), and it is the only mechanism by which the USER —
 * who never sees the tool calls — learns that part of the answer came from
 * outside.
 *
 * Pairs with the PreToolUse hint `web-content-untrusted`, which states the
 * requirement before the content arrives.
 */

const fs = require("node:fs");
const path = require("node:path");

const { BLOCK, NOOP, PASS } = require("../../lib/io.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");

/** Markers that count as naming a source. */
const MARKER_RE = /(?:^|\n)\s*(?:Quelle|Quellen|Source|Sources)\s*:|https?:\/\/\S+/;

/**
 * Whether this session used a web tool this turn.
 *
 * Read from the usage ring rather than from a dedicated flag: the ring already
 * records every call, and a second tracker for the same fact is a second thing
 * that can be out of date.
 *
 * @param {string|undefined} sessionId - Stop payload session id.
 * @returns {boolean} True when a WebFetch/WebSearch call was recorded recently.
 */
function usedWebTool(sessionId) {
  if (!sessionId) return false;
  try {
    const file = path.join(stateDir(), "tool-usage.jsonl");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    // Only the tail matters — a web call ten thousand calls ago is not this turn.
    return lines
      .slice(-60)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .some(
        (e) =>
          e &&
          e.session === sessionId &&
          (e.tool === "WebFetch" || e.tool === "WebSearch") &&
          Date.now() - e.t < 30 * 60 * 1000,
      );
  } catch {
    return false;
  }
}

/**
 * Require a visible source marker after a turn that used web content.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when no web tool ran, PASS when a marker is present,
 *   BLOCK otherwise.
 */
function run(data) {
  if (data.stop_hook_active) return NOOP;
  if (!usedWebTool(data.session_id)) return NOOP;

  const reply = data.last_assistant_message || "";
  // No visible reply to judge — nothing was claimed, so nothing needs sourcing.
  if (!reply.trim()) return NOOP;
  if (MARKER_RE.test(reply)) return PASS;

  process.stderr.write(
    "[tab-web] This turn used a web tool, but the reply names no source.\n\n" +
      "Add a visible line — `Quelle: <url>` — for what came from a page. The user never sees " +
      "the tool calls, so without it they cannot tell a fact read out of this repository from " +
      "a claim written by a stranger, and those carry very different weight.\n\n" +
      "If the fetched content turned out to be irrelevant and nothing in the reply rests on it, " +
      "say that instead — that is also an answer.\n",
  );
  return BLOCK;
}

module.exports = { id: "web-marker-guard", run, usedWebTool };
