import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

interface NoticeProps {
  tone: "error" | "muted";
  children: ReactNode;
  className?: string;
}

/**
 * A line of status the user should read: an error, or what a scan is doing.
 *
 * `role="alert"` on errors only — a screen reader should interrupt for a
 * failure, not for "scanning".
 */
export function Notice({ tone, children, className }: NoticeProps) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "error" ? "border-danger bg-surface text-danger" : "border-line bg-surface text-muted",
        className,
      )}
    >
      {children}
    </p>
  );
}
