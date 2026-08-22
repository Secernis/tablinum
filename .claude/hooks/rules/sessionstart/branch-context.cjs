"use strict";

/**
 * SessionStart rule — the git situation, stated as fact.
 *
 * A session that does not know which branch it is on, whether the tree is dirty,
 * or how far the branch has drifted from `main` will find all three out the
 * expensive way: by being blocked, by committing someone else's work, or by
 * rebasing something that was already pushed.
 *
 * Deliberately FACTS, not instructions. The context says what is true; the gates
 * say what is allowed. Mixing the two produces a session that argues with its own
 * hooks.
 *
 * Also sets the session title to the active branch — the one label that makes a
 * list of parallel sessions readable at a glance.
 */

const { gitRead } = require("../../lib/git-readonly.cjs");
const { cwdOf } = require("../../lib/io.cjs");

/**
 * Read the facts this rule reports, in as few spawns as possible.
 *
 * @param {string} cwd - Repo root.
 * @returns {object|null} The collected facts, or null when git cannot answer.
 */
function gitFacts(cwd) {
  const head = gitRead(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 });
  if (head.status !== 0) return null;
  const branch = head.stdout.trim();

  const status = gitRead(cwd, ["status", "--porcelain"], { timeout: 4000 });
  const dirty = status.status === 0 ? status.stdout.split("\n").filter(Boolean) : [];

  // Ahead/behind against main, when main exists and is not the current branch.
  let ahead = null;
  let behind = null;
  if (branch !== "main" && branch !== "HEAD") {
    const counts = gitRead(cwd, ["rev-list", "--left-right", "--count", `main...${branch}`], {
      timeout: 4000,
    });
    if (counts.status === 0) {
      const [b, a] = counts.stdout.trim().split(/\s+/).map(Number);
      behind = Number.isFinite(b) ? b : null;
      ahead = Number.isFinite(a) ? a : null;
    }
  }

  const last = gitRead(cwd, ["log", "-1", "--format=%h %s"], { timeout: 3000 });
  return {
    ahead,
    behind,
    branch,
    dirtyCount: dirty.length,
    dirtySample: dirty.slice(0, 8).map((l) => l.slice(3)),
    lastCommit: last.status === 0 ? last.stdout.trim() : null,
  };
}

/**
 * Build the session's git-context fragment.
 *
 * @param {object} data - SessionStart hook payload.
 * @returns {{additionalContext: string, sessionTitle?: string}|null} The fragment.
 */
function collect(data) {
  const cwd = cwdOf(data);
  const f = gitFacts(cwd);
  if (!f) return null;

  const lines = [`Branch: \`${f.branch}\``];
  if (f.lastCommit) lines.push(`Last commit: ${f.lastCommit}`);
  if (f.ahead !== null || f.behind !== null) {
    lines.push(`Against main: ${f.ahead ?? "?"} ahead, ${f.behind ?? "?"} behind`);
  }
  if (f.dirtyCount === 0) {
    lines.push("Working tree: clean");
  } else {
    lines.push(
      `Working tree: ${f.dirtyCount} uncommitted file(s) — ${f.dirtySample.join(", ")}` +
        (f.dirtyCount > f.dirtySample.length ? ", ..." : "") +
        "\n  These predate this session. They belong to whoever wrote them; do not commit them " +
        "as part of your own work.",
    );
  }

  if (f.branch === "main" || f.branch === "master") {
    lines.push(
      "You are on the protected branch. Product edits are blocked here — " +
        "`npm run branch -- <name>` opens a feature branch. " +
        "CLAUDE.md, .claude/** and memory/** stay editable.",
    );
  }

  lines.push(
    "Flow: `npm run commit` (atomic, checks the CHANGELOG) → `npm run push` (verify gate, then " +
      "push) → `npm run release -- <version>` (versions, CHANGELOG section, tag). Raw " +
      "`git commit` / `git push` / `git tag` are blocked.",
  );

  return {
    additionalContext: `[tab-git]\n${lines.join("\n")}`,
    sessionTitle: f.branch && f.branch !== "HEAD" ? f.branch : undefined,
  };
}

module.exports = { collect, gitFacts, id: "branch-context" };
