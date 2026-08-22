#!/usr/bin/env node
/**
 * Prepare a release: build the mark, distribute it, set the version, tag, push.
 *
 *   node scripts/release.mjs 0.3.0            # preview, changes nothing
 *   node scripts/release.mjs 0.3.0 --run      # commits and tags locally
 *   node scripts/release.mjs 0.3.0 --run --push
 *
 * WHY THE ASSETS ARE BUILT HERE AND NOT IN CI:
 * `design/` is not in the repository — it holds the brand authoring environment
 * and stays private. CI would have neither the generator nor fontTools nor the
 * rasteriser, so it could not produce the logo. Hence: generate locally, commit
 * the result. Everything the app needs is versioned inside the app tree
 * (src/lib/brand, public/, src-tauri/icons) — a clone builds without Python and
 * without design/.
 *
 * WITHOUT design/ this script deliberately refuses to run: the source of the
 * assets would be missing, and a release cut from a clone would ship a stale
 * mark without anyone noticing.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const RUN = args.includes("--run");
const PUSH = args.includes("--push");

if (!version) {
  console.error("Usage: node scripts/release.mjs <version> [--run] [--push]\n" +
    "  Without --run nothing happens; it only shows what would be done.");
  process.exit(1);
}

const sh = (cmd, opts = {}) =>
  execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe", ...opts }).trim();

function step(label, fn) {
  process.stdout.write(`  ${label} ... `);
  try {
    const out = fn();
    console.log(out || "ok");
  } catch (e) {
    console.log("FAILED");
    console.error("\n" + (e.stdout || e.message || e));
    process.exit(1);
  }
}

console.log(`\nTablinum ${version}${RUN ? "" : "  (preview - nothing is changed)"}\n`);

// --- Preconditions --------------------------------------------------------
if (!existsSync(join(ROOT, "design"))) {
  console.error("design/ is missing. That directory is intentionally not in the repo -\n" +
    "a release has to run from the machine that holds the brand source.\n" +
    "Otherwise a stale mark would ship without anyone noticing.");
  process.exit(1);
}
try {
  sh("git rev-parse --git-dir");
} catch {
  console.error("Not a Git repository. Run `git init` and add a remote first.");
  process.exit(1);
}

const dirtyBefore = sh("git status --porcelain");
if (dirtyBefore && !RUN) {
  console.log("  Note: there are already uncommitted changes.\n");
}

// --- Build and distribute the mark ----------------------------------------
console.log("Mark");
step("build-all.py", () => {
  const out = sh("python design/build-all.py");
  return out.includes("PASS") ? "all gates PASS" : "done";
});
step("distribute.mjs", () => sh("node design/scripts/distribute.mjs").split("\n")[0]);
step("small-icons.mjs", () => sh("node design/scripts/small-icons.mjs").split("\n")[0]);

// --- Version in all three places ------------------------------------------
// Tauri reads the version from tauri.conf.json, Cargo from Cargo.toml, npm from
// package.json. If they drift apart the app reports a different version than the
// tag — and nobody notices, because each file looks consistent on its own.
console.log("\nVersion");
const files = [
  ["package.json", (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)],
  ["src-tauri/tauri.conf.json", (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)],
  ["src-tauri/Cargo.toml", (s) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)],
];
for (const [rel, fn] of files) {
  step(rel, () => {
    const p = join(ROOT, rel);
    const before = readFileSync(p, "utf8");
    const after = fn(before);
    if (before === after) return "unchanged";
    if (RUN) writeFileSync(p, after);
    return `-> ${version}`;
  });
}

// --- What changed ---------------------------------------------------------
console.log("\nChanges");
const changed = sh("git status --porcelain").split("\n").filter(Boolean);
if (!changed.length) {
  console.log("  none - assets and version are already up to date");
} else {
  for (const line of changed.slice(0, 20)) console.log("   " + line);
  if (changed.length > 20) console.log(`   ... and ${changed.length - 20} more`);
}

// --- Commit, tag, push ----------------------------------------------------
console.log("\nGit");
if (!RUN) {
  console.log("  would: git add -A");
  console.log(`  would: git commit -m "release: ${version}"`);
  console.log(`  would: git tag -a v${version} -m "Tablinum ${version}"`);
  console.log(PUSH ? "  would: git push && git push --tags" : "  (--push not given)");
  console.log("\nRun again with --run to apply.\n");
  process.exit(0);
}

step("commit", () => {
  if (!changed.length) return "nothing to commit";
  sh("git add -A");
  sh(`git commit -m "release: ${version}"`);
  return "created";
});
step("tag", () => {
  const tags = sh("git tag --list").split("\n");
  if (tags.includes(`v${version}`)) return `v${version} already exists`;
  sh(`git tag -a v${version} -m "Tablinum ${version}"`);
  return `v${version}`;
});

if (PUSH) {
  step("push", () => {
    sh("git push");
    sh("git push --tags");
    return "commits and tags pushed";
  });
} else {
  console.log("\n  Not pushed. When everything looks right:  git push && git push --tags\n");
}
