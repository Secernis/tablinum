/**
 * The port for what the workspace remembers between sessions: the folders the
 * user scans, and the repositories they added one at a time.
 *
 * Both are lists of paths. Together they are the start page — everything the
 * user ever pointed the app at, and nothing it guessed.
 *
 * Synchronous on purpose: the only real implementation is local storage, and
 * a promise here would make every consumer handle a loading state for a value
 * that is available before the first frame.
 */
export interface WorkspaceStore {
  /** The folders a scan covers, as the user chose them. */
  readScanRoots(): string[];
  writeScanRoots(roots: string[]): void;
  /** Repositories opened through the folder dialog, one at a time. */
  readAddedRepositories(): string[];
  writeAddedRepositories(paths: string[]): void;
}
