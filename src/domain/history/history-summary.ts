import type { CodeSize } from "../analysis";
import type { Repository } from "../repository";
import type { AuthorActivity, Commit } from "./commit";

/**
 * What a repository's history adds up to, at a glance.
 *
 * Zero commits is a valid summary, not an error: it is a state the picker can
 * land on, and the interface has to draw it.
 */
export interface HistorySummary {
  commitCount: number;
  authorCount: number;
  /** Every author with a commit, most commits first. */
  authors: AuthorActivity[];
  /** Committer time of the oldest root commit; null when there is none. */
  firstCommitAt: number | null;
  /** Committer time of the newest commit; null when there is none. */
  lastCommitAt: number | null;
  /** The newest commits, newest first. */
  recent: Commit[];
}

/** A repository the user has opened, with its history and its size at a glance. */
export interface OpenedRepository {
  repository: Repository;
  history: HistorySummary;
  /** Null when the code could not be measured; the overview still renders. */
  code: CodeSize | null;
}

/** One author's share of the commits, as a fraction, for a share list. */
export interface AuthorShare extends AuthorActivity {
  /** 0–1 of all commits. */
  fraction: number;
}

/**
 * The authors worth a row of their own, the rest folded into one line.
 *
 * `limit` counts named rows; the remainder is one row labelled by how many
 * people it stands for, so a long tail is neither hidden nor listed.
 */
export function authorShares(summary: HistorySummary, limit = 8): { named: AuthorShare[]; others: AuthorShare | null } {
  if (summary.commitCount === 0) return { named: [], others: null };
  const share = (a: AuthorActivity): AuthorShare => ({ ...a, fraction: a.commits / summary.commitCount });
  const named = summary.authors.slice(0, limit).map(share);
  const tail = summary.authors.slice(limit);
  if (tail.length === 0) return { named, others: null };
  const commits = tail.reduce((sum, a) => sum + a.commits, 0);
  return {
    named,
    others: share({ author: { name: `${tail.length} more`, email: "" }, commits }),
  };
}
