# Releases

Enforced by: `bash-gates` (the `git tag` channel), `version-drift` (SessionStart),
`version-sync` (verify), `release.mjs`.

## A release is not a tag

It is five statements that have to agree:

| Where | What it claims |
| --- | --- |
| `package.json` | what npm reports |
| `src-tauri/tauri.conf.json` | what the app reports about itself |
| `src-tauri/Cargo.toml` | what the crate reports |
| `CHANGELOG.md` | what the user is told changed |
| the git tag | what the history says was released |

When they drift, **nothing fails**. Each file is internally consistent, the build
succeeds, and the app reports a version matching no tag. It is noticed by someone
trying to reproduce a bug from a version that never coherently existed — usually
under time pressure, usually months later.

That is the whole reason `git tag` is blocked and `npm run release` is the
channel. It writes all five, or none.

```
node scripts/release.mjs 0.3.0                 # preview — changes nothing
node scripts/release.mjs --bump minor          # take the number from the changelog
node scripts/release.mjs 0.3.0 --run
node scripts/release.mjs 0.3.0 --run --push
```

## The changelog decides the number

The release reads the Unreleased section, derives the implied bump (`Added` or
`Deprecated` present means MINOR, otherwise PATCH), and applies it. Passing an
explicit version or `--bump` overrides that and says so in the output — because
overriding a derived number is a decision, and a decision that happens silently
is a decision nobody made.

An empty Unreleased section refuses the release outright. A release that tells
users nothing changed is either undocumented work or no work; both are answered
before the tag, not after.

MAJOR is never derived. A breaking change is a statement about the product's
contract with its users, and it is made by a person.

## The gate runs first

`npm run verify --all`, every time, with no way to skip it. A release is the one
artefact that reaches people who cannot see the repository, and the one that
cannot be quietly amended afterwards.

## Why the brand assets are built locally

`design/` holds the mark's generator and is deliberately **not** in the
repository — a public clone would otherwise carry the complete brand material,
and trademarks are governed by different rules than the code that uses them.

CI has neither the generator nor fontTools nor the rasteriser, so it cannot
produce the logo. The result is generated locally and committed: everything the
app needs is versioned inside the app tree (`src/lib/brand/`, `src/brand.css`,
`public/`, `src-tauri/icons/`), so a fresh clone builds without Python and
without `design/`.

Without `design/` the release script refuses to run, rather than shipping a stale
mark that nobody would notice. `--skip-assets` exists for a release that
genuinely changes nothing about the mark, and it says so in the commit.

The consequence worth stating plainly: **the generator lives on one machine.**
`design/` belongs in its own private repository or a backup — otherwise the mark
stops being reproducible after a machine change.

## Release-blocking debt

Three of the debt tags block a release cut while any of them is open: the
production, security and legal tags described in
[code-quality/todo-and-debt-markers.md](../code-quality/todo-and-debt-markers.md).

They are the three kinds of debt whose whole point is that they must not ship,
and a marker that does not stop the thing it exists to stop is just a comment.
