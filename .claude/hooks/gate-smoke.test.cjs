"use strict";

/**
 * End-to-end suite for the PreToolUse gates.
 *
 * Every other test in a system like this checks a rule in isolation, which is
 * the easy half. What actually decides whether a gate works is the whole chain:
 * the payload shape the harness sends, the order of the registry, the
 * short-circuit, and the parsing that happens before any rule sees the input.
 * Two live bypasses in `secret-read` — `bash -c "cat .env"` and
 * `node -e "readFileSync('.env')"` — were both invisible to the rule's own logic
 * and obvious the first time this table ran.
 *
 * Run it after touching anything under `.claude/hooks/`:
 *
 *   node .claude/hooks/gate-smoke.test.cjs
 *
 * `npm run verify -- --all` runs it too, so `push` and `release` cannot ship a
 * gate layer that stopped gating.
 *
 * Named `.test.cjs` rather than `.cjs` because it has to CONTAIN the things the
 * gates refuse — a token-shaped string, an untagged marker, a German comment.
 * That suffix is the fixture exemption `secret-write` and the language detector
 * carry, and using it is the intended answer; obfuscating a fixture until the
 * pattern stops matching would defeat the gate and the test together.
 *
 * The bidi fixture is the exception, and it is built with `fromCharCode` rather
 * than written out. Not to evade the gate: `unicode-safety` has no fixture
 * exemption, deliberately, because an invisible character is exactly as
 * dangerous in a test file as anywhere else and a reviewer cannot see it in
 * either. Constructing it names what it is, in readable source. (Writing the
 * literal here was refused by the gate under test, which is the shortest
 * available demonstration that it works.)
 *
 * A file rather than a `node -e` one-liner for the neighbouring reason: the
 * surface opener unquotes interpreter bodies by design, so a fixture string
 * holding a gated command reads as a real hidden command and the bash gate
 * blocks the very check meant to exercise it.
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

/** Repo root, derived from this file's location so the suite is portable. */
const CWD = path.resolve(__dirname, "..", "..").replace(/\\/g, "/");

/** A token-shaped literal, assembled so it is unmistakably not a real one. */
const FAKE_TOKEN = `ghp_${"a".repeat(36)}`;

/** U+202E RIGHT-TO-LEFT OVERRIDE, constructed — see the file docblock. */
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

/** A German comment, for the language detector. */
const GERMAN_COMMENT =
  "// Das ist ein Kommentar, der nicht in den Code gehoert und dort auch nicht bleiben soll";

