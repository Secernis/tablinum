# Fail closed

Enforced by: `deny-by-default`.

## The rule

When a check cannot decide, the answer is no.

A guard that returns "allowed" on failure is green **exactly** when it matters,
and silent about it. That is worse than having no guard: a missing guard is
visible, a fail-open one produces a passing result under precisely the conditions
it was written to catch.

```ts
try {
  return await verify(input);
} catch {
  return false;   // not `true`
}
```

```rust
check(path).unwrap_or(false)   // not unwrap_or(true)
```

An exception means the check did not run. That is not the same as the check
passing, and the code must not treat it as if it were.

The same principle runs through the hook layer itself: a rule that cannot
evaluate reports `INCONCLUSIVE` rather than passing, so "the gate did not run"
and "the gate found nothing" never look alike in the telemetry.

## Rendering data the app did not author

A branch name, a commit message, a file path, a remote URL — all of it comes from
repositories Tablinum did not write. It is data.

- No `dangerouslySetInnerHTML`, no `.innerHTML =`. Render text as text.
- No `eval`, no `new Function`. There is no version of this that is safe in a
  webview with native reach behind it.

If content genuinely has to carry markup, sanitise it explicitly and write down
why in a comment beside the call.

## Building a git command

Fixed program name, arguments as a vector. Never assemble the program itself from
input:

```rust
Command::new("git").args(["status", "--porcelain"])
```

The dangerous version is `Command::new(user_supplied)`. It looks like the same
line and it is a different program.
