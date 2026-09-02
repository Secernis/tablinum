"use strict";

/**
 * Shared I/O layer for the per-event hook dispatchers
 * (`tab-pretooluse.cjs`, `tab-posttooluse.cjs`, `tab-stop.cjs`, ...).
 *
 * Why this module exists: every hook would otherwise duplicate ~15 lines of
 * stdin-buffering, JSON-parsing and watchdog boilerplate. The dispatchers share
 * exactly one implementation; rules receive the parsed payload and return an
 * exit code. One node spawn per tool call instead of one per rule — PreToolUse
 * is the hottest hook path.
 *
 * Rule contract (deliberately minimal — no result chaining, no profiles):
 *   { id: string, run(data) -> PASS | BLOCK | NOOP | EXCUSED | INCONCLUSIVE }
 * A rule writes its own stderr (block messages, progress lines) and returns
 * `BLOCK` to block the tool call / Stop. Anything thrown inside a rule is logged
 * and treated as pass (fail-open), so one broken rule can never take the whole
 * verification layer down.
 *
 * The three negative outcomes are TELEMETRY refinements, not control flow: they
 * split what would otherwise be an undifferentiated `0`, so the value of a rule
 * becomes readable (did it even apply? did it catch anything?). Only `BLOCK`
 * ever reaches an exit code.
 */

const metrics = require("./metrics.cjs");

const MAX_STDIN = 1024 * 1024;

/** Evaluated, nothing to complain about. Must stay the shell success code. */
const PASS = 0;
/** Evaluated, violation found — the ONLY outcome that reaches the exit code. */
const BLOCK = 2;
/** Not applicable: a scope guard rejected the payload before any evaluation. */
const NOOP = -1;
/** Evaluated and would have acted, but authorized (unlock window, ack, cache hit). */
const EXCUSED = -2;
/** Could not evaluate: timeout, unreadable file, missing git, caught exception. */
const INCONCLUSIVE = -3;

/** Telemetry letters per outcome; `PASS` is encoded as absence to keep the ring small. */
const OUTCOME_CODE = new Map([
  [BLOCK, "b"],
  [NOOP, "n"],
  [EXCUSED, "x"],
  [INCONCLUSIVE, "i"],
]);

/**
 * Count of `hint()` envelopes emitted in this process.
 *
 * Lets `runRules` observe that a rule injected context WITHOUT every hint rule
 * having to declare it: `hint()` returns `PASS` by contract, so the emission is
 * otherwise indistinguishable from doing nothing.
 */
let hintsEmitted = 0;

/**
 * Low-cardinality label the CURRENT rule attached to its own telemetry entry.
 *
 * Reset by `runRules` around every rule call, so a rule that forgets to clear it
 * cannot leak its label onto the next one. A rule's verdict is a single number;
 * a rule guarding several scopes behind one id would otherwise record THAT it
 * blocked but never WHICH surface earned the block.
 */
let ruleDetail = null;

/** Cap on the detail label — a high-cardinality value would bloat the ring. */
const MAX_DETAIL_LEN = 32;

/**
 * Resolve the working directory from a hook payload.
 *
 * @param {object} data - Parsed hook payload.
 * @returns {string} The workspace dir, falling back to `process.cwd()`.
 */
function cwdOf(data) {
  return (data && data.workspace && data.workspace.current_dir) || process.cwd();
}

/**
 * Label WHICH sub-surface of a multi-surface rule was in play, for the telemetry
 * ring. Observability only — it can never influence a verdict, which is why it
 * returns nothing and why callers place it beside their `return`, not in it.
 *
 * @param {string} value - Short, low-cardinality label (<= 32 chars).
 * @returns {void}
 */
function noteDetail(value) {
  if (typeof value === "string" && value.length > 0 && value.length <= MAX_DETAIL_LEN) {
    ruleDetail = value;
  }
}

/**
 * Write a structured block message and signal "deny".
 *
 * @param {string} prefix - Dispatcher/rule tag shown to the agent (e.g. `tab-guard`).
 * @param {string} rule - Short rule headline (e.g. `Branch Protection`).
 * @param {string} message - Explanation + remediation fed back to Claude.
 * @returns {number} Always 2 — callers `return deny(...)` from a rule.
 */
function deny(prefix, rule, message) {
  process.stderr.write(`[${prefix}] ${rule}\n${message}\n`);
  return BLOCK;
}

/**
 * Inject additional context into the conversation WITHOUT blocking the call.
 *
 * Counterpart to `deny()` for advisory rules. Writes the `additionalContext`
 * envelope to stdout — therefore only ONE rule per dispatch may emit; rules must
 * scope tool-disjointly (the dispatcher does not validate that). Every other
 * rule leaves stdout strictly empty.
 *
 * @param {string} prefix - Rule tag (e.g. `tab-guard`).
 * @param {string} message - Context text injected into the model's turn.
 * @param {string} [systemMessage] - Optional one-line note the harness renders
 *   for the USER. The only user-visible channel of a non-blocking hook: stderr
 *   is swallowed on exit 0, additionalContext is model-directed only.
 * @param {string} [eventName] - Hook event of the envelope (default `"PreToolUse"`).
 * @returns {number} Always `PASS` — callers `return hint(...)` from a rule.
 */
