/** A repository the user opened before, enough to offer it again. */
export interface RecentRepository {
  path: string;
  name: string;
  /** When it was last opened, milliseconds since the epoch. */
  openedAt: number;
}

/**
 * The port for what the workspace remembers between sessions.
 *
 * Synchronous on purpose: the only real implementation is local storage, and
 * a promise here would make every consumer handle a loading state for a value
 * that is available before the first frame.
 */
export interface RecentRepositoriesStore {
  read(): RecentRepository[];
  write(entries: RecentRepository[]): void;
}
