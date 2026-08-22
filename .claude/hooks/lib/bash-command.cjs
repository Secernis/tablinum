"use strict";

/**
 * Shared parsing primitives for judging a Bash command payload.
 *
 * A gate that greps the raw command string is wrong in both directions: it
 * matches a forbidden word sitting inside a commit message (`git commit -m "no
 * --no-verify here"`), and it misses one hidden behind a wrapper (`env FOO=1 npx
 * ...`, `bash -c "git push --force"`). Both mistakes are expensive — the first
 * blocks legitimate work, the second is a gate that quietly does nothing.
 *
 * Two primitives fix that:
 *
 *   `commandSurface()` strips what is DATA (heredoc bodies, quoted message
 *   arguments) while opening up what is CODE (a quoted `-c` body), so the
 *   remaining text is the part a gate may reason about.
 *
 *   `effectiveCommandWord()` answers "what is actually being run here" by
 *   skipping env assignments and wrapper words (`sudo`, `env`, `npx`, `bash -c`)
 *   until it reaches the real command.
 */

/** Words that PRECEDE the real command and must be skipped to find it. */
const WRAPPER_WORDS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "exec",
  "nice",
  "time",
  "timeout",
  "xargs",
  "npx",
  "pnpx",
  "bunx",
  "bash",
  "sh",
  "zsh",
  "dash",
  "pwsh",
  "powershell",
]);

/**
 * Flags of a wrapper word that consume the following token as their value.
 *
 * The code-body flags (`-c`, `-e`, `--command`, `--eval`) are deliberately NOT
 * here. They do take a value, but `commandSurface` has already unquoted that
 * value into the surface — so by the time this function runs, the body is inline
 * text in command position, and skipping "the next token" skips the actual
 * command word. That was live: `bash -c "cat .env"` resolved its command word to
 * `.env`, so the reader check never matched and the secret-read gate passed it.
 */
const WRAPPER_VALUE_FLAGS = new Set(["-u", "-i", "-C", "--user", "--chdir"]);

/** Interpreter flags whose quoted argument is CODE rather than data. */
const CODE_BODY_FLAG_RE = /(-{1,2}(?:c|e|lc|command|eval))(\s+)(['"])([\s\S]*?)\3/g;

/**
 * Marker standing in for a lifted code body during the data-quote pass.
 *
 * A control character, because it must be something that cannot occur in a real
 * command line — a printable sentinel could be typed by the caller and would
 * then let a crafted argument address the restore step.
 */
const BODY_MARK = "";

/**
 * Reduce a raw Bash command to the surface a gate may reason about.
 *
 * What is removed: heredoc bodies (`<<EOF ... EOF`) and single/double-quoted
 * runs that are DATA. What is kept: the quoted body of an interpreter flag
 * (`-c`, `-e`), because that body IS code and hiding a gated call inside it is
 * the obvious bypass.
 *
 * The two happen in that order and must not interfere, which is what the
 * placeholder pass below is for: an opened code body carries its own quotes
 * (`readFileSync('.env')`), and running the data-quote strip over it afterwards
 * ate exactly the string literal the gate was looking for. Live effect: the
 * surface read `readFileSync( QUOTED )` and the `.env` argument had vanished, so
 * the interpreter branch of `secret-read` could never fire. The bodies are
 * therefore lifted out, the data pass runs on what remains, and the bodies are
 * put back verbatim.
 *
 * @param {string} command - The raw `tool_input.command`.
 * @param {{joinCodeBody?: boolean}} [opts] - When `joinCodeBody` is set, the
 *   statement separators INSIDE an opened code body (newline, `;`, `&&`) are
 *   neutralised to spaces. A caller that splits on shell separators needs this,
 *   because those separators belong to the embedded language, not to the shell —
 *   without it a multi-line `-e` body is torn into fragments and a primitive and
 *   its own argument land in different segments.
 * @returns {string} The command surface.
 */
function commandSurface(command, opts = {}) {
  // The marker is synthesised here, so a caller that literally sends one cannot
  // point the restore step at a body it did not supply.
  let text = String(command || "").split(BODY_MARK).join(" ");

  // Heredoc bodies are pure data — a `git commit -F- <<'EOF' ... EOF` message
  // must not be searched for gated words.
  text = text.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, " <<HEREDOC ");

  // Lift interpreter bodies out before the data-quote pass, keyed by index so
  // they can be restored exactly.
  const bodies = [];
  text = text.replace(CODE_BODY_FLAG_RE, (_m, flag, space, _q, body) => {
    const inner = opts.joinCodeBody ? body.replace(/\r?\n|;|&&|\|\|/g, " ") : body;
    bodies.push(inner);
    return `${flag}${space}${BODY_MARK}${bodies.length - 1}${BODY_MARK}`;
  });

  // Everything else in quotes is data (commit messages, grep patterns, JSON
  // payloads). Replaced by a placeholder rather than deleted, so token
  // boundaries survive: `-m""` must not fuse into the next word.
  text = text.replace(/"(?:[^"\\]|\\.)*"/g, " QUOTED ");
  text = text.replace(/'(?:[^'\\]|\\.)*'/g, " QUOTED ");

  return text.replace(
    new RegExp(`${BODY_MARK}(\\d+)${BODY_MARK}`, "g"),
    (_m, i) => bodies[Number(i)],
  );
}

/**
 * The command word a segment actually runs, skipping env assignments and
 * wrapper words.
 *
 * `FOO=1 sudo -u me npx tsx script.ts` answers `tsx` — which is what a gate
 * keyed on the tool name needs, and what a naive `split(" ")[0]` never gives.
 *
 * @param {string} segment - One command segment (quotes already handled).
 * @returns {string} The effective command word, or `""` for an empty segment.
 */
function effectiveCommandWord(segment) {
  const words = String(segment || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    // `FOO=bar cmd` — an assignment prefix, not the command.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (WRAPPER_VALUE_FLAGS.has(w)) {
      i += 1;
      continue;
    }
    // A wrapper's own flags (`--login`, and `-c` once its body was opened) are
    // skipped; the value-taking ones were handled above.
    if (w.startsWith("-")) continue;
    const bare = w.replace(/\\/g, "/").split("/").pop() || w;
    // `.exe`/`.cmd` suffixes are Windows noise around the same tool name.
    const name = bare.replace(/\.(exe|cmd|bat|ps1)$/i, "");
    if (WRAPPER_WORDS.has(name)) continue;
    return name;
  }
  return "";
}

/**
 * Split a command surface into segments at real shell boundaries.
 *
 * Parentheses split too: a call inside `$(...)` or a subshell must be seen in
 * COMMAND position rather than as a flag substring of its host.
 *
 * @param {string} surface - Output of {@link commandSurface}.
 * @returns {string[]} Non-empty, trimmed segments.
 */
function segments(surface) {
  return String(surface || "")
    .split(/[|;&\n()`]|\$\(/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  WRAPPER_WORDS,
  commandSurface,
  effectiveCommandWord,
  segments,
};
