import type { ReactNode } from "react";

import Logo from "@/lib/brand/Logo";

export interface AppShellProps {
  /** The page title bar: what the page is, and its actions on the right. */
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** The shell's own controls, after the actions: the theme toggle. */
  controls?: ReactNode;
  children: ReactNode;
}

/**
 * The application frame: a title bar with the mark, the page's name and its
 * actions, and the page content on the canvas below.
 *
 * Deliberately no navigation yet. The app has two screens and one way between
 * them; a sidebar would be a frame around nothing. When the analyses arrive,
 * they get the sidebar DESIGN.md describes — as a decision then, not a
 * placeholder now.
 */
export function AppShell({ title, subtitle, actions, controls, children }: AppShellProps) {
  return (
    <div className="relative flex min-h-screen flex-col bg-canvas text-ink">
      {/* The quiet ground the glass stands on; fixed, so it never scrolls. */}
      <div className="app-ground" aria-hidden />
      <header className="glass-bar sticky top-0 z-10 flex items-center gap-4 px-6 py-4">
        <Logo variant="mark" size={36} />
        <div className="min-w-0 flex-1">
          {/* --font-display: Lora, the chosen wordmark typeface */}
          <h1 className="font-[family-name:var(--font-display)] text-xl leading-tight text-ink">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-3">{actions}</div>}
        {controls && <div className="ml-2 flex shrink-0 border-l border-ink/10 pl-4">{controls}</div>}
      </header>
      <main className="relative z-[1] flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
