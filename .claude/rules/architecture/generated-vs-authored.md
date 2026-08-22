# Generated versus authored

Enforced by: `generated-files`, `gitignored-write-guard`, `surface-protect`
(the `brand` scope).

## Edit the source, then regenerate

A hand-edit to generated output survives exactly until the next generator run,
and then vanishes without a trace. While it lives it is invisible: the file looks
authored, so the next reader trusts it.

| Generated | Its actual writer |
| --- | --- |
| `src-tauri/gen/schemas/**` | the Tauri build, from `tauri.conf.json` and `capabilities/` |
| `src-tauri/target/**` | cargo |
| `dist/**` | vite, from `src/` |
| `tailgrids.css` | the TailGrids toolchain |
| `package-lock.json` | npm — `npm install <pkg>`, never by hand |
| `src-tauri/Cargo.lock` | cargo — `cargo add`, `cargo update` |

A hand-edited lockfile resolves to a dependency tree nobody else can reproduce,
which is the precise opposite of what a lockfile is for.

## The brand assets are generated too

`src/lib/brand/`, `src/brand.css`, `public/` and `src-tauri/icons/` come out of
`design/`, which is private and not in this repository. The committed files are
therefore the **only** copy the app builds from — and a hand-edited one is no
longer reproducible from its source.

They sit behind an unlock window rather than a hard block, because the generator
lives outside the repo and there are legitimate reasons for a human to touch
them. Ask; do not work around it.

The same reasoning excuses them from the comment-language sweep: a German comment
in `src/lib/brand/logo.css` is a real finding whose fix belongs in the generator,
and reporting it here would leave the gate permanently red against a file nobody
in this repository can correct. A gate that is always red is a gate that gets
skipped.

## Writing into ignored paths

A file the repository ignores does not exist for anyone else. Work written there
is absent from review, absent from a clone, and gone the moment the directory is
cleaned.

The recurring mistake is misdirection rather than intent: a module written into
`dist/` because that is where the built copy was read from, a fix applied inside
`node_modules/` because that is where the stack trace pointed.

Throwaway work has a home — the session scratchpad, or `.tmp/` inside the repo.
Everything else belongs in tracked source. If a path genuinely should be tracked,
that is a `.gitignore` change and the user makes it.
