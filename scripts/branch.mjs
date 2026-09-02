#!/usr/bin/env node
/**
 * Branch — open, list, switch and retire feature branches.
 *
 *   npm run branch -- <name>            open a branch and move onto it
 *   npm run branch -- --list            what exists, and how far each has drifted
 *   npm run branch -- --switch <name>
 *   npm run branch -- --delete <name>   only when it is merged
 *   npm run branch -- --clean           delete every merged branch
 *
 * The name is normalised rather than accepted verbatim: git allows branch names
 * that break tooling downstream (spaces, uppercase on a case-insensitive
 * filesystem, a trailing dot), and a name that has to be quoted forever is a
 * small tax paid on every later command.
 *
 * Deleting is deliberately asymmetric. A merged branch is deleted without
 * ceremony — its commits are in `main`, so nothing is lost. An unmerged one is
 * refused and the commits it would take with it are listed, because that is the
 * one deletion nobody can undo from memory.
 */

import { createRequire } from "node:module";
import {
  ExitCode,
  currentBranch,
  fail,
  git,
  gitRead,
  info,
  ok,
  parseArgs,
  status,
  step,
  style,
  warn,
} from "./lib/shell.mjs";

const SPEC = {
  clean: "boolean",
  delete: "string",
  help: "boolean",
  list: "boolean",
  switch: "string",
};

const require = createRequire(import.meta.url);
const { BRANCH_PREFIXES: KNOWN_PREFIXES, normalizeBranchName } = require("./lib/git-conventions.cjs");

const HELP = `
${style.bold("npm run branch")} — feature branches

  npm run branch -- <name>          open and switch to it
  npm run branch -- --list          what exists, ahead/behind main
  npm run branch -- --switch <name>
  npm run branch -- --delete <name> only when merged
  npm run branch -- --clean         delete every merged branch

Names are normalised to \`<prefix>/<kebab-case>\`:
  ${style.dim("Add SSH support")}  →  ${style.green("feat/add-ssh-support")}
Known prefixes: ${KNOWN_PREFIXES.join(", ")}
`;

/**
 * Normalise a branch name into `<prefix>/<kebab-case>`, or refuse.
 *
 * The convention lives in `scripts/lib/git-conventions.cjs`, shared with the
 * `branch-convention` hook so the two cannot drift.
 *
 * @param {string} raw - What the caller typed.
 * @returns {string} The normalised name.
 */
function normalizeName(raw) {
  const { name, reason } = normalizeBranchName(raw);
  if (!name) fail(reason, ExitCode.USAGE);
  return name;
}

/**
 * Every local branch with its drift against main.
 *
 * @returns {Array<{name: string, ahead: number, behind: number, merged: boolean, last: string}>} Branches.
 */
function listBranches() {
  const names = gitRead(["branch", "--format=%(refname:short)"]).stdout.split("\n").filter(Boolean);
  const merged = new Set(
    gitRead(["branch", "--format=%(refname:short)", "--merged", "main"]).stdout
      .split("\n")
      .filter(Boolean),
  );
  return names.map((name) => {
    const counts = gitRead(["rev-list", "--left-right", "--count", `main...${name}`]);
    const [behind, ahead] = counts.ok ? counts.stdout.split(/\s+/).map(Number) : [0, 0];
    const last = gitRead(["log", "-1", "--format=%cr", name]).stdout;
    return { ahead: ahead || 0, behind: behind || 0, last, merged: merged.has(name), name };
  });
}

/**
 * Print the branch list.
 *
 * @returns {void}
 */
function runList() {
  const current = currentBranch();
  const branches = listBranches();
  step("branches");
  for (const b of branches) {
    const marker = b.name === current ? style.green("*") : " ";
    const state = b.name === "main" ? "" : b.merged ? style.dim("merged") : style.yellow("open");
    process.stdout.write(
      `  ${marker} ${b.name.padEnd(34)} ${String(`+${b.ahead}/-${b.behind}`).padEnd(10)} ` +
        `${style.dim(b.last.padEnd(18))} ${state}\n`,
    );
  }
  const open = branches.filter((b) => !b.merged && b.name !== "main");
  if (open.length > 1) {
    process.stdout.write("\n");
    warn(
      `${open.length} branches are open at once. Each one needs rebasing against a moving main ` +
        "and its own decision about whether it is still wanted — that is what makes them go stale.",
    );
  }
}

/**
 * Delete one branch, refusing to lose unmerged commits.
 *
 * @param {string} name - Branch to delete.
 * @returns {void}
 */
function runDelete(name) {
  if (name === "main" || name === "master") fail("the default branch is not deletable.");
  if (name === currentBranch()) {
    fail(`'${name}' is checked out. Switch away first: \`npm run branch -- --switch main\`.`);
  }
  const branches = listBranches();
  const target = branches.find((b) => b.name === name);
  if (!target) fail(`no local branch '${name}'. \`npm run branch -- --list\` shows what exists.`);

  if (!target.merged) {
    const commits = gitRead(["log", "--oneline", `main..${name}`]).stdout.split("\n").filter(Boolean);
    fail(
      `'${name}' holds ${commits.length} commit(s) that main does not:\n` +
        `${commits.slice(0, 10).map((c) => `  ${c}`).join("\n")}\n\n` +
        "Deleting it now loses them, and nothing else has a copy. Merge it, push it, or — if it " +
        "is genuinely being abandoned — delete it yourself with `git branch -D`, having read " +
        "that list.",
    );
  }

  const res = git(["branch", "-d", name]);
  if (!res.ok) fail(`could not delete '${name}':\n${res.stderr}`);
  ok(`deleted ${name}`);
}

/**
 * Entry point.
 *
 * @returns {void}
 */
function main() {
  const args = parseArgs(process.argv.slice(2), SPEC);
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (currentBranch() === null) fail("not a git repository.");

  if (args.list) {
    runList();
    return;
  }
  if (args.delete) {
    runDelete(args.delete);
    return;
  }
  if (args.clean) {
    const merged = listBranches().filter(
      (b) => b.merged && b.name !== "main" && b.name !== currentBranch(),
    );
    step("clean");
    if (merged.length === 0) {
      info("no merged branches to remove.");
      return;
    }
    for (const b of merged) runDelete(b.name);
    return;
  }
  if (args.switch) {
    const res = git(["switch", args.switch]);
    if (!res.ok) fail(`could not switch to '${args.switch}':\n${res.stderr}`);
    ok(`on ${args.switch}`);
    return;
  }

  const raw = args._[0];
  if (!raw) {
    process.stdout.write(`${HELP}\n`);
    fail("name the branch, or pass --list.", ExitCode.USAGE);
  }
  const name = normalizeName(raw);

  const exists = gitRead(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).ok;
  if (exists) {
    warn(`'${name}' already exists — switching to it instead of creating it.`);
    const res = git(["switch", name]);
    if (!res.ok) fail(`could not switch:\n${res.stderr}`);
    ok(`on ${name}`);
    return;
  }

  step("branch");
  if (name !== raw) info(`${style.dim(raw)} → ${style.green(name)}`);
  const dirty = status();
  if (dirty.length > 0) {
    info(
      `${dirty.length} uncommitted file(s) will come along — that is usually what you want when ` +
        "opening a branch for work already started.",
    );
  }

  const res = git(["switch", "-c", name]);
  if (!res.ok) fail(`could not create '${name}':\n${res.stderr}`);
  ok(`on ${name}`);
  info(style.dim("Next: `npm run commit -- --inspect` when the first piece is done."));
}

main();
