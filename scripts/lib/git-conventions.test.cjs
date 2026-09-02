"use strict";

/**
 * Self-checking cases for the git conventions.
 *
 *   node scripts/lib/git-conventions.test.cjs
 *
 * Run by `npm run verify -- --all` next to the gate suite.
 */

const assert = require("node:assert/strict");

const c = require("./git-conventions.cjs");

// Branch names: normalisation
assert.equal(c.normalizeBranchName("Add SSH support").name, "feat/add-ssh-support");
assert.equal(c.normalizeBranchName("fix/CRLF parser").name, "fix/crlf-parser");
assert.equal(c.normalizeBranchName("chore/agent guardrails!").name, "chore/agent-guardrails");
assert.equal(c.normalizeBranchName("--- ").name, null);
assert.match(c.normalizeBranchName("feature/foo").reason, /not a branch prefix/);
assert.equal(c.normalizeBranchName("x".repeat(80)).name.length, "feat/".length + 60);

// Branch names: checking what raw git would create
assert.equal(c.checkBranchName("main"), null);
assert.equal(c.checkBranchName("feat/start-screen-design"), null);
assert.match(c.checkBranchName("Feature_Foo"), /kebab-case/);
assert.match(c.checkBranchName("feat/Foo"), /kebab-case/);
assert.match(c.checkBranchName("feat/foo--bar"), /kebab-case/);
assert.match(c.checkBranchName("wip"), /kebab-case/);

// Commit types and scopes
assert.equal(c.checkType("feat"), null);
assert.match(c.checkType("feature"), /unknown type/);
assert.match(c.checkType(undefined), /unknown type/);
assert.equal(c.checkScope("repo-picker"), null);
assert.match(c.checkScope(undefined), /declares a scope/);
assert.match(c.checkScope("RepoPicker"), /not a scope/);
assert.match(c.checkScope("repo picker"), /not a scope/);

// Subjects
assert.equal(c.checkSubject("refuse the call when a security gate crashes"), null);
assert.equal(c.checkSubject("CRLF handling in the parser"), null);
assert.match(c.checkSubject(""), /write the subject/);
assert.match(c.checkSubject("Add the picker"), /lowercase/);
assert.match(c.checkSubject("add the picker."), /trailing period/);
assert.match(c.checkSubject("add the picker and the overview"), /conjunction/);
assert.match(c.checkSubject("wip"), /says nothing/);
assert.match(c.checkSubject("a".repeat(73)), /72/);

process.stdout.write("[git-conventions.test] all cases passed.\n");
