import { Layout22 } from "@tailgrids/icons";
import type { ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/tailgrids/core/sidebar";
import Logo from "@/lib/brand/Logo";

/** One entry in the sidebar navigation. */
export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  /** A view that has nothing to show yet stays visible but cannot be chosen. */
  disabled?: boolean;
}

export interface AppShellProps {
  nav: NavItem[];
  onNavigate(id: string): void;
  /** What the sidebar carries at the bottom: the theme toggle, later the settings. */
  footer?: ReactNode;
  /** The page title bar: what the page is, and its actions on the right. */
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * The application frame: a 232 px sidebar with the mark and the navigation,
 * a title bar per page, and the page content on the canvas.
 *
 * The layout follows DESIGN.md ("Layout"): sidebar with a 1 px border on the
 * right, content as cards on the page background, 24–32 px between sections.
 * Built on the TailGrids Sidebar so collapsing, keyboard toggling (Ctrl+B)
 * and the narrow-window sheet come for free.
 */
export function AppShell({ nav, onNavigate, footer, title, subtitle, actions, children }: AppShellProps) {
  return (
    <SidebarProvider
      defaultOpen
      className="min-h-screen bg-canvas text-ink"
      style={{ "--sidebar-width": "14.5rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}
    >
      <Sidebar collapsible="icon" className="border-line">
        <SidebarHeader className="px-3 pt-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <Logo variant="mark" size={32} />
            {/* --font-display: Lora, the chosen wordmark typeface */}
            <span className="font-[family-name:var(--font-display)] text-lg leading-none text-ink group-data-[collapsible=icon]:hidden">
              Tablinum
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-muted">Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={item.active}
                      isDisabled={item.disabled}
                      tooltip={item.label}
                      onPress={() => onNavigate(item.id)}
                      className="text-ink data-[active=true]:text-accent [&>svg]:size-5 [&>svg]:text-muted data-[active=true]:[&>svg]:text-accent"
                    >
                      {item.icon}
                      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-line px-3 py-3">{footer}</SidebarFooter>
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-line bg-surface px-6 py-4">
          <SidebarTrigger className="border-line text-muted hover:bg-raised hover:text-ink">
            <Layout22 className="size-5" />
          </SidebarTrigger>
          <div className="min-w-0 flex-1">
            <h1 className="font-[family-name:var(--font-display)] text-xl leading-tight text-ink">{title}</h1>
            {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 gap-3">{actions}</div>}
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </SidebarProvider>
  );
}
