# The Tauri surface

Enforced by: `tauri-security`, `surface-protect` (the `configs` scope).

## What is actually at stake

A Tauri app is a webview with a native process behind it. Everything the frontend
is allowed to reach, it reaches with the user's own privileges — and Tablinum is
a Git client, so the frontend already handles the user's repositories.

The difference between an app that can run `git status` and one that can run
anything is a single line in `capabilities/default.json`.

## The pattern this prevents

It is not malice, it is the shortest path. A call fails with a permission error,
and the fastest way forward is to grant the broadest permission that makes the
error stop:

- `fs:allow-read-file` becomes `fs:default`
- a scoped path becomes a wildcard
- the CSP becomes `null`

Each step is one line. Each one is permanent, because nobody goes back to narrow
a permission that already works.

## The rule

Grant the **narrowest** permission that makes the specific call work. An
`allow-<command>` rather than a `:default` set. Named directories rather than a
wildcard scope. And say in the commit why this app needs it — a permission whose
reason is not written down is a permission nobody can later argue with.

## Config settings that are decisions, not fixes

| Setting | What it does |
| --- | --- |
| `"csp": null` | removes the Content-Security-Policy, so any injected script runs |
| `unsafe-inline` / `unsafe-eval` | reopens exactly the class the CSP exists to close |
| `withGlobalTauri: true` | exposes the whole Tauri API on `window`, reachable by any script |
| `dangerousDisableAssetCspModification` | lets asset loading bypass the CSP |
| `dangerousUseHttpScheme` | serves the app over plain HTTP |
| a remote `devUrl` | points the dev webview at an origin you do not control |

Any of these changing is a `Security` entry in the CHANGELOG.

## Known open item

`src-tauri/tauri.conf.json` currently ships `"csp": null`. That is the Tauri
scaffold default, not a decision anyone made. It should become a real policy
before the app renders repository content — a branch name and a commit message
are both text this app did not author.
