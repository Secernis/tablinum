import { Folder1, FolderPlus } from "@tailgrids/icons";

import { Button } from "@/components/tailgrids/core/button";

export interface PickerActionsProps {
  onAddRoots(): void;
  onOpenFromDialog(): void;
  disabled?: boolean;
}

/**
 * The picker's two actions, for the page title bar.
 *
 * "Add folder…" is the filled one: it is the action that makes the app know
 * the machine and pays off on every later start. "Open folder…" is the
 * one-off, and stays outline — one filled button per view.
 */
export function PickerActions({ onAddRoots, onOpenFromDialog, disabled }: PickerActionsProps) {
  return (
    <>
      <Button variant="primary" appearance="outline" size="sm" onPress={onOpenFromDialog} disabled={disabled}>
        <Folder1 />
        Open folder…
      </Button>
      <Button variant="primary" appearance="fill" size="sm" onPress={onAddRoots} disabled={disabled}>
        <FolderPlus />
        Add folder…
      </Button>
    </>
  );
}
