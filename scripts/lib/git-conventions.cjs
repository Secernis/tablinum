"use strict";

/**
 * The git conventions, in one place: what a branch is called and what a commit
 * subject looks like.
 *
 * Single-sourced because three things enforce them — `npm run branch`,
 * `npm run commit`, and the write-time hooks that watch both calls — and two
 * copies of a convention drift into two conventions. Every function here is
 * pure and returns a reason string or null, so the script can `fail()` with it
 * and the hook can `deny()` with it.
 */

/** Branch prefixes that say what a branch is for. */
const BRANCH_PREFIXES = ["feat", "fix", "chore", "docs", "refactor", "perf", "test", "build", "ci"];

/** `<prefix>/<kebab-case>`, nothing else. */
const BRANCH_RE = new RegExp(`^(?:${BRANCH_PREFIXES.join("|")})/[a-z0-9]+(?:-[a-z0-9]+)*$`);

/** Longest body after the prefix; a branch name is typed, and it is grepped. */
const BRANCH_BODY_MAX = 60;

/** Branches that are not feature work and never checked. */
const BASE_BRANCHES = new Set(["main", "master"]);

/**
 * Turn what someone typed into a conventional branch name.
 *
 * `Add SSH support` → `feat/add-ssh-support`; `fix/CRLF parser` → `fix/crlf-parser`.
 * A slash with an UNKNOWN prefix is refused rather than swallowed into the
 * body: `feature/foo` becoming `feat/feature-foo` is a silent mangling the
 * author would not notice until the branch list reads oddly.
 *
 * @param {string} raw - What the caller typed.
 * @returns {{name: string, reason: null}|{name: null, reason: string}} The
 *   normalised name, or why there is none.
 */
function normalizeBranchName(raw) {
  const input = String(raw || "").trim();
  const [maybePrefix, ...rest] = input.split("/");
  const lowered = maybePrefix.toLowerCase();
  const hasSlash = rest.length > 0;
  if (hasSlash && !BRANCH_PREFIXES.includes(lowered)) {
    return {
      name: null,
      reason:
        `'${maybePrefix}' is not a branch prefix. One of: ${BRANCH_PREFIXES.join(", ")} — ` +
        "the prefix says what kind of work the branch holds, and the list is closed so the " +
        "branch listing stays filterable.",
    };
  }
  const prefix = hasSlash ? lowered : "feat";
  const body = (hasSlash ? rest.join("/") : input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BRANCH_BODY_MAX);
  if (!body) {
    return { name: null, reason: "the name is empty after normalisation — use letters and digits." };
  }
  return { name: `${prefix}/${body}`, reason: null };
}

/**
 * Why a branch name that already exists (or is about to, through raw git)
 * does not follow the convention.
 *
 * @param {string} name - A full branch name.
 * @returns {string|null} The reason, or null when it conforms.
 */
function checkBranchName(name) {
  const n = String(name || "").trim();
  if (BASE_BRANCHES.has(n)) return null;
  if (BRANCH_RE.test(n)) return null;
  return (
    `'${n}' does not follow \`<prefix>/<kebab-case>\`. Prefixes: ${BRANCH_PREFIXES.join(", ")}; ` +
    "the body is lowercase letters, digits and single hyphens."
  );
}

/**
 * The commit types, with whether a user would notice one and what it means.
 *
 * `userVisible` drives the CHANGELOG check in `commit.mjs`: a type the user
 * would notice has to come with an entry.
 */
const COMMIT_TYPES = {
  build: { userVisible: false, what: "the build system or dependencies" },
  chore: { userVisible: false, what: "housekeeping with no effect on the product" },
  ci: { userVisible: false, what: "the CI configuration" },
  docs: { userVisible: false, what: "documentation only" },
  feat: { userVisible: true, what: "a capability the user did not have before" },
  fix: { userVisible: true, what: "a defect the user could hit" },
  perf: { userVisible: true, what: "the same behaviour, measurably faster" },
  refactor: { userVisible: false, what: "structure only — behaviour is unchanged" },
  revert: { userVisible: true, what: "an earlier commit undone" },
  style: { userVisible: false, what: "formatting only" },
  test: { userVisible: false, what: "tests only" },
};

/**
 * The shape a scope has to have: lowercase, kebab, short.
 *
 * Not a closed vocabulary — `commit.mjs` reads the history and nudges toward
 * the scopes already in use, because a hardcoded list would be wrong the first
 * time someone works on a part nobody anticipated.
 */
const SCOPE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Why a type is not one of ours.
 *
 * @param {string|undefined} type - The declared type.
 * @returns {string|null} The reason, or null when known.
 */
function checkType(type) {
  if (type && COMMIT_TYPES[type]) return null;
  return (
    `unknown type \`${type || ""}\`. One of: ${Object.entries(COMMIT_TYPES)
      .map(([t, v]) => `\n  ${t.padEnd(9)} ${v.what}`)
      .join("")}`
  );
}

/**
 * Why a scope is missing or malformed.
 *
 * @param {string|undefined} scope - The declared scope.
 * @returns {string|null} The reason, or null when fine.
 */
function checkScope(scope) {
  if (!scope) {
    return (
      "every commit declares a scope: `--scope <name>`.\n\n" +
      "The subject then answers where as well as what — `fix(commit): ...` rather than " +
      "`fix: ...` — which is what a reader filters on when hunting the change that broke " +
      "something."
    );
  }
  if (!SCOPE_RE.test(scope)) {
    return (
      `'${scope}' is not a scope. Lowercase letters, digits and hyphens — it becomes part of a ` +
      "subject line that gets grepped."
    );
  }
  return null;
}

/**
 * Why a subject is not one atomic, imperative title.
 *
 * @param {string|undefined} subject - The commit subject, without the type prefix.
 * @returns {string|null} The reason, or null when fine.
 */
function checkSubject(subject) {
  const s = String(subject || "").trim();
  if (!s) return 'write the subject: `--message "..."`.';
  if (s.length > 72) {
    return (
      `the subject is ${s.length} characters. Keep it under 72 — a subject that does not ` +
      "fit on one line is usually describing more than one change."
    );
  }
  if (/\.$/.test(s)) return "no trailing period in the subject — it is a title, not a sentence.";
  if (/^[A-Z]/.test(s) && !/^[A-Z]{2,}/.test(s)) return "start the subject lowercase (after the type prefix).";
  if (/\b(?:and|und|plus|sowie)\b/i.test(s) || s.includes(" & ")) {
    return (
      `"${s}" needs a conjunction to describe itself, which means it is two changes.\n\n` +
      "Split it: `npm run commit -- --inspect` shows what is dirty, and `--files` lets you " +
      "carve the first change out. Two commits that each revert cleanly are worth more than " +
      "one that reverts neither."
    );
  }
  if (/^(?:wip|temp|tmp|misc|stuff|update|updates|changes)\b/i.test(s)) {
    return (
      `"${s}" says nothing. In six months the only question anyone asks of a commit is ` +
      "why it happened — write that."
    );
  }
  return null;
}

module.exports = {
  BASE_BRANCHES,
  BRANCH_PREFIXES,
  BRANCH_RE,
  COMMIT_TYPES,
  SCOPE_RE,
  checkBranchName,
  checkScope,
  checkSubject,
  checkType,
  normalizeBranchName,
};
