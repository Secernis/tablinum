"use strict";

/**
 * PreToolUse rule — do not read `.env*` secret values into the transcript.
 *
 * The read complement to `secret-write`. That rule stops secrets being WRITTEN;
 * this one stops them being READ, which is the quieter half of the same problem:
 * a value that reaches the tool result is in the conversation, and from there it
 * is loggable, cacheable and forwardable without anyone deciding to forward it.
 *
 * Two surfaces, because one alone is trivially bypassed:
 *   - the `Read` tool with a `.env*` path;
 *   - `Bash` commands that READ `.env*` content (cat/grep/sed/source/`<`
 *     redirect, or an interpreter's own file-read primitive). Mere mentions
 *     without a read (cp/mv/rm/ls) stay free — they surface no content, and
 *     blocking `cp .env.example .env` would be friction without a gain.
 *
 * Template files (`.example`/`.sample`/`.template`/`.dist`) are exempt: they
 * carry placeholders by definition and exist to be read.
 *
 * The Bash half runs TWO passes over the same surface, because an interpreter
 * does not read a file through a command — it reads it through a library call in
 * its ARGUMENT (`node -e "readFileSync('.env')"`). Command position does not
 * help there: `node` IS the command. The passes need different segment
 * boundaries: pass 1 MUST split on parentheses so a reader inside `$(cat .env)`
 * stands in command position; pass 2 must NOT, because the eval body carries its
 * own parentheses legitimately — and its own newlines and semicolons, which is
 * why `joinCodeBody` neutralises them first.
 *
 * Deliberate limits: the process environment itself (`env`, `printenv`) is NOT
 * covered — this rule protects `.env` FILES, not environment dumps. And the
 * interpreter branch closes the two cheap spellings, not the genus: `node
 * script.js` that reads `.env` internally is invisible from outside. The
 * load-bearing layer stays the write prohibition.
 */

const path = require("node:path");

const { commandSurface, effectiveCommandWord } = require("../../lib/bash-command.cjs");
const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");

/** Template suffixes: meant to be read, placeholders only. */
const TEMPLATE_SUFFIX_RE = /\.(?:example|sample|template|dist)$/;

/** Fixtures and tests may carry fake-secret `.env` files. */
const EXEMPT_PATH_RE = /(?:^|\/)(?:__fixtures__|__tests__)\/|\.test\.|\.spec\./;

/**
 * Bash utilities that surface file content into the transcript. Matched in
 * COMMAND position, so a `--type` flag does not trip the `type` keyword.
 */
const BASH_READERS = new Set([
  "cat", "bat", "batcat", "head", "tail", "less", "more", "most", "nl", "od",
  "xxd", "hexdump", "strings", "grep", "egrep", "fgrep", "rg", "ag", "ack",
  "sed", "awk", "gawk", "cut", "paste", "tee", "jq", "yq", "dotenv", "source",
  ".", "Get-Content", "gc", "type",
]);

/**
 * Interpreters that execute code from their own argument. Deliberately WITHOUT
 * `bash`/`sh`/`pwsh`: those are wrapper words that `effectiveCommandWord` skips,
 * and their real readers already sit in BASH_READERS.
 */
const INTERPRETER_WORDS = new Set([
  "node", "nodejs", "bun", "deno", "tsx", "python", "python3", "py", "perl", "ruby",
]);

