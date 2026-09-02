import { languageSegments } from "@/domain/analysis";
import type { LocatedRepository } from "@/domain/repository";
import { LanguageBar } from "@/ui/shared/LanguageBar";
import { formatCompact, formatInteger } from "@/ui/shared/format-number";

/**
 * The measurements of a repository, for its row: commits and lines as a
 * figure line, then the language bar.
 *
 * Figures in the mono face with tabular digits so a column of rows lines up.
 * A repository whose code could not be measured shows the commits alone
 * rather than a placeholder for the rest.
 */
export function RepoMeta({ repository }: { repository: LocatedRepository }) {
  const { commitCount, code } = repository;
  const figures: Array<[string, string]> = [[formatInteger(commitCount), commitCount === 1 ? "commit" : "commits"]];
  if (code) {
    figures.push([formatCompact(code.code), "lines of code"]);
    figures.push([formatInteger(code.files), code.files === 1 ? "file" : "files"]);
  }
  return (
    <span className="block space-y-2">
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {figures.map(([value, label]) => (
          <span key={label}>
            <span className="tabular text-ink">{value}</span> {label}
          </span>
        ))}
      </span>
      {code && <LanguageBar segments={languageSegments(code)} />}
    </span>
  );
}
