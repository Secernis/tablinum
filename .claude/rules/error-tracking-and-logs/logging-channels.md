# Logging

Enforced by: `logging-channel`.

## Frontend: `src/lib/log.ts`

```ts
import { logWarn, logError } from "@/lib/log";

logWarn("repo.open.failed", { path });
```

Two reasons, both specific to a desktop app:

**A desktop user has no devtools console.** A `console.log` in shipped code is
output nobody will ever read — not the user, and not you when they report the
bug.

**It pins logging to the console forever.** When output eventually has to reach a
file or the Tauri log plugin, every scattered call site has to be found and
rewritten first. `src/lib/log.ts` is the one place that changes.

The signature is deliberate: a **stable event key** plus structured fields. A
formatted sentence cannot be filtered by anything, so a log full of them can only
be read by eye.

## Rust: the `log` crate

`log::warn!` / `log::error!`, not `println!`.

A bundled binary has no attached terminal, so `println!` output goes nowhere on
the machine that matters. The `log` crate routes through the Tauri log plugin to
a file the user can actually send you.

`dbg!` is a debugging aid and must never reach a commit.

## What to log

Enough to reconstruct what happened, never enough to leak anything. No file
contents, no remote URLs carrying credentials, no environment values. A path is
usually fine; the thing at the end of it usually is not.