/** FS read primitives inside an eval body. Narrow on purpose. */
const FS_READ_PRIMITIVE_RE =
  /\breadFileSync\b|\breadFile\b|\bcreateReadStream\b|\bopen\s*\(|\bread_text\b|\bfile_get_contents\b/;

/** `.env` inside CODE: the path is a string literal, so quotes are token boundaries. */
const ENV_TOKEN_QUOTED_RE =
  /(?:^|[\s=<>|;&(,'"`])((?:[^\s<>|;&()"'`,]*\/)?\.env(?:\.[A-Za-z0-9_-]+)?)(?=$|[\s<>|;&),'"`])/g;

/** `< .env` — redirection read without a reader keyword. */
const BASH_REDIR_RE = /<\s*(?:[^\s<>|;&()]*\/)?\.env(?:\.[A-Za-z0-9_-]+)?\b/;

/** `.env` as a path token in a shell segment, with optional directory prefix. */
const ENV_TOKEN_RE =
  /(?:^|[\s=<>|;&(])((?:[^\s<>|;&()"']*\/)?\.env(?:\.[A-Za-z0-9_-]+)?)(?=$|[\s<>|;&)])/g;

/**
 * Whether a path's basename is a protected `.env*` file (not a template).
 *
 * @param {string} p - Absolute or relative path.
 * @returns {boolean} True if reading it would risk surfacing real secrets.
 */
function isProtectedEnv(p) {
  const base = String(p).replace(/\\/g, "/").split("/").pop() || "";
  if (!/^\.env(\.[A-Za-z0-9_-]+)?$/.test(base)) return false;
  return !TEMPLATE_SUFFIX_RE.test(base);
}

/**
 * Build the shared block message.
 *
 * @param {string} target - The offending path or command fragment.
 * @returns {number} Always BLOCK.
 */
function denyEnvRead(target) {
  return deny(
    "tab-guard",
    "Secret read blocked",
    `'${target}' is a .env file that may hold real secret values — reading it would put them ` +
      "into the transcript as plaintext, where they are loggable and cacheable.\n\n" +
      "Allowed: read the template (.env.example / .sample / .template), or ask the user for the " +
      "one value you actually need. If you need to know WHICH keys exist, read the template — " +
      "it lists them without their values.",
  );
}

/**
 * Whether a segment reads a file through a READER COMMAND (or a `<` redirect).
 *
 * @param {string} segment - One command segment.
 * @returns {boolean} True when the segment surfaces file content.
 */
function isReaderSegment(segment) {
  return BASH_READERS.has(effectiveCommandWord(segment)) || BASH_REDIR_RE.test(segment);
}

/**
 * Whether a segment reads a file through an INTERPRETER's library call.
 *
 * Both halves are required: the command word alone would flag every `node`
 * invocation, the primitive alone would flag any text mentioning `readFile`.
 *
 * @param {string} segment - One command segment.
 * @returns {boolean} True when the segment evaluates code that reads a file.
 */
function isInterpreterRead(segment) {
  return INTERPRETER_WORDS.has(effectiveCommandWord(segment)) && FS_READ_PRIMITIVE_RE.test(segment);
}

/**
 * Find the first protected `.env` token sitting in a read context.
 *
 * @param {string[]} segs - Command segments for this pass.
 * @param {(segment: string) => boolean} isReadContext - Read-context predicate.
 * @param {RegExp} tokenRe - Global `.env` token regex matching this pass's grammar.
 * @returns {string} The offending token, or `""` when the pass found nothing.
 */
function findEnvLeak(segs, isReadContext, tokenRe) {
  for (const seg of segs) {
    const trimmed = seg.trim();
    if (!trimmed || !isReadContext(trimmed)) continue;
    tokenRe.lastIndex = 0;
    let m = tokenRe.exec(trimmed);
    while (m !== null) {
      const tok = m[1];
      const rel = tok.replace(/\\/g, "/").replace(/^\.\//, "");
      if (isProtectedEnv(tok) && !EXEMPT_PATH_RE.test(rel)) return tok;
      m = tokenRe.exec(trimmed);
    }
  }
  return "";
}

/**
 * Deny reading real `.env*` secret values via the Read tool or a Bash command.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a read.
 */
function run(data) {
  const ti = data.tool_input || {};

  if (data.tool_name === "Read") {
    const abs = ti.file_path || "";
    if (!isProtectedEnv(abs)) return NOOP;
    const rel = path.relative(cwdOf(data), abs).replace(/\\/g, "/");
    if (EXEMPT_PATH_RE.test(rel)) return NOOP;
    return denyEnvRead(rel || abs);
  }

  if (data.tool_name === "Bash") {
    // Reduce to the command surface first: heredoc bodies and quoted DATA go
    // away, so a `.env` inside a commit message is not mistaken for a file
    // argument — while quoted CODE is opened up instead of deleted.
    const surface = commandSurface(ti.command || "");

    // Pass 1 — SHELL grammar. Parens MUST split here, so a reader inside `$(...)`
    // is seen in command position rather than as a flag substring.
    const readerHit = findEnvLeak(surface.split(/[|;&\n()`]|\$\(/), isReaderSegment, ENV_TOKEN_RE);
    if (readerHit) return denyEnvRead(readerHit);

    // Pass 2 — CODE grammar. Parens are kept OUT of the split (they belong to
    // `readFileSync('.env')`); the body's own separators were neutralised by
    // `joinCodeBody`, so this split only ever cuts at real shell boundaries.
    const evalSurface = commandSurface(ti.command || "", { joinCodeBody: true });
    const evalHit = findEnvLeak(
      evalSurface.split(/[|;&\n`]|\$\(/),
      isInterpreterRead,
      ENV_TOKEN_QUOTED_RE,
    );
    if (evalHit) return denyEnvRead(evalHit);

    return PASS;
  }

  return NOOP;
}

module.exports = { id: "secret-read", isProtectedEnv, run };
