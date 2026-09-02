"use strict";

/**
 * PreToolUse rule — a commit call carries a known type, a scope, and an
 * atomic, imperative subject.
 *
 * `commit.mjs` checks the same things and refuses on its own. The hook tier
 * exists for the reader of the transcript, not for git: a refusal at the hook
 * arrives before the script has spawned, with the reason attached to the call
 * that caused it, instead of as a failed command whose output has to be read
 * back. It also means the convention holds even when the script is bypassed
 * through a wrapper the script never sees.
 *
 * The checks are single-sourced in `scripts/lib/git-conventions.cjs`, shared
 * with the script, so the two tiers cannot disagree about what a subject is.
 *
 * Replaces `commit-scope` (2026-09-02), which checked only that a scope was
 * present; presence is now one of four questions asked in one place.
 */

const { NOOP, PASS, deny } = require("../../lib/io.cjs");
const { checkScope, checkSubject, checkType } = require("../../../../scripts/lib/git-conventions.cjs");

/** A commit invocation through the project's channel. */
const COMMIT_CALL_RE = /\b(?:npm\s+run\s+commit|node\s+scripts\/commit\.mjs)\b/;
/** Modes that inspect rather than commit — they carry nothing to check. */
const NON_COMMITTING_RE = /(?:^|\s)--(?:inspect|help)(?:\s|=|$)/;

/**
 * Split a shell command line into words, honouring quotes and backslashes.
 *
 * Enough of a tokenizer for the flags this rule reads: a `--message` value is
 * quoted, may contain spaces, and may contain the other quote character. Not
 * a shell — `$()` and heredocs are passed through as text.
 *
 * @param {string} line - The command line.
 * @returns {string[]} Words with their quotes removed.
 */
function shellWords(line) {
  const words = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < line.length) {
        i += 1;
        cur += line[i];
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      i += 1;
      cur += line[i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) words.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

/** Word-level separators between commands in one line. */
const SEPARATORS = new Set(["&&", "||", ";", "|"]);

/**
 * Split words into command segments at the shell separators.
 *
 * @param {string[]} words - Tokenized line.
 * @returns {string[][]} One word list per command.
 */
function wordSegments(words) {
  const out = [[]];
  for (const w of words) {
    if (SEPARATORS.has(w)) out.push([]);
    else out[out.length - 1].push(w);
  }
  return out.filter((s) => s.length > 0);
}

/**
 * Read `--flag value` and `--flag=value` from a word list.
 *
 * @param {string[]} words - One command's words.
 * @param {string} flag - The flag name without dashes.
 * @returns {string|undefined} The value, or undefined when absent.
 */
function flagValue(words, flag) {
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === `--${flag}`) return words[i + 1];
    if (w.startsWith(`--${flag}=`)) return w.slice(flag.length + 3);
  }
  return undefined;
}

/**
 * Deny a commit call whose type, scope or subject breaks the convention.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when not a commit call, PASS when the call conforms
 *   or merely inspects, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  if (!COMMIT_CALL_RE.test(raw)) return NOOP;

  for (const words of wordSegments(shellWords(raw))) {
    const joined = words.join(" ");
    if (!COMMIT_CALL_RE.test(joined) || NON_COMMITTING_RE.test(joined)) continue;
    const problems = [
      checkType(flagValue(words, "type")),
      checkScope(flagValue(words, "scope")),
      checkSubject(flagValue(words, "message")),
    ].filter(Boolean);
    if (problems.length === 0) continue;
    return deny(
      "tab-guard",
      "Commit breaks the convention",
      `${problems.join("\n\n")}\n\n` +
        "The subject is always `type(scope): title` — imperative, lowercase, no trailing period, " +
        "one reason to revert:\n" +
        '  npm run commit -- --files <path...> --type <type> --scope <name> --message "..."',
    );
  }
  return PASS;
}

module.exports = { flagValue, id: "commit-convention", run, shellWords };
