import { useState } from "react";

import { useDiscoverRepositories } from "@/application/repository/use-discover-repositories";
import { useOpenRepository } from "@/application/repository/use-open-repository";
import { ServicesProvider, type Services } from "@/application/services-context";
import { useRecentRepositories } from "@/application/workspace/use-recent-repositories";
import type { OpenedRepository } from "@/domain/history";
import { createLocalRecentRepositoriesStore } from "@/infrastructure/storage/recent-repositories-store";
import { createTauriRepositoryGateway } from "@/infrastructure/tauri/repository-gateway";
import Logo from "@/lib/brand/Logo";
import { RepoOverview } from "@/ui/repo-overview/RepoOverview";
import { RepoPicker } from "@/ui/repo-picker/RepoPicker";

import { ThemeToggle } from "./ThemeToggle";

/**
 * The composition root: real adapters, built once.
 *
 * This is the only file that imports from `infrastructure/`. Everything below
 * it sees the ports.
 */
const services: Services = {
  repositories: createTauriRepositoryGateway(),
  recentRepositories: createLocalRecentRepositoriesStore(),
};

type View = { kind: "pick" } | { kind: "repo"; opened: OpenedRepository };

/** The shell: header, and whichever screen the user is on. */
export default function App() {
  return (
    <ServicesProvider services={services}>
      <Shell />
    </ServicesProvider>
  );
}

function Shell() {
  const [view, setView] = useState<View>({ kind: "pick" });

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="flex items-center gap-4 border-b border-line px-8 py-5">
        <Logo variant="mark" size={40} />
        <div className="min-w-0 flex-1">
          {/* --font-display: Lora, the chosen wordmark typeface */}
          <h1 className="font-[family-name:var(--font-display)] text-xl leading-tight">Tablinum</h1>
          <p className="truncate text-sm text-muted">
            {view.kind === "repo" ? view.opened.repository.path : "Read Git histories, build analyses"}
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-5xl px-8 py-10">
        {view.kind === "pick" ? (
          <PickerScreen onOpened={(opened) => setView({ kind: "repo", opened })} />
        ) : (
          <RepoOverview opened={view.opened} onChangeRepository={() => setView({ kind: "pick" })} />
        )}
      </main>
    </div>
  );
}

/** Wires the picker to its use cases; the picker itself stays presentational. */
function PickerScreen({ onOpened }: { onOpened(opened: OpenedRepository): void }) {
  const discovery = useDiscoverRepositories();
  const opener = useOpenRepository();
  const recents = useRecentRepositories();

  async function open(path: string) {
    const opened = await opener.open(path);
    if (opened) {
      recents.refresh();
      onOpened(opened);
    }
  }

  return (
    <RepoPicker
      recent={recents.recent}
      onForgetRecent={recents.forget}
      roots={discovery.roots}
      selectedRoots={discovery.selectedRoots}
      onToggleRoot={discovery.toggleRoot}
      found={discovery.found}
      scanStatus={discovery.status}
      onScan={discovery.scan}
      opening={opener.opening}
      onOpen={open}
      error={opener.error ?? discovery.error}
    />
  );
}
