import { ArrowLeft } from "@tailgrids/icons";
import { useState } from "react";

import { useCommitLog } from "@/application/history/use-commit-log";
import { useOpenRepository } from "@/application/repository/use-open-repository";
import { useRepositoryList } from "@/application/repository/use-repository-list";
import { ServicesProvider, type Services } from "@/application/services-context";
import { Button } from "@/components/tailgrids/core/button";
import type { OpenedRepository } from "@/domain/history";
import { createLocalWorkspaceStore } from "@/infrastructure/storage/workspace-store";
import { createTauriFolderPicker } from "@/infrastructure/tauri/folder-picker";
import { createTauriRepositoryGateway } from "@/infrastructure/tauri/repository-gateway";
import { RepoOverview } from "@/ui/repo-overview/RepoOverview";
import { PickerActions } from "@/ui/repo-picker/PickerActions";
import { RepoPicker } from "@/ui/repo-picker/RepoPicker";
import { AppShell } from "@/ui/shell/AppShell";

import { ThemeToggle } from "./ThemeToggle";

/**
 * The composition root: real adapters, built once.
 *
 * This is the only file that imports from `infrastructure/`. Everything below
 * it sees the ports.
 */
const services: Services = {
  repositories: createTauriRepositoryGateway(),
  workspace: createLocalWorkspaceStore(),
  folders: createTauriFolderPicker(),
};

/** The opened repository, with its log wired to the use case that pages it. */
function OverviewScreen({ opened, onBack }: { opened: OpenedRepository; onBack(): void }) {
  const log = useCommitLog(opened);
  return (
    <AppShell
      title={opened.repository.name}
      subtitle={opened.repository.path}
      actions={
        <Button variant="primary" appearance="outline" size="sm" onPress={onBack}>
          <ArrowLeft />
          Repositories
        </Button>
      }
      controls={<ThemeToggle />}
    >
      <RepoOverview opened={opened} log={log} />
    </AppShell>
  );
}

/** The shell, and whichever screen the user is on. */
export default function App() {
  return (
    <ServicesProvider services={services}>
      <Workspace />
    </ServicesProvider>
  );
}

function Workspace() {
  const [opened, setOpened] = useState<OpenedRepository | null>(null);
  const list = useRepositoryList();
  const opener = useOpenRepository();

  /** Opening from the dialog also puts the repository on the list. */
  async function openFromDialog() {
    const result = await opener.openFromDialog();
    if (!result) return;
    list.add(result.repository.path);
    setOpened(result);
  }

  if (opened) {
    return <OverviewScreen opened={opened} onBack={() => setOpened(null)} />;
  }

  return (
    <AppShell
      title="Repositories"
      subtitle="Choose the history to read"
      actions={
        <PickerActions
          onAddRoots={() => void list.addFromFolders()}
          onOpenFromDialog={() => void openFromDialog()}
          disabled={opener.opening !== null || list.status === "loading"}
        />
      }
      controls={<ThemeToggle />}
    >
      <RepoPicker
        repositories={list.repositories}
        status={list.status}
        onRemove={list.remove}
        opening={opener.opening}
        onOpen={(path) => void opener.open(path).then((r) => r && setOpened(r))}
        error={opener.error ?? list.error}
      />
    </AppShell>
  );
}
