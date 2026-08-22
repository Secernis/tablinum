#!/usr/bin/env node
"use strict";

/**
 * Stop dispatcher — single entrypoint for all Stop rules.
 *
 * Runs the validation chain sequentially with short-circuit: the first blocking
 * rule ends the Stop and its stderr becomes the continuation prompt. The
 * sequential order is what makes the chain's intent deterministic — the commit
 * reminder only ever fires when everything before it is green, because a red gate
 * blocks first.
 *
 * Registry (order is contract):
 *
 *   auto-verify         scoped verify gate over this session's edits
 *   auto-clippy         cargo clippy, only when Rust changed
 *   auto-cargotest      cargo test, only when Rust changed
 *   web-marker-guard    a turn that used web content names its sources
 *   language-guard      the visible reply is German
 *   changelog-currency  user-visible change ⇒ an Unreleased entry
 *   commit-reminder     commit verified work before stopping
 *
 * `auto-verify` is first because everything after it assumes the tree is worth
 * acting on. `commit-reminder` is last because its whole meaning is "everything
 * before me passed". clippy and cargo test serialise on the cargo target lock in
 * any case, so their ordering costs no wall-clock and puts the cheaper, more
 * specific failure first.
 *
 * Exit codes: 0 = allow Stop, 2 = block Stop; stderr becomes the continuation.
 */

const { dispatch } = require("./lib/io.cjs");

const STOP_RULES = [
  require("./rules/stop/auto-verify.cjs"),
  require("./rules/stop/auto-clippy.cjs"),
  require("./rules/stop/auto-cargotest.cjs"),
  require("./rules/stop/web-marker-guard.cjs"),
  require("./rules/stop/language-guard.cjs"),
  require("./rules/stop/changelog-currency.cjs"),
  require("./rules/stop/commit-reminder.cjs"),
];

if (require.main === module) {
  dispatch(STOP_RULES, { label: "tab-stop", stdinTimeoutMs: 5000 });
}

module.exports = { STOP_RULES };