/** `[name, payload, shouldBlock]`. */
const CASES = [
  ["secret in source", { tool_input: { content: `const k = "${FAKE_TOKEN}";`, file_path: `${CWD}/src/x.ts` }, tool_name: "Write" }, true],
  ["read .env", { tool_input: { command: "cat .env" }, tool_name: "Bash" }, true],
  ["read .env.example", { tool_input: { command: "cat .env.example" }, tool_name: "Bash" }, false],
  ["reader hidden in bash -c", { tool_input: { command: 'bash -c "cat .env"' }, tool_name: "Bash" }, true],
  ["reader hidden in $( )", { tool_input: { command: "X=$(grep KEY .env)" }, tool_name: "Bash" }, true],
  ["node -e readFileSync", { tool_input: { command: `node -e "readFileSync('.env')"` }, tool_name: "Bash" }, true],
  ["python open .env", { tool_input: { command: `python -c "open('.env').read()"` }, tool_name: "Bash" }, true],
  ["cp .env.example .env", { tool_input: { command: "cp .env.example .env" }, tool_name: "Bash" }, false],
  ["Read tool on .env", { tool_input: { file_path: `${CWD}/.env` }, tool_name: "Read" }, true],
  ["raw git commit", { tool_input: { command: 'git commit -m "x"' }, tool_name: "Bash" }, true],
  ["git status", { tool_input: { command: "git status --porcelain" }, tool_name: "Bash" }, false],
  ["--no-verify", { tool_input: { command: "git push --no-verify" }, tool_name: "Bash" }, true],
  ["git reset --hard", { tool_input: { command: "git reset --hard HEAD~1" }, tool_name: "Bash" }, true],
  ["rm -rf", { tool_input: { command: "rm -rf src/" }, tool_name: "Bash" }, true],
  ["edit dist/", { tool_input: { content: "x", file_path: `${CWD}/dist/index.js` }, tool_name: "Write" }, true],
  ["edit Cargo.lock", { tool_input: { file_path: `${CWD}/src-tauri/Cargo.lock`, new_string: "b", old_string: "a" }, tool_name: "Edit" }, true],
  ["bidi control char", { tool_input: { content: `const a = 1; // ${BIDI_OVERRIDE} evil`, file_path: `${CWD}/src/y.ts` }, tool_name: "Write" }, true],
  ["console.log in src", { tool_input: { content: 'console.log("hi");', file_path: `${CWD}/src/z.tsx` }, tool_name: "Write" }, true],
  ["logWarn in src", { tool_input: { content: 'logWarn("a.b", {});', file_path: `${CWD}/src/z.tsx` }, tool_name: "Write" }, false],
  ["println! in rust", { tool_input: { content: 'println!("hi");', file_path: `${CWD}/src-tauri/src/x.rs` }, tool_name: "Write" }, true],
  ["lucide import", { tool_input: { content: 'import { X } from "lucide-react";', file_path: `${CWD}/src/c.tsx` }, tool_name: "Write" }, true],
  ["mock data", { tool_input: { content: "const mockRepos = [];", file_path: `${CWD}/src/c.tsx` }, tool_name: "Write" }, true],
  ["logic in index.ts", { tool_input: { content: "export function doIt() { return 1; }", file_path: `${CWD}/src/lib/index.ts` }, tool_name: "Write" }, true],
  ["re-export in index.ts", { tool_input: { content: 'export * from "./log";', file_path: `${CWD}/src/lib/index.ts` }, tool_name: "Write" }, false],
  ["bare @ts-ignore", { tool_input: { content: "// @ts-ignore\nconst a = 1;", file_path: `${CWD}/src/c.tsx` }, tool_name: "Write" }, true],
  ["justified suppression", { tool_input: { content: "// Upstream types model this as any; narrowing belongs to the caller.\n// @ts-expect-error\nconst a = 1;", file_path: `${CWD}/src/c.tsx` }, tool_name: "Write" }, false],
  ["tsconfig strict:false", { tool_input: { file_path: `${CWD}/tsconfig.json`, new_string: '"strict": false', old_string: '"strict": true' }, tool_name: "Edit" }, true],
  ["tauri csp null", { tool_input: { file_path: `${CWD}/src-tauri/tauri.conf.json`, new_string: '"csp": null', old_string: '"csp": "x"' }, tool_name: "Edit" }, true],
  ["shell:allow-execute", { tool_input: { file_path: `${CWD}/src-tauri/capabilities/default.json`, new_string: '"core:default",\n    "shell:allow-execute"', old_string: '"core:default"' }, tool_name: "Edit" }, true],
  ["wildcard scope", { tool_input: { file_path: `${CWD}/src-tauri/capabilities/default.json`, new_string: '"core:default",\n    "**"', old_string: '"core:default"' }, tool_name: "Edit" }, true],
  ["dangerouslySetInnerHTML", { tool_input: { content: "<div dangerouslySetInnerHTML={{__html: msg}} />", file_path: `${CWD}/src/c.tsx` }, tool_name: "Write" }, true],
  ["catch returns true", { tool_input: { content: "try { x(); } catch { return true; }", file_path: `${CWD}/src/c.ts` }, tool_name: "Write" }, true],
  ["unwrap_or(true)", { tool_input: { content: "check(p).unwrap_or(true)", file_path: `${CWD}/src-tauri/src/g.rs` }, tool_name: "Write" }, true],
  ["remove Stop hook", { tool_input: { file_path: `${CWD}/.claude/settings.json`, new_string: '"PreToolUse": []', old_string: '"Stop": [], "PreToolUse": []' }, tool_name: "Edit" }, true],
  ["hand-written version heading", { tool_input: { file_path: `${CWD}/CHANGELOG.md`, new_string: "## [Unreleased]\n\n## [9.9.9] - 2026-01-01", old_string: "## [Unreleased]" }, tool_name: "Edit" }, true],
  ["ordinary changelog entry", { tool_input: { file_path: `${CWD}/CHANGELOG.md`, new_string: "### Added\n- something", old_string: "### Added" }, tool_name: "Edit" }, false],
  ["untagged TODO", { tool_input: { content: "// TODO fix this later", file_path: `${CWD}/src/c.ts` }, tool_name: "Write" }, true],
  ["tagged TODO", { tool_input: { content: "// TODO(bug): the parser drops CRLF; tracked", file_path: `${CWD}/src/c.ts` }, tool_name: "Write" }, false],
  ["German comment", { tool_input: { content: GERMAN_COMMENT, file_path: `${CWD}/src/c.ts` }, tool_name: "Write" }, true],
  ["English comment", { tool_input: { content: "// The parser drops CRLF because git normalises it on the way out.", file_path: `${CWD}/src/c.ts` }, tool_name: "Write" }, false],
];

let pass = 0;
const failures = [];
for (const [name, payload, shouldBlock] of CASES) {
  const res = spawnSync("node", [path.join(__dirname, "tab-pretooluse.cjs")], {
    cwd: CWD,
    encoding: "utf8",
    input: JSON.stringify({
      ...payload,
      hook_event_name: "PreToolUse",
      // A fixed id keeps the once-per-session hint rules quiet after their first
      // dispatch, so their envelope cannot be mistaken for a verdict.
      session_id: "gate-smoke",
      workspace: { current_dir: CWD },
    }),
  });
  const blocked = res.status === 2;
  const good = blocked === shouldBlock;
  if (good) pass += 1;
  else failures.push([name, shouldBlock, (res.stderr || "").split("\n")[0]]);
  process.stdout.write(
    `${good ? "PASS" : "FAIL"}  ${(blocked ? "BLOCK" : "allow").padEnd(6)} ${name}\n`,
  );
}

process.stdout.write(`\n${pass}/${CASES.length} passed\n`);
for (const [name, shouldBlock, line] of failures) {
  process.stdout.write(`  ${name}: expected ${shouldBlock ? "BLOCK" : "allow"} — ${line}\n`);
}
process.exit(failures.length === 0 ? 0 : 1);
