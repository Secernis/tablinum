import type { Repository } from "../repository";
import type { Commit } from "./commit";

/**
 * What a repository's history adds up to, at a glance.
 *
 * Zero commits is a valid summary, not an error: it is a state the picker can
 * land on, and the interface has to draw it.
 */
export interface HistorySummary {
  commitCount: number;
  authorCount: number;
  /** Committer time of the oldest root commit; null when there is none. */
  firstCommitAt: number | null;
  /** Committer time of the newest commit; null when there is none. */
  lastCommitAt: number | null;
  /** The newest commits, newest first. */
  recent: Commit[];
}

/** A repository the user has opened, with its history at a glance. */
export interface OpenedRepository {
  repository: Repository;
  history: HistorySummary;
}
