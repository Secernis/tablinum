"use strict";

/**
 * Stop rule — the visible reply is German.
 *
 * The user reads the reply and the user's language is German. This is the only
 * place that fact is checked against what was actually produced, because the
 * drift is real and gradual: a turn spent reading English source, English error
 * messages and English documentation ends in an English reply without anyone
 * deciding to switch.
 *
 * Judged on the VISIBLE reply only. Code blocks, identifiers, file paths and
 * command lines are English by policy and are stripped before the judgement —
 * otherwise a reply that is one German sentence around a large code block would
 * read as English and the rule would fire on exactly the turns it should not.
 *
 * The quorum is the same closed-class stopword logic as the code-comment
 * detector, run in the other direction.
 */

const { BLOCK, NOOP, PASS } = require("../../lib/io.cjs");
const { germanStopwordsIn } = require("../../../../scripts/lib/comment-lang.cjs");
const { englishScore } = require("../../rules/userpromptsubmit/language-anchor.cjs");

/** Below this, there is not enough prose to judge. */
const MIN_PROSE_CHARS = 220;

/**
 * Strip the parts of a reply that are English by policy.
 *
 * @param {string} reply - The visible assistant message.
 * @returns {string} The prose that remains.
 */
function proseOf(reply) {
  return String(reply || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s*[-*]\s+\S+\.(?:tsx?|rs|json|md|mjs|cjs|toml)\b.*$/gm, " ")
    .replace(/https?:\/\/\S+/g, " ");
}

/**
 * Require the visible reply to be German.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when there is too little prose, PASS when German,
 *   BLOCK when the reply drifted to English.
 */
function run(data) {
  if (data.stop_hook_active) return NOOP;
  const prose = proseOf(data.last_assistant_message || "");
  if (prose.trim().length < MIN_PROSE_CHARS) return NOOP;

  const german = germanStopwordsIn(prose).length;
  const english = englishScore(prose);
  // Both signals are needed: German prose contains English technical terms by
  // policy, so a nonzero English score alone means nothing.
  if (german >= 3 || english < german + 4) return PASS;

  process.stderr.write(
    "[tab-language] The visible reply drifted into English.\n\n" +
      "The chat language is German — that is what the user reads. Code, identifiers, file " +
      "paths, commit subjects and CHANGELOG entries stay English, and technical terms keep " +
      "their original form inside German sentences.\n\n" +
      "Rewrite the reply in German. Do not translate the identifiers.\n",
  );
  return BLOCK;
}

module.exports = { id: "language-guard", proseOf, run };
