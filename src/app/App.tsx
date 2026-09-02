import { ArrowLeft } from "@tailgrids/icons";
import { useState } from "react";

import { useDiscoverRepositories } from "@/application/repository/use-discover-repositories";
import { useOpenRepository } from "@/application/repository/use-open-repository";
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
  const discovery = useDiscoverRepositories();
  const opener = useOpenRepository();

  function settle(result: OpenedRepository | null) {
    if (result) setOpened(result);
  }

  function backToList() {
    setOpened(null);
    // A repository opened through the dialog while away is on the list now.
    void discovery.scan();
  }

  if (opened) {
    return (
      <AppShell
        title={opened.repository.name}
        subtitle={opened.repository.path}
        actions={
          <Button variant="primary" appearance="outline" size="sm" onPress={backToList}>
            <ArrowLeft />
            Repositories
          </Button>
        }
        controls={<ThemeToggle />}
      >
        <RepoOverview opened={opened} />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Repositories"
      subtitle="Choose the history to read"
      actions={
        <PickerActions
          onAddRoots={() => void discovery.addRoots()}
          onOpenFromDialog={() => void opener.openFromDialog().then(settle)}
          disabled={opener.opening !== null}
        />
      }
      controls={<ThemeToggle />}
    >
      <RepoPicker
        roots={discovery.roots}
        onRemoveRoot={discovery.removeRoot}
        added={discovery.added}
        onRemoveAdded={discovery.removeAdded}
        found={discovery.found}
        scanStatus={discovery.status}
        onScan={() => void discovery.scan()}
        opening={opener.opening}
        onOpen={(path) => void opener.open(path).then(settle)}
        error={opener.error ?? discovery.error}
      />
    </AppShell>
  );
}
