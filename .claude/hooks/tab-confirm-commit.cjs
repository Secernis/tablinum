#!/usr/bin/env node
"use strict";

/**
 * User-side confirmation for ONE commit whose paths the edit tracker cannot
 * vouch for.
 *
 * `commit-foreign-hunk` refuses a commit that names a path this session did not
 * demonstrably edit, and its message ends with "say which and why, and the user
 * can confirm it". That sentence promised a path that did not exist: there was
 * no way for a confirmation to reach the gate, so the only remaining moves were
 * to abandon the commit or to work around the rule. Both are worse than the
 * problem.
 *
 * The legitimate case is narrow and real: files written through a script or a
 * shell redirect never reach the tracker (it records Edit/Write/MultiEdit only),
 * and neither does anything written before the hooks were live. Those files ARE
 * the session's — the tracker simply cannot see them.
 *
 * Three properties keep this from becoming the loophole the gate exists to
 * close:
 *
 *   USER-RUN. Like the unlock windows, this is typed in your own terminal. An
 *   agent that could grant itself the exemption would have no gate at all.
 *   SINGLE-USE. The gate consumes the flag when it lets a commit through, so one
 *   confirmation authorises one commit and not a window of them.
 *   SHORT-LIVED. Ten minutes, so a forgotten confirmation expires rather than
 *   sitting there waiting to excuse something you never saw.
 *
 * Run it only after the agent has told you WHICH paths and WHY, and only when
 * that answer holds up.
 */

const fs = require("node:fs");
const path = require("node:path");

/** How long an unused confirmation stays valid. */
const TTL_MS = 10 * 60 * 1000;

const flag = path.join(__dirname, "state", "commit-confirm");
fs.mkdirSync(path.dirname(flag), { recursive: true });
fs.writeFileSync(flag, new Date().toISOString(), "utf8");

const until = new Date(Date.now() + TTL_MS);
console.log(
  `[tab-confirm-commit] ONE commit may include paths the edit tracker cannot vouch for.\n` +
    `  valid until ${until.toLocaleTimeString()} (${TTL_MS / 60000} min), consumed by the first commit that uses it.`,
);
