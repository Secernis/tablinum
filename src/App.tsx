import { useState } from "react";
import Logo from "./lib/brand/Logo";
import {
  TableRoot,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/tailgrids/core/table";

/**
 * Start screen — deliberately narrow in scope.
 *
 * It replaces the Vite splash and shows that the chain holds: TailGrids
 * component patterns, brand tokens as Tailwind utilities (`bg-surface`,
 * `text-muted`, `border-line`), the three typefaces in their roles, and the
 * Logo component from the pipeline.
 *
 * What does NOT happen here: designing the product. Which views Tablinum gets
 * is open; only what has already been decided is visible.
 */

// Diff colours of the domain. Deliberately NOT derived from the brand: green
// and red mean added and removed here, not Tablinum.
const DIFF_VARS = { "--add": "#2ea043", "--del": "#f85149" } as React.CSSProperties;

const COMMITS = [
  { hash: "a3f9c21", msg: "fix(parser): count line endings in CRLF files", who: "M. Ackermann", add: "128", del: "44" },
  { hash: "7be0114", msg: "feat(stats): median instead of mean", who: "L. Voss", add: "1,284", del: "903" },
  { hash: "0d41ab8", msg: "refactor: move diff reader to streaming", who: "M. Ackermann", add: "96", del: "1,412" },
  { hash: "51ad33f", msg: "perf: cache blame per file", who: "S. Neumann", add: "407", del: "62" },
];

const STATS = [
  { k: "Commits", v: "1,284", d: "+312 this quarter" },
  { k: "Net lines", v: "47,392", d: "+128,774 / −81,382" },
  { k: "Authors", v: "12", d: "4 active in the last 30 days" },
  { k: "Median to merge", v: "6.4 h", d: "+1.2 h from last month" },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(!dark);
    try {
      localStorage.setItem("tablinum-theme", next);
    } catch {
      // Private window or blocked site data: the choice then applies to this
      // session only, which is no reason to swallow the click.
    }
  }

  return (
    <button
      onClick={toggle}
      className="rounded-full border border-line bg-raised px-4 py-1.5 text-sm
                 text-ink transition hover:border-accent focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-focus"
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-canvas text-ink" style={DIFF_VARS}>
      <header className="flex items-center gap-4 border-b border-line px-8 py-5">
        <Logo variant="mark" size={40} />
        <div className="flex-1">
          {/* --font-display: Lora, the chosen wordmark typeface */}
          <h1 className="font-[family-name:var(--font-display)] text-xl leading-tight">
            Tablinum
          </h1>
          <p className="text-sm text-muted">Read Git histories, build analyses</p>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-5xl px-8 py-10">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.k} className="rounded-xl border border-line bg-surface p-5">
              {/* tabular: JetBrains Mono with tabular figures — columns must not
                  shift between two renders. */}
              <div className="tabular text-3xl leading-none tracking-tight">{s.v}</div>
              <div className="mt-2 text-xs uppercase tracking-widest text-muted">{s.k}</div>
              <div className="mt-1 text-sm text-muted">{s.d}</div>
            </div>
          ))}
        </section>

        <section className="mt-10 rounded-xl border border-line bg-surface p-6">
          <h2 className="font-[family-name:var(--font-display)] text-lg">Scaffold status</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li>
              <span className="text-ink">Mark</span> — keystone portal over a commit chain,
              two versions above and below 40 px
            </li>
            <li>
              <span className="text-ink">Colour</span> — Tabula, WCAG AA in light and dark,
              kept apart from diff semantics
            </li>
            <li>
              <span className="text-ink">Type</span> — Lora, Familjen Grotesk,
              JetBrains Mono
            </li>
            <li>
              <span className="text-ink">Surface</span> — TailGrids v3 on Tailwind v4,
              brand tokens as utilities
            </li>
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
              brand.lock.json
            </span>
            <span className="tabular text-xs text-muted">simple_below_px 40</span>
            <span className="tabular text-xs text-muted">favicon v0.2.0</span>
          </div>
        </section>

        {/* TailGrids component, unchanged from what the CLI delivered. All
            adjustment happens through className — twMerge makes sure our token
            utilities override the built-in classes instead of stacking. */}
        <section className="mt-10">
          <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg">Recent commits</h2>
          <TableRoot className="border-line">
            <TableHeader>
              <TableRow className="border-line">
                <TableHead className="text-muted">Hash</TableHead>
                <TableHead className="text-muted">Message</TableHead>
                <TableHead className="text-muted">Author</TableHead>
                <TableHead className="text-right text-muted">+</TableHead>
                <TableHead className="text-right text-muted">−</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMMITS.map((c) => (
                <TableRow key={c.hash} className="border-line">
                  <TableCell className="tabular text-sm text-muted">{c.hash}</TableCell>
                  <TableCell className="text-sm">{c.msg}</TableCell>
                  <TableCell className="text-sm text-muted">{c.who}</TableCell>
                  <TableCell className="tabular text-right text-sm text-[var(--add)]">
                    +{c.add}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm text-[var(--del)]">
                    −{c.del}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        </section>

        <section className="mt-10">
          <Logo variant="lockup-horizontal" size={320} />
        </section>
      </main>
    </div>
  );
}
