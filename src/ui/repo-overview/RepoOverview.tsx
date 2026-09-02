import { ChevronDown, ChevronUp } from "@tailgrids/icons";

import type { CommitLog } from "@/application/history/use-commit-log";
import { Button } from "@/components/tailgrids/core/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/tailgrids/core/card";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/components/tailgrids/core/table";
import { languageSegments } from "@/domain/analysis";
import { authorShares, type OpenedRepository } from "@/domain/history";
import { LanguageBar } from "@/ui/shared/LanguageBar";
import { Notice } from "@/ui/shared/Notice";
import { ShareList } from "@/ui/shared/ShareList";
import { formatCompact, formatInteger } from "@/ui/shared/format-number";
import { formatDate, formatDateTime, formatRelative } from "@/ui/shared/format-time";
import { languageBackground } from "@/ui/shared/language-colors";
import { UI_LOCALE } from "@/ui/shared/locale";
import { cn } from "@/utils/cn";

export interface RepoOverviewProps {
  opened: OpenedRepository;
  /** The log window: five at a time, fetched as needed. */
  log: CommitLog;
}

// Diff colours of the domain. Deliberately NOT derived from the brand: green
// and red mean added and removed here, not Tablinum.
const DIFF_VARS = { "--add": "#2ea043", "--del": "#f85149" } as React.CSSProperties;

const percent = new Intl.NumberFormat(UI_LOCALE, { style: "percent", maximumFractionDigits: 0 });

/** A net line count with its sign; zero stays bare. */
function formatNet(value: number): string {
  if (value < 0) return `−${formatInteger(-value)}`;
  return value > 0 ? `+${formatInteger(value)}` : "0";
}

/** Green when code was added, red when it went away, muted when nothing moved. */
function netTone(value: number): string {
  if (value > 0) return "text-[var(--add)]";
  if (value < 0) return "text-[var(--del)]";
  return "text-muted";
}

/**
 * The first look at an opened repository: the totals, who wrote it, what it
 * is written in, and the newest commits.
 *
 * Every number comes from the history that was just read. There is no
 * placeholder branch: a repository with no commits renders as exactly that,
 * and a code size that could not be measured says so in its panel.
 */
export function RepoOverview({ opened, log }: RepoOverviewProps) {
  const { repository, history, code } = opened;

  const tiles = [
    {
      label: "Commits",
      value: formatInteger(history.commitCount),
      detail: repository.branch ? `on ${repository.branch}` : "detached HEAD",
    },
    {
      label: "Authors",
      value: formatInteger(history.authorCount),
      detail: history.authors[0] ? `most by ${history.authors[0].author.name}` : "",
    },
    {
      label: "Lines of code",
      value: code ? formatCompact(code.code) : "—",
      detail: code ? `${formatInteger(code.files)} files` : "not measured",
    },
    {
      label: "Last commit",
      value: history.lastCommitAt !== null ? formatRelative(history.lastCommitAt) : "—",
      detail: history.firstCommitAt !== null ? `first ${formatDate(history.firstCommitAt)}` : "",
    },
  ];

  const languages = code ? languageSegments(code, 6) : [];
  const { named: authors, others } = authorShares(history);
  const commits = log.shown;

  return (
    <div className="mx-auto max-w-6xl space-y-6" style={DIFF_VARS}>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
        {tiles.map((t) => (
          <Card key={t.label} className="glass elev-1 min-w-0 rounded-2xl md:min-w-0">
            <CardContent className="p-5">
              {/* tabular: JetBrains Mono with tabular figures — columns must not
                  shift between two renders. */}
              <div className="tabular text-2xl leading-none tracking-tight text-ink">{t.value}</div>
              <div className="mt-2 text-xs uppercase tracking-widest text-muted">{t.label}</div>
              <div className="mt-1 min-h-5 truncate text-sm text-muted" title={t.detail}>
                {t.detail}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Composition">
        <Card className="glass elev-2 min-w-0 rounded-2xl md:min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Languages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-5">
            {languages.length === 0 ? (
              <p className="text-sm text-muted">{code ? "No code to count." : "The code could not be measured."}</p>
            ) : (
              <>
                <LanguageBar segments={languages} />
                <ShareList
                  rows={languages.map((s) => ({
                    key: s.name,
                    label: s.name,
                    value: `${formatCompact(s.code)} · ${percent.format(s.fraction)}`,
                    fraction: s.fraction,
                    fill: languageBackground(s.name),
                    title: `${formatInteger(s.code)} lines`,
                  }))}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card className="glass elev-2 min-w-0 rounded-2xl md:min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Authors</CardTitle>
          </CardHeader>
          <CardContent className="pb-5">
            {authors.length === 0 ? (
              <p className="text-sm text-muted">No commits yet.</p>
            ) : (
              <ShareList
                rows={[
                  ...authors.map((a) => ({
                    key: a.author.email || a.author.name,
                    label: a.author.name,
                    value: `${formatInteger(a.commits)} · ${percent.format(a.fraction)}`,
                    fraction: a.fraction,
                    title: a.author.email,
                  })),
                  ...(others
                    ? [
                        {
                          key: "others",
                          label: others.author.name,
                          value: `${formatInteger(others.commits)} · ${percent.format(others.fraction)}`,
                          fraction: others.fraction,
                          fill: "color-mix(in oklab, var(--t-text) 25%, transparent)",
                          muted: true,
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg text-ink">Recent commits</h2>
        {log.total === 0 ? (
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
                  <TableHead className="text-right text-muted">Net lines</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commits.map((c) => (
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
                    <TableCell
                      className={cn("tabular text-right text-sm", netTone(c.stats.insertions - c.stats.deletions))}
                      title={`+${formatInteger(c.stats.insertions)} −${formatInteger(c.stats.deletions)}`}
                    >
                      {formatNet(c.stats.insertions - c.stats.deletions)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </TableRoot>
            {log.error && (
              <p role="alert" className="border-t border-ink/10 px-5 py-2 text-sm text-danger">
                {log.error}
              </p>
            )}
            {log.total > 5 && (
              <div className="flex justify-center border-t border-ink/10 py-2">
                {log.remaining > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => void log.more()}
                    disabled={log.loading}
                    aria-label={`Show ${Math.min(5, log.remaining)} more commits`}
                  >
                    <ChevronDown />
                    {log.loading ? "Loading…" : `${Math.min(5, log.remaining)} more`}
                    <span className="tabular text-muted">({formatInteger(log.remaining)} left)</span>
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onPress={log.fewer}>
                    <ChevronUp />
                    Show fewer
                  </Button>
                )}
              </div>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}
