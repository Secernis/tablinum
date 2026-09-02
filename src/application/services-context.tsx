import { createContext, useContext, type ReactNode } from "react";

import type { RepositoryGateway } from "./repository/gateway";
import type { FolderPicker } from "./workspace/folder-picker";
import type { WorkspaceStore } from "./workspace/workspace-store";

/** Every port the use cases need, provided once at the composition root. */
export interface Services {
  repositories: RepositoryGateway;
  workspace: WorkspaceStore;
  folders: FolderPicker;
}

const ServicesContext = createContext<Services | null>(null);

/** Makes the ports available to every use-case hook below it. */
export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/**
 * The ports, for use-case hooks.
 *
 * Throws rather than returning null: a hook rendered outside the provider is a
 * wiring mistake at the composition root, and a null check at every call site
 * would only move the crash somewhere less informative.
 */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices: no ServicesProvider above this component");
  return services;
}
