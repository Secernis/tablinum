import { Card, CardContent } from "@/components/tailgrids/core/card";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/components/tailgrids/core/table";
import type { OpenedRepository } from "@/domain/history";
import { Notice } from "@/ui/shared/Notice";
import { formatInteger } from "@/ui/shared/format-number";
import { formatDate, formatDateTime, formatRelative } from "@/ui/shared/format-time";

export interface RepoOverviewProps {
  opened: OpenedRepository;
}

// Diff colours of the domain. Deliberately NOT derived from the brand: green
// and red mean added and removed here, not Tablinum.
const DIFF_VARS = { "--add": "#2ea043", "--del": "#f85149" } as React.CSSProperties;

/**
 * The first look at an opened repository: the totals and the newest commits.
 *
 * Every number comes from the history that was just read. There is no
 * placeholder branch: a repository with no commits renders as exactly that.
 * The "change repository" action lives in the title bar, wired by the app.
 */
export function RepoOverview({ opened }: RepoOverviewProps) {
  const { repository, history } = opened;

  const stats = [
    {
      label: "Commits",
      value: formatInteger(history.commitCount),
      detail: repository.branch ? `on ${repository.branch}` : "detached HEAD",
    },
    { label: "Authors", value: formatInteger(history.authorCount), detail: "distinct emails" },
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
    <div className="mx-auto max-w-6xl space-y-6" style={DIFF_VARS}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
        {stats.map((s) => (
          <Card key={s.label} className="glass elev-1 min-w-0 rounded-2xl md:min-w-0">
            <CardContent className="p-5">
              {/* tabular: JetBrains Mono with tabular figures — columns must not
                  shift between two renders. */}
              <div className="tabular text-2xl leading-none tracking-tight text-ink">{s.value}</div>
              <div className="mt-2 text-xs uppercase tracking-widest text-muted">{s.label}</div>
              <div className="mt-1 min-h-5 truncate text-sm text-muted" title={s.detail}>
                {s.detail}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg text-ink">Recent commits</h2>
        {history.recent.length === 0 ? (
          <Notice tone="muted">This repository has no commits yet.</Notice>
        ) : (
          <Card className="glass elev-2 overflow-hidden rounded-2xl md:min-w-0">
            <TableRoot className="border-0">
              <TableHeader>
                <TableRow className="border-ink/10">
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
                  <TableRow key={c.shortHash} className="border-ink/10">
                    <TableCell className="tabular text-sm text-muted">{c.shortHash}</TableCell>
                    <TableCell className="max-w-md truncate text-sm text-ink" title={c.subject}>
                      {c.subject}
                    </TableCell>
                    <TableCell className="text-sm text-muted" title={c.author.email}>
                      {c.author.name}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-sm text-muted" title={formatDateTime(c.at)}>
                      {formatRelative(c.at)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm text-[var(--add)]">
                      +{formatInteger(c.stats.insertions)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm text-[var(--del)]">
                      −{formatInteger(c.stats.deletions)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </TableRoot>
          </Card>
        )}
      </section>
    </div>
  );
}
