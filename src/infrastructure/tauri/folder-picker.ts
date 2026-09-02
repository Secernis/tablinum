import { open } from "@tauri-apps/plugin-dialog";

import type { FolderPicker } from "@/application/workspace/folder-picker";

/**
 * The folder picker backed by the native dialog.
 *
 * `dialog:allow-open` is the only permission the capability grants the plugin,
 * because asking for a folder is the only thing this app needs from it.
 */
export function createTauriFolderPicker(): FolderPicker {
  return {
    async pickFolder(title) {
      const picked = await open({ directory: true, multiple: false, title });
      return typeof picked === "string" ? picked : null;
    },
    async pickFolders(title) {
      const picked = await open({ directory: true, multiple: true, title });
      if (Array.isArray(picked)) return picked;
      return typeof picked === "string" ? [picked] : [];
    },
  };
}