function hint(prefix, message, systemMessage, eventName = "PreToolUse") {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: `[${prefix}] ${message}`,
      },
      ...(systemMessage ? { systemMessage: `[${prefix}] ${systemMessage}` } : {}),
    }),
  );
  hintsEmitted++;
  return PASS;
}

/**
 * Buffer stdin until EOF and JSON-parse it.
 *
 * The watchdog only covers the stdin wait: if the harness never closes the pipe,
 * the dispatcher exits 0 instead of hanging. Rule processing is bounded by the
 * rules' own subprocess timeouts.
 *
 * @param {number} timeoutMs - Max time to wait for stdin EOF before exiting 0.
 * @returns {Promise<object|null>} Parsed payload, or null on parse failure.
 */
function readHookInput(timeoutMs) {
  return new Promise((resolve) => {
    let input = "";
    const watchdog = setTimeout(() => process.exit(0), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      if (input.length < MAX_STDIN) input += c.substring(0, MAX_STDIN - input.length);
    });
    process.stdin.on("end", () => {
      clearTimeout(watchdog);
      try {
        resolve(JSON.parse(input));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => {
      clearTimeout(watchdog);
      resolve(null);
    });
  });
}

/**
 * Classify one rule call into a telemetry letter.
 *
 * Precedence is deliberate: the enforcement outcome outranks the advisory one,
 * so a rule that emitted a hint AND blocked is recorded as a block.
 *
 * @param {number} verdict - The rule's return value.
 * @param {boolean} hinted - Whether the rule emitted a hint envelope.
 * @returns {string|undefined} The telemetry letter, or undefined for a plain pass.
 */
function outcomeOf(verdict, hinted) {
  const code = OUTCOME_CODE.get(verdict);
  if (code) return code;
  return hinted ? "h" : undefined;
}

/**
 * Run rules sequentially; the first blocking rule wins (short-circuit).
 *
 * Only `BLOCK` propagates. `NOOP` / `EXCUSED` / `INCONCLUSIVE` are recorded but
 * behave exactly like `PASS`, so the added telemetry granularity cannot turn
 * into an enforcement change.
 *
 * A rule that THROWS is a different matter. The default is fail-open: the crash
 * is logged as "e" and the chain continues, because a bug in a style gate must
 * not lock every edit in the repository. A rule that declares `failClosed: true`
 * opts out of that default — its crash blocks. That flag belongs on the gates
 * whose whole purpose is to refuse (secrets, the protected surfaces, the Tauri
 * capability surface, the channelled git commands): for those, "the gate did not
 * run" letting the call through is precisely the failure they exist to prevent.
 *
 * @param {object} data - Parsed hook payload.
 * @param {Array<{id: string, run: (data: object) => number, failClosed?: boolean}>} rules - Ordered registry.
 * @param {string} label - Dispatcher name for error prefixes.
 * @param {Array<object>} [timings] - Optional telemetry sink.
 * @returns {number} `PASS` (all passed) or `BLOCK` (a rule blocked).
 */
function runRules(data, rules, label, timings) {
  for (const rule of rules) {
    const start = timings ? process.hrtime.bigint() : 0n;
    const hintsBefore = hintsEmitted;
    /**
     * Record this rule's duration and outcome, if a telemetry sink was passed.
     * @param {string|undefined} v - Outcome letter, or undefined for a pass.
     * @returns {void}
     */
    const push = (v) => {
      if (!timings) return;
      const entry = { id: rule.id, ms: Number(process.hrtime.bigint() - start) / 1e6 };
      if (v) entry.v = v;
      if (ruleDetail) entry.s = ruleDetail;
      timings.push(entry);
    };
    // Cleared per rule, not per dispatch: a stale label would be attributed to
    // whichever rule ran next, which is worse than having none at all.
    ruleDetail = null;
    try {
      const verdict = rule.run(data);
      push(outcomeOf(verdict, hintsEmitted > hintsBefore));
      if (verdict === BLOCK) return BLOCK;
    } catch (e) {
      // A crashed rule is the expensive blind spot: fail-open means it would
      // otherwise be telemetrically identical to one that passed cleanly.
      push("e");
      process.stderr.write(`[${label}] rule '${rule.id}' failed: ${e.message}\n`);
      if (rule.failClosed) {
        process.stderr.write(
          `[${label}] '${rule.id}' is a fail-closed gate, so its crash refuses the call. ` +
            "Fix the rule (or report it) rather than working around the block.\n",
        );
        return BLOCK;
      }
    }
  }
  return PASS;
}

/**
 * Assemble the telemetry sample for one dispatch.
 *
 * Pure (no I/O, no Date — `record()` stamps the time), so the record shape the
 * dispatchers write is testable without spawning a process.
 *
 * @param {object} data - Parsed hook payload.
 * @param {{label: string}} opts - Dispatcher identity.
 * @param {number} ms - Wall-clock of the rule-execution phase.
 * @param {number} verdict - The dispatch verdict (`PASS` or `BLOCK`).
 * @param {Array<object>} rules - Per-rule timings + outcomes.
 * @returns {object} The sample handed to `metrics.record()`.
 */
function buildSample(data, opts, ms, verdict, rules) {
  const hook = data.hook_event_name || null;
  return {
    hook,
    label: opts.label,
    ...(hook ? {} : { synthetic: true }),
    ...(data.session_id ? { session: data.session_id } : {}),
    tool: data.tool_name,
    ms,
    verdict,
    rules,
  };
}

/**
 * Dispatcher main: read stdin, run the registry, exit with the verdict.
 *
 * @param {Array<{id: string, run: (data: object) => number}>} rules - Ordered registry.
 * @param {{label: string, stdinTimeoutMs: number}} opts - Dispatcher identity + stdin watchdog.
 * @returns {Promise<void>} Resolves never in practice — always terminates the process.
 */
async function dispatch(rules, opts) {
  // Kill-switch for hook-spawned children: anything a Stop rule spawns must not
  // re-run the full hook chain against the parent's dirty tree.
  if (process.env.TAB_HOOKS_DISABLED === "1") process.exit(0);
  const data = await readHookInput(opts.stdinTimeoutMs);
  if (!data) process.exit(0);
  // Time the rule-execution phase only (the controllable hook cost) — the stdin
  // wait above is harness-paced. Telemetry is best-effort and fully fail-open.
  const start = process.hrtime.bigint();
  const timings = [];
  const verdict = runRules(data, rules, opts.label, timings);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  metrics.record(buildSample(data, opts, ms, verdict, timings));
  process.exit(verdict);
}

/**
 * Merge N context fragments into ONE envelope payload.
 *
 * SessionStart and UserPromptSubmit are special: rules do not write stdout
 * themselves, they return `{additionalContext?, sessionTitle?}` fragments. Only
 * ONE `additionalContext` envelope may be emitted per dispatch — two JSON
 * objects on stdout are unparseable. So fragments are composed here: contexts
 * joined with a blank line, the FIRST fragment that sets a `sessionTitle` wins.
 *
 * @param {Array<{additionalContext?: string, sessionTitle?: string}|null>} fragments
 * @returns {{additionalContext?: string, sessionTitle?: string}|null} Merged payload.
 */
function mergeSessionContext(fragments) {
  const present = fragments.filter(Boolean);
  const contexts = present.map((f) => f.additionalContext).filter(Boolean);
  const titled = present.find((f) => f.sessionTitle);
  if (!contexts.length && !titled) return null;
  const merged = {};
  if (contexts.length) merged.additionalContext = contexts.join("\n\n");
  if (titled) merged.sessionTitle = titled.sessionTitle;
  return merged;
}

/**
 * Merge dispatcher: compose every rule's fragment into ONE envelope.
 *
 * Distinct from `dispatch()` (the gate path, verdict via exit code): the rules
 * here are context injectors that must be MERGED, not written independently.
 * Rules expose `collect(data) -> fragment|null` instead of `run(data) -> 0|2`.
 * Fully fail-open: a crashing rule is logged and skipped; the process exits 0.
 *
 * @param {Array<{id: string, collect: (data: object) => object|null}>} rules - Registry.
 * @param {{label: string, stdinTimeoutMs: number, eventName?: string}} opts - Identity.
 * @returns {Promise<void>} Resolves never in practice.
 */
async function dispatchMerged(rules, opts) {
  if (process.env.TAB_HOOKS_DISABLED === "1") process.exit(0);
  const data = await readHookInput(opts.stdinTimeoutMs);
  if (!data) process.exit(0);
  const start = process.hrtime.bigint();
  const timings = [];
  const fragments = [];
  for (const rule of rules) {
    const rStart = process.hrtime.bigint();
    // On the merge path a null fragment already IS the "nothing to say" signal,
    // so the outcome follows from the fragment rather than a return code.
    let v;
    try {
      const fragment = rule.collect(data);
      fragments.push(fragment);
      v = fragment ? "h" : "n";
    } catch (e) {
      v = "e";
      process.stderr.write(`[${opts.label}] rule '${rule.id}' failed: ${e.message}\n`);
    }
    timings.push({ id: rule.id, ms: Number(process.hrtime.bigint() - rStart) / 1e6, v });
  }
  const merged = mergeSessionContext(fragments);
  if (merged) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: opts.eventName || "SessionStart", ...merged },
      }),
    );
  }
  metrics.record(
    buildSample(data, opts, Number(process.hrtime.bigint() - start) / 1e6, PASS, timings),
  );
  process.exit(PASS);
}

module.exports = {
  BLOCK,
  EXCUSED,
  INCONCLUSIVE,
  NOOP,
  PASS,
  buildSample,
  cwdOf,
  deny,
  dispatch,
  dispatchMerged,
  hint,
  mergeSessionContext,
  noteDetail,
  readHookInput,
  runRules,
};
