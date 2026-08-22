# Secrets

Enforced by: `secret-write`, `secret-read`, the `secrets` sensor in verify, and
the pre-commit scan in `commit.mjs`.

## Never in the repository, not even in an ignored file

A gitignored file still sits on disk, still ends up in a backup, still gets
opened by an editor with a sync plugin, and is one `git add -f` away from the
history. "It is not committed" is not the same as "it is not there".

Placeholders instead:

```
API_KEY=${TABLINUM_API_KEY}
UPDATER_PRIVATE_KEY=<set on the release machine>
```

The Tauri updater key in particular never enters the repository. It belongs in
the release machine's keychain; a copy of it is a copy of the ability to ship a
signed update to every installed instance.

## Never into the transcript

Reading a `.env` puts its values into the conversation, and from there they are
loggable, cacheable and forwardable without anyone deciding to forward them.

Read the **template** instead — `.env.example` lists which keys exist without
their values, which is almost always the actual question. If a real value is
genuinely needed, ask for that one value.

The gate covers both the read tool and the shell, including a reader hidden
inside `bash -c` or an interpreter's own file-read call. It does not cover the
process environment (`env`, `printenv`), and it cannot see a script that reads
`.env` internally — the load-bearing layer stays the write prohibition.

## Rotate, do not delete

A secret that reached the history has to be **rotated**. A later commit removing
it changes nothing about the clones, the forks, the CI caches and the backups
that already have it.

This is why the scan runs before the commit rather than after: at that point,
deletion is still enough.

## What the gate looks for

High-confidence shapes only: PEM headers, AWS key IDs, GitHub and Slack token
prefixes, Google API keys, complete JWT triples, the Tauri minisign key header.
Each is a vendor-defined prefix plus a fixed body length — unmistakable, and
impossible to produce accidentally as documentation.

Generic `password = "..."` patterns are deliberately **not** matched. They fire
on fixtures, on prompts and on the word itself, and a gate that cries wolf gets
disabled — which costs more than the cases it would have caught.
