/**
 * The port for asking the user for a folder.
 *
 * A native dialog is the only implementation that matters on the desktop, but
 * the use cases see a question, not a plugin — which is also what lets a story
 * or a test answer it with a fixed path.
 */
export interface FolderPicker {
  /** One folder, or null when the user cancelled. */
  pickFolder(title: string): Promise<string | null>;
  /** Any number of folders; empty when the user cancelled. */
  pickFolders(title: string): Promise<string[]>;
}
