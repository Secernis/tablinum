/** A repository the user opened before, enough to offer it again. */
export interface RecentRepository {
  path: string;
  name: string;
  /** When it was last opened, milliseconds since the epoch. */
  openedAt: number;
}

/**
 * The port for what the workspace remembers between sessions: the folders the
 * user scans, and the repositories they opened.
 *
 * Synchronous on purpose: the only real implementation is local storage, and
 * a promise here would make every consumer handle a loading state for a value
 * that is available before the first frame.
 */
export interface WorkspaceStore {
  readRecent(): RecentRepository[];
  writeRecent(entries: RecentRepository[]): void;
  /** The folders a scan covers, as the user chose them. */
  readScanRoots(): string[];
  writeScanRoots(roots: string[]): void;
}
