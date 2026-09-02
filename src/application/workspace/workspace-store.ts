/**
 * The port for what the workspace remembers between sessions: the
 * repositories the user added, as paths.
 *
 * One list, however it was filled — a folder scanned once, or a repository
 * opened on its own. That is the start page: everything the user ever pointed
 * the app at, and nothing it guessed.
 *
 * Synchronous on purpose: the only real implementation is local storage, and
 * a promise here would make every consumer handle a loading state for a value
 * that is available before the first frame.
 */
export interface WorkspaceStore {
  readRepositories(): string[];
  writeRepositories(paths: string[]): void;
}
