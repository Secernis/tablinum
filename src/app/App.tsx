import { ArrowLeft, DashboardSquare1, Folder1 } from "@tailgrids/icons";
import { useState } from "react";

import { useDiscoverRepositories } from "@/application/repository/use-discover-repositories";
import { useOpenRepository } from "@/application/repository/use-open-repository";
import { ServicesProvider, type Services } from "@/application/services-context";
import { useRecentRepositories } from "@/application/workspace/use-recent-repositories";
import { Button } from "@/components/tailgrids/core/button";
import type { OpenedRepository } from "@/domain/history";
import { createLocalWorkspaceStore } from "@/infrastructure/storage/workspace-store";
import { createTauriFolderPicker } from "@/infrastructure/tauri/folder-picker";
import { createTauriRepositoryGateway } from "@/infrastructure/tauri/repository-gateway";
import { RepoOverview } from "@/ui/repo-overview/RepoOverview";
import { PickerActions } from "@/ui/repo-picker/PickerActions";
import { RepoPicker } from "@/ui/repo-picker/RepoPicker";
import { AppShell, type NavItem } from "@/ui/shell/AppShell";

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

/** The shell: sidebar, title bar, and whichever screen the user is on. */
export default function App() {
  return (
    <ServicesProvider services={services}>
      <Workspace />
    </ServicesProvider>
  );
}

type View = "repositories" | "overview";

function Workspace() {
  const [opened, setOpened] = useState<OpenedRepository | null>(null);
  const [view, setView] = useState<View>("repositories");

  const nav: NavItem[] = [
    { id: "repositories", label: "Repositories", icon: <Folder1 />, active: view === "repositories" },
    {
      id: "overview",
      label: "Overview",
      icon: <DashboardSquare1 />,
      active: view === "overview",
      disabled: opened === null,
    },
  ];

  const discovery = useDiscoverRepositories();
  const opener = useOpenRepository();
  const recents = useRecentRepositories();

  function settle(result: OpenedRepository | null) {
    if (!result) return;
    recents.refresh();
    setOpened(result);
    setView("overview");
  }

  if (view === "overview" && opened) {
    return (
      <AppShell
        nav={nav}
        onNavigate={(id) => setView(id as View)}
        footer={<ThemeToggle />}
        title={opened.repository.name}
        subtitle={opened.repository.path}
        actions={
          <Button variant="primary" appearance="outline" size="sm" onPress={() => setView("repositories")}>
            <ArrowLeft />
            Change repository
          </Button>
        }
      >
        <RepoOverview opened={opened} />
      </AppShell>
    );
  }

  return (
    <AppShell
      nav={nav}
      onNavigate={(id) => setView(id as View)}
      footer={<ThemeToggle />}
      title="Repositories"
      subtitle="Choose the history to read"
      actions={
        <PickerActions
          onAddRoots={() => void discovery.addRoots()}
          onOpenFromDialog={() => void opener.openFromDialog().then(settle)}
          disabled={opener.opening !== null}
        />
      }
    >
      <RepoPicker
        recent={recents.recent}
        onForgetRecent={recents.forget}
        roots={discovery.roots}
        onRemoveRoot={discovery.removeRoot}
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
