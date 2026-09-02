# Session analysis prototypes

Starting point for reading Claude Code session transcripts as a second local
history next to Git. Research code: Python, no dependencies, not part of the
build, not wired into `npm run verify`.

## Where the data lives

One JSONL file per session under `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`,
one record per line. Records of type `user`, `assistant` and `system` carry an ISO
`timestamp`, `cwd` and `gitBranch`. A tool call is a `tool_use` block in an
assistant message; its result is a `tool_result` block in a later user message,
joined by `tool_use_id`. Assistant messages carry `usage` (input, cached input,
output and thinking tokens). Sub-agent records live under `<session-id>/subagents/`
and are marked `isSidechain`.

The format is undocumented and versioned per record (`version` field). Parse
defensively: skip unknown record types, treat missing fields as absent.

## Scripts

`session_profile.py <file.jsonl>` — one session: wall-clock split into model
time, tool time and waiting for the user (by what each gap between two records
ends in), tool time per tool, the longest calls, token totals.

`session_trend.py <dir> [<dir>...]` — one line per session across a project
directory, chronological: span, human turns, model requests, model/tool/wait
minutes, seconds per request, average context per request, output tokens,
edits, Bash calls. On Windows the same project directory can be reachable under
several spellings; pass each path only once or sessions are counted twice.

## Known blind spots

- Hook runtime is not recorded separately; PreToolUse hooks are inside the
  tool duration, PostToolUse hooks inside the model gap.
- `AskUserQuestion` and `ExitPlanMode` are counted as tool time by
  `session_profile.py` although they are waiting for the user.
- A tool call without a result (session ended mid-call) is dropped.
