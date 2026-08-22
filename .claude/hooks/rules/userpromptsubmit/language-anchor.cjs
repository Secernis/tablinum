"use strict";

/**
 * UserPromptSubmit rule — the chat language stays German.
 *
 * A long English paste in the prompt — a stack trace, a documentation excerpt, a
 * block of code — reliably pulls the reply into English. That is a real effect
 * and it is worth one line of counter-pressure, because the user reads the reply
 * and the user's language is German.
 *
 * The rule only fires on a SUBSTANTIAL English paste, not on English words: this
 * repository's identifiers, commands and file paths are English by policy, so a
 * prompt full of them is the normal case and nudging on it would be constant.
 *
 * The distinction the anchor states matters more than the reminder: the CHAT is
 * German, the CODE is English. Both directions of that get confused.
 */

const { QUORUM, germanStopwordsIn } = require("../../../../scripts/lib/comment-lang.cjs");

/** Minimum prompt length before a language judgement is worth making. */
const MIN_CHARS = 400;

/** English function words — the mirror of the German list, same closed-class logic. */
const ENGLISH_STOPWORDS = new Set([
  "the", "and", "that", "with", "this", "from", "have", "which", "would", "there",
  "their", "about", "should", "these", "those", "because", "however", "therefore",
  "when", "where", "while", "after", "before", "being", "does", "into", "than",
]);

/**
 * Count distinct English stopwords in a text.
 *
 * @param {string} text - The prompt.
 * @returns {number} Distinct hits.
 */
function englishScore(text) {
  const hits = new Set();
  for (const w of String(text || "").toLowerCase().split(/[^a-z]+/)) {
    if (ENGLISH_STOPWORDS.has(w)) hits.add(w);
  }
  return hits.size;
}

/**
 * Build the language-anchor fragment.
 *
 * @param {object} data - UserPromptSubmit hook payload.
 * @returns {{additionalContext: string}|null} The fragment, or null.
 */
function collect(data) {
  const prompt = (data && data.prompt) || "";
  if (prompt.length < MIN_CHARS) return null;

  const english = englishScore(prompt);
  const german = germanStopwordsIn(prompt).length;
  // English prose clearly dominating: the pull is real. A prompt with both is
  // the ordinary bilingual case and needs no anchor.
  if (english < 6 || german >= QUORUM * 2) return null;

  return {
    additionalContext:
      "[tab-language] This prompt carries a substantial English passage. The reply language " +
      "stays German — the pasted text is material, not a language switch.\n" +
      "The split is: chat, explanations and commit bodies in German; code, identifiers, " +
      "comments, commit subjects and CHANGELOG entries in English. Technical terms and " +
      "identifiers keep their original form inside German sentences.",
  };
}

module.exports = { collect, englishScore, id: "language-anchor" };
