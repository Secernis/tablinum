"use strict";

/**
 * Self-checking cases for the UI-string detector.
 *
 *   node scripts/lib/ui-lang.test.cjs
 *
 * Run by `npm run verify -- --all` next to the gate suite. Named `.test.cjs`
 * because it has to contain the German it detects.
 */

const assert = require("node:assert/strict");

const { findGermanString, isUiFile } = require("./ui-lang.cjs");

/** `[name, rel, source, shouldFlag]` */
const CASES = [
  ["English JSX text", "src/ui/x.tsx", "<p>Open a repository</p>", false],
  ["German JSX text", "src/ui/x.tsx", "<p>Bitte wähle ein Repository aus der Liste</p>", true],
  ["German string literal", "src/ui/x.tsx", 'const t = "Der Ordner ist kein Repository";', true],
  ["German template literal", "src/ui/x.ts", "const t = `${n} Ordner wurden nicht gefunden, und das ist alles`;", true],
  ["German placeholder attribute", "src/ui/x.tsx", '<input placeholder="Pfad zum Ordner oder Repository" />', true],
  ["class list is not prose", "src/ui/x.tsx", '<div className="flex items-center border-line text-muted" />', false],
  ["event key is not prose", "src/app/x.ts", 'logWarn("repository.open.failed", { path });', false],
  ["single German stopword is not enough", "src/ui/x.tsx", "<p>Detached HEAD, nicht editable</p>", false],
  ["German inside a comment is the other gate's", "src/ui/x.tsx", "// Das ist ein Kommentar und kein String\nconst a = 1;", false],
  ["German in a JSX comment is the other gate's", "src/ui/x.tsx", "<div>{/* Das ist ein Kommentar und kein Text */}</div>", false],
  ["URL inside a string survives stripping", "src/ui/x.ts", 'const u = "https://example.test/pfad"; const s = "Und das ist der Text";', true],
  ["a story is exempt", "src/ui/x.stories.tsx", "<p>Das ist eine Geschichte für die Story</p>", false],
  ["a test is exempt", "src/ui/x.test.tsx", "<p>Das ist ein Test und bleibt deutsch</p>", false],
  ["vendored tailgrids is exempt", "src/components/tailgrids/core/x.tsx", "<p>Das ist nicht unser Text</p>", false],
  ["rust is out of scope", "src-tauri/src/x.rs", 'let s = "Das ist ein Rust-String und egal";', false],
];

let pass = 0;
const failures = [];
for (const [name, rel, source, shouldFlag] of CASES) {
  const hit = findGermanString(source, rel);
  const flagged = hit !== null;
  if (flagged === shouldFlag) pass += 1;
  else failures.push(`${name}: expected ${shouldFlag ? "flag" : "clean"}${hit ? ` — matched ${hit.words.join(", ")}` : ""}`);
}

assert.equal(isUiFile("src/ui/x.tsx"), true);
assert.equal(isUiFile("src/lib/brand/Logo.tsx"), false);
assert.equal(isUiFile("scripts/lib/ui-lang.cjs"), false);

process.stdout.write(`[ui-lang.test] ${pass}/${CASES.length} cases passed.\n`);
for (const f of failures) process.stdout.write(`  ${f}\n`);
process.exit(failures.length === 0 ? 0 : 1);
