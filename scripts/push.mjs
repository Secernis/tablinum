#!/usr/bin/env node
/**
 * Push — verify, then push.
 *
 *   npm run push
 *   npm run push -- --yes           no prompts
 *   npm run push -- --force-gate    re-run the gate even with a stored verdict
 *   npm run push -- --skip-checks   emergency exit; runs nothing
 *
 * One checked mode. The verify gate — the same one the Stop hook runs — is what
 * every push gets, because the point at which code leaves this machine is the
 * last point at which a problem is still cheap. After that it is in someone
 * else's clone, someone else's CI, someone else's afternoon.
 *
 * The gate verdict is DURABLE: a green result is recorded against the commit sha
 * and reused within its TTL, so a push that fails in transport costs the push on
 * retry and not another full gate. Reuse is automatic rather than a `--resume`
 * flag — a flag you can forget re-introduces the cost it claims to remove. Its
 * price is that a dirty tree is refused rather than warned about: the stored
 * verdict describes the commit, and uncommitted changes are not in it.
 *
 * `--skip-checks` exists and is deliberately unpleasant to use. It prints what it
 * skipped, and the branch still has to survive whatever runs downstream.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ROOT,
  confirm,
  currentBranch,
  fail,
  git,
  gitRead,
  info,
  ok,
  parseArgs,
  run,
  status,
  step,
  style,
  warn,
} from "./lib/shell.mjs";

const SPEC = {
  "force-gate": "boolean",
  help: "boolean",
  "no-pr": "boolean",
  "skip-checks": "boolean",
  yes: "boolean",
};

/** How long a green verdict stays valid for the same commit. */
const VERDICT_TTL_MS = 4 * 60 * 60 * 1000;

/** Where verdicts are stored (gitignored, alongside the other hook state). */
const VERDICT_FILE = join(ROOT, ".claude", "hooks", "state", "push-verdict.json");

const HELP = `
${style.bold("npm run push")} — verify, then push

  npm run push                 verify gate → push → offer a pull request
  npm run push -- --no-pr      suppress the pull-request offer
  npm run push -- --yes        no prompts
  npm run push -- --force-gate re-run the gate even with a stored verdict
  npm run push -- --skip-checks  emergency exit; runs nothing

A green verdict is stored against the commit sha for ${VERDICT_TTL_MS / 3_600_000}h, so a retry
after a transport failure does not pay for the gate twice.
`;

/**
 * Read the stored verdict for a commit, if it is still valid.
 *
 * @param {string} sha - Commit sha.
 * @returns {boolean} True when a fresh green verdict exists.
 */
function storedVerdict(sha) {
  try {
    const data = JSON.parse(readFileSync(VERDICT_FILE, "utf8"));
    return data.sha === sha && data.green === true && Date.now() - data.at < VERDICT_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Record a green verdict against a commit.
 *
 * @param {string} sha - Commit sha.
 * @returns {void}
 */
function storeVerdict(sha) {
  try {
    mkdirSync(dirname(VERDICT_FILE), { recursive: true });
    writeFileSync(VERDICT_FILE, JSON.stringify({ at: Date.now(), green: true, sha }), "utf8");
  } catch {
    // A verdict that cannot be stored costs one extra gate run, nothing more.
  }
}

/**
 * Offer to open a pull request, when `gh` is available.
 *
 * @param {string} branch - The branch that was pushed.
 * @param {boolean} nonInteractive - Whether prompts are suppressed.
 * @returns {Promise<void>} Resolves when handled.
 */
async function offerPullRequest(branch, nonInteractive) {
  const hasGh = run("gh", ["--version"]).ok;
  if (!hasGh) return;
  const existing = run("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"]);
  if (existing.ok && existing.stdout) {
    info(`pull request: ${existing.stdout}`);
    return;
  }
  step("pull request");
  if (nonInteractive) {
    info(`none open for '${branch}'. Open one with: ${style.dim(`gh pr create --fill --draft`)}`);
    return;
  }
  if (!(await confirm("open a draft pull request?"))) {
    info("skipped.");
    return;
  }
  const res = run("gh", ["pr", "create", "--fill", "--draft"], { stdio: "inherit" });
  if (!res.ok) warn("gh pr create failed — open it in the web UI instead.");
}

/**
 * Entry point.
 *
 * @returns {Promise<void>} Resolves when the push completes.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2), SPEC);
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const branch = currentBranch();
  if (branch === null) fail("not a git repository.");
  if (branch === "main" || branch === "master") {
    fail(
      `you are on '${branch}'. Push from a feature branch and merge through a pull request — ` +
        "a direct push to the default branch has no reviewable boundary.",
    );
  }

  const dirty = status();
  if (dirty.length > 0) {
    fail(
      `${dirty.length} uncommitted file(s) in the tree:\n` +
        `${dirty.slice(0, 10).map((d) => `  ${d.path}`).join("\n")}\n\n` +
        "The gate verdict describes a COMMIT, and these changes are not in one — so a green " +
        "result here would be a statement about something other than what gets pushed.\n" +
        "Commit them (`npm run commit -- --inspect`) or stash them.",
    );
  }

  const ahead = gitRead(["rev-list", "--count", `@{upstream}..HEAD`]);
  const hasUpstream = ahead.ok;
  if (hasUpstream && Number(ahead.stdout) === 0) {
    step("push");
    ok("nothing to push — the remote already has this branch.");
    return;
  }

  const sha = gitRead(["rev-parse", "HEAD"]).stdout;

  if (args["skip-checks"]) {
    step("verify");
    warn(
      "SKIPPED. Nothing was checked: not the types, not the secrets scan, not the changelog " +
        "schema, not Rust. Whatever runs downstream still judges this branch.",
    );
  } else if (!args["force-gate"] && storedVerdict(sha)) {
    step("verify");
    ok(`reusing the green verdict for ${sha.slice(0, 7)} (within ${VERDICT_TTL_MS / 3_600_000}h)`);
  } else {
    step("verify");
    info("running the full gate...");
    const res = run("node", ["scripts/verify.mjs", "--all"], { stdio: "inherit" });
    if (!res.ok) {
      fail(
        "the verify gate failed — nothing was pushed.\n\n" +
          "This is the last cheap moment: after a push the problem is in someone else's clone " +
          "and someone else's CI. Fix the findings above, or `--skip-checks` if this is genuinely " +
          "an emergency and you intend to answer for it.",
      );
    }
    storeVerdict(sha);
    ok("green");
  }

  step("push");
  const pushArgs = hasUpstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
  const res = git(pushArgs, { stdio: "inherit" });
  if (!res.ok) {
    fail(
      "git push failed. The verdict is stored, so a retry will not re-run the gate.\n" +
        "If the remote moved on, rebase onto it first — never force-push over someone else's work.",
    );
  }
  ok(`pushed ${branch}`);

  if (!args["no-pr"]) await offerPullRequest(branch, Boolean(args.yes));
}

await main();
