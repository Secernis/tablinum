/**
 * A repository the app has confirmed to be one.
 *
 * `branch` is null for a detached HEAD — a real state to render, not an error.
 */
export interface Repository {
  /** Absolute path of the work tree root, in the platform's native form. */
  path: string;
  /** What the user calls it: the directory name. */
  name: string;
  branch: string | null;
}

/**
 * A repository found by a scan, with enough to choose it from a list.
 *
 * The head is the one fact people pick by ("which one did I touch last week?").
 * Everything else about the history is read once one of them is opened.
 */
export interface LocatedRepository extends Repository {
  /** Subject of the newest commit; null for a repository without commits. */
  headSubject: string | null;
  /** Committer time of the newest commit, seconds since the epoch; null when unborn. */
  headAt: number | null;
}

/**
 * Whether a candidate matches what the user typed into the filter.
 *
 * Name and path both count: a person remembers a project by its name or by the
 * client folder it sits in, and the filter should answer either way.
 */
export function matchesQuery(repository: LocatedRepository, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return repository.name.toLowerCase().includes(q) || repository.path.toLowerCase().includes(q);
}
