import { ArrowLeft } from "@tailgrids/icons";

import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/components/tailgrids/core/table";
import type { OpenedRepository } from "@/domain/history";
import { Button } from "@/ui/shared/Button";
import { Notice } from "@/ui/shared/Notice";
import { formatDate, formatDateTime, formatRelative } from "@/ui/shared/format-time";

export interface RepoOverviewProps {
  opened: OpenedRepository;
  onChangeRepository(): void;
}

// Diff colours of the domain. Deliberately NOT derived from the brand: green
// and red mean added and removed here, not Tablinum.
const DIFF_VARS = { "--add": "#2ea043", "--del": "#f85149" } as React.CSSProperties;

const numberFormat = new Intl.NumberFormat();

/**
 * The first look at an opened repository: the totals and the newest commits.
 *
 * Every number comes from the history that was just read. There is no
 * placeholder branch: a repository with no commits renders as exactly that.
 */
export function RepoOverview({ opened, onChangeRepository }: RepoOverviewProps) {
  const { repository, history } = opened;

  const stats = [
    { label: "Commits", value: numberFormat.format(history.commitCount), detail: repository.branch ? `on ${repository.branch}` : "detached HEAD" },
    { label: "Authors", value: numberFormat.format(history.authorCount), detail: "distinct emails" },
    {
      label: "First commit",
      value: history.firstCommitAt !== null ? formatDate(history.firstCommitAt) : "—",
      detail: history.firstCommitAt !== null ? formatRelative(history.firstCommitAt) : "",
    },
    {
      label: "Last commit",
      value: history.lastCommitAt !== null ? formatRelative(history.lastCommitAt) : "—",
      detail: history.lastCommitAt !== null ? formatDateTime(history.lastCommitAt) : "",
    },
  ];

  return (
    <div className="space-y-8" style={DIFF_VARS}>
      <header className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">{repository.name}</h2>
          <p className="truncate text-sm text-muted">{repository.path}</p>
        </div>
        <Button onClick={onChangeRepository}>
          <ArrowLeft className="size-4" />
          Change repository
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-surface p-5">
            {/* tabular: JetBrains Mono with tabular figures — columns must not
                shift between two renders. */}
            <div className="tabular text-2xl leading-none tracking-tight">{s.value}</div>
            <div className="mt-2 text-xs uppercase tracking-widest text-muted">{s.label}</div>
            <div className="mt-1 min-h-5 text-sm text-muted">{s.detail}</div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-3 font-[family-name:var(--font-display)] text-lg">Recent commits</h3>
        {history.recent.length === 0 ? (
          <Notice tone="muted">This repository has no commits yet.</Notice>
        ) : (
          <TableRoot className="border-line">
            <TableHeader>
              <TableRow className="border-line">
                <TableHead className="text-muted">Hash</TableHead>
                <TableHead className="text-muted">Message</TableHead>
                <TableHead className="text-muted">Author</TableHead>
                <TableHead className="text-muted">When</TableHead>
                <TableHead className="text-right text-muted">+</TableHead>
                <TableHead className="text-right text-muted">−</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.recent.map((c) => (
                <TableRow key={c.shortHash} className="border-line">
                  <TableCell className="tabular text-sm text-muted">{c.shortHash}</TableCell>
                  <TableCell className="max-w-md truncate text-sm" title={c.subject}>
                    {c.subject}
                  </TableCell>
                  <TableCell className="text-sm text-muted" title={c.author.email}>
                    {c.author.name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted" title={formatDateTime(c.at)}>
                    {formatRelative(c.at)}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm text-[var(--add)]">
                    +{numberFormat.format(c.stats.insertions)}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm text-[var(--del)]">
                    −{numberFormat.format(c.stats.deletions)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        )}
      </section>
    </div>
  );
}
