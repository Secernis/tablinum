# Tablinum

A desktop app that reads local Git histories and builds analyses from them.
Built with [Tauri 2](https://tauri.app), [React 19](https://react.dev),
[Vite](https://vite.dev) and TypeScript.

> Early scaffold. The brand system is complete; the product is not.

## Requirements

- Node.js and npm
- Rust toolchain (`rustup`)
- Windows: Microsoft Edge WebView2 (preinstalled on Windows 11)

## Development

```bash
npm install
npm run dev:app
```

`dev:app` starts up to three processes in one `concurrently` run:

| | | |
| --- | --- | --- |
| `[vite]` | http://localhost:1420 | app frontend |
| `[brand]` | http://localhost:1425 | brand portal from `design/`, if present |
| `[tauri]` | — | desktop window, once the frontend answers |

Closing the app stops the servers with it (`--kill-others`). Without the brand
server: `node scripts/dev.mjs --no-brand`.

Port edge cases, checked for each server separately:

| Situation | Behaviour |
| --- | --- |
| Port free | normal start |
| A Vite server already runs there | reused, no second server |
| Port taken by a foreign process | next free port; for the app server Tauri's `devUrl` follows |
| All 20 ports in the window taken | abort with exit code 1 |
| Vite listens on IPv6 localhost | port check is dual-stack (127.0.0.1 and ::1) |
| Vite fails to come up | abort after 60 s instead of waiting forever |

Base ports can be overridden: `VITE_PORT=3000 BRAND_PORT=3005 npm run dev:app`.

Frontend only, no desktop window: `npm run dev`.
Plain Tauri route (Tauri starts Vite itself): `npm run tauri dev`.

## Build

```bash
npm run build        # frontend
npm run tauri build  # desktop app
```

## Layout

- `src/` — React frontend (Vite, port 1420)
- `src/lib/brand/` — Logo component and distributed vectors (GENERATED)
- `src/components/tailgrids/` — TailGrids components, added through their CLI
- `src-tauri/` — Rust backend, `tauri.conf.json`, icons
- `public/` — favicons and fonts (GENERATED)
- `scripts/` — dev orchestrator and release script
- `tailgrids.css` — TailGrids v3, Google Fonts import deliberately removed
- `DESIGN.md` — style reference; its token block is generated

## Surface

**Tailwind v4 with TailGrids v3.** The stylesheet chain lives in
`src/index.css`, and its order is deliberate:

```
tailgrids.css   brings @import "tailwindcss" and the forms plugin
theme.css       semantic tokens (--t-*), light and dark      GENERATED
brand.css       fonts, brand ramps, @theme inline            GENERATED
```

`brand.css` runs after TailGrids and overrides exactly what carries the brand
(primary ramp, `--font-sans`). The other way round you would get DM Sans and
TailGrids indigo.

Brand tokens are available as Tailwind colours through `@theme inline`, which
keeps the value as a reference so `bg-surface` follows the theme switch instead
of freezing on the light state:

| Utility | Token |
| --- | --- |
| `bg-canvas` · `bg-surface` · `bg-raised` | surfaces |
| `border-line` | borders |
| `text-ink` · `text-muted` | text |
| `bg-accent` · `text-on-accent` · `bg-accent-soft` | accent |
| `text-danger` · `ring-focus` | states |

The names deliberately differ from the token names — `bg-bg` and
`border-border` read like typos.

## The brand

The mark is generated, not drawn: **3 atoms → 12 master SVGs → every platform
asset**. There is exactly one path from a brand decision to an asset.

That pipeline lives in `design/`, which is **not part of this repository**. It
is the authoring environment for the brand and stays private — trademarks are
governed by different rules than the code that uses them. Everything the app
needs is versioned inside the app tree, so a clone builds without Python and
without the generator:

```
src/lib/brand/     Logo component and vectors, light and dark
src/brand.css      fonts, ramps, token bridge
public/            favicons and the four font files
src-tauri/icons/   app icons: .ico, .icns and the PNG sizes Tauri bundles
```

The mark exists in two versions: the full one above 40 px, and a robust one
below it — without joints, with filled nodes and a 1.6× wall. Small sizes need
more mass, not fewer details.

## Working on it

```bash
npm run branch -- add-ssh-support     # open a feature branch; nothing lands on main
npm run verify -- --files <path...>   # the one gate everything else runs
npm run changelog -- --added "..."    # document it while you still know what it means
npm run commit -- --inspect           # what is dirty, grouped
npm run commit -- --files <path...> --type feat --message "..."
npm run push                          # verify, then push
```

`npm run verify` is the single place anything can say no about this tree: types,
secret values, debt markers, comment language, the CHANGELOG schema, whether the
declared versions still agree, and — with `--all` or `--rust` — clippy and the
Rust tests. The Stop hook runs it scoped to what changed; `push` and `release`
run it in full.

The CHANGELOG is written **as work lands**, not at release time. A changelog
written from `git log` says what changed in the code; this one says what changed
for the person using the app, and only the person who made the change can write
that.

Raw `git commit`, `git push` and `git tag` are blocked in agent sessions. Each
script does something the bare command cannot, and the raw version produces a
result that looks identical having skipped all of it. Full standards:
[`.claude/rules/`](.claude/rules/).

## Release

```bash
node scripts/release.mjs 0.3.0            # preview, changes nothing
node scripts/release.mjs --bump minor     # take the number from the changelog
node scripts/release.mjs 0.3.0 --run      # assets, version, changelog, commit, tag
node scripts/release.mjs 0.3.0 --run --push
```

A release is five statements that have to agree: `package.json`,
`tauri.conf.json`, `Cargo.toml`, the CHANGELOG's newest heading, and the git tag.
When they drift **nothing fails** — each file is internally consistent, the build
succeeds, and the app reports a version matching no tag. The script writes all
five or none, which is why the raw `git tag` is blocked.

It runs the verify gate first, builds the mark and distributes it into
`src/lib/brand`, `public/` and `src-tauri/icons`, promotes `## [Unreleased]` into
a dated version section, sets the version everywhere, then commits and tags. An
empty Unreleased section refuses the release: a version that tells users nothing
changed is either undocumented work or no work.

**A release has to run from the machine that holds `design/`.** CI could not
produce the logo and would silently ship a stale mark. If the directory is
missing, the script refuses to run.

## Licence

**GNU General Public License v3.0** — see `LICENSE`.

You may use, study, modify and distribute this software. If you distribute it,
in original or modified form, you have to pass on the source code under the same
licence. That is the point: nobody turns Tablinum into a closed product.

**The name and logo are not covered by the GPL.** The mark, wordmark and lockups
in `src/lib/brand/`, `public/` and `src-tauri/icons/` belong to the brand.
Fork the code freely — but replace the brand with your own before you distribute
it. Details in `TRADEMARK.md`.
